// Print files kept on the printer's own storage (SD card / USB), over FTPS on the LAN
// (user "bblp" + the access code). Every Bambu printer keeps the .gcode.3mf it was sent:
// in the root for prints sent from the slicer, in /cache for prints started from the cloud.
// Used when Bambu Cloud has no file for a print: the printer often still has it.
const ftp = require('basic-ftp');

const DIRS = ['/', '/cache'];
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
  await client.access(access(printer));
  return client;
}

// every print file on the printer: [{ dir, name, size, t }]
async function listFiles(client, now = Date.now()) {
  const out = [];
  for (const dir of DIRS) {
    let list;
    try { list = await client.list(dir); } catch { continue; }
    for (const f of list) if (f.isFile && PRINT_FILE.test(f.name)) out.push({ dir, name: f.name, size: f.size, t: listTime(f.rawModifiedAt, now) });
  }
  return out;
}

// Newer Bambu firmware lists the files but serves their bytes blanked out (every byte 0xFF, the
// right size), so a download has to be checked before it is used, linked or deleted on the printer.
function blanked(file) {
  const fs = require('fs');
  const b = Buffer.alloc(64);
  let n = 0;
  try { const fd = fs.openSync(file, 'r'); n = fs.readSync(fd, b, 0, 64, 0); fs.closeSync(fd); } catch { return false; }
  return n > 0 && b.subarray(0, n).every((x) => x === 0xff);
}

const remotePath = (f) => (f.dir === '/' ? '' : f.dir) + '/' + f.name;

module.exports = { access, listTime, norm, matchFile, connect, listFiles, remotePath, blanked };
