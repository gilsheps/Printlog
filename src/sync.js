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

function buildIndex(lib) {
  const idx = new Map();
  const add = (k, id) => {
    const n = norm(k);
    if (n.length < 2) return;
    if (!idx.has(n)) idx.set(n, new Set());
    idx.get(n).add(id);
  };
  for (const m of Object.values(lib.data.models)) {
    add(m.name, m.id);
    for (const a of m.aliases || []) add(a, m.id);
    for (const v of m.versions) {
      add(baseName(v.path), m.id);
      const t = lib.data.files[v.path]?.meta?.title;
      if (t) add(t, m.id);
    }
  }
  return idx;
}

export function matchModel(lib, entry, idx = buildIndex(lib)) {
  const cands = [entry.title, entry.file && baseName(entry.file), entry.design].filter(Boolean).map(norm).filter((n) => n.length >= 2);
  let ids = null;
  for (const c of cands) if (idx.has(c)) { ids = [...idx.get(c)]; break; }
  if (!ids) {
    // fuzzy: one name contains the other (long enough to be meaningful)
    let best = null, bestLen = 0;
    for (const c of cands.filter((c) => c.length >= 5)) {
      for (const [k, set] of idx) {
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
  if (ids.length === 1) return lib.data.models[ids[0]];
  // several models share the name - prefer the one whose file existed closest before the print
  const t = Date.parse(entry.start || '') || Date.now();
  let pick = ids[0], bestD = Infinity;
  for (const id of ids) {
    const m = lib.data.models[id];
    for (const v of m.versions) {
      const mt = lib.data.files[v.path]?.mtime || 0;
      const d = t - mt;
      if (d >= 0 && d < bestD) { bestD = d; pick = id; }
    }
  }
  return lib.data.models[pick];
}

const BED = { textured_plate: 'Textured PEI Plate', cool_plate: 'Cool Plate', eng_plate: 'Engineering Plate', hot_plate: 'High Temp Plate', pei_plate: 'PEI Plate', supertack_plate: 'SuperTack Plate' };

function localDate(iso) {
  const d = new Date(iso || Date.now());
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function entryToPrint(lib, m, e) {
  const fil = e.filaments || [];
  const result = e.result === 'ok' ? 'ok' : e.result === 'unknown' ? 'partial' : 'fail';
  const notes = [];
  if (e.result === 'cancel') notes.push('ההדפסה בוטלה');
  if (e.result === 'unknown') notes.push(`סטטוס לא ידוע מהענן (${e.rawStatus})`);
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
