// Quick checks that need no printer, network or Electron: `npm run check` (also run before every push).
const { execFileSync } = require('child_process');
const path = require('path');
const tests = ['fallback.test.js', 'timelapse.test.js', 'i18n.test.js', 'i18n-keys.test.js', 'makerworld.test.js', 'camera.test.js', 'cloudflare.test.js', 'dedup.test.js'];
let bad = 0;
for (const t of tests) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, t)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`ok   ${t}${out.trim() ? '  ' + out.trim().split('\n').pop() : ''}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${t}\n${(e.stdout || '') + (e.stderr || '')}`);
  }
}
process.exit(bad ? 1 : 0);
