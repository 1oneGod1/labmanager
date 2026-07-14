const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, shell, Notification } = require('electron');
const os              = require('os');
const path            = require('path');
const fs              = require('fs');
const http            = require('http');
const https           = require('https');
const net             = require('net');
const dgram           = require('dgram');
const crypto          = require('crypto');
const { execSync, spawn } = require('child_process');
const { io }          = require('socket.io-client');
const ActivityMonitor = require('./activityMonitor');
const { verifyEmergencyPassword } = require('./emergencyPassword');

// Semua HTTP renderer sudah lewat IPC apiRequest (file:// → main process Node.js http),
// jadi flag disable-web-security tidak diperlukan. Socket.io WebSocket dari file:// ke
// http:// LAN tetap diizinkan Chromium, dan server CORS sudah allow null origin.

// ── Single instance: hanya aktif di production supaya dev client bisa jalan berdampingan
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit();
}

// ─── UDP Discovery Listener ─────────────────────────────────────────────────
const DISCOVERY_PORT = 41234;
let   udpSocket      = null;

function startDiscoveryListener() {
  if (udpSocket) return;
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpSocket.bind(DISCOVERY_PORT, () => {
    udpSocket.addMembership && undefined; // ipv4 broadcast, no multicast needed
    console.log('[DISCOVERY] Listening for server broadcasts on port', DISCOVERY_PORT);
  });
  udpSocket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.labkom && data.ip && data.port) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-discovered', {
            url:  `http://${data.ip}:${data.port}`,
            name: data.name || 'LabKom Admin',
            ip:   data.ip,
            port: data.port,
          });
        }
      }
    } catch {}
  });
  udpSocket.on('error', (err) => {
    console.warn('[DISCOVERY] error:', err.message);
  });
}

function stopDiscoveryListener() {
  if (udpSocket) { try { udpSocket.close(); } catch {} udpSocket = null; }
}
const { autoUpdater } = require('electron-updater');
const log             = require('electron-log');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const allowDevTools = process.env.OPEN_ELECTRON_DEVTOOLS === '1';
let allowAppQuit = false;
let realtimeSocket = null;
let presenceHeartbeatTimer = null;
let latestControlPolicy = null;
let policyProxyServer = null;
let policyProxyPort = null;
const recentlyReportedBlockedHosts = new Map();

// ── Auto-Updater (silent background update) ──────────────────────────────────
// Client: download otomatis di background, install saat app keluar
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.channel = 'client';
autoUpdater.allowPrerelease = false;
autoUpdater.allowDowngrade = false;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_CLIENT_SETTINGS = Object.freeze({
  autoUpdate: true,
  openAtLogin: true,
  notifyUpdates: true,
});
let clientSettings = { ...DEFAULT_CLIENT_SETTINGS };
let updateCheckTimer = null;
let latestUpdateStatus = { state: 'idle', currentVersion: app.getVersion() };

function getClientSettingsPath() {
  return path.join(app.getPath('userData'), 'client.settings.json');
}

function sanitizeClientSettings(value = {}) {
  return {
    autoUpdate: value.autoUpdate !== false,
    openAtLogin: value.openAtLogin !== false,
    notifyUpdates: value.notifyUpdates !== false,
  };
}

function loadClientSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(getClientSettingsPath(), 'utf-8'));
    return sanitizeClientSettings({ ...DEFAULT_CLIENT_SETTINGS, ...stored });
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

function saveClientSettings(settings) {
  const safeSettings = sanitizeClientSettings(settings);
  fs.writeFileSync(getClientSettingsPath(), JSON.stringify(safeSettings, null, 2), 'utf-8');
  clientSettings = safeSettings;
  return safeSettings;
}

function applyClientSettings(settings = clientSettings) {
  clientSettings = sanitizeClientSettings(settings);
  autoUpdater.autoDownload = clientSettings.autoUpdate;
  if (!isDev) {
    app.setLoginItemSettings({
      openAtLogin: clientSettings.openAtLogin,
      openAsHidden: false,
      name: 'LabKom Siswa',
    });
  }
}

function sendClientUpdateStatus(data) {
  latestUpdateStatus = {
    ...latestUpdateStatus,
    ...data,
    currentVersion: app.getVersion(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('client-update-status', latestUpdateStatus);
  }
}

function showUpdateNotification(title, body) {
  if (!clientSettings.notifyUpdates || !app.isReady() || !Notification.isSupported()) return;
  new Notification({ title, body, silent: false }).show();
}

function scheduleUpdateChecks() {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  updateCheckTimer = null;
  if (isDev || !clientSettings.autoUpdate) return;
  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      log.warn('[CLIENT UPDATE] Pemeriksaan berkala gagal:', error.message);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

autoUpdater.on('checking-for-update', () => {
  log.info('[CLIENT UPDATE] Memeriksa pembaruan...');
  sendClientUpdateStatus({ state: 'checking', message: null });
});
autoUpdater.on('update-available', (info) => {
  log.info('[CLIENT UPDATE] Pembaruan tersedia:', info.version);
  sendClientUpdateStatus({ state: 'available', version: info.version, releaseNotes: info.releaseNotes });
  showUpdateNotification('Pembaruan LabKom Siswa tersedia', `Versi ${info.version} sedang disiapkan.`);
});
autoUpdater.on('update-not-available', (info) => {
  log.info('[CLIENT UPDATE] Sudah versi terbaru:', info.version);
  sendClientUpdateStatus({ state: 'latest', version: info.version, percent: null, message: null });
});
autoUpdater.on('download-progress', (progress) => {
  sendClientUpdateStatus({
    state: 'downloading',
    percent: Math.round(progress.percent),
    speed: Math.round(progress.bytesPerSecond / 1024),
    total: Math.round(progress.total / 1024 / 1024),
  });
});
autoUpdater.on('update-downloaded', (info) => {
  log.info('[CLIENT UPDATE] Download selesai, siap dipasang:', info.version);
  sendClientUpdateStatus({ state: 'downloaded', version: info.version, percent: 100 });
  showUpdateNotification('Pembaruan siap dipasang', `LabKom Siswa ${info.version} akan dipasang saat aplikasi ditutup.`);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-downloaded');
});
autoUpdater.on('error', (err) => {
  log.warn('[CLIENT UPDATE] Error:', err.message);
  sendClientUpdateStatus({ state: 'error', message: err.message });
});

process.on('uncaughtException', (err) => {
  log.error('[MAIN] uncaughtException:', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', (reason) => {
  log.error('[MAIN] unhandledRejection:', reason);
});

// ── Path file konfigurasi server URL ────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'server.config.json');
}
function loadServerConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}
function isAllowedLabServerUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (/^10\.(\d{1,3}\.){2}\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.(\d{1,3}\.)\d{1,3}$/.test(host)) return true;
    const match172 = host.match(/^172\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    return Boolean(match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31);
  } catch {
    return false;
  }
}
function saveServerConfig(data) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Device identity & token (per-PC client auth) ────────────────────────────────
function getDevicePath() {
  return path.join(app.getPath('userData'), 'device.json');
}
function loadDeviceInfo() {
  try {
    const raw = fs.readFileSync(getDevicePath(), 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}
function saveDeviceInfo(info) {
  try { fs.writeFileSync(getDevicePath(), JSON.stringify(info, null, 2), 'utf-8'); } catch (_) {}
}
function getOrCreateDeviceId() {
  const info = loadDeviceInfo();
  if (info.device_id) return info.device_id;
  const id = crypto.randomBytes(16).toString('hex');
  saveDeviceInfo({ ...info, device_id: id });
  return id;
}
function getStoredClientToken() {
  return loadDeviceInfo().client_token || null;
}
function setStoredClientToken(token) {
  const info = loadDeviceInfo();
  info.client_token = token;
  saveDeviceInfo(info);
}

// Minta token dari server. Resolve null kalau gagal.
function requestDeviceToken(serverUrl) {
  return new Promise((resolve) => {
    if (!serverUrl) return resolve(null);
    let parsed;
    try { parsed = new URL(`${serverUrl}/api/auth/device-register`); }
    catch { return resolve(null); }
    const body = JSON.stringify({
      device_id: getOrCreateDeviceId(),
      pc_name: os.hostname(),
    });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (process.env.LABKOM_CLIENT_REGISTRATION_KEY) {
      headers['X-LabKom-Registration-Key'] = process.env.LABKOM_CLIENT_REGISTRATION_KEY;
    }
    const req = http.request({
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 3001,
      path: parsed.pathname,
      method: 'POST',
      headers,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => buf += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          if (json?.success && json.data?.token) {
            setStoredClientToken(json.data.token);
            resolve(json.data.token);
          } else {
            log.warn('[DEVICE-AUTH] Register ditolak:', json?.message);
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.on('error', (err) => { log.warn('[DEVICE-AUTH] Error:', err.message); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Pastikan ada token valid; kalau belum atau ditolak server, register ulang
async function ensureClientToken(serverUrl) {
  const stored = getStoredClientToken();
  if (stored) return stored;
  return await requestDeviceToken(serverUrl);
}

let mainWindow;
let focusRecoveryTimer = null;
let aggressiveFocusInterval = null;
let screenShareTimer   = null;
let screenCaptureInFlight = false;
let lockModeEnabled = true;

// ── Windows Keyboard Hook (blokir Alt+Tab di level OS) ────────────────────────────────
let kbHookProcess = null;
let kbHookFlagPath = null;
let kbHookReady = false;
let kbHookReadyTimer = null;
let kbHookRestartTimer = null;

function clearKeyboardHookTimers() {
  if (kbHookReadyTimer) {
    clearTimeout(kbHookReadyTimer);
    kbHookReadyTimer = null;
  }
  if (kbHookRestartTimer) {
    clearTimeout(kbHookRestartTimer);
    kbHookRestartTimer = null;
  }
}

function scheduleKeyboardHookRestart(reason) {
  if (allowAppQuit || !isKioskLocked() || kbHookRestartTimer) return;
  log.warn(`[KIOSK] Menjadwalkan ulang keyboard hook: ${reason}`);
  kbHookRestartTimer = setTimeout(() => {
    kbHookRestartTimer = null;
    startKeyboardHook();
  }, 1000);
}

function startKeyboardHook() {
  if (process.platform !== 'win32') return;
  if (kbHookProcess) return;

  try {
    const ps1Path = app.isPackaged
      ? path.join(process.resourcesPath, 'electron', 'blockAltTab.ps1')
      : path.join(__dirname, 'blockAltTab.ps1');

    if (!fs.existsSync(ps1Path)) {
      log.error('[KIOSK] blockAltTab.ps1 tidak ditemukan di:', ps1Path);
      scheduleKeyboardHookRestart('script-tidak-ditemukan');
      return;
    }

    kbHookFlagPath = path.join(app.getPath('userData'), 'kbhook-stop.flag');
    try { if (fs.existsSync(kbHookFlagPath)) fs.unlinkSync(kbHookFlagPath); } catch {}

    kbHookReady = false;
    const hookProcess = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path,
      '-FlagFile', kbHookFlagPath,
      '-ElectronPID', String(process.pid),
    ], {
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    kbHookProcess = hookProcess;

    hookProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      if (!message) return;
      log.info('[KBHOOK stdout]', message);
      if (message.includes('Hook terpasang berhasil')) {
        kbHookReady = true;
        if (kbHookReadyTimer) {
          clearTimeout(kbHookReadyTimer);
          kbHookReadyTimer = null;
        }
      }
    });
    hookProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      if (message) log.warn('[KBHOOK stderr]', message);
    });

    hookProcess.on('exit', (code) => {
      if (kbHookProcess === hookProcess) kbHookProcess = null;
      kbHookReady = false;
      if (kbHookReadyTimer) {
        clearTimeout(kbHookReadyTimer);
        kbHookReadyTimer = null;
      }
      log.info('[KIOSK] Keyboard hook process keluar, kode:', code);
      scheduleKeyboardHookRestart(`process-exit-${code}`);
    });

    hookProcess.on('error', (err) => {
      if (kbHookProcess === hookProcess) kbHookProcess = null;
      kbHookReady = false;
      log.error('[KIOSK] Gagal menjalankan keyboard hook:', err.message);
      scheduleKeyboardHookRestart('spawn-error');
    });

    kbHookReadyTimer = setTimeout(() => {
      kbHookReadyTimer = null;
      if (kbHookProcess !== hookProcess || kbHookReady || !isKioskLocked()) return;
      log.error('[KIOSK] Keyboard hook tidak siap dalam 5 detik; proses akan dimulai ulang.');
      kbHookProcess = null;
      try { hookProcess.kill(); } catch {}
      scheduleKeyboardHookRestart('ready-timeout');
    }, 5000);

    log.info('[KIOSK] Memulai Windows keyboard hook (PID:', hookProcess.pid, '), script:', ps1Path);
  } catch (err) {
    kbHookProcess = null;
    kbHookReady = false;
    log.error('[KIOSK] Error saat memulai keyboard hook:', err.message);
    scheduleKeyboardHookRestart('start-exception');
  }
}

function stopKeyboardHook() {
  if (process.platform !== 'win32') return;

  clearKeyboardHookTimers();
  kbHookReady = false;

  if (kbHookFlagPath) {
    try { fs.writeFileSync(kbHookFlagPath, 'stop', 'utf-8'); } catch {}
  }

  const hookProcess = kbHookProcess;
  kbHookProcess = null;
  if (hookProcess) {
    setTimeout(() => {
      if (!hookProcess.killed) {
        try { hookProcess.kill(); } catch {}
      }
    }, 1000);
  }

  log.info('[KIOSK] Windows keyboard hook dihentikan');
}
// ── Windows Taskbar Hide/Show (sembunyikan taskbar saat lock) ────────────────────────────────
let taskbarHideScript = null;

function getTaskbarScriptPath() {
  if (taskbarHideScript) return taskbarHideScript;
  const scriptDir = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'resources', 'electron')
    : __dirname;
  taskbarHideScript = path.join(app.getPath('userData'), 'taskbar-ctl.ps1');
  // Tulis script sekali
  const ps1 = `
param([string]$Action = "hide")
Add-Type -Name TBCtl -Namespace Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string wnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
'@
$sw = if ($Action -eq "show") { 5 } else { 0 }
$h = [Win32.TBCtl]::FindWindow("Shell_TrayWnd","")
if ($h -ne [IntPtr]::Zero) { [Win32.TBCtl]::ShowWindow($h, $sw) | Out-Null }
$h2 = [Win32.TBCtl]::FindWindow("Shell_SecondaryTrayWnd","")
if ($h2 -ne [IntPtr]::Zero) { [Win32.TBCtl]::ShowWindow($h2, $sw) | Out-Null }
`;
  try { fs.writeFileSync(taskbarHideScript, ps1, 'utf-8'); } catch {}
  return taskbarHideScript;
}

function hideTaskbar() {
  if (process.platform !== 'win32') return;
  try {
    const script = getTaskbarScriptPath();
    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'hide'
    ], { detached: true, stdio: 'ignore' });
  } catch {}
  log.info('[KIOSK] Taskbar disembunyikan');
}

function showTaskbar() {
  if (process.platform !== 'win32') return;
  try {
    const script = getTaskbarScriptPath();
    execSync(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -Action show`, { timeout: 5000 });
  } catch {}
  log.info('[KIOSK] Taskbar ditampilkan kembali');
}
const screenShareState = {
  active:      false,
  lastErrorAt: 0,
  serverUrl:   null,
  studentName: null,
  pcName:      os.hostname(),
};

//  Activity Monitor Instance
let activityMonitor = null;
let activeSessionId = null;
const CAPTURE_PROFILES = {
  overview: {
    mode: 'overview',
    width: 480,
    height: 270,
    jpegQuality: 40,
    intervalMs: 1000,
  },
  focus: {
    mode: 'focus',
    width: 1280,
    height: 720,
    jpegQuality: 65,
    intervalMs: 450,
  },
};
let captureProfileMode = 'overview';

// ── Ukuran widget per mode ───────────────────────────────────────
const SIZES = {
  minimized:  { width: 300, height: 72  },
  regular:    { width: 340, height: 430 },
  expanded:   { width: 400, height: 560 },
  checklist:  { width: 780, height: 840 },  // Untuk form checklist pre/post sesi
};

function getTopRight(w, h) {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  return { x: sw - w - 20, y: 20 };
}

function getCenter(w, h) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  return { x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2) };
}

function isKioskLocked() {
  // Gunakan state yang diinginkan, bukan state window sesaat. Saat Alt+Tab atau
  // shell Windows memaksa keluar fullscreen, isFullScreen() dapat sempat false.
  return Boolean(lockModeEnabled && mainWindow && !mainWindow.isDestroyed());
}

function keepWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    // Set always on top dengan level tertinggi
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (isKioskLocked()) {
      // Mode kiosk: super aggressive focus recovery
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();

      // Force focus dengan teknik ganda
      if (process.platform === 'win32') {
        mainWindow.blur();
        mainWindow.focus();

        // Tambahan: set level always on top lebih tinggi
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      }
      return;
    }

    // Mode widget: recovery normal
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (typeof mainWindow.showInactive === 'function') {
      mainWindow.showInactive();
    } else {
      mainWindow.show();
    }
    mainWindow.moveTop();
  } catch (_) {}
}

function scheduleFocusRecovery(delay = 50) {
  if (focusRecoveryTimer) clearTimeout(focusRecoveryTimer);
  focusRecoveryTimer = setTimeout(() => {
    focusRecoveryTimer = null;
    keepWindowVisible();
  }, delay);
}

function preventUnexpectedQuit(event) {
  if (allowAppQuit) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  log.warn('[APP] Quit dicegah karena tidak berasal dari jalur resmi.');
  scheduleFocusRecovery(0);
}

function requestControlledQuit(reason) {
  allowAppQuit = true;
  log.info(`[APP] Controlled quit: ${reason}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(true);
    mainWindow.setKiosk(false);
  }
  stopAggressiveFocusLoop();
  stopKeyboardHook();
  showTaskbar(); // Selalu pulihkan taskbar saat quit
  globalShortcut.unregisterAll();
  Promise.race([
    restoreSystemProxy().catch(() => false),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]).finally(() => app.quit());
}

function startAggressiveFocusLoop() {
  if (aggressiveFocusInterval) return;

  // Loop yang terus-menerus memaksa window tetap di depan saat lock mode
  // Interval 50ms: sangat agresif agar user tidak sempat lihat jendela lain
  aggressiveFocusInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (isKioskLocked()) {
      // Pastikan window selalu di depan dan fullscreen
      if (!mainWindow.isFocused()) {
        keepWindowVisible();
      }
      // Pastikan kiosk dan fullscreen tetap aktif
      if (!mainWindow.isKiosk()) mainWindow.setKiosk(true);
      if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
    }
  }, 50); // Setiap 50ms cek dan pulihkan fokus

  log.info('[KIOSK] Aggressive focus loop dimulai');
}

function stopAggressiveFocusLoop() {
  if (!aggressiveFocusInterval) return;

  clearInterval(aggressiveFocusInterval);
  aggressiveFocusInterval = null;
  log.info('[KIOSK] Aggressive focus loop dihentikan');
}

let currentLayoutMode = 'login';
let attentionModeOn = false;
let preAttentionLayoutMode = null;

function applyWindowLayout(mode = 'regular') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  currentLayoutMode = mode;

  const isLoginLayout = mode === 'login';
  lockModeEnabled = isLoginLayout;
  mainWindow.setResizable(true);

  if (isLoginLayout) {
    mainWindow.setBounds(screen.getPrimaryDisplay().bounds, true);
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);

    // Mulai aggressive focus loop dan keyboard hook untuk mode lock
    startAggressiveFocusLoop();
    startKeyboardHook();
    hideTaskbar();
  } else {
    const size = SIZES[mode] || SIZES.regular;
    const { x, y } = mode === 'checklist'
      ? getCenter(size.width, size.height)
      : getTopRight(size.width, size.height);

    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setBounds({ x, y, width: size.width, height: size.height }, true);

    // Hentikan aggressive focus loop dan keyboard hook untuk mode widget
    stopAggressiveFocusLoop();
    stopKeyboardHook();
    showTaskbar();
  }

  mainWindow.setResizable(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setSkipTaskbar(true);
  keepWindowVisible();
}

function logScreenWarning(message) {
  const now = Date.now();
  if (now - screenShareState.lastErrorAt < 15000) return;
  screenShareState.lastErrorAt = now;
  log.warn(message);
}

function getCaptureProfile() {
  return CAPTURE_PROFILES[captureProfileMode] || CAPTURE_PROFILES.overview;
}

function restartScreenShareLoop() {
  if (!screenShareState.active) return;

  if (screenShareTimer) {
    clearInterval(screenShareTimer);
    screenShareTimer = null;
  }

  const profile = getCaptureProfile();
  screenShareTimer = setInterval(() => {
    postScreenshot();
  }, profile.intervalMs);
}

function applyCaptureProfile(mode = 'overview') {
  const nextMode = CAPTURE_PROFILES[mode] ? mode : 'overview';
  if (captureProfileMode === nextMode) return;

  captureProfileMode = nextMode;
  log.info(`[SCREEN] Capture profile -> ${nextMode}`);
  restartScreenShareLoop();

  if (screenShareState.active) {
    postScreenshot();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // ── Kiosk & tampilan ─────────────────────────────────────────
    kiosk:          true,   // Full screen mutlak, tutupi taskbar
    fullscreen:     true,
    alwaysOnTop:    true,
    frame:          false,  // Hapus title bar / window border
    transparent:    true,   // Background OS transparan →’ widget melayang
    skipTaskbar:    true,   // Sembunyikan dari taskbar Windows
    movable:        false,
    autoHideMenuBar:true,
    hasShadow:      true,

    // ── Nonaktifkan close akibat tombol ───────────────────────────
    closable:       false,
    minimizable:    false,
    maximizable:    false,
    resizable:      false,

    // ── Keamanan Electron ────────────────────────────────────────
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      devTools:          allowDevTools,
      spellcheck:        false,
    },
  });
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // ── Load URL ─────────────────────────────────────────────────
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    if (allowDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ── Cegah navigasi keluar ─────────────────────────────────────
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('file://')) {
      e.preventDefault();
    }
  });

  // ── Cegah buka jendela baru ───────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // ── Blokir Alt+F4 dan shortcut berbahaya di level webContents ────────────────────────────────
  // globalShortcut TIDAK bisa menangkap Alt+F4 saat window fokus di Windows.
  // before-input-event menangkap keystroke SEBELUM Chromium/OS memprosesnya.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (allowAppQuit) return;

    const alt  = input.alt;
    const ctrl = input.control;
    const meta = input.meta;
    const key  = (input.key || '').toLowerCase();

    // Blokir Alt+F4
    if (alt && key === 'f4') { event.preventDefault(); return; }
    // Blokir Ctrl+W (close tab/window)
    if (ctrl && key === 'w') { event.preventDefault(); return; }
    // Blokir Ctrl+F4
    if (ctrl && key === 'f4') { event.preventDefault(); return; }
    // Blokir Ctrl+Shift+Esc (Task Manager)
    if (ctrl && input.shift && key === 'escape') { event.preventDefault(); return; }
    // Blokir F11 (toggle fullscreen)
    if (!ctrl && !alt && key === 'f11') { event.preventDefault(); return; }
    // Blokir Alt+Esc
    if (alt && key === 'escape') { event.preventDefault(); return; }
    // Blokir Win key combinations
    if (meta) { event.preventDefault(); return; }
  });

  mainWindow.on('close', (event) => {
    if (allowAppQuit) return;
    event.preventDefault();
    // Paksa tampil kembali
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    scheduleFocusRecovery(0);
  });

  // Low-level hook memblokir shortcut sistem; recovery fokus ini menjadi fallback
  // jika Windows sempat memindahkan fokus atau shell dimulai ulang.
  mainWindow.on('blur', () => {
    if (isKioskLocked()) {
      // Mode login: recovery sangat agresif
      scheduleFocusRecovery(10);
    } else {
      // Mode widget: masih perlu recovery tapi lebih lembut
      scheduleFocusRecovery(30);
    }
  });
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    scheduleFocusRecovery(5);
  });
  mainWindow.on('hide', () => scheduleFocusRecovery(5));
  mainWindow.on('restore', () => scheduleFocusRecovery(10));
  mainWindow.on('leave-full-screen', () => {
    if (isKioskLocked()) {
      scheduleFocusRecovery(0);
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
    }
  });
  mainWindow.on('show', () => {
    if (isKioskLocked()) keepWindowVisible();
  });
  mainWindow.on('focus', () => {
    if (isKioskLocked()) {
      mainWindow.setKiosk(true);
      mainWindow.setFullScreen(true);
    }
  });
  // Cegah unfocus via Alt+Tab dengan aggressive recovery
  mainWindow.on('will-resize', (event) => {
    if (isKioskLocked()) event.preventDefault();
  });
  mainWindow.on('move', (event) => {
    if (isKioskLocked()) event.preventDefault();
  });
  // Start keyboard hook immediately on launch (kiosk starts in login mode)
  startAggressiveFocusLoop();
  startKeyboardHook();
  hideTaskbar();

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('[WINDOW] render-process-gone:', details);
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else mainWindow.reload();
    }, 1000);
  });
  mainWindow.webContents.on('unresponsive', () => {
    log.warn('[WINDOW] Renderer unresponsive, mencoba reload.');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 1500);
  });
}

// ── IPC: Kirim hostname PC ke renderer ───────────────────────────
ipcMain.handle('get-pc-name', () => os.hostname());
ipcMain.handle('get-control-policy', () => latestControlPolicy);

function sanitizeReceivedFileName(value) {
  const base = path.basename(String(value || '').trim());
  const safe = base
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return safe || 'file-kelas';
}

ipcMain.handle('save-received-file', async (_event, payload = {}) => {
  try {
    const match = String(payload.data || '').match(/^data:[^;,]{1,120};base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { success: false, message: 'Format file tidak valid.' };

    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > 1024 * 1024) {
      return { success: false, message: 'File kosong atau melebihi 1 MB.' };
    }

    const destinationDir = path.join(app.getPath('downloads'), 'LabKom');
    fs.mkdirSync(destinationDir, { recursive: true });

    const fileName = sanitizeReceivedFileName(payload.name);
    const parsed = path.parse(fileName);
    let destination = path.join(destinationDir, fileName);
    let suffix = 1;
    while (fs.existsSync(destination)) {
      destination = path.join(destinationDir, `${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    }

    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    return { success: true, file_name: path.basename(destination), path: destination, size: bytes.length };
  } catch (error) {
    log.warn('[FILE] Gagal menyimpan file kelas:', error.message);
    return { success: false, message: 'File tidak dapat disimpan.' };
  }
});

ipcMain.handle('show-received-file', async (_event, candidatePath) => {
  try {
    const allowedRoot = path.resolve(app.getPath('downloads'), 'LabKom');
    const resolved = path.resolve(String(candidatePath || ''));
    if (!resolved.startsWith(allowedRoot + path.sep) || !fs.existsSync(resolved)) return false;
    shell.showItemInFolder(resolved);
    return true;
  } catch {
    return false;
  }
});

// ── IPC: Token device untuk socket renderer ────────────────────────────────
ipcMain.handle('get-client-token', async () => {
  const cfg = loadServerConfig();
  return await ensureClientToken(cfg.serverUrl);
});

// ── IPC: Verifikasi emergency password (offline exit) ────────────────────────────────
ipcMain.handle('verify-emergency-password', (_event, password) => {
  return verifyEmergencyPassword(password);
});

// ── IPC: Baca / Simpan konfigurasi URL server ────────────────────
ipcMain.handle('get-server-url', () => {
  const cfg = loadServerConfig();
  return cfg.serverUrl || null;
});
ipcMain.on('save-server-url', (_event, url) => {
  if (!isAllowedLabServerUrl(url)) return;
  const cfg = loadServerConfig();
  cfg.serverUrl = url;
  saveServerConfig(cfg);

  connectRealtime(url);
  startPresenceHeartbeat();

  if (screenShareState.active) {
    screenShareState.serverUrl = url;
    postScreenshot();
  }
});

ipcMain.handle('get-client-settings', () => {
  const cfg = loadServerConfig();
  return {
    ...clientSettings,
    serverUrl: cfg.serverUrl || '',
    appVersion: app.getVersion(),
    updateStatus: latestUpdateStatus,
    isPackaged: app.isPackaged,
  };
});

ipcMain.handle('save-client-settings', async (_event, payload = {}) => {
  const nextServerUrl = String(payload.serverUrl || '').trim().replace(/\/$/, '');
  if (nextServerUrl && !isAllowedLabServerUrl(nextServerUrl)) {
    return { success: false, message: 'Alamat server harus menggunakan HTTP dan IP jaringan lokal.' };
  }

  const previousConfig = loadServerConfig();
  if (nextServerUrl && nextServerUrl !== previousConfig.serverUrl) {
    saveServerConfig({ ...previousConfig, serverUrl: nextServerUrl });
    setStoredClientToken(null);
    connectRealtime(nextServerUrl);
    startPresenceHeartbeat();
  }

  try {
    const saved = saveClientSettings(payload);
    applyClientSettings(saved);
    scheduleUpdateChecks();
    if (!isDev && saved.autoUpdate) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 1000);
    }
    return {
      success: true,
      settings: {
        ...saved,
        serverUrl: nextServerUrl || previousConfig.serverUrl || '',
        appVersion: app.getVersion(),
        updateStatus: latestUpdateStatus,
        isPackaged: app.isPackaged,
      },
    };
  } catch (error) {
    log.warn('[SETTINGS] Gagal menyimpan pengaturan client:', error.message);
    return { success: false, message: 'Pengaturan tidak dapat disimpan.' };
  }
});

ipcMain.handle('check-client-update', async () => {
  if (isDev) {
    const status = { state: 'dev', message: 'Pemeriksaan update hanya aktif pada aplikasi yang sudah diinstal.' };
    sendClientUpdateStatus(status);
    return { success: false, ...status };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    sendClientUpdateStatus({ state: 'error', message: error.message });
    return { success: false, message: error.message };
  }
});

ipcMain.handle('download-client-update', async () => {
  if (isDev) return { success: false, message: 'Download update hanya aktif pada aplikasi terinstal.' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    sendClientUpdateStatus({ state: 'error', message: error.message });
    return { success: false, message: error.message };
  }
});

ipcMain.on('install-client-update', () => {
  if (!isDev && latestUpdateStatus.state === 'downloaded') {
    allowAppQuit = true;
    autoUpdater.quitAndInstall(false, true);
  }
});

function getPresencePayload() {
  const { mac, ip } = getFirstMac();
  return {
    pc_name: screenShareState.pcName,
    mac: mac || null,
    ip: ip || null,
    student_name: screenShareState.studentName || null,
  };
}

const PROXY_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const executedCommandIds = new Set();

function normalizeClientPolicy(input = {}) {
  const toBool = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
    if (value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
    return fallback;
  };
  const domains = (value) => {
    let list = value;
    if (!Array.isArray(list)) {
      try { list = JSON.parse(String(value || '[]')); }
      catch { list = String(value || '').split(/[\n,]/); }
    }
    return [...new Set((Array.isArray(list) ? list : []).map((entry) => {
      let candidate = String(entry || '').trim().toLowerCase().replace(/^\*\./, '');
      if (!candidate) return null;
      try {
        candidate = new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname.toLowerCase();
      } catch { return null; }
      return candidate;
    }).filter(Boolean))].slice(0, 100);
  };

  const volume = Number(input.master_volume);
  return {
    master_volume: Number.isFinite(volume) ? Math.max(0, Math.min(100, Math.round(volume))) : 75,
    master_muted: toBool(input.master_muted),
    web_filter_enabled: toBool(input.web_filter_enabled),
    web_filter_mode: input.web_filter_mode === 'whitelist' ? 'whitelist' : 'blacklist',
    whitelist: domains(input.whitelist),
    blacklist: domains(input.blacklist),
    wallpaper_url: /^https?:\/\//i.test(String(input.wallpaper_url || '').trim()) ? String(input.wallpaper_url).trim() : '',
    wallpaper_target: ['login', 'desktop', 'both'].includes(input.wallpaper_target) ? input.wallpaper_target : 'both',
  };
}

function runHiddenProcess(file, args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });
    }
    child.on('error', (error) => resolve({ success: false, stdout, stderr: error.message }));
    child.on('exit', (code) => resolve({ success: code === 0, code, stdout, stderr }));
  });
}

function proxyBackupPath() {
  return path.join(app.getPath('userData'), 'proxy-backup.json');
}

async function queryRegistryValue(name) {
  const result = await runHiddenProcess('reg.exe', ['query', PROXY_REGISTRY_KEY, '/v', name], { capture: true });
  if (!result.success) return null;
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.trim().startsWith(name));
  if (!line) return null;
  const parts = line.trim().split(/\s{2,}/);
  if (parts.length < 3) return null;
  return { type: parts[1], value: parts.slice(2).join('  ') };
}

async function backupSystemProxy() {
  const destination = proxyBackupPath();
  if (fs.existsSync(destination)) return;
  const backup = {
    ProxyEnable: await queryRegistryValue('ProxyEnable'),
    ProxyServer: await queryRegistryValue('ProxyServer'),
    ProxyOverride: await queryRegistryValue('ProxyOverride'),
  };
  fs.writeFileSync(destination, JSON.stringify(backup, null, 2), 'utf-8');
}

async function setRegistryValue(name, type, value) {
  return runHiddenProcess('reg.exe', ['add', PROXY_REGISTRY_KEY, '/v', name, '/t', type, '/d', String(value), '/f']);
}

async function applySystemProxy(port) {
  if (process.platform !== 'win32') return false;
  await backupSystemProxy();
  const proxy = `http=127.0.0.1:${port};https=127.0.0.1:${port}`;
  const bypass = '<local>;localhost;127.*;10.*;192.168.*;172.*';
  const results = await Promise.all([
    setRegistryValue('ProxyEnable', 'REG_DWORD', '1'),
    setRegistryValue('ProxyServer', 'REG_SZ', proxy),
    setRegistryValue('ProxyOverride', 'REG_SZ', bypass),
  ]);
  return results.every((item) => item.success);
}

async function restoreSystemProxy() {
  if (process.platform !== 'win32') return true;
  const source = proxyBackupPath();
  if (!fs.existsSync(source)) {
    if (policyProxyServer) {
      await new Promise((resolve) => policyProxyServer.close(() => resolve()));
      policyProxyServer = null;
      policyProxyPort = null;
    }
    return true;
  }

  let backup;
  try { backup = JSON.parse(fs.readFileSync(source, 'utf-8')); }
  catch { return false; }

  const results = [];
  for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) {
    const entry = backup[name];
    if (entry?.type && entry.value !== undefined) {
      results.push(await setRegistryValue(name, entry.type, entry.value));
    } else {
      results.push(await runHiddenProcess('reg.exe', ['delete', PROXY_REGISTRY_KEY, '/v', name, '/f']));
    }
  }
  try { fs.unlinkSync(source); } catch {}
  if (policyProxyServer) {
    await new Promise((resolve) => policyProxyServer.close(() => resolve()));
    policyProxyServer = null;
    policyProxyPort = null;
  }
  return results.every((item) => item.success || item.code === 1);
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  const match172 = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31);
}

function domainMatches(hostname, rule) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const domain = String(rule || '').toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return Boolean(domain && (host === domain || host.endsWith(`.${domain}`)));
}

function shouldBlockHost(hostname) {
  if (isPrivateOrLocalHost(hostname)) return false;
  const policy = latestControlPolicy || normalizeClientPolicy();
  if (!policy.web_filter_enabled) return false;
  if (policy.web_filter_mode === 'whitelist') {
    return !policy.whitelist.some((rule) => domainMatches(hostname, rule));
  }
  return policy.blacklist.some((rule) => domainMatches(hostname, rule));
}

function reportBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return;
  const now = Date.now();
  const lastReported = recentlyReportedBlockedHosts.get(host) || 0;
  if (now - lastReported < 30_000) return;
  recentlyReportedBlockedHosts.set(host, now);

  const activity = {
    activity_type: 'browser_url',
    url: `https://${host}`,
    url_domain: host,
    page_title: 'Diblokir oleh kebijakan LabKom',
    blocked: true,
    session_id: activeSessionId || null,
    activity_at: new Date(now).toISOString(),
  };
  if (realtimeSocket?.connected) realtimeSocket.emit('client:activity', activity);
  else postActivityToServer(loadServerConfig().serverUrl, activity);
}

function sendProxyBlocked(res, hostname) {
  const body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>Akses diblokir</title><style>body{font-family:Segoe UI,sans-serif;background:#0f172a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:40px;text-align:center}h1{color:#fbbf24}</style><main><h1>Akses diblokir</h1><p>${String(hostname || 'Situs ini').replace(/[<>&]/g, '')} dibatasi oleh kebijakan Lab Komputer.</p></main>`);
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

async function ensurePolicyProxy() {
  if (policyProxyServer && policyProxyPort) return policyProxyPort;
  policyProxyServer = http.createServer((req, res) => {
    let target;
    try { target = new URL(req.url); }
    catch {
      res.writeHead(400);
      res.end('Permintaan proxy tidak valid.');
      return;
    }
    if (shouldBlockHost(target.hostname)) {
      reportBlockedHost(target.hostname);
      sendProxyBlocked(res, target.hostname);
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    const transport = target.protocol === 'https:' ? https : http;
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Situs tidak dapat dijangkau.');
    });
    req.pipe(upstream);
  });

  policyProxyServer.on('connect', (req, clientSocket, head) => {
    let parsed;
    try { parsed = new URL(`http://${req.url}`); }
    catch { clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (shouldBlockHost(parsed.hostname)) {
      reportBlockedHost(parsed.hostname);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nAkses diblokir oleh kebijakan Lab Komputer.');
      return;
    }
    const upstream = net.connect(Number(parsed.port) || 443, parsed.hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });

  policyProxyServer.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((resolve, reject) => {
    policyProxyServer.once('error', reject);
    policyProxyServer.listen(0, '127.0.0.1', () => resolve());
  });
  policyProxyPort = policyProxyServer.address().port;
  return policyProxyPort;
}

function writeVolumePolicyScript() {
  const destination = path.join(app.getPath('userData'), 'labkom-volume.ps1');
  if (fs.existsSync(destination)) return destination;
  const script = String.raw`param([int]$Volume = 75, [bool]$Muted = $false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
enum EDataFlow { eRender, eCapture, eAll }
enum ERole { eConsole, eMultimedia, eCommunications }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify); int UnregisterControlChangeNotify(IntPtr pNotify); int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float level, Guid context); int SetMasterVolumeLevelScalar(float level, Guid context);
  int GetMasterVolumeLevel(out float level); int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float level, Guid context); int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
  int GetChannelVolumeLevel(uint channel, out float level); int GetChannelVolumeLevelScalar(uint channel, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context); int GetMute(out bool mute);
}
public static class LabKomAudio {
  static IAudioEndpointVolume Endpoint() {
    var enumerator = new MMDeviceEnumerator() as IMMDeviceEnumerator; IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID; object endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint)); return (IAudioEndpointVolume)endpoint;
  }
  public static void Apply(float volume, bool muted) { var endpoint = Endpoint(); var context = Guid.Empty; endpoint.SetMasterVolumeLevelScalar(volume, context); endpoint.SetMute(muted, context); }
}
'@
$level = [Math]::Max(0, [Math]::Min(100, $Volume)) / 100.0
[LabKomAudio]::Apply([single]$level, $Muted)`;
  fs.writeFileSync(destination, script, 'utf-8');
  return destination;
}

async function applySystemVolume(policy) {
  if (process.platform !== 'win32') return true;
  const script = writeVolumePolicyScript();
  const result = await runHiddenProcess('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Volume', String(policy.master_volume), '-Muted', String(policy.master_muted),
  ]);
  return result.success;
}

function downloadPolicyWallpaper(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('Terlalu banyak redirect wallpaper.'));
    let parsed;
    try { parsed = new URL(url); }
    catch { return reject(new Error('URL wallpaper tidak valid.')); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Protokol wallpaper tidak didukung.'));
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(parsed, { timeout: 10_000, headers: { 'User-Agent': 'LabKom-Siswa/1.0' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, parsed).toString();
        downloadPolicyWallpaper(nextUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Wallpaper HTTP ${response.statusCode}`));
        return;
      }
      const contentType = String(response.headers['content-type'] || '').toLowerCase();
      const extension = contentType.includes('png') ? '.png' : contentType.includes('bmp') ? '.bmp' : '.jpg';
      const destination = path.join(app.getPath('userData'), `policy-wallpaper${extension}`);
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) request.destroy(new Error('Wallpaper melebihi 10 MB.'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (!size) return reject(new Error('Wallpaper kosong.'));
        fs.writeFileSync(destination, Buffer.concat(chunks));
        resolve(destination);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Unduhan wallpaper timeout.')));
    request.on('error', reject);
  });
}

async function applyDesktopWallpaper(policy) {
  if (process.platform !== 'win32' || !policy.wallpaper_url || !['desktop', 'both'].includes(policy.wallpaper_target)) return true;
  const wallpaperPath = await downloadPolicyWallpaper(policy.wallpaper_url);
  const scriptPath = path.join(app.getPath('userData'), 'labkom-wallpaper.ps1');
  const script = String.raw`param([string]$ImagePath)
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value '10'
Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name TileWallpaper -Value '0'
Add-Type -Name NativeMethods -Namespace LabKom -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern int SystemParametersInfo(int action, int param, string value, int flags);'
[LabKom.NativeMethods]::SystemParametersInfo(20, 0, $ImagePath, 3) | Out-Null`;
  fs.writeFileSync(scriptPath, script, 'utf-8');
  const result = await runHiddenProcess('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath, '-ImagePath', wallpaperPath,
  ]);
  return result.success;
}

async function applyWebFilter(policy) {
  if (process.platform !== 'win32') return true;
  if (!policy.web_filter_enabled) return restoreSystemProxy();
  const port = await ensurePolicyProxy();
  return applySystemProxy(port);
}

async function applyControlPolicy(policy) {
  const normalized = normalizeClientPolicy(policy);
  latestControlPolicy = normalized;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('control-settings', normalized);
  }
  const [volume, wallpaper, webFilter] = await Promise.all([
    applySystemVolume(normalized).catch(() => false),
    applyDesktopWallpaper(normalized).catch(() => false),
    applyWebFilter(normalized).catch(() => false),
  ]);
  realtimeSocket?.emit('client:policy-status', {
    volume,
    wallpaper,
    web_filter: webFilter,
    message: [volume && 'volume', wallpaper && 'wallpaper', webFilter && 'web filter'].filter(Boolean).join(', '),
  });
  return { volume, wallpaper, web_filter: webFilter };
}

function executeSystemCommand(payload = {}) {
  const command = String(payload.command || '').toLowerCase();
  const commandId = String(payload.id || '').trim();
  const allowed = new Set(['lock', 'sleep', 'restart', 'shutdown']);
  if (!allowed.has(command) || !/^cmd_[A-Za-z0-9_-]{8,80}$/.test(commandId)) return;
  if (executedCommandIds.has(commandId)) return;
  executedCommandIds.add(commandId);
  if (executedCommandIds.size > 100) executedCommandIds.delete(executedCommandIds.values().next().value);

  const acknowledge = (success, message) => realtimeSocket?.emit('client:system-command-ack', {
    command_id: commandId,
    command,
    success,
    message,
  });
  if (process.platform !== 'win32') {
    acknowledge(false, 'Perintah daya hanya tersedia pada Windows.');
    return;
  }

  acknowledge(true, 'Perintah diterima oleh client.');
  if (command === 'lock') {
    spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  } else if (command === 'sleep') {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)"], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  } else if (command === 'restart') {
    spawn('shutdown.exe', ['/r', '/t', '15', '/c', 'Restart dijadwalkan oleh LabKom Admin.'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  } else if (command === 'shutdown') {
    spawn('shutdown.exe', ['/s', '/t', '15', '/c', 'Shutdown dijadwalkan oleh LabKom Admin.'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  }
}

async function connectRealtime(serverUrl) {
  if (!serverUrl) return;

  try {
    const nextOrigin = new URL(serverUrl).origin;
    if (realtimeSocket && realtimeSocket.io?.uri === nextOrigin) return;
    if (realtimeSocket) {
      realtimeSocket.removeAllListeners();
      realtimeSocket.disconnect();
      realtimeSocket = null;
    }

    const clientToken = await ensureClientToken(serverUrl);
    if (!clientToken) {
      logScreenWarning('[REALTIME] Tidak bisa register device ke server. Akan retry pada koneksi berikut.');
      return;
    }

    realtimeSocket = io(nextOrigin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 5000,
      auth: { role: 'client', client_token: clientToken, channel: 'main' },
    });

    realtimeSocket.on('connect', () => {
      const payload = getPresencePayload();
      realtimeSocket.emit('client:hello', payload);
      realtimeSocket.emit('client:heartbeat', payload);
      if (screenShareState.active) {
        postScreenshot();
      }
    });

    realtimeSocket.on('screen:quality', (payload = {}) => {
      const targetPcName = String(payload.pc_name || '').trim().toUpperCase();
      const currentPcName = String(screenShareState.pcName || '').trim().toUpperCase();
      if (targetPcName && currentPcName && targetPcName !== currentPcName) return;
      applyCaptureProfile(payload.mode || 'overview');
    });

    realtimeSocket.on('control:settings', (payload = {}) => {
      latestControlPolicy = normalizeClientPolicy(payload);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('control-settings', latestControlPolicy);
      }
      if (activeSessionId) {
        applyControlPolicy(latestControlPolicy).catch((error) => {
          log.warn('[POLICY] Gagal menerapkan kebijakan:', error.message);
        });
      }
    });

    realtimeSocket.on('system:command', (payload = {}) => {
      executeSystemCommand(payload);
    });

    realtimeSocket.on('disconnect', () => {
      applyCaptureProfile('overview');
    });

    realtimeSocket.on('connect_error', async (err) => {
      applyCaptureProfile('overview');
      logScreenWarning(`[REALTIME] Gagal terhubung ke server realtime: ${err.message}`);
      // Jika unauthorized → token mungkin expired/revoked. Hapus & register ulang.
      if (String(err.message || '').toLowerCase().includes('unauthorized')) {
        log.warn('[DEVICE-AUTH] Token ditolak server, register ulang...');
        setStoredClientToken(null);
        const fresh = await requestDeviceToken(serverUrl);
        if (fresh && realtimeSocket) {
          realtimeSocket.auth = { role: 'client', client_token: fresh, channel: 'main' };
        }
      }
    });
  } catch (err) {
    logScreenWarning(`[REALTIME] Konfigurasi server realtime tidak valid: ${err.message}`);
  }
}

function disconnectRealtime() {
  if (!realtimeSocket) return;
  realtimeSocket.removeAllListeners();
  realtimeSocket.disconnect();
  realtimeSocket = null;
}

function startPresenceHeartbeat() {
  if (presenceHeartbeatTimer) return;

  const tick = () => {
    registerMacToServer();
    if (realtimeSocket?.connected) {
      realtimeSocket.emit('client:heartbeat', getPresencePayload());
    }
  };

  tick();
  presenceHeartbeatTimer = setInterval(tick, 10000);
}

function stopPresenceHeartbeat() {
  if (!presenceHeartbeatTimer) return;
  clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = null;
}

// ── Screen sharing: capture & upload ke server ───────────────────────────
function postScreenshot() {
  if (!screenShareState.active || !screenShareState.serverUrl || screenCaptureInFlight) return;
  screenCaptureInFlight = true;
  const profile = getCaptureProfile();

  desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: profile.width, height: profile.height },
  }).then((sources) => {
    if (!sources.length) return;
    const primaryDisplayId = String(screen.getPrimaryDisplay().id);
    const selectedSource = sources.find((source) => String(source.display_id) === primaryDisplayId) || sources[0];
    if (!selectedSource?.thumbnail || selectedSource.thumbnail.isEmpty()) return;

    const jpegBuf = selectedSource.thumbnail.toJPEG(profile.jpegQuality);
    const b64     = jpegBuf.toString('base64');
    const payload = {
      pc_name:      screenShareState.pcName,
      student_name: screenShareState.studentName || null,
      image:        `data:image/jpeg;base64,${b64}`,
    };
    const body    = JSON.stringify(payload);

    if (realtimeSocket?.connected) {
      realtimeSocket.emit('client:screen', payload);
      return;
    }

    try {
      const parsed = new URL(`${screenShareState.serverUrl}/api/screens`);
      const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
      const tok = getStoredClientToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const req    = http.request({
        hostname: parsed.hostname,
        port:     parseInt(parsed.port) || 3001,
        path:     '/api/screens',
        method:   'POST',
        headers,
      }, (res) => {
        res.resume();
      });
      req.on('error', (err) => {
        logScreenWarning(`[SCREEN] Gagal kirim screenshot: ${err.message}`);
      });
      req.setTimeout(3000, () => req.destroy());
      req.write(body);
      req.end();
    } catch (_) {}
  }).catch((err) => {
    logScreenWarning(`[SCREEN] Gagal capture layar: ${err.message}`);
  }).finally(() => {
    screenCaptureInFlight = false;
  });
}

function startScreenShare(serverUrl, studentName) {
  screenShareState.active = true;
  screenShareState.serverUrl = serverUrl;
  screenShareState.studentName = studentName || null;
  captureProfileMode = 'overview';
  connectRealtime(serverUrl);

  restartScreenShareLoop();
  postScreenshot();
}

function stopScreenShare() {
  const activeServerUrl = screenShareState.serverUrl;
  screenShareState.active = false;
  screenShareState.studentName = null;
  screenShareState.serverUrl = null;

  if (screenShareTimer) {
    clearInterval(screenShareTimer);
    screenShareTimer = null;
  }
  screenCaptureInFlight = false;
  captureProfileMode = 'overview';

  if (realtimeSocket?.connected) {
    realtimeSocket.emit('client:screen-stop', {
      pc_name: screenShareState.pcName,
    });
    realtimeSocket.emit('client:heartbeat', getPresencePayload());
  }

  // Hapus screenshot dari server saat logout
  try {
    const resolvedServerUrl = activeServerUrl || loadServerConfig().serverUrl;
    if (!resolvedServerUrl) return;
    const parsed = new URL(`${resolvedServerUrl}/api/screens/${encodeURIComponent(screenShareState.pcName)}`);
    const headers = { 'Content-Type': 'application/json' };
    const tok = getStoredClientToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const req  = http.request({
      hostname: parsed.hostname, port: parseInt(parsed.port) || 3001,
      path:     parsed.pathname, method: 'DELETE',
      headers,
    }, () => {});
    req.on('error', () => {});
    req.end();
  } catch (_) {}
}

function postActivityToServer(serverUrl, activity) {
  if (!serverUrl || !activity) return;

  const body = JSON.stringify(activity);
  try {
    const parsed = new URL(`${serverUrl}/api/activities`);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    const tok = getStoredClientToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const req = http.request({
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 3001,
      path: '/api/activities',
      method: 'POST',
      headers,
    }, (res) => {
      res.resume();
    });
    req.on('error', (err) => {
      log.warn('[ACTIVITY] Gagal kirim activity via HTTP:', err.message);
    });
    req.setTimeout(5000, () => req.destroy());
    req.write(body);
    req.end();
  } catch (err) {
    log.warn('[ACTIVITY] URL server activity tidak valid:', err.message);
  }
}

function startActivityMonitoring(studentData = {}) {
  if (activityMonitor) {
    activityMonitor.stop();
    activityMonitor = null;
  }

  const cfg = loadServerConfig();
  activityMonitor = new ActivityMonitor();
  activityMonitor.setStudentInfo({
    pc_name: screenShareState.pcName,
    student_id: studentData.student_id || studentData.id || null,
    student_name: studentData.nama_lengkap || studentData.student_name || null,
    session_id: studentData.session_id || studentData.sessionId || null,
  });
  activityMonitor.onActivity((activity) => {
    if (realtimeSocket?.connected) {
      realtimeSocket.emit('client:activity', activity);
      return;
    }
    postActivityToServer(cfg.serverUrl, activity);
  });
  activityMonitor.start();
  log.info('[ACTIVITY] Monitoring dimulai untuk', studentData?.nama_lengkap);
}

// ── IPC: Login berhasil →’ keluar kiosk, tampilkan form pre-check ──
ipcMain.on('login-success', (_event, studentData) => {
  if (!mainWindow) return;
  activeSessionId = studentData?.session_id || studentData?.sessionId || null;

  applyWindowLayout('checklist');
  mainWindow.webContents.send('kiosk-off', studentData);

  // Mulai screen share
  const cfg = loadServerConfig();
  if (cfg.serverUrl) {
    startScreenShare(cfg.serverUrl, studentData?.nama_lengkap);
    startActivityMonitoring(studentData);
  }
  if (latestControlPolicy) {
    applyControlPolicy(latestControlPolicy).catch((error) => log.warn('[POLICY] Gagal diterapkan saat login:', error.message));
  }
});

// ── IPC: Resize widget dari React ────────────────────────────────
// mode: 'minimized' | 'regular' | 'expanded' | 'checklist'
ipcMain.on('resize-window', (_event, mode) => {
  if (!mainWindow) return;
  // Saat attention mode aktif, jangan ubah layout — simpan untuk restore nanti
  if (attentionModeOn) {
    preAttentionLayoutMode = mode;
    return;
  }
  applyWindowLayout(mode);
});

// ── IPC: Attention Mode dari server (via renderer) ────────────────────────────────
// Saat enabled: paksa kiosk fullscreen + keyboard hook + hide taskbar
// Saat disabled: kembalikan ke layout sebelumnya (widget/checklist)
ipcMain.on('set-attention-mode', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (enabled && !attentionModeOn) {
    attentionModeOn = true;
    preAttentionLayoutMode = currentLayoutMode;
    applyWindowLayout('login');
    log.info('[ATTENTION] Aktif — paksa kiosk lock');
  } else if (!enabled && attentionModeOn) {
    attentionModeOn = false;
    const restoreMode = preAttentionLayoutMode || 'regular';
    preAttentionLayoutMode = null;
    applyWindowLayout(restoreMode);
    log.info('[ATTENTION] Nonaktif — restore layout:', restoreMode);
  }
});

// ── IPC: Logout →’ masuk kiosk lagi ───────────────────────────────
ipcMain.on('do-logout', () => {
  if (!mainWindow) return;
  activeSessionId = null;

  stopScreenShare(); // ← hentikan screen share

  // Stop Activity Monitoring
  if (activityMonitor) {
    activityMonitor.stop();
    activityMonitor = null;
    log.info('[ACTIVITY] Monitoring dihentikan');
  }

  restoreSystemProxy().catch((error) => log.warn('[POLICY] Gagal memulihkan proxy:', error.message));

  applyWindowLayout('login');
  scheduleFocusRecovery(50);
  mainWindow.webContents.send('return-to-login');
});

// ── IPC: Keluar aplikasi (setelah password kepala lab terverifikasi) ──
ipcMain.on('quit-app', () => {
  requestControlledQuit('admin-verified-exit');
});

// ── IPC: Verify server dari main process (bypass renderer fetch restriction) ──
ipcMain.handle('verify-server', async (_event, url) => {
  if (!isAllowedLabServerUrl(url)) return { ok: false, labkom: false };
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = http.request(
      { host: parsed.hostname, port: parseInt(parsed.port) || 3001, path: '/', method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve({ ok: res.statusCode < 400, labkom: json.message?.includes('Labkom') });
          } catch { resolve({ ok: res.statusCode < 400, labkom: false }); }
        });
      }
    );
    req.setTimeout(4000, () => { req.destroy(); resolve({ ok: false, labkom: false }); });
    req.on('error', () => resolve({ ok: false, labkom: false }));
    req.end();
  });
});

// ── IPC: Keluar dari setup screen (belum login, aman untuk keluar) ──
ipcMain.on('exit-app', () => {
  requestControlledQuit('setup-exit');
});

// ═══ Remote Power Control ═════════════════════════════════════════════════

// ── Helper MAC address ────────────────────────────────────────────────────
function getFirstMac() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        return { mac: iface.mac, ip: iface.address };
      }
    }
  }
  return { mac: null, ip: null };
}

// ── Daftarkan MAC ke server ───────────────────────────────────────────────
function registerMacToServer() {
  const cfg = loadServerConfig();
  if (!cfg.serverUrl) return;
  const { mac, ip } = getFirstMac();
  if (!mac) return;
  const body = JSON.stringify({
    pc_name: screenShareState.pcName,
    mac,
    ip,
    student_name: screenShareState.studentName || null,
  });
  try {
    const parsed = new URL(`${cfg.serverUrl}/api/client-cmd/register-mac`);
    const req = http.request({
      hostname: parsed.hostname, port: parseInt(parsed.port) || 3001,
      path: '/api/client-cmd/register-mac', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${getStoredClientToken() || ''}`,
      },
    }, () => {});
    req.on('error', () => {}); req.setTimeout(4000, () => req.destroy()); req.write(body); req.end();
  } catch (_) {}
}

// ── Install watchdog via Windows Task Scheduler ───────────────────────────
function installWatchdog() {
  if (isDev) return;
  try {
    const exePath  = process.execPath;
    const userData = app.getPath('userData');
    const flagPath = path.join(userData, 'disabled.flag');
    const cfgPath  = path.join(userData, 'server.config.json');
    const devicePath = getDevicePath();
    const ps1Path  = path.join(userData, 'labkom-watchdog.ps1');
    const exeEsc   = exePath.replace(/'/g, "''");

    const ps1Lines = [
      `$appPath  = '${exeEsc}'`,
      `$flagPath = '${flagPath.replace(/'/g, "''")}'`,
      `$cfgPath  = '${cfgPath.replace(/'/g, "''")}'`,
      `$devicePath = '${devicePath.replace(/'/g, "''")}'`,
      '',
      `$isRunning = (Get-Process -Name 'LabKom Siswa' -ErrorAction SilentlyContinue) -ne $null`,
      `if ($isRunning) { exit 0 }`,
      '',
      `$serverUrl = $null`,
      `$clientToken = $null`,
      `if (Test-Path $cfgPath) {`,
      `  try { $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json; $serverUrl = $cfg.serverUrl } catch {}`,
      `}`,
      `if (Test-Path $devicePath) {`,
      `  try { $device = Get-Content $devicePath -Raw | ConvertFrom-Json; $clientToken = $device.client_token } catch {}`,
      `}`,
      '',
      `$cmd = 'none'`,
      `if ($serverUrl) {`,
      `  try {`,
      `    $headers = @{ Authorization = "Bearer $clientToken" }`,
      `    $r = Invoke-WebRequest -Uri "$serverUrl/api/client-cmd/current" -Headers $headers -TimeoutSec 4 -UseBasicParsing`,
      `    $cmd = ($r.Content | ConvertFrom-Json).cmd`,
      `  } catch {}`,
      `}`,
      '',
      `if ($cmd -eq 'enable') {`,
      `  if (Test-Path $flagPath) { Remove-Item $flagPath -Force }`,
      `  Enable-ScheduledTask -TaskName 'LabKomWatchdog' -ErrorAction SilentlyContinue`,
      `  if (Test-Path $appPath) { Start-Process $appPath }`,
      `  exit 0`,
      `}`,
      '',
      `if ((-not (Test-Path $flagPath)) -and (Test-Path $appPath)) { Start-Process $appPath }`,
    ];
    fs.writeFileSync(ps1Path, ps1Lines.join('\r\n'), 'utf-8');

    const q      = ps1Path.replace(/"/g, '\\"');
    const runner = `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${q}"`;
    execSync(`schtasks /Create /TN "LabKomWatchdog" /TR "${runner.replace(/"/g, '\\"')}" /SC MINUTE /MO 2 /F /RL HIGHEST`, { timeout: 10000 });
    log.info('[WATCHDOG] Task Scheduler terdaftar.');
  } catch (err) {
    log.warn('[WATCHDOG] Gagal install watchdog:', err.message);
  }
}

// ── Polling perintah remote dari server ──────────────────────────────────
let cmdPollTimer = null;
function startCmdPolling() {
  if (cmdPollTimer) return;
  cmdPollTimer = setInterval(() => {
    const cfg = loadServerConfig();
    if (!cfg.serverUrl) return;
    try {
      const parsed = new URL(`${cfg.serverUrl}/api/client-cmd/current`);
      const req = http.request({
        hostname: parsed.hostname, port: parseInt(parsed.port) || 3001,
        path: '/api/client-cmd/current', method: 'GET',
        headers: { Authorization: `Bearer ${getStoredClientToken() || ''}` },
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.cmd === 'kill') {
              log.info('[CMD] Perintah kill diterima  menutup aplikasi');
              stopScreenShare();
              if (json.permanent) {
                const fp = path.join(app.getPath('userData'), 'disabled.flag');
                fs.writeFileSync(fp, new Date().toISOString(), 'utf-8');
                try { execSync('schtasks /Change /TN "LabKomWatchdog" /Disable', { timeout: 4000 }); } catch {}
              }
              requestControlledQuit(json.permanent ? 'remote-kill-permanent' : 'remote-kill');
            } else if (json.cmd === 'enable') {
              const fp = path.join(app.getPath('userData'), 'disabled.flag');
              if (fs.existsSync(fp)) {
                try { fs.unlinkSync(fp); } catch {}
                try { execSync('schtasks /Change /TN "LabKomWatchdog" /Enable', { timeout: 4000 }); } catch {}
              }
            }
          } catch {}
        });
      });
      req.setTimeout(5000, () => req.destroy());
      req.on('error', () => {});
      req.end();
    } catch (_) {}
  }, 10_000);
}

// ── Auto force-logout ke server saat app mau ditutup ─────────────
function logoutActiveSessionOnQuit() {
  const cfg = loadServerConfig();
  const token = getStoredClientToken();
  if (!cfg.serverUrl || !activeSessionId || !token) return;
  try {
    const parsed = new URL(`${cfg.serverUrl}/api/auth/logout`);
    const body = JSON.stringify({ session_id: activeSessionId });
    const req = http.request({
      host: parsed.hostname,
      port: parseInt(parsed.port) || 3001,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
    }, () => {});
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (_) {}
}
// ── IPC: Request HTTP renderer, dibatasi ke backend LabKom tersimpan ──────
function isAllowedRendererApiUrl(parsed) {
  if (!isAllowedLabServerUrl(parsed.origin)) return false;
  if (!parsed.pathname.startsWith('/api/')) return false;
  const configuredUrl = loadServerConfig().serverUrl;
  if (!configuredUrl) return false;
  try {
    return parsed.origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

function performRendererApiRequest(parsed, options, clientToken) {
  return new Promise((resolve) => {
    const bodyStr = typeof options.body === 'string' ? options.body : '';
    if (Buffer.byteLength(bodyStr) > 2 * 1024 * 1024) {
      return resolve({ ok: false, status: 413, data: { success: false, message: 'Payload terlalu besar.' } });
    }

    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      return resolve({ ok: false, status: 405, data: { success: false, message: 'Method tidak diizinkan.' } });
    }

    const headers = { 'Content-Type': 'application/json' };
    if (clientToken) headers.Authorization = `Bearer ${clientToken}`;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request({
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 3001,
      path: parsed.pathname + (parsed.search || ''),
      method,
      headers,
    }, (res) => {
      let body = '';
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          req.destroy();
          resolve({ ok: false, status: 502, data: { success: false, message: 'Respons server terlalu besar.' } });
          return;
        }
        body += chunk;
      });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: body }); }
      });
    });
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, status: 0, data: null }); });
    req.on('error', () => resolve({ ok: false, status: 0, data: null }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

ipcMain.handle('api-request', async (_event, url, options = {}) => {
  let parsed;
  try { parsed = new URL(url); }
  catch { return { ok: false, status: 400, data: { success: false, message: 'URL tidak valid.' } }; }

  if (!isAllowedRendererApiUrl(parsed)) {
    return { ok: false, status: 403, data: { success: false, message: 'Target API tidak diizinkan.' } };
  }

  let result = await performRendererApiRequest(parsed, options, getStoredClientToken());
  if (result.status === 401) {
    setStoredClientToken(null);
    const freshToken = await requestDeviceToken(parsed.origin);
    if (freshToken) result = await performRendererApiRequest(parsed, options, freshToken);
  }
  return result;

});
app.whenReady().then(async () => {
  await restoreSystemProxy().catch(() => false);
  clientSettings = loadClientSettings();
  applyClientSettings(clientSettings);
  // ── Daftarkan ke Windows Startup ─────────────────────────────
  // Agar app otomatis berjalan saat PC dinyalakan (kiosk mode)
  createWindow();
  applyWindowLayout('login');
  startDiscoveryListener(); // → Dengarkan broadcast admin

  const initialConfig = loadServerConfig();
  if (initialConfig.serverUrl) connectRealtime(initialConfig.serverUrl);
  startPresenceHeartbeat();

  // Daftarkan MAC + mulai polling perintah remote setelah app siap
  setTimeout(() => {
    registerMacToServer();
    startCmdPolling();
  }, 8000);

  // Install watchdog Task Scheduler (hanya production)
  if (!isDev) installWatchdog();

  // Silent update check 30 detik setelah startup (hanya production)
  if (!isDev && clientSettings.autoUpdate) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 30_000);
  }
  scheduleUpdateChecks();

  // ── Shortcut keluar untuk Kepala Lab (Ctrl+Alt+Q) ───────────────
  globalShortcut.register('Ctrl+Alt+Q', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-admin-dialog');
    }
  });

  // ── Blokir shortcut berbahaya ─────────────────────────────────
  // Alt+F4, Ctrl+W, Ctrl+F4 (close window)
  globalShortcut.register('Alt+F4',  () => {});
  globalShortcut.register('Ctrl+W',  () => {});
  globalShortcut.register('Ctrl+F4', () => {});
  // Task Manager & Alt+Tab
  globalShortcut.register('Ctrl+Shift+Escape', () => {});
  globalShortcut.register('Ctrl+Alt+Delete',   () => {});
  globalShortcut.register('Ctrl+Esc',          () => {});
  globalShortcut.register('Alt+Esc',           () => {});
  globalShortcut.register('Alt+Tab',            () => {});
  globalShortcut.register('Alt+Space',         () => {});
  globalShortcut.register('Meta+Tab',           () => {});
  globalShortcut.register('Meta+D',             () => {});
  // F11, F4
  globalShortcut.register('F11', () => {});
  globalShortcut.register('F4',  () => {});
  // DevTools (nonaktif di production)
  if (!isDev) {
    globalShortcut.register('F12',            () => {});
    globalShortcut.register('Ctrl+Shift+I',   () => {});
    globalShortcut.register('Ctrl+Shift+J',   () => {});
    globalShortcut.register('Ctrl+R',         () => {});
    globalShortcut.register('F5',             () => {});
  }
});

// Jangan tutup app saat semua window ditutup
app.on('window-all-closed', (e) => e.preventDefault());
app.on('browser-window-blur', (_event, window) => {
  if (window === mainWindow) {
    if (isKioskLocked()) {
      scheduleFocusRecovery(10);
    } else {
      scheduleFocusRecovery(150);
    }
  }
});
app.on('browser-window-focus', (_event, window) => {
  if (window !== mainWindow) return;
  if (focusRecoveryTimer) {
    clearTimeout(focusRecoveryTimer);
    focusRecoveryTimer = null;
  }
});
app.on('before-quit', (event) => {
  if (!allowAppQuit) {
    preventUnexpectedQuit(event);
    return;
  }
  logoutActiveSessionOnQuit();
});
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  keepWindowVisible();
});

app.on('will-quit', () => {
  if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
  stopDiscoveryListener();
  stopPresenceHeartbeat();
  disconnectRealtime();
  stopKeyboardHook();
  showTaskbar(); // Safety net: selalu pulihkan taskbar
  if (policyProxyServer) {
    try { policyProxyServer.close(); } catch {}
    policyProxyServer = null;
    policyProxyPort = null;
  }
  if (cmdPollTimer) { clearInterval(cmdPollTimer); cmdPollTimer = null; }

  // Cleanup Activity Monitor
  if (activityMonitor) {
    activityMonitor.stop();
    activityMonitor = null;
  }

  globalShortcut.unregisterAll();
});
