// Every _t text in the code has an English entry in app/lang-en.json with the same placeholders,
// and no Hebrew text is left outside _t (except the few that are translated where they're used).
const fs = require('fs'), path = require('path');
const acorn = require('acorn'), walk = require('acorn-walk');
const repo = path.join(__dirname, '..', '..');
const d = JSON.parse(fs.readFileSync(path.join(repo, 'app/lang-en.json'), 'utf8'));
const HEB = /[֐-׿]/;
const files = { 'src/app.js': 'module', 'src/printer.js': 'module', 'src/sync.js': 'module', 'app/main.js': 'script', 'app/engine.js': 'script', 'app/gdrive.js': 'script', 'app/timelapse.js': 'script' };
// left as plain Hebrew on purpose: translated with _t()/tx() at the point of use, or shown in both languages
const RAW_OK = [/^עברית$/, /^<div class="field"/, /^תקלה ב/, /^Google לא נתנו/];
const problems = [];
const ph = (s) => (s.match(/\{\}/g) || []).length;
for (const [rel, st] of Object.entries(files)) {
  const src = fs.readFileSync(path.join(repo, rel), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: st, locations: true });
  walk.fullAncestor(ast, (n, _s, anc) => {
    const p = anc[anc.length - 2];
    const at = `${rel}:${n.loc.start.line}`;
    let key = null;
    if (n.type === 'TaggedTemplateExpression' && n.tag.name === '_t') key = n.quasi.quasis.map((q) => q.value.cooked).join('{}');
    else if (n.type === 'CallExpression' && n.callee.name === '_t' && n.arguments[0] && n.arguments[0].type === 'Literal') key = n.arguments[0].value;
    if (key != null) {
      if (!(key in d)) problems.push(`no English for ${at}: ${JSON.stringify(key).slice(0, 80)}`);
      else if (ph(key) !== ph(d[key]) && !/\{\d+\}/.test(d[key])) problems.push(`placeholder count differs at ${at}`);
      return;
    }
    if (anc.some((a) => a !== n && ((a.type === 'TaggedTemplateExpression' && a.tag.name === '_t') || (a.type === 'CallExpression' && a.callee.name === '_t')))) return;
    const text = n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateLiteral' && !(p && p.type === 'TaggedTemplateExpression') ? n.quasis.map((q) => q.value.cooked).join('') : null;
    if (text && HEB.test(text) && !(p && p.type === 'Property' && p.key === n) && !RAW_OK.some((r) => r.test(text))) problems.push(`Hebrew outside _t at ${at}: ${text.slice(0, 60)}`);
  });
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`${Object.keys(d).length} texts, all translated`);
