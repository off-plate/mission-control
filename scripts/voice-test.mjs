/* Voice mode: the whole loop.
     node scripts/voice-test.mjs [baseUrl]

   The speech engine and the speaker are both stubbed, because a test has
   neither a microphone nor ears. What is asserted is the CHOREOGRAPHY, which is
   where this feature can actually go wrong: that a pause sends the question,
   that the answer is spoken, that the ears are SHUT while it speaks, and that
   it starts listening again afterwards. */
import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4189/mission-control'
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const REPLY = { say: 'Two things are sitting untouched.', show: [{ kind: 'backlog' }], next: ['x'] }

const b = await chromium.launch()
const page = await b.newPage()
await page.addInitScript(() => {
  window.__log = []
  class FakeRecognition {
    start() { window.__rec = this; window.__recLive = true; window.__log.push('rec:start') }
    stop() { window.__recLive = false; window.__log.push('rec:stop'); this.onend && this.onend() }
    abort() { window.__recLive = false; window.__log.push('rec:abort') }
  }
  window.SpeechRecognition = FakeRecognition
  window.webkitSpeechRecognition = FakeRecognition
  window.__say = (text, isFinal) => {
    const r = window.__rec
    if (!r || !r.onresult) { window.__log.push('say:DROPPED (ears shut)'); return }
    r.onresult({ resultIndex: 0, results: Object.assign([Object.assign([{ transcript: text }], { isFinal })], { length: 1 }) })
  }
  // A microphone that exists but reports nothing, plus a speaker we can watch.
  navigator.mediaDevices = navigator.mediaDevices || {}
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] })
  window.__spoken = []
  /* getVoices is deliberately NOT stubbed. utterance.voice only accepts a real
     SpeechSynthesisVoice, so handing it a plain object throws and the speaking
     silently never happens, which looks exactly like a broken feature. Chromium
     has a real voice list; use it. */
  speechSynthesis.speak = (u) => {
    window.__spoken.push(u.text)
    /* Record whether the ears are OPEN at the instant it starts talking. This is
       the real question. Checking only that recognition was not re-started during
       speech would pass while a recogniser opened earlier was still running and
       happily transcribing the answer. */
    window.__earsOpenWhileSpeaking = window.__recLive === true
    window.__log.push('speak:start')
    // Speaking takes time, and the ears must stay shut for all of it.
    setTimeout(() => { window.__log.push('speak:end'); u.onend && u.onend() }, 700)
  }
  speechSynthesis.cancel = () => {}
})
await page.route('**/api.groq.com/openai/v1/chat/completions', (r) => {
  let st = false
  try { st = JSON.parse(r.request().postData() || '{}').stream === true } catch { /* default */ }
  if (st) {
    const j = JSON.stringify(REPLY); let x = ''
    for (let i = 0; i < j.length; i += 24) x += `data: ${JSON.stringify({ choices: [{ delta: { content: j.slice(i, i + 24) } }] })}\n\n`
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: x + 'data: [DONE]\n\n' })
  }
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }) })
})

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)

const btn = page.locator('.as-voice-btn')
ok('a Voice button sits in the ask row', await btn.count() === 1)

await btn.click(); await page.waitForTimeout(500)
ok('the ask box becomes the voice panel', await page.locator('.as-voice').count() === 1)
ok('the textarea is gone while in voice mode', await page.locator('.as-input').count() === 0)
ok('it says it is listening', (await page.locator('.as-voice-state').textContent())?.includes('Listening'))
ok('the wave is drawn', await page.locator('.as-wave-bar').count() > 10, `${await page.locator('.as-wave-bar').count()} bars`)
ok('the thread is still on the page, not replaced', await page.locator('.as-page').count() === 1)

// --- speaking a question ---
await page.evaluate(() => window.__say('what is on today', false))
await page.waitForTimeout(150)
ok('what he is saying shows as he says it',
   (await page.locator('.as-voice-heard').textContent())?.includes('what is on today'),
   await page.locator('.as-voice-heard').textContent())

await page.evaluate(() => window.__say('what is on today', true))
// A final alone must NOT send: he may just be drawing breath.
await page.waitForTimeout(350)
ok('a final result alone does not send it yet', await page.locator('.as-turn.is-you').count() === 0)

// Now go quiet, past the hush.
await page.waitForTimeout(1400)
ok('going quiet sends the question', await page.locator('.as-turn.is-you').count() === 1,
   `${await page.locator('.as-turn.is-you').count()} turns`)
ok('the question he spoke is in the thread',
   (await page.locator('.as-turn.is-you .as-said').first().textContent())?.includes('what is on today'),
   await page.locator('.as-turn.is-you .as-said').first().textContent())

await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 10000 })
ok('the answer is in the thread as text', (await page.locator('.as-turn.is-it .as-said').first().textContent())?.includes('Two things are sitting'))

await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 8000 }).catch(() => {})
ok('the answer is read out loud', (await page.evaluate(() => window.__spoken)).length === 1,
   JSON.stringify(await page.evaluate(() => window.__spoken)))

/* THE ONE THAT MATTERS. While it is speaking the microphone must be shut, or it
   transcribes its own voice, sends that as the next question and never stops. */
const duringSpeech = await page.evaluate(() => {
  const i = window.__log.lastIndexOf('speak:start')
  if (i === -1) return ['NEVER SPOKE']   // slice(-1) would silently read the tail
  const j = window.__log.indexOf('speak:end', i)
  return window.__log.slice(i, j === -1 ? undefined : j)
})
ok('the microphone is SHUT at the moment it starts speaking',
   (await page.evaluate(() => window.__earsOpenWhileSpeaking)) === false,
   `earsOpen=${await page.evaluate(() => window.__earsOpenWhileSpeaking)}`)
ok('and recognition is not restarted mid-answer', !duringSpeech.includes('rec:start'), JSON.stringify(duringSpeech))

// --- and round again ---
await page.waitForTimeout(1500)
ok('it listens again once it has finished speaking',
   (await page.locator('.as-voice-state').textContent())?.includes('Listening'),
   await page.locator('.as-voice-state').textContent())
ok('the box was emptied for the next question',
   !(await page.locator('.as-voice-heard').textContent())?.includes('what is on today'),
   await page.locator('.as-voice-heard').textContent())

await page.evaluate(() => window.__say('and after that', true))
await page.waitForTimeout(1500)
ok('a second question goes through the same loop', await page.locator('.as-turn.is-you').count() === 2,
   `${await page.locator('.as-turn.is-you').count()} spoken turns`)

/* Same rule in voice mode, and here it hangs up entirely: an assistant left
   listening to an empty room all evening is the version of this feature nobody
   wants. Only ever armed while nothing has been said; mid-sentence the hush
   timer owns the timing. */
await page.waitForTimeout(6800)
ok('voice mode hangs up after six seconds of nothing said',
   await page.locator('.as-voice').count() === 0, `${await page.locator('.as-voice').count()} panels`)
ok('and the ask box comes back on its own', await page.locator('.as-input').count() === 1)
ok('the microphone was released when it hung up', (await page.evaluate(() => window.__recLive)) !== true)

// --- leaving ---
/* Back in by hand, so Done is still exercised. */
await page.locator('.as-voice-btn').click(); await page.waitForTimeout(500)
await page.locator('.as-voice-exit').click(); await page.waitForTimeout(400)
ok('Done returns the ask box', await page.locator('.as-input').count() === 1)
ok('and the panel is gone', await page.locator('.as-voice').count() === 0)
ok('the conversation is still in the thread afterwards', await page.locator('.as-turn').count() >= 4,
   `${await page.locator('.as-turn').count()} turns`)
ok('the microphone was released', (await page.evaluate(() => window.__recLive)) !== true)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
