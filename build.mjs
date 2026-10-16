import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', target: ['chrome100','edge100'], write: false, legalComments: 'none', loader: { '.py': 'text' } });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/template.html', 'utf8');
const out = tpl.replace('/*APP*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/shelf.html', out);
console.log('built', (out.length/1024).toFixed(0)+'KB');
