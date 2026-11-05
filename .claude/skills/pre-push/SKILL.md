---
name: pre-push
description: Check PrintLog before pushing or releasing - build, quick tests, translation check, then a code review of what is about to be pushed. Use before any git push, when the user says "push", "release", "publish a version" or "upload the code", and when asked to check the code before pushing.
---

# Before pushing PrintLog

Run these in order. Stop at the first failure, fix it, and start again from step 1.

1. **Build and quick checks**: `npm run check`
   - builds the window (`dist/shelf.html`) and runs `test/unit/run.js`: LAN/cloud handoff, timelapse matching,
     translation helpers, and that every `_t` text has English in `app/lang-en.json`.
   - New Hebrew text must go through `_t` (tagged template or `_t('…')`) and get an English entry
     in `app/lang-en.json` with the same `{}` placeholders. The key is the Hebrew text exactly as written.

2. **Code review of the change**: review what `git log origin/main..HEAD` and `git diff origin/main` contain
   (use the `code-review` skill on that range when it is available). Look in particular for:
   - main process (`app/`): anything that blocks the event loop, unhandled promise rejections, timers not cleared in `Engine.stop()`
   - texts built at module load in `app/` (they don't follow a language change: translate where used)
   - settings: a new option must be read in `publicState`/`getState` and saved in `save()` in `src/app.js`
   - releases: macOS ships only the dmg and the in-app updater installs from it
   Fix real problems; mention judgment calls to the user instead of changing them silently.

3. **Push**: `git push origin main`. The `.githooks/pre-push` hook runs `npm run check` again
   (one-time setup per clone: `git config core.hooksPath .githooks`).

4. **Release** (only when the user asked for a version):
   - `npm version <x.y.z> --no-git-tag-version`, commit as `<x.y.z>`, `git tag v<x.y.z>`, `git push origin main v<x.y.z>`.
   - The tag starts `.github/workflows/build.yml`: mac arm64 + x64 and Windows builds, then the GitHub Release.
   - Tell the user the run is at https://github.com/gilsheps/Printlog/actions.

Report what ran and what it found, including anything skipped.
