// Finding a print's file on the printer's storage: listing times, name matching, and the
// FTPS options (the data channel needs `host` in its TLS options or the printer refuses it).
const assert = require('assert');
const { access, listTime, norm, matchFile } = require('../../app/printerfiles.js');

// --- FTPS options ---
const a = access({ ip: '192.168.1.10', access_code: 'abcd1234' });
assert.strictEqual(a.secureOptions.host, '192.168.1.10', 'host in the TLS options (data channel session reuse)');
assert.strictEqual(a.port, 990); assert.strictEqual(a.user, 'bblp'); assert.strictEqual(a.secure, 'implicit');

// --- LIST times: "Mon DD HH:MM" is within the last year, "Mon DD  YYYY" is older (UTC) ---
const now = Date.UTC(2026, 10, 20, 12, 0);
assert.strictEqual(listTime('Nov 19 15:13', now), Date.UTC(2026, 10, 19, 15, 13), 'this year');
assert.strictEqual(listTime('Dec 30 10:00', now), Date.UTC(2025, 11, 30, 10, 0), 'a later month is last year');
assert.strictEqual(listTime('Aug 27  2025', now), Date.UTC(2025, 7, 27), 'with a year');
assert.strictEqual(listTime('garbage', now), null);

// --- names: case, "_" vs " ", what the slicer does to | and / ---
assert.strictEqual(norm('Minimalist_Chess_Set_ Foldable_&_Portable.gcode.3mf'), norm('Minimalist Chess Set | Foldable & Portable'));
assert.strictEqual(norm('Leafeon_NO_AMS.gcode.3mf'), norm('Leafeon / NO AMS'));
assert.strictEqual(norm('פנינית 3.gcode.3mf'), 'פנינית 3');

const T = (s) => Date.parse(s);
const files = [
  { dir: '/', name: 'Spiral_fidget_30mm.gcode.3mf', size: 1, t: T('2026-10-17T15:02:00Z') },
  { dir: '/cache', name: 'CuteBara_makerlab.gcode.3mf', size: 1, t: T('2026-11-19T15:13:00Z') },
  { dir: '/', name: 'Stainless_Katana_Sword_(Print_in_Place).gcode.3mf', size: 1, t: T('2026-10-22T20:11:00Z') },
  { dir: '/', name: 'Sensory_Ball_full_board_V9_plate_1.gcode.3mf', size: 1, t: T('2026-09-27T18:19:00Z') },
  { dir: '/', name: 'Sensory_Ball_full_board_V9_plate_2.gcode.3mf', size: 1, t: T('2026-09-28T10:45:00Z') },
  { dir: '/', name: 'notes.txt', size: 1, t: T('2026-10-22T20:10:00Z') },
];
const m = (p) => { const f = matchFile(files, p); return f && f.name; };
assert.strictEqual(m({ title: 'Spiral_fidget_30mm', start: '2026-10-17T15:03:54Z' }), 'Spiral_fidget_30mm.gcode.3mf', 'project title');
assert.strictEqual(m({ title: '3h print profile - 0.28mm layer', design: 'Stainless Katana Sword (Print in Place)', start: '2026-10-23T10:47:23Z' }), 'Stainless_Katana_Sword_(Print_in_Place).gcode.3mf', 'MakerWorld design when the title is a profile');
assert.strictEqual(m({ title: 'Sensory_Ball_full_board_V9_plate_2', start: '2026-09-28T10:46:46Z' }), 'Sensory_Ball_full_board_V9_plate_2.gcode.3mf', 'the right plate file');
assert.strictEqual(m({ title: 'x', file: '/sdcard/CuteBara_makerlab.gcode.3mf', start: '2026-11-19T15:13:09Z' }), 'CuteBara_makerlab.gcode.3mf', 'file the printer reported (path stripped)');
assert.strictEqual(m({ title: 'Plate 1', start: '2026-11-19T15:13:09Z' }), 'CuteBara_makerlab.gcode.3mf', 'generic name: the one file written just before the start');
assert.strictEqual(m({ title: 'Plate 1', start: '2026-11-19T16:00:00Z' }), null, 'nothing written just before: no guess');
assert.strictEqual(m({ title: 'Something else', start: '2026-05-01T10:00:00Z' }), null, 'unknown name, no fresh file');
assert.strictEqual(m({ title: 'notes', start: '2026-10-22T20:11:00Z' }), 'Stainless_Katana_Sword_(Print_in_Place).gcode.3mf', 'only .gcode.3mf files count');

console.log('printer files ok');

// --- blanked downloads (firmware serves 0xFF bytes) are recognised ---
{
  const fs = require('fs'), os = require('os'), path = require('path');
  const { blanked } = require('../../app/printerfiles.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  fs.writeFileSync(path.join(dir, 'b'), Buffer.alloc(5000, 0xff));
  fs.writeFileSync(path.join(dir, 'z'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100, 0xff)]));
  assert.strictEqual(blanked(path.join(dir, 'b')), true, 'all 0xFF');
  assert.strictEqual(blanked(path.join(dir, 'z')), false, 'a real zip');
  fs.rmSync(dir, { recursive: true });
}
console.log('printer files blanked ok');

// --- guarded download: a blanked copy stops at the first chunk, a real file is written whole ---
(async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Readable, pipeline } = require('stream');
  const { guardedFile } = require('../../app/printerfiles.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  const run = (chunks, file) => new Promise((res) => pipeline(Readable.from(chunks), guardedFile(file), (err) => res(err)));
  const errB = await run([Buffer.alloc(1000, 0xff), Buffer.alloc(1000, 0xff)], path.join(dir, 'b'));
  assert.ok(errB && errB.blanked, 'blanked copy → err.blanked');
  const real = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(5000, 7)]);
  const errZ = await run([real.subarray(0, 100), real.subarray(100)], path.join(dir, 'z'));
  assert.strictEqual(errZ, undefined, 'real file ok');
  assert.ok(fs.readFileSync(path.join(dir, 'z')).equals(real), 'written whole');
  fs.rmSync(dir, { recursive: true });
  console.log('printer files guarded download ok');
})().catch((e) => { console.error(e); process.exit(1); });
