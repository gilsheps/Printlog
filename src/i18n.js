// UI language for the window: the same dictionary and rules as app/i18n.js (the main process)
import EN from '../app/lang-en.json';

// known before any other module runs, so texts built at load time (status names…) come out right
function initial() {
  if (window.shelfNative && window.shelfNative.lang) return window.shelfNative.lang;
  try { const l = localStorage.getItem('printlog-lang'); if (l) return l; } catch { }
  return /^he\b/i.test(navigator.language || '') ? 'he' : 'en';
}
let lang = initial() === 'en' ? 'en' : 'he';
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
const cache = new WeakMap();
function fill(tpl, vals) {
  if (/\{\d+\}/.test(tpl)) return tpl.replace(/\{(\d+)\}/g, (_, i) => (vals[+i] == null ? '' : vals[+i]));
  let i = 0;
  return tpl.replace(/\{\}/g, () => { const v = vals[i++]; return v == null ? '' : v; });
}
const join = (strings, vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');
export function _t(strings, ...vals) {
  if (typeof strings === 'string') return (lang === 'en' && EN[strings]) || strings;
  if (lang !== 'en') return join(strings, vals);
  let key = cache.get(strings);
  if (key == null) { key = strings.join('{}'); cache.set(strings, key); }
  const en = EN[key];
  return en ? fill(en, vals) : join(strings, vals);
}
// text that arrives at runtime (an error from the main process or the worker): translate it if we know it
export const tx = (s) => (lang === 'en' && typeof s === 'string' && EN[s]) || s;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'he';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
}
export const getLang = () => lang;
export const loc = () => (lang === 'en' ? 'en-GB' : 'he-IL');
