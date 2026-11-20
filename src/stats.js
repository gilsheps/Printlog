// Statistics view: cost + usage over the print history, and the price settings it needs.
// Pure web (no Electron APIs): the app passes in the prints, the saved settings and a save callback.
import { _t, loc } from './i18n.js';
import { costOfPrint, summarize, activityHeatmap, timeAccuracy, perKg, normType, normColor, monthKey } from '../app/cost.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_WATTS = 120; // P2S average draw
const STALE_MS = 182 * 864e5; // electricity price older than ~6 months
const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'PLN', 'INR'];
const TYPES = ['PLA', 'PLA-CF', 'PETG', 'PETG-CF', 'ABS', 'ASA', 'TPU', 'PA', 'PA-CF', 'PC', 'PVA', 'HIPS'];

// view state survives re-renders (the app re-renders the grid often)
const V = { range: 'all', printer: '', priceOpen: false, draft: null, error: '', badRow: -1 };
const fmtMin = (m) => { m = Math.round(+m || 0); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };

export const costSettings = (opts) => ({
  filamentPrices: Array.isArray(opts && opts.filamentPrices) ? opts.filamentPrices : [],
  electricity: { watts: DEFAULT_WATTS, ...((opts && opts.electricity) || {}) },
  currency: (opts && opts.currency) || 'ILS',
});
export const hasPrices = (st) => !!(st.filamentPrices.length || st.electricity.pricePerKwh);

let CUR = 'ILS'; // currency of the last rendered stats view (money() default)
// amount in the user's currency; 2 decimals under 100, whole numbers above
export const money = (n, digits, currency = CUR) => {
  const v = +n || 0;
  const d = digits != null ? digits : Math.abs(v) >= 100 ? 0 : 2;
  try { return new Intl.NumberFormat(loc(), { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v); } catch { return currency + ' ' + v.toFixed(d); }
};
const curSymbol = (currency = CUR) => { try { return new Intl.NumberFormat(loc(), { style: 'currency', currency }).formatToParts(0).find((x) => x.type === 'currency').value; } catch { return currency; } };

// short cost text for a print card / history row ('' when prices aren't set or nothing is known)
export function printCostText(print, opts) {
  const st = costSettings(opts);
  if (!hasPrices(st)) return '';
  const c = costOfPrint(print, st);
  if (c.noData && !c.total) return '';
  const m = money(c.total, null, st.currency);
  // part of the filament has no price or no weight: the real cost is at least this
  return c.noData || c.unpriced.length ? _t`לפחות ${m}` : m;
}
const num = (n, d = 0) => { try { return new Intl.NumberFormat(loc(), { maximumFractionDigits: d }).format(+n || 0); } catch { return String(n); } };
const monthLabel = (k, withYear) => { const [y, m] = k.split('-').map(Number); try { return new Date(y, m - 1, 1).toLocaleDateString(loc(), withYear ? { month: 'short', year: '2-digit' } : { month: 'short' }); } catch { return k; } };
const dateLabel = (iso) => { try { return new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
// readable text on top of a filament color
const lightHex = (hex) => { const h = normColor(hex); if (!h) return false; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.299 * r + 0.587 * g + 0.114 * b > 186; };

function inRange(p, range) {
  if (range === 'all') return true;
  const t = Date.parse(p.end || p.start || '') || 0;
  if (!t) return false;
  const now = new Date();
  if (range === 'year') return new Date(t).getFullYear() === now.getFullYear();
  return t >= now.getTime() - +range * 864e5;
}

// every month between the first and last key, so empty months still show as gaps
function monthSpan(keys) {
  const ks = keys.filter(Boolean).sort();
  if (!ks.length) return [];
  const out = [];
  const last = ks[ks.length - 1];
  // at most the last 24 months, counted back from the newest (one bogus old date can't push them out)
  let [y, m] = last.split('-').map(Number);
  m -= 23; while (m < 1) { m += 12; y--; }
  const from = `${y}-${String(m).padStart(2, '0')}`;
  if (ks[0] > from) [y, m] = ks[0].split('-').map(Number);
  for (let i = 0; i < 240; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= last) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// one column chart: months along the reading direction, stacked segments per month
function columns(months, segs, fmt, fixedMax) {
  const max = fixedMax || Math.max(1e-9, ...months.map((k) => segs.reduce((a, s) => a + (s.get(k) || 0), 0)));
  const step = Math.max(1, Math.ceil(months.length / (fixedMax === 100 || segs.length === 1 ? 7 : 14)));
  return `<div class="st-cols">${months.map((k, i) => {
    const tot = segs.reduce((a, s) => a + (s.get(k) || 0), 0);
    const parts = segs.map((s) => { const v = s.get(k) || 0; return v ? `<span class="st-seg ${s.cls}" style="height:${(v / max) * 100}%" title="${esc(s.label + ': ' + fmt(v))}"></span>` : ''; }).join('');
    return `<div class="st-col" title="${esc(monthLabel(k, true) + ' · ' + fmt(tot))}"><div class="st-bar">${parts}</div><span class="st-x">${(months.length - 1 - i) % step ? '' : i === 0 || k.endsWith('-01') || step > 1 ? monthLabel(k, true) : monthLabel(k)}</span></div>`;
  }).join('')}</div>`;
}

// horizontal bars: rows of { label, value, text, color? }
function bars(rows, opts = {}) {
  if (!rows.length) return `<div class="st-none">${_t('אין נתונים')}</div>`;
  const max = opts.max || Math.max(1e-9, ...rows.map((r) => r.value));
  return `<div class="st-hbars">${rows.map((r) => `<div class="st-hrow" title="${esc(r.title || r.label + ' · ' + r.text)}">
    <span class="st-hl">${r.swatch ? `<span class="swatch" style="background:#${esc(r.swatch)}"></span>` : ''}<bdi>${esc(r.label)}</bdi></span>
    <span class="st-ht"><span class="st-hf ${opts.cls || ''}" style="width:${Math.max(2, (r.value / max) * 100)}%;${r.swatch ? `background:#${esc(r.swatch)};${lightHex(r.swatch) ? 'box-shadow:inset 0 0 0 1px var(--line2)' : ''}` : ''}"></span></span>
    <span class="st-hv ltr">${esc(r.text)}</span></div>`).join('')}</div>`;
}

function heatmap(grid) {
  const max = Math.max(1, ...grid.flat());
  const days = [...Array(7)].map((_, d) => { try { return new Date(2024, 0, 7 + d).toLocaleDateString(loc(), { weekday: 'short' }); } catch { return String(d); } });
  const hours = [...Array(24)].map((_, h) => `<span class="st-hh">${h % 3 === 0 ? h : ''}</span>`).join('');
  return `<div class="st-heat"><span></span>${hours}${grid.map((row, d) => `<span class="st-hd">${esc(days[d])}</span>${row.map((v, h) => `<span class="st-hc" style="--a:${v ? 0.15 + 0.85 * (v / max) : 0}" title="${esc(`${days[d]} ${String(h).padStart(2, '0')}:00 · ${v}`)}"></span>`).join('')}`).join('')}</div>`;
}

function topModels(list, costOf) {
  const g = new Map();
  for (const p of list) {
    const name = p.design || p.title || '';
    if (!name) continue;
    const k = name.trim().toLowerCase().replace(/[_\s]+/g, ' ');
    const it = g.get(k) || { name, count: 0, cost: 0 };
    it.count++; it.cost += costOf(p);
    g.set(k, it);
  }
  return [...g.values()];
}

function priceRow(r, i) {
  const anyColor = !normColor(r.color);
  const spool = r.unit === 'spool' || (r.unit == null && +r.spoolPrice > 0);
  return `<div class="st-prow ${i === V.badRow ? 'bad' : ''}" data-row="${i}">
    <input class="st-in" data-f="type" list="st-types" value="${esc(r.type || '')}" placeholder="${esc(_t('סוג'))}" aria-label="${esc(_t('סוג'))}">
    <input class="st-in" data-f="brand" value="${esc(r.brand || '')}" placeholder="${esc(_t('מותג (לא חובה)'))}" aria-label="${esc(_t('מותג'))}">
    <span class="st-color"><input type="color" data-f="color" value="#${esc(normColor(r.color) || '888888')}" ${anyColor ? 'disabled' : ''} aria-label="${esc(_t('צבע'))}">
      <label class="chk" style="margin:0"><input type="checkbox" data-f="any" ${anyColor ? 'checked' : ''}> ${_t('כל הצבעים')}</label></span>
    <span class="st-price">
      <input class="st-in st-num ltr" data-f="price" type="number" min="0" step="0.5" value="${esc(spool ? r.spoolPrice ?? '' : r.pricePerKg ?? '')}" placeholder="${esc(curSymbol())}" aria-label="${esc(_t('מחיר'))}">
      <select class="sel" data-f="unit" aria-label="${esc(_t('מחיר עבור'))}"><option value="kg" ${spool ? '' : 'selected'}>${_t('לק"ג')}</option><option value="spool" ${spool ? 'selected' : ''}>${_t('לסליל')}</option></select>
      <input class="st-in st-num ltr" data-f="spoolGrams" type="number" min="1" step="50" value="${esc(r.spoolGrams || 1000)}" ${spool ? '' : 'hidden'} title="${esc(_t('משקל הסליל (גרם)'))}" aria-label="${esc(_t('משקל הסליל (גרם)'))}"><span class="st-g" ${spool ? '' : 'hidden'}>g</span>
    </span>
    <button class="btn small ghost" data-del="${i}" title="${esc(_t('מחק'))}">✕</button>
  </div>`;
}

function pricePanel(settings, unpriced, knownTypes) {
  const e = settings.electricity;
  const d = V.draft || (V.draft = { prices: settings.filamentPrices.map((p) => ({ ...p, unit: +p.spoolPrice > 0 ? 'spool' : 'kg' })), currency: settings.currency, kwh: e.pricePerKwh ?? '', watts: e.watts ?? DEFAULT_WATTS });
  const checked = e.checkedAt ? Date.parse(e.checkedAt) : 0;
  const types = [...new Set([...TYPES, ...knownTypes])];
  return `<details class="st-card st-prices" ${V.priceOpen ? 'open' : ''}>
    <summary><b>${_t('הגדרות מחיר')}</b> <span class="hint" style="display:inline;margin:0">${_t`${settings.filamentPrices.length} מחירי פילמנט`}${e.pricePerKwh ? ' · ' + money(e.pricePerKwh, 2) + _t('/קוט"ש') : ''}</span></summary>
    <datalist id="st-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="hint">${_t('המחיר נקבע לפי סוג וצבע. Bambu לא שומרים מותג, אז המותג הוא רק תווית בשבילך. שורה עם "כל הצבעים" חלה על כל צבע של אותו סוג שאין לו מחיר משלו.')}</div>
    <div class="st-plist">${d.prices.map(priceRow).join('') || `<div class="st-none">${_t('עוד אין מחירים')}</div>`}</div>
    <button class="btn small" data-addprice>${_t('+ הוסף פילמנט')}</button>
    ${unpriced.length ? `<div class="st-unpriced"><span class="hint" style="margin:0">${_t('פילמנט בלי מחיר:')}</span>${unpriced.map((u) => `<button class="btn small ghost" data-addfor="${esc(u.type)}|${esc(u.color)}">${u.color ? `<span class="swatch" style="background:#${esc(u.color)}"></span>` : ''}${esc(u.type)} · ${_t('הוסף מחיר')}</button>`).join('')}</div>` : ''}
    <label class="st-cur">${_t('מטבע')} <select class="sel" id="st-currency">${[...new Set([d.currency, ...CURRENCIES])].map((c) => `<option value="${esc(c)}" ${c === d.currency ? 'selected' : ''}>${esc(c)} · ${esc(curSymbol(c))}</option>`).join('')}</select></label>
    <h4 class="st-h">${_t('חשמל')}</h4>
    <div class="st-elec">
      <label>${_t('מחיר לקוט"ש')} (${esc(curSymbol(d.currency))}) <input class="st-in st-num ltr" id="st-kwh" type="number" min="0" step="0.01" value="${esc(d.kwh)}"></label>
      <label>${_t('צריכה ממוצעת של המדפסת (ואט)')} <input class="st-in st-num ltr" id="st-watts" type="number" min="0" step="5" value="${esc(d.watts)}"></label>
    </div>
    ${checked ? `<div class="hint">${_t`עודכן: ${dateLabel(e.checkedAt)}`}${Date.now() - checked > STALE_MS ? ` · <span class="st-stale">${_t('כדאי לוודא שהמחיר עדכני')}</span>` : ''}</div>` : ''}
    <div class="hint">${_t('העלות מחושבת לפי המחירים הנוכחיים על כל ההיסטוריה.')}</div>
    ${V.error ? `<div class="st-err">${esc(V.error)}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn small primary" data-saveprices>${_t('שמור מחירים')}</button><button class="btn small ghost" data-resetprices>${_t('בטל שינויים')}</button></div>
  </details>`;
}

// read the editor's inputs back into the draft (so a re-render keeps what was typed)
function readDraft(root) {
  if (!V.draft) return;
  V.draft.prices = [...root.querySelectorAll('.st-prow')].map((row) => {
    const f = (n) => row.querySelector(`[data-f="${n}"]`);
    const any = f('any').checked;
    const price = f('price').value === '' ? '' : +f('price').value;
    const unit = f('unit').value;
    const base = { type: normType(f('type').value), brand: f('brand').value.trim(), color: any ? '' : '#' + normColor(f('color').value), unit };
    return unit === 'spool' ? { ...base, spoolPrice: price, spoolGrams: +f('spoolGrams').value || 0, pricePerKg: price === '' || !(+f('spoolGrams').value > 0) ? '' : perKg({ spoolPrice: price, spoolGrams: +f('spoolGrams').value }) } : { ...base, pricePerKg: price };
  });
  const cur = root.querySelector('#st-currency');
  if (cur) V.draft.currency = cur.value;
  const k = root.querySelector('#st-kwh'), w = root.querySelector('#st-watts');
  if (k) V.draft.kwh = k.value;
  if (w) V.draft.watts = w.value;
}

/**
 * Render the statistics view into `el`.
 * ctx = { prints, options, printers: {serial: {name}}, save: async (patch) => void }
 */
export function renderStats(el, ctx) {
  // an outside re-render (sync update) must not lose what is being typed in the price editor
  const old = el.querySelector('.stats-view');
  if (!old) V.draft = null; // entering the view: start from the saved prices
  if (old && !ctx.internal) {
    readDraft(old);
    const f = document.activeElement;
    if (f && old.contains(f) && f.matches('input, select')) return;
  }
  const rerender = () => renderStats(el, { ...ctx, internal: true });
  const settings = costSettings(ctx.options);
  CUR = settings.currency;
  const all = (ctx.prints || []).filter((p) => p && p.key && p.result !== 'running');
  const printers = new Map();
  for (const p of all) if (p.serial) printers.set(p.serial, (ctx.printers && ctx.printers[p.serial] && ctx.printers[p.serial].name) || p.printer || p.serial);
  if (V.printer && !printers.has(V.printer)) V.printer = '';
  const filter = (p) => inRange(p, V.range) && (!V.printer || p.serial === V.printer);
  const list = all.filter(filter);
  const s = summarize(list, settings);
  const unpriced = Object.values(s.unpriced).filter((u) => u.type && u.type !== '—');
  const knownTypes = [...new Set(all.flatMap((p) => (p.filaments || []).map((f) => normType(f.type)).filter(Boolean)))];

  // per month: success rate and hours (summarize has cost per month)
  const okM = new Map(), cntM = new Map(), hrsM = new Map(), filM = new Map(), powM = new Map();
  for (const p of list) {
    const k = monthKey(p.end || p.start); if (!k) continue;
    cntM.set(k, (cntM.get(k) || 0) + 1);
    if (p.result === 'ok') okM.set(k, (okM.get(k) || 0) + 1);
    hrsM.set(k, (hrsM.get(k) || 0) + (+p.minutes || 0) / 60);
  }
  for (const [k, b] of Object.entries(s.byMonth)) { filM.set(k, b.filament); powM.set(k, b.power); }
  const months = monthSpan([...cntM.keys()]);
  const rateM = new Map(months.filter((k) => cntM.get(k)).map((k) => [k, Math.round(((okM.get(k) || 0) / cntM.get(k)) * 100)]));

  const byPrinter = new Map();
  for (const p of list) { const n = printers.get(p.serial) || p.printer || '—'; byPrinter.set(n, (byPrinter.get(n) || 0) + (+p.minutes || 0) / 60); }
  const costs = new Map(list.map((p) => [p, costOfPrint(p, settings).total]));
  const tops = topModels(list, (p) => costs.get(p) || 0);
  const priced = hasPrices(settings);
  const ta = timeAccuracy(list);
  const printName = (p) => p.design || p.title || '—';
  const printTitle = (p) => `${printName(p)} · ${dateLabel(p.end || p.start)}`;
  const costly = priced ? list.map((p) => ({ p, c: costs.get(p) || 0 })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 8) : [];
  const longest = list.filter((p) => +p.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const rateTypes = Object.entries(s.rateByType).sort((a, b) => b[1].count - a[1].count).slice(0, 10);

  const card = (v, l, cls = '') => `<div class="st-kpi ${cls}"><b><bdi>${v}</bdi></b><span>${l}</span></div>`;
  const sel = (id, opts, cur) => `<select class="sel" id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const legend = (items) => `<div class="st-legend">${items.map(([cls, l]) => `<span><i class="${cls}"></i>${l}</span>`).join('')}</div>`;

  el.innerHTML = `<div class="stats-view" style="grid-column:1/-1">
    <div class="st-filters">
      ${sel('st-range', [['all', _t('כל הזמן')], ['30', _t('30 ימים אחרונים')], ['90', _t('3 חודשים אחרונים')], ['365', _t('12 חודשים אחרונים')], ['year', _t('השנה')]], V.range)}
      ${printers.size > 1 ? sel('st-printer', [['', _t('כל המדפסות')], ...[...printers.entries()]], V.printer) : ''}
    </div>
    ${pricePanel(settings, unpriced, knownTypes)}
    ${!list.length ? `<div class="empty"><b>${_t('אין הדפסות בטווח הזה')}</b>${_t('נסה טווח זמן אחר.')}</div>` : `
    ${!priced ? `<div class="st-note">${_t('כדי לראות עלויות, הוסף מחירי פילמנט וחשמל ב„הגדרות מחיר”.')} <button class="btn small" data-openprices>${_t('הגדר מחירים')}</button></div>` : ''}
    <div class="st-kpis">
      ${card(num(s.count), _t('הדפסות'))}
      ${card(s.successRate + '%', _t('הצליחו'), 'ok')}
      ${card(money(s.total), _t('עלות כוללת'))}
      ${card(money(s.wasted), _t('בזבוז על הדפסות שלא הצליחו'), 'fail')}
      ${card(num(s.grams / 1000, 2) + ' kg', _t('פילמנט'))}
      ${card(num(s.minutes / 60), _t('שעות הדפסה'))}
    </div>
    ${s.noData ? `<div class="hint st-nodata">${_t`ל-${num(s.noData)} הדפסות אין נתוני משקל (ללא נתונים). הן לא נספרות בפילמנט ובעלות הפילמנט, ולכן הסכומים בפועל גבוהים יותר.`}</div>` : ''}
    <div class="st-grid">
      <div class="st-card st-wide"><h4 class="st-h">${_t('עלות לפי חודש')}</h4>
        ${legend([['st-seg fil', _t('פילמנט')], ['st-seg pow', _t('חשמל')]])}
        ${columns(months, [{ get: (k) => filM.get(k), cls: 'fil', label: _t('פילמנט') }, { get: (k) => powM.get(k), cls: 'pow', label: _t('חשמל') }], (v) => money(v))}</div>
      <div class="st-card"><h4 class="st-h">${_t('פילמנט לפי סוג')}</h4>
        ${bars(Object.entries(s.byType).sort((a, b) => b[1].grams - a[1].grams).map(([t, v]) => ({ label: t, value: v.grams, text: `${num(v.grams)} g${v.cost ? ' · ' + money(v.cost) : ''}` })))}</div>
      <div class="st-card"><h4 class="st-h">${_t('פילמנט לפי צבע')}</h4>
        ${bars(Object.entries(s.byColor).sort((a, b) => b[1].grams - a[1].grams).slice(0, 12).map(([c, v]) => ({ label: c ? '#' + c : _t('צבע לא ידוע'), swatch: c, value: v.grams, text: `${num(v.grams)} g${v.cost ? ' · ' + money(v.cost) : ''}` })))}</div>
      <div class="st-card"><h4 class="st-h">${_t('אחוז הצלחה לפי חודש')}</h4>
        ${columns(months, [{ get: (k) => rateM.get(k), cls: 'rate', label: _t('הצליחו') }], (v) => Math.round(v) + '%', 100)}</div>
      <div class="st-card"><h4 class="st-h">${_t('שעות הדפסה לפי חודש')}</h4>
        ${columns(months, [{ get: (k) => hrsM.get(k), cls: 'hrs', label: _t('שעות') }], (v) => num(v, 1) + ' h')}
        ${byPrinter.size > 1 ? `<h4 class="st-h" style="margin-top:14px">${_t('לפי מדפסת')}</h4>${bars([...byPrinter.entries()].sort((a, b) => b[1] - a[1]).map(([n, h]) => ({ label: n, value: h, text: num(h, 1) + ' h' })), { cls: 'hrs' })}` : ''}</div>
      <div class="st-card"><h4 class="st-h">${_t('הכי מודפסים')}</h4>
        ${bars(tops.sort((a, b) => b.count - a.count).slice(0, 8).map((m) => ({ label: m.name, value: m.count, text: _t`${m.count} פעמים` })))}</div>
      <div class="st-card"><h4 class="st-h">${_t('הכי יקרים')}</h4>
        ${priced ? bars(tops.filter((m) => m.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 8).map((m) => ({ label: m.name, value: m.cost, text: money(m.cost) }))) : `<div class="st-none">${_t('צריך להגדיר מחירים')}</div>`}</div>
      <div class="st-card"><h4 class="st-h">${_t('ההדפסות הכי יקרות')}</h4>
        ${priced ? bars(costly.map(({ p, c }) => ({ label: printName(p), title: printTitle(p) + ' · ' + money(c), value: c, text: money(c) }))) : `<div class="st-none">${_t('צריך להגדיר מחירים')}</div>`}</div>
      <div class="st-card"><h4 class="st-h">${_t('ההדפסות הכי ארוכות')}</h4>
        ${bars(longest.map((p) => ({ label: printName(p), title: printTitle(p) + ' · ' + fmtMin(p.minutes), value: +p.minutes, text: fmtMin(p.minutes) })), { cls: 'hrs' })}</div>
      <div class="st-card"><h4 class="st-h">${_t('אחוז הצלחה לפי סוג פילמנט')}</h4>
        ${bars(rateTypes.map(([t, r]) => ({ label: t, value: r.rate, text: `${r.rate}% · ${r.ok}/${r.count}` })), { cls: 'rate', max: 100 })}</div>
      <div class="st-card st-wide"><h4 class="st-h">${_t('זמן משוער מול זמן בפועל')}</h4>
        ${ta.count ? `<div class="st-accw"><div class="st-acc"><b><bdi>${ta.diffPct > 0 ? '+' : ''}${ta.diffPct}%</bdi></b><span>${ta.diffPct > 0 ? _t`ההדפסות לקחו בממוצע ${Math.abs(ta.diffPct)}% יותר מהמשוער` : ta.diffPct < 0 ? _t`ההדפסות לקחו בממוצע ${Math.abs(ta.diffPct)}% פחות מהמשוער` : _t('ההדפסות לקחו בממוצע בדיוק את הזמן המשוער')}</span><span class="hint" style="margin:0">${_t`לפי ${ta.count} הדפסות שהצליחו · משוער ${fmtMin(ta.est)} · בפועל ${fmtMin(ta.actual)}`}</span></div>
        <div><h4 class="st-h">${_t('הפערים הגדולים')}</h4>
        ${bars(ta.prints.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5).map((r) => ({ label: printName(r.print), title: printTitle(r.print) + ' · ' + fmtMin(r.est) + ' → ' + fmtMin(r.actual), value: Math.abs(r.diff), text: (r.diff > 0 ? '+' : '−') + fmtMin(Math.abs(r.diff)) })))}</div></div>` : `<div class="st-none">${_t('אין הדפסות עם זמן משוער')}</div>`}</div>
      <div class="st-card st-wide"><h4 class="st-h">${_t('מתי מדפיסים (יום ושעה)')}</h4>${heatmap(activityHeatmap(list))}</div>
    </div>`}
  </div>`;

  const root = el.querySelector('.stats-view');
  const details = root.querySelector('.st-prices');
  details.addEventListener('toggle', () => { V.priceOpen = details.open; });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'st-range') { V.range = t.value; readDraft(root); rerender(); return; }
    if (t.id === 'st-printer') { V.printer = t.value; readDraft(root); rerender(); return; }
    if (t.dataset.f === 'unit') { const row = t.closest('.st-prow'); for (const x of row.querySelectorAll('[data-f="spoolGrams"], .st-g')) x.hidden = t.value !== 'spool'; return; }
    if (t.dataset.f === 'any') { const c = t.closest('.st-prow').querySelector('[data-f="color"]'); c.disabled = t.checked; }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-openprices')) { V.priceOpen = true; details.open = true; details.scrollIntoView({ block: 'nearest' }); return; }
    if (t.hasAttribute('data-addprice') || t.dataset.addfor != null) {
      readDraft(root);
      const [type, color] = t.dataset.addfor != null ? t.dataset.addfor.split('|') : ['', ''];
      V.draft.prices.push({ type, brand: '', color: color ? '#' + color : '', pricePerKg: '' });
      V.priceOpen = true; rerender();
      const rows = el.querySelectorAll('.st-prow'); const last = rows[rows.length - 1];
      if (last) last.querySelector(type ? '[data-f="price"]' : '[data-f="type"]').focus();
      return;
    }
    if (t.dataset.del != null) { readDraft(root); V.draft.prices.splice(+t.dataset.del, 1); V.badRow = -1; V.error = ''; rerender(); return; }
    if (t.hasAttribute('data-resetprices')) { V.draft = null; V.error = ''; V.badRow = -1; rerender(); return; }
    if (t.hasAttribute('data-saveprices')) {
      readDraft(root);
      const d = V.draft;
      // a half-filled row is a mistake, not something to drop silently
      const bad = d.prices.findIndex((p) => !p.type || p.pricePerKg === '' || !(+p.pricePerKg >= 0) || (p.unit === 'spool' && !(+p.spoolGrams > 0)));
      if (bad >= 0) { V.error = _t('בכל שורה צריך סוג ומחיר (אפשר למחוק שורה עם ✕)'); V.badRow = bad; rerender(); return; }
      V.error = ''; V.badRow = -1;
      const filamentPrices = d.prices.map((p) => ({ type: p.type, brand: p.brand, color: p.color, pricePerKg: +p.pricePerKg, ...(p.unit === 'spool' ? { spoolPrice: +p.spoolPrice, spoolGrams: +p.spoolGrams } : {}) }));
      const currency = d.currency || 'ILS';
      const kwh = d.kwh === '' || !(+d.kwh >= 0) ? null : +d.kwh;
      const watts = d.watts === '' || !(+d.watts >= 0) ? DEFAULT_WATTS : +d.watts;
      // saving with a price = the user just confirmed it, so it counts as checked today
      const electricity = { pricePerKwh: kwh, watts, checkedAt: kwh != null ? new Date().toISOString() : '' };
      t.disabled = true;
      try { await ctx.save({ filamentPrices, electricity, currency }); ctx.options = { ...(ctx.options || {}), filamentPrices, electricity, currency }; V.draft = null; } catch { return; } finally { t.disabled = false; }
      rerender();
    }
  });
}
