/* The morning brief: the button, and what the model is actually told.
     node scripts/brief-test.mjs [baseUrl]

   The valuable half is the second one. The button is easy to see working; what
   is easy to get wrong is the briefing quietly losing the weather or yesterday's
   leftovers, in which case the brief still "works" and is simply useless. So the
   Groq request body is captured and read. */
import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4191/mission-control'
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const REPLY = { say: 'Morning, Michael. It is overcast and 7 out.\n\nStart with the VZP letter.', show: [{ kind: 'today' }, { kind: 'backlog' }], next: ['Put it on the morning'] }
const b = await chromium.launch()
const page = await b.newPage()
let sent = null

await page.addInitScript(() => {
  class F { start() { window.__rec = this } stop() { this.onend && this.onend() } abort() {} }
  window.SpeechRecognition = F; window.webkitSpeechRecognition = F
  navigator.mediaDevices = navigator.mediaDevices || {}
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] })
  window.__spoken = []
  speechSynthesis.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 300) }
  speechSynthesis.cancel = () => {}
})
// A known sky, so the assertion is about plumbing and not about the weather.
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({
    current: { time: '2026-08-26T07:00', temperature_2m: 7.4, apparent_temperature: 4.1, weather_code: 3 },
    daily: { temperature_2m_max: [12.2], temperature_2m_min: [5.0], precipitation_probability_max: [55] },
    hourly: {
      time: Array.from({ length: 8 }, (_, i) => `2026-08-26T${String(7 + i).padStart(2, '0')}:00`),
      temperature_2m: [7, 8, 9, 10, 11, 12, 12, 11],
      precipitation_probability: [55, 40, 20, 10, 5, 5, 0, 0],
      weather_code: [61, 61, 3, 2, 1, 0, 0, 3],
    },
  }),
}))
await page.route('**/api.groq.com/openai/v1/chat/completions', (r) => {
  const body = r.request().postData() || '{}'
  sent = body
  let st = false
  try { st = JSON.parse(body).stream === true } catch { /* default */ }
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

// Something planned for yesterday and never ticked, plus one for today.
await page.evaluate(() => {
  const K = Object.keys(localStorage).find((k) => k.startsWith('mission-control-demo-'))
  const s = JSON.parse(localStorage.getItem(K))
  const d = new Date(); d.setDate(d.getDate() - 1)
  const p = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  /* Seeded the way the ROLLOVER leaves it, which is the only state this can
     ever be observed in: the unfinished task is already in the backlog with
     plannedOn cleared, and its id is recorded in plan.returnedIds. Seeding it
     as list:'today' with plannedOn:yesterday describes a moment that has always
     passed by the time the assistant reads anything. */
  s.tasks = [
    { id: 'y1', title: 'Send the VZP letter', list: 'backlog', space: 'personal', createdAt: p(d), carried: 1 },
    { id: 't1', title: 'Draft the Blastburn quote', list: 'today', plannedOn: p(new Date()), slot: 'morning', space: 'work', createdAt: p(new Date()) },
  ]
  s.plan = { ...(s.plan || {}), returnedOn: p(new Date()), returnedIds: ['y1'], returnedCount: 1 }

  /* Mark the rollover as already run today, or it runs on mount and rebuilds
     plan from scratch, leaving the fixture at the mercy of what it decides. */
  s.lastRollDay = p(new Date())
  localStorage.setItem(K, JSON.stringify(s))
})
await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1600)

const brief = page.locator('.as-brief')
ok('the doorway offers a Morning brief button', await brief.count() === 1)
ok('it is the page\'s one filled control',
   await page.evaluate(() => {
     const el = document.querySelector('.as-brief')
     const bg = getComputedStyle(el).backgroundColor
     return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
   }))
ok('it reads Morning brief', (await brief.textContent())?.includes('Morning brief'), await brief.textContent())

await brief.click()
await page.waitForSelector('.as-turn.is-it .as-said', { timeout: 15000 })

const msgs = JSON.parse(sent ?? '{}').messages ?? []
const sysMsg = msgs.find((m) => m.role === 'system')?.content ?? ''
ok('it opened voice mode rather than the text box', await page.locator('.as-voice').count() === 1)
/* The thread shows the SKILL, not the paragraph the button sends on his behalf.
   Seeing "Give me my morning brief. What is it like out, what is on today, and
   what did I not finish yesterday?" in his own bubble is seeing the wiring. */
const asked = await page.locator('.as-turn.is-you .as-said').first().textContent()
ok('his turn reads as the skill he pressed', asked?.trim() === 'Morning brief', JSON.stringify(asked))
ok('the engineered prompt is not shown to him', !asked?.includes('What is it like out'), JSON.stringify(asked))
ok('but the model was still asked the whole question',
   (msgs.at(-1)?.content ?? '').includes('what did I not finish yesterday'),
   JSON.stringify((msgs.at(-1)?.content ?? '').slice(0, 60)))
ok('the answer is in the thread as text',
   (await page.locator('.as-turn.is-it .as-said').first().textContent())?.includes('VZP'))
ok('the beats are kept apart rather than run together',
   await page.evaluate(() => getComputedStyle(document.querySelector('.as-turn.is-it .as-said')).whiteSpace === 'pre-line'),
   await page.evaluate(() => getComputedStyle(document.querySelector('.as-turn.is-it .as-said')).whiteSpace))
await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 8000 }).catch(() => {})
ok('and it is read out loud', (await page.evaluate(() => window.__spoken)).length === 1,
   JSON.stringify(await page.evaluate(() => window.__spoken)).slice(0, 60))

/* What the model was actually told. A brief that reaches the model without
   yesterday's leftovers or the weather still answers, and is worthless. */
/* THE SKY IS DRAWN, NOT DESCRIBED. He asked for a widget and got the figures
   read out in a sentence instead. Note the stubbed answer above names only the
   backlog card: the weather card must appear anyway, because whether he sees
   the forecast is not a thing to leave to whether the model remembered it. */
await page.waitForSelector('.wx-hour', { timeout: 10000 }).catch(() => {})
ok('the brief draws a weather card even though the answer did not name one',
   await page.locator('.wx').count() === 1, `${await page.locator('.wx').count()} cards`)
ok('it shows the temperature as a figure', (await page.locator('.wx-temp').textContent())?.startsWith('7'),
   await page.locator('.wx-temp').textContent())
ok('with the condition and the day\'s range',
   (await page.locator('.wx-sky').textContent())?.toLowerCase().includes('overcast')
   && (await page.locator('.wx-hilo').textContent())?.includes('12'),
   `${await page.locator('.wx-sky').textContent()} / ${await page.locator('.wx-hilo').textContent()}`)
ok('and an hour-by-hour strip', await page.locator('.wx-hour').count() === 8,
   `${await page.locator('.wx-hour').count()} hours`)
ok('each hour carries an icon, a chance of rain and a temperature',
   await page.locator('.wx-hour').first().locator('svg').count() === 1
   && (await page.locator('.wx-hour').first().innerText()).includes('55%')
   && (await page.locator('.wx-hour').first().innerText()).includes('7'),
   JSON.stringify(await page.locator('.wx-hour').first().innerText()))
/* Worth an umbrella is worth the accent; a 5% chance is noise. */
ok('a wet hour is marked and a dry one is not',
   await page.locator('.wx-hour').nth(0).locator('.wx-rain.is-wet').count() === 1
   && await page.locator('.wx-hour').nth(4).locator('.wx-rain.is-wet').count() === 0)
ok('the strip starts at the current hour, not at midnight',
   (await page.locator('.wx-at').first().textContent()) === '07:00',
   await page.locator('.wx-at').first().textContent())

/* Parse the request rather than pattern-matching it. The body is JSON, so its
   newlines are escaped, and a regex written against real newlines silently
   matches nothing and reports the section missing when it is right there. */
/* Match the briefing's own opening line. Searching for the word "briefing"
   alone returns the system prompt, which uses the word too, and then every
   assertion below reports the data missing while it is sitting right there. */
const briefing = msgs.map((m) => m.content).find((c) => c.startsWith("Today's briefing")) ?? ''
const system = msgs.map((m) => m.content).join('\n')
const leftovers = (briefing.match(/LEFT OVER FROM YESTERDAY, still not done:\n((?:- .*\n?)+)/) ?? [])[1]
ok("the briefing carries the weather, with the app's own figures",
   briefing.includes('7 degrees') && briefing.includes('overcast'),
   (briefing.match(/Weather.*/) ?? ['none'])[0].slice(0, 80))
ok("the briefing carries yesterday's unfinished work by name",
   !!leftovers && leftovers.includes('Send the VZP letter'), JSON.stringify(leftovers ?? 'section missing'))
ok("today's own work is not raised as a leftover",
   !!leftovers && !leftovers.includes('Blastburn'), JSON.stringify(leftovers ?? 'section missing'))
ok("the briefing still carries today's plan",
   briefing.includes('Draft the Blastburn quote'), briefing.includes('Blastburn') ? 'present' : 'MISSING')
/* The split itself is unit-tested in scripts/calkind-test.ts: the calendar
   needs a signed-in account this browser test does not have, and a fixture in
   localStorage does not survive, because a signed-out answer deliberately
   drops the cached calendar. What is checked HERE is that the briefing keeps
   the two apart and that the prompt knows the difference. */
ok('the briefing labels meetings as having other people in them',
   briefing.includes('Meetings, other people are in these') || briefing.includes('No meetings in the calendar'),
   JSON.stringify((briefing.match(/(Meetings[^\n]*|No meetings[^\n]*)/) ?? ['none'])[0]))
ok('the prompt says a block is not a meeting',
   system.includes('A MEETING AND A BLOCK ARE NOT THE SAME THING'))
ok('and says what to do with each',
   system.includes('Blocks are the day already working') && system.includes('Meetings are the walls'))

ok('the prompt tells it to take a position, not to recite',
   system.includes('YOU ARE HIS CHIEF OF STAFF') && system.includes('THE MORNING BRIEF'))
/* [Michael's Corner] leaked into the prose of a real answer: "start with
   [Michael's Corner] Build a SoMe post generator". The tags are plumbing so the
   model can tell the workspaces apart, and reading one aloud is reading a
   database row. */
ok('the prompt forbids reading a workspace tag out loud',
   system.includes('NEVER WRITE A WORKSPACE TAG'))
ok('the brief is specified as beats inside the say string',
   system.includes('the whole brief goes inside the "say" string'))
/* The template used to be written as a prose shape with placeholders on their
   own lines, which reads as "write this" rather than "put this in a string",
   and a model that follows it literally answers in prose and the whole thing
   comes back unreadable. There is a real JSON example now, and the contract is
   restated last, closest to the answer. */
/* THE EXAMPLE MUST ITSELF BE VALID JSON. It was not: written in a TypeScript
   template literal, \\n is a real newline, so the example the model is told to
   copy arrived split across actual lines and was not parseable. An invalid
   example is worse than no example. */
const example = (sysMsg.match(/\{"say":"Morning, Michael[^\n]*/) ?? [])[0]
ok('the brief example is on one line', !!example, JSON.stringify(example?.slice(0, 40) ?? 'missing'))
ok('and the example the model is told to copy is itself valid JSON', (() => {
  try { return JSON.parse(example).say.split('\n\n').length === 4 } catch { return false }
})(), (() => { try { return JSON.parse(example).say.split('\n\n').length + ' beats' } catch (e) { return 'NOT JSON: ' + e.message } })())
/* The SYSTEM message specifically: `system` joins every message, so it ends
   with his question, not with the prompt. */
ok('and the contract is restated at the very end of the prompt',
   sysMsg.trimEnd().endsWith('line breaks are \\n inside that string.'),
   JSON.stringify(sysMsg.trimEnd().slice(-46)))
ok('naming one task is now allowed, counts still are not',
   system.includes('YOU MUST NOT STATE COUNTS') && system.includes('TITLES ARE DIFFERENT'))

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
