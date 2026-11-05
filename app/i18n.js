// UI language. The Hebrew text in the code is the key; lang-en.json holds the English for each.
// _t`text ${x}` (tagged) or _t('text'). Placeholders are {} in order, or {0} {1} to reorder.
'use strict';
const EN = require('./lang-en.json');

let lang = 'he';
const cache = new WeakMap();
function fill(tpl, vals) {
  if (/\{\d+\}/.test(tpl)) return tpl.replace(/\{(\d+)\}/g, (_, i) => (vals[+i] == null ? '' : vals[+i]));
  let i = 0;
  return tpl.replace(/\{\}/g, () => { const v = vals[i++]; return v == null ? '' : v; });
}
function _t(strings, ...vals) {
  if (typeof strings === 'string') return (lang === 'en' && EN[strings]) || strings;
  if (lang !== 'en') return strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');
  let key = cache.get(strings);
  if (key == null) { key = strings.join('{}'); cache.set(strings, key); }
  const en = EN[key];
  return en ? fill(en, vals) : strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');
}
// text that arrives at runtime (an error message from another process): translate it if we know it
const tx = (s) => (lang === 'en' && typeof s === 'string' && EN[s]) || s;
const setLang = (l) => { lang = l === 'en' ? 'en' : 'he'; };
const getLang = () => lang;
const loc = () => (lang === 'en' ? 'en-GB' : 'he-IL');

module.exports = { _t, tx, setLang, getLang, loc };
