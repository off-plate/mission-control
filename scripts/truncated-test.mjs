/* What happens when the model runs out of budget mid-answer.
     node scripts/truncated-test.mjs [baseUrl]

   This is the "the answer came back unreadable" he hit on the morning brief.
   The sentence had already streamed onto the screen; the object never closed,
   so the whole thing was thrown away and replaced by an error. */
import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4193/mission-control'
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const SENTENCE = 'Morning Michael. Start with the VZP letter, it is the only one with a deadline.'
// A real object, cut off exactly where a token budget would cut it.
const TRUNCATED = `{"say": "${SENTENCE}", "show": [{"kind":"tod`
const WHOLE = JSON.stringify({ say: SENTENCE, show: [{ kind: 'today' }], next: ['Put it on the morning'] })

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
  const error = await page.locator('.as-error').count()
  const cards = await page.locator('.as-pulled-btn').count()
  await b.close()
  return { label, answer, error, cards }
}

const cut = await run(TRUNCATED, 'truncated')
ok('a cut-off answer no longer shows an error', cut.error === 0, `${cut.error} error blocks`)
ok('the sentence he already watched arrive is kept',
   (cut.answer ?? '').includes('Start with the VZP letter'), JSON.stringify(cut.answer))
ok('and no card is invented from an object that never named one', cut.cards === 0, `${cut.cards} cards`)

const whole = await run(WHOLE, 'whole')
ok('a complete answer still parses normally', (whole.answer ?? '').includes('Start with the VZP letter'))
ok('and it still gets its card', whole.cards === 1, `${whole.cards} cards`)
ok('with no error', whole.error === 0)

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
