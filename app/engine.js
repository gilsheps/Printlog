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
};
const TASK_STATUS = { 1: 'running', 2: 'ok', 3: 'fail', 4: 'cancel' };
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
  url(k) { const u = API[k]; return this.region === 'china' ? u.replace('.com', '.cn') : u; }
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
  };
}

/* ---------------------------------------------------------------- output file */
class Output {
  constructor(library, mode, onWrite) {
    this.file = path.join(library, '.shelf', OUT_NAME);
    this.onWrite = onWrite;
    this.data = { schema: 1, helper: {}, printers: {}, prints: [] };
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(d.prints)) this.data.prints = d.prints; } catch { }
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
class LiveWatcher {
  constructor(out, serial, name, source, onPrint) { Object.assign(this, { out, serial, name, source, onPrint }); this.state = {}; this.active = null; this.prev = null; }
  onReport(payload) {
    const p = payload && payload.print;
    if (!p || typeof p !== 'object') return;
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
function discover(ms = 8000) {
  return new Promise((resolve) => {
    const found = new Map();
    const socks = [];
    for (const port of [2021, 1990]) {
      try {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('error', () => {});
        s.on('message', (msg, rinfo) => {
          const txt = msg.toString('utf8');
          if (!/bambulab/i.test(txt)) return;
          const h = {};
          for (const line of txt.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
          if (h.usn) found.set(h.usn, { serial: h.usn, ip: h.location || rinfo.address, name: h['devname.bambu.com'] || h.usn, model: h['devmodel.bambu.com'] || '' });
        });
        s.bind(port, () => { try { s.addMembership('239.255.255.250'); } catch { } });
        socks.push(s);
      } catch { }
    }
    setTimeout(() => { socks.forEach((s) => { try { s.close(); } catch { } }); resolve([...found.values()]); }, ms);
  });
}

/* ---------------------------------------------------------------- engine */
class Engine {
  constructor({ getConfig, saveConfig, notify, onWrite, log }) {
    Object.assign(this, { getConfig, saveConfig, notify, onWrite, log: log || console.log });
    this.clients = [];
    this.timer = null;
    this.pendingLogin = null;
  }
  stop() {
    this.clients.forEach((c) => c.stop());
    this.clients = [];
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
    out.setHelper({ lastError: '', needsLogin: false, stopped: null });
    const printers = cfg.printers || [];
    const onPrint = (e) => { if (cfg.options?.notify !== false) this.notify(e); };
    if (cfg.mode === 'lan' || cfg.mode === 'both') {
      for (const p of printers) {
        if (!p.ip || !p.access_code) continue;
        const w = { [p.serial]: new LiveWatcher(out, p.serial, p.name || p.serial, 'lan', onPrint) };
        this.clients.push(startMqtt({ host: p.ip, user: 'bblp', password: p.access_code, serials: [p.serial], watchers: w, insecure: true, label: `${p.name} (LAN)`, out, log: this.log }));
      }
    } else if (cfg.mode === 'cloud' && cfg.cloud?.token && printers.length) {
      const ws = Object.fromEntries(printers.map((p) => [p.serial, new LiveWatcher(out, p.serial, p.name || p.serial, 'cloud', onPrint)]));
      this.clients.push(startMqtt({ host: cfg.cloud.region === 'china' ? 'cn.mqtt.bambulab.com' : 'us.mqtt.bambulab.com', user: cfg.cloud.user, password: cfg.cloud.token, serials: Object.keys(ws), watchers: ws, insecure: false, label: 'Bambu Cloud', out, log: this.log }));
    }
    this.flushT = setInterval(() => out.flush(), 5000);
    if (cfg.mode === 'cloud' || cfg.mode === 'both') this.loopHistory(true);
  }
  async loopHistory(first) {
    clearTimeout(this.timer);
    const cfg = this.getConfig();
    if (!this.out || !cfg.cloud?.token) return;
    let next = Math.max(2, cfg.options?.intervalMin || 10) * 60000;
    try {
      const n = await this.syncHistory(first);
      if (n) this.log(`cloud history: ${n} new`);
    } catch (e) {
      this.log(`cloud sync failed: ${e.message}`);
      if (this.out) this.out.setHelper({ lastError: e.message, needsLogin: e instanceof AuthExpired });
      next = e instanceof AuthExpired ? 6 * 3600000 : 300000;
    }
    this.timer = setTimeout(() => this.loopHistory(false), next);
  }
  async syncHistory(first) {
    const cfg = this.getConfig();
    const out = this.out;
    const cloud = new BambuCloud(cfg.cloud.region, cfg.cloud.token);
    const printers = Object.fromEntries((cfg.printers || []).map((p) => [p.serial, p]));
    const known = out.knownCloudIds();
    const tasks = await cloud.tasks(known);
    let n = 0;
    const recent = [];
    for (const t of tasks) {
      const e = taskToEntry(t, printers);
      if (e && out.addPrint(e)) { n++; if (!first && known.size && Date.now() - (parseT(e.end) || 0) < 3 * 3600000) recent.push(e); }
    }
    out.setHelper({ lastSync: nowIso(), lastError: '', needsLogin: false, cloudTasks: tasks.length });
    if (this.getConfig().options?.notify !== false) recent.forEach((e) => this.notify(e));
    return n;
  }

  /* --- login flow, driven by the settings screen --- */
  async login({ email, password, region }) {
    const cloud = new BambuCloud(region || 'global');
    try {
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

module.exports = { Engine, BambuCloud, Output, LiveWatcher, MiniMQTT, startMqtt, discover, taskToEntry, CloudError, AuthExpired };
