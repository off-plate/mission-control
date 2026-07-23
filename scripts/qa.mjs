import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'

import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../docs')
const BASE = '/mission-control'
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const OUT = process.env.QA_OUT || resolve(HERE, '../.qa-shots')
mkdirSync(OUT, { recursive: true })

const server = createServer((req, res) => {
  let p = req.url.split('?')[0]
  if (p.startsWith(BASE)) p = p.slice(BASE.length)
  if (p === '' || p === '/') p = '/index.html'
  const file = join(ROOT, p)
  if (existsSync(file) && !file.endsWith('/')) {
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream')
    res.end(readFileSync(file))
  } else { res.statusCode = 404; res.end('nope') }
})
await new Promise((r) => server.listen(4180, r))

const browser = await chromium.launch()
const PAGES = ['today', 'plan', 'tasks', 'habits', 'goals', 'money', 'review', 'coach', 'stats', 'settings']
const VIEWS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'laptop', width: 1280, height: 850 },
  { name: 'uwide', width: 3440, height: 1300 },
]
const allErrors = []

for (const theme of ['light', 'dark']) {
  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.mobile ? 2 : 1,
      isMobile: !!v.mobile, hasTouch: !!v.mobile,
      colorScheme: theme,
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => allErrors.push(`${v.name}/${theme}: ${e}`))
    page.on('console', (m) => { if (m.type() === 'error') allErrors.push(`${v.name}/${theme} console: ${m.text()}`) })
    for (const p of PAGES) {
      await page.goto(`http://localhost:4180${BASE}/#/${p}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(450)
      await page.screenshot({ path: `${OUT}/${p}-${v.name}-${theme}.png`, fullPage: true })
    }
    await ctx.close()
  }
}

// functional pass at laptop/light: exercise every flow
const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => allErrors.push(`flow: ${e}`))
const log = []
const t = async (name, fn) => {
  try { await fn(); log.push(`PASS ${name}`) } catch (e) { log.push(`FAIL ${name}: ${String(e).slice(0, 160)}`) }
}
await page.goto(`http://localhost:4180${BASE}/#/today`, { waitUntil: 'networkidle' })

await t('decompose adds tasks', async () => {
  await page.getByRole('button', { name: 'Break it down' }).click()
  await page.getByLabel('What needs to happen?').fill('Plan next week')
  await page.getByRole('button', { name: 'Break down', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/flow-decompose.png` })
  await page.getByRole('button', { name: /Add as a task with \d+ subtasks/ }).click()
  await page.waitForTimeout(300)
  // guard: never let a stuck overlay cascade into later flows
  await page.keyboard.press('Escape').catch(() => {})
  if (await page.locator('.overlay').count()) throw new Error('decompose modal did not close')
})
await t('tasks page add + complete + actual', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/tasks`, { waitUntil: 'networkidle' })
  await page.getByLabel('New task title').fill('QA test task')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(200)
  const row = page.locator('.rowitem', { hasText: 'QA test task' })
  await row.locator('button.est-chip').click()
  await row.locator('.actual-chips button').first().click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/flow-tasks.png` })
})
await t('plan: expand subtasks, select, move to today, assign slot', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/plan`, { waitUntil: 'networkidle' })
  await page.locator('.expand-btn').first().click()
  await page.waitForTimeout(150)
  if (!(await page.locator('.subtask').count())) throw new Error('no subtasks after expand')
  await page.locator('.subtask').first().click()
  const todayBefore = await page.locator('.today-task').count()
  await page.locator('.select-box').first().click()
  await page.waitForTimeout(150)
  if (!(await page.locator('.movebar').isVisible())) throw new Error('move bar did not appear on select')
  await page.screenshot({ path: `${OUT}/flow-plan.png` })
  await page.getByRole('button', { name: 'Move to today →' }).click()
  await page.waitForTimeout(250)
  if ((await page.locator('.today-task').count()) <= todayBefore) throw new Error('task did not move to today')
  await page.locator('.today-task .slot-pick button').first().click()
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${OUT}/flow-today-after-plan.png` })
})
await t('plan: generate a task with subtasks', async () => {
  await page.getByLabel('Goal to break into subtasks').fill('Set up the bank payment plan')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.waitForTimeout(1000)
})
await t('habit toggle on habits page', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/habits`, { waitUntil: 'networkidle' })
  await page.locator('.daydot').first().click()
  await page.getByLabel('New habit name').fill('QA habit')
  await page.getByRole('button', { name: 'Add habit' }).click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/flow-habits.png` })
})
await t('goal add + bump', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/goals`, { waitUntil: 'networkidle' })
  await page.getByLabel('Goal name').fill('QA goal')
  await page.getByRole('button', { name: 'Add goal' }).click()
  await page.locator('.goal-row', { hasText: 'QA goal' }).getByRole('button', { name: /Progress/ }).click()
  await page.waitForTimeout(200)
})
await t('coach scenario end to end', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/coach`, { waitUntil: 'networkidle' })
  await page.locator('.scenario').first().click()
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click()
  await page.screenshot({ path: `${OUT}/flow-coach-laststep.png` })
  await page.getByRole('button', { name: 'Save the task' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/flow-coach-done.png` })
})
await t('review flow end to end', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/review`, { waitUntil: 'networkidle' })
  await page.getByLabel('Win 1').fill('Paid the installment on time')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('LinkedIn followers').fill('1300')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Outcome 1').fill('Send ten cold emails')
  await page.screenshot({ path: `${OUT}/flow-review.png` })
  await page.getByRole('button', { name: 'Close the week' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/flow-review-done.png` })
})
await t('settings toggle + edit grid', async () => {
  await page.goto(`http://localhost:4180${BASE}/#/settings`, { waitUntil: 'networkidle' })
  await page.locator('.toggle').first().click()
  await page.goto(`http://localhost:4180${BASE}/#/today`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Edit grid' }).click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/flow-edit-grid.png` })
})
await t('space switch + money redirect', async () => {
  await page.getByRole('button', { name: 'Off-Plate' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/flow-offplate.png` })
  await page.getByRole('button', { name: 'Work', exact: true }).click()
  await page.waitForTimeout(300)
})

console.log(log.join('\n'))
console.log('ERRORS:', allErrors.length ? allErrors.slice(0, 8) : 'none')
await browser.close()
server.close()
