/* Drives the real Electron app, twice, in one run.

   Pass 1 asserts the app mounted, the fonts resolved through the app:// handler,
   the origin is a real one, and then writes a marker into localStorage.
   Pass 2 relaunches and checks the marker survived. That second pass is the whole
   point: on file:// it would not, and offline work would quietly evaporate between
   launches. */
import { _electron as electron } from 'playwright'

const fail = []
const ok = (cond, label) => { if (!cond) fail.push(label); console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`) }

/* VS Code and Claude Code terminals export ELECTRON_RUN_AS_NODE=1, which makes the
   binary run as plain node and never start an app at all. Strip it for the launch. */
const cleanEnv = { ...process.env }
delete cleanEnv.ELECTRON_RUN_AS_NODE

const badResponses = []

async function open() {
  const app = await electron.launch({ args: ['.'], env: cleanEnv })
  const page = await app.firstWindow()
  page.on('requestfailed', r => badResponses.push(`${r.url()} ${r.failure()?.errorText}`))
  page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.url()} -> ${r.status()}`) })
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

// ---- pass 1 ----
let { app, page } = await open()
await page.waitForSelector('#root *', { timeout: 20000 }).catch(() => {})

const probe = await page.evaluate(async () => {
  const root = document.getElementById('root')
  await document.fonts.ready
  /* Force the load rather than reading .check() on a face the current screen does
     not happen to use. An unused @font-face reports unloaded even when its file is
     perfectly reachable, which says nothing about whether app:// served it. */
  const has = async (f) => {
    try { await document.fonts.load(`700 40px "${f}"`) } catch { return false }
    return document.fonts.check(`700 40px "${f}"`)
  }
  let ls = 'unavailable'
  try { localStorage.setItem('mc-desktop-smoke', 'v1'); ls = localStorage.getItem('mc-desktop-smoke') } catch (e) { ls = 'threw' }
  return {
    origin: location.origin,
    href: location.href,
    mounted: !!root && root.children.length > 0,
    text: (document.body.innerText || '').slice(0, 120),
    bricolage: await has('Bricolage Grotesque'),
    instrument: await has('Instrument Sans'),
    ls,
    bridge: typeof window.mc === 'object' && window.mc?.desktop === true,
    bg: getComputedStyle(document.body).backgroundColor,
  }
})

ok(probe.mounted, 'React app mounted in the Electron window')
ok(probe.origin === 'app://mc', `stable origin (got ${probe.origin})`)
ok(probe.ls === 'v1', 'localStorage writable')
ok(probe.bridge, 'window.mc preload bridge present')
ok(probe.bricolage, 'Bricolage Grotesque resolved through app:// handler')
ok(probe.instrument, 'Instrument Sans resolved through app:// handler')
console.log('   first text on screen:', JSON.stringify(probe.text.replace(/\s+/g, ' ').slice(0, 90)))

const errs = []
page.on('pageerror', e => errs.push(String(e)))
await page.waitForTimeout(1500)
ok(errs.length === 0, `no uncaught page errors${errs.length ? ': ' + errs[0] : ''}`)
ok(badResponses.length === 0, `every asset served by app:// (${badResponses.length ? badResponses[0] : 'none failed'})`)
await app.close()

// ---- pass 2: does anything survive a relaunch ----
;({ app, page } = await open())
await page.waitForSelector('#root *', { timeout: 20000 }).catch(() => {})
const after = await page.evaluate(() => { try { return localStorage.getItem('mc-desktop-smoke') } catch { return 'threw' } })
ok(after === 'v1', `localStorage survived a full app restart (got ${after})`)
await page.evaluate(() => { try { localStorage.removeItem('mc-desktop-smoke') } catch {} })
await app.close()

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall smoke checks passed')
process.exit(fail.length ? 1 : 0)
