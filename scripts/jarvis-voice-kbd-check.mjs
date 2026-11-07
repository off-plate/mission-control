/* Jarvis on the phone shell: the keyboard must not hide the ask box, and a failing mic must say why.
   Run after `npm run build`: node scripts/jarvis-voice-kbd-check.mjs  (WebKit, ?noremote, speech stubbed, muted).
   The visual viewport is stubbed to what iOS reports with the keyboard up (shorter height, layout viewport
   unchanged). It proves the layout follows the visual viewport; it does not prove a real iPhone keyboard. */
import { webkit } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
import assert from 'assert/strict'

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { if (extname(file)) { res.writeHead(404); res.end(); return } res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(DOCS, 'index.html'))); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`

const b = await webkit.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
let pass = 0, fail = 0
const step = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message.split('\n')[0]) } }
const wait = (ms) => page.waitForTimeout(ms)

/* A visual viewport the test can drive, plus a speech engine that fails the way iOS standalone does. */
await page.addInitScript(() => {
  const l = {}
  const vv = { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1,
    addEventListener: (t, f) => { (l[t] ||= []).push(f) }, removeEventListener() {} }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  window.__kb = (px) => { vv.height = innerHeight - px; (l.resize || []).forEach((f) => f()) }
  window.__speech = 'fail'
  window.webkitSpeechRecognition = class {
    start() { setTimeout(() => this.onerror && this.onerror({ error: window.__speech === 'fail' ? 'service-not-allowed' : 'not-allowed' }), 30) }
    stop() {} abort() {}
  }
})
await page.goto(URL); await wait(1200)
await page.evaluate(() => localStorage.setItem('mc-shell-seen', '1'))

const open = async () => {
  await page.locator('#dock [data-x="apps"]').first().click(); await wait(400)
  await page.locator('[data-a="drawerOpen"][data-x="jarvis"]').first().click(); await wait(800)
}
await open()

await step('ask box is on screen before the keyboard', async () => {
  const r = await page.locator('#jvq').boundingBox()
  assert.ok(r && r.y + r.height <= 844, `box ${JSON.stringify(r)}`)
})
await step('keyboard up (336px): the ask box and send sit fully above it', async () => {
  await page.evaluate(() => window.__kb(336)); await wait(300)
  const q = await page.locator('#jvq').boundingBox(), s = await page.locator('#jvsend').boundingBox()
  const top = 844 - 336
  assert.ok(q.y + q.height <= top, `input bottom ${q.y + q.height} > keyboard top ${top}`)
  assert.ok(s.y + s.height <= top, `send bottom ${s.y + s.height} > keyboard top ${top}`)
  assert.ok(q.y >= 0, 'input above the screen')
  await page.screenshot({ path: '/tmp/mc-jarvis-kbd-up.png' })
})
await step('keyboard down: layout returns to full height', async () => {
  await page.evaluate(() => window.__kb(0)); await wait(300)
  const r = await page.locator('#jvq').boundingBox()
  assert.ok(r.y + r.height <= 844 && r.y + r.height > 700, `box ${JSON.stringify(r)}`)
})
await step('mic: iOS-style refusal with no Groq key says why instead of going silent', async () => {
  await page.locator('#jvmic').click(); await wait(1200)
  const t = await page.locator('#toast').textContent()
  assert.match(t, /Groq key|Safari|will not dictate/i, `toast: ${t}`)
})
await step('mic: blocked permission says so', async () => {
  await page.evaluate(() => { window.__speech = 'blocked' })
  await page.locator('#jvmic').click(); await wait(1200)
  const t = await page.locator('#toast').textContent()
  assert.match(t, /blocked/i, `toast: ${t}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
await b.close(); server.close()
process.exit(fail ? 1 : 0)
