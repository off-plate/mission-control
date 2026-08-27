import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

/* The real UI always asks with onSay set (it streams to show the words
   arriving), so both providers see stream:true and answer as SSE. A plain
   JSON body here would silently fail exactly the way readStream() fails on
   anything that is not "data: ..." lines -- that cost one debugging round
   before this comment was added. */
const sse = (obj) => {
  const json = JSON.stringify(obj)
  let body = ''
  for (let i = 0; i < json.length; i += 24) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(i, i + 24) } }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}
let geminiHit = 0
await page.route('**/api.groq.com/**', (r) => r.fulfill({
  status: 429, contentType: 'application/json',
  body: JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 3.2s. Visit https://console.groq.com/... for details.' } }),
}))
await page.route('**/generativelanguage.googleapis.com/**', (r) => {
  geminiHit++
  const REPLY = { say: 'Gemini answered instead.', show: [], next: [] }
  return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) })
})

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => { localStorage.setItem('mc-groq-key', 'gsk_test'); localStorage.setItem('mc-gemini-key', 'AIzaTEST') })
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)

await page.locator('.as-input').fill('what is on today')
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)

ok('the fallback actually calls Gemini when Groq 429s', geminiHit > 0, `hit ${geminiHit} times`)
const shown = await page.locator('.as-turn.is-it .as-said').first().textContent().catch(() => '')
ok('the Gemini answer reaches the screen, not the rate-limit message', (shown ?? '').includes('Gemini answered instead'), shown)
ok('the raw rate-limit copy never appears when the fallback succeeds', !(shown ?? '').includes('Too many questions'), shown)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
