const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clonebox', {
  runScan: (opts) => ipcRenderer.invoke('scan:run', opts),
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_e, msg) => cb(msg)),
  chooseFolder: (title) => ipcRenderer.invoke('dialog:chooseFolder', { title }),
  buildPackage: (items, outDir, opts = {}) =>
    ipcRenderer.invoke('package:build', { items, outDir, ...opts }),
  onPackageProgress: (cb) => ipcRenderer.on('package:progress', (_e, msg) => cb(msg)),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  uninstallItems: (items) => ipcRenderer.invoke('device:uninstall', { items }),
  onUninstallProgress: (cb) => ipcRenderer.on('uninstall:progress', (_e, msg) => cb(msg)),
  platform: process.platform,
});
