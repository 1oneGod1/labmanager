const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Info server yang sedang berjalan di PC ini
  getServerInfo:    ()     => ipcRenderer.invoke('get-server-info'),
  restartServer:    ()     => ipcRenderer.invoke('restart-server'),
  pingServer:       (ip)   => ipcRenderer.invoke('ping-server', ip),

  // Listener: update status server dari main process
  onServerStatus: (cb) => ipcRenderer.on('server-status', (_e, data) => cb(data)),

  // ── Remote Power Control ─────────────────────────────────────────────────
  sendClientCmd:  (cmd, permanent, token) => ipcRenderer.invoke('send-client-cmd', cmd, permanent, token),
  getClientMacs:  (token)                 => ipcRenderer.invoke('get-client-macs', token),
  wakeOnLan:      (mac)            => ipcRenderer.invoke('wake-on-lan', mac),
  saveCollectedFile: (payload)     => ipcRenderer.invoke('save-collected-file', payload),
  exportReportsPdf:  ()            => ipcRenderer.invoke('export-reports-pdf'),

  // ── Auto-Update API ──────────────────────────────────────────────────────
  // Cek apakah ada versi baru (dipanggil manual dari UI)
  checkForUpdates:  ()  => ipcRenderer.invoke('check-for-updates'),
  // Mulai download update (dipanggil setelah user konfirmasi)
  downloadUpdate:   ()  => ipcRenderer.send('download-update'),
  // Install update sekarang (quit & restart)
  installUpdate:    ()  => ipcRenderer.send('install-update'),
  // Listener: terima progress / status update dari main
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
});
