const assert = require('assert');
const os = require('os');
const { fileTime, matchPrint, syncPrinter } = require('../../app/timelapse.js');

const t = fileTime('video_2026-10-31_13-59-12.mp4');
assert.strictEqual(t, new Date(2026, 9, 31, 13, 59, 12).getTime());
assert.strictEqual(fileTime('random.mp4'), null);
const iso = (ms) => new Date(ms).toISOString();
const prints = [
  { key: 'a', serial: 'S1', start: iso(t + 25 * 60000) },
  { key: 'b', serial: 'S1', start: iso(t + 3 * 60000) },
  { key: 'c', serial: 'S2', start: iso(t) },
];
assert.strictEqual(matchPrint(prints, 'S1', { t }).key, 'b');
assert.strictEqual(matchPrint(prints, 'S3', { t }), null);
prints[1].timelapse = 'x';
assert.strictEqual(matchPrint(prints, 'S1', { t }), null, 'already linked / too far');

// unreachable printer: no throw, nothing downloaded, only a log line
(async () => {
  const logs = [];
  const n = await syncPrinter({ printer: { serial: 'S1', name: 'P', ip: '127.0.0.1', access_code: 'x' }, library: os.tmpdir(), out: { data: { prints: [] }, write() {} }, del: false, log: (m) => logs.push(m) });
  assert.strictEqual(n, 0);
  assert.ok(logs[0].includes('skipped'), logs[0]);
  console.log('timelapse ok');
})();
