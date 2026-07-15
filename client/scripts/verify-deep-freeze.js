const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createDeepFreezeManager,
  isEditionSupported,
  normalizeDeepFreezeStatus,
  parseStatusOutput,
} = require('../electron/deepFreezeManager');

assert.equal(isEditionSupported('Windows 11 Education'), true);
assert.equal(isEditionSupported('Windows 10 Enterprise LTSC'), true);
assert.equal(isEditionSupported('Windows 11 Pro'), false);
assert.equal(isEditionSupported('Windows 10 Home Single Language'), false);

assert.deepEqual(parseStatusOutput('noise\n{"supported":true}\n'), { supported: true });


const readProjectFile = (...segments) => fs.readFileSync(
  path.join(__dirname, '..', ...segments),
  'utf8',
);
const mainSource = readProjectFile('electron', 'main.js');
const preloadSource = readProjectFile('electron', 'preload.js');
const panelSource = readProjectFile('src', 'DeepFreezePanel.jsx');
const settingsSource = readProjectFile('src', 'ClientSettingsPanel.jsx');
const appSource = readProjectFile('src', 'App.jsx');
const installerSource = readProjectFile('build', 'installer.nsh');
const provisionSource = readProjectFile('build', 'provisionUwf.ps1');
const packageConfig = JSON.parse(readProjectFile('package.json'));

assert.equal(packageConfig.build.nsis.perMachine, true);
assert.equal(packageConfig.build.nsis.oneClick, false);
assert.equal(packageConfig.build.nsis.include, 'build/installer.nsh');
assert.match(installerSource, /!macro customInstall/);
assert.match(installerSource, /\$\{ifNot\} \$\{isUpdated\}/);
assert.match(installerSource, /File \/oname=\$PLUGINSDIR\\provisionUwf\.ps1/);
assert.match(provisionSource, /Client-UnifiedWriteFilter/);
assert.match(provisionSource, /'\/NoRestart'/);
assert.match(provisionSource, /WindowsPrincipal/);
assert.match(provisionSource, /credentials_stored = \$false/);
assert.doesNotMatch(
  provisionSource,
  /uwfmgr(?:\.exe)?.*(?:filter\s+enable|volume\s+protect)/i,
  'The installer may provision UWF but must never freeze the drive automatically.',
);


assert.match(
  mainSource,
  /ipcMain\.handle\('configure-deep-freeze'[\s\S]{0,700}verifyEmergencyPassword/,
  'Local Deep Freeze changes must require the Kepala Lab password.',
);
assert.match(mainSource, /ipcMain\.handle\('relaunch-client-as-admin'/);
assert.match(mainSource, /deviceTokenRejected/);
assert.match(mainSource, /Pairing PC perlu diperbarui/);
assert.match(preloadSource, /getDeepFreezeStatus/);
assert.match(preloadSource, /relaunchAsAdministrator/);
assert.match(panelSource, /Password Kepala Lab/);
assert.match(panelSource, /Izinkan Administrator/);
assert.match(panelSource, /Kredensial tidak pernah disimpan/);
assert.match(settingsSource, /<DeepFreezePanel/);
assert.match(appSource, /onDeepFreezeConfigure=\{handleConfigureDeepFreeze\}/);
const pendingFreeze = normalizeDeepFreezeStatus({
  product_name: 'Windows 11 Education',
  supported: true,
  feature_installed: true,
  provider_ready: true,
  is_admin: true,
  current_enabled: false,
  next_enabled: true,
  current_protected: false,
  next_protected: true,
  system_drive: 'C:',
}, { platform: 'win32' });
assert.equal(pendingFreeze.state, 'pending_freeze');
assert.equal(pendingFreeze.next_frozen, true);
assert.equal(pendingFreeze.restart_required, true);

const commands = [];
let nextEnabled = false;
let nextProtected = false;
const fakeRun = async (file, args) => {
  commands.push({ file, args: [...args] });
  if (/powershell\.exe$/i.test(file)) {
    return {
      code: 0,
      stdout: JSON.stringify({
        product_name: 'Windows 11 Education',
        supported: true,
        is_admin: true,
        feature_installed: true,
        provider_ready: true,
        current_enabled: false,
        next_enabled: nextEnabled,
        current_protected: false,
        next_protected: nextProtected,
        system_drive: 'C:',
      }),
      stderr: '',
    };
  }
  if (args[0] === 'volume' && args[1] === 'protect') nextProtected = true;
  if (args[0] === 'filter' && args[1] === 'enable') nextEnabled = true;
  if (args[0] === 'volume' && args[1] === 'unprotect') nextProtected = false;
  if (args[0] === 'filter' && args[1] === 'disable') nextEnabled = false;
  return { code: 0, stdout: '', stderr: '' };
};

const fakeFs = {
  existsSync: () => false,
  mkdirSync: () => {},
  writeFileSync: () => {},
  readFileSync: () => { throw new Error('not found'); },
  unlinkSync: () => {},
};

(async () => {
  const manager = createDeepFreezeManager({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    userDataPath: 'C:\\Users\\Student\\AppData\\Roaming\\labkom-client',
    executablePath: 'C:\\Program Files\\LabKom Siswa\\LabKom Siswa.exe',
    run: fakeRun,
    fsImpl: fakeFs,
    logger: { warn: () => {} },
  });

  const frozen = await manager.configure('freeze');
  assert.equal(frozen.success, true);
  assert.equal(frozen.state, 'pending_freeze');
  assert.equal(frozen.next_frozen, true);
  assert(commands.some(({ args }) => args.join(' ') === 'volume protect C:'));
  assert(commands.some(({ args }) => args.join(' ') === 'overlay set-type disk'));
  assert(commands.some(({ args }) => args.join(' ') === 'filter enable'));

  const open = await manager.configure('unfreeze');
  assert.equal(open.success, true);
  assert.equal(open.next_frozen, false);
  assert(commands.some(({ args }) => args.join(' ') === 'filter disable'));
  assert(commands.some(({ args }) => args.join(' ') === 'volume unprotect C:'));

  const commandCount = commands.length;
  const invalid = await manager.configure('format-drive');
  assert.equal(invalid.success, false);
  assert.equal(commands.length, commandCount);

  let savedFaronicsPassword = '';
  const faronicsCommands = [];
  const faronicsManager = createDeepFreezeManager({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
    userDataPath: 'C:\\Users\\Student\\AppData\\Roaming\\labkom-client',
    executablePath: 'C:\\Program Files\\LabKom Siswa\\LabKom Siswa.exe',
    getProviderPassword: () => savedFaronicsPassword,
    setProviderPassword: (value) => { savedFaronicsPassword = value; },
    run: async (file, args) => {
      faronicsCommands.push({ file, args: [...args] });
      if (/powershell\.exe$/i.test(file)) {
        return {
          code: 0,
          stdout: JSON.stringify({
            product_name: 'Windows 11 Home Single Language',
            supported: false,
            is_admin: false,
            feature_installed: false,
            provider_ready: false,
            system_drive: 'C:',
          }),
          stderr: '',
        };
      }
      if (args.join(' ') === 'get /ISFROZEN') return { code: 0, stdout: '', stderr: '' };
      if (args.join(' ') === 'get /version') return { code: 0, stdout: 'Deep Freeze 9', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    fsImpl: {
      ...fakeFs,
      existsSync: (candidate) => /DFC\.exe$/i.test(candidate),
    },
    logger: { warn: () => {} },
  });

  const homeStatus = await faronicsManager.getStatus();
  assert.equal(homeStatus.provider, 'faronics');
  assert.equal(homeStatus.supported, true);
  assert.equal(homeStatus.state, 'open');
  assert.equal(homeStatus.requires_provider_password, true);

  const faronicsFrozen = await faronicsManager.configure('freeze', {
    providerPassword: 'LabCommand123!',
  });
  assert.equal(faronicsFrozen.success, true);
  assert.equal(faronicsFrozen.state, 'pending_freeze');
  assert.equal(savedFaronicsPassword, 'LabCommand123!');
  assert(faronicsCommands.some(({ args }) => args.join(' ') === 'LabCommand123! /FREEZENEXTBOOT'));

  assert.match(mainSource, /faronics_command_password_protected/);
  assert.match(preloadSource, /providerPassword/);
  assert.match(panelSource, /Password Command Line Faronics/);

  console.log('Deep Freeze dual-provider manager verification passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
