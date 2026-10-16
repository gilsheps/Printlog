// Import of prints recorded by the Shelf Sync helper (.shelf/printer-sync.json)
import { uid, baseName } from './store.js';

export const SYNC_FILE = 'printer-sync.json';

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(gcode\.3mf|3mf|stl|gcode)$/i, '')
    .replace(/[\s_-]*plate[\s_-]*\d+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export async function readSyncFile(lib) {
  try {
    const fh = await lib.meta.getFileHandle(SYNC_FILE);
    const f = await fh.getFile();
    if (lib._syncMtime === f.lastModified && lib._sync) return { data: lib._sync, changed: false };
    const data = JSON.parse(await f.text());
    lib._syncMtime = f.lastModified;
    lib._sync = data;
    return { data, changed: true };
  } catch {
    return { data: null, changed: false };
  }
}

// Bambu "titles" that are really print-profile names ("0.2mm layer, 2 walls, 15% infill")
const GENERIC = /(\d+(\.\d+)?\s*mm\s*(layer|层高))|\bwalls?\b|\binfill\b|填充|层墙|^standard settings$|^v\s*\d+(\.\d+)*\s*$|^plate\s*\d+$|^untitled$/i;
const isGeneric = (t) => !t || GENERIC.test(String(t).trim());
const baseKey = (path) => norm(baseName(path).replace(/\(\d+\)(?=\.[^.]+$|\.gcode\.3mf$)/i, ''));

function buildIndex(lib) {
  const mk = () => new Map();
  const idx = { file: mk(), user: mk(), design: mk() };
  const add = (map, k, id) => {
    const n = norm(k);
    if (!n || n.length < 2) return;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n).add(id);
  };
  for (const m of Object.values(lib.data.models)) {
    if (!m.nameAuto) add(idx.user, norm(m.name), m.id);
    for (const a of m.aliases || []) add(idx.user, norm(a), m.id);
    for (const v of m.versions) {
      add(idx.file, norm(baseName(v.path)), m.id);
      add(idx.file, baseKey(v.path), m.id);
      const t = lib.data.files[v.path]?.meta?.title;
      if (t) add(idx.design, norm(t), m.id);
    }
  }
  return idx;
}

function tokens(s) { return new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)); }

// choose among several candidate models: name overlap with the print title, then file time
function pickBest(lib, ids, entry) {
  if (ids.length === 1) return lib.data.models[ids[0]];
  const tt = tokens(entry.title);
  const t = Date.parse(entry.start || '') || Date.now();
  let best = null, bestScore = -1, bestD = Infinity;
  for (const id of ids) {
    const m = lib.data.models[id];
    let score = 0, d = Infinity;
    for (const v of m.versions) {
      const ft = tokens(baseName(v.path).replace(/\.(gcode\.3mf|3mf|stl)$/i, ''));
      let s = 0;
      for (const w of tt) if (ft.has(w)) s++;
      score = Math.max(score, s);
      const mt = lib.data.files[v.path]?.mtime || 0;
      if (t - mt >= 0) d = Math.min(d, t - mt);
    }
    if (score > bestScore || (score === bestScore && d < bestD)) { best = m; bestScore = score; bestD = d; }
  }
  return best;
}

export function matchModel(lib, entry, idx = buildIndex(lib)) {
  const title = isGeneric(entry.title) ? '' : entry.title;
  const fileT = entry.file ? baseName(entry.file) : '';
  const names = [title, fileT].filter(Boolean).map(norm).filter((n) => n.length >= 2);
  const look = (map, keys) => { for (const k of keys) if (map.has(k)) return [...map.get(k)]; return null; };
  // 1. the print's name is a file in the library (e.g. "Enderman" -> Enderman.3mf)
  let ids = look(idx.file, names);
  // 2. a name the user gave the model, or a print title they assigned before
  if (!ids) ids = look(idx.user, [...names, norm(entry.title)].filter(Boolean));
  // 3. the MakerWorld design title stored in the 3MF
  if (!ids && entry.design) ids = look(idx.design, [norm(entry.design)]);
  if (!ids && !title && entry.design) ids = look(idx.file, [norm(entry.design)]);
  // 4. fuzzy: one file name contains the other
  if (!ids) {
    let best = null, bestLen = 0;
    for (const c of names.filter((c) => c.length >= 5)) {
      for (const [k, set] of idx.file) {
        if (k.length < 5) continue;
        if (c.includes(k) || k.includes(c)) {
          const l = Math.min(k.length, c.length);
          if (l > bestLen) { bestLen = l; best = [...set]; }
        }
      }
    }
    ids = best;
  }
  if (!ids || !ids.length) return null;
  return pickBest(lib, ids, entry);
}

export const STATUS = { 2: 'ok', 3: 'cancel', 4: 'fail' };
export const entryResult = (e) => (e.source === 'cloud' && e.rawStatus != null ? STATUS[e.rawStatus] || 'unknown' : e.result);

const BED = { textured_plate: 'Textured PEI Plate', cool_plate: 'Cool Plate', eng_plate: 'Engineering Plate', hot_plate: 'High Temp Plate', pei_plate: 'PEI Plate', supertack_plate: 'SuperTack Plate' };

function localDate(iso) {
  const d = new Date(iso || Date.now());
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function entryToPrint(lib, m, e) {
  const fil = e.filaments || [];
  const r = entryResult(e);
  const result = r === 'ok' || r === 'cancel' || r === 'fail' ? r : 'partial';
  const notes = [];
  if (r === 'unknown') notes.push(`סטטוס לא ידוע מהענן (${e.rawStatus})`);
  if (e.error) notes.push(`קוד שגיאה מהמדפסת: ${e.error}`);
  // which version was current at print time
  const t = Date.parse(e.start || '') || Date.now();
  let versionPath = m.current || m.versions[m.versions.length - 1].path;
  let bestMt = -1;
  for (const v of m.versions) {
    const mt = lib.data.files[v.path]?.mtime || 0;
    if (mt <= t && mt > bestMt) { bestMt = mt; versionPath = v.path; }
  }
  return {
    id: uid(), key: e.key, source: e.source === 'cloud' ? 'cloud' : 'printer',
    date: localDate(e.start), at: e.start || new Date().toISOString(), result,
    versionPath,
    material: [...new Set(fil.map((f) => f.type).filter(Boolean))].join(' + '),
    color: fil[0]?.color || '',
    plate: BED[e.bed] || e.bed || '',
    minutes: e.minutes || '', grams: e.grams || (fil.reduce((a, f) => a + (f.grams || 0), 0) || ''),
    printer: e.printer || '',
    plateNo: e.plate || '',
    notes: notes.join(' · '),
  };
}

/**
 * Bring helper-recorded prints into the library.
 * Returns { added, updated, unmatched: [entries] }
 */
export function importPrints(lib, sync) {
  const D = lib.data;
  D.imported = D.imported || {};
  const res = { added: 0, updated: 0, unmatched: [] };
  if (!sync || !Array.isArray(sync.prints)) return res;
  // v2 matching: redo automatic matches made by the old rules (keep what the user assigned by hand)
  if ((D.importVer || 1) < 2) {
    for (const m of Object.values(D.models)) {
      const al = new Set((m.aliases || []).map(norm));
      m.prints = m.prints.filter((p) => {
        if (!p.key || !/^(cloud|live)-/.test(p.key)) return true;
        const e = sync.prints.find((x) => x.key === p.key || (x.aliasKeys || []).includes(p.key));
        return e && (al.has(norm(e.title)) || al.has(norm(e.design)));
      });
    }
    for (const k of Object.keys(D.imported)) if (D.imported[k] !== 'ignored') { const m = D.models[D.imported[k]]; if (!m || !m.prints.some((p) => p.key === k)) delete D.imported[k]; }
    D.importVer = 2;
    res.updated++;
  }
  const idx = buildIndex(lib);
  const findPrint = (key) => {
    const mid = D.imported[key];
    const m = mid && D.models[mid];
    if (!m) return null;
    const p = m.prints.find((x) => x.key === key);
    return p ? { m, p } : null;
  };
  for (const e of sync.prints) {
    if (!e || !e.key || e.result === 'running') continue;
    if (D.imported[e.key] === 'ignored') continue;
    if (D.imported[e.key] && D.models[D.imported[e.key]]) continue;
    // already imported under an older (live) key? -> enrich that record
    let done = false;
    for (const ak of e.aliasKeys || []) {
      if (D.imported[ak] === 'ignored') { D.imported[e.key] = 'ignored'; done = true; break; }
      const hit = findPrint(ak);
      if (hit) {
        const fresh = entryToPrint(lib, hit.m, e);
        Object.assign(hit.p, { ...fresh, id: hit.p.id, notes: [hit.p.notes, fresh.notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · '), versionPath: hit.p.versionPath });
        D.imported[e.key] = hit.m.id;
        res.updated++;
        done = true;
        break;
      }
    }
    if (done) continue;
    const m = (D.imported[e.key] && D.models[D.imported[e.key]]) || matchModel(lib, e, idx);
    if (!m) { res.unmatched.push(e); continue; }
    attach(lib, m, e);
    res.added++;
  }
  return res;
}

export function attach(lib, m, e) {
  const D = lib.data;
  const rec = entryToPrint(lib, m, e);
  // the same print logged by hand that day? merge instead of duplicating
  const manual = m.prints.find((p) => !p.key && p.date === rec.date && (p.result === rec.result || p.result !== 'ok' && rec.result !== 'ok'));
  if (manual) {
    Object.assign(manual, { key: rec.key, source: rec.source, at: rec.at, minutes: manual.minutes || rec.minutes, grams: manual.grams || rec.grams, material: manual.material || rec.material, color: manual.color || rec.color, printer: rec.printer, notes: [manual.notes, rec.notes].filter(Boolean).join(' · ') });
  } else {
    m.prints.push(rec);
  }
  D.imported[e.key] = m.id;
  m.updated = new Date().toISOString();
}
