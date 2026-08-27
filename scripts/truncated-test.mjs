/* What happens when the model runs out of budget mid-answer.
     node scripts/truncated-test.mjs [baseUrl]

   This is the "the answer came back unreadable" he hit on the morning brief.
   The sentence had already streamed onto the screen; the object never closed,
   so the whole thing was thrown away and replaced by an error. */
import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4199/mission-control'
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const SENTENCE = 'Morning Michael. Start with the VZP letter, it is the only one with a deadline.'
const WHOLE = JSON.stringify({ say: SENTENCE, show: [{ kind: 'today' }], next: ['Put it on the morning'] })

/* Every shape below is one that was, or would be, shown to him as "the answer
   came back unreadable" while the model had in fact answered him properly. */
const SHAPES = [
  { name: 'cut off mid-object',
    body: `{"say": "${SENTENCE}", "show": [{"kind":"tod`, cards: 0 },
  { name: 'a reasoning block with a brace in it, then the answer',
    body: `<think>He wants the brief. Options: {the letter, the quote}. The letter has a deadline.</think>${WHOLE}`, cards: 1 },
  { name: 'an unterminated reasoning block that ate the answer',
    body: `<think>Weighing it up {a, b} and the answer is: {"say": "${SENTENCE}", "show": []`, cards: 0 },
  { name: 'real newlines inside the string instead of \\n',
    body: `{"say": "Morning, Michael.

Start with the VZP letter.", "show": [{"kind":"today"}]}`, cards: 1 },
  { name: 'a sentence in front of the JSON',
    body: `Here is your brief.
${WHOLE}`, cards: 1 },
  { name: 'fenced as markdown', body: '```json\n' + WHOLE + '\n```', cards: 1 },
  { name: 'a complete answer', body: WHOLE, cards: 1 },
]

async function run(bodyText, label) {
  const b = await chromium.launch()
  const page = await b.newPage()
  await page.route('**/api.groq.com/openai/v1/chat/completions', (r) => {
    let st = false
    try { st = JSON.parse(r.request().postData() || '{}').stream === true } catch { /* default */ }
    if (st) {
      let x = ''
      for (let i = 0; i < bodyText.length; i += 20) x += `data: ${JSON.stringify({ choices: [{ delta: { content: bodyText.slice(i, i + 20) } }] })}\n\n`
      return r.fulfill({ status: 200, contentType: 'text/event-stream', body: x + 'data: [DONE]\n\n' })
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: bodyText } }] }) })
  })
  await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ current: { temperature_2m: 7, apparent_temperature: 5, weather_code: 0 }, daily: { temperature_2m_max: [12], temperature_2m_min: [4], precipitation_probability_max: [10] } }) }))
  await page.goto(URL); await page.waitForTimeout(600)
  const local = page.locator('button', { hasText: /Use this device only/i })
  if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
  await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1300)
  await page.locator('.as-input').fill('what should I do today')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)
  const answer = await page.locator('.as-turn.is-it .as-said').first().textContent().catch(() => null)
  const errorText = await page.locator('.as-error').first().innerText().catch(() => null)
  const error = await page.locator('.as-error').count()
  const cards = await page.locator('.as-pulled-btn').count()
  await b.close()
  return { label, answer, error, cards, errorText }
}

for (const shape of SHAPES) {
  const r = await run(shape.body, shape.name)
  ok(`${shape.name}: no error is shown`, r.error === 0, `${r.error} error blocks`)
  ok(`${shape.name}: the sentence survives`, (r.answer ?? '').includes('VZP letter'), JSON.stringify((r.answer ?? '').slice(0, 60)))
  ok(`${shape.name}: ${shape.cards} card(s)`, r.cards === shape.cards, `got ${r.cards}`)
}

/* And when there is genuinely nothing, it says what came back rather than only
   that something did not work, so the next report of this is diagnosable. */
const junk = await run('I am afraid I cannot help with that request.', 'prose')
ok('unparseable prose still shows an error', junk.error === 1, `${junk.error} error blocks`)
ok('and the error carries what it actually said', (junk.errorText ?? '').includes('cannot help'), JSON.stringify(junk.errorText))

/* THE ONE HE ACTUALLY HIT. Two questions back to back, right after a card
   just wrote something, is ordinary traffic and it is not rare: Groq's free
   tier caps at 8000 tokens per minute and a habit or a task write plus a
   follow-up question clears that easily. The raw 429 body used to reach the
   screen verbatim: an org id, a service tier, a token count, and a link to
   upgrade billing, all ending in "Ask again, or rephrase it." on a request
   that was never unreadable. */
async function run429() {
  const b = await chromium.launch()
  const page = await b.newPage()
  const rawBody = 'Rate limit reached for model `openai/gpt-oss-120b` in organization '
    + '`org_01ktjycmq8e0d9xfr4mmt06qmd` service tier `on_demand` on tokens per minute (TPM): '
    + 'Limit 8000, Used 5439, Requested 5017. Please try again in 18.42s. Need more tokens? '
    + 'Upgrade to Dev Tier today at https://console.groq.com/settings/billing'
  await page.route('**/api.groq.com/openai/v1/chat/completions', (r) =>
    r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: rawBody } }) }))
  await page.goto(URL); await page.waitForTimeout(600)
  const local = page.locator('button', { hasText: /Use this device only/i })
  if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
  await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))
  await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1300)
  await page.locator('.as-input').fill('is the invoice marked done')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  const errorText = await page.locator('.as-error').first().innerText().catch(() => null)
  await b.close()
  return errorText ?? ''
}

const limited = await run429()
ok('a rate limit reads as a clean, short sentence',
   limited.includes('Too many questions'), JSON.stringify(limited))
ok('the org id is never shown to him', !limited.includes('org_'), JSON.stringify(limited))
ok('neither is the billing upsell', !limited.toLowerCase().includes('upgrade'), JSON.stringify(limited))
ok('the wait time is pulled out and shown plainly',
   limited.includes('19s') || limited.includes('18s'), JSON.stringify(limited))

/* THE FALLBACK. Groq says no, and if he has a Gemini key (the same one that
   already reads answers out loud), the same question goes there instead, so
   he never sees a wait at all for an answer he could have had immediately. */
async function run429WithFallback({ geminiKey, geminiOk }) {
  const b = await chromium.launch()
  const page = await b.newPage()
  let geminiWasCalled = false
  await page.route('**/api.groq.com/openai/v1/chat/completions', (r) =>
    r.fulfill({ status: 429, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 5.0s.' } }) }))
  await page.route('**/generativelanguage.googleapis.com/v1beta/openai/chat/completions', (r) => {
    geminiWasCalled = true
    if (!geminiOk) return r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"message":"also busy"}}' })
    /* The real call streams (askGemini passes stream: !!onSay, and onSay is
       always truthy from the assistant page), so the stub has to answer in
       the same SSE shape or readStream() finds no data: lines and the fallback
       "succeeds" with an empty, unreadable answer. */
    let streaming = false
    try { streaming = JSON.parse(r.request().postData() || '{}').stream === true } catch { /* default */ }
    const j = JSON.stringify(WHOLE_PARSED)
    if (streaming) {
      let x = ''
      for (let i = 0; i < j.length; i += 24) x += `data: ${JSON.stringify({ choices: [{ delta: { content: j.slice(i, i + 24) } }] })}\n\n`
      return r.fulfill({ status: 200, contentType: 'text/event-stream', body: x + 'data: [DONE]\n\n' })
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: j } }] }) })
  })
  await page.goto(URL); await page.waitForTimeout(600)
  const local = page.locator('button', { hasText: /Use this device only/i })
  if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
  await page.evaluate((k) => {
    localStorage.setItem('mc-groq-key', 'gsk_test')
    if (k) localStorage.setItem('mc-gemini-key', k)
  }, geminiKey)
  await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1300)
  await page.locator('.as-input').fill('is the invoice marked done')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
  const answer = await page.locator('.as-turn.is-it .as-said').first().textContent().catch(() => null)
  const errorText = await page.locator('.as-error').first().innerText().catch(() => null)
  await b.close()
  return { answer, errorText, geminiWasCalled }
}

const WHOLE_PARSED = { say: SENTENCE, show: [{ kind: 'today' }], next: [] }

const withKeyAndGeminiUp = await run429WithFallback({ geminiKey: 'AIzaFakeButPresent', geminiOk: true })
ok('with a Gemini key on hand, the real answer arrives instead of a wait',
   (withKeyAndGeminiUp.answer ?? '').includes('VZP letter'), JSON.stringify(withKeyAndGeminiUp.answer))
ok('and no rate-limit message is shown at all', !withKeyAndGeminiUp.errorText, JSON.stringify(withKeyAndGeminiUp.errorText))
ok('Gemini was actually the one asked', withKeyAndGeminiUp.geminiWasCalled === true)

const noKey = await run429WithFallback({ geminiKey: null, geminiOk: true })
ok('with no Gemini key, behaviour is exactly as before: the clean rate-limit message',
   (noKey.errorText ?? '').includes('Too many questions'), JSON.stringify(noKey.errorText))
ok('and Gemini is never even called without a key', noKey.geminiWasCalled === false)

const bothDown = await run429WithFallback({ geminiKey: 'AIzaFakeButPresent', geminiOk: false })
ok('when the fallback ALSO fails, the same clean rate-limit message shows',
   (bothDown.errorText ?? '').includes('Too many questions'), JSON.stringify(bothDown.errorText))
ok('the fallback was at least tried before giving up', bothDown.geminiWasCalled === true)

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
