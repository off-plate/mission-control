import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

/* The bug this file exists for: Michael reported the morning brief taking
   15-20 real seconds of dead air before it started talking, for a Gemini key
   he had already pasted in. This stubs Gemini to take LONGER than that (12s)
   and checks the button gives up on it well before then. */
const REPLY = {
  say: '- Updated the strategic tabulka\n- Wrote the CTP note',
  show: [], next: [],
}
const sse = (obj) => {
  const json = JSON.stringify(obj)
  let body = ''
  for (let i = 0; i < json.length; i += 24) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(i, i + 24) } }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}
await page.route('**/api.groq.com/**', (r) => {
  let streaming = false
  try { streaming = JSON.parse(r.request().postData() || '{}').stream === true } catch { /* default */ }
  if (streaming) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) })
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }) })
})

// Gemini TTS, stubbed to answer only after 12 real seconds -- slower than his
// reported 15-20s case would let a naive await ever recover from inside a test.
await page.route('**/generativelanguage.googleapis.com/**', async (r) => {
  await new Promise((res) => setTimeout(res, 12000))
  const n = 24000 * 1, pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 8)), i * 2)
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) })
})

await page.addInitScript(() => {
  window.__spoke = []
  const realSpeak = () => {}
  void realSpeak
})

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => { localStorage.setItem('mc-groq-key', 'gsk_test'); localStorage.setItem('mc-gemini-key', 'AIzaTEST') })
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)
if (await page.locator('button', { hasText: /Use this device only/i }).count()) {
  await page.locator('button', { hasText: /Use this device only/i }).first().click(); await page.waitForTimeout(900)
  await page.goto(`${URL}/#/assistant`); await page.waitForTimeout(900)
}

// Stub the device voice so the fallback path is observable and instant to detect.
await page.evaluate(() => {
  window.__spoke = []
  speechSynthesis.speak = (u) => {
    window.__spoke.push({ text: u.text, at: Date.now() })
    const words = String(u.text).split(' ').length
    let w = 0
    const beat = setInterval(() => { if (w++ >= words || !u.onboundary) { clearInterval(beat); return }; u.onboundary({ name: 'word', charIndex: w }) }, 60)
    setTimeout(() => { clearInterval(beat); u.onend && u.onend() }, 1500)
  }
  speechSynthesis.cancel = () => {}; speechSynthesis.pause = () => {}; speechSynthesis.resume = () => {}
})

await page.locator('.as-input').fill('what did I finish yesterday')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })

const btn = page.locator('.as-speak').first()
const t0 = Date.now()
await btn.click()

// The fix: give up on Gemini and speak on-device well under the 12s stub delay.
await page.waitForFunction(() => window.__spoke && window.__spoke.length > 0, null, { timeout: 9000 }).catch(() => {})
const elapsed = Date.now() - t0
const spoke = await page.evaluate(() => window.__spoke)
ok('falls back to device voice long before Gemini would ever answer',
  spoke.length === 1, `spoke=${spoke.length} after ${elapsed}ms`)
ok('the wait is capped, not the full 12s stub delay',
  elapsed < 8000, `${elapsed}ms`)
ok('bullet markers are stripped before anything is spoken',
  !!spoke[0] && !spoke[0].text.includes('-') && spoke[0].text.includes('Updated the strategic tabulka'),
  JSON.stringify(spoke[0]?.text))

// The visible text, separately, must still show the real dash bullets on screen.
const shown = await page.locator('.as-turn.is-it .as-said').first().textContent()
ok('the on-screen answer still shows the bullet list', /Updated the strategic tabulka/.test(shown ?? '') && (shown ?? '').includes('Wrote the CTP note'), shown)

// --- A FAST Gemini response should still win, and never fall back needlessly ---
await page.unroute('**/generativelanguage.googleapis.com/**')
await page.route('**/generativelanguage.googleapis.com/**', (r) => {
  const n = 24000, pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 8)), i * 2)
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) })
})
await page.evaluate(() => { window.__spoke = [] })
await page.locator('.as-input').fill('again')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-turn.is-it .as-said >> nth=1', { timeout: 15000 }).catch(() => {})
const g2 = page.locator('.as-speak').last()
await g2.click()
await page.waitForFunction(() => document.querySelector('.as-speak.is-playing') != null, null, { timeout: 5000 }).catch(() => {})
ok('a fast Gemini answer still plays through Gemini, not the fallback',
  (await page.evaluate(() => window.__spoke.length)) === 0, `device fallback fired ${await page.evaluate(() => window.__spoke.length)} times`)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
