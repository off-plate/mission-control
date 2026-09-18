/* Mission Control, macOS shell.

   The renderer runs the SAME build the website runs. Not a copy, not a desktop
   fork: `npm run build` writes docs/ for GitHub Pages with base /mission-control/,
   and this process serves that exact directory. So a change to a widget lands in
   both places at once, which is the whole point of the desktop app existing.

   Why a custom scheme instead of file://
   Under file:// every load gets an opaque origin, which means localStorage is
   thrown away between launches and the Supabase session with it. He would be
   signed out every morning and offline work would not survive a restart. A
   registered standard scheme gives a real, stable origin, so storage persists
   exactly as it does in a browser tab. */

const { app, BrowserWindow, Menu, Notification, protocol, net, session, shell, ipcMain, nativeTheme } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

/* The site is served from off-plate.github.io/mission-control, so every asset in
   the build is written as /mission-control/<something>. Keeping that prefix here
   is what lets the same bundle run unmodified. */
const BASE = '/mission-control/'
const SCHEME = 'app'
const HOST = 'mc'
const ORIGIN = `${SCHEME}://${HOST}`
const START = `${ORIGIN}${BASE}index.html`

/* Packaged, the build sits inside the asar next to this file. In development it
   is the repo's docs/ directory. */
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar', 'docs')
  : path.join(__dirname, '..', 'docs')

/* Must run before app ready. secure + standard is what buys us the stable origin,
   localStorage, and a fetch that Supabase can use. */
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

/* package.json's `name` is the npm one, lowercase and hyphenated, and Electron
   uses it for the application menu title and for notification attribution.
   CFBundleName is already right in the packaged Info.plist; this makes the
   running process agree with it, including in `npm run desktop`. */
app.setName('Mission Control')

/* External automations (a Shortcuts.app shortcut, a keyboard-triggered launcher)
   reach the app through this instead of faking a click or a keystroke -- opening
   a URL needs no Accessibility or Automation permission, unlike driving the app
   via System Events. `missioncontrol://new-task`, `missioncontrol://new-idea`,
   `missioncontrol://zone-play` and `missioncontrol://give-up` are the
   actions so far. */
const DEEPLINK_SCHEME = 'missioncontrol'
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

/* Development and the QA suites run against their own profile. The single
   -instance lock lives in userData, so without this a dev run cannot start
   while the installed app is open, and worse, a test run would read and write
   the INSTALLED app's live data. His day does not belong to a test. */
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Mission Control Dev'))
}
/* --qa-profile: the packaged binary under test. Same reason as the dev profile
   above, but for verifying a built dmg while the real app is open: without it
   the single-instance lock makes the test launch silently focus HIS window and
   verify nothing. Normal double-click launches never pass flags. */
if (app.commandLine.hasSwitch('qa-profile')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Mission Control QA'))
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) { app.quit(); return }

let win = null

/* ---- window geometry, remembered ----
   A desktop app that forgets where it was is a web page in a frame. */
const stateFile = () => path.join(app.getPath('userData'), 'window.json')
function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    if (typeof s.width === 'number' && typeof s.height === 'number') return s
  } catch { /* first run */ }
  return { width: 1440, height: 940 }
}
function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized()) return
  const b = win.getBounds()
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })) } catch { /* not fatal */ }
}

/* ---- serving the build ----
   Paths arrive as /mission-control/assets/x.js. Strip the base, resolve inside
   ROOT, and refuse anything that climbs out of it. Unknown paths fall back to
   index.html so the app's hash routes survive a reload. */
function resolveInRoot(urlPath) {
  let rel = decodeURIComponent(urlPath)
  if (rel.startsWith(BASE)) rel = rel.slice(BASE.length)
  rel = rel.replace(/^\/+/, '')
  if (!rel) rel = 'index.html'
  const full = path.normalize(path.join(ROOT, rel))
  if (!full.startsWith(path.normalize(ROOT))) return null
  return full
}

function registerProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const { pathname } = new URL(req.url)
    let file = resolveInRoot(pathname)
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html')
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

function createWindow() {
  const saved = readWindowState()
  win = new BrowserWindow({
    ...saved,
    minWidth: 880,
    minHeight: 600,
    show: false,
    /* Warm paper, not the default white, so the first paint does not flash.
       The app is light-only by documented decision; the shell does not argue. */
    backgroundColor: '#f4efe4',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  if (saved.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  win.on('resize', saveWindowState)
  win.on('move', saveWindowState)
  win.on('close', saveWindowState)
  win.on('closed', () => { win = null })

  /* Links to the outside world belong in his browser, not in a window with no
     address bar. Anything inside the app is left alone. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) { void shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); void shell.openExternal(url) }
  })

  win.webContents.once('did-finish-load', flushPendingDeepLink)
  void win.loadURL(START)
}

/* ---- menu ----
   Real shortcuts for the pages he actually opens. The hash routes are the app's
   own, so the menu drives the same router the sidebar does. */
function go(page) {
  if (!win) return
  void win.webContents.executeJavaScript(`location.hash = '/${page}'`)
}

function focusWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  app.focus({ steal: true })
  win.focus()
}

/* A warm app (already open, the common case) has React mounted long before
   any of this runs, so the dispatch below always lands. A cold launch is a
   real race, though: `did-finish-load` (what flushes a queued deep link)
   fires once the document itself has loaded, which is well before React has
   rendered anything, let alone attached the listener that's supposed to
   catch this event. `.topbar` is on every page once App.tsx has mounted, so
   polling for it covers every trigger below with one guard instead of each
   one guessing its own timing. */
function runWhenAppReady(script) {
  if (!win) return
  void win.webContents.executeJavaScript(`
    ;(function poll(n) {
      if (document.querySelector('.topbar')) { ${script} }
      else if (n < 60) { requestAnimationFrame(() => poll(n + 1)) }
    })(0)
  `)
}

function triggerNewTask() {
  if (!win) return
  focusWindow()
  runWhenAppReady(`window.dispatchEvent(new CustomEvent('mc:new-task'))`)
}

/* Ideas is lazy-loaded (a separate chunk behind a Suspense boundary) and its
   "new sticky" state lives inside that page component, not App.tsx -- so on
   top of the app-mount race every trigger has, this needs a second wait for
   the board's own root element, since that chunk can still load after the
   topbar is already up. */
function triggerNewIdea() {
  if (!win) return
  focusWindow()
  runWhenAppReady(`
    location.hash = '/ideas'
    ;(function poll(n) {
      if (document.querySelector('.ib-board')) {
        /* The element existing only proves React committed the DOM; its
           useEffect (which is what actually attaches the mc:new-idea
           listener) runs after paint, a beat later still. Two more frames
           covers that gap the same way the New Task listener's own comment
           already reasons about it. */
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('mc:new-idea'))
        }))
      } else if (n < 60) {
        requestAnimationFrame(() => poll(n + 1))
      }
    })(0)
  `)
}

/* The Mundi Opus provider (mundiplayer.tsx) sits at the app root, so once
   the topbar guard above has cleared, its mc:zone-play listener is already
   there -- no second, page-specific wait needed the way Ideas has one. */
function triggerZonePlay() {
  if (!win) return
  focusWindow()
  runWhenAppReady(`window.dispatchEvent(new CustomEvent('mc:zone-play'))`)
}

/* HabitsPage isn't lazy-loaded like Ideas, but it still only mounts (and
   only then attaches the mc:give-up listener) once the hash actually says
   'habits' -- same race as Ideas otherwise, just without a second chunk to
   wait on. `.hg-two` is its own root once rendered. */
function triggerGiveUp() {
  if (!win) return
  focusWindow()
  runWhenAppReady(`
    location.hash = '/habits'
    ;(function poll(n) {
      if (document.querySelector('.hg-two')) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('mc:give-up'))
        }))
      } else if (n < 60) {
        requestAnimationFrame(() => poll(n + 1))
      }
    })(0)
  `)
}

/* Launched cold via the deep link, `win` doesn't exist (or hasn't finished its
   first load) yet when `open-url` fires -- queued here and flushed once the
   window's first page load actually completes. Already-running is the common
   case and needs none of this: win exists and isn't loading, so it runs right
   away in handleDeepLink below. */
let pendingDeepLink = null
function flushPendingDeepLink() {
  const action = pendingDeepLink
  pendingDeepLink = null
  if (action === 'new-task') triggerNewTask()
  if (action === 'new-idea') triggerNewIdea()
  if (action === 'zone-play') triggerZonePlay()
  if (action === 'give-up') triggerGiveUp()
}
function handleDeepLink(url) {
  let action
  try { action = new URL(url).hostname || '' } catch { return }
  if (win && !win.webContents.isLoadingMainFrame()) {
    pendingDeepLink = action
    flushPendingDeepLink()
  } else {
    pendingDeepLink = action
  }
}
app.on('open-url', (event, url) => { event.preventDefault(); handleDeepLink(url) })

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'Cmd+,', click: () => go('settings') },
        { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Task', accelerator: 'Cmd+N', click: triggerNewTask },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Today', accelerator: 'Cmd+1', click: () => go('today') },
        /* 'plan' is the page's real route; 'tasks' never existed and fell back
           to Today, which made Cmd+2 a second Cmd+1. */
        { label: 'Plan', accelerator: 'Cmd+2', click: () => go('plan') },
        { label: 'Habits', accelerator: 'Cmd+3', click: () => go('habits') },
        { label: 'Notes', accelerator: 'Cmd+4', click: () => go('notes') },
        { label: 'The Zone', accelerator: 'Cmd+5', click: () => go('zone') },
        { label: 'Apps', accelerator: 'Cmd+6', click: () => go('apps') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---- bridge ----
   The renderer asks for native things it cannot do in a tab. */
ipcMain.handle('mc:badge', (_e, count) => {
  if (process.platform !== 'darwin') return false
  app.dock?.setBadge(count > 0 ? String(count) : '')
  return true
})
ipcMain.handle('mc:notify', (_e, { title, body }) => {
  if (!Notification.isSupported()) return false
  const n = new Notification({ title: String(title || 'Mission Control'), body: String(body || '') })
  n.on('click', () => { if (win) { win.show(); win.focus() } })
  n.show()
  return true
})
ipcMain.handle('mc:login-item', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('mc:login-item-get', () => app.getLoginItemSettings().openAtLogin)

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

/* His report (2026-09-18): every embedded YouTube player in the app (Mundi
   Opus, Give Up, Timeline) came back "Error 153: Video player configuration
   error" and never played a single video. Confirmed with the debugger: the
   IFrame API's own script ignores an `origin` playerVar entirely and always
   derives the Origin/Referer it sends from the real page origin, which for
   this app is the custom `app://mc` scheme (registered for a stable
   localStorage origin -- see the file header). YouTube's server rejects
   that scheme outright before a single frame of video loads. The origin
   check happens against the actual HTTP headers on the request, not
   anything the renderer can hand the API, so the only place to fix it is
   here, rewriting Origin/Referer to a real address on the way out -- and
   only for requests actually going to YouTube's own domains, so nothing
   else the app talks to (Supabase, its own asset host) is touched. */
function fixYouTubeEmbedOrigin() {
  const REAL_ORIGIN = 'https://off-plate.github.io'
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.ytimg.com/*', '*://*.googlevideo.com/*'] },
    (details, callback) => {
      details.requestHeaders['Origin'] = REAL_ORIGIN
      details.requestHeaders['Referer'] = `${REAL_ORIGIN}/mission-control/`
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'   // the app is light-only by decision
  registerProtocol()
  fixYouTubeEmbedOrigin()
  buildMenu()
  createWindow()
})
