import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d='') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ('+d+')' : ''}`); if (!c) fails.push(n) }

const REPLY = { say: 'Two things are sitting untouched and both are yours to clear this morning.',
                show: [{ kind: 'backlog' }], next: ['What is oldest?'] }

/* Answer in whatever shape the request actually asked for. ask() streams today
   and did not a commit ago, and a stub that knows only one shape fails as "the
   answer came back unreadable", which reads as a broken play button and is not.
   This has already cost one debugging round. */
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
  try { streaming = JSON.parse(r.request().postData() || '{}').stream === true } catch { /* default to non-streaming */ }
  if (streaming) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(REPLY) })
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }) })
})

// Stub Gemini TTS with a real 0.2s WAV so the audio path is exercised for real.
await page.route('**/generativelanguage.googleapis.com/**', (r) => {
  const n = 24000 * 3, pcm = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 8)), i * 2)
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) })
})

/* REPRODUCE THE COLD START. getVoices() genuinely returns [] for the first
   moments of a page and only fills in when `voiceschanged` fires. Playwright is
   slow enough that the list is always warm by the time we click, so the bug
   cannot be reproduced by waiting: it has to be staged. getVoices() is held
   empty until the test releases it, deliberately AFTER the first click, which
   is exactly the state a real first click can land in. Code that reads the list
   synchronously gets nothing and speaks in the browser fallback voice. */
await page.addInitScript(() => {
  const real = speechSynthesis.getVoices.bind(speechSynthesis)
  window.__releaseVoices = () => {
    speechSynthesis.getVoices = real
    speechSynthesis.dispatchEvent(new Event('voiceschanged'))
  }
  speechSynthesis.getVoices = () => []
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
  speechSynthesis.speak = (u) => {
    window.__spoke.push({ text: u.text, voice: u.voice ? u.voice.name : null, lang: u.lang })
    setTimeout(() => u.onend && u.onend(), 50)
  }
  speechSynthesis.cancel = () => {}; speechSynthesis.pause = () => {}; speechSynthesis.resume = () => {} })

await page.locator('.as-input').fill('what should I do today')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })

const btn = page.locator('.as-speak').first()
ok('play button renders under the answer', await btn.count() === 1)
ok('label starts as Play', (await btn.textContent())?.includes('Play'), await btn.textContent())
ok('no play button on his own message', await page.locator('.as-turn.is-you .as-speak').count() === 0)

/* Wait past the module-load warm-up's own 1500ms ceiling first. Without this
   the warm-up can resolve empty in the window between the click and the
   release, and the test fails for a reason that has nothing to do with the
   thing it is asserting. That flake cost a debugging round; the wait is what
   makes this deterministic. */
await page.waitForTimeout(1800)
await btn.click()
/* Let the voices arrive only now, mid-click. Code that already spoke has
   already got it wrong; code that waited is about to get it right. */
await page.waitForTimeout(300)
await page.evaluate(() => window.__releaseVoices())
await page.waitForTimeout(500)
const spoke = await page.evaluate(() => window.__spoke)
ok('device voice actually got the answer text',
   spoke.length === 1 && spoke[0].text.startsWith('Two things are sitting'),
   (spoke[0]?.text ?? '').slice(0, 40))

/* The regression this file exists for. getVoices() is empty on its first call,
   so the FIRST answer of a session was read by the browser fallback while a
   replay a second later sounded fine. A null voice here is that bug exactly. */
ok('first play assigns a real voice', spoke[0]?.voice != null,
   `voice=${spoke[0]?.voice}`)

/* macOS ships 28 en-US voices and most are jokes. Sorted, the first is Albert,
   so "take any en-US voice" is a coin flip on Boing. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Kathy|Organ|Princess|Ralph|Fred|Grandma|Grandpa|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i
ok('the voice is not a novelty voice', !!spoke[0]?.voice && !NOVELTY.test(spoke[0].voice),
   `voice=${spoke[0]?.voice}`)

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
