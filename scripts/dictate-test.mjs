/* Dictation beside the Ask button, both engines.
   Serve docs/ under a /mission-control/ path, then:
     node scripts/dictate-test.mjs [baseUrl]

   SpeechRecognition needs a real speech service, which a test cannot have, so
   the engine is stubbed and everything AROUND it is what gets asserted: that
   interim words land in the box live, that finals accumulate instead of
   repeating, and that the button and the mic stop when they should. */
import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4185/mission-control'
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const REPLY = { say: 'Two things are sitting untouched.', show: [{ kind: 'backlog' }], next: ['x'] }
const routeGroq = (page) => page.route('**/api.groq.com/openai/v1/chat/completions', (r) => {
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

async function open(page, { engine }) {
  await page.addInitScript((engine) => {
    if (engine !== 'browser') { delete window.SpeechRecognition; delete window.webkitSpeechRecognition }
    else {
      class FakeRecognition {
        start() { window.__recStarted = true }
        stop() { this.onend && this.onend() }
        abort() { this.onend && this.onend() }
      }
      window.SpeechRecognition = FakeRecognition
      window.webkitSpeechRecognition = FakeRecognition
      /* Drive the stub from the test: one call, one `result` event. */
      window.__say = (text, isFinal) => {
        const r = window.__rec
        if (!r || !r.onresult) return
        r.onresult({ resultIndex: 0, results: Object.assign([Object.assign([{ transcript: text }], { isFinal })], { length: 1 }) })
      }
      const realStart = FakeRecognition.prototype.start
      FakeRecognition.prototype.start = function () { window.__rec = this; realStart.call(this) }
    }
    if (engine === 'whisper') {
      navigator.mediaDevices = navigator.mediaDevices || {}
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] })
      window.MediaRecorder = class {
        static isTypeSupported() { return true }
        constructor() { this.state = 'recording' }
        start() { setTimeout(() => this.ondataavailable && this.ondataavailable({ data: new Blob(['x'], { type: 'audio/webm' }) }), 20) }
        stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 20) }
      }
    }
    if (engine === 'none') {
      delete window.MediaRecorder
      navigator.mediaDevices = undefined
    }
  }, engine)
  await routeGroq(page)
  await page.route('**/audio/transcriptions', (r) =>
    r.fulfill({ status: 200, contentType: 'text/plain', body: 'transcribed by whisper' }))
  await page.goto(URL); await page.waitForTimeout(600)
  const local = page.locator('button', { hasText: /Use this device only/i })
  if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
  if (engine !== 'none') await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
  await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)
}

const b = await chromium.launch()

// ---- browser engine: the live path ----
{
  const page = await b.newPage()
  await open(page, { engine: 'browser' })
  const mic = page.locator('.as-mic')
  ok('mic button sits in the ask row', await mic.count() === 1)
  ok('it reads Dictate at rest', (await mic.textContent())?.includes('Dictate'), await mic.textContent())
  ok('the mic comes before Ask', await page.locator('.as-ask-foot .as-mic + .as-send').count() === 1)

  await mic.click(); await page.waitForTimeout(200)
  ok('clicking starts listening', (await mic.getAttribute('class'))?.includes('is-listening'), await mic.getAttribute('class'))
  ok('and offers Stop', (await mic.textContent())?.includes('Stop'))
  ok('it is announced as pressed', await mic.getAttribute('aria-pressed') === 'true')

  await page.evaluate(() => window.__say('what should I do', false))
  await page.waitForTimeout(150)
  ok('interim words appear in the box while talking',
     (await page.locator('.as-input').inputValue()) === 'what should I do',
     await page.locator('.as-input').inputValue())

  await page.evaluate(() => window.__say('what should I do today', true))
  await page.waitForTimeout(150)
  ok('the final replaces the interim, it does not repeat it',
     (await page.locator('.as-input').inputValue()) === 'what should I do today',
     await page.locator('.as-input').inputValue())

  await mic.click(); await page.waitForTimeout(200)
  ok('clicking again stops', (await mic.textContent())?.includes('Dictate'), await mic.textContent())

  // Dictating with text already typed should append, not clobber.
  await page.locator('.as-input').fill('remind me')
  await mic.click(); await page.waitForTimeout(150)
  await page.evaluate(() => window.__say('about the tax return', true))
  await page.waitForTimeout(150)
  ok('it appends to what he already typed',
     (await page.locator('.as-input').inputValue()) === 'remind me about the tax return',
     await page.locator('.as-input').inputValue())

  /* Click Ask, which is what he does. Pressing Enter here would land on the mic
     button, because clicking it left the focus there, and Enter on a button
     just toggles that button. An earlier version of this test did exactly that
     and "sending stops the mic" passed because the mic had been switched off by
     hand, not because sending stopped it. */
  await page.locator('.as-send').click(); await page.waitForTimeout(600)
  ok('sending stops the mic', !(await mic.getAttribute('class'))?.includes('is-listening'), await mic.getAttribute('class'))
  ok('sending empties the box', (await page.locator('.as-input').inputValue()) === '',
     JSON.stringify(await page.locator('.as-input').inputValue()))

  /* His report, exactly. SpeechRecognition delivers one last `result` AFTER
     stop() is called, to flush a half-said phrase into a final one. Sending
     cleared the box and then that trailing result put the question straight
     back into it, so every dictated question had to be deleted by hand. The
     engine is stubbed here, so the late result is fired by hand instead. */
  await page.evaluate(() => window.__say && window.__say('what should I do today', true))
  await page.waitForTimeout(250)
  ok('a result arriving after send does not refill the box',
     (await page.locator('.as-input').inputValue()) === '',
     JSON.stringify(await page.locator('.as-input').inputValue()))

  // And dictation still works for the NEXT question after a send.
  await mic.click(); await page.waitForTimeout(150)
  await page.evaluate(() => window.__say('and after that', true))
  await page.waitForTimeout(200)
  ok('dictation still works for the next question',
     (await page.locator('.as-input').inputValue()) === 'and after that',
     await page.locator('.as-input').inputValue())
  await page.close()
}

// ---- it lets go of the microphone on its own ----
{
  /* Its own page on purpose. Run inside the section above it inherits whatever
     that left behind, and a click that lands on a disabled button reads as "it
     refused to listen" when the truth is it was never pressed. */
  const page = await b.newPage()
  await open(page, { engine: 'browser' })
  const mic = page.locator('.as-mic')
  await mic.click(); await page.waitForTimeout(300)
  ok('it is listening before the silence runs out',
     (await mic.getAttribute('class'))?.includes('is-listening'), await mic.getAttribute('class'))
  await page.waitForTimeout(2700)
  ok('still listening at three seconds', (await mic.getAttribute('class'))?.includes('is-listening'))
  await page.waitForTimeout(4000)
  ok('it stops itself after six seconds of nothing',
     !(await mic.getAttribute('class'))?.includes('is-listening'), await mic.getAttribute('class'))
  await page.close()
}

// ---- whisper fallback: no SpeechRecognition, key present ----
{
  const page = await b.newPage()
  await open(page, { engine: 'whisper' })
  const mic = page.locator('.as-mic')
  ok('fallback still offers a mic where the browser engine is missing', await mic.count() === 1)
  await mic.click(); await page.waitForTimeout(250)
  ok('recording shows as listening', (await mic.getAttribute('class'))?.includes('is-listening'), await mic.getAttribute('class'))
  await mic.click()
  await page.waitForTimeout(900)
  ok('whisper text lands in the box',
     (await page.locator('.as-input').inputValue()) === 'transcribed by whisper',
     await page.locator('.as-input').inputValue())
  ok('and it returns to rest', (await mic.textContent())?.includes('Dictate'), await mic.textContent())
  await page.close()
}

// ---- nothing available: no button at all ----
{
  const page = await b.newPage()
  await open(page, { engine: 'none' })
  ok('no mic is rendered when no engine exists', await page.locator('.as-mic').count() === 0)
  ok('and Ask still sits right', await page.locator('.as-ask-foot .as-send').count() === 1)
  await page.close()
}

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
