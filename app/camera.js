// Live camera from the printer, on the local network, for every Bambu model.
// The printer reports which protocol its camera speaks (ipcam.liveview.local / ipcam.rtsp_url):
//   rtsps / rtsp (P1, A1, P2, X1 recent, H2D…) -> go2rtc restreams it to the window as WebRTC
//   local        (X1 legacy chamber image)     -> read the JPEG frames straight off port 6000
// Nothing here leaves the local network, and nothing is model-specific.
'use strict';
const net = require('net');
const tls = require('tls');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const LAN_USER = 'bblp';

// what the printer says about its own camera
function cameraMode(report) {
  const ip = report && report.ipcam;
  if (!ip || typeof ip !== 'object') return { mode: 'unknown' };
  if (ip.liveview && typeof ip.liveview === 'object') {
    const lv = String(ip.liveview.local || '').toLowerCase();
    if (lv === 'rtsps' || lv === 'rtsp' || lv === 'local') return { mode: lv };
    if (lv === 'disabled' || lv === 'none') return { mode: 'off', why: lv };
  }
  if (typeof ip.rtsp_url === 'string') {
    const u = ip.rtsp_url;
    if (!u || u === 'disable') return { mode: 'off' };
    return { mode: u.startsWith('rtsps') ? 'rtsps' : 'rtsp', url: u };
  }
  return { mode: 'unknown' };
}

// build the stream URL with credentials, preferring the port the printer reported
function rtspUrl(mode, ip, code, reported) {
  if (reported && /^rtsps?:\/\//.test(reported) && !reported.includes('@')) {
    return reported.replace(/^(rtsps?:\/\/)/, `$1${LAN_USER}:${encodeURIComponent(code)}@`);
  }
  const port = mode === 'rtsps' ? 322 : 554;
  return `${mode}://${LAN_USER}:${encodeURIComponent(code)}@${ip}:${port}/streaming/live/1`;
}

// Which camera transport each Bambu model speaks, mirroring Home Assistant's
// pybambu: RTSP video for the X1 / P2 / H2 / X2 families, and the port-6000
// chamber image for the A1 / P1 families. Generic for every model, not one.
const RTSP_TYPES = new Set(['X1', 'X1C', 'X1E', 'X2D', 'P2S', 'H2C', 'H2D', 'H2DPRO', 'H2S', 'H3C']);
const IMAGE_TYPES = new Set(['A1', 'A1MINI', 'A2L', 'P1P', 'P1S']);
// product_name as the printer reports it -> type code
const PRODUCT_MAP = {
  'bambu lab a1': 'A1', 'bambu lab a1 mini': 'A1MINI', 'bambu lab a2l': 'A2L',
  'bambu lab p1p': 'P1P', 'bambu lab p1s': 'P1S', 'bambu lab p2s': 'P2S',
  'bambu lab h2c': 'H2C', 'bambu lab h3c': 'H3C', 'bambu lab h2d': 'H2D',
  'bambu lab h2d pro': 'H2DPRO', 'bambu lab h2s': 'H2S', 'bambu lab x2d': 'X2D',
  'bambu lab x1': 'X1', 'bambu lab x1 carbon': 'X1C', 'bambu lab x1c': 'X1C', 'bambu lab x1e': 'X1E',
};
// legacy board project codes -> type code
const CODE_MAP = { c11: 'P1P', c12: 'P1S', c13: 'P2S', n1: 'A1MINI', n2s: 'A1' };

// Best-effort printer type from the live report (modules) or the stored model string.
function printerType(detail) {
  const mods = Array.isArray(detail.modules) ? detail.modules : [];
  for (const m of mods) {
    const p = String(m.product || m.product_name || '').trim().toLowerCase();
    if (p && PRODUCT_MAP[p]) return PRODUCT_MAP[p];
  }
  for (const m of mods) {
    const hw = String(m.hw || m.hw_ver || '').toUpperCase();
    const proj = String(m.project || m.project_name || '').toLowerCase();
    if (hw === 'AP02') return 'X1E';
    if (proj && CODE_MAP[proj]) return CODE_MAP[proj];
    if (hw === 'AP05' && proj === '') return 'X1C';
  }
  const s = String(detail.model || '').trim();
  const sl = s.toLowerCase();
  if (PRODUCT_MAP[sl]) return PRODUCT_MAP[sl];
  if (CODE_MAP[sl]) return CODE_MAP[sl];
  const up = s.toUpperCase().replace(/BAMBU\s*LAB/i, '').replace(/\s+/g, '');
  for (const t of [...RTSP_TYPES, ...IMAGE_TYPES]) if (up.includes(t)) return t;
  return '';
}

// Decide how to fetch this printer's camera, the same way Home Assistant does:
//   how:'rtsp'  -> full video over RTSP(S) via go2rtc (X1 / P2 / H2 / X2)
//   how:'image' -> JPEG chamber image off port 6000 (A1 / P1; no RTSP switch needed)
//   how:'off'   -> an RTSP model that reports its liveview disabled; genuinely
//                  unavailable until the user enables LAN liveview (HA is identical)
//   how:'probe' -> unknown model: try the chamber image, then fall back to RTSP
function camTransport(detail) {
  const m = cameraMode(detail.report);
  if (m.mode === 'rtsps' || m.mode === 'rtsp') return { how: 'rtsp', mode: m.mode, url: m.url };
  if (m.mode === 'local') return { how: 'image' };
  const t = printerType(detail);
  if (m.mode === 'off') {
    // The printer says its RTSP liveview is disabled. RTSP-only models are then
    // truly off; chamber-image models never use that switch, so still try 6000.
    return { how: RTSP_TYPES.has(t) ? 'off' : 'image', type: t };
  }
  // No camera signal in the report at all: go by model.
  if (RTSP_TYPES.has(t)) return { how: 'rtsp', mode: 'rtsps', type: t };
  if (IMAGE_TYPES.has(t)) return { how: 'image', type: t };
  return { how: 'probe', type: t };
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

function go2rtcBinary(appDir, isPackaged, resourcesPath) {
  const name = process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc';
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'go2rtc', name)]
    : [path.join(appDir, '..', 'build', 'go2rtc', name), path.join(appDir, 'go2rtc', name)];
  if (process.env.PRINTLOG_GO2RTC) candidates.unshift(process.env.PRINTLOG_GO2RTC);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || '';
}

class Cameras {
  constructor({ appDir, isPackaged, resourcesPath, log }) {
    Object.assign(this, { appDir, isPackaged, resourcesPath, log: log || (() => {}) });
    this.bin = go2rtcBinary(appDir, isPackaged, resourcesPath);
    this.proc = null;
    this.apiPort = 0;
    this.starting = null;
    this.jpeg = new Map(); // serial -> { socket, stop }
    this.streams = new Set(); // go2rtc stream names
  }

  available() { return !!this.bin; }

  async ensureGo2rtc() {
    if (this.proc && this.apiPort) return this.apiPort;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (!this.bin) throw new Error('go2rtc missing');
      const api = await freePort();
      const wrtc = await freePort();
      const cfg = {
        api: { listen: `127.0.0.1:${api}` },
        rtsp: { listen: '' },
        srtp: { listen: '' },
        webrtc: { listen: `127.0.0.1:${wrtc}`, candidates: [`127.0.0.1:${wrtc}`] },
        log: { level: 'error' },
        streams: {},
      };
      const cfgPath = path.join(require('os').tmpdir(), `printlog-go2rtc-${process.pid}.yaml`);
      fs.writeFileSync(cfgPath, JSON.stringify(cfg));
      const proc = spawn(this.bin, ['-config', cfgPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      proc.stderr.on('data', (d) => this.log(`go2rtc: ${String(d).trim().slice(0, 200)}`));
      proc.on('exit', (code) => { this.log(`go2rtc exited (${code})`); if (this.proc === proc) { this.proc = null; this.apiPort = 0; this.streams.clear(); } });
      this.proc = proc;
      // wait for the API to answer
      for (let i = 0; i < 50; i++) {
        try { await this.api('GET', '/api', api); this.apiPort = api; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      if (!this.apiPort) { try { proc.kill(); } catch {} this.proc = null; throw new Error('go2rtc לא נענה'); }
      return this.apiPort;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  api(method, pathname, port) {
    const p = port || this.apiPort;
    return new Promise((res, rej) => {
      const req = http.request({ host: '127.0.0.1', port: p, path: pathname, method, timeout: 8000 }, (r) => {
        let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => (r.statusCode < 300 ? res(b) : rej(new Error(`go2rtc ${r.statusCode}`))));
      });
      req.on('error', rej); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
    });
  }

  // returns what the renderer needs to show the camera
  async start(detail) {
    const { serial, ip } = detail;
    const code = detail.accessCode || detail.access_code || '';
    if (!ip || !code) throw new Error('צריך חיבור ברשת הביתית למצלמה (IP וקוד גישה)');
    const t = camTransport(detail);
    // RTSP model with liveview switched off — genuinely unavailable until enabled
    // (Home Assistant behaves the same). Tell the user how to turn it on.
    if (t.how === 'off') throw new Error('המצלמה כבויה — הפעל צפייה ברשת מקומית (LAN Liveview) בהגדרות המדפסת');
    // X1 / P2 / H2 / X2: full video over RTSP(S), restreamed by go2rtc.
    if (t.how === 'rtsp') return this.startRtsp(serial, ip, code, t.mode, t.url);
    // A1 / P1: the JPEG chamber image straight off port 6000 — same path Home
    // Assistant uses; needs only IP + access code, not the RTSP liveview switch.
    if (t.how === 'image') {
      if (await this.startJpeg(serial, ip, code)) return { kind: 'mjpeg', serial };
      throw new Error('המצלמה כבויה בהגדרות המדפסת');
    }
    // Unknown model: try the chamber image, then fall back to RTSP.
    if (await this.startJpeg(serial, ip, code)) return { kind: 'mjpeg', serial };
    return this.startRtsp(serial, ip, code, 'rtsps', null);
  }

  async startRtsp(serial, ip, code, mode, reported) {
    const url = rtspUrl(mode === 'rtsp' ? 'rtsp' : 'rtsps', ip, code, reported);
    await this.ensureGo2rtc();
    const name = `cam_${serial.replace(/[^a-zA-Z0-9]/g, '')}`;
    await this.api('PUT', `/api/streams?name=${name}&src=${encodeURIComponent(url + '#timeout=30')}`);
    this.streams.add(name);
    return { kind: 'webrtc', url: `http://127.0.0.1:${this.apiPort}/webrtc.html?src=${name}&media=video` };
  }

  async stop(serial) {
    const j = this.jpeg.get(serial);
    if (j) { j.stop(); this.jpeg.delete(serial); }
    const name = `cam_${serial.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (this.streams.has(name) && this.apiPort) { try { await this.api('DELETE', `/api/streams?src=${name}`); } catch {} this.streams.delete(name); }
  }

  // Chamber image: TLS to :6000, 80-byte auth, then length-prefixed JPEG frames.
  // Resolves true once the first frame arrives, false if the camera can't be
  // reached before any frame (so the caller can report it as off / not this transport).
  startJpeg(serial, ip, code) {
    this.stop(serial);
    return new Promise((resolve) => {
      let stopped = false, sock = null, retry = null, settled = false, gotFrame = false;
      const onFrame = this.onFrame || (() => {});
      const settle = (v) => {
        if (settled) return; settled = true;
        if (!v) { stopped = true; clearTimeout(retry); try { sock && sock.destroy(); } catch {} this.jpeg.delete(serial); }
        resolve(v);
      };
      const connect = () => {
        if (stopped) return;
        const auth = Buffer.alloc(80);
        auth.writeUInt32LE(0x40, 0); auth.writeUInt32LE(0x3000, 4);
        auth.write(LAN_USER, 16); auth.write(code, 48);
        sock = tls.connect({ host: ip, port: 6000, rejectUnauthorized: false, timeout: 8000 }, () => sock.write(auth));
        let buf = Buffer.alloc(0), want = 0;
        sock.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          for (;;) {
            if (!want) { if (buf.length < 16) break; want = buf.readUInt32LE(0); buf = buf.subarray(16); }
            if (buf.length < want) break;
            const jpg = buf.subarray(0, want); buf = buf.subarray(want); want = 0;
            if (jpg[0] === 0xff && jpg[1] === 0xd8) { gotFrame = true; settle(true); onFrame(serial, 'data:image/jpeg;base64,' + jpg.toString('base64')); }
          }
        });
        const again = () => {
          if (stopped) return;
          try { sock.destroy(); } catch {}
          if (!gotFrame) { settle(false); return; }   // never produced a frame -> wrong transport / camera off
          retry = setTimeout(connect, 2000);           // transient drop while already streaming
        };
        sock.on('error', again); sock.on('close', again); sock.on('timeout', again);
      };
      this.jpeg.set(serial, { stop: () => { stopped = true; clearTimeout(retry); try { sock && sock.destroy(); } catch {} } });
      connect();
      setTimeout(() => settle(false), 10000);          // safety: nothing within 10s -> treat as not available
    });
  }

  stopAll() {
    for (const [, j] of this.jpeg) j.stop();
    this.jpeg.clear();
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; this.apiPort = 0; }
  }
}

module.exports = { Cameras, cameraMode, rtspUrl, printerType, camTransport };
