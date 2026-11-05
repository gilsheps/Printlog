// "both" mode: LAN -> cloud handoff, driven through startMqtt's callbacks (no real broker)
const assert = require('assert');
const { startMqtt, LiveWatcher } = require('../../app/engine.js');
const printers = {};
const out = { data: { printers }, setPrinter: (s, i) => { printers[s] = { ...(printers[s] || {}), ...i }; }, addPrint: () => false, write() {} };
const w = new LiveWatcher(out, 'S1', 'P1', 'lan', null);
const ws = { S1: w };
const log = () => {};
const conn = { subscribe() {}, publish() {} };
const lan = startMqtt({ host: '127.0.0.1', port: 1, serials: ['S1'], watchers: ws, label: 'lan', out, log, user: 'u', password: 'p', insecure: true,
  onState: (up) => { w.lanUp = up; w.source = up ? 'lan' : 'cloud'; }, accept: () => w.lanUp });
const cloud = startMqtt({ host: 'localhost', port: 1, serials: ['S1'], watchers: ws, label: 'Bambu Cloud', out, log, user: 'u', password: 'p', accept: (s) => !ws[s].lanUp });
lan.stop(); cloud.stop();
const rep = (pct) => Buffer.from(JSON.stringify({ print: { gcode_state: 'RUNNING', mc_percent: pct } }));

lan.onDown(new Error('EHOSTUNREACH'));
assert.notStrictEqual(printers.S1?.conn, 'offline', 'LAN drop must not mark offline in both mode');
cloud.onMessage('device/S1/report', rep(10));
assert.strictEqual(printers.S1.conn, 'cloud'); assert.strictEqual(printers.S1.progress, 10);

lan.onConnect(conn, 0);
cloud.onMessage('device/S1/report', rep(20));
assert.strictEqual(printers.S1.progress, 10, 'cloud ignored while LAN is up');
lan.onMessage('device/S1/report', rep(30));
assert.strictEqual(printers.S1.conn, 'lan'); assert.strictEqual(printers.S1.progress, 30);
cloud.onDown(new Error('closed'));
assert.strictEqual(printers.S1.conn, 'lan', 'cloud drop while LAN is up');

lan.onDown(new Error('closed'));
cloud.onMessage('device/S1/report', rep(40));
assert.strictEqual(printers.S1.conn, 'cloud'); assert.strictEqual(printers.S1.progress, 40);

// cloud that never connects (port 8883 blocked): an explained error after a few tries
const p2 = {};
const out2 = { data: { printers: p2 }, setPrinter: (s, i) => { p2[s] = { ...(p2[s] || {}), ...i }; } };
const c2 = startMqtt({ host: 'localhost', port: 1, serials: ['S2'], watchers: {}, label: 'Bambu Cloud', out: out2, log, user: 'u', password: 'p' });
c2.stop();
c2.onDown(new Error('timeout')); assert.strictEqual(p2.S2.conn, 'offline');
c2.onDown(new Error('timeout')); c2.onDown(new Error('timeout'));
assert.strictEqual(p2.S2.conn, 'error'); assert.ok(/8883/.test(p2.S2.error));
console.log('LAN/cloud handoff ok');
process.exit(0);
