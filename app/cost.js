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
  return best ? { pricePerKg: +best.pricePerKg || 0, entry: best } : null;
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
  const fils = Array.isArray(print && print.filaments) ? print.filaments : [];
  let filamentCost = 0;
  const unpriced = [];
  for (const f of fils) {
    const grams = +f.grams || 0;
    const m = priceFor(f, s.filamentPrices);
    if (m) filamentCost += (grams / 1000) * m.pricePerKg;
    else if (grams > 0) unpriced.push({ type: normType(f.type), color: normColor(f.color), grams });
  }
  const power = powerCost(print && print.minutes, s.electricity);
  return { filamentCost: round2(filamentCost), powerCost: round2(power), total: round2(filamentCost + power), unpriced };
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
  };
  let total = 0, fCost = 0, pCost = 0, wasted = 0, grams = 0;
  for (const p of list) {
    const c = costOfPrint(p, settings);
    const failed = p.result === 'fail';
    out.count++; failed ? out.fail++ : out.ok++;
    grams += +p.grams || 0;
    out.minutes += +p.minutes || 0;
    total += c.total; fCost += c.filamentCost; pCost += c.powerCost;
    if (failed) wasted += c.total;
    for (const f of (Array.isArray(p.filaments) ? p.filaments : [])) {
      const g = +f.grams || 0; if (!g) continue;
      const t = normType(f.type) || '—';
      const col = normColor(f.color) || '000000';
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
  for (const k of Object.keys(out.byMonth)) { const b = out.byMonth[k]; b.filament = round2(b.filament); b.power = round2(b.power); b.cost = round2(b.cost); }
  return out;
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

module.exports = { normType, normColor, priceFor, powerCost, costOfPrint, summarize, activityHeatmap, monthKey, round2 };
