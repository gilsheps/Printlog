// Parsing of STL and 3MF files (geometry + Bambu/Orca/Prusa metadata)
import { unzipSync, strFromU8 } from 'fflate';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Matrix4, Vector3 } from 'three';

const DEFAULT_COLOR = '#c9ced6';

export function fileKind(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.gcode.3mf')) return 'gcode3mf';
  if (n.endsWith('.3mf')) return '3mf';
  if (n.endsWith('.stl')) return 'stl';
  return null;
}

/* ---------------- STL ---------------- */
export function parseSTL(buffer) {
  const geom = new STLLoader().parse(buffer);
  const pos = geom.getAttribute('position').array;
  return { parts: [{ positions: pos instanceof Float32Array ? pos : new Float32Array(pos), color: DEFAULT_COLOR }], meta: {} };
}

/* ---------------- big-model helpers ---------------- */
// growable typed arrays: huge meshes (millions of triangles) never go through plain JS number arrays
class Grow {
  constructor(T, n = 4096) { this.T = T; this.a = new T(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  push3(x, y, z) { this.need(3); const a = this.a; a[this.n++] = x; a[this.n++] = y; a[this.n++] = z; }
  push(x) { this.need(1); this.a[this.n++] = x; }
  out() { return this.a.slice(0, this.n); }
}

// vertex-clustering decimation: keeps the shape, drops detail, so very heavy models still open smoothly
function decimate(mesh, target) {
  const { verts, tris, paints } = mesh;
  const nt = tris.length / 3;
  if (nt <= target || nt < 5000) return mesh;
  let area = 0, mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z; if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
  }
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  let cell = Math.sqrt(area / (target / 2)) || 1;
  const ext = Math.max(mxx - mnx, mxy - mny, mxz - mnz) || 1;
  cell = Math.max(cell, ext / 100000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const K = Math.ceil(ext / cell) + 2;
    const map = new Map();
    const remap = new Uint32Array(verts.length / 3);
    const sum = new Grow(Float64Array, 1 << 16), cnt = new Grow(Uint32Array, 1 << 14);
    for (let i = 0, v = 0; i < verts.length; i += 3, v++) {
      const key = Math.floor((verts[i] - mnx) / cell) + Math.floor((verts[i + 1] - mny) / cell) * K + Math.floor((verts[i + 2] - mnz) / cell) * K * K;
      let id = map.get(key);
      if (id === undefined) { id = cnt.n; map.set(key, id); sum.push3(0, 0, 0); cnt.push(0); }
      sum.a[id * 3] += verts[i]; sum.a[id * 3 + 1] += verts[i + 1]; sum.a[id * 3 + 2] += verts[i + 2]; cnt.a[id]++;
      remap[v] = id;
    }
    const nt2 = new Grow(Uint32Array, Math.min(tris.length, target * 4)), np = paints ? new Grow(Uint8Array, target * 2) : null;
    for (let t = 0; t < tris.length; t += 3) {
      const a = remap[tris[t]], b = remap[tris[t + 1]], c = remap[tris[t + 2]];
      if (a === b || b === c || a === c) continue;
      nt2.push3(a, b, c);
      if (np) np.push(paints[t / 3]);
    }
    if (nt2.n / 3 > target * 1.4 && attempt < 3) { cell *= 1.3; continue; }
    const nv = new Float32Array(cnt.n * 3);
    for (let i = 0; i < cnt.n; i++) { const k = cnt.a[i]; nv[i * 3] = sum.a[i * 3] / k; nv[i * 3 + 1] = sum.a[i * 3 + 1] / k; nv[i * 3 + 2] = sum.a[i * 3 + 2] / k; }
    return { verts: nv, tris: nt2.out(), paints: np ? np.out() : null, decimatedFrom: nt };
  }
  return mesh;
}

/* ---------------- 3MF ---------------- */
function attrs(s) {
  const out = {};
  const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function parseTransform(t) {
  const m = new Matrix4();
  if (!t) return m;
  const v = t.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some(isNaN)) return m;
  // 3MF uses row vectors: x' = x*m00 + y*m10 + z*m20 + m30
  m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  return m;
}

function normPath(p) {
  if (!p) return null;
  return p.replace(/^\//, '');
}

// Bambu/Orca "paint_color" (and Prusa "slic3rpe:mmu_segmentation") per-triangle encoding.
// Returns the extruder state of a whole (unsplit) triangle, or the first leaf state for split ones; 0 = default.
function decodePaint(str) {
  if (!str) return 0;
  const nibbles = [];
  for (let i = str.length - 1; i >= 0; i--) {
    const n = parseInt(str[i], 16);
    if (isNaN(n)) return 0;
    nibbles.push(n);
  }
  let idx = 0;
  const readNode = () => {
    if (idx >= nibbles.length) return 0;
    const n = nibbles[idx++];
    const split = n & 3;
    if (split === 0) {
      let state = n >> 2;
      if (state === 3) state = 3 + (idx < nibbles.length ? nibbles[idx++] : 0);
      return state;
    }
    // split triangle: take the most common state among its children (first-level approximation)
    const counts = {};
    for (let c = 0; c <= split; c++) {
      const s = readNode();
      counts[s] = (counts[s] || 0) + 1;
    }
    let best = 0, bestN = -1;
    for (const k in counts) if (counts[k] > bestN) { bestN = counts[k]; best = +k; }
    return best;
  };
  try { return readNode(); } catch { return 0; }
}

function parseModelXml(xml) {
  const objects = new Map();
  const reObj = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = reObj.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[2];
    const obj = { id: a.id, type: a.type || 'model', mesh: null, components: [] };
    const meshStart = body.indexOf('<mesh');
    if (meshStart >= 0) {
      const verts = new Grow(Float32Array, 1 << 15);
      // fast path for the usual attribute order (x y z / v1 v2 v3), generic fallback otherwise
      const reVf = /<vertex x="([^"]*)" y="([^"]*)" z="([^"]*)"/g;
      let v;
      while ((v = reVf.exec(body))) verts.push3(+v[1] || 0, +v[2] || 0, +v[3] || 0);
      if (!verts.n) {
        const reV = /<vertex\b([^>]*)\/?>/g;
        while ((v = reV.exec(body))) {
          const s = v[1];
          const x = /\bx="([^"]+)"/.exec(s), y = /\by="([^"]+)"/.exec(s), z = /\bz="([^"]+)"/.exec(s);
          verts.push3(+(x && x[1]) || 0, +(y && y[1]) || 0, +(z && z[1]) || 0);
        }
      }
      const tris = new Grow(Uint32Array, 1 << 15);
      const paints = new Grow(Uint8Array, 1 << 14);
      let anyPaint = false;
      const reTf = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"([^>]*)>/g;
      let t;
      const paintOf = (s) => { if (!s || s.indexOf('="') < 0) return 0; const p = /(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(s); return p ? decodePaint(p[1]) : 0; };
      while ((t = reTf.exec(body))) {
        tris.push3(+t[1], +t[2], +t[3]);
        const st = paintOf(t[4]);
        if (st) anyPaint = true;
        paints.push(st);
      }
      if (!tris.n) {
        const reT = /<triangle\b([^>]*)\/?>/g;
        while ((t = reT.exec(body))) {
          const s = t[1];
          const v1 = /\bv1="(\d+)"/.exec(s), v2 = /\bv2="(\d+)"/.exec(s), v3 = /\bv3="(\d+)"/.exec(s);
          if (!v1 || !v2 || !v3) continue;
          tris.push3(+v1[1], +v2[1], +v3[1]);
          const st = paintOf(s);
          if (st) anyPaint = true;
          paints.push(st);
        }
      }
      obj.mesh = { verts: verts.out(), tris: tris.out(), paints: anyPaint ? paints.out() : null };
    }
    const reC = /<component\b([^>]*)\/?>/g;
    let c;
    while ((c = reC.exec(body))) {
      const ca = attrs(c[1]);
      obj.components.push({ objectid: ca.objectid, path: normPath(ca['p:path']), transform: parseTransform(ca.transform) });
    }
    objects.set(obj.id, obj);
  }
  const items = [];
  const buildM = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (buildM) {
    const reI = /<item\b([^>]*)\/?>/g;
    let i;
    while ((i = reI.exec(buildM[1]))) {
      const ia = attrs(i[1]);
      items.push({ objectid: ia.objectid, path: normPath(ia['p:path']), transform: parseTransform(ia.transform), printable: ia.printable !== '0' });
    }
  }
  const metadata = {};
  const reMeta = /<metadata\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/metadata>/g;
  const head = xml.length > 200000 ? xml.slice(0, 200000) : xml;
  while ((m = reMeta.exec(head))) metadata[m[1]] = decodeEntities(m[2].trim());
  return { objects, items, metadata };
}

function decodeEntities(s) {
  let prev;
  do { prev = s; s = decodeOnce(s); } while (s !== prev && /&(amp|lt|gt|quot|apos|#\d+);/.test(s));
  return s;
}
function decodeOnce(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
}

// Bambu/Orca: which build-plate each object sits on
function parsePlates(xml) {
  const plates = [];
  if (!xml) return plates;
  const reP = /<plate>([\s\S]*?)<\/plate>/g;
  let m;
  while ((m = reP.exec(xml))) {
    const b = m[1];
    const id = /key="plater_id"\s+value="(\d+)"/.exec(b);
    const name = /key="plater_name"\s+value="([^"]*)"/.exec(b);
    const objs = new Set();
    const reI = /<model_instance>([\s\S]*?)<\/model_instance>/g;
    let i;
    while ((i = reI.exec(b))) { const o = /key="object_id"\s+value="(\d+)"/.exec(i[1]); if (o) objs.add(o[1]); }
    if (id) plates.push({ id: +id[1], name: name ? decodeEntities(name[1]) : '', objects: objs });
  }
  return plates.sort((a, b) => a.id - b.id);
}

function parseModelSettings(xml) {
  // object id -> { extruder, parts: {partId: extruder}, name }
  const res = new Map();
  if (!xml) return res;
  const reObj = /<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = reObj.exec(xml))) {
    const body = m[2];
    const entry = { extruder: 0, parts: {}, name: '' };
    const partsRe = /<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g;
    let p;
    while ((p = partsRe.exec(body))) {
      const e = /key="extruder"\s+value="(\d+)"/.exec(p[2]);
      if (e) entry.parts[p[1]] = +e[1];
    }
    const stripped = body.replace(/<part[\s\S]*?<\/part>/g, '');
    const e = /key="extruder"\s+value="(\d+)"/.exec(stripped);
    if (e) entry.extruder = +e[1];
    const n = /key="name"\s+value="([^"]*)"/.exec(stripped);
    if (n) entry.name = decodeEntities(n[1]);
    res.set(m[1], entry);
  }
  return res;
}

function parseSliceInfo(xml) {
  if (!xml) return null;
  const plates = [];
  const reP = /<plate>([\s\S]*?)<\/plate>/g;
  let m;
  while ((m = reP.exec(xml))) {
    const b = m[1];
    const get = (k) => { const r = new RegExp('key="' + k + '"\\s+value="([^"]*)"').exec(b); return r ? r[1] : null; };
    const filaments = [];
    const reF = /<filament\b([^>]*)\/?>/g;
    let f;
    while ((f = reF.exec(b))) filaments.push(attrs(f[1]));
    plates.push({ index: get('index'), prediction: +get('prediction') || 0, weight: +get('weight') || 0, filaments });
  }
  return plates.length ? plates : null;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

export function summarizeSettings(settings, slice) {
  if (!settings && !slice) return null;
  const s = settings || {};
  const plate = slice && slice[0];
  const usedIds = plate && plate.filaments.length ? plate.filaments.map((f) => +f.id) : [1];
  const types = Array.isArray(s.filament_type) ? s.filament_type : s.filament_type ? [s.filament_type] : [];
  const colors = Array.isArray(s.filament_colour) ? s.filament_colour : [];
  const filaments = plate && plate.filaments.length
    ? plate.filaments.map((f) => ({ type: f.type || types[+f.id - 1] || '', color: f.color || colors[+f.id - 1] || '', grams: +f.used_g || 0 }))
    : usedIds.map((id) => ({ type: types[id - 1] || '', color: colors[id - 1] || '', grams: 0 })).filter((f) => f.type);
  const nozzle = Array.isArray(s.nozzle_temperature) ? s.nozzle_temperature[(usedIds[0] || 1) - 1] : s.nozzle_temperature;
  const bedKeyMap = { 'Textured PEI Plate': 'textured_plate_temp', 'Cool Plate': 'cool_plate_temp', 'Engineering Plate': 'eng_plate_temp', 'High Temp Plate': 'hot_plate_temp' };
  const bedKey = bedKeyMap[s.curr_bed_type] || 'hot_plate_temp';
  const bedArr = s[bedKey] || s.hot_plate_temp || s.bed_temperature;
  const bed = Array.isArray(bedArr) ? bedArr[(usedIds[0] || 1) - 1] : bedArr;
  return {
    printer: s.printer_model || first(s.printer_settings_id) || '',
    layer: s.layer_height || '',
    infill: s.sparse_infill_density || s.fill_density || '',
    walls: s.wall_loops || s.perimeters || '',
    supports: s.enable_support === '1' || s.support_material === '1',
    plateType: s.curr_bed_type || '',
    nozzle: nozzle || '',
    bed: bed || '',
    filaments,
    timeSec: plate ? plate.prediction : 0,
    byPlate: slice ? Object.fromEntries(slice.filter((p) => p.index).map((p) => [p.index, { timeSec: p.prediction, grams: p.weight }])) : {},
    grams: plate ? plate.weight : filaments.reduce((a, f) => a + f.grams, 0),
  };
}

// Light-weight: only metadata + embedded thumbnail (no mesh decoding of sub-models)
export function read3MFMeta(buffer) {
  const u8 = new Uint8Array(buffer);
  let files;
  try {
    files = unzipSync(u8, {
      filter: (f) => /^Metadata\/(plate_\d+\.png|thumbnail\.png|project_settings\.config|slice_info\.config|model_settings\.config|Slic3r_PE\.config)$/i.test(f.name)
        || /^Auxiliaries\/\.thumbnails\/thumbnail_(3mf|middle)\.png$/i.test(f.name)
        || (f.name === '3D/3dmodel.model' && f.originalSize < 4e6),
    });
  } catch (e) { return { error: String(e) }; }
  return extractMeta(files);
}

function extractMeta(files) {
  const meta = {};
  const thumbName = Object.keys(files).filter((n) => /plate_\d+\.png$/i.test(n)).sort()[0]
    || Object.keys(files).find((n) => /thumbnail_3mf\.png$/i.test(n))
    || Object.keys(files).find((n) => /thumbnail(_middle)?\.png$/i.test(n));
  if (thumbName) meta.thumbPng = files[thumbName];
  // build plates (each plate is its own print)
  let plates = files['Metadata/model_settings.config'] ? parsePlates(strFromU8(files['Metadata/model_settings.config'])).filter((p) => p.objects.size).map((p) => ({ id: p.id, name: p.name })) : [];
  if (plates.length < 2) {
    const ids = Object.keys(files).map((n) => /^Metadata\/plate_(\d+)\.png$/i.exec(n)).filter(Boolean).map((x) => +x[1]).sort((a, b) => a - b);
    plates = ids.length > 1 ? ids.map((id) => ({ id, name: '' })) : [];
  }
  meta.plates = plates.length > 1 ? plates : [];
  meta.plateThumbs = {};
  for (const n of Object.keys(files)) { const mm = /^Metadata\/plate_(\d+)\.png$/i.exec(n); if (mm && files[n].length > 200) meta.plateThumbs[+mm[1]] = files[n]; }
  let settings = null;
  if (files['Metadata/project_settings.config']) {
    try { settings = JSON.parse(strFromU8(files['Metadata/project_settings.config'])); } catch { }
  } else if (files['Metadata/Slic3r_PE.config']) {
    settings = {};
    for (const line of strFromU8(files['Metadata/Slic3r_PE.config']).split('\n')) {
      const mm = /^;\s*(\w+)\s*=\s*(.*)$/.exec(line);
      if (mm) settings[mm[1]] = mm[2].includes(';') ? mm[2].split(';') : mm[2];
    }
  }
  const slice = files['Metadata/slice_info.config'] ? parseSliceInfo(strFromU8(files['Metadata/slice_info.config'])) : null;
  meta.print = summarizeSettings(settings, slice);
  const area = settings && settings.printable_area;
  if (Array.isArray(area) && area.length >= 3) {
    const pts = area.map((s) => String(s).split('x').map(Number));
    meta.bed = { w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), d: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])) };
  }
  meta.filamentColors = settings && Array.isArray(settings.filament_colour) ? settings.filament_colour : null;
  if (files['3D/3dmodel.model']) {
    const head = strFromU8(files['3D/3dmodel.model'].subarray(0, 300000));
    const md = {};
    const re = /<metadata\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/metadata>/g;
    let m;
    while ((m = re.exec(head))) md[m[1]] = decodeEntities(m[2].trim());
    meta.title = md.Title || '';
    meta.designer = md.Designer || md.Author || '';
    meta.description = (md.Description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    meta.license = md.License || '';
  }
  return meta;
}

export function parse3MF(buffer, opts = {}) {
  const u8 = new Uint8Array(buffer);
  // unpack the small files now; the (possibly huge) .model files one at a time, only when needed
  const sizes = {};
  const files = unzipSync(u8, { filter: (f) => { sizes[f.name] = f.originalSize; return !/\.model$/i.test(f.name) || (f.name === '3D/3dmodel.model' && f.originalSize < 4e6); } });
  const names = Object.keys(sizes);
  const meta = extractMeta(files);
  // ~80 bytes of XML per triangle: estimate the total and thin out meshes beyond the budget
  const modelBytes = names.filter((n) => /\.model$/i.test(n)).reduce((a, n) => a + sizes[n], 0);
  const budget = opts.budget || 3e6;
  const ratio = Math.min(1, budget / Math.max(1, modelBytes / 80));
  const models = new Map();
  let decimated = 0;
  const getModel = (path) => {
    if (models.has(path)) return models.get(path);
    let parsed = { objects: new Map(), items: [], metadata: {} };
    if (path && names.includes(path)) {
      const f = files[path] || unzipSync(u8, { filter: (x) => x.name === path })[path];
      parsed = parseModelXml(strFromU8(f));
      if (ratio < 1) for (const o of parsed.objects.values()) if (o.mesh && o.mesh.tris.length) {
        const n0 = o.mesh.tris.length / 3;
        o.mesh = decimate(o.mesh, Math.max(3000, Math.floor(n0 * ratio)));
        if (o.mesh.decimatedFrom) decimated += n0 - o.mesh.tris.length / 3;
      }
    }
    models.set(path, parsed);
    return parsed;
  };
  const rootPath = names.find((n) => n.toLowerCase() === '3d/3dmodel.model')
    || names.find((n) => n.toLowerCase().endsWith('.model'));
  if (!rootPath) throw new Error('לא נמצא מודל בקובץ ה-3MF');
  const root = getModel(rootPath);
  const settingsXml = files['Metadata/model_settings.config'] ? strFromU8(files['Metadata/model_settings.config']) : null;
  const objSettings = parseModelSettings(settingsXml);
  const fcolors = meta.filamentColors || [];
  const colorFor = (ext) => (ext > 0 && fcolors[ext - 1] ? fcolors[ext - 1] : null);

  const plates = parsePlates(settingsXml);
  const plateOf = new Map();
  for (const pl of plates) for (const o of pl.objects) plateOf.set(o, pl.id);
  let curPlate = 0;
  const buckets = new Map(); // plate|color -> Grow(Float32Array)
  const bucket = (color) => {
    const k = curPlate + '|' + color;
    let b = buckets.get(k);
    if (!b) { b = new Grow(Float32Array, 1 << 15); buckets.set(k, b); }
    return b;
  };
  const v = new Vector3();
  let triCount = 0;

  const emitMesh = (mesh, matrix, baseExt) => {
    const { verts, tris, paints } = mesh;
    const baseColor = colorFor(baseExt) || (fcolors.length ? fcolors[0] : DEFAULT_COLOR);
    const base = bucket(baseColor);
    for (let t = 0; t < tris.length; t += 3) {
      const st = paints ? paints[t / 3] : 0;
      const g = st ? bucket(colorFor(st) || baseColor) : base;
      g.need(9);
      for (let k = 0; k < 3; k++) {
        const i = tris[t + k] * 3;
        v.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(matrix);
        g.a[g.n++] = v.x; g.a[g.n++] = v.y; g.a[g.n++] = v.z;
      }
    }
    triCount += tris.length / 3;
  };

  const visit = (objectid, path, matrix, depth, ext, topSettings) => {
    if (depth > 12) return;
    const model = getModel(path);
    const obj = model.objects.get(objectid);
    if (!obj) return;
    if (obj.mesh && obj.mesh.tris.length) emitMesh(obj.mesh, matrix, ext);
    for (const c of obj.components) {
      const childPath = c.path || path;
      let childExt = ext;
      if (topSettings && topSettings.parts[c.objectid]) childExt = topSettings.parts[c.objectid];
      visit(c.objectid, childPath, matrix.clone().multiply(c.transform), depth + 1, childExt, null);
    }
  };

  const items = root.items.length ? root.items : [...root.objects.values()].filter((o) => o.type !== 'support').map((o) => ({ objectid: o.id, path: null, transform: new Matrix4() }));
  for (const it of items) {
    const s = objSettings.get(it.objectid);
    curPlate = plateOf.get(it.objectid) || 0;
    visit(it.objectid, it.path || rootPath, it.transform.clone(), 0, s ? s.extruder : 0, s);
  }
  const parts = [...buckets.entries()].filter(([, g]) => g.n).map(([k, g]) => { const i = k.indexOf('|'); return { plate: +k.slice(0, i), color: k.slice(i + 1), positions: g.out() }; });
  const used = [...new Set(parts.map((p) => p.plate))].filter(Boolean).sort((a, b) => a - b);
  meta.plateCount = plates.length;
  meta.plates = used.length > 1 ? used.map((id) => ({ id, name: (plates.find((p) => p.id === id) || {}).name || '' })) : [];
  if (!parts.length) throw new Error('הקובץ לא מכיל גיאומטריה');
  if (!meta.title && root.metadata.Title) meta.title = root.metadata.Title;
  meta.triangles = triCount + decimated;
  if (decimated) meta.simplified = triCount;
  return { parts, meta };
}

export function parseModel(name, buffer, opts) {
  const k = fileKind(name);
  if (k === 'stl') return parseSTL(buffer);
  return parse3MF(buffer, opts);
}
