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

console.log('cloudflare backoff ok');
