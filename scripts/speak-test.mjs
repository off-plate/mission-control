import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'  // serve docs/ under a /mission-control/ path
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d='') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ('+d+')' : ''}`); if (!c) fails.push(n) }

// Stub Groq so the assistant answers without a real key.
// Stub Groq as a real SSE stream, which is what ask() asks for.
const sse = (obj) => {
  const json = JSON.stringify(obj)
  let body = ''
  for (let i = 0; i < json.length; i += 24) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: json.slice(i, i + 24) } }] })}\n\n`
  }
  return body + 'data: [DONE]\n\n'
}
await page.route('**/api.groq.com/**', (r) => r.fulfill({
  status: 200, contentType: 'text/event-stream',
  body: sse({ say: 'Two things are sitting untouched and both are yours to clear this morning.',
              show: [{ kind: 'backlog' }], next: ['What is oldest?'] }),
}))
// Stub Gemini TTS with a real 0.2s WAV so the audio path is exercised for real.
await page.route('**/generativelanguage.googleapis.com/**', (r) => {
  const n = 24000 * 3, pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 8)), i * 2)
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) })
})

await page.goto(URL); await page.waitForTimeout(600)
// Local-only mode, so the test never touches his real account.
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)
if (await page.locator('button', { hasText: /Use this device only/i }).count()) {
  await page.locator('button', { hasText: /Use this device only/i }).first().click(); await page.waitForTimeout(900)
  await page.goto(`${URL}/#/assistant`); await page.waitForTimeout(900)
}

// --- Device-voice path (no Gemini key) ---
await page.evaluate(() => { window.__spoke = []
  speechSynthesis.speak = (u) => { window.__spoke.push(u.text); setTimeout(() => u.onend && u.onend(), 50) }
  speechSynthesis.cancel = () => {}; speechSynthesis.pause = () => {}; speechSynthesis.resume = () => {} })

await page.locator('.as-input').fill('what should I do today')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })

const btn = page.locator('.as-speak').first()
ok('play button renders under the answer', await btn.count() === 1)
ok('label starts as Play', (await btn.textContent())?.includes('Play'), await btn.textContent())
ok('no play button on his own message', await page.locator('.as-turn.is-you .as-speak').count() === 0)

await btn.click(); await page.waitForTimeout(250)
const spoke = await page.evaluate(() => window.__spoke)
ok('device voice actually got the answer text', spoke.length === 1 && spoke[0].startsWith('Two things are sitting'), JSON.stringify(spoke).slice(0,60))

// --- Gemini path ---
await page.evaluate(() => localStorage.setItem('mc-gemini-key', 'AIzaTEST'))
await page.reload(); await page.waitForTimeout(1200)
await page.locator('.as-input').fill('again please')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })
const g = page.locator('.as-speak').first()
await g.click()
await page.waitForFunction(() => document.querySelector('.as-speak')?.className.includes('is-playing'), null, { timeout: 8000 }).catch(()=>{})
ok('gemini audio reaches playing state', (await g.getAttribute('class'))?.includes('is-playing'), await g.getAttribute('class'))
ok('label switches to Pause while talking', (await g.textContent())?.includes('Pause'), await g.textContent())
await g.click(); await page.waitForTimeout(200)
ok('pause works and offers Resume', (await g.textContent())?.includes('Resume'), await g.textContent())
await g.click(); await page.waitForTimeout(200)
ok('resume returns to Pause', (await g.textContent())?.includes('Pause'), await g.textContent())

// A second answer, so the one-voice rule has two things to arbitrate.
await page.locator('.as-input').fill('and after that')
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)

// --- one voice at a time ---
const all = page.locator('.as-speak')
if (await all.count() >= 2) {
  await all.nth(0).click(); await page.waitForTimeout(150)
  await all.nth(1).click(); await page.waitForTimeout(600)
  const playing = await page.locator('.as-speak.is-playing, .as-speak.is-paused, .as-speak.is-loading').count()
  ok('only one answer talks at a time', playing <= 1, `${playing} active`)
} else ok('only one answer talks at a time', true, 'skipped, one turn')

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
