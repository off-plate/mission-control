# Mission Control for macOS

One codebase, two shells. `npm run build` writes `docs/`, and that exact output is
both the GitHub Pages site and what the desktop app serves internally over its
`app://mc` origin. There is no desktop fork: change a widget, both have it.

## Commands

```bash
npm run desktop        # build + run the app from source
npm run desktop:smoke  # drives the real app twice, asserts state survives a restart
npm run dist:mac       # build the installable dmg into release/
node tools/sync-test.mjs   # the offline outbox state machine, 14 assertions
```

`ELECTRON_RUN_AS_NODE=1` is exported by VS Code and Claude Code terminals and makes
Electron run as plain Node; the npm scripts strip it. If Electron ever "does
nothing" from a terminal, that variable is why.

## What the desktop adds

- Offline first, properly: the outbox (`src/sync.ts`) holds unsent changes,
  retries on a backoff, sends on reconnect and on the next launch. The unsent
  marker is persisted, so quitting offline loses nothing. Settings shows the
  truthful state (amber dot = work held on this device).
- Native notifications (Focus timer) that fire even with the window closed.
- Dock badge = the same count as Today's alerts. Cmd+1..6 page shortcuts (6 is Apps),
  Cmd+, for Settings. Window position remembered. Open-at-login toggle in
  Settings (visible only in the app).
- The top bar clears the traffic lights and drags the window (`.is-desktop`).

## What it deliberately does not do

- **Auto-update.** The site updates on push; the app updates by building a new
  dmg. Unsigned auto-update on macOS is not reliable, so it is not pretended.
- **Distribution to other people.** The app is ad-hoc signed (no Apple Developer
  account). On this Mac it opens normally. A dmg sent to ANOTHER Mac will be
  quarantined by Gatekeeper and refused. Distributing it means an Apple
  Developer ID ($99/yr) plus notarization; nothing in the build needs to change,
  only signing.
- **Magic-link sign-in.** Links open in the browser, not the app. The 8-digit
  code path is the app's sign-in, same as it already was.

## Files

- `electron/main.cjs`: the shell. Serves `docs/` over `app://mc` (a registered
  standard scheme, which is what makes localStorage and the Supabase session
  survive restarts; `file://` would not). Menu, badge, notifications, login item.
- `electron/preload.cjs`: the whole bridge, four calls, exposed as `window.mc`.
- `src/desktop.ts`: the renderer side; every function is a no-op in a browser.
- `build-assets/after-pack.cjs`: ad-hoc signs the bundle so macOS files login
  items and notifications under "Mission Control", not "Electron".
- `build-assets/icon.svg` -> `tools/make-icon.mjs` -> `icon.icns`.
