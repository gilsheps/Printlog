// Print-sync engine for the desktop app (port of shelf_sync.py).
// Bambu Cloud: login, history (my/tasks), live via cloud MQTT.
// LAN: SSDP discovery + live via the printer's local MQTT.
'use strict';
const tls = require('tls');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const API = {
  login: 'https://api.bambulab.com/v1/user-service/user/login',
  tfa: 'https://bambulab.com/api/sign-in/tfa',
  csrf: 'https://bambulab.com/api/csrf',
  emailCode: 'https://api.bambulab.com/v1/user-service/user/sendemail/code',
  bind: 'https://api.bambulab.com/v1/iot-service/api/user/bind',
  tasks: 'https://api.bambulab.com/v1/user-service/my/tasks',
  preference: 'https://api.bambulab.com/v1/design-user-service/my/preference',
  projects: 'https://api.bambulab.com/v1/iot-service/api/user/project',
  instance: 'https://api.bambulab.com/v1/design-service/instance',
};
// find a downloadable 3MF link anywhere inside an API response
function find3mfUrl(obj) {
  let best = '';
  const walk = (v, k) => {
    if (best) return;
    if (typeof v === 'string') { if (/^https?:\/\//.test(v) && (/\.3mf(\?|$)/i.test(v) || /^(url|file_?url|download_?url|model_?url)$/i.test(k || ''))) best = v; return; }
    if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  walk(obj, '');
  return best;
}
// matches Bambu Studio's Print History: 2 = Success, 3 = Canceled
const TASK_STATUS = { 0: 'running', 1: 'running', 2: 'ok', 3: 'cancel', 4: 'fail' };
const OUT_NAME = 'printer-sync.json';

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const parseT = (s) => { const t = Date.parse(s || ''); return isNaN(t) ? null : t; };
const close = (a, b, ms) => { const x = parseT(a), y = parseT(b); return x != null && y != null && Math.abs(x - y) <= ms; };
const normT = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const colorHex = (c) => { c = String(c || '').replace('#', ''); return c.length >= 6 ? '#' + c.slice(0, 6).toUpperCase() : ''; };

class CloudError extends Error {}
class AuthExpired extends CloudError {}

/* ---------------------------------------------------------------- cloud */
class BambuCloud {
  constructor(region = 'global', token = '') { this.region = region; this.token = token; }
  url(k) {
    const u = API[k];
    if (process.env.PRINTLOG_BAMBU_TEST_BASE) return u.replace(/^https:\/\/[^/]+/, process.env.PRINTLOG_BAMBU_TEST_BASE); // tests only
    return this.region === 'china' ? u.replace('.com', '.cn') : u;
  }
  headers(auth = true) {
    const h = {
      'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Name': 'OrcaSlicer', 'X-BBL-Client-Type': 'slicer',
      'X-BBL-Client-Version': '01.09.05.51', 'X-BBL-Language': 'en-US', 'X-BBL-OS-Type': 'linux', 'X-BBL-OS-Version': '6.2.0',
      'X-BBL-Agent-Version': '01.09.05.01', 'X-BBL-Executable-info': '{}', 'X-BBL-Agent-OS-Type': 'linux',
      Accept: 'application/json', 'Content-Type': 'application/json',
    };
    if (auth && this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }
  async req(method, url, body, headers, allow400 = false) {
    let r, txt;
    try {
      r = await fetch(url, { method, headers: headers || this.headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
      txt = await r.text();
    } catch (e) { throw new CloudError(`אין חיבור לענן של Bambu (${e.cause?.code || e.message})`); }
    let j = {};
    try { j = txt ? JSON.parse(txt) : {}; } catch { }
    if (r.ok) return { status: r.status, json: j, res: r };
    const cf = /cloudflare/i.test(txt);
    if (r.status === 401 || (r.status === 403 && !cf && this.token)) throw new AuthExpired('Bambu דחו את החיבור השמור. צריך להתחבר מחדש בהגדרות.');
    if (r.status === 403 && cf) throw new CloudError('נחסם זמנית על ידי Cloudflare. ננסה שוב מאוחר יותר.');
    if (r.status === 400 && allow400) return { status: 400, json: j, res: r };
    throw new CloudError(`שגיאה מהענן (HTTP ${r.status})`);
  }
  async loginPassword(email, password) {
    const { status, json } = await this.req('POST', this.url('login'), { account: email, password, apiError: '' }, this.headers(false), true);
    if (status === 400) throw new CloudError('מייל או סיסמה שגויים');
    return json;
  }
  async sendEmailCode(email) { await this.req('POST', this.url('emailCode'), { email, type: 'codeLogin' }, this.headers(false)); }
  async loginCode(email, code) {
    const { status, json } = await this.req('POST', this.url('login'), { account: email, code }, this.headers(false), true);
    if (status === 400) {
      if (json.code === 1) { await this.sendEmailCode(email).catch(() => {}); throw new CloudError('הקוד פג תוקף. שלחנו קוד חדש למייל.'); }
      throw new CloudError('קוד שגוי');
    }
    return json.accessToken || '';
  }
  async loginTfa(tfaKey, code) {
    const c = await fetch(this.url('csrf'), { headers: this.headers(false) });
    const cookies = c.headers.getSetCookie ? c.headers.getSetCookie() : [c.headers.get('set-cookie') || ''];
    let csrf = '';
    for (const ck of cookies) { const m = /bbl_csrf_token=([^;]+)/.exec(ck || ''); if (m) csrf = m[1]; }
    const h = this.headers(false);
    if (csrf) { h['x-bbl-csrf-token'] = csrf; h.Cookie = `bbl_csrf_token=${csrf}`; }
    const r = await fetch(this.url('tfa'), { method: 'POST', headers: h, body: JSON.stringify({ tfaKey, tfaCode: code }) });
    if (!r.ok) throw new CloudError('קוד האימות לא התקבל');
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
    for (const ck of set) { const m = /(?:^|\s)token=([^;]+)/.exec(ck || ''); if (m) return m[1]; }
    throw new CloudError('ההתחברות הדו-שלבית נכשלה');
  }
  async userId() {
    const parts = this.token.split('.');
    if (parts.length === 3) {
      try { const u = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).username; if (u) return u; } catch { }
    }
    const { json } = await this.req('GET', this.url('preference'));
    if (!json.uid) throw new CloudError('לא הצלחנו לזהות את המשתמש');
    return `u_${json.uid}`;
  }
  // the 3MF behind a print: the cloud project it was sent from, or the MakerWorld profile
  async modelUrl(e, log) {
    const tried = [];
    if (e.projectId || e.modelId) {
      try {
        let pid = e.projectId;
        if (!pid) {
          for (let page = 1; page <= 20 && !pid; page++) {
            const { json } = await this.req('GET', `${this.url('projects')}?page=${page}&limit=50`);
            const list = json.projects || json.hits || json.data || [];
            if (page === 1) log(`model: projects response keys ${Object.keys(json).join(',')} (${list.length})`);
            const hit = list.find((p) => [p.model_id, p.modelId, p.project_id, p.projectId].map(String).includes(e.modelId));
            if (hit) pid = String(hit.project_id || hit.projectId || '');
            if (list.length < 50) break;
          }
        }
        if (pid) {
          const { json } = await this.req('GET', `${this.url('projects')}/${pid}`);
          const url = find3mfUrl(json);
          log(`model: project ${pid} keys ${Object.keys(json).join(',')} -> ${url ? 'url' : 'no url'}`);
          if (url) return { url, via: 'project' };
        }
        tried.push('project');
      } catch (err) { tried.push('project:' + err.message); }
    }
    for (const id of [e.instanceId, e.profileId].filter((x) => x && x !== '0')) {
      try {
        const { json } = await this.req('GET', `${this.url('instance')}/${id}/f3mf?type=download`);
        const url = json.url || find3mfUrl(json);
        log(`model: makerworld instance ${id} -> ${url ? 'url' : 'no url'} (${Object.keys(json).join(',')})`);
        if (url) return { url, via: 'makerworld', name: json.name || '' };
      } catch (err) { tried.push(`instance ${id}:` + err.message); }
    }
    throw new CloudError(`Bambu לא החזירו קובץ להדפסה הזו (${tried.join('; ') || 'אין מזהה'})`);
  }
  async devices() { return (await this.req('GET', this.url('bind'))).json.devices || []; }
  async tasks(knownIds) {
    const out = [], seen = new Set();
    let offset = 0;
    const limit = 50;
    for (let page = 0; page < 200; page++) {
      const { json } = await this.req('GET', `${this.url('tasks')}?limit=${limit}&offset=${offset}`);
      const hits = json.hits || [];
      const fresh = hits.filter((h) => !seen.has(h.id));
      if (!fresh.length) break;
      fresh.forEach((h) => seen.add(h.id));
      out.push(...fresh);
      offset += hits.length;
      if (knownIds && knownIds.size && fresh.every((h) => knownIds.has(String(h.id)))) break;
      if (json.total && offset >= json.total) break;
      if (hits.length < limit && !json.total) break;
    }
    return out;
  }
}

function taskToEntry(t, printers) {
  const status = TASK_STATUS[t.status] || 'unknown';
  if (status === 'running') return null;
  const serial = t.deviceId || '';
  const ts = parseT(t.startTime), te = parseT(t.endTime);
  return {
    key: `cloud-${t.id}`, source: 'cloud', serial,
    printer: t.deviceName || (printers[serial] || {}).name || '', printerModel: t.deviceModel || '',
    title: t.title || '', design: t.designTitle || '', designId: t.designId || 0,
    plate: t.plateIndex || 0, plateName: t.plateName || '', result: status, rawStatus: t.status,
    start: t.startTime, end: t.endTime,
    minutes: ts && te && te > ts ? Math.round((te - ts) / 60000) : Math.round((t.costTime || 0) / 60),
    estMinutes: Math.round((t.costTime || 0) / 60), grams: Math.round((+t.weight || 0) * 100) / 100,
    filaments: (t.amsDetailMapping || []).map((a) => ({ type: a.filamentType || a.targetFilamentType || '', color: colorHex(a.targetColor || a.sourceColor), grams: Math.round((+a.weight || 0) * 100) / 100 })),
    bed: t.bedType || '', cover: t.cover || '', mode: t.mode || '',
    // ids that point at the file that was printed (cloud project / MakerWorld profile)
    modelId: String(t.modelId || ''), profileId: String(t.profileId || ''), instanceId: String(t.instanceId || ''), projectId: String(t.projectId || ''),
  };
}

/* ---------------------------------------------------------------- output file */
class Output {
  constructor(library, mode, onWrite) {
    this.file = path.join(library, '.shelf', OUT_NAME);
    this.onWrite = onWrite;
    this.data = { schema: 1, helper: {}, printers: {}, prints: [] };
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(d.prints)) this.data.prints = d.prints; if (d.idsVer) this.data.idsVer = d.idsVer; } catch { }
    this.data.helper = { version: 'app', app: true, mode, host: os.hostname(), started: nowIso() };
    this.lastWrite = 0; this.pending = false;
  }
  knownCloudIds() { return new Set(this.data.prints.filter((p) => (p.key || '').startsWith('cloud-')).map((p) => p.key.slice(6))); }
  setHelper(kw) { Object.assign(this.data.helper, kw); this.write(); }
  setPrinter(serial, info, throttle = true) {
    this.data.printers[serial] = { ...(this.data.printers[serial] || {}), ...info, updated: nowIso() };
    this.write(throttle);
  }
  samePrint(a, b) {
    if (a.serial !== b.serial) return false;
    if (close(a.start, b.start, 20 * 60000)) return true;
    return !!normT(a.title) && normT(a.title) === normT(b.title) && close(a.end, b.end, 20 * 60000);
  }
  addPrint(e) {
    const P = this.data.prints;
    const i = P.findIndex((p) => p.key === e.key);
    if (i >= 0) { P[i] = { ...P[i], ...e }; return false; }
    if (e.source === 'cloud') {
      const j = P.findIndex((p) => (p.source === 'lan-live' || p.source === 'cloud-live') && this.samePrint(p, e));
      if (j >= 0) { e.aliasKeys = [...new Set([...(P[j].aliasKeys || []), P[j].key])]; P[j] = e; return false; }
    } else if (P.some((p) => p.source === 'cloud' && this.samePrint(p, e))) return false;
    P.push(e);
    P.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    P.length = Math.min(P.length, 8000);
    return true;
  }
  write(throttle = false) {
    if (throttle && Date.now() - this.lastWrite < 15000) { this.pending = true; return; }
    this.data.helper.written = nowIso();
    this.lastWrite = Date.now(); this.pending = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
      this.onWrite && this.onWrite();
    } catch (e) { console.error('write failed', e); }
  }
  flush() { if (this.pending) this.write(); }
}

/* ---------------------------------------------------------------- live */
const RUNNING = ['PREPARE', 'RUNNING', 'PAUSE', 'SLICING'];
// Bambu sends partial updates: merge objects, and lists of {id} items by id (AMS units, trays)
function mergeDeep(a, b) {
  if (Array.isArray(b)) {
    if (Array.isArray(a) && b.every((x) => x && typeof x === 'object' && 'id' in x)) {
      const out = a.map((x) => ({ ...x }));
      for (const x of b) { const i = out.findIndex((y) => y && String(y.id) === String(x.id)); if (i >= 0) out[i] = mergeDeep(out[i], x); else out.push(x); }
      return out;
    }
    return b;
  }
  if (b && typeof b === 'object') {
    const out = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) out[k] = mergeDeep(out[k], v);
    return out;
  }
  return b;
}
// HMS = Bambu's health-management error codes: attr + code -> "0700_2000_0002_0001"
function hmsCode(attr, code) {
  const h = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const s = h(attr) + h(code);
  return s.match(/.{4}/g).join('_');
}
const HMS_MODULE = { '03': 'תקלה במערכת התנועה', '05': 'תקלה בלוח הראשי', '07': 'תקלה ב-AMS', '08': 'תקלה בראש ההדפסה', '0C': 'תקלה במצלמה או בחיישנים', '12': 'תקלה ב-AMS Lite', '18': 'תקלה ב-AMS HT' };
const hmsText = (codeStr) => HMS_MODULE[codeStr.slice(0, 2)] || 'תקלה במדפסת';
const hmsUrl = (codeStr) => `https://e.bambulab.com/index.php?e=${codeStr.replace(/_/g, '')}&s=device_hms&lang=en`;
function printErrorText(err) {
  const n = +err || 0;
  if (!n) return '';
  if ((n & 0xffff) === 0x8011) return 'הפילמנט נגמר';
  return 'שגיאה ' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

class LiveWatcher {
  constructor(out, serial, name, source, onPrint) { Object.assign(this, { out, serial, name, source, onPrint }); this.state = {}; this.active = null; this.prev = null; }
  // notifications during a print: paused / HMS error, first layer done, 10 minutes left, AMS low / humid
  checkAlerts() {
    if (!this.onAlert) return;
    const f = this.full || {};
    const st = String(f.gcode_state || '').toUpperCase();
    const job = f.subtask_name || f.gcode_file || 'הדפסה';
    const first = !this.seeded; // the first report only records what is already true, so starting the app mid-print is quiet
    this.seeded = true;
    const jobId = `${f.task_id || f.subtask_id || job}|${f.gcode_start_time || ''}`;
    if (this.jobId !== jobId) { this.jobId = jobId; this.jobFlags = {}; this.maxRemain = 0; }
    const J = this.jobFlags;
    const fire = (kind, title, body, url) => { if (!first) this.onAlert({ kind, title, body, url, printer: this.name }); };
    const running = st === 'RUNNING';
    const remain = +f.mc_remaining_time || 0;
    if (running) this.maxRemain = Math.max(this.maxRemain || 0, remain);
    // 1. paused, with the reason when the printer gives one
    const hms = (Array.isArray(f.hms) ? f.hms : []).map((x) => hmsCode(x.attr, x.code));
    this.hmsSeen = this.hmsSeen || new Set();
    const fresh = hms.filter((c) => !this.hmsSeen.has(c));
    if (st === 'PAUSE' && this.lastSt && this.lastSt !== 'PAUSE') {
      const why = fresh[0] ? `${hmsText(fresh[0])} (קוד ${fresh[0]})` : printErrorText(f.print_error) || 'נעצרה במדפסת';
      fire('pause', 'ההדפסה הושהתה', `${job} · ${why}`, fresh[0] ? hmsUrl(fresh[0]) : '');
      fresh.splice(0, 1).forEach((c) => this.hmsSeen.add(c)); // the first code is already in this message
    }
    for (const c of fresh) { this.hmsSeen.add(c); fire('pause', hmsText(c), `קוד ${c} · ${job}`, hmsUrl(c)); }
    if (!hms.length) this.hmsSeen.clear();
    // 2. first layer done
    if (running && +f.layer_num >= 2 && !J.firstLayer) { J.firstLayer = 1; fire('firstLayer', 'השכבה הראשונה הסתיימה', `כדאי לבדוק שההדפסה נדבקה · ${job}`); }
    // 3. ten minutes left (only for prints longer than 20 minutes)
    if (running && remain > 0 && remain <= 10 && (this.maxRemain || 0) >= 20 && !J.tenMin) { J.tenMin = 1; fire('tenMin', 'נשארו 10 דקות להדפסה', job); }
    // 4. AMS: a spool about to run out, or humid air
    this.amsFlags = this.amsFlags || {};
    const A = this.amsFlags;
    for (const u of (f.ams && Array.isArray(f.ams.ams) ? f.ams.ams : [])) {
      for (const t of (Array.isArray(u.tray) ? u.tray : [])) {
        const k = `low:${u.id}:${t.id}`, r = t.remain == null ? -1 : +t.remain;
        if (t.tray_type && r >= 0 && r <= 10) { if (!A[k]) { A[k] = 1; this.onAlert({ kind: 'ams', title: 'הפילמנט ב-AMS עומד להיגמר', body: `AMS ${+u.id + 1} · חריץ ${+t.id + 1}: ${t.tray_type}${t.tray_sub_brands ? ' ' + t.tray_sub_brands : ''} · נשארו ${r}%`, printer: this.name }); } }
        else if (r > 20) delete A[k];
      }
      const raw = u.humidity_raw != null ? +u.humidity_raw : null;
      const hk = `hum:${u.id}`;
      if (raw != null && raw >= 45) { if (!A[hk]) { A[hk] = 1; this.onAlert({ kind: 'ams', title: 'לחות גבוהה ב-AMS', body: `AMS ${+u.id + 1}: לחות ${raw}% · כדאי לייבש או להחליף חומר סופח`, printer: this.name }); } }
      else if (raw != null && raw < 38) delete A[hk];
    }
    this.lastSt = st;
  }
  onReport(payload) {
    // everything the printer reports (temperatures, AMS, fans, errors…) for the printer screen
    if (payload && payload.info && Array.isArray(payload.info.module)) this.modules = payload.info.module.map((m) => ({ name: m.name, sw: m.sw_ver || '', hw: m.hw_ver || '', sn: m.sn || '' }));
    const p = payload && payload.print;
    if (!p || typeof p !== 'object') return;
    this.full = mergeDeep(this.full || {}, p);
    this.fullAt = Date.now();
    try { this.checkAlerts(); } catch (e) { console.error('alerts', e); }
    for (const [k, v] of Object.entries(p)) if (v === null || typeof v !== 'object') this.state[k] = v;
    const st = String(this.state.gcode_state || '').toUpperCase();
    const job = this.state.subtask_name || this.state.gcode_file || '';
    this.out.setPrinter(this.serial, { name: this.name, conn: this.source, state: st.toLowerCase() || 'unknown', progress: this.state.mc_percent, remainingMin: this.state.mc_remaining_time, job, layer: this.state.layer_num, layers: this.state.total_layer_num }, st === this.prev);
    const running = RUNNING.includes(st);
    if (running && !this.active) {
      let start = nowIso();
      const g = parseInt(this.state.gcode_start_time || 0, 10);
      if (g > 1.6e9 && g * 1000 <= Date.now() + 60000) start = new Date(g * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
      this.active = { start, job, file: this.state.gcode_file || '', task: String(this.state.task_id || ''), seen: this.prev };
    } else if (running && this.active && job && !this.active.job) this.active.job = job;
    if ((st === 'FINISH' || st === 'FAILED') && this.active && RUNNING.includes(this.prev)) {
      const a = this.active;
      const e = {
        key: `live-${this.serial}-${a.task && a.task !== '0' ? a.task : a.start}`, source: this.source === 'lan' ? 'lan-live' : 'cloud-live',
        serial: this.serial, printer: this.name, title: a.job || job, design: '', file: a.file, plate: 0,
        result: st === 'FINISH' ? 'ok' : 'fail', start: a.start, end: nowIso(),
        minutes: Math.round((Date.now() - (parseT(a.start) || Date.now())) / 60000), grams: 0, filaments: [], cover: '',
        error: this.state.print_error || 0, partialObservation: a.seen == null,
      };
      if (this.out.addPrint(e)) this.onPrint && this.onPrint(e);
      this.out.write();
      this.active = null;
    }
    if (['IDLE', 'FINISH', 'FAILED'].includes(st) && this.active && !RUNNING.includes(this.prev)) this.active = null;
    this.prev = st;
  }
}

/* minimal MQTT 3.1.1 over TLS (subscribe + QoS0 publish) */
class MiniMQTT {
  constructor(o) { Object.assign(this, o); this.running = true; this.buf = Buffer.alloc(0); this.delay = 5000; this.connect(); }
  static str(s) { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }
  static len(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 0x80; out.push(d); } while (n); return Buffer.from(out); }
  send(type, body) { if (this.sock && !this.sock.destroyed) this.sock.write(Buffer.concat([Buffer.from([type]), MiniMQTT.len(body.length), body])); }
  subscribe(topic, pid) { const p = Buffer.alloc(2); p.writeUInt16BE(pid); this.send(0x82, Buffer.concat([p, MiniMQTT.str(topic), Buffer.from([0])])); }
  publish(topic, payload) { this.send(0x30, Buffer.concat([MiniMQTT.str(topic), Buffer.from(payload, 'utf8')])); }
  connect() {
    if (!this.running) return;
    this.connected = false;
    const sock = tls.connect({ host: this.host, port: this.port, rejectUnauthorized: !this.insecure, servername: this.insecure ? undefined : this.host, timeout: 20000 });
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    sock.on('secureConnect', () => {
      const cid = 'model-shelf-' + crypto.randomBytes(5).toString('hex');
      const ka = Buffer.alloc(2); ka.writeUInt16BE(60);
      this.send(0x10, Buffer.concat([MiniMQTT.str('MQTT'), Buffer.from([4, 0xC2]), ka, MiniMQTT.str(cid), MiniMQTT.str(this.user), MiniMQTT.str(this.password)]));
    });
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on('timeout', () => sock.destroy(new Error('timeout')));
    sock.on('error', (e) => { this.lastErr = e; });
    sock.on('close', () => {
      clearInterval(this.ping);
      if (!this.running) return;
      this.onDown && this.onDown(this.lastErr || new Error('closed'));
      const wait = this.refused ? 600000 : this.delay;
      this.delay = Math.min(this.delay * 2, 600000);
      this.timer = setTimeout(() => this.connect(), wait);
    });
  }
  parse() {
    while (this.buf.length >= 2) {
      let mult = 1, len = 0, i = 1, d;
      do { if (i >= this.buf.length) return; d = this.buf[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
      if (this.buf.length < i + len) return;
      const h = this.buf[0], body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      const type = h >> 4;
      if (type === 2) {
        const rc = body[1];
        this.refused = rc !== 0;
        this.onConnect(this, rc);
        if (rc === 0) {
          this.connected = true; this.delay = 5000;
          this.sock.setTimeout(0);
          this.ping = setInterval(() => this.send(0xC0, Buffer.alloc(0)), 45000);
        } else this.sock.end();
      } else if (type === 3) {
        const qos = (h >> 1) & 3;
        const tl = body.readUInt16BE(0);
        const topic = body.subarray(2, 2 + tl).toString('utf8');
        let o = 2 + tl;
        if (qos) { this.send(0x40, body.subarray(o, o + 2)); o += 2; }
        try { this.onMessage(topic, body.subarray(o)); } catch (e) { console.error(e); }
      }
    }
  }
  stop() { this.running = false; clearTimeout(this.timer); clearInterval(this.ping); try { this.send(0xE0, Buffer.alloc(0)); this.sock.destroy(); } catch { } }
}

function startMqtt({ host, port = 8883, user, password, serials, watchers, insecure, label, out, log }) {
  return new MiniMQTT({
    host, port, user, password, insecure,
    onConnect: (c, rc) => {
      if (rc === 0) {
        log(`${label}: connected`);
        serials.forEach((s, i) => {
          c.subscribe(`device/${s}/report`, i + 1);
          c.publish(`device/${s}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 } }));
          c.publish(`device/${s}/request`, JSON.stringify({ info: { sequence_id: '1', command: 'get_version' } }));
        });
      } else {
        const reason = { 4: 'Access Code / חיבור שגוי', 5: 'אין הרשאה' }[rc] || `קוד ${rc}`;
        log(`${label}: refused (${reason})`);
        serials.forEach((s) => out.setPrinter(s, { conn: 'error', error: reason }, false));
      }
    },
    onDown: (e) => { log(`${label}: disconnected (${e.message})`); serials.forEach((s) => out.setPrinter(s, { conn: 'offline' }, false)); },
    onMessage: (topic, payload) => { const w = watchers[topic.split('/')[1]]; if (w) w.onReport(JSON.parse(payload.toString('utf8'))); },
  });
}

/* ---------------------------------------------------------------- discovery */
// Find Bambu printers on the local network, three ways at once:
//  1. listen for the SSDP NOTIFY packets printers broadcast (UDP 2021/1990)
//  2. send an SSDP M-SEARCH out of every network adapter (Windows often has VPN / Hyper-V / WSL adapters)
//  3. scan the local /24 subnets for TCP 8883 (printer MQTT) and read the serial from its TLS certificate.
//     Outgoing TCP works even when the firewall blocks incoming UDP (common on Windows, "Public" networks).
function lanIfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}
function probeTls(ip, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { sock.destroy(); } catch { } resolve(v); };
    const sock = tls.connect({ host: ip, port: 8883, rejectUnauthorized: false, timeout }, () => {
      const c = sock.getPeerCertificate() || {};
      const cn = (c.subject && c.subject.CN) || '';
      const issuer = JSON.stringify(c.issuer || {});
      fin(/^[0-9A-Z]{10,20}$/.test(cn) || /bambu/i.test(issuer) ? { serial: cn, ip, issuer } : null);
    });
    sock.on('error', () => fin(null));
    sock.on('timeout', () => fin(null));
    setTimeout(() => fin(null), timeout + 500);
  });
}
async function scanSubnets(ifaces, log) {
  const hosts = new Set();
  for (const f of ifaces) {
    if (f.netmask !== '255.255.255.0' && !f.netmask.startsWith('255.255.')) continue;
    const base = f.address.split('.').slice(0, 3).join('.');
    for (let i = 1; i < 255; i++) if (`${base}.${i}` !== f.address) hosts.add(`${base}.${i}`);
  }
  const list = [...hosts].slice(0, 1024);
  const found = [];
  let next = 0;
  await Promise.all(Array.from({ length: 64 }, async () => {
    while (next < list.length) { const ip = list[next++]; const r = await probeTls(ip); if (r) found.push(r); }
  }));
  if (log) log(`discover: scanned ${list.length} addresses for port 8883, ${found.length} printer(s)`);
  return found;
}
function discover(ms = 8000, log) {
  const ifaces = lanIfaces();
  if (log) log(`discover: adapters ${ifaces.map((f) => `${f.name}=${f.address}`).join(', ') || 'none'}`);
  const ssdp = new Promise((resolve) => {
    const found = new Map();
    const socks = [];
    const onMsg = (msg, rinfo) => {
      const txt = msg.toString('utf8');
      if (!/bambu/i.test(txt)) return;
      const h = {};
      for (const line of txt.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
      if (h.usn) found.set(h.usn, { serial: h.usn, ip: h.location || rinfo.address, name: h['devname.bambu.com'] || h.usn, model: h['devmodel.bambu.com'] || '' });
    };
    for (const port of [2021, 1990]) {
      try {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('error', (e) => { if (log) log(`discover: udp ${port} ${e.code || e.message}`); });
        s.on('message', onMsg);
        s.bind(port, () => {
          for (const f of ifaces) { try { s.addMembership('239.255.255.250', f.address); } catch { } }
          try { s.addMembership('239.255.255.250'); } catch { }
        });
        socks.push(s);
      } catch { }
    }
    // active search out of each adapter
    const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n');
    for (const f of ifaces) {
      try {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('error', () => {});
        s.on('message', onMsg);
        s.bind(0, f.address, () => {
          try { s.setBroadcast(true); s.setMulticastInterface(f.address); } catch { }
          for (const [host, port] of [['239.255.255.250', 1990], ['239.255.255.250', 2021], ['255.255.255.255', 2021]]) s.send(q, port, host, () => {});
        });
        socks.push(s);
      } catch { }
    }
    setTimeout(() => { socks.forEach((s) => { try { s.close(); } catch { } }); resolve(found); }, ms);
  });
  return Promise.all([ssdp, scanSubnets(ifaces, log).catch(() => [])]).then(([found, scanned]) => {
    for (const r of scanned) {
      const ex = [...found.values()].find((f) => f.serial === r.serial || f.ip === r.ip);
      if (ex) { if (!ex.ip) ex.ip = r.ip; continue; }
      found.set(r.serial || r.ip, { serial: r.serial || r.ip, ip: r.ip, name: r.serial || r.ip, model: '' });
    }
    const list = [...found.values()];
    if (log) log(`discover: found ${list.map((f) => `${f.name}@${f.ip}`).join(', ') || 'nothing'}`);
    return list;
  });
}

/* ---------------------------------------------------------------- engine */
class Engine {
  constructor({ getConfig, saveConfig, notify, onWrite, onModel, alert, log }) {
    Object.assign(this, { getConfig, saveConfig, notify, onWrite, onModel: onModel || (() => {}), alert: alert || (() => {}) });
    this.inflight = new Map(); // print key -> download promise
    this.watchers = {}; // serial -> LiveWatcher (for the printer screen)
    this.queue = [];
    this.queueBusy = false;
    const base = log || console.log;
    // also keep a small log next to the library data, to make problems easy to diagnose
    this.log = (m) => {
      base(m);
      if (!this.logFile) return;
      try {
        fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${m}\n`);
        if (fs.statSync(this.logFile).size > 300000) { const t = fs.readFileSync(this.logFile, 'utf8'); fs.writeFileSync(this.logFile, t.slice(-150000)); }
      } catch { }
    };
    this.clients = [];
    this.timer = null;
    this.pendingLogin = null;
  }
  stop() {
    this.clients.forEach((c) => c.stop());
    this.clients = [];
    this.watchers = {};
    clearTimeout(this.timer);
    clearInterval(this.flushT);
    if (this.out) this.out.setHelper({ stopped: nowIso() });
    this.out = null;
  }
  start() {
    this.stop();
    const cfg = this.getConfig();
    if (!cfg.library || !cfg.mode || cfg.mode === 'off') return;
    const out = (this.out = new Output(cfg.library, cfg.mode, this.onWrite));
    // 1.1.9–1.1.11 saved downloaded models in a visible "Bambu Cloud" folder: move them out of sight
    try {
      let moved = 0;
      for (const p of out.data.prints) {
        if (!p.modelFile || !p.modelFile.startsWith('Bambu Cloud/')) continue;
        const src = path.join(cfg.library, ...p.modelFile.split('/'));
        const dstDir = path.join(cfg.library, '.shelf', 'models');
        const dst = path.join(dstDir, path.basename(src));
        if (fs.existsSync(src)) { fs.mkdirSync(dstDir, { recursive: true }); if (!fs.existsSync(dst)) fs.renameSync(src, dst); moved++; }
        if (fs.existsSync(dst)) p.modelFile = '@models/' + path.basename(dst);
      }
      const old = path.join(cfg.library, 'Bambu Cloud');
      if (moved) { try { if (!fs.readdirSync(old).length) fs.rmdirSync(old); } catch { } out.write(); this.log(`model: moved ${moved} downloaded model(s) to .shelf/models`); }
    } catch (e) { this.log('model: move failed ' + e.message); }
    this.logFile = path.join(cfg.library, '.shelf', 'sync.log');
    try { fs.mkdirSync(path.dirname(this.logFile), { recursive: true }); } catch { }
    this.log(`engine start: mode=${cfg.mode} printers=${(cfg.printers || []).map((p) => `${p.name}[${p.ip ? 'ip' : '-'}${p.access_code ? '+code' : ''}]`).join(' ')} cloud=${cfg.cloud?.token ? 'yes' : 'no'}`);
    out.setHelper({ lastError: '', needsLogin: false, stopped: null });
    const printers = cfg.printers || [];
    // no printers saved yet (or the sign-in happened before they were fetched): ask the cloud for them
    if (!printers.length && cfg.cloud?.token && !this.fetchingDevices) {
      this.fetchingDevices = true;
      this.refreshDevices().then((n) => { this.fetchingDevices = false; if (n) this.start(); }).catch((e) => { this.fetchingDevices = false; this.log(`devices: ${e.message}`); });
    }
    const onPrint = (e) => { if (cfg.options?.notify !== false) this.notify(e); };
    const OPT = { pause: 'alertPause', firstLayer: 'alertFirstLayer', tenMin: 'alertTenMin', ams: 'alertAms' };
    const onAlert = (a) => { const o = this.getConfig().options || {}; if (o[OPT[a.kind]] !== false) { this.log(`alert: ${a.kind} ${a.title} - ${a.body}`); this.alert(a); } };
    // live status: straight from the printer on the LAN when we have its IP + access code,
    // otherwise through Bambu Cloud (like the Home Assistant integration)
    const viaCloud = [];
    for (const p of printers) {
      const lanOk = (cfg.mode === 'lan' || cfg.mode === 'both') && p.ip && p.access_code;
      if (lanOk) {
        const w = { [p.serial]: new LiveWatcher(out, p.serial, p.name || p.serial, 'lan', onPrint) };
        this.watchers[p.serial] = w[p.serial];
        w[p.serial].onAlert = onAlert;
        this.log(`live: ${p.name} via LAN ${p.ip}`);
        this.clients.push(startMqtt({ host: p.ip, user: 'bblp', password: p.access_code, serials: [p.serial], watchers: w, insecure: true, label: `${p.name} (LAN)`, out, log: this.log }));
      } else if (cfg.mode !== 'lan') viaCloud.push(p);
      else { this.log(`live: ${p.name} skipped - no IP / access code`); out.setPrinter(p.serial, { name: p.name, conn: 'error', error: 'חסרים IP או Access Code' }, false); }
    }
    if (viaCloud.length && cfg.cloud?.token && cfg.cloud?.user) {
      const ws = Object.fromEntries(viaCloud.map((p) => [p.serial, new LiveWatcher(out, p.serial, p.name || p.serial, 'cloud', onPrint)]));
      Object.assign(this.watchers, ws);
      Object.values(ws).forEach((x) => { x.onAlert = onAlert; });
      this.log(`live: ${viaCloud.map((p) => p.name).join(', ')} via Bambu Cloud`);
      for (const p of viaCloud) out.setPrinter(p.serial, { name: p.name, conn: 'connecting' }, false);
      this.clients.push(startMqtt({ host: cfg.cloud.region === 'china' ? 'cn.mqtt.bambulab.com' : 'us.mqtt.bambulab.com', user: cfg.cloud.user, password: cfg.cloud.token, serials: Object.keys(ws), watchers: ws, insecure: false, label: 'Bambu Cloud', out, log: this.log }));
    } else if (viaCloud.length) this.log('live: cloud printers but no cloud token - sign in again');
    this.flushT = setInterval(() => out.flush(), 5000);
    if (cfg.mode === 'cloud' || cfg.mode === 'both') this.loopHistory(true);
  }
  async loopHistory(first) {
    clearTimeout(this.timer);
    const cfg = this.getConfig();
    if (!this.out || !cfg.cloud?.token) return;
    let next = Math.max(2, cfg.options?.intervalMin || 10) * 60000;
    let result;
    try {
      const n = await this.syncHistory(first);
      this.log(`cloud history: ${n} new`);
      result = { ok: true, added: n };
    } catch (e) {
      this.log(`cloud sync failed: ${e.message}`);
      if (this.out) this.out.setHelper({ lastError: e.message, needsLogin: e instanceof AuthExpired });
      next = e instanceof AuthExpired ? 6 * 3600000 : 300000;
      result = { ok: false, error: e.message };
    }
    this.timer = setTimeout(() => this.loopHistory(false), next);
    return result;
  }
  async syncHistory(first) {
    const cfg = this.getConfig();
    const out = this.out;
    const cloud = new BambuCloud(cfg.cloud.region, cfg.cloud.token);
    const printers = Object.fromEntries((cfg.printers || []).map((p) => [p.serial, p]));
    // older entries were saved without the model ids: re-read the full history once
    const known = out.data.idsVer === 2 ? out.knownCloudIds() : new Set();
    const tasks = await cloud.tasks(known);
    out.data.idsVer = 2;
    let n = 0;
    const recent = [];
    for (const t of tasks) {
      const e = taskToEntry(t, printers);
      if (e && out.addPrint(e)) { n++; if (!first && known.size && Date.now() - (parseT(e.end) || 0) < 3 * 3600000) recent.push(e); }
    }
    await this.cacheCovers(cfg.library);
    out.setHelper({ lastSync: nowIso(), lastError: '', needsLogin: false, cloudTasks: tasks.length });
    if (this.getConfig().options?.notify !== false) recent.forEach((e) => this.notify(e));
    return n;
  }

  // keep a local copy of Bambu's cover image for every print (the links expire, and it works offline)
  async cacheCovers(library) {
    const out = this.out;
    if (!out) return;
    const dir = path.join(library, '.shelf', 'covers');
    const todo = out.data.prints.filter((p) => p.cover && !p.coverFile && !(p.coverTries >= 3));
    if (!todo.length) return;
    fs.mkdirSync(dir, { recursive: true });
    let ok = 0;
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(todo.slice(i, i + 6).map(async (p) => {
        try {
          const r = await fetch(p.cover, { signal: AbortSignal.timeout(20000) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const type = r.headers.get('content-type') || '';
          const ext = /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : 'png';
          const name = `${p.key.replace(/[^\w-]/g, '_')}.${ext}`;
          fs.writeFileSync(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
          p.coverFile = 'covers/' + name;
          ok++;
        } catch (e) { p.coverTries = (p.coverTries || 0) + 1; }
      }));
    }
    this.log(`covers: ${ok}/${todo.length} saved`);
    out.write();
  }

  // download the 3MF of a print into "<library>/Bambu Cloud/" so it can be shown in 3D
  printerDetail(serial) {
    const cfg = this.getConfig();
    const p = (cfg.printers || []).find((x) => x.serial === serial) || {};
    const w = this.watchers[serial];
    const st = this.out && this.out.data.printers[serial];
    return { serial, name: p.name || serial, model: p.model || '', ip: p.ip || '', conn: w ? w.source : '', status: st || null, report: w ? w.full || null : null, reportAt: w ? w.fullAt || 0 : 0, modules: w ? w.modules || [] : [] };
  }
  // the same design printed many times is downloaded once
  static modelGroup(e) {
    if (e.instanceId && e.instanceId !== '0') return 'i' + e.instanceId;
    if (e.profileId && e.profileId !== '0' && e.designId) return 'i' + e.profileId;
    if (e.modelId) return 'm' + e.modelId;
    return '';
  }
  existingModel(e) {
    const cfg = this.getConfig();
    const ok = (p) => p.modelFile && fs.existsSync(path.join(cfg.library, '.shelf', 'models', p.modelFile.replace(/^@models\//, '')));
    if (ok(e)) return e.modelFile;
    const g = Engine.modelGroup(e);
    const twin = g && this.out.data.prints.find((p) => p !== e && Engine.modelGroup(p) === g && ok(p));
    return twin ? twin.modelFile : '';
  }
  fetchModel(key, onProgress) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pr = this.doFetchModel(key, onProgress).finally(() => this.inflight.delete(key));
    this.inflight.set(key, pr);
    return pr;
  }
  async doFetchModel(key, onProgress = () => {}) {
    const cfg = this.getConfig();
    if (!cfg.cloud || !cfg.cloud.token) throw new CloudError('צריך להתחבר ל-Bambu בהגדרות');
    if (!this.out) throw new CloudError('הסנכרון לא פועל');
    const e = this.out.data.prints.find((p) => p.key === key || (p.aliasKeys || []).includes(key));
    if (!e) throw new CloudError('ההדפסה לא נמצאה');
    const have = this.existingModel(e);
    if (have) { e.modelFile = have; return { path: have, reused: true }; }
    const cloud = new BambuCloud(cfg.cloud.region, cfg.cloud.token);
    const { url, name } = await cloud.modelUrl(e, (m) => this.log(m));
    const r = await fetch(url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
    if (!r.ok || !r.body) throw new CloudError(`ההורדה נכשלה (HTTP ${r.status})`);
    const total = +r.headers.get('content-length') || 0;
    const ext = /\.gcode\.3mf(\?|$)/i.test(url) ? '.gcode.3mf' : '.3mf';
    const base = String(name || e.design || e.title || `print-${e.key}`).replace(/\.(gcode\.)?3mf$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 100) || 'model';
    const dir = path.join(cfg.library, '.shelf', 'models'); // hidden: downloaded once, reused every time
    fs.mkdirSync(dir, { recursive: true });
    // stream to disk (models can be hundreds of MB) and report progress
    const part = path.join(dir, `.${crypto.randomBytes(4).toString('hex')}.part`);
    const out = fs.createWriteStream(part);
    let got = 0, last = 0, head = null;
    try {
      for await (const chunk of r.body) {
        if (!head) head = Buffer.from(chunk.slice(0, 2));
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        if (Date.now() - last > 200) { last = Date.now(); onProgress(got, total); }
      }
      await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
    } catch (err) { out.destroy(); try { fs.unlinkSync(part); } catch { } throw err; }
    if (got < 100 || !head || head[0] !== 0x50 || head[1] !== 0x4b) { try { fs.unlinkSync(part); } catch { } throw new CloudError('הקובץ שהתקבל הוא לא 3MF'); }
    let file = path.join(dir, base + ext);
    for (let i = 2; fs.existsSync(file) && fs.statSync(file).size !== got; i++) file = path.join(dir, `${base} (${i})${ext}`);
    if (fs.existsSync(file)) fs.unlinkSync(part); else fs.renameSync(part, file);
    e.modelFile = '@models/' + path.basename(file);
    this.out.write();
    this.log(`model: saved ${e.modelFile} (${got} bytes)`);
    return { path: e.modelFile, size: got };
  }
  // background queue: one model at a time, outside the window, with progress events for the cards
  prefetch(keys) {
    const cfg = this.getConfig();
    if (!cfg.cloud || !cfg.cloud.token || !this.out || cfg.options?.autoModels === false) return 0;
    for (const k of keys) if (!this.queue.includes(k)) this.queue.push(k);
    this.runQueue();
    return this.queue.length;
  }
  async runQueue() {
    if (this.queueBusy) return;
    this.queueBusy = true;
    try {
      while (this.queue.length) {
        const key = this.queue.shift();
        const e = this.out && this.out.data.prints.find((p) => p.key === key);
        if (!e || (e.modelTries || 0) >= 2) { this.onModel({ key, state: 'error', error: e ? e.modelError : '' }); continue; }
        this.onModel({ key, state: 'dl', p: 0 });
        try {
          const r = await this.fetchModel(key, (got, total) => this.onModel({ key, state: 'dl', p: total ? got / total : null, got, total }));
          this.onModel({ key, state: 'done', path: r.path });
          if (!r.reused) await new Promise((res) => setTimeout(res, 1200)); // be gentle with Bambu's servers
        } catch (err) {
          e.modelTries = (e.modelTries || 0) + 1; e.modelError = err.message;
          this.out.write(true);
          this.log(`model: ${key} failed (${err.message})`);
          this.onModel({ key, state: 'error', error: err.message });
        }
        if (this.getConfig().options?.autoModels === false) this.queue.length = 0;
      }
    } finally { this.queueBusy = false; }
  }

  async refreshDevices() {
    const cfg = this.getConfig();
    const cloud = new BambuCloud(cfg.cloud.region, cfg.cloud.token);
    const list = await cloud.devices();
    const byS = Object.fromEntries((cfg.printers || []).map((p) => [p.serial, p]));
    for (const d of list) byS[d.dev_id] = { ...(byS[d.dev_id] || {}), serial: d.dev_id, name: d.name || d.dev_id, model: d.dev_product_name || d.dev_model_name || '', access_code: d.dev_access_code || byS[d.dev_id]?.access_code || '' };
    if (!cfg.cloud.user) cfg.cloud.user = await cloud.userId();
    cfg.printers = Object.values(byS);
    this.saveConfig(cfg);
    this.log(`devices: ${list.length} from the account (${cfg.printers.map((p) => p.name).join(', ')})`);
    return list.length;
  }

  /* --- login flow, driven by the settings screen --- */
  async login({ email, password, region, codeOnly }) {
    const cloud = new BambuCloud(region || 'global');
    try {
      // accounts opened with Google / Apple / Facebook have no password: sign in with a code sent by email
      if (codeOnly) {
        if (!email) return { error: 'צריך למלא מייל' };
        await cloud.sendEmailCode(email); this.pendingLogin = { cloud, email }; return { need: 'code' };
      }
      const j = await cloud.loginPassword(email, password);
      if (j.accessToken) return this.finishLogin(cloud, email, j.accessToken);
      if (j.loginType === 'verifyCode') { await cloud.sendEmailCode(email); this.pendingLogin = { cloud, email }; return { need: 'code' }; }
      if (j.loginType === 'tfa') { this.pendingLogin = { cloud, email, tfaKey: j.tfaKey }; return { need: 'tfa' }; }
      return { error: 'תגובה לא מוכרת מהענן' };
    } catch (e) { return { error: e.message }; }
  }
  async verify({ step, code }) {
    const p = this.pendingLogin;
    if (!p) return { error: 'צריך להתחיל את ההתחברות מחדש' };
    try {
      const token = step === 'tfa' ? await p.cloud.loginTfa(p.tfaKey, code) : await p.cloud.loginCode(p.email, code);
      if (!token) return { error: 'ההתחברות נכשלה' };
      return this.finishLogin(p.cloud, p.email, token);
    } catch (e) { return { error: e.message }; }
  }
  async finishLogin(cloud, email, token) {
    cloud.token = token;
    const cfg = this.getConfig();
    cfg.cloud = { email, region: cloud.region, token, user: await cloud.userId(), saved: nowIso() };
    const byS = Object.fromEntries((cfg.printers || []).map((p) => [p.serial, p]));
    for (const d of await cloud.devices()) {
      byS[d.dev_id] = { ...(byS[d.dev_id] || {}), serial: d.dev_id, name: d.name || d.dev_id, model: d.dev_product_name || d.dev_model_name || '', access_code: d.dev_access_code || byS[d.dev_id]?.access_code || '' };
    }
    cfg.printers = Object.values(byS);
    if (!cfg.mode || cfg.mode === 'off') cfg.mode = 'cloud';
    this.pendingLogin = null;
    this.saveConfig(cfg);
    this.start();
    return { ok: true };
  }
}

module.exports = { probeTls, lanIfaces, Engine, BambuCloud, Output, LiveWatcher, MiniMQTT, startMqtt, discover, taskToEntry, CloudError, AuthExpired };
