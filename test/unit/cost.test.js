// Filament + electricity cost model: price matching by type+color (brand is a
// label only), electricity from minutes, failed prints still cost, and the
// statistics rollup.
const assert = require('assert');
const { priceFor, powerCost, costOfPrint, summarize, normColor } = require('../../app/cost.js');

const prices = [
  { type: 'PLA', brand: 'Generic', color: '#1F77B4', pricePerKg: 80 },  // blue PLA
  { type: 'PLA', brand: 'Other', color: '#FFFFFF', pricePerKg: 90 },    // white PLA
  { type: 'PETG', brand: '', color: '', pricePerKg: 95 },               // any PETG
];
const elec = { pricePerKwh: 0.6, watts: 120 };
const settings = { filamentPrices: prices, electricity: elec };

// --- priceFor: type+color match; brand ignored; type-wide fallback; miss ---
assert.strictEqual(priceFor({ type: 'pla', color: '1f77b4' }, prices).pricePerKg, 80, 'case-insensitive type+color');
assert.strictEqual(priceFor({ type: 'PLA', color: '#FFFFFF' }, prices).pricePerKg, 90, 'white PLA');
assert.strictEqual(priceFor({ type: 'PETG', color: '#123456' }, prices).pricePerKg, 95, 'type-wide PETG (no color set)');
assert.strictEqual(priceFor({ type: 'ABS', color: '#000000' }, prices), null, 'no entry → null');
assert.strictEqual(priceFor({ type: 'PLA', color: '#000000' }, prices), null, 'PLA but unknown color → null');

// --- normColor ---
assert.strictEqual(normColor('#aabbccdd'), 'AABBCC', 'strip # and alpha, upper');
assert.strictEqual(normColor('bad'), '', 'too short → empty');

// --- powerCost: 120 min @ 120W @ ₪0.6/kWh = 0.24 kWh*... = 2h*0.12kW*0.6 = ₪0.144 ---
assert.strictEqual(Math.round(powerCost(120, elec) * 1000) / 1000, 0.144, 'electricity from minutes');
assert.strictEqual(powerCost(60, {}), 0, 'no electricity settings → 0');

// --- costOfPrint: blue PLA 50g + white PLA 20g, 120 min ---
const p1 = { result: 'ok', minutes: 120, grams: 70, filaments: [
  { type: 'PLA', color: '#1F77B4', grams: 50 },
  { type: 'PLA', color: '#FFFFFF', grams: 20 },
] };
const c1 = costOfPrint(p1, settings);
assert.strictEqual(c1.filamentCost, 5.8, '50g*80 + 20g*90 per kg = 4.0 + 1.8');
assert.strictEqual(c1.powerCost, 0.14, 'rounded electricity');
assert.strictEqual(c1.total, 5.94, 'filament + power');
assert.strictEqual(c1.unpriced.length, 0, 'all priced');

// --- unpriced filament contributes 0 and is reported ---
const p2 = { result: 'ok', minutes: 0, grams: 30, filaments: [{ type: 'TPU', color: '#ABCDEF', grams: 30 }] };
const c2 = costOfPrint(p2, settings);
assert.strictEqual(c2.filamentCost, 0, 'unknown filament → 0');
assert.strictEqual(c2.unpriced.length, 1, 'reported as unpriced');
assert.strictEqual(c2.unpriced[0].type, 'TPU');

// --- empty settings → everything 0, nothing throws ---
assert.strictEqual(costOfPrint(p1, {}).total, 0, 'no prices, no electricity → 0');

// --- summarize: one ok + one failed; wasted = failed total ---
const pFail = { result: 'fail', minutes: 60, grams: 50, end: '2026-03-10T10:00:00Z', filaments: [{ type: 'PLA', color: '#1F77B4', grams: 50 }] };
const pOk = { ...p1, end: '2026-03-12T14:00:00Z' };
const s = summarize([pOk, pFail], settings);
assert.strictEqual(s.count, 2);
assert.strictEqual(s.ok, 1);
assert.strictEqual(s.fail, 1);
assert.strictEqual(s.successRate, 50);
assert.strictEqual(s.wasted, costOfPrint(pFail, settings).total, 'wasted = failed print total');
assert.ok(s.byType.PLA.grams === 120, 'PLA grams 70 + 50');
assert.ok(s.byMonth['2026-03'] && s.byMonth['2026-03'].count === 2, 'both in 2026-03');
assert.strictEqual(Object.keys(s.unpriced).length, 0, 'all priced in this set');

// --- a cancelled print is not a success and its cost is waste ---
const pCancel = { result: 'cancel', minutes: 30, grams: 10, end: '2026-03-15T10:00:00Z', filaments: [{ type: 'PLA', color: '#1F77B4', grams: 10 }] };
const s2 = summarize([pOk, pCancel], settings);
assert.strictEqual(s2.ok, 1, 'cancel is not ok');
assert.strictEqual(s2.successRate, 50);
assert.strictEqual(s2.wasted, costOfPrint(pCancel, settings).total, 'cancelled cost is waste');

// --- filament with no color stays '' (not black) so an "any color" price can cover it ---
const pNoColor = { result: 'ok', minutes: 0, grams: 20, filaments: [{ type: 'PETG', color: '', grams: 20 }, { type: 'ABS', color: '', grams: 5 }] };
const s3 = summarize([pNoColor], settings);
assert.ok(s3.byColor[''] && !s3.byColor['000000'], 'unknown color is its own bucket');
assert.deepStrictEqual(Object.values(s3.unpriced), [{ type: 'ABS', color: '' }], 'only ABS unpriced; PETG matched type-wide');

console.log('cost ok');

// --- spool price: ₪70 for a 1000g spool = ₪70/kg; a 750g spool at ₪60 = ₪80/kg ---
{
  const { perKg, timeAccuracy } = require('../../app/cost.js');
  assert.strictEqual(perKg({ spoolPrice: 70, spoolGrams: 1000 }), 70, 'spool of 1kg');
  assert.strictEqual(perKg({ spoolPrice: 60, spoolGrams: 750, pricePerKg: 1 }), 80, 'spool price wins over per-kg');
  assert.strictEqual(perKg({ pricePerKg: 95 }), 95, 'per-kg entry');
  const sp = { filamentPrices: [{ type: 'PLA', color: '', spoolPrice: 60, spoolGrams: 750 }] };
  assert.strictEqual(costOfPrint({ filaments: [{ type: 'PLA', color: '#123456', grams: 100 }] }, sp).filamentCost, 8, '100g at ₪80/kg');

  // --- no weight data: counted, not treated as a zero-gram print ---
  const nd = costOfPrint({ result: 'ok', minutes: 60, grams: 0, filaments: [{ type: 'PLA', color: '#1F77B4' }] }, settings);
  assert.strictEqual(nd.noData, true, 'no grams → noData');
  assert.strictEqual(costOfPrint(p1, settings).noData, false, 'grams present');
  const sd = summarize([p1, { result: 'ok', minutes: 30, filaments: [] }], settings);
  assert.strictEqual(sd.noData, 1, 'one print without weight');

  // --- success rate per filament type (a print counts once per type it used) ---
  const rs = summarize([
    p1,
    { result: 'fail', filaments: [{ type: 'PLA', color: '#1F77B4', grams: 5 }, { type: 'PETG', color: '', grams: 5 }] },
    { result: 'cancel', filaments: [{ type: 'PETG', color: '', grams: 3 }] },
  ], settings);
  assert.deepStrictEqual(rs.rateByType.PLA, { count: 2, ok: 1, rate: 50 }, 'PLA 1 of 2');
  assert.deepStrictEqual(rs.rateByType.PETG, { count: 2, ok: 0, rate: 0 }, 'PETG 0 of 2');

  // --- estimated vs actual time ---
  const ta = timeAccuracy([
    { result: 'ok', estMinutes: 100, minutes: 110, start: '2026-01-01T00:00:00Z', end: new Date(Date.parse('2026-01-01T00:00:00Z') + 110 * 6e4).toISOString() },
    { result: 'ok', estMinutes: 100, minutes: 90, start: '2026-01-01T00:00:00Z', end: new Date(Date.parse('2026-01-01T00:00:00Z') + 90 * 6e4).toISOString() },
    { result: 'ok', estMinutes: 100, minutes: 120, start: '2026-01-01T00:00:00Z', end: new Date(Date.parse('2026-01-01T00:00:00Z') + 120 * 6e4).toISOString() },
    { result: 'fail', estMinutes: 100, minutes: 10, start: '2026-01-01T00:00:00Z', end: new Date(Date.parse('2026-01-01T00:00:00Z') + 10 * 6e4).toISOString() },   // failed: not a timing sample
    { result: 'ok', estMinutes: 60, minutes: 600, start: '2026-01-01T00:00:00Z', end: new Date(Date.parse('2026-01-01T00:00:00Z') + 600 * 6e4).toISOString() },     // paused for hours: outlier
    { result: 'ok', minutes: 50 },                      // no estimate
  ]);
  assert.strictEqual(ta.count, 3, 'only finished prints with both times, no outliers');
  assert.strictEqual(ta.diffPct, 7, '320 actual vs 300 est → +7%');
}

// --- only a total weight (edited by hand / manual print): priced on the single filament ---
{
  const { timeAccuracy } = require('../../app/cost.js');
  const one = costOfPrint({ grams: 100, filaments: [{ type: 'PETG', color: '#123456' }] }, settings);
  assert.strictEqual(one.filamentCost, 9.5, '100 g of type-wide PETG at 95/kg');
  assert.strictEqual(one.noData, false, 'total weight known');
  const many = costOfPrint({ grams: 100, filaments: [{ type: 'PLA' }, { type: 'PETG' }] }, settings);
  assert.strictEqual(many.unpriced.length, 1, 'several filaments, one total: unknown split → unpriced');
  // minutes without real start/end are Bambu's estimate: not a timing sample
  assert.strictEqual(timeAccuracy([{ result: 'ok', estMinutes: 100, minutes: 100 }]).count, 0, 'no start/end → skipped');
}
