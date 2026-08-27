import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const sse = (obj) => {
  const json = JSON.stringify(obj)
  let body = ''
  for (let i = 0; i < json.length; i += 24) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(i, i + 24) } }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}
const RATE_LIMIT_BODY = JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 2.0s. Visit https://console.groq.com/... for details.' } })
const REPLY = { say: 'It cleared on retry.', show: [], next: [] }

let groqHits = 0
await page.route('**/api.groq.com/**', (r) => {
  groqHits++
  // First call 429s, second call (the automatic retry) succeeds.
  if (groqHits === 1) return r.fulfill({ status: 429, contentType: 'application/json', body: RATE_LIMIT_BODY })
  return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) })
})
// No Gemini key set for this run, so ask() must skip straight past the fallback
// and into the wait-then-retry loop -- proving the retry itself, not the
// existing Gemini path, is what recovers here.

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)

const t0 = Date.now()
await page.locator('.as-input').fill('what is on today')
await page.keyboard.press('Enter')

// While the retry is waiting, the thinking mark should be visible and the
// error banner should NOT appear -- the whole point is that he never sees it.
await page.waitForTimeout(800)
const thinkingDuringWait = await page.locator('.as-thinking').count()
const errorDuringWait = await page.locator('.as-error').filter({ hasText: 'Too many questions' }).count()
ok('the thinking mark shows during the wait, not an error', thinkingDuringWait > 0 && errorDuringWait === 0,
  `thinking=${thinkingDuringWait} error=${errorDuringWait}`)
const sendDisabledDuringWait = await page.locator('.as-send').isDisabled()
ok('Ask is disabled while it is waiting to retry, not free to double-fire', sendDisabledDuringWait)

await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })
const elapsed = Date.now() - t0
const shown = await page.locator('.as-turn.is-it .as-said').first().textContent()
ok('the retried answer reaches the screen', (shown ?? '').includes('It cleared on retry'), shown)
ok('no rate-limit error ever appears once the retry succeeds',
  (await page.locator('.as-error').filter({ hasText: 'Too many questions' }).count()) === 0)
ok('it actually waited for roughly the parsed 2s before retrying, not zero',
  elapsed > 1500, `${elapsed}ms`)
ok('groq was called twice: the 429, then the automatic retry', groqHits === 2, `${groqHits} calls`)

// --- A rate limit that never clears within two retries still surfaces the message ---
groqHits = 0
await page.unroute('**/api.groq.com/**')
await page.route('**/api.groq.com/**', (r) => { groqHits++; return r.fulfill({ status: 429, contentType: 'application/json', body: RATE_LIMIT_BODY }) })
await page.locator('.as-input').fill('and again')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-error', { timeout: 15000 }).catch(() => {})
const stillFails = await page.locator('.as-error').filter({ hasText: 'Too many questions' }).count()
ok('a rate limit that never clears still tells him eventually, after retrying', stillFails > 0 && groqHits === 3,
  `shown=${stillFails} groqCalls=${groqHits}`)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
