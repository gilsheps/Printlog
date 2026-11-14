// a live (LAN/cloud MQTT) record and the cloud record of the same print must end up as one entry
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Output } = require('../../app/engine.js');

const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'printlog-dedup-'));
fs.mkdirSync(path.join(lib, '.shelf'));
const file = path.join(lib, '.shelf', 'printer-sync.json');
// the real case: the app joined mid-print and saw FINISH 14h late, so the
// times are far off; only the task id links the two records
const live = { key: 'live-S1-1432539813', source: 'lan-live', serial: 'S1', title: 'Keychain_plate-1', plate: 0, result: 'ok', start: '2026-11-11T21:59:17Z', end: '2026-11-12T15:29:45Z', minutes: 1050, timelapse: 'tl.mp4' };
const cloud = { key: 'cloud-1432539813', source: 'cloud', serial: 'S1', title: 'Keychain_plate-1', plate: 1, result: 'ok', start: '2026-11-11T19:00:47Z', end: '2026-11-12T01:48:32Z', minutes: 408 };
const other = { key: 'live-S1-999', source: 'lan-live', serial: 'S1', title: 'Other', plate: 0, result: 'ok', start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:00:00Z', minutes: 60 };

// 1. duplicate already on disk: folded when the file is loaded
fs.writeFileSync(file, JSON.stringify({ prints: [live, cloud, other] }));
let o = new Output(lib, 'lan');
assert.deepStrictEqual(o.data.prints.map((p) => p.key).sort(), ['cloud-1432539813', 'live-S1-999']);
const c = o.data.prints.find((p) => p.key === 'cloud-1432539813');
assert.deepStrictEqual(c.aliasKeys, ['live-S1-1432539813']);
assert.strictEqual(c.timelapse, 'tl.mp4');
assert.strictEqual(c.minutes, 408, 'cloud times win');

// 2. cloud record arrives after the live one
fs.writeFileSync(file, JSON.stringify({ prints: [live] }));
o = new Output(lib, 'lan');
assert.strictEqual(o.addPrint({ ...cloud }), false);
assert.deepStrictEqual(o.data.prints.map((p) => p.key), ['cloud-1432539813']);

// 3. live record arrives after the cloud one (task id on the entry)
fs.writeFileSync(file, JSON.stringify({ prints: [cloud] }));
o = new Output(lib, 'lan');
assert.strictEqual(o.addPrint({ ...live, key: 'live-S1-2026-11-11T21:59:17Z', task: '1432539813' }), false);
assert.strictEqual(o.data.prints.length, 1);

// 4. a different task is still its own print
assert.strictEqual(o.addPrint({ ...other }), true);
assert.strictEqual(o.data.prints.length, 2);

fs.rmSync(lib, { recursive: true, force: true });
console.log('dedup ok');
