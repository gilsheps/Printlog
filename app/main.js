'use strict';
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Engine, discover } = require('./engine');

// Internal name stays 'Model Shelf' on purpose: settings and the encrypted Bambu sign-in are
// stored under it, so renaming the app (now PrintLog) keeps them. Shown name comes from productName.
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
  // 1.0.5: the app no longer stays in the background unless the user turns it on again
  if ((c.cfgVer || 0) < 2) { c.options.closeToTray = false; c.options.openAtLogin = false; c.cfgVer = 2; try { writeCfg(c); } catch { } }
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
  rel = String(rel || '');
  let root = cfg().library;
  // '@archive/…' = the cloud archive folder (e.g. inside Google Drive)
  if (rel === '@archive' || rel.startsWith('@archive/')) { root = cfg().options.archiveDir; rel = rel.slice(8); }
  if (!root) throw new Error('no library');
  const p = path.resolve(root, ...rel.split('/').filter(Boolean));
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
const inside = (a, b) => a === b || a.startsWith(b + path.sep);
ipcMain.handle('archive:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'בחר תיקיית ארכיון (מומלץ: בתוך Google Drive)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.resolve(r.filePaths[0]);
  const c = cfg();
  if (c.library && (inside(dir, c.library) || inside(c.library, dir))) return { error: 'תיקיית הארכיון לא יכולה להיות בתוך תיקיית המודלים (או להכיל אותה)' };
  c.options.archiveDir = dir;
  saveCfg(c);
  return { path: dir };
});
ipcMain.handle('archive:clear', () => { const c = cfg(); delete c.options.archiveDir; saveCfg(c); return true; });
// move a file from the models folder into the archive, keeping its sub-folder
ipcMain.handle('archive:move', async (_e, rel) => {
  if (!cfg().options.archiveDir) throw new Error('לא נבחרה תיקיית ארכיון');
  if (String(rel).startsWith('@archive')) return rel;
  const src = resolveRel(rel);
  const dst = resolveRel('@archive/' + rel);
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  let target = dst;
  for (let i = 2; fs.existsSync(target); i++) target = dst.replace(/(\.gcode\.3mf|\.[^.]+)$/i, ` (${i})$1`);
  try { await fs.promises.rename(src, target); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.promises.copyFile(src, target);
    const a = await fs.promises.stat(src), b = await fs.promises.stat(target);
    if (a.size !== b.size) throw new Error('ההעתקה לארכיון לא הושלמה');
    await fs.promises.unlink(src);
  }
  return '@archive/' + path.relative(cfg().options.archiveDir, target).split(path.sep).join('/');
});
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
    version: app.getVersion(), platform: process.platform, library: c.library || '', mode: c.mode, archiveDir: c.options.archiveDir || '',
    cloud: c.cloud ? { email: c.cloud.email, region: c.cloud.region, loggedIn: !!c.cloud.token } : null,
    printers: c.printers.map((p) => ({ serial: p.serial, name: p.name, model: p.model, ip: p.ip || '', access_code: p.access_code || '' })),
    options: { ...c.options, closeToTray: !!c.options.closeToTray },
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
ipcMain.handle('sync:now', async () => {
  const c = cfg();
  if (!c.cloud?.token || !(c.mode === 'cloud' || c.mode === 'both')) return { ok: false, skipped: true };
  if (!engine.out) engine.start();
  return engine.loopHistory(false);
});

/* ---------------- updates: compare with the latest GitHub Release ---------------- */
const RELEASES = 'https://api.github.com/repos/gilsheps/model-shelf/releases/latest';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
ipcMain.handle('app:checkUpdate', async () => {
  try {
    const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'model-shelf' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { current: app.getVersion(), error: r.status === 404 ? 'private' : `HTTP ${r.status}` };
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const asset = (j.assets || []).find((a) => process.platform === 'darwin' ? a.name.endsWith(`mac-${arch}.dmg`) : process.platform === 'win32' ? a.name.endsWith('.exe') : false);
    return { current: app.getVersion(), latest, update: !!latest && newer(latest, app.getVersion()), url: (asset && asset.browser_download_url) || j.html_url, page: j.html_url, notes: (j.body || '').slice(0, 1500) };
  } catch (e) { return { current: app.getVersion(), error: e.message }; }
});
ipcMain.handle('app:open', (_e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); });

/* ---------------- window, tray, notifications */
function iconPath(name) { return path.join(__dirname, 'assets', name); }
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 720, minHeight: 520, show: false, title: 'PrintLog',
    backgroundColor: '#141413', icon: iconPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu?.();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => {
    if (quitting) return;
    const c = cfg();
    const background = !!c.options.closeToTray; // default: closing the window quits
    if (!background) { quitting = true; app.quit(); return; }
    e.preventDefault();
    win.hide();
    if (process.platform === 'darwin') app.dock?.hide();
    if (!c.options.closeHintShown && Notification.isSupported()) {
      new Notification({ title: 'PrintLog ממשיך לרוץ ברקע', body: process.platform === 'darwin' ? 'כדי לרשום הדפסות גם כשהחלון סגור. ליציאה: ⌘Q, או מהאייקון בשורת התפריטים ← יציאה.' : 'כדי לרשום הדפסות גם כשהחלון סגור. ליציאה: האייקון במגש ← יציאה.' }).show();
      c.options.closeHintShown = true;
      saveCfg(c);
    }
  });
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
  tray.setToolTip(s ? `PrintLog · ${s}` : 'PrintLog');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'פתח את PrintLog', click: showWindow },
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
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'PrintLog', submenu: [{ role: 'about', label: 'אודות PrintLog' }, { type: 'separator' }, { role: 'hide', label: 'הסתר את PrintLog' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit', label: 'צא מ-PrintLog' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    app.setAboutPanelOptions({ applicationName: 'PrintLog', applicationVersion: app.getVersion() });
  }
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
