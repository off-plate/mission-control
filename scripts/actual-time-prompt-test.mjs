import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const KEY = 'mission-control-demo-v12'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
const stubAssistant = async (reply) => {
  await page.unroute('**/api.groq.com/**').catch(() => {})
  await page.route('**/api.groq.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(reply) })
  })
}

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))

// Seed one open task with a real estimate, nothing logged yet -- exactly the
// case that reached him with no chance to say how long it actually took.
await page.evaluate((K) => {
  const s = JSON.parse(localStorage.getItem(K))
  s.tasks = [
    { id: 'inv-1', title: 'invoice Czech 33,000', source: 'mc', estimateMin: 20, estimated: true, done: false, space: 'personal', list: 'today', category: 'admin', createdAt: 'x', plannedOn: new Date().toISOString().slice(0, 10) },
  ]
  localStorage.setItem(K, JSON.stringify(s))
}, KEY)

await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)
await stubAssistant(JSON.stringify({ say: 'Marked it done.', show: [{ kind: 'today' }], do: [{ kind: 'done', match: 'invoice Czech 33,000' }] }))
await page.locator('.as-input').fill('mark invoice Czech 33,000 as done')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-did li.is-ok', { timeout: 8000 })

ok('the app reports the task done, in its own words', /Done: invoice/.test(await page.locator('.as-did li').first().innerText()))
const prompt = page.locator('.as-did .actual-log')
ok('the how-long prompt appears right under the done line', await prompt.count() === 1)
const chips = await prompt.locator('.actual-chip').allInnerTexts()
ok('the estimate itself is one of the offered chips', chips.some((c) => c.includes('20m')), chips.join(', '))
const skipBtn = prompt.locator('.actual-skip')
ok('a skip option is offered, meaning same as estimated', await skipBtn.count() === 1)

await skipBtn.click()
await page.waitForTimeout(300)
ok('the prompt closes itself once answered', await page.locator('.as-did .actual-log').count() === 0)
ok('the done line now says how long it took', /20m/.test(await page.locator('.as-did li').first().innerText()),
  await page.locator('.as-did li').first().innerText())

const saved = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks.find((t) => t.id === 'inv-1'), KEY)
ok('the real task actually got an actualMin, not just the UI text', saved?.actualMin === 20, JSON.stringify(saved))
ok('the task is genuinely marked done, not just visually', saved?.done === true)

// --- A custom chip click logs a different real number ---
await page.evaluate((K) => {
  const s = JSON.parse(localStorage.getItem(K))
  s.tasks = [{ id: 'inv-2', title: 'second task', source: 'mc', estimateMin: 30, estimated: true, done: false, space: 'personal', list: 'today', category: 'admin', createdAt: 'x', plannedOn: new Date().toISOString().slice(0, 10) }]
  localStorage.setItem(K, JSON.stringify(s))
}, KEY)
await page.reload(); await page.waitForTimeout(900)
await stubAssistant(JSON.stringify({ say: 'Done.', show: [], do: [{ kind: 'done', match: 'second task' }] }))
await page.locator('.as-input').fill('finish second task')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-did .actual-log', { timeout: 8000 })
await page.locator('.as-did .actual-log .actual-chip', { hasText: '15m' }).click()
await page.waitForTimeout(300)
const saved2 = await page.evaluate((K) => JSON.parse(localStorage.getItem(K)).tasks.find((t) => t.id === 'inv-2'), KEY)
ok('a real (non-estimate) chip logs its own real number', saved2?.actualMin === 15, JSON.stringify(saved2))

// --- A task marked done that already had a time logged does not re-ask ---
await page.evaluate((K) => {
  const s = JSON.parse(localStorage.getItem(K))
  s.tasks = [{ id: 'inv-3', title: 'third task', source: 'mc', estimateMin: 30, estimated: true, done: false, actualMin: 25, space: 'personal', list: 'today', category: 'admin', createdAt: 'x', plannedOn: new Date().toISOString().slice(0, 10) }]
  localStorage.setItem(K, JSON.stringify(s))
}, KEY)
await page.reload(); await page.waitForTimeout(900)
await stubAssistant(JSON.stringify({ say: 'Done.', show: [], do: [{ kind: 'done', match: 'third task' }] }))
await page.locator('.as-input').fill('finish third task')
await page.keyboard.press('Enter')
await page.waitForSelector('.as-did li.is-ok', { timeout: 8000 })
ok('a task that already had a time logged is not asked again', await page.locator('.as-did .actual-log').count() === 0)

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
