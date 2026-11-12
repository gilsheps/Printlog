// Cloudflare cool-down: the backoff grows 30s → 60s → … and caps at 5 minutes,
// and a Cloudflare CloudError is tagged so the download queue can pause (not fail)
// its models while blocked.
const assert = require('assert');
const { nextBackoff, CloudError } = require('../../app/engine.js');

// backoff schedule
assert.strictEqual(nextBackoff(0), 30000);        // first block → 30s
assert.strictEqual(nextBackoff(30000), 60000);    // → 1min
assert.strictEqual(nextBackoff(60000), 120000);   // → 2min
assert.strictEqual(nextBackoff(120000), 240000);  // → 4min
assert.strictEqual(nextBackoff(240000), 300000);  // capped at 5min
assert.strictEqual(nextBackoff(300000), 300000);  // stays capped

// the Cloudflare error is distinguishable from an ordinary cloud error
assert.strictEqual(new CloudError('blocked', true).cf, true);
assert.strictEqual(new CloudError('generic').cf, false);
assert.ok(new CloudError('x', true) instanceof Error);

// A transient Cloudflare block must NOT stick: once requests succeed again,
// req() goes through instead of fast-failing on a stale cool-down.
(async () => {
  const { BambuCloud } = require('../../app/engine.js');
  const c = new BambuCloud('global');
  global.fetch = async () => ({ ok: false, status: 403, text: async () => 'Attention Required! | Cloudflare' });
  let firstCf = false;
  try { await c.req('GET', 'https://x.test/', null, {}); } catch (e) { firstCf = !!e.cf; }
  assert.strictEqual(firstCf, true, 'a Cloudflare 403 should throw a cf-tagged error');
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":1}' });
  const r = await c.req('GET', 'https://x.test/', null, {});
  assert.strictEqual(r.status, 200, 'after recovery, req must go through (no sticky cool-down)');
  console.log('cloudflare backoff ok');
})().catch((e) => { console.error(e); process.exit(1); });
