// parses STL / 3MF off the UI thread, so big models never freeze the window
import { parseModel } from './parse.js';
self.onmessage = (e) => {
  const { name, buf, opts } = e.data;
  try {
    const r = parseModel(name, buf, opts);
    self.postMessage({ ok: true, r }, r.parts.map((p) => p.positions.buffer));
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
