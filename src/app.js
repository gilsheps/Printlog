import { _t, tx, loc, getLang } from './i18n.js';
import { Library, kvGet, kvSet, uid, baseName, dirName, stripExt, prettyName } from './store.js';
import { parseModel, read3MFMeta, fileKind } from './parse.js';
import { printerScreenHTML } from './printer.js';
import { renderThumbnail, Viewer, bedLayout } from './render.js';
import { readSyncFile, importPrints, attach, norm, isGeneric, entryResult } from './sync.js';
import helperSrc from '../helper/shelf_sync.py';
import { native, NativeDirHandle, toBlob } from './native.js';

/* ================= helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const I = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  // card badges: downloaded from Bambu Cloud / in Google Drive / can be uploaded to Drive
  bambuDl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/><path d="M12 9.5v6M9.5 13l2.5 2.5 2.5-2.5"/></svg>',
  driveOk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/><path d="M9.3 13.6l1.9 1.9 3.6-3.8"/></svg>',
  driveUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/><path d="M12 16v-6M9.5 12.5L12 10l2.5 2.5"/></svg>',
  mark: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><polygon points="50.00,27.00 76.00,42.00 50.00,57.00 24.00,42.00" fill="#fff"/><polygon points="24.00,42.80 50.00,57.80 50.00,62.20 24.00,47.20" fill="#fff" fill-opacity="0.92"/><polygon points="50.00,57.80 76.00,42.80 76.00,47.20 50.00,62.20" fill="#fff" fill-opacity="0.62"/><polygon points="24.00,48.80 50.00,63.80 50.00,68.20 24.00,53.20" fill="#fff" fill-opacity="0.78"/><polygon points="50.00,63.80 76.00,48.80 76.00,53.20 50.00,68.20" fill="#fff" fill-opacity="0.5"/><polygon points="24.00,54.80 50.00,69.80 50.00,74.20 24.00,59.20" fill="#fff" fill-opacity="0.92"/><polygon points="50.00,69.80 76.00,54.80 76.00,59.20 50.00,74.20" fill="#fff" fill-opacity="0.62"/><polygon points="24.00,60.80 50.00,75.80 50.00,80.20 24.00,65.20" fill="#fff" fill-opacity="0.78"/><polygon points="50.00,75.80 76.00,60.80 76.00,65.20 50.00,80.20" fill="#fff" fill-opacity="0.5"/><polygon points="24.00,66.80 50.00,81.80 50.00,86.20 24.00,71.20" fill="#fff" fill-opacity="0.92"/><polygon points="50.00,81.80 76.00,66.80 76.00,71.20 50.00,86.20" fill="#fff" fill-opacity="0.62"/><polygon points="24.00,72.80 50.00,87.80 50.00,92.20 24.00,77.20" fill="#fff" fill-opacity="0.78"/><polygon points="50.00,87.80 76.00,72.80 76.00,77.20 50.00,92.20" fill="#fff" fill-opacity="0.5"/><polygon points="41.00,11.00 59.00,11.00 54.00,20.00 46.00,20.00" fill="#1f1d1a"/><polygon points="47.80,20.00 52.20,20.00 50.00,24.50" fill="#1f1d1a"/></svg>',
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 18h16M6 14h12M8 10h8M10 6h4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  wire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l16 9M20 7.5l-16 9M12 3v18"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4v5a5 5 0 0 0 5 5h7M6 20v-6M15 11l3 3-3 3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4h12v16l-6-4-6 4z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
  printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M9 7v6l3 3 3-3V7M7 18h10"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};

function hueFor(tag) {
  if (lib && lib.data.tagColors[tag] != null) return lib.data.tagColors[tag];
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
const tagHTML = (t, removable) => `<span class="tag" style="--h:${hueFor(t)}">${esc(t)}${removable ? _t`<button data-rmtag="${esc(t)}" title="הסר">×</button>` : ''}</span>`;
const fmtBytes = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const fmtDur = (sec) => { if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? _t`${h} ש׳${m ? _t` ${m} ד׳` : ''}` : _t`${m} ד׳`; };
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const dispPath = (p) => (String(p).startsWith('@models/') ? '⬇ Bambu / ' + p.slice(8) : String(p).startsWith('@archive/') ? _t('☁ ארכיון/') + p.slice(9) : String(p).startsWith('@gdrive/') ? '☁ Google Drive/' + p.split('/').slice(2).join('/') : p);
const isArchived = (p) => /^@(archive|gdrive)\//.test(p);
const RESULT = { ok: _t('הצליחה'), partial: _t('חלקית'), fail: _t('נכשלה'), cancel: _t('בוטלה') };
// build plates of the model's current file (each plate = a separate print)
function platesOf(m) { return (lib.data.files[(m.versions.find((v) => v.path === m.current) || m.versions[m.versions.length - 1]).path]?.meta?.plates) || []; }
function plateStatus(m) {
  const res = {};
  for (const p of [...m.prints].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.at || '').localeCompare(b.at || ''))) {
    if (!p.plateNo || p.result === 'cancel') continue;
    const cur = res[p.plateNo];
    res[p.plateNo] = cur === 'ok' && p.result !== 'ok' ? 'ok' : p.result; // a plate stays "done" once it printed fine
  }
  return res;
}

// language picker: each language named in itself, so it reads the same in both
const LANG_ROW = () => `<div class="field" style="display:flex;align-items:center;gap:10px;margin:4px 0 8px"><label style="margin:0">שפה · Language</label><select class="inp" id="olang" style="width:auto">${[['he', 'עברית'], ['en', 'English']].map(([k, l]) => `<option value="${k}" ${getLang() === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;

// which screen the app opens on
const START_ROW = (cur) => `<div class="field" style="display:flex;align-items:center;gap:10px;margin:0 0 8px"><label style="margin:0">${_t('מסך פתיחה')}</label><select class="inp" id="ostart" style="width:auto">${[['last', _t('המסך האחרון שהיה פתוח')], ['ok', _t('הדפסות שהצליחו')], ['history', _t('כל ההדפסות')], ['all', _t('כל הקבצים')], ['printer', _t('מסך המדפסת')], ...(native && native.makerworld ? [['mine', _t('המודלים שלי ב-MakerWorld')]] : [])].map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
// fallback when not signed in to Bambu: the user's MakerWorld profile link, so "My MakerWorld models" knows who they are
const MW_ROW = (cur) => (native && native.makerworld ? `<div class="field" style="margin:0 0 8px"><label>${_t('פרופיל MakerWorld')}</label><input class="inp ltr" id="omwprof" value="${esc(cur || '')}" placeholder="https://makerworld.com/en/@user_…"><div class="hint">${_t('צריך רק אם לא התחברת לחשבון Bambu: הקישור לפרופיל שלך ב-MakerWorld, כדי להציג את המודלים שפרסמת.')}</div></div>` : '');

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = tx(msg);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 3200);
}

function dialog(title, text, buttons) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}<div class="actions">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { d.remove(); resolve(buttons[+b.dataset.i].value); }
      else if (e.target === d) { d.remove(); resolve(null); }
    });
    document.body.appendChild(d);
  });
}

/* ================= parsing in the background ================= */
let workerURL = null;
const parses = new Set();
// parse a model in a Web Worker; `tag` lets a closed window cancel its own work
function parseAsync(name, buf, opts = {}, tag = '') {
  if (typeof Worker === 'undefined' || typeof __WORKER_SRC__ === 'undefined') return Promise.resolve().then(() => parseModel(name, buf, opts));
  if (!workerURL) workerURL = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(workerURL); } catch (e) { resolve(parseModel(name, buf, opts)); return; }
    const job = { w, tag, reject };
    parses.add(job);
    const done = () => { parses.delete(job); w.terminate(); };
    w.onmessage = (e) => { done(); if (e.data.ok) resolve(e.data.r); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { done(); reject(new Error(e.message || _t('העיבוד נכשל'))); };
    w.postMessage({ name, buf, opts }, [buf]);
  });
}
function cancelParses(tag) {
  for (const j of [...parses]) if (!tag || j.tag === tag) { parses.delete(j); j.w.terminate(); j.reject(new Error('cancelled')); }
}

/* ================= state ================= */
let lib = null;
const S = { q: '', view: 'ok', tag: null, folder: null, sort: 'recent', selected: new Set(), open: null, tab: 'details', viewPath: null, printForm: null, lastScan: 0, mw: null, mwProfile: '' };
const useOPFS = new URLSearchParams(location.search).has('opfs');

const M = {
  list: () => Object.values(lib.data.models),
  cur: (m) => m.versions.find((v) => v.path === m.current) || m.versions[m.versions.length - 1],
  rec: (path) => lib.data.files[path] || {},
  status(m) {
    if (!m.prints.length) return 'never';
    const real = m.prints.filter((p) => p.result !== 'cancel');
    if (!real.length) return 'cancel';
    const last = [...real].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''))[0];
    return last.result;
  },
  lastPrint: (m) => m.prints.reduce((a, p) => (p.date > a ? p.date : a), ''),
  mtime: (m) => Math.max(...m.versions.map((v) => M.rec(v.path).mtime || 0)),
  hasOk: (m) => m.prints.some((p) => p.result === 'ok'),
  hasFail: (m) => m.prints.some((p) => p.result === 'fail' || p.result === 'partial'),
  activity: (m) => Math.max(M.mtime(m), ...m.prints.map((p) => Date.parse(p.at || p.date || '') || 0)),
  touch(m) { m.updated = new Date().toISOString(); lib.save(); },
};

/* ================= boot ================= */
async function boot() {
  const root = $('#root');
  if (useOPFS) {
    const dir = await navigator.storage.getDirectory();
    return openLibrary(dir);
  }
  if (native) {
    const info = await native.getLibrary();
    if (info && info.path) {
      S.internalLib = !!info.internal;
      return openLibrary(new NativeDirHandle('', info.name));
    }
  }
  if (native) return welcomeApp(root);
  const supported = !!native || 'showDirectoryPicker' in window;
  const saved = !native && supported ? await kvGet('root') : null;
  root.innerHTML = _t`
  <section id="welcome"><div class="welcome-card">
    <div class="logo"><span class="logo-mark">${I.mark}</span>PrintLog</div>
    <h1>כל המודלים שלך, במקום אחד.</h1>
    <p>${native ? _t('כל ההדפסות שלך מ-Bambu, עם תצוגה בתלת-ממד, תגיות והערות. איך להתחיל?') : _t('בוחרים פעם אחת את תיקיית ה-STL וה-3MF. PrintLog סורק אותה, מציג כל מודל בתלת-ממד, ושומר תגיות, הערות, גרסאות ויומן הדפסות בתוך התיקייה עצמה.')}</p>
    <div class="welcome-actions">
      ${native ? _t`<div class="start-choices">
        <button class="choice" id="cloudonly"><span class="ci">${I.cloud}</span><b>הצג את ההדפסות שלי מ-Bambu</b><span>מתחברים לחשבון Bambu ורואים את כל ההיסטוריה בתלת-ממד. בלי לבחור תיקייה.</span></button>
        <button class="choice" id="pick"><span class="ci">${I.folder}</span><b>בחר תיקיית מודלים</b><span>יש לך תיקייה עם קבצי STL / 3MF? PrintLog יסרוק אותה ויחבר אליה את ההדפסות.</span></button>
      </div>` : supported ? (saved ? _t`<button class="btn primary" id="resume">${I.folder} המשך עם „${esc(saved.name)}”</button><button class="btn ghost" id="pick">בחר תיקייה אחרת</button>` : _t`<button class="btn primary" id="pick">${I.folder} בחר תיקיית מודלים</button>`) : ''}
    </div>
    ${supported ? '' : _t`<div class="notice">הדפדפן הזה לא תומך בגישה לתיקיות. פתח את הקובץ ב-<b>Google Chrome</b> או ב-<b>Microsoft Edge</b> (במק או בווינדוס).</div>`}
    <div class="feature-row">
      <div class="feature"><b>תצוגה בתלת-ממד</b>STL ו-3MF, כולל צבעי פילמנט ותמונת הפלטה של Bambu.</div>
      <div class="feature"><b>יומן הדפסות</b>הצליח / נכשל, עם ההגדרות שנשלפות מקובץ ה-3MF.</div>
      <div class="feature"><b>גרסאות ותגיות</b>מאחדים v1, v2, v3 למודל אחד, ומוצאים הכל בחיפוש.</div>
    </div>
  </div></section>`;
  const pick = async () => {
    if (native) {
      const info = await native.pickFolder();
      if (info) openLibrary(new NativeDirHandle('', info.name));
      return;
    }
    try {
      const dir = await window.showDirectoryPicker({ id: 'shelf-root', mode: 'readwrite' });
      await kvSet('root', dir);
      openLibrary(dir);
    } catch (e) { if (e.name !== 'AbortError') toast(_t('לא ניתן לפתוח את התיקייה: ') + e.message, true); }
  };
  $('#pick') && ($('#pick').onclick = pick);
  $('#cloudonly') && ($('#cloudonly').onclick = async () => {
    const info = await native.useCloud();
    S.internalLib = true;
    await openLibrary(new NativeDirHandle('', info.name));
    printerDialog();
  });
  $('#resume') && ($('#resume').onclick = async () => {
    try {
      const p = await saved.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') openLibrary(saved);
      else toast(_t('צריך לאשר גישה לתיקייה כדי להמשיך'), true);
    } catch (e) { pick(); }
  });
}

/* first run in the desktop app: signing in to Bambu is the main path, right on this screen;
   a folder of models (or no account at all) is the quieter second choice */
function welcomeApp(root) {
  const art = `<div class="w2-art" aria-hidden="true">
      <div class="w2-glow"></div>
      <div class="w2-printer">
        <div class="w2-gantry"><div class="w2-head"></div></div>
        <div class="w2-model">${Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
        <div class="w2-bed"></div>
      </div>
      <div class="w2-chip c1"><span class="sdot ok"></span>Benchy · ${_t('הצליחה')}</div>
      <div class="w2-chip c2">${_t('שכבה')} <b class="ltr">142/180</b></div>
      <div class="w2-chip c3"><span class="swatch" style="background:#ff6a13"></span>PLA · <span class="ltr">12 g</span></div>
    </div>`;
  const form = (step) => step === 'code' || step === 'tfa' ? _t`
      <label class="w2-lbl" for="wcode">${step === 'tfa' ? _t('קוד מאפליקציית האימות') : _t('קוד שנשלח למייל')}</label>
      <input class="inp ltr w2-inp" id="wcode" inputmode="numeric" autocomplete="one-time-code">
      <button class="btn primary w2-go" data-wverify>אמת והמשך</button>
      <button class="w2-link" data-wback>חזרה</button>` : _t`
      <label class="w2-lbl" for="wemail">מייל של חשבון Bambu</label>
      <input class="inp ltr w2-inp" id="wemail" autocomplete="username" placeholder="name@example.com">
      <label class="w2-lbl" for="wpass">סיסמה</label>
      <input class="inp ltr w2-inp" id="wpass" type="password" autocomplete="current-password">
      <div class="w2-row"><select class="inp w2-region" id="wregion" aria-label="אזור"><option value="global">bambulab.com</option><option value="china">bambulab.cn</option></select>
      <button class="w2-link" data-wcode>אין סיסמה? שלח לי קוד למייל</button></div>
      <button class="btn primary w2-go" data-wlogin>${I.cloud}התחבר ל-Bambu</button>`;
  let step = 'login', email = '';
  const draw = () => {
    root.innerHTML = _t`<section id="welcome" class="w2">
    ${art}
    <div class="w2-panel">
      <div class="logo"><span class="logo-mark">${I.mark}</span>PrintLog</div>
      <h1>כל הדפסה שלך, <em>במקום אחד.</em></h1>
      <p>מתחברים פעם אחת לחשבון Bambu, וכל היסטוריית ההדפסות מופיעה כאן: בתלת-ממד, עם תגיות, הערות והתראות בזמן אמת.</p>
      <div class="w2-form">${form(step)}<div class="w2-err" id="werr"></div></div>
      <div class="w2-note">הסיסמה לא נשמרת. ההתחברות נעשית ישירות מול Bambu.</div>
      <div class="w2-or"><span>או</span></div>
      <button class="btn w2-alt" id="pick">${I.folder}יש לי תיקיית מודלים (STL / 3MF)</button>
      <div class="w2-foot">${[['he', 'עברית'], ['en', 'English']].map(([k, l]) => `<button class="w2-lang ${getLang() === k ? 'on' : ''}" data-wlang="${k}">${l}</button>`).join('')}</div>
    </div>
  </section>`;
    if (email && $('#wemail')) $('#wemail').value = email;
    const f = $('#wcode') || $('#wemail');
    if (f) f.focus();
  };
  const err = (m) => { const e = $('#werr'); if (e) e.textContent = m ? tx(m) : ''; };
  const busy = (b, on, label) => { if (!b) return; b.disabled = on; if (label) b.innerHTML = label; };
  // signed in: show everything from the cloud, no folder needed (a folder can be chosen later in Settings)
  const leave = () => { root.onclick = null; root.onkeydown = null; };
  const done = async () => {
    leave();
    const info = await native.useCloud();
    S.internalLib = true;
    await openLibrary(new NativeDirHandle('', info.name));
    toast(_t('מחובר ל-Bambu. מייבא את היסטוריית ההדפסות…'));
  };
  const handle = async (r) => {
    if (r && r.ok) return done();
    if (r && r.need) { step = r.need; draw(); if (r.need === 'code') toast(_t('שלחנו קוד למייל שלך')); return; }
    err((r && r.error) || _t('ההתחברות נכשלה'));
  };
  root.onclick = async (e) => {
    const t = e.target;
    if (t.closest('#pick')) { const info = await native.pickFolder(); if (info) { leave(); openLibrary(new NativeDirHandle('', info.name)); } return; }
    const lg = t.closest('[data-wlang]');
    if (lg) { if (lg.dataset.wlang !== getLang()) { await native.sync.setConfig({ options: { lang: lg.dataset.wlang } }); location.reload(); } return; }
    if (t.closest('[data-wback]')) { step = 'login'; draw(); return; }
    const b = t.closest('[data-wlogin],[data-wcode],[data-wverify]');
    if (!b) return;
    err('');
    if (b.matches('[data-wverify]')) {
      const code = $('#wcode').value.trim();
      if (!code) { err(_t('צריך למלא את הקוד')); return; }
      busy(b, true, _t('מתחבר…'));
      const r = await native.sync.verify({ step, code });
      busy(b, false, _t('אמת והמשך'));
      return handle(r);
    }
    email = $('#wemail').value.trim();
    if (!email) { err(_t('צריך למלא מייל')); $('#wemail').focus(); return; }
    const codeOnly = b.matches('[data-wcode]');
    const pass = $('#wpass').value;
    if (!codeOnly && !pass) { err(_t('צריך למלא סיסמה, או לבקש קוד למייל')); $('#wpass').focus(); return; }
    const label = b.innerHTML;
    busy(b, true, codeOnly ? _t('שולח…') : _t('מתחבר…'));
    const r = await native.sync.login({ email, password: codeOnly ? '' : pass, region: $('#wregion').value, codeOnly });
    if ($('#welcome')) busy(b, false, label);
    handle(r);
  };
  root.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.closest('.w2-inp')) return;
    const b = $('[data-wverify]') || $('[data-wlogin]');
    if (b) b.click();
  };
  draw();
}

async function openLibrary(dir) {
  lib = new Library(dir);
  if (native) {
    try { const st = await native.sync.getState(); S.archiveDir = st.archiveDir || ''; if (st.archiveDir) lib.archive = new NativeDirHandle('@archive', _t('ארכיון')); } catch { }
    lib.models = new NativeDirHandle('@models', 'Bambu');
    try { S.gdrive = await native.gdrive.status(); } catch { S.gdrive = null; }
  }
  try { await lib.init(); } catch (e) { toast(_t('שגיאה בפתיחת הספרייה: ') + e.message, true); return; }
  lib.on((t, e) => { if (t === 'save-error') toast(_t('השמירה נכשלה: ') + (e && e.message), true); });
  // before the first import: these options change what it does
  let opts = {};
  if (native) { try { opts = (await native.sync.getState()).options || {}; S.autoModels = opts.autoModels !== false; S.autoMatch = opts.autoMatch !== false; S.autoUpdate = opts.autoUpdate !== false; S.mwProfile = opts.mwProfile || ''; } catch { } }
  // first screen: the user's choice in Settings, or the last one used
  const sv = opts.startView || 'last';
  if (sv === 'last' || sv === 'printer') { if (lib.data.prefs?.view && lib.data.prefs.view !== 'inbox') S.view = lib.data.prefs.view; }
  else S.view = sv;
  if (S.view === 'mine' && !(native && native.makerworld)) S.view = 'ok';
  renderShell();
  await rescan(true);
  if (sv === 'printer' && native && native.sync.printer && !S.bound) {
    const sn = Object.keys((S.sync && S.sync.printers) || {})[0];
    if (sn) printerScreen(sn);
  }
  if (S.bound) return;
  S.bound = true;
  window.addEventListener('focus', () => { if (Date.now() - S.lastScan > 8000) rescan(false); });
  setInterval(() => { if (!document.hidden) syncPrints(false); }, 20000);
  if (native) {
    native.onSync(() => syncPrints(false));
    if (native.sync.onModel) native.sync.onModel(onModelEvent);
    // updates: soon after opening, every hour, and when the window comes back after a while
    setTimeout(() => checkUpdate(false, true), 8000);
    setInterval(() => checkUpdate(false), 3600 * 1000);
    window.addEventListener('focus', () => { if (Date.now() - (S.lastUpdCheck || 0) > 30 * 60000) checkUpdate(false); });
  }
}

async function rescan(first) {
  if (S.scanning) return;
  S.scanning = true;
  setProgress(_t('סורק את התיקייה…'), null);
  try {
    const r = await lib.scan((n) => setProgress(_t`סורק… ${n} קבצים`, null));
    S.lastScan = Date.now();
    autoNames();
    renderAll();
    if (!first && (r.added || r.moved)) toast(`${r.added ? r.added + _t(' מודלים חדשים') : ''}${r.added && r.moved ? ' · ' : ''}${r.moved ? r.moved + _t(' קבצים שהוזזו זוהו') : ''}`);
    if (first && r.total === 0) toast(_t('לא נמצאו קבצי STL או 3MF בתיקייה הזו'));
  } catch (e) {
    toast(_t('הסריקה נכשלה: ') + e.message, true);
  }
  S.scanning = false;
  setProgress(null);
  queueThumbs();
  syncPrints(true);
}

async function syncPrints(force) {
  if (!lib) return;
  const { data, changed } = await readSyncFile(lib);
  S.sync = data;
  if (data && (changed || force)) {
    lib.autoMatch = S.autoMatch;
    const r = importPrints(lib, data);
    const hadInbox = (S.unmatched || []).length;
    S.unmatched = r.unmatched;
    if (r.added || r.updated) {
      lib.save();
      toast(r.added > 1 ? _t`נרשמו ${r.added} הדפסות מהמדפסת` : r.added ? _t('נרשמה הדפסה חדשה מהמדפסת') : _t('פרטי הדפסות עודכנו מהענן'));
    }
    if (r.added || r.updated || hadInbox !== r.unmatched.length) {
      renderSidebar();
      renderToolbar();
      if (!S.open) renderGrid(); else renderInfo();
    }
  }
  renderPrinterPill();
  schedulePrefetch();
}

const PSTATE = { running: _t('מדפיס'), prepare: _t('מתכונן'), pause: _t('מושהה'), finish: _t('סיים'), failed: _t('נכשל'), idle: _t('פנוי'), slicing: _t('פורס'), offline: _t('לא מחובר'), error: _t('שגיאת חיבור'), unknown: _t('לא ידוע'), connecting: _t('מתחבר…'), silent: _t('לא מגיבה (כבויה?)') };
function helperState() {
  const d = S.sync;
  if (!d) return { kind: 'none' };
  const h = d.helper || {};
  const written = Date.parse(h.written || '') || 0;
  const stopped = h.stopped && Date.parse(h.stopped) >= Date.parse(h.started || 0);
  if (h.needsLogin) return { kind: 'login', h };
  if (stopped || Date.now() - written > 20 * 60 * 1000) return { kind: 'stale', h };
  return { kind: 'ok', h };
}
function renderPrinterPill() {
  const el = $('#ppill');
  if (!el) return;
  const st = helperState();
  if (st.kind === 'none') { el.innerHTML = _t`${I.printer}<span>חבר מדפסת</span>`; el.className = 'btn ghost ppill'; return; }
  const printers = Object.values(S.sync.printers || {});
  let dot = 'idle', text = '';
  if (st.kind === 'login') { dot = 'bad'; text = _t('צריך להתחבר מחדש'); }
  else if (st.kind === 'stale') { dot = 'off'; text = _t('הסנכרון לא פועל'); }
  else if (printers.length) {
    const p = printers.find((x) => ['running', 'prepare', 'pause'].includes(x.state)) || printers[0];
    const live = Date.now() - (Date.parse(p.updated || '') || 0) < 10 * 60 * 1000;
    // no report yet: still connecting, or the printer is off / not answering
    const quiet = !p.state || p.state === 'unknown';
    const state = p.conn === 'error' ? 'error' : !live || p.conn === 'offline' ? 'offline' : quiet ? (Date.now() - (Date.parse(S.sync.helper?.started || '') || 0) < 90000 ? 'connecting' : 'silent') : p.state;
    dot = state === 'running' || state === 'prepare' ? 'run' : state === 'failed' || state === 'error' ? 'bad' : state === 'offline' || state === 'silent' ? 'off' : 'idle';
    text = `${p.name || _t('מדפסת')} · ${PSTATE[state] || state}${state === 'running' && p.progress != null ? ` ${p.progress}%` : ''}${['running', 'pause', 'prepare'].includes(state) && p.job ? ` · ${p.job}` : ''}`;
  } else { text = _t('מסונכרן'); }
  const perr = printers.map((x) => x.conn === 'error' && x.error).find(Boolean);
  el.title = tx(perr || '') || _t('חיבור למדפסת');
  el.className = 'btn ppill';
  el.innerHTML = `<span class="pdot ${dot}"></span><span>${esc(text)}</span>`;
}

function fmtAgo(iso) {
  const t = Date.parse(iso || '');
  if (!t) return '–';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return _t('עכשיו');
  if (m < 60) return _t`לפני ${m} דק׳`;
  if (m < 60 * 24) return _t`לפני ${Math.round(m / 60)} שע׳`;
  return fmtDate(iso);
}

/* ---------- printer screen (click the printer name in the header) ---------- */
async function printerScreen(serial) {
  const list = Object.entries((S.sync && S.sync.printers) || {}).map(([s, p]) => ({ serial: s, name: p.name || s }));
  if (!list.length) return printerDialog();
  let cur = serial || (list.find((p) => ['running', 'pause', 'prepare'].includes((S.sync.printers[p.serial] || {}).state)) || list[0]).serial;
  const d = document.createElement('div');
  d.className = 'dialog';
  d.innerHTML = _t`<div class="box printer-screen"><div class="ps-head"><h3 data-pname></h3><div class="pr-tabs"></div><button class="btn small ghost" data-psettings>${I.gear}הגדרות</button><button class="btn icon-btn ghost" data-close>${I.close}</button></div><div class="pr-cam" data-cam></div><div class="pr-body"><div class="spin"></div></div></div>`;
  document.body.appendChild(d);
  let timer = null;
  const close = () => { clearInterval(timer); d.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const cam = { serial: null, playing: false, kind: '' };
  const camEl = () => $('[data-cam]', d);
  const stopCam = () => {
    if (cam.serial) { native.sync.cameraStop(cam.serial); cam.serial = null; cam.playing = false; }
  };
  const renderCamIdle = (info) => {
    const el = camEl(); if (!el) return;
    const lan = info && info.conn === 'lan';
    el.className = 'pr-cam';
    el.innerHTML = lan
      ? _t`<button class="cam-start" data-camstart>${I.camera || I.printer}<span>הצג מצלמה</span></button>`
      : _t`<div class="cam-note">${I.camera || I.printer}<span>${info && info.conn === 'cloud' ? _t('המצלמה זמינה רק בחיבור רשת ביתית (LAN) למדפסת') : _t('המצלמה מוצגת כשהמדפסת מחוברת ברשת הביתית')}</span></div>`;
  };
  const startCam = async () => {
    const el = camEl(); if (!el) return;
    el.className = 'pr-cam live';
    el.innerHTML = _t`<div class="cam-stage"><div class="spin"></div><span class="cam-msg">מתחבר למצלמה…</span></div><button class="cam-x" data-camstop title="${_t('סגור מצלמה')}">${I.close}</button>`;
    const r = await native.sync.cameraStart(cur);
    if (!el.isConnected || cam.serialPending !== cur) return;
    if (!r.ok) { el.className = 'pr-cam'; el.innerHTML = _t`<div class="cam-note err">${tx(r.error) || _t('המצלמה לא זמינה')} <button class="btn small" data-camstart>${_t('נסה שוב')}</button></div>`; return; }
    cam.serial = cur; cam.playing = true; cam.kind = r.kind;
    const stage = $('.cam-stage', el);
    if (r.kind === 'webrtc') stage.innerHTML = `<iframe class="cam-frame" allow="autoplay" src="${esc(r.url)}"></iframe>`;
    else stage.innerHTML = `<img class="cam-img" alt="">`;
    const tip = $('.cam-tip', el); if (tip) tip.remove();
    el.insertAdjacentHTML('beforeend', _t`<div class="cam-tip">מסך שחור? ודא שהמצלמה דולקת, ושהמדפסת ב-LAN Only עם Developer Mode פעיל בהגדרות הרשת שלה.</div>`);
  };
  // one global route for X1 JPEG frames
  if (native.sync.onCameraFrame && !window.__camHook) {
    window.__camHook = (f) => {};
    native.sync.onCameraFrame((f) => window.__camHook(f));
  }
  window.__camHook = (f) => { if (cam.playing && cam.kind === 'mjpeg' && f.serial === cam.serial) { const img = $('.cam-img', d); if (img) img.src = f.dataUrl; } };

  const draw = async () => {
    const info = await native.sync.printer(cur).catch(() => null);
    if (!d.isConnected) return;
    if (!info) { $('.pr-body', d).innerHTML = _t('<div class="hint">אין נתונים מהמדפסת.</div>'); return; }
    $('[data-pname]', d).textContent = info.name;
    if (cam.renderedFor !== cur) { cam.renderedFor = cur; if (!cam.playing) renderCamIdle(info); }
    $('.pr-tabs', d).innerHTML = list.length > 1 ? list.map((p) => `<button class="btn small ${p.serial === cur ? 'on' : 'ghost'}" data-ptab="${esc(p.serial)}">${esc(p.name)}</button>`).join('') : '';
    const body = $('.pr-body', d);
    const top = body.scrollTop;
    body.innerHTML = printerScreenHTML(info, { esc, fmtDur, I, prints: (S.sync && S.sync.prints) || [] });
    body.scrollTop = top;
  };
  d.addEventListener('click', (e) => {
    const t = e.target;
    if (t === d || t.closest('[data-close]')) { stopCam(); close(); return; }
    if (t.closest('[data-camstart]')) { cam.serialPending = cur; startCam(); return; }
    if (t.closest('[data-camstop]')) { stopCam(); cam.renderedFor = null; draw(); return; }
    if (t.closest('[data-psettings]')) { stopCam(); close(); printerDialog(); return; }
    const tab = t.closest('[data-ptab]');
    if (tab) { stopCam(); cam.renderedFor = null; cur = tab.dataset.ptab; draw(); return; }
    const h = t.closest('[data-hms]');
    if (h) { e.preventDefault(); native.openUrl(`https://e.bambulab.com/index.php?e=${h.dataset.hms.replace(/_/g, '')}&s=device_hms&lang=en`); }
  });
  await draw();
  timer = setInterval(draw, 2000);
}

function printerDialog() {
  if (native) return nativeSettings();
  const st = helperState();
  const d = S.sync;
  const h = (d && d.helper) || {};
  const printers = d ? Object.values(d.printers || {}) : [];
  const count = d ? (d.prints || []).length : 0;
  const isWin = /Win/i.test(navigator.platform || navigator.userAgent);
  const cmds = (os) => os === 'win'
    ? ['', 'py "%USERPROFILE%\\Downloads\\shelf_sync.py" setup', 'py "%USERPROFILE%\\Downloads\\shelf_sync.py" autostart on']
    : ['', 'python3 ~/Downloads/shelf_sync.py setup', 'python3 ~/Downloads/shelf_sync.py autostart on'];
  const box = document.createElement('div');
  box.className = 'dialog';
  const steps = (os) => _t`
      <ol class="steps">
        <li>הורד את תוכנת הסנכרון: <button class="btn small primary" data-dlhelper>${I.download}shelf_sync.py</button></li>
        <li>פתח ${os === 'win' ? '<b>Command Prompt</b>' : '<b>Terminal</b>'} והרץ הגדרה ראשונית. היא תבקש את הנתיב של תיקיית המודלים, ואת דרך החיבור:${code(cmds(os)[1])}
          <div class="hint" style="margin:6px 0 0"><b>ענן Bambu</b> (מומלץ): מייל + קוד שנשלח למייל, מייבא את כל ההיסטוריה ומתעדכן. הסיסמה לא נשמרת.<br><b>רשת ביתית</b>: IP + Access Code מהמסך של המדפסת, בלי חשבון. רושם הדפסות כל עוד התוכנה רצה.<br><b>שניהם</b>: היסטוריה מהענן + האזנה ישירה למדפסת.</div></li>
        <li>הפעלה אוטומטית בכל כניסה למחשב:${code(cmds(os)[2])}</li>
      </ol>
      <div class="hint">צריך רק Python 3.8 ומעלה, בלי חבילות נוספות${os === 'win' ? _t(' (python.org, לסמן "Add to PATH")') : _t(' (במק: אם אין, הפקודה תציע להתקין)')}. ההדפסות מופיעות כאן אוטומטית, לפי שם הקובץ.</div>`;
  const code = (c) => `<div class="code"><code class="ltr">${esc(c)}</code><button class="btn small ghost" data-copy="${esc(c)}">${I.copy}</button></div>`;
  box.innerHTML = _t`<div class="box wide">
    <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">חיבור למדפסת</h3><button class="btn icon-btn ghost" data-close>${I.close}</button></div>
    ${d ? _t`<div class="pstatus">
      <div class="prow"><span class="pdot ${st.kind === 'ok' ? 'run' : st.kind === 'login' ? 'bad' : 'off'}"></span><b>${st.kind === 'ok' ? _t('הסנכרון פועל') : st.kind === 'login' ? _t('צריך להתחבר מחדש לחשבון Bambu') : _t('תוכנת הסנכרון לא פועלת כרגע')}</b></div>
      <dl class="kv">
        <dt>מצב</dt><dd>${{ cloud: _t('ענן Bambu'), lan: _t('רשת ביתית'), both: _t('ענן + רשת ביתית') }[h.mode] || '–'}</dd>
        <dt>מחשב</dt><dd>${esc(h.host || '–')}</dd>
        ${h.lastSync ? _t`<dt>סנכרון היסטוריה</dt><dd>${fmtAgo(h.lastSync)}</dd>` : ''}
        <dt>עדכון אחרון</dt><dd>${fmtAgo(h.written)}</dd>
        <dt>הדפסות שנקלטו</dt><dd>${count}${(S.unmatched || []).length ? _t` · <a href="#" data-goinbox>${S.unmatched.length} לא משויכות</a>` : ''}</dd>
        ${printers.map((p) => `<dt>${esc(p.name || _t('מדפסת'))}</dt><dd>${PSTATE[p.state] || p.state || '–'}${p.state === 'running' && p.progress != null ? ` ${p.progress}%` : ''}${p.job ? ` · ${esc(p.job)}` : ''} <span style="color:var(--ink3)">(${p.conn === 'lan' ? _t('רשת ביתית') : p.conn === 'cloud' ? _t('ענן') : esc(p.conn || '')})</span></dd>`).join('')}
      </dl>
      ${h.lastError ? `<div class="notice" style="margin-top:10px">${esc(h.lastError)}</div>` : ''}
      ${st.kind === 'login' ? _t`<div class="hint">הרץ שוב את ההגדרה כדי להתחבר:${code(cmds(isWin ? 'win' : 'mac')[1])}</div>` : ''}
      ${st.kind === 'stale' ? _t`<div class="hint">הפעל את התוכנה שוב (או את ההפעלה האוטומטית):${code(cmds(isWin ? 'win' : 'mac')[2])}</div>` : ''}
    </div>` : _t`<p>PrintLog יכול לרשום הדפסות לבד: לייבא את כל היסטוריית ההדפסות מחשבון Bambu, ולרשום כל הדפסה חדשה שמסתיימת או נכשלת. בשביל זה צריך תוכנת עזר קטנה שרצה ברקע במחשב, כי דף בדפדפן לא יכול להתחבר למדפסת או לענן בעצמו.</p>`}
    <details ${d ? '' : 'open'} class="setup"><summary>${d ? _t('הוראות התקנה') : _t('התקנה')}</summary>
      <div class="ostabs"><button class="btn small ${isWin ? '' : 'on'}" data-os="mac">Mac</button><button class="btn small ${isWin ? 'on' : ''}" data-os="win">Windows</button></div>
      <div id="steps">${steps(isWin ? 'win' : 'mac')}</div>
    </details>
  </div>`;
  box.addEventListener('click', (e) => {
    const t = e.target;
    if (t === box || t.closest('[data-close]')) { box.remove(); return; }
    if (t.closest('[data-dlhelper]')) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([helperSrc], { type: 'text/x-python' }));
      a.download = 'shelf_sync.py';
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return;
    }
    const c = t.closest('[data-copy]');
    if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => toast(_t('הועתק'))); return; }
    const os = t.closest('[data-os]');
    if (os) { $$('[data-os]', box).forEach((b) => b.classList.toggle('on', b === os)); $('#steps', box).innerHTML = steps(os.dataset.os); return; }
    if (t.closest('[data-goinbox]')) { e.preventDefault(); box.remove(); S.view = 'inbox'; S.tag = null; S.folder = null; renderAll(); }
  });
  document.body.appendChild(box);
}

/* ---------- desktop app: cloud archive ---------- */
// models that printed successfully but still have files in the working folder
const archiveOn = () => !!((S.gdrive && S.gdrive.connected) || S.archiveDir);
// strip Electron's "Error invoking remote method 'x': Error: " wrapper
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const hasLocal = (m) => m.versions.some((v) => !isArchived(v.path) && !v.path.startsWith('@models/') && !M.rec(v.path).missing);
function toArchive() { return M.list().filter((m) => M.hasOk(m) && hasLocal(m)); }
async function archiveModels(models) {
  const useDrive = S.gdrive && S.gdrive.connected;
  const files = models.flatMap((m) => m.versions.filter((v) => !isArchived(v.path) && !v.path.startsWith('@models/') && !M.rec(v.path).missing).map((v) => ({ m, v })));
  const size = files.reduce((a, { v }) => a + (M.rec(v.path).size || 0), 0);
  const where = useDrive ? _t`לתיקייה <b>PrintLog Archive</b> ב-Google Drive (${esc(S.gdrive.email || '')})` : _t`לתיקייה <span class="mono">${esc(S.archiveDir)}</span>`;
  const ok = await dialog(_t('להעביר לארכיון?'), _t`${files.length} קבצים (${fmtBytes(size)}) יועלו ${where} ויימחקו מהמחשב אחרי שההעלאה תיבדק.<br>ההיסטוריה, התגיות וההערות נשמרות, והכרטיסים ממשיכים להופיע עם ☁ ולהיפתח בתלת-ממד.`, [{ label: _t('העבר'), value: true, primary: true }, { label: _t('ביטול'), value: false }]);
  if (!ok) return;
  let done = 0, failed = 0, lastErr = '';
  for (const { m, v } of files) {
    setProgress(`${useDrive ? _t('מעלה ל-Google Drive') : _t('מעביר לארכיון')} ${done + failed + 1}/${files.length}`, (done + failed) / files.length);
    try {
      const old = v.path;
      let np, meta = {};
      if (useDrive) { const r = await native.gdrive.archive(old); np = r.path; meta = { size: r.size, mtime: r.mtime }; }
      else np = await native.archive.move(old);
      lib.data.files[np] = { ...(lib.data.files[old] || {}), ...meta, origPath: old, missing: false };
      delete lib.data.files[old];
      for (const p of m.prints) if (p.versionPath === old) p.versionPath = np;
      if (m.current === old) m.current = np;
      for (const k of [...lib.thumbURLs.keys()]) if (k === old || k.startsWith(old + '#')) lib.thumbURLs.delete(k);
      v.path = np;
      done++;
      lib.save();
    } catch (e) { failed++; lastErr = cleanErr(e); console.warn(e); if (/הרשאה|permission/i.test(lastErr)) break; }
  }
  if (useDrive) { try { S.gdrive = await native.gdrive.status(); } catch { } renderToolbar(); }
  setProgress(null);
  lib.save(true);
  if (failed && /הרשאה|permission/i.test(lastErr)) toast(lastErr, true); else
  toast(failed ? _t`${done} קבצים הועברו, ${failed} נכשלו: ${lastErr}` : _t`${done} קבצים הועברו לארכיון ופינו ${fmtBytes(size)}`, !!failed);
  if (S.open) closeModal();
  await rescan(false);
}
async function restoreModel(m) {
  const vs = m.versions.filter((v) => v.path.startsWith('@gdrive/'));
  let done = 0;
  for (const v of vs) {
    setProgress(_t`מוריד מ-Google Drive ${done + 1}/${vs.length}`, done / vs.length);
    try {
      const rec = lib.data.files[v.path] || {};
      const r = await native.gdrive.restore(v.path, rec.origPath || baseName(v.path));
      lib.data.files[r.path] = { ...rec, size: r.size, mtime: r.mtime, origPath: undefined };
      delete lib.data.files[v.path];
      for (const p of m.prints) if (p.versionPath === v.path) p.versionPath = r.path;
      if (m.current === v.path) m.current = r.path;
      v.path = r.path;
      done++;
    } catch (e) { toast(_t('ההחזרה נכשלה: ') + e.message, true); }
  }
  setProgress(null);
  lib.save(true);
  if (done) toast(_t`${done} קבצים הוחזרו לתיקייה`);
  if (S.open) closeModal();
  await rescan(false);
}

/* ---------- desktop app: updates ---------- */
async function installUpdate(r) {
  if (S.updating) return;
  S.updating = true;
  if (native.onUpdateProgress && !S.updHook) { S.updHook = 1; native.onUpdateProgress((p) => setProgress(_t`מוריד את גרסה ${r.latest}…`, p)); }
  setProgress(_t`מוריד את גרסה ${r.latest}…`, 0);
  const res = await native.installUpdate(r.installUrl);
  if (res.ok) { setProgress(_t('מתקין ומפעיל מחדש…'), 1); lib.save(true); return; }
  S.updating = false;
  setProgress(null);
  toast(_t('העדכון האוטומטי נכשל: ') + res.error + _t('. פותח את דף ההורדה.'), true);
  native.openUrl(r.url);
}
function markSettingsUpdate() {
  const b = $('#settings');
  if (!b) return;
  b.classList.toggle('has-update', !!S.updateAvail);
  b.title = S.updateAvail ? _t`הגדרות · גרסה ${S.updateAvail.latest} זמינה` : _t('הגדרות');
}
// atOpen: the check right after the app opens, the one moment an automatic update doesn't interrupt anything
async function checkUpdate(manual, atOpen) {
  if (!native || !native.checkUpdate) return;
  S.lastUpdCheck = Date.now();
  const r = await native.checkUpdate();
  // red ring on the settings button while a newer version is waiting
  S.updateAvail = r.update ? r : null;
  markSettingsUpdate();
  if (r.update) {
    if (atOpen && r.canInstall && S.autoUpdate !== false && !S.updating) { toast(_t`מתקין את גרסה ${r.latest}…`); installUpdate(r); return; }
    if (!manual && S.updateShown === r.latest) return;
    S.updateShown = r.latest;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = _t`גרסה חדשה זמינה: ${esc(r.latest)} (יש לך ${esc(r.current)}) <button class="btn small" style="margin-inline-start:8px;background:transparent;color:inherit">${r.canInstall ? _t('עדכן עכשיו') : _t('הורד')}</button><div style="font-size:12px;opacity:.75;margin-top:4px">${r.canInstall ? _t('האפליקציה תוריד את הגרסה, תיסגר ותיפתח מחדש. ') : ''}ההגדרות, החיבור ל-Bambu והספרייה נשמרים.</div>`;
    $('button', t).onclick = () => { t.remove(); if (r.canInstall) installUpdate(r); else native.openUrl(r.url); };
    t.onclick = (e) => { if (!e.target.closest('button')) t.remove(); };
    $('#toasts').appendChild(t); // stays until used: it was easy to miss
  } else if (manual) {
    toast(r.error === 'private' ? _t('עדיין לא פורסמו גרסאות ציבוריות') : r.error ? _t('בדיקת העדכונים נכשלה') : _t`יש לך את הגרסה האחרונה (${r.current})`, !!r.error && r.error !== 'private');
  }
}

/* ---------- desktop app: settings ---------- */
async function nativeSettings() {
  let st = await native.sync.getState();
  let gd = await native.gdrive.status().catch(() => null);
  let login = { step: 'form', msg: '' };
  let printers = (st.printers || []).map((p) => ({ ...p }));
  const box = document.createElement('div');
  box.className = 'dialog';
  const hs = helperState();
  const d = S.sync;
  const h = (d && d.helper) || {};
  const draw = () => {
    const usesCloud = st.mode === 'cloud' || st.mode === 'both';
    const usesLan = st.mode === 'lan' || st.mode === 'both';
    box.innerHTML = _t`<div class="box wide settings">
    <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">הגדרות וחיבור למדפסת</h3><button class="btn icon-btn ghost" data-close>${I.close}</button></div>
    ${d && st.mode !== 'off' ? _t`<div class="pstatus"><div class="prow"><span class="pdot ${hs.kind === 'ok' ? 'run' : hs.kind === 'login' ? 'bad' : 'off'}"></span><b>${hs.kind === 'ok' ? _t('הסנכרון פועל') : hs.kind === 'login' ? _t('צריך להתחבר מחדש לחשבון Bambu') : _t('הסנכרון לא פעיל')}</b><span style="margin-inline-start:auto;color:var(--ink3);font-size:12px">${h.lastSync ? _t('היסטוריה סונכרנה ') + fmtAgo(h.lastSync) : ''}</span></div>
      <dl class="kv"><dt>הדפסות שנקלטו</dt><dd>${(d.prints || []).length}${(S.unmatched || []).length ? _t` · <a href="#" data-goinbox>${S.unmatched.length} לא משויכות</a>` : ''}</dd>
      ${Object.values(d.printers || {}).map((p) => `<dt>${esc(p.name || _t('מדפסת'))}</dt><dd>${PSTATE[p.state] || p.state || '–'}${p.state === 'running' && p.progress != null ? ` ${p.progress}%` : ''}${p.job ? ` · ${esc(p.job)}` : ''} <span style="color:var(--ink3)">(${p.conn === 'lan' ? _t('רשת ביתית') : p.conn === 'cloud' ? _t('ענן') : esc(p.conn || '')})</span></dd>`).join('')}</dl>
      ${h.lastError ? `<div class="notice" style="margin-top:10px">${esc(h.lastError)}</div>` : ''}</div>` : ''}

    <div class="section-title">איך להתחבר למדפסת</div>
    <div class="seg modes">${[['cloud', _t('ענן Bambu')], ['lan', _t('רשת ביתית')], ['both', _t('שניהם')], ['off', _t('כבוי')]].map(([k, l]) => `<button data-mode="${k}" class="${st.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="hint">${{ cloud: _t('מייבא את כל היסטוריית ההדפסות מחשבון Bambu, ומתעדכן בזמן אמת דרך הענן. מומלץ.'), lan: _t('מתחבר ישירות למדפסת ברשת הביתית, בלי חשבון. רושם הדפסות כל עוד האפליקציה פועלת.'), both: _t('היסטוריה מהענן, ובנוסף חיבור ישיר למדפסת ברשת הביתית.'), off: _t('בלי חיבור. אפשר לרשום הדפסות ידנית.') }[st.mode]}</div>

    ${usesCloud ? _t`<div class="section-title">חשבון Bambu</div>
      ${st.cloud && st.cloud.loggedIn ? _t`<div class="acct"><span>מחובר בתור <b class="ltr">${esc(st.cloud.email)}</b></span><button class="btn small" data-syncnow>${I.refresh}סנכרן עכשיו</button><button class="btn small ghost danger" data-logout>התנתק</button></div>`
      : login.step === 'form' ? _t`<div class="form-grid">
          <div class="full"><label>מייל (או טלפון)</label><input class="inp ltr" id="lemail" value="${esc((st.cloud && st.cloud.email) || '')}" autocomplete="username"></div>
          <div class="full"><label>סיסמה (לא נשמרת)</label><input class="inp ltr" id="lpass" type="password" autocomplete="current-password"></div>
          <div><label>אזור</label><select class="inp" id="lregion"><option value="global">בינלאומי (bambulab.com)</option><option value="china" ${(st.cloud && st.cloud.region) === 'china' ? 'selected' : ''}>סין (bambulab.cn)</option></select></div>
          <div style="align-self:end"><button class="btn primary" data-login>התחבר</button></div>
          <div class="full hint" style="margin-top:2px">נרשמת ל-Bambu עם Google, Apple או Facebook ואין לך סיסמה? מלא רק מייל ו<button class="btn small" data-logincode>שלח לי קוד למייל</button></div></div>`
      : _t`<div class="form-grid"><div class="full"><label>${login.step === 'code' ? _t('קוד שנשלח למייל') : _t('קוד מאפליקציית האימות')}</label><input class="inp ltr" id="lcode" inputmode="numeric" autocomplete="one-time-code"></div>
          <div><button class="btn primary" data-verify>אמת</button> <button class="btn ghost" data-back>חזרה</button></div></div>`}
      ${login.msg ? `<div class="notice" style="margin-top:8px">${esc(login.msg)}</div>` : ''}` : ''}

    ${st.mode !== 'off' ? _t`<div class="section-title">מדפסות</div>
      ${printers.length ? printers.map((p, i) => _t`<div class="printer-row">
        <div class="pr-head">${I.printer}<b>${esc(p.name || p.serial)}</b><span class="mono" style="color:var(--ink3)">${esc(p.model || '')} · ${esc(p.serial)}</span>${native.sync.printer && S.sync && (S.sync.printers || {})[p.serial] ? _t`<button class="btn small" data-openps="${esc(p.serial)}" style="margin-inline-start:auto">מסך המדפסת</button>` : ''}<button class="btn small ghost danger" data-rmp="${i}" style="${native.sync.printer && S.sync && (S.sync.printers || {})[p.serial] ? '' : 'margin-inline-start:auto'}">הסר</button></div>
        ${usesLan ? `<div class="form-grid"><div><label>IP</label><input class="inp ltr" data-pf="ip" data-i="${i}" value="${esc(p.ip || '')}" placeholder="192.168.1.50"></div><div><label>Access Code</label><input class="inp ltr" data-pf="access_code" data-i="${i}" value="${esc(p.access_code || '')}"></div></div>` : ''}
      </div>`).join('') : `<div class="hint">${usesCloud ? _t('אחרי ההתחברות המדפסות מהחשבון יופיעו כאן.') : _t('עוד אין מדפסות.')}</div>`}
      ${usesLan ? _t`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-discover>${I.search}חפש מדפסות ברשת</button><button class="btn small ghost" data-addp>${I.plus}הוסף ידנית</button></div>
        <div class="hint">את ה-IP וה-Access Code מוצאים במסך המדפסת: הגדרות ← רשת (WLAN / LAN).</div>` : ''}` : ''}

    <div class="section-title">כללי</div>
    ${LANG_ROW()}
    ${START_ROW(st.options.startView || 'last') + MW_ROW(st.options.mwProfile)}
    <label class="chk"><input type="checkbox" id="oautoupd" ${st.options.autoUpdate !== false ? 'checked' : ''}> ${_t('לעדכן אוטומטית כשיש גרסה חדשה (בפתיחת האפליקציה)')}</label>
    <label class="chk"><input type="checkbox" id="onotify" ${st.options.notify ? 'checked' : ''}> התראה כשהדפסה מסתיימת או נכשלת</label>
    <div class="alert-opts">
      <label class="chk"><input type="checkbox" id="oapause" ${st.options.alertPause !== false ? 'checked' : ''}> התראה כשהדפסה נעצרת או יש תקלה (עם קוד התקלה)</label>
      <label class="chk"><input type="checkbox" id="oafirst" ${st.options.alertFirstLayer !== false ? 'checked' : ''}> התראה כשהשכבה הראשונה מסתיימת</label>
      <label class="chk"><input type="checkbox" id="oaten" ${st.options.alertTenMin !== false ? 'checked' : ''}> התראה 10 דקות לפני סוף ההדפסה</label>
      <label class="chk"><input type="checkbox" id="oaams" ${st.options.alertAms !== false ? 'checked' : ''}> התראה כשפילמנט ב-AMS עומד להיגמר או כשהלחות גבוהה</label>
    </div>
    ${!S.internalLib ? _t`<label class="chk"><input type="checkbox" id="oautomatch" ${st.options.autoMatch !== false ? 'checked' : ''}> לחפש בתיקייה קובץ שמתאים לכל הדפסה (לפי השם), ולהציג אותו במקום להוריד מ-Bambu</label>` : ''}
    ${usesLan ? _t`<label class="chk"><input type="checkbox" id="otimelapse" ${st.options.timelapse !== false ? 'checked' : ''}> לייבא טיימלפס מהמדפסת לכל הדפסה (רק כשהמדפסת זמינה ברשת הביתית)</label>
    <label class="chk" style="margin-inline-start:22px"><input type="checkbox" id="otldelete" ${st.options.timelapseDelete ? 'checked' : ''}> אחרי הייבוא, למחוק את הטיימלפס מהמדפסת כדי לפנות מקום</label>` : ''}
    ${usesCloud ? _t`<label class="chk"><input type="checkbox" id="oautomodels" ${st.options.autoModels !== false ? 'checked' : ''}> להוריד ברקע מ-Bambu את המודלים של ההדפסות, לתצוגה בתלת-ממד <span class="hint" data-msize style="display:inline"></span></label>` : ''}
    <label class="chk"><input type="checkbox" id="ologin" ${st.options.openAtLogin ? 'checked' : ''}> הפעל עם המחשב (ברקע)</label>
    <label class="chk"><input type="checkbox" id="otray" ${st.options.closeToTray ? 'checked' : ''}> כשסוגרים את החלון, להמשיך לרוץ ברקע. בלי זה, ההיסטוריה נמשכת מ-Bambu בכל פתיחה ובלחיצה על „רענן”.</label>
    <div class="section-title">ארכיון ב-Google Drive</div>
    ${!gd || !gd.available ? _t`<div class="hint">בגרסה הזו לא מוגדר מפתח Google, ולכן הארכיון לא זמין.</div>`
      : gd.connected ? _t`<div class="acct"><span>מחובר בתור <b class="ltr">${esc(gd.email || '')}</b> · הקבצים נשמרים בתיקייה <b>PrintLog Archive</b></span><button class="btn small" data-gdnow>☁ העלה עכשיו (${toArchive().length})</button><button class="btn small ghost danger" data-gdout>התנתק</button></div>`
      : _t`<div class="acct"><span>לא מחובר</span><button class="btn small primary" data-gdin>התחבר ל-Google Drive</button></div>`}
    <div class="hint">קבצים שהצליחו אפשר להעלות ל-Drive ולמחוק מהמחשב (בטאב „הדפסות שהצליחו”, או מתוך קובץ). הם ממשיכים להופיע עם ☁ ונפתחים כרגיל. בחלון של Google חשוב לסמן את התיבה של Google Drive. PrintLog רואה ב-Drive רק את הקבצים שהוא עצמו העלה, ולא נוגע בהגדרות של Google Drive במחשב.</div>
    ${st.archiveDir ? _t`<div class="acct" style="margin-top:6px"><span>תיקיית ארכיון מקומית: <b class="ltr mono">${esc(st.archiveDir)}</b></span><button class="btn small ghost" data-cleararchive>הסר</button></div>` : ''}
    <div class="acct" style="margin-top:10px">${st.libraryInternal ? _t`<span>תצוגת ענן בלבד, בלי תיקייה משלך</span><button class="btn small" data-changelib>בחר תיקיית מודלים</button>` : _t`<span>תיקיית המודלים: <b class="ltr mono">${esc(st.library || '')}</b></span><button class="btn small" data-changelib>החלף תיקייה</button>`}</div>
    <div class="actions" style="margin-top:16px"><button class="btn primary" data-save>שמור</button><button class="btn" data-close>סגור</button><span style="margin-inline-start:auto;color:var(--ink3);font-size:12px;align-self:center">גרסה ${esc(st.version || '')}</span>${S.updateAvail ? _t`<button class="btn small upd-btn" data-doupd>עדכן לגרסה ${esc(S.updateAvail.latest)}</button>` : _t`<button class="btn small ghost" data-checkupd>בדוק עדכונים</button>`}</div>
    ${native.wipe ? _t`<div class="hint" style="margin-top:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">רוצה להסיר את PrintLog לגמרי? <button class="btn small ghost danger" data-wipe>מחק את כל הנתונים של PrintLog</button></div>` : ''}
  </div>`;
    if (native.sync.modelsSize) native.sync.modelsSize().then((b) => { const e = $('[data-msize]', box); if (e && b) e.textContent = _t`(${fmtBytes(b)} שמורים)`; }).catch(() => {});
  };
  const collect = () => {
    for (const inp of $$('[data-pf]', box)) printers[+inp.dataset.i][inp.dataset.pf] = inp.value.trim();
  };
  const save = async (quiet) => {
    collect();
    st = await native.sync.setConfig({ mode: st.mode, printers, options: { notify: $('#onotify', box).checked, alertPause: $('#oapause', box).checked, alertFirstLayer: $('#oafirst', box).checked, alertTenMin: $('#oaten', box).checked, alertAms: $('#oaams', box).checked, openAtLogin: $('#ologin', box).checked, closeToTray: $('#otray', box).checked, ...($('#oautomodels', box) ? { autoModels: $('#oautomodels', box).checked } : {}), ...($('#oautomatch', box) ? { autoMatch: $('#oautomatch', box).checked } : {}), ...($('#otimelapse', box) ? { timelapse: $('#otimelapse', box).checked, timelapseDelete: $('#otldelete', box).checked } : {}), startView: $('#ostart', box).value, autoUpdate: $('#oautoupd', box).checked } });
    S.autoUpdate = $('#oautoupd', box).checked;
    if ($('#oautomodels', box)) { S.autoModels = $('#oautomodels', box).checked; schedulePrefetch(); }
    if ($('#oautomatch', box) && S.autoMatch !== $('#oautomatch', box).checked) { S.autoMatch = $('#oautomatch', box).checked; syncPrints(true); }
    printers = (st.printers || []).map((p) => ({ ...p }));
    // a new language: reload so every screen is drawn in it
    const lang = $('#olang', box) && $('#olang', box).value;
    if (lang && lang !== getLang()) { await native.sync.setConfig({ options: { lang } }); location.reload(); return; }
    if (!quiet) toast(_t('ההגדרות נשמרו'));
  };
  box.addEventListener('change', async (e) => {
    if (e.target.id !== 'omwprof') return;
    const v = e.target.value.trim();
    try { await native.sync.setConfig({ options: { mwProfile: v } }); } catch (err) { toast(_t('השמירה נכשלה: ') + (err && err.message), true); return; }
    st.options = { ...st.options, mwProfile: v };
    S.mwProfile = v;
    mwReset();
  });
  box.addEventListener('click', async (e) => {
    const t = e.target;
    if (t === box || t.closest('[data-close]')) { box.remove(); return; }
    const m = t.closest('[data-mode]');
    if (m) { collect(); st.mode = m.dataset.mode; draw(); return; }
    if (t.closest('[data-goinbox]')) { e.preventDefault(); box.remove(); S.view = 'inbox'; S.tag = null; S.folder = null; renderAll(); return; }
    if (t.closest('[data-login]') || t.closest('[data-logincode]')) {
      collect();
      const codeOnly = !!t.closest('[data-logincode]');
      const b = t.closest('[data-login],[data-logincode]'); b.disabled = true; b.textContent = codeOnly ? _t('שולח…') : _t('מתחבר…');
      const r = await native.sync.login({ email: $('#lemail', box).value.trim(), password: codeOnly ? '' : $('#lpass', box).value, region: $('#lregion', box).value, codeOnly });
      login = r.ok ? { step: 'form', msg: '' } : r.need ? { step: r.need, msg: r.need === 'code' ? _t('שלחנו קוד למייל שלך') : '' } : { step: 'form', msg: r.error || _t('ההתחברות נכשלה') };
      if (login.msg === _t('שלחנו קוד למייל שלך')) { toast(login.msg); login.msg = ''; }
      if (r.ok) { await save(true); st = await native.sync.getState(); printers = st.printers.map((p) => ({ ...p })); toast(_t('מחובר ל-Bambu. מייבא את היסטוריית ההדפסות…')); mwReset(); }
      draw();
      return;
    }
    if (t.closest('[data-verify]')) {
      const r = await native.sync.verify({ step: login.step, code: $('#lcode', box).value.trim() });
      if (r.ok) { login = { step: 'form', msg: '' }; await save(true); st = await native.sync.getState(); printers = st.printers.map((p) => ({ ...p })); toast(_t('מחובר ל-Bambu. מייבא את היסטוריית ההדפסות…')); mwReset(); }
      else login.msg = r.error || _t('הקוד לא התקבל');
      draw();
      return;
    }
    if (t.closest('[data-back]')) { login = { step: 'form', msg: '' }; draw(); return; }
    if (t.closest('[data-logout]')) { st = await native.sync.logout(); mwReset(); draw(); return; }
    if (t.closest('[data-syncnow]')) { native.sync.syncNow(); toast(_t('מסנכרן…')); return; }
    if (t.closest('[data-discover]')) {
      collect();
      const b = t.closest('[data-discover]'); b.disabled = true; b.textContent = _t('מחפש ברשת…');
      const found = await native.sync.discover();
      for (const f of found) {
        const ex = printers.find((p) => p.serial === f.serial);
        if (ex) ex.ip = f.ip; else printers.push({ serial: f.serial, name: f.name, model: f.model, ip: f.ip, access_code: '' });
      }
      toast(found.length ? _t`נמצאו ${found.length} מדפסות` : _t('לא נמצאה מדפסת ברשת. בדוק שהמחשב והמדפסת באותה רשת, או הכנס ידנית את ה-IP מהמסך של המדפסת (הגדרות → רשת).'), !found.length);
      draw();
      return;
    }
    if (t.closest('[data-addp]')) {
      collect();
      const serial = await askText(_t('הוספת מדפסת'), _t('מספר סידורי (במסך המדפסת: הגדרות ← Device)'));
      if (serial) printers.push({ serial: serial.trim(), name: serial.trim(), ip: '', access_code: '' });
      draw();
      return;
    }
    const ops = t.closest('[data-openps]');
    if (ops) { box.remove(); printerScreen(ops.dataset.openps); return; }
    const rm = t.closest('[data-rmp]');
    if (rm) { collect(); printers.splice(+rm.dataset.rmp, 1); draw(); return; }
    if (t.closest('[data-gdin]')) {
      const b = t.closest('[data-gdin]'); b.disabled = true; b.textContent = _t('ממתין לאישור בדפדפן…');
      const r = await native.gdrive.connect();
      if (r.ok) toast(_t('מחובר ל-Google Drive')); else toast(_t('ההתחברות ל-Google Drive נכשלה: ') + r.error, true);
      gd = S.gdrive = await native.gdrive.status();
      draw(); renderToolbar();
      return;
    }
    if (t.closest('[data-gdnow]')) {
      if (!toArchive().length) { toast(_t('אין קבצים להעלות: כל הקבצים של הדפסות שהצליחו כבר בארכיון')); return; }
      box.remove(); archiveModels(toArchive()); return;
    }
    if (t.closest('[data-gdout]')) { await native.gdrive.disconnect(); gd = S.gdrive = await native.gdrive.status(); draw(); renderToolbar(); return; }
    if (t.closest('[data-pickarchive]')) {
      const r = await native.archive.pick();
      if (r && r.error) toast(r.error, true);
      else if (r) { S.archiveDir = r.path; lib.archive = new NativeDirHandle('@archive', _t('ארכיון')); st = await native.sync.getState(); draw(); rescan(false); toast(_t('תיקיית הארכיון נשמרה')); }
      return;
    }
    if (t.closest('[data-cleararchive]')) { await native.archive.clear(); S.archiveDir = ''; lib.archive = null; st = await native.sync.getState(); draw(); rescan(false); return; }
    if (t.closest('[data-changelib]')) {
      const info = await native.pickFolder();
      if (info) location.reload();
      return;
    }
    if (t.closest('[data-checkupd]')) { await checkUpdate(true); draw(); return; }
    if (t.closest('[data-doupd]')) { const u = S.updateAvail; box.remove(); if (u.canInstall) installUpdate(u); else native.openUrl(u.url); return; }
    if (t.closest('[data-wipe]')) {
      const own = !st.libraryInternal && st.library;
      let withLib = false;
      const onChg = (ev) => { if (ev.target && ev.target.id === 'wipelib') withLib = ev.target.checked; };
      document.addEventListener('change', onChg);
      const r = await dialog(_t('למחוק את כל הנתונים של PrintLog?'), _t`יימחקו: החיבור ל-Bambu ול-Google Drive, המדפסות, ההעדפות והמטמון${st.libraryInternal ? _t(', וגם ההערות, התגיות והמודלים שהורדו (במצב תצוגת ענן הם שמורים אצל האפליקציה)') : ''}. האפליקציה תיסגר, ואחר כך אפשר למחוק אותה.<br><br>${own ? _t`<label class="chk"><input type="checkbox" id="wipelib"> גם למחוק את נתוני PrintLog מתיקיית המודלים (<span class="mono">.shelf</span>: הערות, תגיות, יומן הדפסות ומודלים שהורדו). קבצי ה-STL / 3MF עצמם לא יימחקו.</label><br>` : ''}הקבצים בתיקיית המודלים וב-Google Drive לא נמחקים.`, [{ label: _t('מחק הכול'), value: 'yes', primary: true }, { label: _t('ביטול'), value: false }]);
      document.removeEventListener('change', onChg);
      if (r !== 'yes') return;
      await native.wipe({ withLibraryData: withLib });
      return;
    }
    if (t.closest('[data-save]')) { await save(); box.remove(); }
  });
  draw();
  document.body.appendChild(box);
}

/* ---------- unmatched prints ("inbox") ---------- */
function renderInbox() {
  const list = [...(S.unmatched || [])].sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const g = $('#grid');
  if (!list.length) { g.innerHTML = _t`<div class="empty" style="grid-column:1/-1"><b>הכל משויך</b>כל ההדפסות מהמדפסת נרשמו על מודלים.</div>`; return; }
  g.innerHTML = _t`<div class="inbox" style="grid-column:1/-1">
    <div class="inbox-head"><div class="hint" style="margin:0;flex:1">ההדפסות האלה הגיעו מהמדפסת, אבל לא מצאתי מודל עם שם מתאים. אחרי ששייכים הדפסה למודל, השם נשמר והדפסות עתידיות באותו שם ישויכו אוטומטית.</div><button class="btn small ghost" data-ignoreall>התעלם מכולן</button></div>
    ${list.map((e) => _t`<div class="irow">
      ${e.cover ? `<img class="icover" src="${esc(e.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'icover'}))">` : '<div class="icover"></div>'}
      <div class="ii"><div class="it">${esc(e.title || e.design || _t('ללא שם'))}</div>
        <div class="isub">${[e.design && e.design !== e.title ? esc(e.design) : '', esc(e.printer || ''), fmtDate(e.start), e.minutes ? fmtDur(e.minutes * 60) : '', e.grams ? e.grams + ' g' : '', e.source === 'cloud' ? _t('מהענן') : _t('מהמדפסת')].filter(Boolean).join(' · ')}</div></div>
      <span class="pill ${e.result === 'ok' ? 'ok' : e.result === 'unknown' ? 'partial' : 'fail'}">${e.result === 'cancel' ? _t('בוטלה') : e.result === 'ok' ? _t('הצליחה') : e.result === 'unknown' ? _t('לא ידוע') : _t('נכשלה')}</span>
      <button class="btn small" data-assign="${esc(e.key)}">שייך למודל…</button>
      <button class="btn small ghost" data-ignore="${esc(e.key)}">התעלם</button>
    </div>`).join('')}</div>`;
}
async function onInboxClick(e) {
  const t = e.target;
  const D = lib.data;
  D.imported = D.imported || {};
  if (t.closest('[data-ignoreall]')) {
    const ok = await dialog(_t('להתעלם מכל ההדפסות הלא משויכות?'), _t('הן לא יופיעו כאן שוב. אפשר עדיין לרשום הדפסות ידנית.'), [{ label: _t('התעלם מכולן'), value: true, danger: true }, { label: _t('ביטול'), value: false }]);
    if (!ok) return;
    for (const x of S.unmatched) D.imported[x.key] = 'ignored';
    S.unmatched = [];
  }
  const ig = t.closest('[data-ignore]');
  if (ig) { D.imported[ig.dataset.ignore] = 'ignored'; S.unmatched = S.unmatched.filter((x) => x.key !== ig.dataset.ignore); }
  const as = t.closest('[data-assign]');
  if (as) {
    const entry = S.unmatched.find((x) => x.key === as.dataset.assign);
    const m = await pickModel(entry);
    if (!m) return;
    attach(lib, m, entry);
    const alias = entry.title || entry.design;
    if (alias) { m.aliases = m.aliases || []; if (!m.aliases.some((a) => norm(a) === norm(alias))) m.aliases.push(alias); }
    const r = importPrints(lib, S.sync);
    S.unmatched = r.unmatched;
    toast(_t`שויכה ל„${m.name}”${r.added ? _t` · ועוד ${r.added} הדפסות באותו שם` : ''}`);
  }
  if (t.closest('[data-ignoreall]') || ig || as) { lib.save(); renderAll(); }
}
function pickModel(entry) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = _t`<div class="box wide"><h3>לאיזה מודל שייכת „${esc(entry.title || entry.design || '')}”?</h3>
      <input class="inp" id="pmq" placeholder="חיפוש מודל" value="${esc((entry.title || '').replace(/[_-]+/g, ' ').replace(/\s*plate\s*\d+$/i, '').trim())}">
      <div class="pmlist" id="pml"></div>
      <div class="actions" style="margin-top:12px"><button class="btn" data-no>ביטול</button></div></div>`;
    const done = (v) => { d.remove(); resolve(v); };
    const draw = () => {
      const q = $('#pmq', d).value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const list = M.list().filter((m) => { const h = (m.name + ' ' + m.versions.map((v) => v.path).join(' ') + ' ' + (m.aliases || []).join(' ')).toLowerCase(); return q.every((w) => h.includes(w)); }).slice(0, 60);
      $('#pml', d).innerHTML = list.length ? list.map((m) => { const p = M.cur(m).path; const u = lib.thumbURLs.get(p); return `<button class="pmi" data-pick="${m.id}">${u ? `<img src="${u}" alt="">` : '<span class="pmt"></span>'}<span class="pmn">${esc(m.name)}</span><span class="pmp mono">${esc(p)}</span></button>`; }).join('') : _t('<div class="hint">לא נמצאו מודלים. נסה מילה אחרת.</div>');
    };
    d.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pick]');
      if (p) done(lib.data.models[p.dataset.pick]);
      else if (e.target.closest('[data-no]') || e.target === d) done(null);
    });
    document.body.appendChild(d);
    $('#pmq', d).addEventListener('input', draw);
    $('#pmq', d).addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    draw();
    if (!$('#pml .pmi', d)) { $('#pmq', d).value = ''; draw(); }
    $('#pmq', d).focus();
  });
}

function autoNames() {
  // names come from the file name (MakerWorld design titles are shared by many files)
  if ((lib.data.namesVer || 1) >= 2) return;
  for (const m of M.list()) if (m.nameAuto) m.name = prettyName(baseName(m.versions[0].path));
  lib.data.namesVer = 2;
  lib.save();
}

/* ================= thumbnails ================= */
const Q = { list: [], running: false, done: 0, total: 0 };
function queueThumbs() {
  const cur = [], rest = [];
  for (const m of M.list()) for (const v of m.versions) {
    if (!lib.needsThumb(v.path)) continue;
    (v.path === M.cur(m).path ? cur : rest).push(v.path);
  }
  const all = [...cur, ...rest].filter((p) => !Q.list.includes(p));
  if (!all.length) return;
  Q.list.push(...all);
  Q.total = Q.done + Q.list.length;
  runQueue();
}
async function runQueue() {
  if (Q.running) return;
  Q.running = true;
  while (Q.list.length) {
    const path = Q.list.shift();
    setProgress(_t('מכין תמונות'), Q.done / Q.total);
    await makeThumb(path);
    Q.done++;
    refreshThumb(path);
    await sleep(0);
  }
  Q.running = false;
  Q.done = Q.total = 0;
  setProgress(null);
  autoNames();
  renderSidebar();
  renderGrid();
}
async function makeThumb(path) {
  const rec = lib.data.files[path];
  if (!rec) return;
  const key = lib.thumbKey(path);
  try {
    const file = await lib.getFile(path);
    const buf = await file.arrayBuffer();
    const kind = fileKind(path);
    let wrote = false;
    if (kind !== 'stl') {
      const meta = read3MFMeta(buf);
      if (meta && !meta.error) {
        rec.meta = { title: meta.title || '', designer: meta.designer || '', description: meta.description || '', license: meta.license || '', print: meta.print || null, plates: meta.plates || [] };
        if (meta.thumbPng && meta.thumbPng.length > 200) {
          await lib.writeThumb(path, new Blob([meta.thumbPng], { type: 'image/png' }));
          wrote = true;
        }
        if ((meta.plates || []).length > 1) for (const [id, png] of Object.entries(meta.plateThumbs || {})) await lib.writePlateThumb(path, +id, new Blob([png], { type: 'image/png' }));
      }
    }
    if (!wrote) {
      if (file.size > 400e6) throw new Error(_t('קובץ גדול מדי לתמונה ממוזערת'));
      const parsed = await parseAsync(path, buf.slice(0), { budget: 6e5 }, 'thumb');
      const pl = parsed.meta.plates && parsed.meta.plates[0];
      const { blob, dims } = await renderThumbnail(pl ? parsed.parts.filter((p) => p.plate === pl.id) : parsed.parts);
      rec.dims = dims;
      rec.triangles = parsed.meta.triangles || parsed.parts.reduce((a, p) => a + p.positions.length / 9, 0);
      await lib.writeThumb(path, blob);
    }
    rec.metaKey = key;
    rec.tv = 3;
    rec.failed = null;
    rec.error = null;
    rec.stale = false;
  } catch (e) {
    console.warn('thumb failed', path, e);
    rec.failed = key;
    rec.error = String(e.message || e);
  }
  lib.save();
}
async function refreshThumb(path) {
  const url = await lib.thumbURL(path);
  for (const el of $$(`[data-thumb="${CSS.escape(path)}"]`)) {
    if (url) el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
    else el.innerHTML = placeholder(path);
  }
  for (const el of $$(`[data-pthumb^="${CSS.escape(path)}#"]`)) {
    if (el.dataset.pthumb.slice(0, el.dataset.pthumb.lastIndexOf('#')) !== path) continue;
    const u = await lib.plateThumbURL(path, +el.dataset.pthumb.split('#').pop());
    el.innerHTML = u ? `<img src="${u}" alt="" loading="lazy">` : placeholder(path);
  }
}
function placeholder(path) {
  const rec = M.rec(path);
  if (rec.missing) return _t`<div class="ph">${I.cube}<span>הקובץ חסר</span></div>`;
  if (rec.failed) return _t`<div class="ph" title="${esc(rec.error || '')}">${I.cube}<span>אין תצוגה</span></div>`;
  return `<div class="ph"><div class="spin"></div></div>`;
}

/* ================= shell ================= */
function renderShell() {
  $('#root').innerHTML = _t`
  <div id="app">
    <header class="top">
      <div class="logo"><span class="logo-mark">${I.mark}</span>PrintLog</div>
      <div class="search">${I.search}<input id="q" placeholder="חיפוש לפי שם, תגית, הערה, מעצב…" autocomplete="off"><kbd>/</kbd></div>
      <div class="spacer"></div>
      <button class="btn ghost ppill" id="ppill" title="חיבור למדפסת"></button>
      <span class="folder-chip" title="${S.internalLib ? _t('תצוגת ענן, בלי תיקייה') : esc(lib.root.name)}">${S.internalLib ? I.cloud + _t('ענן') : I.folder + esc(lib.root.name)}</span>
      <button class="btn icon-btn ghost" id="theme" title="מצב תצוגה">${I.theme}</button>
      <button class="btn" id="settings" title="הגדרות">${I.gear}<span>הגדרות</span></button>
      <button class="btn" id="rescan" title="סרוק מחדש">${I.refresh}<span>רענן</span></button>
      <label class="btn primary" title="הוסף קבצים לתיקייה">${I.plus}<span>הוסף קבצים</span><input type="file" id="addfiles" accept=".stl,.3mf" multiple hidden></label>
    </header>
    <aside class="side" id="side"></aside>
    <main id="main">
      <div class="toolbar" id="toolbar"></div>
      <div class="grid" id="grid"></div>
    </main>
  </div>
  <div id="bulk"></div>
  <div id="modal"></div>`;

  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderGrid(); renderToolbar(); });
  $('#rescan').onclick = async () => {
    await rescan(false);
    if (native) {
      const st = await native.sync.getState();
      if (st.cloud?.loggedIn && (st.mode === 'cloud' || st.mode === 'both')) {
        setProgress(_t('מושך היסטוריית הדפסות מ-Bambu…'), null);
        const r = await native.sync.syncNow();
        setProgress(null);
        await syncPrints(true);
        if (r && r.ok === false && !r.skipped) toast(_t('המשיכה מ-Bambu נכשלה: ') + (r.error || ''), true);
        else if (r && r.ok && !r.added) toast(_t('אין הדפסות חדשות ב-Bambu'));
      }
    }
  };
  $('#theme').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('shelf-theme', next); } catch { }
  };
  $('#addfiles').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };

  $('#ppill').onclick = () => (native && native.sync.printer && S.sync && Object.keys(S.sync.printers || {}).length ? printerScreen() : printerDialog());
  $('#settings').onclick = () => printerDialog();
  markSettingsUpdate();
  if (native && native.onOpenSettings) native.onOpenSettings(() => printerDialog());
  if (!document.__settingsKey) { document.__settingsKey = 1; document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === ',' && !(native && navigator.platform.startsWith('Mac'))) { e.preventDefault(); printerDialog(); } }); }
  $('#side').addEventListener('click', (e) => {
    if (e.target.closest('[data-printer]')) { printerDialog(); return; }
    const ps = e.target.closest('[data-pscreen]');
    if (ps) { printerScreen(ps.dataset.pscreen); return; }
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const [kind, val] = [b.dataset.nav, b.dataset.val];
    if (kind === 'view') { S.view = val; S.tag = null; S.folder = null; lib.data.prefs = { ...(lib.data.prefs || {}), view: val }; lib.save(); }
    if (kind === 'tag') { S.tag = S.tag === val ? null : val; }
    if (kind === 'folder') { S.folder = S.folder === val ? null : val; }
    if (kind === 'src') { S.src = S.src === val ? null : val; if (S.src && ['ok', 'fail', 'history', 'inbox', 'mine'].includes(S.view)) S.view = 'all'; }
    renderAll();
  });
  $('#grid').addEventListener('click', onGridClick);
  $('#toolbar').addEventListener('change', (e) => {
    if (e.target.id === 'sort') { S.sort = e.target.value; renderGrid(); }
    if (e.target.id === 'splitp') { lib.data.prefs = { ...(lib.data.prefs || {}), splitPlates: e.target.checked }; lib.save(); renderGrid(); }
  });
  $('#toolbar').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { if (S.tag || S.folder != null) S.view = 'all'; S.tag = null; S.folder = null; S.src = null; S.q = ''; $('#q').value = ''; renderAll(); }
    if (e.target.closest('[data-archiveall]')) archiveModels(toArchive());
    if (e.target.closest('[data-mwrefresh]')) loadMine(true);
    const mp = e.target.closest('[data-mwurl]');
    if (mp) native.openUrl(mp.dataset.mwurl);
  });

  // drag & drop import
  let dragDepth = 0;
  const dz = document.createElement('div');
  dz.className = 'dropzone hidden';
  dz.textContent = _t('שחרר כדי להוסיף לתיקייה');
  document.body.appendChild(dz);
  window.addEventListener('dragenter', (e) => { if (S.open || !hasFiles(e)) return; dragDepth++; dz.classList.remove('hidden'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dz.classList.add('hidden'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dz.classList.add('hidden');
    if (S.open) return;
    importFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    if (e.key === 'Escape') { if (S.open) closeModal(); else if (S.selected.size) { S.selected.clear(); renderGrid(); renderBulk(); } }
    if (S.open && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) stepModel(e.key === (getLang() === 'en' ? 'ArrowRight' : 'ArrowLeft') ? 1 : -1);
  });
}
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

async function importFiles(files) {
  files = files.filter((f) => fileKind(f.name));
  if (!files.length) { toast(_t('אפשר להוסיף רק קבצי STL או 3MF'), true); return; }
  const dir = S.folder || '';
  for (const f of files) {
    try { await lib.importFile(f, dir); } catch (e) { toast(_t`ההעתקה של ${f.name} נכשלה: ${e.message}`, true); }
  }
  toast(_t`${files.length} קבצים נוספו${dir ? _t(' לתיקייה ') + dir : ''}`);
  await rescan(false);
}

function renderAll() { renderSidebar(); renderToolbar(); renderGrid(); renderBulk(); }

function setProgress(label, frac) {
  S.progress = label ? { label, frac } : null;
  const el = $('#prog');
  if (!el) return;
  if (!label) { el.innerHTML = ''; return; }
  el.innerHTML = `<span>${esc(label)}</span>${frac != null ? `<span class="bar"><i style="width:${Math.round(frac * 100)}%"></i></span>` : '<span class="spin" style="width:12px;height:12px"></span>'}`;
}

/* ================= sidebar ================= */
function renderSidebar() {
  const models = M.list();
  const tags = new Map(), folders = new Map();
  for (const m of models) {
    for (const t of m.tags) tags.set(t, (tags.get(t) || 0) + 1);
    const d = dirName(M.cur(m).path) || '';
    folders.set(d, (folders.get(d) || 0) + 1);
  }
  const items = printItems();
  const runs = items.reduce((a, it) => a + it.runs.length, 0);
  const okRuns = items.reduce((a, it) => a + it.n.ok, 0);
  const cnt = (fn) => models.filter(fn).length;
  const pv = [
    ['ok', _t('הדפסות שהצליחו'), '<span class="dot sdot ok"></span>', items.filter((it) => it.n.ok).length],
    ['fail', _t('הדפסות שנכשלו'), '<span class="dot sdot fail"></span>', items.filter((it) => it.n.fail + it.n.cancel).length],
    ['history', _t('כל ההדפסות'), I.printer, runs],
  ];
  const fv = [
    ['all', _t('כל הקבצים'), I.all, models.length],
    ['fav', _t('מועדפים'), I.starO, cnt((m) => m.favorite)],
    ['never', _t('עוד לא הודפסו'), '<span class="dot sdot never"></span>', cnt((m) => M.status(m) === 'never')],
    ['versions', _t('עם כמה גרסאות'), I.merge, cnt((m) => m.versions.length > 1)],
  ];
  const nav = ([k, l, ic, c]) => `<button class="nav-item ${S.view === k && !S.tag && S.folder == null ? 'active' : ''}" data-nav="view" data-val="${k}">${ic}<span class="lbl">${l}</span><span class="count">${c}</span></button>`;
  const folderList = [...folders.entries()].filter(([d]) => !d.startsWith("@gdrive")).sort((a, b) => a[0].localeCompare(b[0], loc()));
  const fname = (d) => (d === '@models' ? _t('הורדו מ-Bambu') : d === '@archive' ? _t('☁ ארכיון') : d.startsWith('@archive/') ? '☁ ' + d.slice(9) : d || _t('תיקייה ראשית'));
  $('#side').innerHTML = _t`
    <div class="stats">
      <div class="stat"><b>${runs}</b><span>הדפסות</span></div>
      <div class="stat"><b>${runs ? Math.round((okRuns / runs) * 100) + '%' : '–'}</b><span>הצליחו</span></div>
    </div>
    <h4>הדפסות</h4>
    ${pv.map(nav).join('')}
    ${native && native.sync.printer ? Object.entries((S.sync && S.sync.printers) || {}).map(([sn, p]) => _t`<button class="nav-item" data-pscreen="${esc(sn)}" title="מסך המדפסת: טמפרטורות, AMS, תקלות וסטטיסטיקה">${I.printer}<span class="lbl">${esc(p.name || sn)}</span><span class="count"><span class="pdot ${['running', 'prepare'].includes(p.state) ? 'run' : p.conn === 'offline' || p.conn === 'error' ? 'off' : 'idle'}"></span></span></button>`).join('') : ''}
    <button class="nav-item" data-printer style="margin-top:2px">${I.gear}<span class="lbl">הגדרות וחיבור למדפסת</span><span class="count">${S.sync ? '<span class="pdot ' + (helperState().kind === 'ok' ? 'run' : 'off') + '"></span>' : ''}</span></button>
    <h4>${S.internalLib ? _t('קבצים') : _t('תיקייה')}</h4>
    ${fv.map(nav).join('')}
    ${srcNav(models)}
    ${!S.internalLib && folderList.filter(([d]) => !d.startsWith('@')).length > 1 ? folderList.filter(([d]) => !d.startsWith('@')).map(([d, c]) => `<button class="nav-item sub ${S.folder === d ? 'active' : ''}" data-nav="folder" data-val="${esc(d)}">${I.folder}<span class="lbl">${esc(fname(d))}</span><span class="count">${c}</span></button>`).join('') : ''}
    ${mineNav(nav) + (tags.size ? _t`<h4>תגיות</h4>${[...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], loc())).map(([t, c]) => `<button class="nav-item ${S.tag === t ? 'active' : ''}" data-nav="tag" data-val="${esc(t)}"><span class="dot" style="background:hsl(${hueFor(t)} 65% 52%)"></span><span class="lbl">${esc(t)}</span><span class="count">${c}</span></button>`).join('')}` : '')}
  `;
}

/* ================= print items (from Bambu, independent of local files) ================= */
// one item = one thing that was printed (name + plate), with every run of it
function printItems() {
  const D = lib.data;
  const imp = D.imported || {};
  const items = new Map();
  const runKeys = new Set();
  const get = (key, init) => { let it = items.get(key); if (!it) { it = { key, runs: [], n: { ok: 0, fail: 0, cancel: 0, partial: 0 }, ...init }; items.set(key, it); } return it; };
  const add = (it, run) => { it.runs.push(run); it.n[run.result] = (it.n[run.result] || 0) + 1; };
  for (const e of (S.sync && S.sync.prints) || []) {
    if (!e || !e.key || e.result === 'running') continue;
    const mid = imp[e.key] && imp[e.key] !== 'ignored' ? imp[e.key] : null;
    const m = mid && D.models[mid];
    const mp = m && m.prints.find((p) => p.key === e.key || (e.aliasKeys || []).includes(p.key));
    if (mp) runKeys.add(mp.id);
    const plate = (mp && +mp.plateNo) || e.plate || 0;
    const generic = isGeneric(e.title);
    // show Bambu's name for the print (the project title, or the MakerWorld design when the title is just a profile)
    const name = (!generic && e.title) || e.design || (m && m.name) || e.title;
    const key = (m ? 'm:' + m.id : 't:' + norm(name) + '|' + norm(e.design)) + '#' + plate;
    // second line: the design when the name is the project title, or the profile name when the name is the design
    const sub = name === e.design ? (e.title && e.title !== e.design ? e.title : '') : e.design && norm(e.design) !== norm(name) ? e.design : '';
    const it = get(key, { model: m || null, plate, name, design: sub });
    add(it, {
      result: mp ? mp.result : entryResult(e) === 'unknown' ? 'partial' : entryResult(e),
      t: Date.parse(e.start || '') || 0, minutes: e.minutes, grams: e.grams, filaments: e.filaments || [], printer: e.printer,
      coverFile: e.coverFile || '', cover: e.cover || '', title: e.title, source: e.source, entry: e, notes: mp ? mp.notes : '',
    });
  }
  // prints logged by hand (not from Bambu)
  for (const m of Object.values(D.models)) for (const p of m.prints) {
    if (p.key || runKeys.has(p.id)) continue;
    const plate = +p.plateNo || 0;
    const it = get('m:' + m.id + '#' + plate, { model: m, plate, name: m.name, design: '' });
    add(it, { result: p.result, t: Date.parse(p.at || '') || Date.parse(p.date || '') || 0, minutes: p.minutes, grams: p.grams, filaments: p.material ? [{ type: p.material, color: p.color }] : [], printer: p.printer || '', coverFile: '', title: m.name, source: 'manual', notes: p.notes });
  }
  const platesPerBase = new Map();
  for (const it of items.values()) { const b = it.key.slice(0, it.key.lastIndexOf('#')); platesPerBase.set(b, (platesPerBase.get(b) || 0) + 1); }
  for (const it of items.values()) {
    it.multiPlate = it.plate > 1 || platesPerBase.get(it.key.slice(0, it.key.lastIndexOf('#'))) > 1 || (it.model && platesOf(it.model).length > 1);
    it.runs.sort((a, b) => b.t - a.t);
    it.last = it.runs[0];
    it.lastOk = it.runs.find((r) => r.result === 'ok');
    it.lastFail = it.runs.find((r) => r.result === 'fail' || r.result === 'cancel' || r.result === 'partial');
    it.cover = (it.runs.find((r) => r.coverFile) || {}).coverFile || '';
    it.timelapse = ((it.runs.find((r) => r.entry && r.entry.timelapse) || {}).entry || {}).timelapse || '';
  }
  return [...items.values()];
}

const coverCache = new Map();
async function coverURL(file) {
  if (!file) return null;
  if (coverCache.has(file)) return coverCache.get(file);
  try {
    const dir = await lib.meta.getDirectoryHandle('covers');
    const f = await (await dir.getFileHandle(file.replace(/^covers\//, ''))).getFile();
    const url = URL.createObjectURL(await toBlob(f, /\.webp$/.test(file) ? 'image/webp' : /\.jpg$/.test(file) ? 'image/jpeg' : 'image/png'));
    coverCache.set(file, url);
    return url;
  } catch { coverCache.set(file, null); return null; }
}

// timelapse from the printer: mp4 plays here, anything else (P1 .avi) opens in the system player
async function playTimelapse(rel) {
  if (!/\.mp4$/i.test(rel)) { if (native && native.sync.openTimelapse) native.sync.openTimelapse(rel); return; }
  let url = null;
  try {
    const dir = await lib.meta.getDirectoryHandle('timelapse');
    url = URL.createObjectURL(await (await dir.getFileHandle(rel.replace(/^timelapse\//, ''))).getFile());
  } catch { }
  if (!url) { toast(_t('הטיימלפס לא נמצא במחשב')); return; }
  const d = document.createElement('div');
  d.className = 'dialog';
  d.innerHTML = _t`<div class="box wide"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><h3 style="margin:0;flex:1">טיימלפס</h3><button class="btn icon-btn ghost" data-close>${I.close}</button></div><video src="${url}" controls autoplay style="width:100%;max-height:70vh;border-radius:10px;background:#000"></video></div>`;
  const close = () => { d.remove(); URL.revokeObjectURL(url); };
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(d);
}

// where a model's current file lives: the connected folder, downloaded from Bambu Cloud, or Drive / the archive
const SRC = { local: [_t('במחשב'), 'folder'], bambu: [_t('מ-Bambu Cloud'), 'bambuDl'], drive: [_t('ב-Drive / ארכיון'), 'driveOk'] };
function srcOf(m) {
  const p = M.cur(m).path;
  return p.startsWith('@models/') ? 'bambu' : isArchived(p) ? 'drive' : 'local';
}
function srcNav(models) {
  const n = { local: 0, bambu: 0, drive: 0 };
  for (const m of models) n[srcOf(m)]++;
  if (S.internalLib) n.local = 0; // no folder connected: nothing "on this computer" to show
  const keys = Object.keys(n).filter((k) => n[k]);
  if (!keys.length) return '';
  return keys.map((k) => `<button class="nav-item sub ${S.src === k ? 'active' : ''}" data-nav="src" data-val="${k}">${I[SRC[k][1]]}<span class="lbl">${SRC[k][0]}</span><span class="count">${n[k]}</span></button>`).join('');
}

// badge on a card: green = downloaded from Bambu Cloud, blue = in Google Drive / the archive,
// grey = only on this computer (click to upload; shown only when Drive or an archive folder is set up)
function cloudBtn(m) {
  if (!native || !m) return '';
  const p = M.cur(m).path;
  if (/^@(gdrive|archive)\//.test(p)) return `<button class="cloudbtn on" data-cloud="${m.id}" title="${p.startsWith('@gdrive/') ? _t('ב-Google Drive. לחיצה: החזר לתיקייה') : _t('בארכיון')}">${I.driveOk}</button>`;
  if (p.startsWith('@models/')) return _t`<span class="cloudbtn bambu" title="הורד מ-Bambu Cloud ונשמר במחשב">${I.bambuDl}</span>`;
  if (!hasLocal(m) || !archiveOn()) return '';
  return _t`<button class="cloudbtn" data-cloud="${m.id}" title="רק במחשב. לחיצה: העלה ל-Google Drive">${I.driveUp}</button>`;
}
async function onCloudBtn(id) {
  const m = lib.data.models[id];
  if (!m) return;
  const p = M.cur(m).path;
  if (p.startsWith('@gdrive/')) {
    const ok = await dialog(_t('להחזיר את הקובץ לתיקייה?'), _t`„${esc(m.name)}” יורד מ-Google Drive לתיקיית המודלים וימחק מ-Drive.`, [{ label: _t('החזר'), value: true, primary: true }, { label: _t('ביטול'), value: false }]);
    if (ok) await restoreModel(m);
    return;
  }
  if (p.startsWith('@archive/')) return;
  if (!archiveOn()) { toast(_t('כדי להעלות לענן, התחבר ל-Google Drive בהגדרות')); printerDialog(); return; }
  await archiveModels([m]);
}
/* ---------- background model downloads (run in the app's main process, not in the window) ---------- */
S.dl = new Map(); // print key -> { state: queued | dl | done | error, p }
S.dlDone = new Set();
function dlKey(it) {
  if (!native || !native.sync.prefetch) return '';
  const e = it.runs.map((r) => r.entry).find((x) => x && /^cloud-/.test(x.key || ''));
  return e ? e.key : '';
}
function dlState(it, k) {
  const s = S.dl.get(k);
  if (s) return s;
  const e = it.runs.map((r) => r.entry).find((x) => x && x.key === k);
  if (e && e.modelTries >= 2) return { state: 'error', error: e.modelError };
  return { state: S.autoModels === false ? 'off' : 'queued' };
}
const dlClass = (s) => ({ queued: 'pending', off: 'pending', dl: 'dl', error: 'nofile', done: 'dl' }[s.state] || '');
const dlLabel = (s) => (s.state === 'dl' || s.state === 'done' ? (s.p != null ? _t`מוריד ${Math.round((s.p || 0) * 100)}%` : _t('מוריד…')) : s.state === 'error' ? _t('אין קובץ ב-Bambu') : s.state === 'off' ? _t('לחץ להורדה') : _t('ממתין להורדה'));
function applyDl(el, s) {
  el.classList.remove('pending', 'dl', 'nofile');
  const c = dlClass(s); if (c) el.classList.add(c);
  el.style.setProperty('--p', s.p == null ? 0 : s.p);
  el.classList.toggle('indet', s.state === 'dl' && s.p == null);
  const m = el.querySelector('.dlmsg'); if (m) m.textContent = dlLabel(s);
}
let prefetchTimer = null;
function schedulePrefetch() { clearTimeout(prefetchTimer); prefetchTimer = setTimeout(prefetchModels, 1500); }
async function prefetchModels() {
  if (!native || !native.sync.prefetch || !S.sync || S.autoModels === false) return;
  // newest prints first: the cards at the top fill in first
  const list = printItems().filter((it) => !it.model).sort((a, b) => (b.last.t || 0) - (a.last.t || 0));
  const keys = [];
  for (const it of list) {
    const k = dlKey(it);
    if (!k) continue;
    const s = dlState(it, k);
    if (s.state === 'error' || s.state === 'done') continue;
    keys.push(k);
  }
  if (keys.length) await native.sync.prefetch(keys);
}
function onModelEvent(ev) {
  const prev = S.dl.get(ev.key);
  S.dl.set(ev.key, { ...(prev || {}), ...ev });
  for (const el of document.querySelectorAll(`.card[data-dlkey="${CSS.escape(ev.key)}"]`)) applyDl(el, S.dl.get(ev.key));
  if (ev.state === 'done') { S.dlDone.add(ev.key); clearTimeout(S.dlT); S.dlT = setTimeout(attachDownloads, 1500); }
}
// a finished download becomes a normal model: scan it in and attach its prints
async function attachDownloads() {
  if (S.scanning) { S.dlT = setTimeout(attachDownloads, 2000); return; }
  const keys = new Set(S.dlDone); S.dlDone.clear();
  await rescan(false);
  lib.data.imported = lib.data.imported || {};
  let n = 0;
  for (const it of printItems()) {
    if (it.model) continue;
    const k = dlKey(it);
    if (!keys.has(k)) continue;
    const p = (S.dl.get(k) || {}).path;
    const m = p && M.list().find((x) => x.versions.some((v) => v.path === p));
    if (!m) continue;
    for (const run of it.runs) if (run.entry && !lib.data.imported[run.entry.key]) attach(lib, m, run.entry);
    n++;
  }
  if (!n) return;
  const r = importPrints(lib, S.sync);
  S.unmatched = r.unmatched;
  lib.save();
  renderSidebar(); renderToolbar();
  if (!S.open) renderGrid(); else renderInfo();
}

function itemFileBadge(it) {
  if (!it.model) return _t('<span class="badge" title="אין קובץ מתאים בתיקייה">אין קובץ</span>');
  const p = M.cur(it.model).path;
  if (p.startsWith('@models/')) return _t('<span class="badge" title="המודל הורד מ-Bambu ונשמר אצלך">⬇ Bambu</span>');
  return isArchived(p) ? _t('<span class="badge" title="הקובץ בארכיון בענן">☁ ארכיון</span>') : _t('<span class="badge" title="הקובץ בתיקייה">📁</span>');
}

function itemCardHTML(it, kind) {
  const run = kind === 'ok' ? it.lastOk : kind === 'fail' ? it.lastFail : it.last;
  const count = kind === 'ok' ? it.n.ok : kind === 'fail' ? it.n.fail + it.n.cancel + it.n.partial : it.runs.length;
  const path = it.model ? M.cur(it.model).path : '';
  const local = it.model ? (it.plate && platesOf(it.model).length > 1 ? lib.thumbURLs.get(path + '#' + it.plate) : lib.thumbURLs.get(path)) : null;
  const cached = coverCache.get(it.cover);
  const url = cached || local;
  const when = (t) => { try { return new Date(t).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }); } catch { return ''; } };
  const sel = it.model && S.selected.has(it.model.id);
  // no file yet: the card stays grey until its model has been downloaded from Bambu in the background
  const dk = !it.model ? dlKey(it) : '';
  const ds = dk ? dlState(it, dk) : null;
  return `<div class="card ${sel ? 'selected' : ''} ${ds ? dlClass(ds) : ''}" data-item="${esc(it.key)}" ${it.model ? `data-id="${it.model.id}"` : ''} ${dk ? `data-dlkey="${esc(dk)}" style="--p:${ds.p || 0}"` : ''}>
    <div class="thumbwrap">${cloudBtn(it.model)}${it.timelapse ? _t`<button class="tlbtn" data-tl="${esc(it.timelapse)}" title="טיימלפס של ההדפסה">${I.play}</button>` : ''}${dk ? `<div class="dlbar"><i></i></div><span class="dlmsg">${dlLabel(ds)}</span>` : ''}<div class="thumb" ${it.cover && !cached ? `data-cover="${esc(it.cover)}"` : path && !url ? (it.plate ? `data-pthumb="${esc(path + '#' + it.plate)}"` : `data-thumb="${esc(path)}"`) : ''}>${url ? `<img src="${url}" alt="" loading="lazy">` : `<div class="ph">${I.cube}</div>`}</div></div>
    <div class="badges">${it.plate && it.multiPlate ? _t`<span class="badge accent">פלטה ${it.plate}</span>` : ''}${count > 1 ? `<span class="badge accent">×${count}</span>` : ''}${it.model || dk ? '' : itemFileBadge(it)}</div>
    ${it.model ? _t`<div class="check" data-check title="בחר">${I.check}</div>` : ''}
    <div class="body">
      <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
      ${it.design ? `<div class="sub" style="margin-top:0">${esc(it.design)}</div>` : ''}
      <div class="sub"><span class="st"><span class="sdot ${run.result}"></span>${RESULT[run.result] || ''} · ${when(run.t)}${run.minutes ? ' · ' + fmtDur(run.minutes * 60) : ''}</span></div>
    </div>
  </div>`;
}

function renderItems(kind) {
  const q = S.q.trim().toLowerCase();
  let list = printItems().filter((it) => (kind === 'ok' ? it.n.ok : it.n.fail + it.n.cancel + it.n.partial));
  if (q) list = list.filter((it) => (it.name + ' ' + it.design + ' ' + (it.model ? it.model.tags.join(' ') : '')).toLowerCase().includes(q));
  const at = (it) => (kind === 'ok' ? it.lastOk : it.lastFail).t;
  list.sort((a, b) => at(b) - at(a));
  S.items = new Map(list.map((it) => [it.key, it]));
  const g = $('#grid');
  if (!list.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>${kind === 'ok' ? _t('עוד אין הדפסות שהצליחו') : _t('אין הדפסות שנכשלו')}</b>${S.sync ? '' : _t('התחבר ל-Bambu ב„חיבור למדפסת” כדי לייבא את היסטוריית ההדפסות.')}</div>`;
    return;
  }
  S.visible = [...new Set(list.filter((it) => it.model).map((it) => it.model.id))];
  g.classList.toggle('selecting', S.selected.size > 0);
  g.innerHTML = list.map((it) => itemCardHTML(it, kind)).join('');
  for (const el of $$('[data-cover]', g)) coverURL(el.dataset.cover).then((u) => { if (u) el.innerHTML = `<img src="${u}" alt="" loading="lazy">`; });
  for (const it of list) if (it.model && !it.cover) { const p = M.cur(it.model).path; if (M.rec(p).thumb) refreshThumb(p); }
}

function openItem(key) {
  const it = S.items && S.items.get(key);
  if (!it) return;
  if (it.model) { S.openPlate = it.plate || 0; S.tab = 'prints'; openModal(it.model.id); return; }
  itemDialog(it);
}

async function itemDialog(it) {
  const d = document.createElement('div');
  d.className = 'dialog';
  const u = await coverURL(it.cover);
  const r0 = it.last;
  // a cloud print can bring its own 3MF: download it and open the full 3D view
  const cloudEnt = native && native.sync.fetchModel && S.sync && (it.runs.map((r) => r.entry).find((e) => e && /^cloud-/.test(e.key || '')) || null);
  const fil = (r) => (r.filaments || []).map((f) => `<span class="fil">${f.color ? `<span class="swatch" style="background:${esc(f.color)}"></span>` : ''}<span>${esc(f.type || '')}</span>${f.grams ? `<span class="ltr" style="color:var(--ink3)">${f.grams}g</span>` : ''}</span>`).join('');
  const when = (t) => { try { return new Date(t).toLocaleString(loc(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  d.innerHTML = _t`<div class="box wide item-box">
    <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">${esc(it.name)}${it.plate && it.multiPlate ? _t` <span class="badge accent">פלטה ${it.plate}</span>` : ''}</h3><button class="btn icon-btn ghost" data-close>${I.close}</button></div>
    ${it.design ? `<div class="hint" style="margin:2px 0 8px">${esc(it.design)}</div>` : ''}
    <div class="item-top">
      <div class="item-cover">${u ? `<img src="${u}" alt="">` : `<div class="ph">${I.cube}</div>`}${cloudEnt ? _t`<div class="item-fetch"><div class="spin"></div><span>מוריד את המודל מ-Bambu לתצוגה בתלת-ממד…</span></div>` : ''}</div>
      <dl class="kv">
        <dt>הדפסות</dt><dd>${it.runs.length} · ${it.n.ok} הצליחו${it.n.fail ? _t` · ${it.n.fail} נכשלו` : ''}${it.n.cancel ? _t` · ${it.n.cancel} בוטלו` : ''}</dd>
        ${r0.printer ? _t`<dt>מדפסת</dt><dd>${esc(r0.printer)}</dd>` : ''}
        ${r0.filaments && r0.filaments.length ? _t`<dt>פילמנט</dt><dd>${fil(r0)}</dd>` : ''}
        ${r0.minutes ? _t`<dt>זמן</dt><dd>${fmtDur(r0.minutes * 60)}</dd>` : ''}
        ${r0.grams ? _t`<dt>משקל</dt><dd>${r0.grams} g</dd>` : ''}
        <dt>קובץ</dt><dd><span data-fstat>${cloudEnt ? _t('מוריד מ-Bambu…') : _t('אין קובץ מתאים בתיקייה')}</span> <button class="btn small" data-link>שייך לקובץ…</button></dd>
      </dl>
    </div>
    <div class="section-title">כל ההדפסות</div>
    ${it.runs.map((r) => `<div class="print-item"><div class="ph"><span class="pill ${r.result}">${RESULT[r.result] || r.result}</span><span class="when">${when(r.t)}</span>${r.minutes ? `<span style="color:var(--ink3);font-size:12.5px">${fmtDur(r.minutes * 60)}</span>` : ''}</div>${r.title && r.title !== it.name ? `<div class="meta">${esc(r.title)}</div>` : ''}</div>`).join('')}
  </div>`;
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('[data-close]')) { d.remove(); return; }
    if (e.target.closest('[data-link]')) {
      const m = await pickModel(it.runs[0].entry || { title: it.name, design: it.design });
      if (!m) return;
      lib.data.imported = lib.data.imported || {};
      for (const r of it.runs) if (r.entry && !lib.data.imported[r.entry.key]) attach(lib, m, r.entry);
      const alias = it.runs[0].entry && (isGeneric(it.runs[0].entry.title) ? it.runs[0].entry.design : it.runs[0].entry.title);
      if (alias) { m.aliases = m.aliases || []; if (!m.aliases.some((a) => norm(a) === norm(alias))) m.aliases.push(alias); }
      const r = importPrints(lib, S.sync);
      S.unmatched = r.unmatched;
      lib.save();
      d.remove();
      toast(_t`שויך ל„${m.name}”`);
      renderAll();
    }
  });
  document.body.appendChild(d);
  if (cloudEnt) fetchCloudModel(it, cloudEnt, d);
}

async function fetchCloudModel(it, ent, d) {
  const fail = (msg) => {
    const f = $('.item-fetch', d); if (f) f.remove();
    const s = $('[data-fstat]', d); if (s) s.textContent = _t('אין קובץ בתיקייה, ו-Bambu לא החזירו את המודל');
    if (msg) console.warn('fetchModel', msg);
  };
  const r = await native.sync.fetchModel(ent.key);
  if (!d.isConnected) return;
  if (!r.ok) { fail(r.error); return; }
  await rescan(false);
  const m = M.list().find((x) => x.versions.some((v) => v.path === r.path));
  if (!m) { fail('scan'); return; }
  lib.data.imported = lib.data.imported || {};
  for (const run of it.runs) if (run.entry && !lib.data.imported[run.entry.key]) attach(lib, m, run.entry);
  const res = importPrints(lib, S.sync);
  S.unmatched = res.unmatched;
  lib.save();
  d.remove();
  renderAll();
  S.openPlate = it.plate || 0; S.tab = 'prints';
  openModal(m.id);
}


/* ================= toolbar + grid ================= */
function filtered() {
  const q = S.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  let list = M.list().filter((m) => {
    if (S.view === 'fav' && !m.favorite) return false;
    if (S.view === 'never' && M.status(m) !== 'never') return false;
    if (S.view === 'versions' && m.versions.length < 2) return false;
    if (S.tag && !m.tags.includes(S.tag)) return false;
    if (S.folder != null && dirName(M.cur(m).path) !== S.folder) return false;
    if (S.src && srcOf(m) !== S.src) return false;
    if (terms.length) {
      const r = M.rec(M.cur(m).path);
      const hay = [m.name, m.notes, ...m.tags, ...m.versions.map((v) => v.path + ' ' + (v.note || '')), r.meta?.designer, r.meta?.title, ...m.prints.map((p) => `${p.notes || ''} ${p.material || ''}`)].join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const by = {
    // last activity: the file changed or the model was printed, whichever is newer
    recent: (a, b) => M.activity(b) - M.activity(a),
    name: (a, b) => a.name.localeCompare(b.name, loc()),
    printed: (a, b) => (M.lastPrint(b) || '').localeCompare(M.lastPrint(a) || '') || M.mtime(b) - M.mtime(a),
    size: (a, b) => (M.rec(M.cur(b).path).size || 0) - (M.rec(M.cur(a).path).size || 0),
  }[S.sort];
  return list.sort(by);
}

function renderToolbar() {
  const inbox = S.view === 'inbox' && !S.tag && S.folder == null;
  const hist = S.view === 'history' && !S.tag && S.folder == null;
  const itemsView = (S.view === 'ok' || S.view === 'fail') && !S.tag && S.folder == null;
  if (isMineView()) { renderMineToolbar(); return; }
  const n = inbox ? (S.unmatched || []).length : hist ? historyRows().length : itemsView ? printItems().filter((it) => (S.view === 'ok' ? it.n.ok : it.n.fail + it.n.cancel + it.n.partial)).length : filtered().length;
  const title = (S.tag ? `#${S.tag}` : S.folder != null ? (S.folder || _t('תיקייה ראשית')) : { all: _t('כל הקבצים'), fav: _t('מועדפים'), ok: _t('הדפסות שהצליחו'), fail: _t('הדפסות שנכשלו'), never: _t('עוד לא הודפסו'), versions: _t('עם כמה גרסאות'), inbox: _t('הדפסות לא משויכות'), history: _t('כל ההדפסות'), mine: _t('המודלים שלי ב-MakerWorld') }[S.view]) + (S.src && !inbox && !hist && !itemsView ? ' · ' + SRC[S.src][0] : '');
  $('#toolbar').innerHTML = `
    <span class="title">${esc(title)}</span><span>${n} ${inbox || hist ? _t('הדפסות') : itemsView ? _t('פריטים') : _t('קבצים')}</span>
    ${S.tag || S.folder != null || S.src || S.q ? _t('<button class="btn small ghost" data-clear>נקה סינון</button>') : ''}
    <span id="prog" class="progress"></span>
    ${native && archiveOn() && S.view === 'ok' && itemsView ? (toArchive().length ? _t`<button class="btn small" data-archiveall title="מעלה ל-Drive את הקבצים של כל מה שהצליח ומוחק אותם מהמחשב">☁ העלה ל-Drive (${toArchive().length})</button>` : _t`<span class="btn small ghost" style="cursor:default" title="כל הקבצים של הדפסות שהצליחו כבר בארכיון">☁ הכול בארכיון</span>`) : ''}
    <span class="spacer" style="flex:1"></span>
    ${M.list().some((m) => platesOf(m).length > 1) && !inbox && !hist && !itemsView ? _t`<label class="chk" style="margin:0;font-size:13px" title="בפרויקט עם כמה פלטות, כל פלטה היא הדפסה נפרדת"><input type="checkbox" id="splitp" ${lib.data.prefs?.splitPlates !== false ? 'checked' : ''}> כל פלטה בנפרד</label>` : ''}
    ${hist || itemsView ? '' : _t`<select class="sel" id="sort">
      <option value="recent" ${S.sort === 'recent' ? 'selected' : ''}>עודכן לאחרונה</option>
      <option value="printed" ${S.sort === 'printed' ? 'selected' : ''}>הדפסה אחרונה ביומן</option>
      <option value="name" ${S.sort === 'name' ? 'selected' : ''}>שם</option>
      <option value="size" ${S.sort === 'size' ? 'selected' : ''}>גודל קובץ</option>
    </select>`}`;
  if (S.progress) setProgress(S.progress.label, S.progress.frac);
}

function cardHTML({ m, plate }) {
  if (plate) return plateCardHTML(m, plate);
  const v = M.cur(m);
  const rec = M.rec(v.path);
  const kind = fileKind(v.path);
  const st = M.status(m);
  const url = lib.thumbURLs.get(v.path);
  const plates = platesOf(m);
  const pst = plates.length > 1 ? plateStatus(m) : null;
  const okPlates = pst ? plates.filter((p) => pst[p.id] === 'ok').length : 0;
  const stLabel = st === 'never' ? (plates.length > 1 ? _t`${plates.length} פלטות · אין הדפסה רשומה` : _t('אין הדפסה רשומה'))
    : pst && Object.keys(pst).length ? _t`${okPlates}/${plates.length} פלטות הודפסו · ${fmtDate(M.lastPrint(m))}`
    : `${RESULT[st]} · ${fmtDate(M.lastPrint(m))}${m.prints.length > 1 ? _t` · ${m.prints.length} הדפסות` : ''}`;
  return `<div class="card ${S.selected.has(m.id) ? 'selected' : ''}" data-id="${m.id}">
    <div class="thumbwrap">${cloudBtn(m)}<div class="thumb" data-thumb="${esc(v.path)}">${url ? `<img src="${url}" alt="" loading="lazy">` : placeholder(v.path)}</div></div>
    <div class="badges"><span class="badge">${kind === 'stl' ? 'STL' : '3MF'}</span>${kind === 'gcode3mf' ? _t('<span class="badge accent">פרוס</span>') : ''}${m.versions.length > 1 ? _t`<span class="badge accent">${m.versions.length} גרסאות</span>` : ''}</div>
    <div class="check" data-check>${I.check}</div>
    ${m.favorite ? `<span class="fav">${I.star}</span>` : ''}
    <div class="body">
      <div class="name" title="${esc(m.name)}">${esc(m.name)}</div>
      <div class="sub"><span class="st"><span class="sdot ${st}"></span>${stLabel}</span>${rec.missing ? _t(' · <span style="color:var(--fail)">חסר</span>') : ''}</div>
      ${m.tags.length ? `<div class="tags">${m.tags.slice(0, 4).map((t) => tagHTML(t)).join('')}${m.tags.length > 4 ? `<span class="tag" style="--h:0;filter:grayscale(1)">+${m.tags.length - 4}</span>` : ''}</div>` : ''}
    </div>
  </div>`;
}

// one card per build plate (each plate is a separate print, as in Bambu Studio)
function plateCardHTML(m, plate) {
  const v = M.cur(m);
  const rec = M.rec(v.path);
  const plates = platesOf(m);
  const prints = m.prints.filter((p) => +p.plateNo === plate.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  const st = plateStatus(m)[plate.id] || 'never';
  const stLabel = st === 'never' ? _t('אין הדפסה רשומה') : `${RESULT[st]} · ${fmtDate(prints[0].date)}${prints.length > 1 ? _t` · ${prints.length} הדפסות` : ''}`;
  const key = v.path + '#' + plate.id;
  const url = lib.thumbURLs.get(key);
  return _t`<div class="card ${S.selected.has(m.id) ? 'selected' : ''}" data-id="${m.id}" data-plate="${plate.id}">
    <div class="thumbwrap">${cloudBtn(m)}<div class="thumb" data-pthumb="${esc(key)}">${url ? `<img src="${url}" alt="" loading="lazy">` : placeholder(v.path)}</div></div>
    <div class="badges"><span class="badge accent">פלטה ${plate.id}/${plates.length}</span>${fileKind(v.path) === 'gcode3mf' ? _t('<span class="badge accent">פרוס</span>') : ''}</div>
    <div class="check" data-check>${I.check}</div>
    ${m.favorite ? `<span class="fav">${I.star}</span>` : ''}
    <div class="body">
      <div class="name" title="${esc(m.name)}">${esc(m.name)}${plate.name ? ` <span style="color:var(--ink3);font-weight:500">· ${esc(plate.name)}</span>` : ''}</div>
      <div class="sub"><span class="st"><span class="sdot ${st}"></span>${stLabel}</span>${rec.missing ? _t(' · <span style="color:var(--fail)">חסר</span>') : ''}</div>
      ${m.tags.length ? `<div class="tags">${m.tags.slice(0, 3).map((t) => tagHTML(t)).join('')}</div>` : ''}
    </div>
  </div>`;
}
function gridEntries(list) {
  const split = lib.data.prefs?.splitPlates !== false;
  const out = [];
  for (const m of list) {
    const plates = split ? platesOf(m) : [];
    if (plates.length > 1) {
      const pst = plateStatus(m);
      for (const p of plates) {
        const st = pst[p.id] || 'never';
        const pp = m.prints.filter((x) => +x.plateNo === p.id);
        if (S.view === 'ok' && !pp.some((x) => x.result === 'ok')) continue;
        if (S.view === 'fail' && !pp.some((x) => x.result === 'fail' || x.result === 'partial')) continue;
        if (S.view === 'never' && st !== 'never') continue;
        out.push({ m, plate: p });
      }
    } else out.push({ m, plate: null });
  }
  return out;
}

/* ---------- print history (newest first, like Bambu Studio's Print History) ---------- */
function historyRows() {
  const q = S.q.trim().toLowerCase();
  const rows = [];
  for (const it of printItems()) for (const r of it.runs) rows.push({ it, r, t: r.t });
  return rows.filter(({ it }) => !q || (it.name + ' ' + it.design).toLowerCase().includes(q)).sort((a, b) => b.t - a.t);
}
function renderHistory() {
  const rows = historyRows();
  S.items = new Map(rows.map(({ it }) => [it.key, it]));
  const g = $('#grid');
  const when = (t) => { try { return new Date(t).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  g.innerHTML = `<div class="inbox hist" style="grid-column:1/-1">
    ${rows.length ? rows.slice(0, 600).map(({ it, r }) => {
      const path = it.model ? M.cur(it.model).path : '';
      const cached = coverCache.get(r.coverFile || it.cover);
      const local = path && ((it.plate && lib.thumbURLs.get(path + '#' + it.plate)) || lib.thumbURLs.get(path));
      const u = cached || local;
      return `<div class="irow" data-item="${esc(it.key)}" style="cursor:pointer">
        ${u ? `<img class="icover" src="${u}" alt="" style="object-fit:contain">` : `<div class="icover" ${r.coverFile || it.cover ? `data-cover="${esc(r.coverFile || it.cover)}"` : path ? (it.plate ? `data-pthumb="${esc(path + '#' + it.plate)}"` : `data-thumb="${esc(path)}"`) : ''}></div>`}
        <div class="ii"><div class="it">${esc(it.name)}${it.plate && it.multiPlate ? _t` <span class="badge accent">פלטה ${it.plate}</span>` : ''} ${itemFileBadge(it)}</div>
          <div class="isub">${[when(r.t), r.printer, r.minutes ? fmtDur(r.minutes * 60) : '', r.grams ? r.grams + ' g' : '', (r.filaments || []).map((f) => f.type).filter(Boolean).join(' + '), r.source === 'manual' ? _t('ידני') : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        <span class="pill ${r.result}">${RESULT[r.result] || r.result}</span>
      </div>`;
    }).join('') : _t('<div class="empty"><b>עוד אין הדפסות</b>התחבר ל-Bambu ב„חיבור למדפסת”, או רשום הדפסה מתוך קובץ.</div>')}
  </div>`;
  for (const el of $$('[data-cover]', g)) coverURL(el.dataset.cover).then((u) => { if (u) el.innerHTML = `<img src="${u}" alt="" style="width:100%;height:100%;object-fit:contain">`; });
  const seen = new Set();
  for (const { it } of rows.slice(0, 120)) if (it.model) { const p = M.cur(it.model).path; if (!seen.has(p)) { seen.add(p); refreshThumb(p); } }
}

function renderGrid() {
  if (S.view === 'inbox' && !S.tag && S.folder == null) { $('#grid').classList.remove('selecting'); S.visible = []; renderInbox(); return; }
  if (S.view === 'history' && !S.tag && S.folder == null) { $('#grid').classList.remove('selecting'); S.visible = []; renderHistory(); return; }
  if ((S.view === 'ok' || S.view === 'fail') && !S.tag && S.folder == null) { renderItems(S.view); return; }
  if (isMineView()) { renderMine(); return; }
  const list = filtered();
  const entries = gridEntries(list);
  S.visible = list.map((m) => m.id);
  const g = $('#grid');
  g.classList.toggle('selecting', S.selected.size > 0);
  if (!list.length) {
    g.innerHTML = M.list().length
      ? _t`<div class="empty" style="grid-column:1/-1"><b>אין תוצאות</b>נסה חיפוש אחר או נקה את הסינון.</div>`
      : _t`<div class="empty" style="grid-column:1/-1"><b>התיקייה ריקה</b>גרור לכאן קבצי STL או 3MF, או שמור אותם לתיקייה ולחץ „רענן”.</div>`;
    return;
  }
  g.innerHTML = entries.map(cardHTML).join('');
  for (const { m, plate } of entries) {
    const p = M.cur(m).path;
    if (M.rec(p).thumb && !lib.thumbURLs.has(plate ? p + '#' + plate.id : p)) refreshThumb(p);
  }
}

/* ================= my MakerWorld models (designs the user published) ================= */
const isMineView = () => S.view === 'mine' && !S.tag && S.folder == null && !!(native && native.makerworld);
const mwOk = () => !!(S.mw && S.mw.res && S.mw.res.ok);
// the view reloads the next time it is shown (or now, when it is open)
// S.mwGen goes up on every reset, so an answer that was already on its way for the old user is dropped
function mwReset() { S.mw = null; S.mwGen = (S.mwGen || 0) + 1; if (!lib || !$('#side')) return; renderSidebar(); if (isMineView()) { renderToolbar(); renderGrid(); } }
async function loadMine(refresh) {
  if (!native || !native.makerworld || (S.mw && S.mw.loading)) return;
  const gen = S.mwGen || 0;
  S.mw = { loading: true, res: S.mw && S.mw.res };
  if (isMineView()) { renderToolbar(); renderGrid(); }
  let res;
  try { res = await native.makerworld.mine({ refresh: !!refresh }); } catch { res = null; }
  if (gen !== (S.mwGen || 0)) return;
  S.mw = { loading: false, res: res || { ok: false, code: 'network' } };
  renderSidebar();
  if (isMineView()) { renderToolbar(); renderGrid(); }
}
function mineNav(nav) {
  if (!native || !native.makerworld) return '';
  return `<h4>MakerWorld</h4>${nav(['mine', _t('המודלים שלי'), I.cube, mwOk() ? S.mw.res.designs.length : ''])}`;
}
function mineList() {
  if (!mwOk()) return [];
  const terms = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const t = (d) => Date.parse(d.published || '') || 0;
  return (S.mw.res.designs || [])
    .filter((d) => { const hay = [d.title, ...(d.tags || [])].join(' ').toLowerCase(); return terms.every((x) => hay.includes(x)); })
    .sort((a, b) => t(b) - t(a));
}
// how many times the user printed each design (cloud prints carry designId; instances match by profileId)
function myPrintCounts() {
  const byDesign = new Map(), byProfile = new Map();
  for (const e of (S.sync && S.sync.prints) || []) {
    if (e.designId && String(e.designId) !== '0') byDesign.set(String(e.designId), (byDesign.get(String(e.designId)) || 0) + 1);
    else if (e.profileId && String(e.profileId) !== '0') byProfile.set(String(e.profileId), (byProfile.get(String(e.profileId)) || 0) + 1);
  }
  return (d) => (byDesign.get(String(d.id)) || 0) + (d.instances || []).reduce((a, i) => a + (byProfile.get(String(i.profileId)) || 0), 0);
}
function renderMineToolbar() {
  const ok = mwOk(), loading = S.mw && S.mw.loading;
  const r = ok ? S.mw.res : null;
  $('#toolbar').innerHTML = `
    <span class="title">${_t('המודלים שלי ב-MakerWorld')}</span>${ok ? `<span>${mineList().length} ${_t('מודלים')}</span>` : ''}
    ${S.q ? _t('<button class="btn small ghost" data-clear>נקה סינון</button>') : ''}
    <span id="prog" class="progress"></span>
    <span class="spacer" style="flex:1"></span>
    ${r && r.profileUrl ? `<button class="btn small ghost" data-mwurl="${esc(r.profileUrl)}">${I.ext}${_t('פתח את הפרופיל')}</button>` : ''}
    <button class="btn small" data-mwrefresh ${loading ? 'disabled' : ''}>${loading ? '<span class="spin" style="width:12px;height:12px"></span>' : I.refresh}${_t('רענן')}</button>`;
  if (S.progress) setProgress(S.progress.label, S.progress.frac);
}
const fmtCount = (n) => { try { return new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(+n || 0); } catch { return String(+n || 0); } };
function mineCardHTML(d, printed) {
  const stat = (ic, n, title) => `<span class="mwstat" title="${esc(title)}">${ic}${fmtCount(n)}</span>`;
  return `<div class="card mw" data-mwurl="${esc(d.url || '')}" title="${esc(d.title || '')}">
    <div class="thumbwrap"><div class="thumb">${d.cover ? `<img src="${esc(d.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="ph">${I.cube}</div>`}</div></div>
    <div class="badges">${printed ? `<span class="badge accent">${_t`הדפסת ×${printed}`}</span>` : ''}${d.makerLab ? '<span class="badge">MakerLab</span>' : ''}</div>
    <div class="body">
      <div class="name">${esc(d.title || _t('ללא שם'))}</div>
      <div class="sub mwstats">${stat(I.download, d.downloads, _t('הורדות'))}${stat(I.printer, d.prints, _t('הדפסות'))}${stat(I.heart, d.likes, _t('לייקים'))}${stat(I.bookmark, d.collections, _t('שמירות לאוסף'))}</div>
    </div>
  </div>`;
}
function renderMine() {
  const g = $('#grid');
  g.classList.remove('selecting');
  S.visible = [];
  if (!S.mw) { loadMine(false); return; }
  // background syncs re-render the grid: don't wipe a profile link the user is typing
  if (S.mwShown === S.mw && document.activeElement && document.activeElement.id === 'mwprof') return;
  S.mwShown = S.mw;
  const r = S.mw.res;
  const box = (inner) => `<div class="empty mwstate" style="grid-column:1/-1">${inner}</div>`;
  if (!r) { g.innerHTML = box(`<div class="spin" style="margin:0 auto 12px"></div>${_t('טוען את המודלים שלך מ-MakerWorld…')}`); return; }
  const who = (title, text) => box(`<b>${title}</b><div>${text}</div>
    <div class="mwform"><input class="inp ltr" id="mwprof" value="${esc(S.mwProfile || '')}" placeholder="https://makerworld.com/en/@user_…"><button class="btn primary" data-mwsave>${_t('שמור')}</button></div>
    <div style="margin-top:10px"><button class="btn" data-mwlogin>${_t('התחבר ל-Bambu בהגדרות')}</button></div>`);
  if (!r.ok) {
    if (r.code === 'no-user') g.innerHTML = who(_t('צריך לדעת מי אתה ב-MakerWorld'), _t('התחבר לחשבון Bambu בהגדרות, או הדבק כאן את הקישור לפרופיל שלך ב-MakerWorld:'));
    else if (r.code === 'custom-handle') g.innerHTML = who(_t('עוד אי אפשר לזהות שם פרופיל מותאם אישית'), _t('התחבר לחשבון Bambu בהגדרות, או הדבק את הקישור לפרופיל שמסתיים ב-@user_ ומספר:'));
    else g.innerHTML = box(`<b>${_t('לא הצלחנו להגיע ל-MakerWorld')}</b><div>${_t('בדוק את החיבור לאינטרנט ונסה שוב.')}${r.status ? ` (${esc(r.status)})` : ''}</div><div style="margin-top:12px"><button class="btn" data-mwrefresh>${I.refresh}${_t('נסה שוב')}</button></div>`);
    const inp = $('#mwprof', g);
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') saveMwProfile(inp.value); };
    return;
  }
  if (!(r.designs || []).length) {
    g.innerHTML = box(`<b>${_t('עוד לא פרסמת מודלים ב-MakerWorld')}</b>${r.profileUrl ? `<div style="margin-top:12px"><button class="btn" data-mwurl="${esc(r.profileUrl)}">${I.ext}${_t('פתח את הפרופיל')}</button></div>` : ''}`);
    return;
  }
  const list = mineList();
  if (!list.length) { g.innerHTML = _t`<div class="empty" style="grid-column:1/-1"><b>אין תוצאות</b>נסה חיפוש אחר או נקה את הסינון.</div>`; return; }
  const printed = myPrintCounts();
  g.innerHTML = list.map((d) => mineCardHTML(d, printed(d))).join('');
}
async function saveMwProfile(v) {
  v = String(v || '').trim();
  try { await native.sync.setConfig({ options: { mwProfile: v } }); } catch (e) { toast(_t('השמירה נכשלה: ') + (e && e.message), true); return; }
  S.mwProfile = v;
  S.mw = null; S.mwGen = (S.mwGen || 0) + 1;
  loadMine(true);
}
// true when the click was handled here
function onMineClick(e) {
  const t = e.target;
  if (t.closest('[data-mwsave]')) { saveMwProfile(($('#mwprof') || {}).value); return true; }
  if (t.closest('[data-mwlogin]')) { printerDialog(); return true; }
  if (t.closest('[data-mwrefresh]')) { loadMine(true); return true; }
  const u = t.closest('[data-mwurl]');
  if (u) { if (u.dataset.mwurl) native.openUrl(u.dataset.mwurl); return true; }
  return !!t.closest('.mwstate');
}

function quickLog(m, result, forPlate) {
  const vp = M.cur(m).path;
  const plates = platesOf(m);
  const pst = plateStatus(m);
  const plateNo = forPlate || (plates.length > 1 ? (plates.find((x) => pst[x.id] !== 'ok') || plates[0]).id : '');
  const p = { id: uid(), at: new Date().toISOString(), date: todayISO(), result, versionPath: vp, plateNo, ...defaultsFor(m, vp, plateNo) };
  m.prints.push(p);
  M.touch(m);
  renderAll();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = _t`${result === 'ok' ? _t('נרשמה הדפסה מוצלחת') : _t('נרשמה הדפסה שנכשלה')}: ${esc(m.name)}${plateNo ? _t` · פלטה ${plateNo}` : ''} <button class="btn small" style="margin-inline-start:8px;background:transparent;color:inherit">ביטול</button>`;
  $('button', t).onclick = () => { m.prints = m.prints.filter((x) => x.id !== p.id); M.touch(m); renderAll(); t.remove(); };
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

function onGridClick(e) {
  if (e.target.closest('.inbox')) { onInboxClick(e); return; }
  if (isMineView() && onMineClick(e)) return;
  const cb = e.target.closest('[data-cloud]');
  if (cb) { e.stopPropagation(); onCloudBtn(cb.dataset.cloud); return; }
  const tl = e.target.closest('[data-tl]');
  if (tl) { e.stopPropagation(); playTimelapse(tl.dataset.tl); return; }
  const itc = e.target.closest('[data-item]');
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const selecting = id && (e.target.closest('[data-check]') || e.metaKey || e.ctrlKey || e.shiftKey || S.selected.size);
  if (itc && !selecting) { openItem(itc.dataset.item); return; }
  if (!id) return;
  if (selecting) {
    if (e.shiftKey && S.lastSel && S.visible) {
      const a = S.visible.indexOf(S.lastSel), b = S.visible.indexOf(id);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.selected.add(S.visible[i]);
    } else if (S.selected.has(id)) S.selected.delete(id);
    else S.selected.add(id);
    S.lastSel = id;
    renderGrid();
    renderBulk();
    return;
  }
  S.openPlate = card.dataset.plate ? +card.dataset.plate : 0;
  openModal(id);
}

/* ================= bulk ================= */
function renderBulk() {
  const n = S.selected.size;
  if (!n) { $('#bulk').innerHTML = ''; return; }
  $('#bulk').innerHTML = _t`<div class="bulkbar"><span class="n">${n} נבחרו</span>
    <button class="btn small" data-b="tag">${I.tag}הוסף תגית</button>
    ${n > 1 ? _t`<button class="btn small" data-b="merge">${I.merge}אחד לגרסאות של מודל אחד</button>` : ''}
    <button class="btn small" data-b="fav">${I.starO}מועדף</button>
    ${native && archiveOn() ? (() => { const ms = [...S.selected].map((i) => lib.data.models[i]).filter(Boolean); const up = ms.filter(hasLocal).length, down = ms.filter((m) => m.versions.some((v) => v.path.startsWith('@gdrive/'))).length;
      return `${up ? _t`<button class="btn small primary" data-b="archive">☁ העלה ל-Drive (${up})</button>` : ''}${down ? _t`<button class="btn small" data-b="restore">החזר מ-Drive (${down})</button>` : ''}`; })() : ''}
    <button class="btn small ghost" data-b="clear">${I.close}</button></div>`;
  $('#bulk').onclick = async (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const ids = [...S.selected];
    const models = ids.map((i) => lib.data.models[i]).filter(Boolean);
    if (b.dataset.b === 'clear') S.selected.clear();
    if (b.dataset.b === 'archive') { S.selected.clear(); renderBulk(); await archiveModels(models.filter(hasLocal)); }
    if (b.dataset.b === 'restore') { S.selected.clear(); renderBulk(); for (const m of models) if (m.versions.some((v) => v.path.startsWith('@gdrive/'))) await restoreModel(m); }
    if (b.dataset.b === 'fav') { const on = !models.every((m) => m.favorite); models.forEach((m) => { m.favorite = on; M.touch(m); }); }
    if (b.dataset.b === 'tag') {
      const t = await promptTag();
      if (t) models.forEach((m) => { if (!m.tags.includes(t)) m.tags.push(t); M.touch(m); });
    }
    if (b.dataset.b === 'merge') {
      const ok = await dialog(_t('לאחד למודל אחד?'), _t`${models.length} המודלים יהפכו לגרסאות של „${esc(models[0].name)}”. הקבצים עצמם לא זזים, ואפשר להפריד אותם שוב בכל רגע.`, [{ label: _t('אחד'), value: true, primary: true }, { label: _t('ביטול'), value: false }]);
      if (ok) { mergeModels(models); S.selected.clear(); toast(_t('אוחדו לגרסאות של מודל אחד')); }
    }
    renderAll();
  };
}
function askText(title, placeholder) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = _t`<div class="box"><h3>${esc(title)}</h3><input class="inp ltr" placeholder="${esc(placeholder)}"><div class="actions" style="margin-top:14px"><button class="btn primary" data-ok>אישור</button><button class="btn" data-no>ביטול</button></div></div>`;
    const inp = $('input', d);
    const done = (v) => { d.remove(); resolve(v ? v.trim() : null); };
    $('[data-ok]', d).onclick = () => done(inp.value);
    $('[data-no]', d).onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
    document.body.appendChild(d);
    inp.focus();
  });
}
function promptTag() {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dialog';
    const all = [...new Set(M.list().flatMap((m) => m.tags))];
    d.innerHTML = _t`<div class="box"><h3>הוסף תגית</h3><input class="inp" list="taglist" placeholder="למשל: מתנות, כלים, PETG" autofocus><datalist id="taglist">${all.map((t) => `<option value="${esc(t)}">`).join('')}</datalist><div class="actions" style="margin-top:14px"><button class="btn primary" data-ok>הוסף</button><button class="btn" data-no>ביטול</button></div></div>`;
    const inp = $('input', d);
    const done = (v) => { d.remove(); resolve(v ? v.trim() : null); };
    $('[data-ok]', d).onclick = () => done(inp.value);
    $('[data-no]', d).onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
    document.body.appendChild(d);
    inp.focus();
  });
}
function mergeModels(models) {
  models = [...models].sort((a, b) => Math.min(...a.versions.map((v) => M.rec(v.path).mtime || 0)) - Math.min(...b.versions.map((v) => M.rec(v.path).mtime || 0)));
  const [target, ...rest] = models;
  if (target.nameAuto) target.name = target.name.replace(/[\s_-]*v\d+$/i, '').trim() || target.name;
  for (const m of rest) {
    target.versions.push(...m.versions);
    target.prints.push(...m.prints);
    for (const t of m.tags) if (!target.tags.includes(t)) target.tags.push(t);
    if (m.notes) target.notes = [target.notes, m.notes].filter(Boolean).join('\n');
    target.favorite = target.favorite || m.favorite;
    delete lib.data.models[m.id];
  }
  target.versions.sort((a, b) => (M.rec(a.path).mtime || 0) - (M.rec(b.path).mtime || 0));
  target.current = target.versions[target.versions.length - 1].path;
  M.touch(target);
}

/* ================= model modal ================= */
let viewer = null;
function openModal(id) {
  S.open = id;
  S.tab = S.tab || 'details';
  S.printForm = null;
  const m = lib.data.models[id];
  S.viewPath = M.cur(m).path;
  const wrap = $('#modal');
  wrap.innerHTML = _t`<div class="modal-wrap" id="mw"><div class="modal">
    <div class="stage" id="stage">
      <div class="overlay" id="ov"><div class="spin"></div></div>
      <div class="dims hidden" id="dims"></div>
      <div class="nav"><button class="btn icon-btn" id="close" title="סגור (Esc)">${I.close}</button><button class="btn icon-btn" data-step="-1" title="הקודם">${I.prev}</button><button class="btn icon-btn" data-step="1" title="הבא">${I.next}</button></div>
      <div class="plates hidden" id="plates"></div>
      <div class="tools"><button class="btn small" id="wire" title="רשת">${I.wire}רשת</button><button class="btn small" id="reset" title="מרכז">${I.target}מרכז</button></div>
    </div>
    <div class="info" id="info"></div>
  </div></div>`;
  $('#mw').addEventListener('mousedown', (e) => { if (e.target.id === 'mw') closeModal(); });
  $('#close').onclick = closeModal;
  $$('[data-step]').forEach((b) => (b.onclick = () => stepModel(+b.dataset.step)));
  try {
    viewer = new Viewer($('#stage'));
    $('#stage').prepend(viewer.renderer.domElement);
  } catch (e) {
    viewer = null;
    $('#ov').innerHTML = _t('אין תמיכה בתלת-ממד (WebGL) בדפדפן הזה');
  }
  $('#wire').onclick = () => viewer && viewer.setWire(!viewer.wire);
  $('#reset').onclick = () => viewer && viewer.resetView();
  // drop a file onto the open model = new version
  const st = $('#stage');
  st.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  $('#mw').addEventListener('drop', (e) => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find((x) => fileKind(x.name));
    if (f) addVersion(m, f);
  });
  renderInfo();
  loadView(S.viewPath);
}
function closeModal() {
  loadToken++;
  cancelParses('view');
  if (viewer) { viewer.destroy(); viewer = null; }
  S.open = null;
  $('#modal').innerHTML = '';
  renderAll();
}
function stepModel(d) {
  if (!S.open || !S.visible) return;
  const i = S.visible.indexOf(S.open);
  const nid = S.visible[(i + d + S.visible.length) % S.visible.length];
  if (!nid || nid === S.open) return;
  if (viewer) { viewer.destroy(); viewer = null; }
  openModal(nid);
}

let loadToken = 0;
async function loadView(path) {
  const tok = ++loadToken;
  S.viewPath = path;
  const ov = $('#ov');
  if (!ov) return;
  ov.classList.remove('hidden');
  ov.innerHTML = '<div class="spin"></div>';
  $('#dims').classList.add('hidden');
  try {
    const rec = M.rec(path);
    if (rec.missing) throw new Error(_t('הקובץ לא נמצא בתיקייה. אולי נמחק או הוזז מחוץ לתיקייה.'));
    const file = await lib.getFile(path);
    if (file.size > 30e6) ov.innerHTML = _t`<div class="spin"></div><div class="ov-msg">מעבד מודל גדול (${fmtBytes(file.size)})…</div>`;
    const buf = await file.arrayBuffer();
    if (tok !== loadToken || !viewer) return;
    cancelParses('view');
    const parsed = await parseAsync(path, buf, { budget: 3e6 }, 'view');
    if (tok !== loadToken || !viewer) return;
    const plates = parsed.meta.plates || [];
    const bed = parsed.meta.bed || { w: 256, d: 256 };
    const layout = fileKind(path) !== 'stl' && (parsed.meta.plateCount || plates.length || parsed.meta.bed) ? bedLayout(parsed.parts, Math.max(parsed.meta.plateCount || 0, plates.length), bed.w, bed.d) : { ok: false };
    const showPlate = (id) => {
      const parts = id ? parsed.parts.filter((p) => p.plate === id) : parsed.parts;
      const beds = layout.ok ? (id ? [layout.beds.get(id)] : [...layout.beds.values()]) : null;
      const dims = beds ? viewer.showOnBeds(parts, beds) : viewer.show(parts);
      const tri = parts.reduce((a, p) => a + p.positions.length / 9, 0);
      $('#dims').classList.remove('hidden');
      $('#dims').innerHTML = _t`<span class="ltr">${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm</span> · ${Math.round(parsed.meta.simplified ? (parsed.meta.triangles * tri) / parsed.meta.simplified : tri).toLocaleString(loc())} משולשים${parsed.meta.simplified ? _t(' · מוצג מפושט') : ''}`;
      const pe = $('#plates');
      pe.classList.toggle('hidden', plates.length < 2);
      S.viewPlate = id || null;
      const om = lib.data.models[S.open];
      const ps = om ? plateStatus(om) : {};
      pe.innerHTML = plates.map((p) => _t`<button class="btn small ${p.id === id ? 'on' : ''}" data-plate="${p.id}" title="${esc(p.name || '')}">פלטה ${p.id}${p.name ? ` · ${esc(p.name)}` : ''}${ps[p.id] === 'ok' ? ' ✓' : ps[p.id] === 'fail' ? ' ✗' : ''}</button>`).join('') + _t`<button class="btn small ${!id ? 'on' : ''}" data-plate="0">הכל</button>`;
      pe.onclick = (e) => { const b = e.target.closest('[data-plate]'); if (b) showPlate(+b.dataset.plate); };
      return dims;
    };
    const want = S.openPlate && plates.some((p) => p.id === S.openPlate) ? S.openPlate : plates.length > 1 ? plates[0].id : 0;
    S.openPlate = 0;
    const dims = showPlate(want);
    ov.classList.add('hidden');
    rec.dims = dims;
    rec.triangles = parsed.meta.triangles || parsed.parts.reduce((a, p) => a + p.positions.length / 9, 0);
    lib.save();
    if (S.tab === 'details') renderInfo();
  } catch (e) {
    if (tok !== loadToken) return;
    ov.innerHTML = _t`<div>${I.cube}<div style="margin-top:8px">לא ניתן להציג את המודל</div><div class="hint">${esc(tx(e.message || String(e)))}</div></div>`;
  }
}

function renderInfo() {
  const m = lib.data.models[S.open];
  if (!m) return;
  const v = M.cur(m);
  const info = $('#info');
  const scrollTop = S.scrollReset ? 0 : $('.info-body', info)?.scrollTop || 0;
  S.scrollReset = false;
  info.innerHTML = _t`
    <div class="info-head">
      <div class="row">
        <input class="name-input" id="mname" value="${esc(m.name)}" aria-label="שם המודל">
        <button class="btn icon-btn ghost" id="mfav" title="מועדף" style="color:var(--accent)">${m.favorite ? I.star : I.starO}</button>
      </div>
      <div class="path mono" title="${esc(S.viewPath)}"><span>${esc(dispPath(S.viewPath))}</span><button class="btn small ghost icon-btn" id="copypath" title="העתק נתיב" style="width:26px;height:26px">${I.copy}</button></div>
    </div>
    <div class="tabs">
      <button class="tab ${S.tab === 'details' ? 'active' : ''}" data-tab="details">פרטים</button>
      <button class="tab ${S.tab === 'prints' ? 'active' : ''}" data-tab="prints">הדפסות<span class="c">${m.prints.length}</span></button>
      <button class="tab ${S.tab === 'versions' ? 'active' : ''}" data-tab="versions">גרסאות<span class="c">${m.versions.length}</span></button>
    </div>
    <div class="info-body">${S.tab === 'details' ? detailsTab(m) : S.tab === 'prints' ? printsTab(m) : versionsTab(m)}</div>`;
  $('.info-body', info).scrollTop = scrollTop;
  bindInfo(m);
}

function settingsKV(p) {
  if (!p) return '';
  const rows = [];
  if (p.printer) rows.push([_t('מדפסת'), esc(p.printer)]);
  if (p.filaments && p.filaments.length) rows.push([_t('פילמנט'), p.filaments.map((f) => `<span class="fil">${f.color ? `<span class="swatch" style="background:${esc(f.color)}"></span>` : ''}<span>${esc(f.type)}</span>${f.grams ? `<span class="ltr" style="color:var(--ink3)">${f.grams.toFixed(1)}g</span>` : ''}</span>`).join('')]);
  if (p.layer) rows.push([_t('גובה שכבה'), `<span class="ltr">${esc(p.layer)} mm</span>`]);
  if (p.infill) rows.push([_t('מילוי'), `<span class="ltr">${esc(p.infill)}</span>`]);
  if (p.walls) rows.push([_t('קירות'), esc(p.walls)]);
  if (p.nozzle || p.bed) rows.push([_t('טמפרטורות'), `<span class="ltr">${p.nozzle ? esc(p.nozzle) + '° nozzle' : ''}${p.nozzle && p.bed ? ' · ' : ''}${p.bed ? esc(p.bed) + '° bed' : ''}</span>`]);
  if (p.plateType) rows.push([_t('פלטה'), esc(p.plateType)]);
  rows.push([_t('תמיכות'), p.supports ? _t('כן') : _t('לא')]);
  if (p.timeSec) rows.push([_t('זמן משוער'), fmtDur(p.timeSec)]);
  if (p.grams) rows.push([_t('משקל'), `${p.grams.toFixed(1)} g`]);
  return `<dl class="kv">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>`;
}

function detailsTab(m) {
  const rec = M.rec(S.viewPath);
  const meta = rec.meta || {};
  const all = [...new Set(M.list().flatMap((x) => x.tags))].filter((t) => !m.tags.includes(t));
  return _t`
    <div class="field"><label>תגיות</label>
      <div class="tag-editor" id="tagbox">${m.tags.map((t) => tagHTML(t, true)).join('')}<input id="tagin" list="alltags" placeholder="${m.tags.length ? '' : _t('הקלד תגית ולחץ Enter')}"><datalist id="alltags">${all.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
    </div>
    <div class="field"><label>הערות</label><textarea class="notes" id="mnotes" rows="4" placeholder="מאיפה הורדתי, למי הדפסתי, מה לשים לב…">${esc(m.notes)}</textarea></div>
    <div class="section-title">קובץ</div>
    <dl class="kv">
      <dt>סוג</dt><dd>${fileKind(S.viewPath) === 'stl' ? 'STL' : fileKind(S.viewPath) === 'gcode3mf' ? _t('3MF פרוס (מוכן להדפסה)') : '3MF'}</dd>
      <dt>גודל</dt><dd>${rec.size ? fmtBytes(rec.size) : '–'}</dd>
      ${rec.dims ? _t`<dt>מידות</dt><dd class="ltr" style="text-align:right">${rec.dims.x.toFixed(1)} × ${rec.dims.y.toFixed(1)} × ${rec.dims.z.toFixed(1)} mm</dd>` : ''}
      <dt>שונה</dt><dd>${rec.mtime ? fmtDate(rec.mtime) : '–'}</dd>
      ${meta.designer ? _t`<dt>מעצב</dt><dd>${esc(meta.designer)}</dd>` : ''}
      ${meta.license ? _t`<dt>רישיון</dt><dd>${esc(meta.license)}</dd>` : ''}
    </dl>
    ${meta.description ? _t`<div class="section-title">תיאור מהקובץ</div><div style="color:var(--ink2);font-size:13px">${esc(meta.description)}</div>` : ''}
    ${meta.print ? _t`<div class="section-title">הגדרות הדפסה מהקובץ</div>${settingsKV(meta.print)}` : ''}
    <div class="section-title">פעולות</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small" id="dl">${I.download}הורד עותק</button>
      <button class="btn small" id="logprint">${I.plus}רשום הדפסה</button>
      ${native && archiveOn() && !isArchived(M.cur(m).path) ? _t`<button class="btn small" id="toarchive">☁ העבר לארכיון</button>` : ''}
      ${native && m.versions.some((v) => v.path.startsWith('@gdrive/')) ? _t`<button class="btn small" id="restore">החזר לתיקייה</button>` : ''}
    </div>`;
}

function printsTab(m) {
  const list = [...m.prints].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  const verName = (p) => { const i = m.versions.findIndex((v) => v.path === p); return i >= 0 ? `v${i + 1}` : ''; };
  const plates = platesOf(m);
  const pst = plateStatus(m);
  const sym = { ok: '✓', partial: '◐', fail: '✗' };
  return `
    ${plates.length > 1 ? `<div class="plate-sum">${plates.map((p) => _t`<span class="pchip ${pst[p.id] || 'none'}" title="${esc(p.name || '')}">פלטה ${p.id}${p.name ? ` · ${esc(p.name)}` : ''} <b>${sym[pst[p.id]] || '–'}</b></span>`).join('')}</div>` : ''}
    ${S.printForm ? printFormHTML(m) : _t`<button class="btn primary" id="newprint" style="margin-bottom:14px">${I.plus}רשום הדפסה</button>`}
    ${list.length ? list.map((p) => _t`
      <div class="print-item">
        <div class="ph"><span class="pill ${p.result}">${RESULT[p.result]}</span><span class="when">${fmtDate(p.date)}</span>${p.plateNo ? _t`<span class="badge accent">פלטה ${esc(p.plateNo)}</span>` : ''}${m.versions.length > 1 && p.versionPath ? `<span class="badge">${verName(p.versionPath)}</span>` : ''}${p.source ? `<span class="badge" title="${esc(p.printer || '')}">${p.source === 'cloud' ? _t('מהענן') : _t('מהמדפסת')}</span>` : ''}
          <span class="x"><button class="btn small ghost" data-editprint="${p.id}">ערוך</button><button class="btn small ghost danger" data-delprint="${p.id}">מחק</button></span></div>
        <div class="meta">
          ${p.material ? `<span>${p.color ? `<span class="swatch" style="background:${esc(p.color)}"></span> ` : ''}${esc(p.material)}</span>` : ''}
          ${p.layer ? `<span class="ltr">${esc(p.layer)} mm</span>` : ''}${p.infill ? `<span class="ltr">${esc(p.infill)} infill</span>` : ''}
          ${p.nozzle ? `<span class="ltr">${esc(p.nozzle)}°/${esc(p.bed || '–')}°</span>` : ''}${p.plate ? `<span>${esc(p.plate)}</span>` : ''}
          ${p.minutes ? `<span>${fmtDur(p.minutes * 60)}</span>` : ''}${p.grams ? `<span>${esc(p.grams)} g</span>` : ''}
        </div>
        ${p.notes ? `<div class="pn">${esc(p.notes)}</div>` : ''}
      </div>`).join('') : (S.printForm ? '' : _t('<div class="hint">עוד לא נרשמו הדפסות. אחרי כל הדפסה רושמים אם הצליחה, ובפעם הבאה יודעים בדיוק עם אילו הגדרות זה עבד.</div>'))}`;
}

function defaultsFor(m, path, plateNo) {
  const p = M.rec(path).meta?.print;
  if (!p) return {};
  const f = (p.filaments && p.filaments[0]) || {};
  const bp = plateNo && p.byPlate && p.byPlate[plateNo];
  if (bp) return { ...defaultsFor(m, path), minutes: bp.timeSec ? Math.round(bp.timeSec / 60) : '', grams: bp.grams ? +bp.grams.toFixed(1) : '' };
  return {
    material: [...new Set((p.filaments || []).map((x) => x.type).filter(Boolean))].join(' + '),
    color: f.color || '',
    layer: p.layer || '', infill: p.infill || '', nozzle: p.nozzle || '', bed: p.bed || '', plate: p.plateType || '',
    minutes: p.timeSec ? Math.round(p.timeSec / 60) : '', grams: p.grams ? +p.grams.toFixed(1) : '',
  };
}

function printFormHTML(m) {
  const f = S.printForm;
  const verOpts = m.versions.map((v, i) => `<option value="${esc(v.path)}" ${v.path === f.versionPath ? 'selected' : ''}>v${i + 1} · ${esc(baseName(v.path))}</option>`).join('');
  const lastOk = [...m.prints].filter((p) => p.result === 'ok').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return _t`<div class="print-form" id="pform">
    <div class="field"><label>תוצאה</label><div class="seg" id="pres">${['ok', 'partial', 'fail', 'cancel'].map((r) => `<button data-v="${r}" class="${f.result === r ? 'on' : ''}">${RESULT[r]}</button>`).join('')}</div></div>
    <div class="form-grid">
      <div><label>תאריך</label><input class="inp" type="date" name="date" value="${esc(f.date)}"></div>
      ${m.versions.length > 1 ? _t`<div><label>גרסה</label><select class="inp" name="versionPath">${verOpts}</select></div>` : platesOf(m).length > 1 ? '' : '<div></div>'}
      ${platesOf(m).length > 1 ? _t`<div><label>פלטה</label><select class="inp" name="plateNo">${platesOf(m).map((p) => _t`<option value="${p.id}" ${+f.plateNo === p.id ? 'selected' : ''}>פלטה ${p.id}${p.name ? ` · ${esc(p.name)}` : ''}</option>`).join('')}</select></div>${m.versions.length > 1 ? '<div></div>' : ''}` : ''}
      <div><label>חומר</label><input class="inp" name="material" value="${esc(f.material || '')}" placeholder="PLA, PETG…"></div>
      <div><label>צבע</label><div style="display:flex;gap:6px"><input type="color" name="color" value="${esc(f.color || '#888888')}" style="width:42px;height:36px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2);padding:2px"><input class="inp" name="colorName" value="${esc(f.colorName || '')}" placeholder="שם הצבע"></div></div>
      <div><label>גובה שכבה (mm)</label><input class="inp ltr" name="layer" value="${esc(f.layer || '')}"></div>
      <div><label>מילוי</label><input class="inp ltr" name="infill" value="${esc(f.infill || '')}" placeholder="15%"></div>
      <div><label>נחיר °C</label><input class="inp ltr" name="nozzle" value="${esc(f.nozzle || '')}"></div>
      <div><label>מגש °C</label><input class="inp ltr" name="bed" value="${esc(f.bed || '')}"></div>
      <div><label>פלטה</label><input class="inp" name="plate" value="${esc(f.plate || '')}" placeholder="Textured PEI…"></div>
      <div><label>זמן (דקות)</label><input class="inp ltr" name="minutes" type="number" min="0" value="${esc(f.minutes || '')}"></div>
      <div><label>משקל (g)</label><input class="inp ltr" name="grams" type="number" min="0" step="0.1" value="${esc(f.grams || '')}"></div>
      <div></div>
      <div class="full"><label>הערות</label><textarea class="notes" name="notes" rows="3" placeholder="מה עבד, מה לא, מה לשנות בפעם הבאה">${esc(f.notes || '')}</textarea></div>
    </div>
    <div class="autofill">${M.rec(f.versionPath).meta?.print ? _t`<button class="btn small" id="fillfile">מלא מהקובץ</button>` : ''}${lastOk ? _t`<button class="btn small" id="filllast">העתק מההדפסה המוצלחת האחרונה</button>` : ''}</div>
    <div class="actions"><button class="btn primary" id="psave">${f.id ? _t('שמור שינויים') : _t('שמור הדפסה')}</button><button class="btn" id="pcancel">ביטול</button></div>
  </div>`;
}

function versionsTab(m) {
  return _t`
    <div class="hint">גרסאות הן קבצים שונים של אותו מודל (למשל אחרי תיקון). לחיצה על גרסה מציגה אותה. אפשר גם לגרור קובץ לחלון כדי להוסיף גרסה.</div>
    <label class="btn small" style="margin-bottom:12px">${I.plus}הוסף גרסה חדשה מקובץ<input type="file" id="addver" accept=".stl,.3mf" hidden></label>
    ${[...m.versions].map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
      const url = lib.thumbURLs.get(v.path);
      const rec = M.rec(v.path);
      const prints = m.prints.filter((p) => p.versionPath === v.path);
      const ok = prints.filter((p) => p.result === 'ok').length;
      return _t`<div class="ver ${v.path === S.viewPath ? 'viewing' : ''}" data-view="${esc(v.path)}">
        ${url ? `<img src="${url}" alt="">` : `<div class="vt" data-thumb="${esc(v.path)}"></div>`}
        <div class="vi">
          <div class="vn">v${i + 1}${v.path === M.cur(m).path ? _t('<span class="badge accent">נוכחית</span>') : ''}${rec.missing ? _t('<span class="badge" style="color:var(--fail)">חסר</span>') : ''}${prints.length ? _t`<span class="badge">${ok}/${prints.length} הצליחו</span>` : ''}</div>
          <div class="vp mono" title="${esc(v.path)}">${esc(dispPath(v.path))} · ${rec.size ? fmtBytes(rec.size) : ''} · ${rec.mtime ? fmtDate(rec.mtime) : ''}</div>
          <input data-vnote="${esc(v.path)}" value="${esc(v.note || '')}" placeholder="מה השתנה בגרסה הזו?">
        </div>
        <div class="va">
          ${v.path !== M.cur(m).path ? _t`<button class="btn small" data-setcur="${esc(v.path)}">קבע כנוכחית</button>` : ''}
          ${m.versions.length > 1 ? _t`<button class="btn small ghost" data-split="${esc(v.path)}">הפרד</button>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

function bindInfo(m) {
  const info = $('#info');
  info.onclick = async (e) => {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { S.tab = tab.dataset.tab; S.scrollReset = true; renderInfo(); return; }
    if (t.closest('#mfav')) { m.favorite = !m.favorite; M.touch(m); renderInfo(); return; }
    if (t.closest('#copypath')) { navigator.clipboard?.writeText(lib.root.name + '/' + S.viewPath).then(() => toast(_t('הנתיב הועתק'))); return; }
    const rm = t.closest('[data-rmtag]');
    if (rm) { m.tags = m.tags.filter((x) => x !== rm.dataset.rmtag); M.touch(m); renderInfo(); return; }
    if (t.closest('#dl')) { downloadFile(S.viewPath); return; }
    if (t.closest('#toarchive')) { archiveModels([m]); return; }
    if (t.closest('#restore')) { restoreModel(m); return; }
    if (t.closest('#logprint') || t.closest('#newprint')) { startPrintForm(m); return; }
    const ep = t.closest('[data-editprint]');
    if (ep) { const p = m.prints.find((x) => x.id === ep.dataset.editprint); S.printForm = { ...p }; S.tab = 'prints'; S.scrollReset = true; renderInfo(); return; }
    const dp = t.closest('[data-delprint]');
    if (dp) {
      const ok = await dialog(_t('למחוק את רישום ההדפסה?'), '', [{ label: _t('מחק'), value: true, danger: true }, { label: _t('ביטול'), value: false }]);
      if (ok) { m.prints = m.prints.filter((x) => x.id !== dp.dataset.delprint); M.touch(m); renderInfo(); }
      return;
    }
    const seg = t.closest('#pres button');
    if (seg) { collectForm(); S.printForm.result = seg.dataset.v; renderInfo(); return; }
    if (t.closest('#fillfile')) { collectForm(); Object.assign(S.printForm, defaultsFor(m, S.printForm.versionPath)); renderInfo(); return; }
    if (t.closest('#filllast')) {
      collectForm();
      const last = [...m.prints].filter((p) => p.result === 'ok').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const { id, date, result, at, notes, ...rest } = last;
      Object.assign(S.printForm, rest);
      renderInfo();
      return;
    }
    if (t.closest('#pcancel')) { S.printForm = null; renderInfo(); return; }
    if (t.closest('#psave')) { savePrint(m); return; }
    const sc = t.closest('[data-setcur]');
    if (sc) { e.stopPropagation(); m.current = sc.dataset.setcur; M.touch(m); renderInfo(); toast(_t('הגרסה הנוכחית עודכנה')); return; }
    const sp = t.closest('[data-split]');
    if (sp) {
      e.stopPropagation();
      splitVersion(m, sp.dataset.split);
      return;
    }
    const vw = t.closest('[data-view]');
    if (vw && !t.closest('input')) { loadView(vw.dataset.view); renderInfo(); }
  };
  const name = $('#mname');
  name.onchange = () => { const v = name.value.trim(); if (v) { m.name = v; m.nameAuto = false; M.touch(m); } };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  const notes = $('#mnotes');
  if (notes) notes.oninput = () => { m.notes = notes.value; M.touch(m); };
  const tagin = $('#tagin');
  if (tagin) {
    tagin.onkeydown = (e) => {
      if ((e.key === 'Enter' || e.key === ',') && tagin.value.trim()) {
        e.preventDefault();
        const tg = tagin.value.trim().replace(/^#/, '');
        if (!m.tags.includes(tg)) m.tags.push(tg);
        M.touch(m);
        renderInfo();
        $('#tagin').focus();
      } else if (e.key === 'Backspace' && !tagin.value && m.tags.length) { m.tags.pop(); M.touch(m); renderInfo(); $('#tagin').focus(); }
    };
    tagin.onchange = () => { // datalist pick
      const tg = tagin.value.trim();
      if (tg && [...$('#alltags').options].some((o) => o.value === tg)) { if (!m.tags.includes(tg)) m.tags.push(tg); M.touch(m); renderInfo(); $('#tagin').focus(); }
    };
  }
  for (const inp of $$('[data-vnote]', info)) inp.oninput = () => { const v = m.versions.find((x) => x.path === inp.dataset.vnote); v.note = inp.value; M.touch(m); };
  const addver = $('#addver');
  if (addver) addver.onchange = () => { const f = addver.files[0]; if (f) addVersion(m, f); };
  const psel = $('#pform [name=plateNo]');
  if (psel) psel.onchange = () => { collectForm(); const d = defaultsFor(m, S.printForm.versionPath, +psel.value); S.printForm.minutes = d.minutes ?? S.printForm.minutes; S.printForm.grams = d.grams ?? S.printForm.grams; renderInfo(); };
  const vsel = $('#pform [name=versionPath]');
  if (vsel) vsel.onchange = () => { collectForm(); renderInfo(); };
  for (const p of $$('[data-thumb]', info)) refreshThumb(p.dataset.thumb);
}

function startPrintForm(m) {
  const vp = S.viewPath || M.cur(m).path;
  const plates = platesOf(m);
  const pst = plateStatus(m);
  const plateNo = plates.length > 1 ? (S.viewPlate && plates.some((p) => p.id === S.viewPlate) ? S.viewPlate : (plates.find((p) => pst[p.id] !== 'ok') || plates[0]).id) : '';
  S.printForm = { id: null, date: todayISO(), result: 'ok', versionPath: vp, plateNo, ...defaultsFor(m, vp, plateNo) };
  S.tab = 'prints';
  S.scrollReset = true;
  renderInfo();
}
function collectForm() {
  const f = $('#pform');
  if (!f || !S.printForm) return;
  for (const el of $$('[name]', f)) S.printForm[el.name] = el.value;
  if (S.printForm.color === '#888888' && !S.printForm.colorName) S.printForm.color = S.printForm.color;
}
function savePrint(m) {
  collectForm();
  const f = S.printForm;
  const rec = { ...f, minutes: f.minutes ? +f.minutes : '', grams: f.grams ? +f.grams : '', plateNo: f.plateNo ? +f.plateNo : '' };
  if (!rec.versionPath) rec.versionPath = M.cur(m).path;
  if (f.id) {
    const i = m.prints.findIndex((p) => p.id === f.id);
    m.prints[i] = rec;
  } else {
    rec.id = uid();
    rec.at = new Date().toISOString();
    m.prints.push(rec);
  }
  S.printForm = null;
  M.touch(m);
  renderInfo();
  toast(rec.result === 'ok' ? _t('נרשמה הדפסה מוצלחת') : _t('ההדפסה נרשמה'));
}

async function addVersion(m, file) {
  if (!fileKind(file.name)) { toast(_t('אפשר להוסיף רק STL או 3MF'), true); return; }
  const cur = M.cur(m).path;
  const dir = dirName(cur);
  const kindExt = /\.gcode\.3mf$/i.test(file.name) ? '.gcode.3mf' : file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const stem = stripExt(baseName(cur)).replace(/[_ -]v\d+$/i, '');
  const name = `${stem}_v${m.versions.length + 1}${kindExt}`;
  try {
    const r = await lib.importFile(file, dir, name);
    lib.data.files[r.path] = { size: r.size, mtime: r.mtime };
    m.versions.push({ path: r.path, added: new Date().toISOString(), note: '' });
    m.current = r.path;
    M.touch(m);
    toast(_t`נוספה גרסה v${m.versions.length}: ${baseName(r.path)}`);
    S.tab = 'versions';
    await rescan(false);
    if (S.open === m.id) { S.viewPath = r.path; renderInfo(); loadView(r.path); }
  } catch (e) { toast(_t('הוספת הגרסה נכשלה: ') + e.message, true); }
}

function splitVersion(m, path) {
  const v = m.versions.find((x) => x.path === path);
  m.versions = m.versions.filter((x) => x.path !== path);
  if (m.current === path) m.current = m.versions[m.versions.length - 1].path;
  const id = uid();
  const now = new Date().toISOString();
  const moved = m.prints.filter((p) => p.versionPath === path);
  m.prints = m.prints.filter((p) => p.versionPath !== path);
  lib.data.models[id] = { id, name: prettyName(baseName(path)), nameAuto: true, tags: [...m.tags], notes: '', favorite: false, current: path, versions: [v], prints: moved, created: now, updated: now };
  M.touch(m);
  toast(_t('הגרסה הופרדה למודל נפרד'));
  if (S.viewPath === path) loadView(M.cur(m).path);
  renderInfo();
}

async function downloadFile(path) {
  try {
    const f = await lib.getFile(path);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await toBlob(f));
    a.download = baseName(path);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch (e) { toast(_t('ההורדה נכשלה: ') + e.message, true); }
}

/* ================= go ================= */
try { const t = localStorage.getItem('shelf-theme'); if (t) document.documentElement.dataset.theme = t; } catch { }
window.addEventListener('error', (e) => console.error(e.error || e.message));
boot();
window.__shelf = { S, get lib() { return lib; } };
