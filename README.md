# PrintLog

**A model library and print journal for Bambu Lab 3D printers — for Mac and Windows.**

PrintLog keeps all your STL / 3MF files in one place, shows each one in interactive 3D, and automatically fills in a log of everything you've printed — pulled straight from your Bambu Lab printer. Think of it as a shelf for your models plus an automatic logbook: what you printed, when, how it went, and with which settings.

It works whether or not you use Home Assistant, and whether or not your files are stored locally — you can run it in **cloud-only mode** with no folder at all.

## Download

[**Latest release**](https://github.com/gilsheps/Printlog/releases/latest):

- **Mac (Apple Silicon, M1 and later):** `PrintLog-…-mac-arm64.dmg`
- **Mac (Intel):** `PrintLog-…-mac-x64.dmg`
- **Windows:** `PrintLog-…-windows-setup.exe`

On Mac, the first time you open it: right-click PrintLog → **Open** (the app isn't signed with Apple). On macOS 15+, you may also need System Settings → Privacy & Security → **Open Anyway**. On Windows, if SmartScreen warns: **More info → Run anyway**.

After the first install, PrintLog updates itself — when a new version is out, you'll see it and can update from inside the app.

## What it does

**Your models, in 3D**
- Interactive 3D view and thumbnails for every STL / 3MF, with the real Bambu plate preview and filament colors
- Multi-plate projects shown plate-by-plate, the way Bambu Studio lays them out
- Tags, search, favorites, notes, and versions of the same model (v1, v2…)
- Large models open smoothly — parsing runs in the background and heavy meshes are simplified for display

**Your print history, automatically**
- A log of every print — succeeded / failed / canceled — with the settings read from the 3MF
- Connect to your printer two ways, no Home Assistant required:
  - **Bambu Cloud** — sign in with email + code, import your full print history, and get live status
  - **Local network (LAN)** — connect straight to the printer by IP + Access Code, no account needed
- Prints that have no local file still show in 3D: PrintLog downloads the model from Bambu / MakerWorld in the background and caches it, so each one downloads only once
- A **printer screen** (click the printer's name): live job progress, temperatures, AMS slots with colors and remaining filament, fans, error codes (with a link to Bambu's explanation), firmware versions, and print statistics

**Live camera (LAN)**
- Watch the printer's camera live, on your local network, for every model — RTSP printers (P1 / A1 / P2 / X1 / H2D) and the X1 chamber view are both supported. PrintLog detects which your printer uses automatically. (Remote viewing over the internet, like the phone app, relies on Bambu's closed cloud relay and isn't part of PrintLog.)

**Notifications**
- Print finished or failed, print paused or errored (with the HMS code), first layer done, 10 minutes remaining, and AMS filament running low / high humidity — each one toggleable

**Backup**
- Archive finished files to **Google Drive** and remove them from your computer, while they still appear in PrintLog and open in 3D on demand

Everything PrintLog stores lives inside a hidden `.shelf` folder in your model directory (or in the app's own folder in cloud-only mode) — your STL / 3MF files are never moved. Your Bambu sign-in is stored only on your computer, encrypted in the system keychain; your password is never stored at all.

## Privacy & how the connection works

- The **local network** connection talks directly to the printer and never leaves your network.
- The **cloud** connection uses the same unofficial Bambu interface that Bambu Studio, Bambu Handy, and [ha-bambulab](https://github.com/greghesp/ha-bambulab) use. Bambu could change it at any time; the local-network path doesn't depend on it.
- The **camera** (LAN) is restreamed locally by a bundled [go2rtc](https://github.com/AlexxIT/go2rtc) helper — the stream stays on your network.

## Building

Builds run automatically in GitHub Actions:
- **Manually:** Actions → Build app → Run workflow. The installers appear under the run's Artifacts.
- **A new release:** a `v1.0.1`-style tag creates a Release with the installers.

Locally:

```bash
npm install
npm start            # run the app
npm run dist:mac     # build for Mac (on a Mac)
npm run dist:win     # build for Windows (on Windows)
npm run build        # browser version only: dist/shelf.html
```

## Layout

| Folder | What's in it |
|---|---|
| `src/` | The UI (HTML/JS, three.js) — shared by both the app and the browser version |
| `app/` | The Electron app: window, tray, file permissions, the sync engine (`engine.js`), camera (`camera.js`) |
| `helper/shelf_sync.py` | A standalone sync helper (Python) for the browser version |
| `.github/workflows/` | Automated builds for Mac and Windows |
