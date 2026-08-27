import { chromium } from 'playwright'
const URL = process.argv[2] || 'http://localhost:4178/mission-control'
const KEY = 'mission-control-demo-v12'
const b = await chromium.launch()
const page = await b.newPage()
const fails = []
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!c) fails.push(n) }

let lastSystemMsg = ''
await page.route('**/api.groq.com/**', (r) => {
  try {
    const body = JSON.parse(r.request().postData() || '{}')
    lastSystemMsg = (body.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n---\n')
  } catch { /* ignore */ }
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ say: 'ok', show: [], next: [] }) } }] }) })
})

await page.goto(URL); await page.waitForTimeout(600)
const local = page.locator('button', { hasText: /Use this device only/i })
if (await local.count()) { await local.first().click(); await page.waitForTimeout(900) }
await page.evaluate(() => localStorage.setItem('mc-groq-key', 'gsk_test'))

// Seed a task done yesterday, by doneAt, with plannedOn already cleared the way
// the real rollover leaves it -- exactly the state briefText() has to work from.
// One title carries a real pasted URL, and one is a URL with nothing else, the
// two shapes Michael actually hit in production.
await page.evaluate((K) => {
  const s = JSON.parse(localStorage.getItem(K))
  const yd = new Date(); yd.setDate(yd.getDate() - 1)
  s.tasks = [
    { id: 'fy-t1', title: 'Updated the strategic tabulka', source: 'mc', estimateMin: 20, done: true, doneAt: yd.toISOString(), space: 'personal', list: 'backlog', category: 'admin', createdAt: 'x' },
    { id: 'fy-t2', title: 'Build a website for this barber: https://www.masdos8.com/galerie', source: 'mc', estimateMin: 20, done: true, doneAt: yd.toISOString(), space: 'offplate', list: 'backlog', category: 'admin', createdAt: 'x' },
    { id: 'fy-t3', title: 'https://noah-restaurant.com/', source: 'mc', estimateMin: 20, done: true, doneAt: yd.toISOString(), space: 'offplate', list: 'backlog', category: 'admin', createdAt: 'x' },
    // A task done TODAY must not show up as yesterday's.
    { id: 'fy-t4', title: 'Should not appear as yesterday', source: 'mc', estimateMin: 20, done: true, doneAt: new Date().toISOString(), space: 'personal', list: 'backlog', category: 'admin', createdAt: 'x' },
  ]
  localStorage.setItem(K, JSON.stringify(s))
}, KEY)

await page.goto(`${URL}/#/assistant`); await page.reload(); await page.waitForTimeout(1200)
await page.locator('.as-input').fill('Give me my morning brief.')
await page.keyboard.press('Enter')
await page.waitForTimeout(900)

ok('the system prompt carries a FINISHED YESTERDAY section', /FINISHED YESTERDAY/.test(lastSystemMsg), lastSystemMsg.slice(0, 40))
ok('a plain-title completion is named', lastSystemMsg.includes('Updated the strategic tabulka'))
ok('a title with a pasted URL keeps its words and loses the link',
  lastSystemMsg.includes('Build a website for this barber') && !lastSystemMsg.includes('masdos8.com'),
  lastSystemMsg.split('\n').find((l) => l.includes('barber')))
ok('a title that was ONLY a URL never reaches the model as an empty bullet',
  !/FINISHED YESTERDAY:[\s\S]*?\n- \n/.test(lastSystemMsg) && !lastSystemMsg.includes('noah-restaurant.com'),
  lastSystemMsg.slice(lastSystemMsg.indexOf('FINISHED YESTERDAY'), lastSystemMsg.indexOf('FINISHED YESTERDAY') + 200))
ok('a task finished today is not counted as yesterday', !/FINISHED YESTERDAY:[^\n]*Should not appear/.test(lastSystemMsg))

// --- Nothing finished yesterday: the section should say so plainly, not omit itself ---
await page.evaluate((K) => {
  const s = JSON.parse(localStorage.getItem(K))
  s.tasks = []
  localStorage.setItem(K, JSON.stringify(s))
}, KEY)
await page.reload(); await page.waitForTimeout(900)
await page.locator('.as-input').fill('Give me my morning brief.')
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
ok('an empty yesterday still reports itself, not silence', /Nothing marked done yesterday/.test(lastSystemMsg), lastSystemMsg.slice(0, 60))

await b.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
