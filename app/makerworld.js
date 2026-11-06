'use strict';
// "My MakerWorld models": the designs the user published, from MakerWorld's public API (no auth needed).
// Returns error codes, not text, so the UI translates them.

const API = { global: 'https://api.bambulab.com', china: 'https://api.bambulab.cn' };
const SITE = { global: 'https://makerworld.com/en', china: 'https://makerworld.com.cn/zh' };
const PAGE = 50, MAX_PAGES = 20, TTL = 10 * 60 * 1000, TIMEOUT = 15000;
// same client headers the Bambu cloud calls in engine.js send
const HEADERS = {
  'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Name': 'OrcaSlicer', 'X-BBL-Client-Type': 'slicer',
  'X-BBL-Client-Version': '01.09.05.51', 'X-BBL-Language': 'en-US', Accept: 'application/json',
};
const reg = (r) => (r === 'china' ? 'china' : 'global');

// Profile text -> uid string ('1216818915'), { custom: 'handle' } for a handle we can't turn into a uid, or null.
// Accepts a profile URL (any trailing path), '@user_<n>', 'user_<n>' or bare digits.
function parseProfile(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  let h = s;
  const m = /^(?:https?:\/\/)?(?:www\.)?makerworld\.com(?:\.cn)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?@([^/?#\s]+)/i.exec(s);
  if (m) h = m[1];
  else if (/[/:\s]/.test(s)) return null; // some other URL / text
  try { h = decodeURIComponent(h); } catch { return null; } // a broken %-sequence is just not a profile
  h = h.replace(/^@/, '');
  const u = /^user_(\d+)$/i.exec(h);
  if (u) return u[1];
  return /^[\w.-]+$/.test(h) ? { custom: h } : null;
}

const getJson = async (url, headers, fetchImpl = fetch) => {
  let r;
  try { r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT) }); } catch { throw Object.assign(new Error('network'), { code: 'network' }); }
  if (!r.ok) throw Object.assign(new Error('http'), { code: 'http', status: r.status });
  try { return await r.json(); } catch { throw Object.assign(new Error('http'), { code: 'http', status: r.status }); }
};

// Who to show: the signed-in Bambu user, else the profile set in settings (options.mwProfile).
// -> { uid, source: 'cloud'|'profile', region } or { code: 'no-user'|'custom-handle' }. Never throws.
async function whoAmI(cfg, { fetchImpl } = {}) {
  const cloud = (cfg && cfg.cloud) || null, region = reg(cloud && cloud.region);
  // the saved user stays in the config after logout: only trust it while signed in
  const m = cloud && cloud.token && /^u?_?(\d+)$/.exec(String(cloud.user || ''));
  if (m) return { uid: m[1], source: 'cloud', region };
  if (cloud && cloud.token) { // logged in but no usable user id saved: ask the cloud
    try {
      const j = await getJson(`${API[region]}/v1/design-user-service/my/preference`, { ...HEADERS, Authorization: `Bearer ${cloud.token}` }, fetchImpl);
      if (j && j.uid) return { uid: String(j.uid), source: 'cloud', region };
    } catch { }
  }
  const p = parseProfile(cfg && cfg.options && cfg.options.mwProfile);
  if (typeof p === 'string') {
    // a pasted link says which site it is; only a bare id / handle falls back to the account's region
    const link = String(cfg.options.mwProfile);
    return { uid: p, source: 'profile', region: /makerworld\.com\.cn/i.test(link) ? 'china' : /makerworld\.com/i.test(link) ? 'global' : region };
  }
  if (p && p.custom) return { code: 'custom-handle', handle: p.custom };
  return { code: 'no-user' };
}

const modelUrl = (id, slug, region) => `${SITE[reg(region)]}/models/${id}${slug ? '-' + slug : ''}`;
const profileUrl = (uid, region) => `${SITE[reg(region)]}/@user_${uid}`;

function mapDesign(h, region) {
  const n = (v) => Number(v) || 0;
  return {
    id: h.id, title: h.title || '', slug: h.slug || '', cover: h.coverUrl || '', url: modelUrl(h.id, h.slug, region),
    likes: n(h.likeCount), downloads: n(h.downloadCount), prints: n(h.printCount), collections: n(h.collectionCount), comments: n(h.commentCount),
    published: h.publishTime || h.createTime || null, tags: Array.isArray(h.tags) ? h.tags : [], makerLab: !!h.customizedByMakerLab,
    instances: (h.instances || []).map((i) => ({ id: i.id, profileId: i.profileId, title: i.title || '' })),
  };
}

// All published designs of uid (raw hits). Throws { code: 'network'|'http', status }.
async function fetchPublished(uid, region, { fetchImpl } = {}) {
  const hits = [];
  let total = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const j = await getJson(`${API[reg(region)]}/v1/design-service/published/${uid}/design?limit=${PAGE}&offset=${hits.length}`, HEADERS, fetchImpl);
    const page = Array.isArray(j && j.hits) ? j.hits : [];
    total = Number(j && j.total) || 0;
    hits.push(...page);
    // the server may cap the page size or leave out total: stop on an empty page or once total is reached
    if (!page.length || (total && hits.length >= total)) break;
  }
  return { total: Math.max(total, hits.length), hits };
}

const cache = new Map(); // uid|region -> result; the list rarely changes and the screen may be opened often
async function mine(cfg, { refresh, fetchImpl } = {}) {
  try {
    const who = await whoAmI(cfg, { fetchImpl });
    if (who.code) return { ok: false, code: who.code };
    const key = `${who.uid}|${who.region}`, hit = cache.get(key);
    if (!refresh && hit && Date.now() - hit.fetchedAt < TTL) return { ...hit, source: who.source };
    const { total, hits } = await fetchPublished(who.uid, who.region, { fetchImpl });
    const res = { ok: true, uid: who.uid, source: who.source, region: who.region, profileUrl: profileUrl(who.uid, who.region), total, fetchedAt: Date.now(), designs: hits.map((h) => mapDesign(h, who.region)) };
    cache.set(key, res);
    return res;
  } catch (e) {
    return e.code === 'http' ? { ok: false, code: 'http', status: e.status } : { ok: false, code: 'network' };
  }
}

module.exports = { parseProfile, whoAmI, mapDesign, fetchPublished, mine, modelUrl, profileUrl, _cache: cache };
