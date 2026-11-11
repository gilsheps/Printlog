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
    const m = cameraMode(detail.report);
    if (m.mode === 'off') throw new Error('המצלמה כבויה בהגדרות המדפסת');
    // X1 legacy chamber image: JPEG straight off port 6000
    if (m.mode === 'local') { this.startJpeg(serial, ip, code); return { kind: 'mjpeg', serial }; }
    // everyone else: RTSP(S) via go2rtc -> WebRTC. "unknown" printers try this too (it covers all current models).
    const mode = m.mode === 'rtsp' ? 'rtsp' : 'rtsps';
    const url = rtspUrl(mode, ip, code, m.url);
    await this.ensureGo2rtc();
    const name = `cam_${serial.replace(/[^a-zA-Z0-9]/g, '')}`;
    await this.api('PUT', `/api/streams?name=${name}&src=${encodeURIComponent(url + '#timeout=30')}`);
    this.streams.add(name);
    return { kind: 'webrtc', url: `http://127.0.0.1:${this.apiPort}/webrtc.html?src=${name}&media=video`, fallbackLegacy: m.mode === 'unknown' };
  }

  async stop(serial) {
    const j = this.jpeg.get(serial);
    if (j) { j.stop(); this.jpeg.delete(serial); }
    const name = `cam_${serial.replace(/[^a-zA-Z0-9]/g, '')}`;
    if (this.streams.has(name) && this.apiPort) { try { await this.api('DELETE', `/api/streams?src=${name}`); } catch {} this.streams.delete(name); }
  }

  // X1 chamber image: TLS to :6000, 80-byte auth, then length-prefixed JPEG frames
  startJpeg(serial, ip, code) {
    this.stop(serial);
    let stopped = false, sock = null, retry = null;
    const onFrame = this.onFrame || (() => {});
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
          if (jpg[0] === 0xff && jpg[1] === 0xd8) onFrame(serial, 'data:image/jpeg;base64,' + jpg.toString('base64'));
        }
      });
      const again = () => { if (stopped) return; try { sock.destroy(); } catch {} retry = setTimeout(connect, 2000); };
      sock.on('error', again); sock.on('close', again); sock.on('timeout', again);
    };
    connect();
    this.jpeg.set(serial, { stop: () => { stopped = true; clearTimeout(retry); try { sock && sock.destroy(); } catch {} } });
  }

  stopAll() {
    for (const [, j] of this.jpeg) j.stop();
    this.jpeg.clear();
    if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; this.apiPort = 0; }
  }
}

module.exports = { Cameras, cameraMode, rtspUrl };
