/* Desktop parity walk.

   The website already has its own gate (scripts/qa.mjs, 63 flows in Chromium).
   This walks the SAME bundle inside the real packaged-config Electron shell:
   every page, three window sizes, core interactions, zero tolerance for console
   errors, and full-window screenshots into the scratchpad for image review.

   Run:  env -u ELECTRON_RUN_AS_NODE node tools/desktop-parity.mjs <shot-dir> */
import { _electron as electron } from 'playwright'

const OUT = process.argv[2] ?? '.qa-shots'
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE

const fail = []
const ok = (cond, label) => { if (!cond) fail.push(label); console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`) }

const app = await electron.launch({ args: ['.'], env })
const page = await app.firstWindow()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(String(e)))
await page.waitForLoadState('domcontentloaded')
await page.evaluate(() => localStorage.setItem('mc-local-only', '1'))
await page.reload()
await page.waitForSelector('#root *', { timeout: 20000 })

const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [W, H]) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setBounds({ x: 40, y: 40, width: W, height: H })
}, [w, h])

/* Every reachable page, including the redirect aliases. */
const PAGES = ['today', 'plan', 'habits', 'goals', 'board', 'apps', 'notes', 'settings', 'achievements', 'stats', 'zone', 'review', 'brand', 'routines', 'braindump']

await setSize(1440, 940)
for (const p of PAGES) {
  await page.evaluate((id) => { location.hash = `/${id}` }, p)
  await page.waitForTimeout(700)
  const mounted = await page.evaluate(() => !!document.getElementById('root')?.children.length)
  ok(mounted, `page /${p} renders`)
}
ok(consoleErrors.length === 0, `no console errors across all pages${consoleErrors.length ? ` (first: ${consoleErrors[0].slice(0, 120)})` : ''}`)

/* Apps inside Electron: the frame must actually load foreign content, which is
   the one thing the web gate cannot prove about THIS shell. */
await page.evaluate(() => { location.hash = '/apps' })
await page.waitForTimeout(4000)
const frame = page.frames().find((f) => f.url().startsWith('https://watchless.netlify.app'))
ok(!!frame, 'the Watchless frame loads real content inside the app shell')
if (frame) {
  const text = await frame.evaluate(() => (document.body?.innerText ?? '').slice(0, 200)).catch(() => '')
  ok(/watchless/i.test(text) || text.length > 20, `the framed app rendered something (${text.slice(0, 40).replace(/\s+/g, ' ')}...)`)
}

/* ---- responsiveness: the sizes this window can actually be ---- */
const SIZES = [[880, 600, 'min'], [1280, 800, 'laptop'], [2560, 1000, 'ultrawide']]
for (const [w, h, name] of SIZES) {
  await setSize(w, h)
  await page.waitForTimeout(600)
  for (const p of ['today', 'habits', 'notes', 'apps']) {
    await page.evaluate((id) => { location.hash = `/${id}` }, p)
    await page.waitForTimeout(600)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    ok(!overflow, `no horizontal overflow: /${p} at ${w}px`)
    await page.screenshot({ path: `${OUT}/desktop-${name}-${p}.png` })
  }
}

/* ---- core flows, same actions the web gate exercises ---- */
await setSize(1440, 940)
await page.evaluate(() => { location.hash = '/today' })
await page.waitForTimeout(600)

// File -> New Task: goes to Plan and focuses the add input. That IS the flow;
// there is no dialog in this app.
const focused = await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('mc:new-task'))
  return new Promise((r) => setTimeout(() => {
    const el = document.activeElement
    r({ hash: location.hash, focused: el?.getAttribute?.('aria-label') === 'New task' })
  }, 600))
})
ok(focused.hash === '#/plan', `Cmd+N lands on Plan (got ${focused.hash})`)
ok(focused.focused, 'Cmd+N puts the cursor in the add-task input')

// Typed + Enter = a real task in real persisted state.
const stamp = `desktop parity ${Date.now()}`
await page.keyboard.type(stamp)
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
const inState = await page.evaluate((t) => JSON.stringify(localStorage).includes(t), stamp)
ok(inState, 'a task added in the app reaches persisted state')

await app.close()

// Restart, the task is still there. This is his real morning.
const app2 = await electron.launch({ args: ['.'], env })
const page2 = await app2.firstWindow()
await page2.waitForSelector('#root *', { timeout: 20000 })
const survived = await page2.evaluate((t) => JSON.stringify(localStorage).includes(t), stamp)
ok(survived, 'the task survives quitting and relaunching the app')
// clean the probe task back out of his state
await page2.evaluate((t) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('mc-state'))
  if (!key) return
  const s = JSON.parse(localStorage.getItem(key))
  s.tasks = (s.tasks ?? []).filter((x) => x.title !== t)
  localStorage.setItem(key, JSON.stringify(s))
}, stamp)
await app2.close()

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall desktop parity checks passed')
process.exit(fail.length ? 1 : 0)
