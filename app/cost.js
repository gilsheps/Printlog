// Pure filament + electricity cost model for PrintLog.
// No I/O and no Electron deps, so it is unit-testable and can be reused as-is in
// a future mobile (Capacitor) build. All money is in the user's currency (₪),
// taken from settings the user enters; Bambu's own prices are never used.
//
// A print record (from engine.js) carries:
//   { result, minutes, grams, filaments: [{ type, color /* #RRGGBB */, grams }], start, end }
// settings:
//   { filamentPrices: [{ type, brand, color /* #RRGGBB */, pricePerKg }],
//     electricity: { pricePerKwh, watts } }

const round2 = (n) => Math.round((+n || 0) * 100) / 100;

const normType = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
// → 6 upper-hex, no '#'; '' when unknown.
const normColor = (c) => {
  const h = String(c || '').replace('#', '').toUpperCase();
  return h.length >= 6 ? h.slice(0, 6) : '';
};

// Price (₪/kg) for one filament. Bambu print data has no brand, so matching is
// by type + color only; brand is a user label for telling same-color spools
// apart. Prefers an exact type+color entry, then a color-less "type-wide" entry.
// Returns { pricePerKg, entry } or null.
function priceFor(fil, prices) {
  const t = normType(fil && fil.type);
  const c = normColor(fil && fil.color);
  const list = Array.isArray(prices) ? prices : [];
  let best = c && list.find((p) => normType(p.type) === t && normColor(p.color) === c);
  if (!best) best = list.find((p) => normType(p.type) === t && !normColor(p.color));
  return best ? { pricePerKg: perKg(best), entry: best } : null;
}

// ₪/kg of a price entry: entered per kg, or as a spool price + spool weight (grams)
function perKg(e) {
  if (!e) return 0;
  if (+e.spoolPrice > 0 && +e.spoolGrams > 0) return (+e.spoolPrice / +e.spoolGrams) * 1000;
  return +e.pricePerKg || 0;
}

// grams of filament a print record says it used (0 = Bambu didn't record a weight)
function gramsOf(print) {
  const fils = Array.isArray(print && print.filaments) ? print.filaments : [];
  const g = fils.reduce((a, f) => a + (+f.grams || 0), 0);
  return g || +(print && print.grams) || 0;
}

// the filaments to price: when only the total weight is known (edited by hand, or a manual
// print) it goes to the single filament, or to an unknown one when there are several / none
function filsOf(print) {
  const fils = Array.isArray(print && print.filaments) ? print.filaments : [];
  const total = +(print && print.grams) || 0;
  if (fils.some((f) => +f.grams > 0) || !total) return fils;
  return fils.length === 1 ? [{ ...fils[0], grams: total }] : [{ type: '', color: '', grams: total }];
}

// Electricity cost of a print: minutes → kWh at the printer's average draw (W).
function powerCost(minutes, electricity) {
  const e = electricity || {};
  const kwh = ((+minutes || 0) / 60) * ((+e.watts || 0) / 1000);
  return kwh * (+e.pricePerKwh || 0);
}

// { filamentCost, powerCost, total, unpriced: [{type,color,grams}] } for one print.
// A failed print still has a real cost (wasted filament + power).
function costOfPrint(print, settings) {
  const s = settings || {};
  const fils = filsOf(print);
  let filamentCost = 0;
  const unpriced = [];
  for (const f of fils) {
    const grams = +f.grams || 0;
    const m = priceFor(f, s.filamentPrices);
    if (m) filamentCost += (grams / 1000) * m.pricePerKg;
    else if (grams > 0) unpriced.push({ type: normType(f.type), color: normColor(f.color), grams });
  }
  const power = powerCost(print && print.minutes, s.electricity);
  // no weight at all: the filament cost is unknown, not zero
  const noData = !gramsOf(print);
  return { filamentCost: round2(filamentCost), powerCost: round2(power), total: round2(filamentCost + power), unpriced, noData };
}

const monthKey = (iso) => {
  const d = new Date(iso || 0);
  return isNaN(d) || !iso ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Totals for the statistics view. `filter` is an optional (print) => boolean
// (e.g. date range / printer). Pure: no rounding surprises beyond money cents.
function summarize(prints, settings, filter) {
  const list = (Array.isArray(prints) ? prints : []).filter((p) => (filter ? filter(p) : true));
  const out = {
    count: 0, ok: 0, fail: 0, successRate: 0, grams: 0, minutes: 0,
    total: 0, filamentCost: 0, powerCost: 0, wasted: 0,
    byType: {}, byColor: {}, byMonth: {}, unpriced: {},
    noData: 0, rateByType: {},
  };
  let total = 0, fCost = 0, pCost = 0, wasted = 0, grams = 0;
  for (const p of list) {
    const c = costOfPrint(p, settings);
    // cancelled / partial prints also used filament without a good part
    const failed = p.result !== 'ok';
    out.count++; failed ? out.fail++ : out.ok++;
    grams += +p.grams || 0;
    out.minutes += +p.minutes || 0;
    total += c.total; fCost += c.filamentCost; pCost += c.powerCost;
    if (failed) wasted += c.total;
    if (c.noData) out.noData++;
    // success rate per filament type: each print counts once for every type it used
    const types = new Set(filsOf(p).map((f) => normType(f.type)).filter(Boolean));
    for (const t of types) { const r = (out.rateByType[t] = out.rateByType[t] || { count: 0, ok: 0, rate: 0 }); r.count++; if (!failed) r.ok++; }
    for (const f of filsOf(p)) {
      const g = +f.grams || 0; if (!g) continue;
      const t = normType(f.type) || '—';
      const col = normColor(f.color); // '' = Bambu didn't say
      const m = priceFor(f, settings && settings.filamentPrices);
      const cost = m ? (g / 1000) * m.pricePerKg : 0;
      (out.byType[t] = out.byType[t] || { grams: 0, cost: 0 }).grams += g;
      out.byType[t].cost += cost;
      (out.byColor[col] = out.byColor[col] || { grams: 0, cost: 0 }).grams += g;
      out.byColor[col].cost += cost;
      if (!m) out.unpriced[`${t} ${col}`] = { type: t, color: col };
    }
    const mo = monthKey(p.end || p.start);
    if (mo) {
      const b = (out.byMonth[mo] = out.byMonth[mo] || { count: 0, filament: 0, power: 0, cost: 0 });
      b.count++; b.filament += c.filamentCost; b.power += c.powerCost; b.cost += c.total;
    }
  }
  out.total = round2(total); out.filamentCost = round2(fCost);
  out.powerCost = round2(pCost); out.wasted = round2(wasted); out.grams = round2(grams);
  out.successRate = out.count ? Math.round((out.ok / out.count) * 100) : 0;
  for (const k of Object.keys(out.byType)) { out.byType[k].grams = round2(out.byType[k].grams); out.byType[k].cost = round2(out.byType[k].cost); }
  for (const k of Object.keys(out.byColor)) { out.byColor[k].grams = round2(out.byColor[k].grams); out.byColor[k].cost = round2(out.byColor[k].cost); }
  for (const r of Object.values(out.rateByType)) r.rate = Math.round((r.ok / r.count) * 100);
  for (const k of Object.keys(out.byMonth)) { const b = out.byMonth[k]; b.filament = round2(b.filament); b.power = round2(b.power); b.cost = round2(b.cost); }
  return out;
}

// Estimated (slicer) vs actual print time, over finished prints that have both.
// → { count, est, actual, diffPct, prints: [{ print, est, actual, diff }] }
// diffPct > 0: prints took longer than estimated. Cut-off outliers (< 25% or > 400%
// of the estimate) are left out: those are stops/pauses, not a wrong estimate.
function timeAccuracy(prints) {
  const rows = [];
  for (const p of (Array.isArray(prints) ? prints : [])) {
    if (!p || p.result !== 'ok') continue;
    // without real start/end times Bambu's "minutes" is the estimate itself, not a measurement
    const ts = Date.parse(p.start || ''), te = Date.parse(p.end || '');
    if (!(te > ts)) continue;
    const est = +p.estMinutes || 0, actual = +p.minutes || 0;
    if (est < 1 || actual < 1) continue;
    const r = actual / est;
    if (r < 0.25 || r > 4) continue;
    rows.push({ print: p, est, actual, diff: actual - est });
  }
  const est = rows.reduce((a, r) => a + r.est, 0), actual = rows.reduce((a, r) => a + r.actual, 0);
  return { count: rows.length, est, actual, diffPct: est ? Math.round(((actual - est) / est) * 100) : 0, prints: rows };
}

// 7×24 grid of print counts by local weekday (0=Sun) and hour, from start time.
function activityHeatmap(prints) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const p of (Array.isArray(prints) ? prints : [])) {
    const d = new Date(p.start || p.end || 0);
    if (!isNaN(d) && (p.start || p.end)) grid[d.getDay()][d.getHours()]++;
  }
  return grid;
}

module.exports = { normType, normColor, priceFor, perKg, gramsOf, filsOf, timeAccuracy, powerCost, costOfPrint, summarize, activityHeatmap, monthKey, round2 };
