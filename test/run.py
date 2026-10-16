import asyncio, os, sys, json, subprocess, time
from playwright.async_api import async_playwright

ROOT = '/home/claude/shelf'
SHOTS = os.path.join(ROOT, 'test', 'shots')
os.makedirs(SHOTS, exist_ok=True)
FILES = []
for d, _, fs in os.walk(os.path.join(ROOT, 'fixtures/out')):
    for f in fs:
        p = os.path.relpath(os.path.join(d, f), os.path.join(ROOT, 'fixtures/out'))
        FILES.append(p)

SEED = """async (files) => {
  const root = await navigator.storage.getDirectory();
  for await (const [n] of root.entries()) await root.removeEntry(n, {recursive:true});
  for (const p of files) {
    const buf = await (await fetch('/fixtures/out/' + p.split('/').map(encodeURIComponent).join('/'))).arrayBuffer();
    const parts = p.split('/'); let d = root;
    for (const s of parts.slice(0,-1)) d = await d.getDirectoryHandle(s, {create:true});
    const h = await d.getFileHandle(parts.at(-1), {create:true});
    const w = await h.createWritable(); await w.write(buf); await w.close();
  }
  return files.length;
}"""

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
            ctx = await b.new_context(viewport={'width': 1360, 'height': 860}, locale='he-IL', color_scheme=sys.argv[1] if len(sys.argv) > 1 else 'light')
            page = await ctx.new_page()
            logs = []
            page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
            page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
            await page.goto('http://127.0.0.1:8765/dist/shelf.html')
            await page.screenshot(path=f'{SHOTS}/0_welcome.png')
            n = await page.evaluate(SEED, FILES)
            print('seeded', n)
            await page.goto('http://127.0.0.1:8765/dist/shelf.html?opfs=1')
            await page.wait_for_timeout(5000)
            await page.hover('.card:has(.name:text-is("cube"))')
            await page.click('.card:has(.name:text-is("cube")) [data-q="ok"]')
            await page.wait_for_timeout(300)
            await page.hover('.card:has(.name:text-is("cube"))')
            await page.screenshot(path=f'{SHOTS}/1_grid.png')
            state = await page.evaluate("""() => { const L = window.__shelf.lib; return Object.values(L.data.models).map(m => ({name: m.name, v: m.versions.map(x=>x.path), files: m.versions.map(x => { const r = L.data.files[x.path]; return {thumb: !!r.thumb, failed: r.failed, err: r.error, meta: r.meta && r.meta.print ? Object.keys(r.meta.print).length : 0}; })})) }""")
            print(json.dumps(state, ensure_ascii=False, indent=1))
            # open phone stand
            await page.click('.card:has-text("מעמד")')
            await page.wait_for_timeout(2500)
            await page.screenshot(path=f'{SHOTS}/2_modal_3mf.png')
            # tags
            await page.fill('#tagin', 'מתנות')
            await page.press('#tagin', 'Enter')
            await page.fill('#tagin', 'PETG')
            await page.press('#tagin', 'Enter')
            await page.fill('#mnotes', 'הודפס לאבא')
            # log print
            await page.click('#logprint')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/3_printform.png')
            await page.click('#pres button[data-v="ok"]')
            await page.fill('#pform [name=notes]', 'יצא מעולה')
            await page.click('#psave')
            await page.wait_for_timeout(300)
            await page.click('#newprint')
            await page.click('#pres button[data-v="fail"]')
            await page.fill('#pform [name=notes]', 'התנתק מהמגש')
            await page.click('#psave')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/4_prints.png')
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(300)
            # merge donuts
            await page.click('.card:has-text("donut v2") [data-check]')
            await page.click('.card:has-text("donut") >> nth=0', modifiers=['Control']) if False else None
            await page.click('.card:has(.name:text-is("donut")) [data-check]')
            await page.wait_for_timeout(200)
            await page.screenshot(path=f'{SHOTS}/5_bulk.png')
            await page.click('[data-b="merge"]')
            await page.click('.dialog .btn.primary')
            await page.wait_for_timeout(500)
            await page.click('.card:has-text("גרסאות")')
            await page.wait_for_timeout(1500)
            await page.click('[data-tab="versions"]')
            await page.wait_for_timeout(500)
            await page.screenshot(path=f'{SHOTS}/6_versions.png')
            await page.set_input_files('#addver', os.path.join(ROOT, 'fixtures/out/Toys/donut.stl'))
            await page.wait_for_timeout(2500)
            print('versions after add:', await page.evaluate("() => { const L = window.__shelf.lib; const m = Object.values(L.data.models).find(m => m.versions.length > 1); return m.versions.map(v => v.path) }"))
            await page.screenshot(path=f'{SHOTS}/6b_versions_added.png')
            await page.keyboard.press('Escape')
            # search
            await page.fill('#q', 'מתנות')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/7_search.png')
            await page.fill('#q', '')
            await page.wait_for_timeout(1200)
            saved = await page.evaluate("""async () => { const r = await navigator.storage.getDirectory(); const m = await r.getDirectoryHandle('.shelf'); const f = await (await m.getFileHandle('library.json')).getFile(); const j = JSON.parse(await f.text()); return {models: Object.keys(j.models).length, prints: Object.values(j.models).reduce((a,m)=>a+m.prints.length,0), tags: Object.values(j.models).flatMap(m=>m.tags)}; }""")
            print('saved', saved)
            # reload -> persistence
            await page.reload()
            await page.wait_for_timeout(2500)
            await page.screenshot(path=f'{SHOTS}/8_reload.png')
            await page.set_viewport_size({'width': 390, 'height': 800})
            await page.wait_for_timeout(400)
            await page.screenshot(path=f'{SHOTS}/9_mobile.png')
            print('\n'.join(l for l in logs if 'warn' not in l[:5])[:3000])
            await b.close()
    finally:
        srv.terminate()

if __name__ == "__main__":
    asyncio.run(main())
