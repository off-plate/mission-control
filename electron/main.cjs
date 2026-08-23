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

const { app, BrowserWindow, Menu, Notification, protocol, net, shell, ipcMain, nativeTheme } = require('electron')
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

  void win.loadURL(START)
}

/* ---- menu ----
   Real shortcuts for the pages he actually opens. The hash routes are the app's
   own, so the menu drives the same router the sidebar does. */
function go(page) {
  if (!win) return
  void win.webContents.executeJavaScript(`location.hash = '/${page}'`)
}

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
        { label: 'New Task', accelerator: 'Cmd+N', click: () => { if (win) void win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('mc:new-task'))`) } },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Today', accelerator: 'Cmd+1', click: () => go('today') },
        { label: 'Tasks', accelerator: 'Cmd+2', click: () => go('tasks') },
        { label: 'Habits', accelerator: 'Cmd+3', click: () => go('habits') },
        { label: 'Notes', accelerator: 'Cmd+4', click: () => go('notes') },
        { label: 'The Zone', accelerator: 'Cmd+5', click: () => go('zone') },
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

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'   // the app is light-only by decision
  registerProtocol()
  buildMenu()
  createWindow()
})
