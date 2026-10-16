'use strict';
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Engine, discover } = require('./engine');

app.setName('Model Shelf');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const CFG_FILE = path.join(app.getPath('userData'), 'config.json');
let win = null, tray = null, quitting = false, engine = null, lastSync = null;

/* ---------------- config (token encrypted with the OS keychain when possible) */
function readCfg() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { }
  if (c.cloud && c.cloud.tokenEnc) {
    try { c.cloud.token = safeStorage.decryptString(Buffer.from(c.cloud.tokenEnc, 'base64')); } catch { c.cloud.token = ''; }
  }
  c.options = { notify: true, openAtLogin: false, intervalMin: 10, ...(c.options || {}) };
  c.mode = c.mode || 'off';
  c.printers = c.printers || [];
  return c;
}
function writeCfg(c) {
  const copy = JSON.parse(JSON.stringify(c));
  if (copy.cloud && copy.cloud.token) {
    if (safeStorage.isEncryptionAvailable()) { copy.cloud.tokenEnc = safeStorage.encryptString(copy.cloud.token).toString('base64'); delete copy.cloud.token; }
  }
  fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(copy, null, 2), { mode: 0o600 });
}
let CFG = null;
const cfg = () => CFG || (CFG = readCfg());
const saveCfg = (c) => { CFG = c; writeCfg(c); };

/* ---------------- file access, confined to the library folder */
function resolveRel(rel) {
  const root = cfg().library;
  if (!root) throw new Error('no library');
  const p = path.resolve(root, ...String(rel || '').split('/').filter(Boolean));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('outside library');
  return p;
}
ipcMain.handle('fs:list', async (_e, rel) => {
  const ents = await fs.promises.readdir(resolveRel(rel), { withFileTypes: true });
  return ents.filter((d) => d.isDirectory() || d.isFile()).map((d) => ({ name: d.name, dir: d.isDirectory() }));
});
ipcMain.handle('fs:stat', async (_e, rel) => {
  try { const s = await fs.promises.stat(resolveRel(rel)); return { size: s.size, mtime: Math.round(s.mtimeMs), dir: s.isDirectory() }; } catch { return null; }
});
ipcMain.handle('fs:read', async (_e, rel) => {
  const b = await fs.promises.readFile(resolveRel(rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.handle('fs:write', async (_e, rel, data) => {
  const p = resolveRel(rel);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.shelf-tmp';
  await fs.promises.writeFile(tmp, Buffer.from(data));
  await fs.promises.rename(tmp, p);
});
ipcMain.handle('fs:mkdir', async (_e, rel) => { await fs.promises.mkdir(resolveRel(rel), { recursive: true }); });
ipcMain.handle('fs:remove', async (_e, rel) => {
  const p = resolveRel(rel);
  // only the app's own data folder may be deleted from - never the user's models
  if (!p.includes(path.sep + '.shelf' + path.sep)) throw new Error('refusing to delete outside .shelf');
  await fs.promises.rm(p, { recursive: true, force: true });
});

/* ---------------- library + settings */
ipcMain.handle('lib:get', () => { const l = cfg().library; return l && fs.existsSync(l) ? { path: l, name: path.basename(l) } : null; });
ipcMain.handle('lib:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'בחר את תיקיית המודלים', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = cfg();
  c.library = path.resolve(r.filePaths[0]);
  saveCfg(c);
  engine.start();
  return { path: c.library, name: path.basename(c.library) };
});
const publicState = () => {
  const c = cfg();
  return {
    version: app.getVersion(), platform: process.platform, library: c.library || '', mode: c.mode,
    cloud: c.cloud ? { email: c.cloud.email, region: c.cloud.region, loggedIn: !!c.cloud.token } : null,
    printers: c.printers.map((p) => ({ serial: p.serial, name: p.name, model: p.model, ip: p.ip || '', access_code: p.access_code || '' })),
    options: c.options,
  };
};
ipcMain.handle('sync:state', () => publicState());
ipcMain.handle('sync:setConfig', (_e, patch) => {
  const c = cfg();
  if (patch.mode) c.mode = patch.mode;
  if (Array.isArray(patch.printers)) {
    const old = Object.fromEntries(c.printers.map((p) => [p.serial, p]));
    c.printers = patch.printers.filter((p) => p.serial).map((p) => ({ ...(old[p.serial] || {}), ...p }));
  }
  if (patch.options) c.options = { ...c.options, ...patch.options };
  saveCfg(c);
  applyLogin();
  engine.start();
  updateTray();
  return publicState();
});
ipcMain.handle('sync:login', (_e, a) => engine.login(a));
ipcMain.handle('sync:verify', (_e, a) => engine.verify(a));
ipcMain.handle('sync:logout', () => { const c = cfg(); if (c.cloud) { delete c.cloud.token; delete c.cloud.tokenEnc; } saveCfg(c); engine.start(); return publicState(); });
ipcMain.handle('sync:discover', () => discover());
ipcMain.handle('sync:now', () => engine.loopHistory(false));

/* ---------------- window, tray, notifications */
function iconPath(name) { return path.join(__dirname, 'assets', name); }
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 520, show: false, title: 'המדף · Model Shelf',
    backgroundColor: '#141413', icon: iconPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu?.();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); if (process.platform === 'darwin') app.dock?.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}
function showWindow() {
  if (!win || win.isDestroyed()) createWindow(true);
  if (process.platform === 'darwin') app.dock?.show();
  win.show();
  win.focus();
}
function printerSummary() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(cfg().library, '.shelf', 'printer-sync.json'), 'utf8'));
    const p = Object.values(d.printers || {})[0];
    if (!p) return '';
    const st = { running: 'מדפיס', prepare: 'מתכונן', pause: 'מושהה', finish: 'סיים', failed: 'נכשל', idle: 'פנוי', offline: 'לא מחובר' }[p.state] || p.state || '';
    return `${p.name}: ${st}${p.state === 'running' && p.progress != null ? ` ${p.progress}%` : ''}${p.job && ['running', 'pause', 'prepare'].includes(p.state) ? ` · ${p.job}` : ''}`;
  } catch { return ''; }
}
function updateTray() {
  if (!tray) return;
  const s = printerSummary();
  tray.setToolTip(s ? `המדף · ${s}` : 'המדף');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתח את המדף', click: showWindow },
    ...(s ? [{ label: s, enabled: false }] : []),
    { type: 'separator' },
    { label: 'סנכרן עכשיו', enabled: cfg().mode === 'cloud' || cfg().mode === 'both', click: () => engine.loopHistory(false) },
    { label: 'יציאה', click: () => { quitting = true; app.quit(); } },
  ]));
}
function notify(e) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: e.result === 'ok' ? 'ההדפסה הסתיימה' : e.result === 'cancel' ? 'ההדפסה בוטלה' : 'ההדפסה נכשלה', body: `${e.title || 'הדפסה'}${e.printer ? ' · ' + e.printer : ''}`, silent: false });
  n.on('click', showWindow);
  n.show();
}
function applyLogin() {
  if (process.platform === 'linux') return;
  app.setLoginItemSettings({ openAtLogin: !!cfg().options.openAtLogin, openAsHidden: true, args: ['--hidden'] });
}

app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; engine && engine.stop(); });
app.on('window-all-closed', () => { /* keep running in the tray */ });

app.whenReady().then(() => {
  engine = new Engine({
    getConfig: () => cfg(),
    saveConfig: saveCfg,
    notify,
    onWrite: () => {
      if (Date.now() - (lastSync || 0) > 500) { lastSync = Date.now(); win && !win.isDestroyed() && win.webContents.send('sync:updated'); }
      updateTray();
    },
    log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
  });
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden;
  createWindow(!hidden);
  if (hidden && process.platform === 'darwin') app.dock?.hide();
  const trayImg = nativeImage.createFromPath(iconPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') trayImg.setTemplateImage(true);
  tray = new Tray(trayImg);
  tray.on('click', () => { if (process.platform !== 'darwin') showWindow(); });
  updateTray();
  applyLogin();
  engine.start();
});
