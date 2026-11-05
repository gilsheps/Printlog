// Timelapse videos from the printer's SD card (FTPS on the LAN, user "bblp" + access code).
// Bambu Cloud doesn't serve them, so this only runs for printers we can reach at home.
// Any failure is logged and skipped: the cards simply have no video.
const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp');

const DIRS = ['/timelapse', '/sdcard/timelapse'];
const VIDEO = /\.(mp4|avi)$/i;
// video_2026-10-31_13-59-12.mp4: the print's start, in the printer's (= this computer's) local time
function fileTime(name) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

async function listVideos(client) {
  for (const dir of DIRS) {
    try {
      const list = await client.list(dir);
      const vids = list.filter((f) => f.isFile && VIDEO.test(f.name)).map((f) => ({ dir, name: f.name, size: f.size, t: fileTime(f.name) }));
      if (vids.length || list.length) return vids;
    } catch { }
  }
  return [];
}

// best print for a video: same printer, started within 20 minutes of the file's timestamp
function matchPrint(prints, serial, v) {
  if (v.t == null) return null;
  let best = null, bestD = 20 * 60000;
  for (const p of prints) {
    if (p.serial !== serial || p.timelapse) continue;
    const d = Math.abs((Date.parse(p.start || '') || 0) - v.t);
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

/**
 * Download new timelapses of one printer into <library>/.shelf/timelapse and link them to their prints.
 * opts: { printer: {serial, name, ip, access_code}, library, out, del, log }
 */
async function syncPrinter({ printer, library, out, del, log }) {
  const client = new ftp.Client(30000);
  let got = 0;
  try {
    await client.access({ host: printer.ip, port: 990, user: 'bblp', password: printer.access_code, secure: 'implicit', secureOptions: { rejectUnauthorized: false } });
    const vids = await listVideos(client);
    const seen = new Set(out.data.timelapseSeen || []);
    const dir = path.join(library, '.shelf', 'timelapse');
    for (const v of vids) {
      const id = `${printer.serial}/${v.name}`;
      if (seen.has(id)) continue;
      const p = matchPrint(out.data.prints, printer.serial, v);
      if (!p) continue; // the print isn't in the history yet: try again next time
      fs.mkdirSync(dir, { recursive: true });
      const name = `${printer.serial}_${v.name}`;
      const dst = path.join(dir, name);
      const part = dst + '.part';
      await client.downloadTo(part, `${v.dir}/${v.name}`);
      if (v.size && fs.statSync(part).size !== v.size) { fs.unlinkSync(part); throw new Error(`${v.name}: incomplete download`); }
      fs.renameSync(part, dst);
      p.timelapse = 'timelapse/' + name;
      seen.add(id);
      got++;
      log(`timelapse: ${printer.name} ${v.name} -> ${p.title || p.key}`);
      if (del) {
        try { await client.remove(`${v.dir}/${v.name}`); log(`timelapse: deleted ${v.name} from the printer`); } catch (e) { log(`timelapse: delete failed (${e.message})`); }
      }
    }
    out.data.timelapseSeen = [...seen].slice(-2000);
    if (got) out.write();
  } catch (e) {
    log(`timelapse: ${printer.name} skipped (${e.message})`);
  } finally { client.close(); }
  return got;
}

module.exports = { syncPrinter, fileTime, matchPrint };
