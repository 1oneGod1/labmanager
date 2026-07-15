const { contextBridge, ipcRenderer } = require('electron');

// Expose API yang aman ke renderer (React) via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Read ────────────────────────────────────────────────────────
  getPcName: () => ipcRenderer.invoke('get-pc-name'),
  getControlPolicy: () => ipcRenderer.invoke('get-control-policy'),

  // ── Konfigurasi URL server (disimpan di userData) ───────────────
  getServerUrl:  ()    => ipcRenderer.invoke('get-server-url'),
  saveServerUrl: (url) => ipcRenderer.send('save-server-url', url),

  // Pengaturan PC siswa dan pembaruan aplikasi.
  getClientSettings:  ()       => ipcRenderer.invoke('get-client-settings'),
  saveClientSettings: (data)   => ipcRenderer.invoke('save-client-settings', data),
  setClientBranding:  (data)   => ipcRenderer.send('set-client-branding', data),
  checkForUpdates:    ()       => ipcRenderer.invoke('check-client-update'),
  downloadUpdate:     ()       => ipcRenderer.invoke('download-client-update'),
  installUpdate:      ()       => ipcRenderer.send('install-client-update'),
  getDeepFreezeStatus: () => ipcRenderer.invoke('get-deep-freeze-status'),
  configureDeepFreeze: (action, password, providerPassword = '') => ipcRenderer.invoke('configure-deep-freeze', { action, password, providerPassword }),
  relaunchAsAdministrator: (password) => ipcRenderer.invoke('relaunch-client-as-admin', password),
  onDeepFreezeStatus: (cb) => ipcRenderer.on('deep-freeze-status', (_e, data) => cb(data)),

  onUpdateStatus:     (cb)     => ipcRenderer.on('client-update-status', (_e, data) => cb(data)),

  // ── Login / Logout IPC ──────────────────────────────────────────
  loginSuccess:  (studentData) => ipcRenderer.send('login-success', studentData),
  doLogout:      ()            => ipcRenderer.send('do-logout'),

  // ── Resize widget: 'minimized' | 'regular' | 'expanded' ────────
  resizeWindow:  (mode)        => ipcRenderer.send('resize-window', mode),

  // ── Admin: keluar aplikasi setelah password terverifikasi ───────
  quitApp: () => ipcRenderer.send('quit-app'),

  // ── Keluar dari layar setup (sebelum konfigurasi) ───────────────
  exitApp: () => ipcRenderer.send('exit-app'),

  // ── Listener dari Main → Renderer ──────────────────────────────
  onKioskOff:        (cb) => ipcRenderer.on('kiosk-off',       (_e, data) => cb(data)),
  onReturnToLogin:   (cb) => ipcRenderer.on('return-to-login', ()         => cb()),
  // Update sudah didownload di background, siap install saat keluar
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded', ()       => cb()),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // ── Server auto-discovery via UDP broadcast ─────────────────────
  onServerDiscovered: (cb) => ipcRenderer.on('server-discovered', (_e, data) => cb(data)),

  // ── Trigger dialog keluar dari main process (globalShortcut) ────
  onShowAdminDialog: (cb) => ipcRenderer.on('show-admin-dialog', () => cb()),
  onControlSettings: (cb) => ipcRenderer.on('control-settings', (_e, data) => cb(data)),

  // ── Verify server reachable dari main process (bukan renderer) ────
  verifyServer: (url) => ipcRenderer.invoke('verify-server', url),

  // ── General API request via Node.js http (bypass Chromium fetch restriction) ──
  apiRequest: (url, options) => ipcRenderer.invoke('api-request', url, options),

  // ── Attention Mode: paksa kiosk + keyboard hook saat enabled ───
  setAttentionMode: (enabled) => ipcRenderer.send('set-attention-mode', enabled),
  setScreenShareMode: (enabled) => ipcRenderer.send('set-screen-share-mode', enabled),

  // ── Device token untuk socket auth (di-issue oleh main process) ──
  getClientToken: () => ipcRenderer.invoke('get-client-token'),
  refreshClientToken: () => ipcRenderer.invoke('refresh-client-token'),
  getClientPairingStatus: () => ipcRenderer.invoke('get-client-pairing-status'),
  pairClientDevice: (code) => ipcRenderer.invoke('pair-client-device', code),

  // Startup/health signal hanya dikirim setelah layar login/setup terbukti terlukis.
  reportRendererReady: (details = {}) => ipcRenderer.send('renderer-ready', {
    screen: ['login', 'setup'].includes(details.screen) ? details.screen : '',
    width: Number.isFinite(details.width) ? Math.round(details.width) : 0,
    height: Number.isFinite(details.height) ? Math.round(details.height) : 0,
  }),
  reportRendererError: (details = {}) => ipcRenderer.send('renderer-error', {
    message: String(details.message || 'Unknown renderer error').slice(0, 2000),
    stack: String(details.stack || '').slice(0, 8000),
    source: String(details.source || 'renderer').slice(0, 200),
    fatal: Boolean(details.fatal),
  }),


  // Simpan file kelas yang diterima ke Downloads/LabKom.
  saveReceivedFile: (payload) => ipcRenderer.invoke('save-received-file', payload),
  showReceivedFile: (filePath) => ipcRenderer.invoke('show-received-file', filePath),

  // ── Verify emergency password tanpa expose plaintext ke renderer ──
  verifyEmergencyPassword: (pw) => ipcRenderer.invoke('verify-emergency-password', pw),
});
