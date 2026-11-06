const assert = require('assert');
const mw = require('../../app/makerworld.js');

// parseProfile
assert.strictEqual(mw.parseProfile('https://makerworld.com/en/@user_1216818915/upload'), '1216818915');
assert.strictEqual(mw.parseProfile('https://makerworld.com/en/@user_1216818915'), '1216818915');
assert.strictEqual(mw.parseProfile('makerworld.com.cn/zh/@user_42'), '42');
assert.strictEqual(mw.parseProfile('@user_1216818915'), '1216818915');
assert.strictEqual(mw.parseProfile('user_77'), '77');
assert.strictEqual(mw.parseProfile(' 1216818915 '), '1216818915');
assert.deepStrictEqual(mw.parseProfile('https://makerworld.com/en/@gilsheps/upload'), { custom: 'gilsheps' });
assert.deepStrictEqual(mw.parseProfile('@gilsheps'), { custom: 'gilsheps' });
for (const g of ['', null, undefined, 'https://example.com/@user_1', 'hello world', 'a/b']) assert.strictEqual(mw.parseProfile(g), null, String(g));

// mapDesign
const hit = (id) => ({ id, title: 'T' + id, slug: 's' + id, coverUrl: 'c', likeCount: 3, downloadCount: 4, printCount: 5, collectionCount: 6, commentCount: 7,
  tags: ['a'], createTime: '2026-01-01', instances: [{ id: 9, profileId: 8, title: 'plate', extra: 1 }] });
const d = mw.mapDesign(hit(1), 'global');
assert.strictEqual(d.url, 'https://makerworld.com/en/models/1-s1');
assert.strictEqual(mw.mapDesign(hit(1), 'china').url, 'https://makerworld.com.cn/zh/models/1-s1');
assert.deepStrictEqual([d.likes, d.downloads, d.prints, d.collections, d.comments, d.published, d.makerLab], [3, 4, 5, 6, 7, '2026-01-01', false]);
assert.deepStrictEqual(d.instances, [{ id: 9, profileId: 8, title: 'plate' }]);
assert.strictEqual(mw.mapDesign({ ...hit(2), publishTime: 'P' }, 'global').published, 'P');

// fake fetch: 120 designs, served 50 per page
const calls = [];
const fakeFetch = (total, status = 200) => async (url) => {
  calls.push(url);
  const q = new URL(url).searchParams, off = +q.get('offset'), lim = +q.get('limit');
  const hits = Array.from({ length: Math.max(0, Math.min(lim, total - off)) }, (_, i) => hit(off + i));
  return { ok: status === 200, status, json: async () => ({ total, hits }) };
};

(async () => {
  // whoAmI
  assert.deepStrictEqual(await mw.whoAmI({ cloud: { user: 'u_123', region: 'china', token: 't' }, options: {} }), { uid: '123', source: 'cloud', region: 'china' });
  assert.deepStrictEqual(await mw.whoAmI({ cloud: null, options: { mwProfile: '@user_55' } }), { uid: '55', source: 'profile', region: 'global' });
  assert.deepStrictEqual(await mw.whoAmI({ cloud: { email: 'x' }, options: {} }), { code: 'no-user' });
  assert.deepStrictEqual(await mw.whoAmI({}), { code: 'no-user' });
  assert.strictEqual((await mw.whoAmI({ options: { mwProfile: '@gilsheps' } })).code, 'custom-handle');
  const pref = async (url, o) => { assert.ok(url.endsWith('/my/preference') && o.headers.Authorization === 'Bearer tok'); return { ok: true, json: async () => ({ uid: 999 }) }; };
  assert.deepStrictEqual(await mw.whoAmI({ cloud: { token: 'tok' }, options: {} }, { fetchImpl: pref }), { uid: '999', source: 'cloud', region: 'global' });

  // fetchPublished pagination: 3 pages, stops on the short page
  const r = await mw.fetchPublished('1', 'global', { fetchImpl: fakeFetch(120) });
  assert.strictEqual(r.hits.length, 120);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls[2].startsWith('https://api.bambulab.com/v1/design-service/published/1/design?limit=50&offset=100'));
  calls.length = 0;
  await mw.fetchPublished('1', 'china', { fetchImpl: fakeFetch(100) }); // exact multiple: stops on total, no empty 3rd call
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].startsWith('https://api.bambulab.cn/'));
  calls.length = 0;
  await mw.fetchPublished('1', 'global', { fetchImpl: fakeFetch(5000) }); // capped at 20 pages
  assert.strictEqual(calls.length, 20);

  // the server caps the page size at 20 and leaves out total: keep going until an empty page
  calls.length = 0;
  const capped = async (url) => {
    calls.push(url);
    const off = +new URL(url).searchParams.get('offset');
    return { ok: true, status: 200, json: async () => ({ hits: Array.from({ length: Math.max(0, Math.min(20, 45 - off)) }, (_, i) => hit(off + i)) }) };
  };
  const rc = await mw.fetchPublished('1', 'global', { fetchImpl: capped });
  assert.strictEqual(rc.hits.length, 45);
  assert.deepStrictEqual(calls.map((u) => +new URL(u).searchParams.get('offset')), [0, 20, 40, 45]);

  // after logout the saved user stays in the config: the pasted profile wins
  assert.deepStrictEqual(await mw.whoAmI({ cloud: { user: 'u_123', region: 'global' }, options: { mwProfile: '@user_55' } }), { uid: '55', source: 'profile', region: 'global' });
  // a pasted link names its site; only a bare id falls back to the account's region
  assert.strictEqual((await mw.whoAmI({ cloud: { region: 'china' }, options: { mwProfile: 'https://makerworld.com/en/@user_5' } })).region, 'global');
  assert.strictEqual((await mw.whoAmI({ cloud: { region: 'global' }, options: { mwProfile: 'https://makerworld.com.cn/zh/@user_5' } })).region, 'china');
  assert.strictEqual((await mw.whoAmI({ cloud: { region: 'china' }, options: { mwProfile: 'user_5' } })).region, 'china');
  // a broken %-sequence is not a profile (and does not throw)
  assert.strictEqual(mw.parseProfile('@user_%E0'), null);

  // mine: shape, cache, errors (never throws)
  const c = { cloud: null, options: { mwProfile: 'user_7' } };
  calls.length = 0;
  const m = await mw.mine(c, { fetchImpl: fakeFetch(2) });
  assert.strictEqual(m.ok, true);
  assert.deepStrictEqual([m.uid, m.source, m.region, m.total, m.designs.length, m.profileUrl], ['7', 'profile', 'global', 2, 2, 'https://makerworld.com/en/@user_7']);
  await mw.mine(c, { fetchImpl: fakeFetch(2) });
  assert.strictEqual(calls.length, 1, 'second call served from cache');
  await mw.mine(c, { refresh: true, fetchImpl: fakeFetch(2) });
  assert.strictEqual(calls.length, 2, 'refresh skips the cache');
  assert.deepStrictEqual(await mw.mine({ options: { mwProfile: 'user_8' } }, { fetchImpl: fakeFetch(1, 503) }), { ok: false, code: 'http', status: 503 });
  assert.deepStrictEqual(await mw.mine({ options: { mwProfile: 'user_9' } }, { fetchImpl: async () => { throw new Error('ECONNRESET'); } }), { ok: false, code: 'network' });
  assert.deepStrictEqual(await mw.mine({}), { ok: false, code: 'no-user' });
  assert.deepStrictEqual(await mw.mine({ options: { mwProfile: '@gilsheps' } }), { ok: false, code: 'custom-handle' });
  console.log('makerworld ok');
})().catch((e) => { console.error(e); process.exit(1); });
