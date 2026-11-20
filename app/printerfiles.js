// Print files kept on the printer's own storage (SD card / USB), over FTPS on the LAN
// (user "bblp" + the access code). Every Bambu printer keeps the .gcode.3mf it was sent:
// in the root for prints sent from the slicer, in /cache for prints started from the cloud.
// Used when Bambu Cloud has no file for a print: the printer often still has it.
const fs = require('fs');
const { Writable } = require('stream');
const ftp = require('basic-ftp');

// root + /cache on the SD card as the FTPS root (P1/A1/P2S); some firmware roots at / with the card under
// /sdcard, and H2-series printers can print from a USB drive. A missing folder is just skipped.
const DIRS = ['/', '/cache', '/sdcard', '/sdcard/cache', '/usb', '/usb/cache'];
const PRINT_FILE = /\.gcode\.3mf$/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// FTPS options for a printer. `host` must be in the TLS options too: basic-ftp wraps the data
// connection in TLS with these options, and without it the printer refuses the data channel
// ("522 session reuse required"), so every listing / download failed.
const access = (printer) => ({
  host: printer.ip, port: 990, user: 'bblp', password: printer.access_code, secure: 'implicit',
  secureOptions: { rejectUnauthorized: false, host: printer.ip },
});

// "Nov 19 15:13" (this year, UTC) or "Aug 27  2025" (older) from a LIST line → ms, or null
function listTime(raw, now = Date.now()) {
  const m = String(raw || '').trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(?:(\d{1,2}):(\d{2})|(\d{4}))$/);
  if (!m || MONTHS[m[1].toLowerCase()] == null) return null;
  const mo = MONTHS[m[1].toLowerCase()], d = +m[2];
  if (m[5]) return Date.UTC(+m[5], mo, d);
  const y = new Date(now).getUTCFullYear();
  let t = Date.UTC(y, mo, d, +m[3], +m[4]);
  if (t > now + 864e5) t = Date.UTC(y - 1, mo, d, +m[3], +m[4]); // a time without a year is within the last 12 months
  return t;
}

// comparable name: no extension, case, "_" vs " " or unicode form
const norm = (s) => String(s || '').normalize('NFC').replace(/\.(gcode\.3mf|3mf|gcode)$/i, '')
  .toLowerCase().replace(/[|/\\:*?"<>]+/g, ' ').replace(/[_\s]+/g, ' ').trim(); // the slicer turns |/: etc. into _
const noPlate = (s) => s.replace(/[ _-]*plate[ _-]*\d+$/i, '').trim();
// names Bambu uses for a plate inside a project: say nothing about the model
const GENERIC = /^(plate \d+|untitled|model)$/;

/**
 * The storage file that holds a print, or null.
 * files: [{ dir, name, size, t }]; print: a history record ({ title, design, file, start, end }).
 * By name first (project title / design / file the printer reported); the file whose time is
 * closest to the print's start wins when several match. Without a usable name: the one file
 * that was written in the minutes before the print started.
 */
function matchFile(files, print) {
  const list = (files || []).filter((f) => PRINT_FILE.test(f.name));
  const start = Date.parse((print && print.start) || '') || 0;
  const near = (f) => (f.t != null && start ? Math.abs(f.t - start) : Infinity);
  const names = [print.title, print.design, String(print.file || '').replace(/^.*[\\/]/, '')].map(norm).filter((n) => n && !GENERIC.test(n));
  const pick = (hits) => (hits.length ? hits.sort((a, b) => near(a) - near(b))[0] : null);
  let hit = pick(list.filter((f) => names.includes(norm(f.name))));
  if (!hit) { const loose = names.map(noPlate).filter(Boolean); hit = pick(list.filter((f) => loose.includes(noPlate(norm(f.name))))); }
  if (hit || !start) return hit;
  // a file sent for this print is written just before it starts (the listing has minutes only)
  const fresh = list.filter((f) => f.t != null && f.t >= start - 10 * 60000 && f.t <= start + 2 * 60000);
  return fresh.length === 1 ? fresh[0] : null;
}

async function connect(printer) {
  const client = new ftp.Client(20000);
  try { await client.access(access(printer)); } catch (err) { client.close(); throw err; }
  return client;
}

// every print file on the printer: [{ dir, name, size, t }]
// throws when no folder could be listed (connection dropped): an empty answer must not read as "not there"
async function listFiles(client, now = Date.now()) {
  const out = [];
  let ok = 0, lastErr = null;
  for (const dir of DIRS) {
    let list;
    try { list = await client.list(dir); ok++; } catch (err) { lastErr = err; if (client.closed) break; continue; }
    for (const f of list) if (f.isFile && PRINT_FILE.test(f.name)) out.push({ dir, name: f.name, size: f.size, t: listTime(f.rawModifiedAt, now) });
  }
  if (!ok) throw lastErr || new Error('no folder could be listed');
  return out;
}

// Newer Bambu firmware lists the files but serves their bytes blanked out (every byte 0xFF, the
// right size), so a download has to be checked before it is used, linked or deleted on the printer.
function blanked(file) {
  const b = Buffer.alloc(64);
  let n = 0;
  try { const fd = fs.openSync(file, 'r'); n = fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); } catch { return false; }
  return n > 0 && b.subarray(0, n).every((x) => x === 0xff);
}

// a file to download into that stops at the first chunk when the printer serves a blanked copy,
// instead of pulling the whole (maybe hundreds of MB) file first. The download then fails with err.blanked.
function guardedFile(file) {
  const out = fs.createWriteStream(file);
  let first = true;
  return new Writable({
    write(chunk, _enc, cb) {
      if (first) {
        first = false;
        const head = chunk.subarray(0, 64);
        if (head.length && head.every((x) => x === 0xff)) { const err = new Error('the printer serves blanked files'); err.blanked = true; out.destroy(); return cb(err); }
      }
      if (out.write(chunk)) cb(); else out.once('drain', () => cb());
    },
    final(cb) { out.end(cb); },
    destroy(err, cb) { if (!out.closed) out.destroy(); cb(err); },
  });
}

const remotePath = (f) => (f.dir === '/' ? '' : f.dir) + '/' + f.name;

module.exports = { access, listTime, norm, matchFile, connect, listFiles, remotePath, blanked, guardedFile };
