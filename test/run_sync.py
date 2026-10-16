import asyncio, os, sys, json, subprocess, time
from datetime import datetime, timezone, timedelta
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__))
from run import FILES, SEED, ROOT, SHOTS

now = datetime.now(timezone.utc)
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
SYNC = {
  "schema": 1,
  "helper": {"version": "1.0.0", "mode": "cloud", "host": "Gils-MacBook", "started": iso(now - timedelta(hours=1)), "lastSync": iso(now - timedelta(minutes=3)), "written": iso(now - timedelta(minutes=1)), "lastError": ""},
  "printers": {"01P00A": {"name": "P2S", "conn": "cloud", "state": "running", "progress": 42, "job": "Enderman", "updated": iso(now - timedelta(minutes=1))}},
  "prints": [
    {"key": "cloud-3", "source": "cloud", "serial": "01P00A", "printer": "P2S", "title": "Creeper", "design": "Minecraft Action Figures", "result": "ok", "start": iso(now - timedelta(days=1)), "end": iso(now - timedelta(days=1) + timedelta(hours=2)), "minutes": 120, "grams": 33.1, "filaments": [{"type": "PLA", "color": "#3FA34D", "grams": 33.1}], "cover": "", "bed": "textured_plate"},
    {"key": "cloud-2", "source": "cloud", "serial": "01P00A", "printer": "P2S", "title": "phone stand - Plate 1", "design": "", "result": "fail", "start": iso(now - timedelta(days=2)), "end": iso(now - timedelta(days=2)), "minutes": 15, "grams": 4, "filaments": [{"type": "PETG", "color": "#3FA9F5", "grams": 4}], "bed": "textured_plate", "error": 0},
    {"key": "cloud-1", "source": "cloud", "serial": "01P00A", "printer": "P2S", "title": "donut", "design": "", "result": "ok", "start": iso(now - timedelta(days=3)), "end": iso(now - timedelta(days=3)), "minutes": 50, "grams": 12, "filaments": [{"type": "PLA", "color": "#FFFFFF", "grams": 12}], "bed": "cool_plate"},
    {"key": "cloud-0", "source": "cloud", "serial": "01P00A", "printer": "P2S", "title": "Creeper", "design": "", "result": "cancel", "start": iso(now - timedelta(days=4)), "end": iso(now - timedelta(days=4)), "minutes": 2, "grams": 0, "filaments": []},
  ],
}

WRITE_SYNC = """async (txt) => { const r = await navigator.storage.getDirectory(); const m = await r.getDirectoryHandle('.shelf', {create:true}); const h = await m.getFileHandle('printer-sync.json', {create:true}); const w = await h.createWritable(); await w.write(txt); await w.close(); }"""
STATE = """() => { const L = window.__shelf.lib; return Object.values(L.data.models).filter(m=>m.prints.length).map(m => ({name: m.name, aliases: m.aliases, prints: m.prints.map(p => [p.key||'manual', p.result, p.date, p.material, p.notes])})) }"""

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            ctx = await b.new_context(viewport={'width': 1360, 'height': 860}, locale='he-IL')
            await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
            page = await ctx.new_page()
            logs = []
            page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
            await page.goto('http://127.0.0.1:8766/dist/shelf.html')
            await page.evaluate(SEED, FILES)
            await page.evaluate(WRITE_SYNC, json.dumps(SYNC))
            await page.goto('http://127.0.0.1:8766/dist/shelf.html?opfs=1')
            await page.wait_for_timeout(4500)
            # manual quick log for donut 3 days ago would not merge; check manual merge: log Creeper later
            print(json.dumps(await page.evaluate(STATE), ensure_ascii=False))
            print('unmatched', await page.evaluate("() => window.__shelf.S.unmatched.map(e=>e.title)"))
            await page.screenshot(path=f'{SHOTS}/s1_grid.png')
            await page.click('[data-nav="view"][data-val="inbox"]')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/s2_inbox.png')
            await page.click('[data-assign="cloud-3"]')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/s3_pick.png')
            await page.fill('#pmq', 'cube')
            await page.click('.pmi')
            await page.wait_for_timeout(400)
            print('after assign', json.dumps(await page.evaluate(STATE), ensure_ascii=False))
            print('unmatched', await page.evaluate("() => window.__shelf.S.unmatched.map(e=>e.title)"))
            await page.click('#ppill')
            await page.wait_for_timeout(300)
            await page.click('details.setup summary')
            await page.wait_for_timeout(200)
            await page.screenshot(path=f'{SHOTS}/s4_printer.png')
            await page.click('.dialog [data-close]')
            # live update: new print arrives in the sync file
            SYNC['prints'].insert(0, {"key": "live-01P00A-9", "source": "cloud-live", "serial": "01P00A", "printer": "P2S", "title": "Creeper", "result": "ok", "start": iso(now - timedelta(minutes=90)), "end": iso(now), "minutes": 90, "grams": 0, "filaments": []})
            SYNC['printers']['01P00A'].update(state='finish', progress=100)
            await page.evaluate(WRITE_SYNC, json.dumps(SYNC))
            await page.wait_for_timeout(21000)
            print('after live', json.dumps(await page.evaluate(STATE), ensure_ascii=False))
            # then cloud replaces live record
            SYNC['prints'][0] = {**SYNC['prints'][0], "key": "cloud-4", "source": "cloud", "aliasKeys": ["live-01P00A-9"], "grams": 30, "filaments": [{"type": "PLA", "color": "#111111", "grams": 30}]}
            await page.evaluate(WRITE_SYNC, json.dumps(SYNC))
            await page.wait_for_timeout(21000)
            print('after cloud replace', json.dumps(await page.evaluate(STATE), ensure_ascii=False))
            await page.click('[data-nav="view"][data-val="all"]')
            await page.click('.card:has(.name:text-is("cube"))')
            await page.wait_for_timeout(1500)
            await page.click('[data-tab="prints"]')
            await page.wait_for_timeout(300)
            await page.screenshot(path=f'{SHOTS}/s5_prints.png')
            print('\n'.join(logs))
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
