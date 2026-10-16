// End-to-end test of the desktop app: library in a temp folder, LAN printer = fake TLS MQTT broker.
const { _electron: electron } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os'), tls = require('tls'), cp = require('child_process');

const SHOTS = path.join(__dirname, 'shots');
const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'madaf-lib-'));
cp.execSync(`cp -r ${path.join(__dirname, '../fixtures/out')}/. ${lib}/`);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'madaf-home-'));
const userData = path.join(home, '.config', 'Model Shelf');
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ library: lib, mode: 'lan', printers: [{ serial: 'SER1', name: 'P2S', model: 'P2S', ip: '127.0.0.1', access_code: '12345678' }], options: { notify: true } }));

// fake printer
const T = process.env.CERTDIR;
const enc = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return Buffer.from(o); };
const pkt = (t, b) => Buffer.concat([Buffer.from([t]), enc(b.length), b]);
const s16 = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
let sock = null, got = {};
const srv = tls.createServer({ key: fs.readFileSync(T + '/k.pem'), cert: fs.readFileSync(T + '/c.pem') }, (s) => {
  sock = s;
  s.on('data', (d) => {
    const t = d[0] >> 4;
    if (t === 1) { got.connect = d.includes(Buffer.from('12345678')); s.write(pkt(0x20, Buffer.from([0, 0]))); }
    if (t === 8) { got.sub = true; s.write(pkt(0x90, Buffer.concat([d.subarray(2, 4), Buffer.from([0])]))); }
    if (t === 3) got.pushall = d.includes(Buffer.from('pushall'));
  });
  s.on('error', () => {});
});
const report = (st, extra = {}) => sock.write(pkt(0x30, Buffer.concat([s16('device/SER1/report'), Buffer.from(JSON.stringify({ print: { gcode_state: st, subtask_name: 'donut', mc_percent: st === 'RUNNING' ? 37 : 100, ...extra } }))])));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listen(8883, '127.0.0.1', r));
  const app = await electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox'], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') } });
  app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d));
  app.process().stderr.on('data', (d) => { const s = String(d); if (!/dbus|Fontconfig|GPU|gles|viz|ERROR:.*(bus|zygote)/i.test(s)) process.stdout.write('[err] ' + s.slice(0, 300)); });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await win.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
  await sleep(6000);
  console.log('models:', await win.evaluate(() => Object.keys(window.__shelf.lib.data.models).length));
  console.log('broker:', got);
  report('PREPARE'); await sleep(300); report('RUNNING'); await sleep(17000);
  await win.screenshot({ path: SHOTS + '/a1_running.png' });
  report('FINISH'); await sleep(2500);
  await win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(1500);
  console.log('donut prints:', await win.evaluate(() => Object.values(window.__shelf.lib.data.models).filter((m) => m.prints.length).map((m) => [m.name, m.prints.map((p) => [p.key, p.result, p.source])])));
  const sync = JSON.parse(fs.readFileSync(path.join(lib, '.shelf/printer-sync.json'), 'utf8'));
  console.log('sync file prints:', sync.prints.map((p) => [p.title, p.result, p.source]), 'printer:', sync.printers.SER1 && sync.printers.SER1.state);
  await win.screenshot({ path: SHOTS + '/a2_after.png' });
  await win.click('#ppill');
  await sleep(500);
  await win.screenshot({ path: SHOTS + '/a3_settings.png' });
  await win.click('[data-mode="cloud"]');
  await sleep(300);
  await win.screenshot({ path: SHOTS + '/a4_settings_cloud.png' });
  // login attempt (network is blocked here -> should show a friendly error)
  await win.fill('#lemail', 'test@example.com');
  await win.fill('#lpass', 'x');
  await win.click('[data-login]');
  await sleep(4000);
  console.log('login msg:', await win.evaluate(() => (document.querySelector('.settings .notice') || {}).textContent));
  await win.screenshot({ path: SHOTS + '/a5_login_err.png' });
  await app.close().catch(() => {});
  srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
