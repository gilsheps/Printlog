'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelfNative', {
  fs: {
    list: (rel) => ipcRenderer.invoke('fs:list', rel),
    stat: (rel) => ipcRenderer.invoke('fs:stat', rel),
    read: (rel) => ipcRenderer.invoke('fs:read', rel),
    write: (rel, data) => ipcRenderer.invoke('fs:write', rel, data),
    mkdir: (rel) => ipcRenderer.invoke('fs:mkdir', rel),
    remove: (rel) => ipcRenderer.invoke('fs:remove', rel),
  },
  gdrive: {
    status: () => ipcRenderer.invoke('gdrive:status'),
    connect: () => ipcRenderer.invoke('gdrive:connect'),
    disconnect: () => ipcRenderer.invoke('gdrive:disconnect'),
    archive: (rel) => ipcRenderer.invoke('gdrive:archive', rel),
    restore: (gpath, destRel) => ipcRenderer.invoke('gdrive:restore', gpath, destRel),
  },
  archive: {
    pick: () => ipcRenderer.invoke('archive:pick'),
    clear: () => ipcRenderer.invoke('archive:clear'),
    move: (rel) => ipcRenderer.invoke('archive:move', rel),
  },
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  pickFolder: () => ipcRenderer.invoke('lib:pick'),
  sync: {
    getState: () => ipcRenderer.invoke('sync:state'),
    setConfig: (patch) => ipcRenderer.invoke('sync:setConfig', patch),
    login: (a) => ipcRenderer.invoke('sync:login', a),
    verify: (a) => ipcRenderer.invoke('sync:verify', a),
    logout: () => ipcRenderer.invoke('sync:logout'),
    discover: () => ipcRenderer.invoke('sync:discover'),
    syncNow: () => ipcRenderer.invoke('sync:now'),
  },
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openUrl: (url) => ipcRenderer.invoke('app:open', url),
  onSync: (cb) => ipcRenderer.on('sync:updated', () => cb()),
});
