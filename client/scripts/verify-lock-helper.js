const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const hookSource = fs.readFileSync(path.join(root, 'electron', 'blockAltTab.ps1'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const rendererBootstrapSource = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8');

const lockResource = pkg.build?.extraResources?.find((entry) =>
  entry.from === 'electron/blockAltTab.ps1'
  && entry.to === 'electron/blockAltTab.ps1'
);

assert.ok(lockResource, 'blockAltTab.ps1 wajib disalin sebagai extraResources.');
assert.ok(
  pkg.build?.files?.includes('!electron/blockAltTab.ps1'),
  'Helper lock harus dikeluarkan dari app.asar agar PowerShell dapat menjalankannya.',
);
assert.match(
  mainSource,
  /path\.join\(process\.resourcesPath, 'electron', 'blockAltTab\.ps1'\)/,
  'Path helper production harus menggunakan process.resourcesPath.',
);
assert.match(hookSource, /WM_KEYUP/, 'Hook harus memblokir key-up tombol Windows.');
assert.match(hookSource, /WM_SYSKEYUP/, 'Hook harus memblokir key-up shortcut sistem.');

assert.doesNotMatch(
  rendererBootstrapSource,
  /RendererReadySignal/,
  'Bootstrap generik tidak boleh mengaktifkan kiosk sebelum layar nyata terlukis.',
);
assert.match(appSource, /data-labkom-screen="setup"/, 'Layar setup harus memiliki marker visual.');
assert.match(appSource, /data-labkom-screen="login"/, 'Layar login harus memiliki marker visual.');
assert.match(appSource, /setInterval\(reportPaintedScreen, 2_000\)/, 'Layar lock harus mengirim heartbeat visual.');
assert.match(preloadSource, /screen: \['login', 'setup'\]\.includes/, 'Preload harus membatasi nama layar handshake.');
assert.match(mainSource, /show:\s+false/, 'Window wajib tetap tersembunyi sebelum bukti visual lolos.');
assert.match(mainSource, /executeJavaScript\(`\(\(\) => \{/, 'Main process harus memverifikasi DOM sebelum kiosk.');
assert.match(mainSource, /renderer-visual-heartbeat-timeout/, 'Main process harus fail-open ketika heartbeat hilang.');
assert.match(mainSource, /setBackgroundColor\('#0f172a'\)/, 'Layar login harus memiliki background OS yang tidak transparan.');
assert.match(
  mainSource,
  /releaseRendererLockForRecovery[\s\S]*?showTaskbar\(\)[\s\S]*?mainWindow\.hide\(\)/,
  'Pemulihan renderer harus mengembalikan taskbar dan menyembunyikan window pengunci.',
);

console.log('Lock helper packaging and fail-open renderer startup: PASS');
