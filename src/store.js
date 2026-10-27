// Library storage: lives inside the chosen folder, in ".shelf/"
import { fileKind } from './parse.js';
import { toBlob, native } from './native.js';

const META_DIR = '.shelf';
const LIB_FILE = 'library.json';

/* ---------- tiny IndexedDB key/value (remembers the folder handle) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('shelf-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvGet(k) {
  try {
    const db = await idb();
    return await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(undefined); });
  } catch { return undefined; }
}
export async function kvSet(k, v) {
  try {
    const db = await idb();
    await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; });
  } catch { }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function baseName(path) { return path.split('/').pop(); }
export function dirName(path) { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
export function stripExt(name) { return name.replace(/\.gcode\.3mf$/i, '').replace(/\.(stl|3mf)$/i, ''); }
export function prettyName(name) {
  return stripExt(name).replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export class Library {
  constructor(root) {
    this.root = root;
    this.data = null;
    this.handles = new Map(); // path -> FileSystemFileHandle
    this.saveTimer = null;
    this.thumbURLs = new Map();
    this.listeners = new Set();
  }

  async init() {
    this.meta = await this.root.getDirectoryHandle(META_DIR, { create: true });
    this.thumbs = await this.meta.getDirectoryHandle('thumbs', { create: true });
    let data = null;
    try {
      const fh = await this.meta.getFileHandle(LIB_FILE);
      const txt = await (await fh.getFile()).text();
      data = JSON.parse(txt);
      // one rolling backup per session
      const bk = await this.meta.getFileHandle('library.backup.json', { create: true });
      const w = await bk.createWritable();
      await w.write(txt);
      await w.close();
    } catch { }
    this.data = data && data.models ? data : { app: 'shelf', schema: 1, created: new Date().toISOString(), models: {}, files: {}, tagColors: {} };
    if (!this.data.files) this.data.files = {};
    if (!this.data.tagColors) this.data.tagColors = {};
  }

  /* ---------- scanning ---------- */
  async walk(dir, prefix, out, progress) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.') || name === '$RECYCLE.BIN' || name === 'node_modules') continue;
      const path = prefix ? prefix + '/' + name : name;
      if (h.kind === 'directory') await this.walk(h, path, out, progress);
      else if (fileKind(name)) {
        out.push({ path, handle: h });
        if (progress && out.length % 25 === 0) progress(out.length);
      }
    }
  }

  async scan(progress) {
    const found = [];
    await this.walk(this.root, '', found, progress);
    if (this.archive) { try { await this.walk(this.archive, '@archive', found, progress); } catch (e) { this.emit('archive-error', e); } }
    const infos = [];
    for (const f of found) {
      try {
        const file = await f.handle.getFile();
        infos.push({ path: f.path, handle: f.handle, size: file.size, mtime: file.lastModified });
      } catch { }
    }
    return this.reconcile(infos);
  }

  reconcile(infos) {
    const D = this.data;
    this.handles.clear();
    const present = new Map(infos.map((i) => [i.path, i]));
    for (const i of infos) this.handles.set(i.path, i.handle);
    const owned = new Map(); // path -> modelId
    for (const m of Object.values(D.models)) for (const v of m.versions) owned.set(v.path, m.id);

    // which known paths disappeared?
    const missing = [];
    for (const [path, mid] of owned) if (!present.has(path) && !path.startsWith('@gdrive/')) missing.push({ path, mid, info: D.files[path] || {} });
    const fresh = infos.filter((i) => !owned.has(i.path));
    let added = 0, moved = 0;

    for (const f of fresh) {
      // moved/renamed file? match on (name + size) or (folder + size + mtime)
      const idx = missing.findIndex((m) => m.info.size === f.size && (baseName(m.path) === baseName(f.path) || (dirName(m.path) === dirName(f.path) && m.info.mtime === f.mtime)));
      if (idx >= 0) {
        const mm = missing.splice(idx, 1)[0];
        const model = D.models[mm.mid];
        const ver = model.versions.find((v) => v.path === mm.path);
        ver.path = f.path;
        if (model.current === mm.path) model.current = f.path;
        for (const p of model.prints) if (p.versionPath === mm.path) p.versionPath = f.path;
        D.files[f.path] = { ...D.files[mm.path], size: f.size, mtime: f.mtime, missing: false };
        delete D.files[mm.path];
        moved++;
        continue;
      }
      const id = uid();
      const now = new Date().toISOString();
      D.models[id] = {
        id, name: prettyName(baseName(f.path)), nameAuto: true, tags: [], notes: '', favorite: false, current: f.path,
        versions: [{ path: f.path, added: new Date(f.mtime || Date.now()).toISOString(), note: '' }],
        prints: [], created: now, updated: now,
      };
      D.files[f.path] = { size: f.size, mtime: f.mtime };
      added++;
    }
    for (const m of missing) { if (D.files[m.path]) D.files[m.path].missing = true; }
    for (const i of infos) {
      const rec = D.files[i.path] || (D.files[i.path] = {});
      if (rec.size !== i.size || rec.mtime !== i.mtime) { rec.size = i.size; rec.mtime = i.mtime; rec.stale = true; }
      rec.missing = false;
    }
    this.save();
    return { total: infos.length, added, moved, missing: missing.length };
  }

  /* ---------- persistence ---------- */
  save(now = false) {
    clearTimeout(this.saveTimer);
    const run = async () => {
      try {
        const fh = await this.meta.getFileHandle(LIB_FILE, { create: true });
        const w = await fh.createWritable();
        this.data.saved = new Date().toISOString();
        await w.write(JSON.stringify(this.data, null, 1));
        await w.close();
        this.emit('saved');
      } catch (e) { this.emit('save-error', e); }
    };
    if (now) return run();
    this.saveTimer = setTimeout(run, 400);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, d) { for (const fn of this.listeners) fn(type, d); }

  /* ---------- files ---------- */
  async getFile(path) {
    if (path.startsWith('@gdrive/')) { // archived in Google Drive: fetched on demand by the app
      const r = this.data.files[path] || {};
      return { name: baseName(path), size: r.size || 0, lastModified: r.mtime || 0, type: '', arrayBuffer: () => native.fs.read(path), text: async () => new TextDecoder().decode(await native.fs.read(path)) };
    }
    let h = this.handles.get(path);
    if (!h) h = await this.resolveHandle(path);
    return h.getFile();
  }
  async resolveHandle(path, create = false) {
    let parts = path.split('/');
    let dir = this.root;
    if (parts[0] === '@archive' && this.archive) { dir = this.archive; parts = parts.slice(1); }
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create });
    const h = await dir.getFileHandle(parts[parts.length - 1], { create });
    this.handles.set(path, h);
    return h;
  }
  async exists(path) {
    try { await this.resolveHandle(path); return true; } catch { return false; }
  }
  async uniquePath(dir, name) {
    const ext = /\.gcode\.3mf$/i.test(name) ? name.slice(-10) : name.slice(name.lastIndexOf('.'));
    const stem = name.slice(0, name.length - ext.length);
    let candidate = name, n = 2;
    while (await this.exists(dir ? dir + '/' + candidate : candidate)) candidate = `${stem} (${n++})${ext}`;
    return dir ? dir + '/' + candidate : candidate;
  }
  // copy a dropped/picked File into the library
  async importFile(file, dir = '', name = file.name) {
    const path = await this.uniquePath(dir, name);
    const h = await this.resolveHandle(path, true);
    const w = await h.createWritable();
    await w.write(file);
    await w.close();
    const f = await h.getFile();
    return { path, size: f.size, mtime: f.lastModified };
  }

  /* ---------- thumbnails ---------- */
  thumbKey(path) {
    const r = this.data.files[path];
    return r ? `${r.size}-${r.mtime}` : '';
  }
  async writeThumb(path, blob) {
    const name = uid() + '.png';
    const h = await this.thumbs.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    const rec = this.data.files[path];
    const old = rec.thumb;
    rec.thumb = name;
    rec.thumbKey = this.thumbKey(path);
    if (old && old !== name) { try { await this.thumbs.removeEntry(old); } catch { } }
    if (this.thumbURLs.has(path)) { URL.revokeObjectURL(this.thumbURLs.get(path)); this.thumbURLs.delete(path); }
    this.save();
  }
  async writePlateThumb(path, plate, blob) {
    const name = uid() + '.png';
    const h = await this.thumbs.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    const rec = this.data.files[path];
    rec.plateThumbs = rec.plateThumbs || {};
    const old = rec.plateThumbs[plate];
    rec.plateThumbs[plate] = name;
    if (old && old !== name) { try { await this.thumbs.removeEntry(old); } catch { } }
    this.thumbURLs.delete(path + '#' + plate);
    this.save();
  }
  async plateThumbURL(path, plate) {
    const key = path + '#' + plate;
    if (this.thumbURLs.has(key)) return this.thumbURLs.get(key);
    const name = this.data.files[path]?.plateThumbs?.[plate];
    if (!name) return this.thumbURL(path);
    try {
      const f = await (await this.thumbs.getFileHandle(name)).getFile();
      const url = URL.createObjectURL(await toBlob(f, 'image/png'));
      this.thumbURLs.set(key, url);
      return url;
    } catch { return this.thumbURL(path); }
  }
  async thumbURL(path) {
    if (this.thumbURLs.has(path)) return this.thumbURLs.get(path);
    const rec = this.data.files[path];
    if (!rec || !rec.thumb) return null;
    try {
      const f = await (await this.thumbs.getFileHandle(rec.thumb)).getFile();
      const url = URL.createObjectURL(await toBlob(f, 'image/png'));
      this.thumbURLs.set(path, url);
      return url;
    } catch { rec.thumb = null; return null; }
  }
  needsThumb(path) {
    const r = this.data.files[path];
    if (!r || r.missing) return false;
    const key = this.thumbKey(path);
    if (r.failed === key) return false;
    return !r.thumb || r.thumbKey !== key || r.metaKey !== key || r.tv !== 3;
  }
}
