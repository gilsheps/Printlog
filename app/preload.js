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
  useCloud: () => ipcRenderer.invoke('lib:useCloud'),
  getLibrary: () => ipcRenderer.invoke('lib:get'),
  pickFolder: () => ipcRenderer.invoke('lib:pick'),
  sync: {
    getState: () => ipcRenderer.invoke('sync:state'),
    setConfig: (patch) => ipcRenderer.invoke('sync:setConfig', patch),
    login: (a) => ipcRenderer.invoke('sync:login', a),
    fetchModel: (key) => ipcRenderer.invoke('sync:fetchModel', key),
    prefetch: (keys) => ipcRenderer.invoke('sync:prefetch', keys),
    modelsSize: () => ipcRenderer.invoke('sync:modelsSize'),
    onModel: (cb) => ipcRenderer.on('model-progress', (_e, ev) => cb(ev)),
    verify: (a) => ipcRenderer.invoke('sync:verify', a),
    logout: () => ipcRenderer.invoke('sync:logout'),
    discover: () => ipcRenderer.invoke('sync:discover'),
    syncNow: () => ipcRenderer.invoke('sync:now'),
  },
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  wipe: (o) => ipcRenderer.invoke('app:wipe', o),
  installUpdate: (url) => ipcRenderer.invoke('app:installUpdate', url),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  openUrl: (url) => ipcRenderer.invoke('app:open', url),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  onSync: (cb) => ipcRenderer.on('sync:updated', () => cb()),
});
