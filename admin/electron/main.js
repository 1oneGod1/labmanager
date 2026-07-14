// ─── Admin Electron Main Process ───────────────────────────────────────────
// Tugasnya:
//  1. Spawn backend Express server secara otomatis
//  2. Tampilkan UI admin dashboard (React/Vite)
//  3. Expose info IP LAN ke renderer via IPC
//  4. Auto-update via electron-updater (GitHub Releases / generic server)

const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut, session } = require('electron');
const path             = require('path');
const os               = require('os');
const http             = require('http');
const dgram            = require('dgram');
const { spawn }        = require('child_process');
const fs               = require('fs');
const crypto           = require('crypto');

// Gunakan nama produk untuk lokasi konfigurasi agar sesuai dokumentasi dan
// mudah ditemukan oleh operator lab.
const ADMIN_USER_DATA_NAME = 'LabKom Admin - Dashboard';
const LEGACY_ADMIN_USER_DATA_NAME = 'labkom-admin';
app.setPath('userData', path.join(app.getPath('appData'), ADMIN_USER_DATA_NAME));

const DEFAULT_ADMIN_PASSWORD_HASH = '$2b$10$x7A71CHObExmQ7nqG0/pduYE1ye3TjjQqeMGa5qtWsA9q.ALnu6Te';
const ADMIN_PASSWORD_POLICY_VERSION = '2026-07-14-1';

function upsertEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^${key}=.*$`, 'm');
  if (matcher.test(content)) return content.replace(matcher, () => line);
  const normalized = content.trimEnd();
  return `${normalized}${normalized ? '\r\n' : ''}${line}\r\n`;
}

function applyAdminPasswordPolicy(envPath) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const currentPolicy = content
    .match(/^LABKOM_ADMIN_PASSWORD_POLICY_VERSION=(.*)$/m)?.[1]
    ?.trim();
  if (currentPolicy === ADMIN_PASSWORD_POLICY_VERSION) return false;

  content = upsertEnvValue(content, 'ADMIN_PASSWORD', DEFAULT_ADMIN_PASSWORD_HASH);
  content = upsertEnvValue(content, 'LABKOM_ADMIN_PASSWORD_POLICY_VERSION', ADMIN_PASSWORD_POLICY_VERSION);
  fs.writeFileSync(envPath, content, 'utf8');
  return true;
}

function ensureClientRegistrationKey(envPath) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const configured = content.match(/^CLIENT_REGISTRATION_KEY=(.*)$/m)?.[1]?.trim() || '';
  if (configured.length >= 32) return false;

  const generated = crypto.randomBytes(24).toString('base64url');
  content = upsertEnvValue(content, 'CLIENT_REGISTRATION_KEY', generated);
  fs.writeFileSync(envPath, content, 'utf8');
  return true;
}

// ─── UDP Discovery Broadcast ────────────────────────────────────────────────
const DISCOVERY_PORT    = 41234;
const DISCOVERY_MESSAGE = Buffer.from(JSON.stringify({
  labkom: true,
  productName: 'LabKom Admin',
}));
let discoverySocket = null;
let discoveryTimer  = null;

function startDiscoveryBroadcast() {
  if (discoverySocket) return;
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket.bind(() => {
    discoverySocket.setBroadcast(true);
    // Kirim broadcast tiap 2 detik untuk SEMUA IP LAN
    discoveryTimer = setInterval(() => {
      const ips  = getAllLanIps();
      const port = serverPort;
      ips.forEach(ip => {
        const msg = Buffer.from(JSON.stringify({ labkom: true, ip, port, name: 'LabKom Admin' }));
        discoverySocket.send(msg, 0, msg.length, DISCOVERY_PORT, '255.255.255.255', () => {});
        log.info(`[DISCOVERY] Broadcasting ip=${ip} port=${port}`);
      });
    }, 2000);
  });
  discoverySocket.on('error', (err) => {
    console.warn('[DISCOVERY] broadcast error:', err.message);
  });
}

function stopDiscoveryBroadcast() {
  if (discoveryTimer) { clearInterval(discoveryTimer); discoveryTimer = null; }
  if (discoverySocket) { try { discoverySocket.close(); } catch {} discoverySocket = null; }
}
const { autoUpdater }  = require('electron-updater');
const log              = require('electron-log');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const allowDevTools = process.env.OPEN_ELECTRON_DEVTOOLS === '1';

// ─── Auto-Updater Config ────────────────────────────────────────────────────
// Log ke file: %USERPROFILE%\AppData\Roaming\LabKom Admin\logs\main.log
autoUpdater.logger         = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.channel        = 'admin';
autoUpdater.allowPrerelease = false;
autoUpdater.allowDowngrade = false;
autoUpdater.autoDownload   = false;  // Admin: download manual oleh kepala lab
autoUpdater.autoInstallOnAppQuit = false;

// Kirim status update ke renderer
function sendUpdateStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', data);
  }
}

autoUpdater.on('checking-for-update', () => {
  log.info('[UPDATE] Memeriksa pembaruan…');
  sendUpdateStatus({ state: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  log.info('[UPDATE] Pembaruan tersedia:', info.version);
  sendUpdateStatus({ state: 'available', version: info.version, releaseNotes: info.releaseNotes });
});
autoUpdater.on('update-not-available', (info) => {
  log.info('[UPDATE] Sudah versi terbaru:', info.version);
  sendUpdateStatus({ state: 'latest', version: info.version });
});
autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus({
    state:   'downloading',
    percent: Math.round(progress.percent),
    speed:   Math.round(progress.bytesPerSecond / 1024),  // KB/s
    total:   Math.round(progress.total / 1024 / 1024),    // MB
  });
});
autoUpdater.on('update-downloaded', (info) => {
  log.info('[UPDATE] Download selesai, siap install:', info.version);
  sendUpdateStatus({ state: 'downloaded', version: info.version });
});
autoUpdater.on('error', (err) => {
  log.error('[UPDATE] Error:', err.message);
  sendUpdateStatus({ state: 'error', message: err.message });
});

let mainWindow;
let serverProcess = null;
let serverStatus  = 'starting';  // 'starting' | 'online' | 'error'
let serverPort    = 3001;
let serverRestartTimer = null;
let isQuitting = false;
let serverStopRequested = false;

// ─── Dapatkan semua IP LAN aktif (non-internal IPv4) ──────────────────────────
function getAllLanIps() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['127.0.0.1'];
}

function getLanIp() {
  return getAllLanIps()[0];
}

function sendServerStatus(status = serverStatus) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-status', { status, ip: getLanIp(), port: serverPort });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearServerRestartTimer() {
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = null;
  }
}

// ─── Spawn Express server ───────────────────────────────────────────────────
async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: serverPort, path: '/', method: 'GET' },
      (res) => { resolve(res.statusCode < 500); }
    );
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForServerReady(timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerRunning()) return true;
    await delay(500);
  }
  return false;
}

function findNodeExecutable() {
  // 1. Coba 'node' dari PATH (dev / node terinstall)
  const { execSync } = require('child_process');
  try {
    const located = execSync('where node', { timeout: 3000 }).toString().trim().split('\n')[0].trim();
    if (located && fs.existsSync(located)) return located;
  } catch {}
  // 2. Lokasi umum Node.js di Windows
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.APPDATA || '', '..', 'Local', 'Programs', 'node', 'node.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'node'; // fallback
}

function scheduleServerRestart(reason) {
  if (isQuitting || serverStopRequested || serverRestartTimer) return;
  log.warn(`[SERVER] Menjadwalkan restart otomatis: ${reason}`);
  serverRestartTimer = setTimeout(async () => {
    serverRestartTimer = null;
    if (isQuitting) return;
    await startServer();
  }, 2500);
}

async function stopManagedServer() {
  clearServerRestartTimer();
  if (!serverProcess) return;

  const processToStop = serverProcess;
  serverStopRequested = true;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    processToStop.once('close', finish);
    try { processToStop.kill(); } catch (_) { finish(); }
    setTimeout(finish, 4000);
  });

  if (serverProcess === processToStop) {
    serverProcess = null;
  }

  serverStopRequested = false;
}

async function startServer() {
  clearServerRestartTimer();
  serverStatus = 'starting';
  sendServerStatus('starting');

  // Jika server sudah berjalan (mis. dev mode), jangan spawn ulang
  if (await isServerRunning()) {
    console.log('[ADMIN] Server sudah berjalan, skip spawn.');
    serverStatus = 'online';
    serverProcess = null;
    sendServerStatus('online');
    return true;
  }

  const serverDir   = isDev
    ? path.join(__dirname, '..', '..', 'server')      // dev: C:\Labkom\server
    : path.join(process.resourcesPath, 'server');     // production build

  const serverEntry = path.join(serverDir, 'src', 'index.js');

  if (!fs.existsSync(serverEntry)) {
    log.error('[ADMIN] Server entry tidak ditemukan:', serverEntry);
    serverStatus = 'error';
    sendServerStatus('error');
    return false;
  }

  // Paket production memakai runtime Node yang sudah tertanam di Electron,
  // sehingga PC tujuan tidak perlu menginstal Node.js secara terpisah.
  const nodeExe = isDev ? findNodeExecutable() : process.execPath;
  const managedEnvPath = isDev
    ? path.join(serverDir, '.env')
    : path.join(app.getPath('userData'), 'server.env');
  if (!isDev) fs.mkdirSync(path.dirname(managedEnvPath), { recursive: true });
  if (!isDev && !fs.existsSync(managedEnvPath)) {
    const examplePath = path.join(serverDir, '.env.example');
    const legacyEnvPath = path.join(app.getPath('appData'), LEGACY_ADMIN_USER_DATA_NAME, 'server.env');
    if (fs.existsSync(legacyEnvPath)) {
      fs.copyFileSync(legacyEnvPath, managedEnvPath);
    } else if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, managedEnvPath);
    }
    log.warn('[SERVER] Konfigurasi dibuat di:', managedEnvPath);
  }
  if (!isDev && applyAdminPasswordPolicy(managedEnvPath)) {
    log.info('[SERVER] Password admin bawaan berhasil dimigrasikan.');
  }
  if (!isDev && ensureClientRegistrationKey(managedEnvPath)) {
    log.info('[SERVER] Kunci pairing client dibuat otomatis.');
  }
  console.log('[ADMIN] Menjalankan server:', serverEntry, '| node:', nodeExe);

  serverStopRequested = false;
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'production',
    LABKOM_ENV_PATH: managedEnvPath,
    LABKOM_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    LABKOM_BACKUP_DIR: path.join(app.getPath('userData'), 'backups'),
  };
  // server.env adalah sumber konfigurasi admin yang otoritatif. Hindari nilai
  // ADMIN_PASSWORD dari shell induk mengalahkan hasil migrasi dotenv.
  delete serverEnv.ADMIN_PASSWORD;
  if (!isDev) serverEnv.ELECTRON_RUN_AS_NODE = '1';

  const managedProcess = spawn(nodeExe, [serverEntry], {
    cwd:  serverDir,
    env:  serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess = managedProcess;

  managedProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log('[SERVER]', msg);
    if (msg.includes('berjalan di port')) {
      serverStatus = 'online';
      sendServerStatus('online');
    }
  });

  managedProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('EADDRINUSE')) {
      console.log('[SERVER] Port sudah digunakan, server sudah berjalan.');
      serverStatus = 'online';
      sendServerStatus('online');
    } else {
      log.error('[SERVER ERR]', msg);
    }
  });

  managedProcess.on('close', (code) => {
    console.log('[SERVER] Proses berhenti dengan kode:', code);
    if (serverProcess === managedProcess) {
      serverProcess = null;
    }

    if (isQuitting || serverStopRequested) {
      serverStatus = 'stopped';
      sendServerStatus('stopped');
      return;
    }

    serverStatus = 'error';
    sendServerStatus('error');
    scheduleServerRestart(`server-exit-${code}`);
  });

  managedProcess.on('error', (err) => {
    log.error('[SERVER] Gagal menjalankan:', err.message);
    serverStatus = 'error';
    sendServerStatus('error');
    scheduleServerRestart('spawn-error');
  });

  const ready = await waitForServerReady();
  if (ready) {
    serverStatus = 'online';
    sendServerStatus('online');
    return true;
  }

  log.error('[SERVER] Backend belum sehat setelah menunggu startup.');
  serverStatus = 'error';
  sendServerStatus('error');
  scheduleServerRestart('startup-timeout');
  return false;
}

// ─── BrowserWindow ──────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  900,
    minHeight: 600,
    title: 'LabKom Admin – Dashboard Manajemen Lab Komputer',
    show: false,  // Jangan tampil dulu, tunggu ready
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      devTools:         allowDevTools,
      spellcheck:       false,
    },
  });

  // Window security features
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    if (allowDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Buka link eksternal di browser default, bukan di Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || (isDev && url.startsWith('http://localhost:5174'));
    if (!allowed) event.preventDefault();
  });

  mainWindow.on('close', (e) => {
    if (serverProcess) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type:    'question',
        buttons: ['Ya, Keluar & Matikan Server', 'Batal'],
        defaultId: 0,
        cancelId:  1,
        title:   'Konfirmasi Keluar',
        message: 'Menutup Admin akan menghentikan server backend.\nSemua koneksi client akan terputus.',
      });
      if (choice === 1) { e.preventDefault(); return; }
    }
  });

  // Cegah minimize dan hide
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
  });
  mainWindow.on('hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Cegah window di-move atau di-resize yang tidak terotorisasi
  mainWindow.on('will-resize', (event) => {
    event.preventDefault();
  });
  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.center();
    }
  });

  // Tampilkan window saat sudah siap di-render
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

// Renderer minta info server (IP, port, status)
ipcMain.handle('get-server-info', () => ({
  ip:     getLanIp(),
  allIps: getAllLanIps(),
  port:   serverPort,
  status: serverStatus,
}));

// Renderer minta restart server
ipcMain.handle('restart-server', async () => {
  await stopManagedServer();
  serverStatus = 'starting';
  serverProcess = null;
  await startServer();
  return { success: true };
});

// Renderer minta ping IP tertentu
ipcMain.handle('ping-server', async (_event, ip) => {
  return new Promise((resolve) => {
    const req = http.request(
      { host: ip, port: serverPort, path: '/', method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve({ reachable: true, labkom: !!json.message?.includes('Labkom'), statusCode: res.statusCode });
          } catch { resolve({ reachable: true, labkom: false, statusCode: res.statusCode }); }
        });
      }
    );
    req.setTimeout(3000, () => { req.destroy(); resolve({ reachable: false, labkom: false }); });
    req.on('error', () => resolve({ reachable: false, labkom: false }));
    req.end();
  });
});

// ─── IPC Update ─────────────────────────────────────────────────────────────

// Renderer minta cek update (misal dari tombol di UI)
ipcMain.handle('check-for-updates', async () => {
  if (isDev) {
    sendUpdateStatus({ state: 'error', message: 'Cek update tidak tersedia di mode dev.' });
    return;
  }
  try { await autoUpdater.checkForUpdates(); }
  catch (e) { sendUpdateStatus({ state: 'error', message: e.message }); }
});

// Renderer minta mulai download update
ipcMain.on('download-update', () => {
  autoUpdater.downloadUpdate();
});

// Renderer minta install update sekarang (quit & install)
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// ─── IPC: Kirim perintah remote ke semua klien (via server) ────────────────
function requestLocalServerJson({ path: requestPath, method = 'GET', body = null, token = null, timeoutMs = 5000, fallback = { success: false } }) {
  return new Promise((resolve) => {
    const bodyString = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (bodyString) headers['Content-Length'] = Buffer.byteLength(bodyString);
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = http.request({
      host: '127.0.0.1',
      port: serverPort,
      path: requestPath,
      method,
      headers,
    }, (res) => {
      let responseBody = '';
      res.on('data', d => responseBody += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch {
          resolve(fallback);
        }
      });
    });
    req.on('error', () => resolve(fallback));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(fallback); });
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

ipcMain.handle('send-client-cmd', async (_ev, cmd, permanent = false, token = null) => {
  return requestLocalServerJson({
    path: '/api/client-cmd',
    method: 'POST',
    body: { cmd, permanent },
    token,
  });
});

// ─── IPC: Ambil daftar MAC address klien ────────────────────────────────────
ipcMain.handle('get-client-macs', async (_ev, token = null) => {
  return requestLocalServerJson({
    path: '/api/client-cmd/macs',
    method: 'GET',
    token,
    timeoutMs: 4000,
    fallback: { success: false, data: [] },
  });
});

// ─── IPC: Wake-on-LAN (kirim magic packet ke MAC) ────────────────────────────
ipcMain.handle('wake-on-lan', async (_ev, macAddress) => {
  return new Promise((resolve) => {
    try {
      // Bersihkan format MAC → 12 hex chars
      const hex    = macAddress.replace(/[:\-]/g, '').toUpperCase();
      if (hex.length !== 12) return resolve({ success: false, reason: 'Format MAC salah.' });
      const macBuf = Buffer.from(hex, 'hex');

      // Magic packet: 6x FF + 16x MAC
      const magic  = Buffer.alloc(6 + 16 * 6);
      magic.fill(0xff, 0, 6);
      for (let i = 0; i < 16; i++) macBuf.copy(magic, 6 + i * 6);

      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.once('listening', () => {
        sock.setBroadcast(true);
        sock.send(magic, 0, magic.length, 9, '255.255.255.255', (err) => {
          sock.close();
          if (err) resolve({ success: false, reason: err.message });
          else     resolve({ success: true });
        });
      });
      sock.bind();
    } catch (err) {
      resolve({ success: false, reason: err.message });
    }
  });
});

// ─── App lifecycle ──────────────────────────────────────────────────────────
function sanitizeCollectedName(value, fallback = 'file') {
  const base = path.basename(String(value || '').trim());
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').slice(0, 120);
  return safe || fallback;
}

ipcMain.handle('save-collected-file', async (_event, payload = {}) => {
  try {
    const collectionId = String(payload.collection_id || '').trim();
    if (!/^collect_[A-Za-z0-9_-]{6,70}$/.test(collectionId)) {
      return { success: false, message: 'ID pengumpulan tidak valid.' };
    }
    const match = String(payload.data || '').match(/^data:[^;,]{1,120};base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { success: false, message: 'Format file tidak valid.' };
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > 1024 * 1024) {
      return { success: false, message: 'File kosong atau melebihi 1 MB.' };
    }

    const collectionFolder = sanitizeCollectedName(collectionId, 'pengumpulan');
    const destinationDir = path.join(app.getPath('downloads'), 'LabKom-Pengumpulan', collectionFolder);
    fs.mkdirSync(destinationDir, { recursive: true });
    const pcName = sanitizeCollectedName(payload.pc_name, 'PC');
    const fileName = sanitizeCollectedName(payload.name, 'tugas');
    const parsed = path.parse(fileName);
    let destination = path.join(destinationDir, `${pcName}_${fileName}`);
    let suffix = 1;
    while (fs.existsSync(destination)) {
      destination = path.join(destinationDir, `${pcName}_${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    }
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    return { success: true, file_name: path.basename(destination), path: destination, size: bytes.length };
  } catch (error) {
    log.warn('[FILES] Gagal menyimpan pengumpulan:', error.message);
    return { success: false, message: 'File pengumpulan tidak dapat disimpan.' };
  }
});

ipcMain.handle('export-reports-pdf', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false, message: 'Jendela Admin tidak tersedia.' };
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Simpan Laporan LabKom',
      defaultPath: path.join(app.getPath('downloads'), `Laporan-LabKom-${new Date().toISOString().slice(0, 10)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, landscape: true, pageSize: 'A4' });
    fs.writeFileSync(result.filePath, pdf);
    shell.showItemInFolder(result.filePath);
    return { success: true, path: result.filePath };
  } catch (error) {
    log.warn('[REPORTS] Gagal ekspor PDF:', error.message);
    return { success: false, message: 'Laporan PDF gagal dibuat.' };
  }
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await startServer();   // ← Jalankan/detect backend terlebih dahulu
  startDiscoveryBroadcast(); // ← Mulai broadcast UDP agar client bisa temukan server
  createWindow();
  sendServerStatus();

  // --- Register global shortcuts untuk mencegah Alt+Tab dan shortcuts berbahaya ---
  globalShortcut.register('Alt+Tab',           () => {});
  globalShortcut.register('Shift+Alt+Tab',     () => {});
  globalShortcut.register('Alt+Esc',           () => {});
  globalShortcut.register('Alt+F4',            () => {});
  globalShortcut.register('Ctrl+Alt+Delete',   () => {});
  globalShortcut.register('Ctrl+Shift+Escape', () => {});
  globalShortcut.register('Ctrl+Esc',          () => {});
  globalShortcut.register('Meta+Tab',          () => {});
  globalShortcut.register('Shift+Meta+Tab',    () => {});
  globalShortcut.register('Meta+D',            () => {});
  globalShortcut.register('Meta+E',            () => {});
  globalShortcut.register('F11',               () => {});
  globalShortcut.register('Ctrl+R',            () => {});
  globalShortcut.register('Ctrl+W',            () => {});
  globalShortcut.register('Ctrl+F4',           () => {});
  if (!isDev) {
    globalShortcut.register('F12',             () => {});
    globalShortcut.register('Ctrl+Shift+I',    () => {});
    globalShortcut.register('Ctrl+Shift+J',    () => {});
  }

  // Auto-cek update 10 detik setelah window siap (hanya production)
  if (!isDev) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => autoUpdater.checkForUpdates(), 10_000);
    });
  }
});

app.on('window-all-closed', async () => {
  isQuitting = true;
  stopDiscoveryBroadcast();
  await stopManagedServer();
  app.quit();
});

app.on('will-quit', () => {
  isQuitting = true;
  clearServerRestartTimer();
  if (serverProcess) { try { serverProcess.kill(); } catch {} }
});
