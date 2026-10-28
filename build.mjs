import { build } from 'esbuild';
import fs from 'fs';
// the parser also runs inside a Web Worker: bundle it separately and embed it as a string
const wk = await build({ entryPoints: ['src/worker.js'], bundle: true, minify: true, format: 'iife', target: ['chrome100','edge100'], write: false, legalComments: 'none' });
const r = await build({ define: { __WORKER_SRC__: JSON.stringify(wk.outputFiles[0].text) }, entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['chrome100','edge100'], write: false, legalComments: 'none', loader: { '.py': 'text' } });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/template.html', 'utf8');
const out = tpl.replace('/*APP*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/shelf.html', out);
console.log('built', (out.length/1024).toFixed(0)+'KB');
