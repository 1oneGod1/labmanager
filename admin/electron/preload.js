const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Diagnostik startup renderer
  reportRendererReady: () => ipcRenderer.send('renderer-ready'),
  reportRendererError: (details) => ipcRenderer.send('renderer-error', {
    message: String(details?.message || 'Unknown renderer error').slice(0, 2000),
    stack: String(details?.stack || '').slice(0, 8000),
    source: String(details?.source || '').slice(0, 1000),
  }),

  // Info server yang sedang berjalan di PC ini
  getServerInfo:    ()     => ipcRenderer.invoke('get-server-info'),
  restartServer:    ()     => ipcRenderer.invoke('restart-server'),
  pingServer:       (ip)   => ipcRenderer.invoke('ping-server', ip),

  // Listener: update status server dari main process
  onServerStatus: (cb) => ipcRenderer.on('server-status', (_e, data) => cb(data)),

  // Remote Power Control & File Management
  sendClientCmd:     (cmd, permanent, token) => ipcRenderer.invoke('send-client-cmd', cmd, permanent, token),
  getClientMacs:     (token)                 => ipcRenderer.invoke('get-client-macs', token),
  wakeOnLan:         (mac)                   => ipcRenderer.invoke('wake-on-lan', mac),
  saveCollectedFile: (payload)                => ipcRenderer.invoke('save-collected-file', payload),
  saveTemplateFile:  (payload)                => ipcRenderer.invoke('save-template-file', payload),
  exportReportsPdf:  ()                       => ipcRenderer.invoke('export-reports-pdf'),

  // Auto-Update API
  checkForUpdates:  ()  => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:   ()  => ipcRenderer.send('download-update'),
  installUpdate:    ()  => ipcRenderer.send('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, data) => cb(data)),

  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
});
