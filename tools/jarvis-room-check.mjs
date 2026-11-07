/* The JARVIS room, driven for real (?noremote, scripted model, never his data).
   `node tools/jarvis-room-check.mjs` after `npm run build`. Exits non-zero on the first broken rule.

   What it holds the room to (his report, 2026-11-07):
   - the core steps aside to a small mark beside the name once he talks, and the
     thread gets the height back
   - the changes list lives on the right, collapsed to one line; a failure stays open
   - a task title keeps the row: its #project tag runs inline, no title is cut
   - a plan reads by the clock
   - the suggestion chips are one row with no pill shapes
   - the focus starter appears and asks the assistant
   - below 1000px (no right panel) the changes stay in the thread, and the core still steps aside
   Real-style long Czech titles, at the narrowest supported width. */
import { chromium, webkit } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, cpSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
import assert from 'assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP = mkdtempSync(join(tmpdir(), 'mc-jv-'))
cpSync(resolve(HERE, '..', 'docs'), SNAP, { recursive: true })
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(SNAP, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) {
    if (extname(file)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(join(SNAP, 'index.html'))); return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`
const OUT = process.env.JV_OUT || ''
if (OUT) mkdirSync(OUT, { recursive: true })

/* Real titles, long and Czech, with real-style project tags. */
const T = (title, project, space, at, slot) => ({ kind: 'add', title, project, space, at, slot, date: new Date().toLocaleDateString('sv') })
const DAY = [
  T('Omluvený email Elizabeth - Too much with CTP, nezapomenout se omluvit i za zpoždění', 'elizabethbackontrack', 'work', '13:15', 'noon'),
  T('100 clients reachout', 'offplate', 'personal', '13:30', 'noon'),
  T('Připravit tabulku pro Michala ohledně ctp park oages', null, 'work', '15:00', 'afternoon'),
  T('Automatizace newsletteru od Terky', null, 'work', '16:00', 'afternoon'),
  T('Připrvavit nacenění na rezevrační systém', 'maserpanjiri', 'personal', '16:45', 'afternoon'),
  T('Zpracovat feedback', 'sonar', 'work', '15:30', 'afternoon'),
]
const PROJECTS = ['elizabethbackontrack', 'offplate', 'maserpanjiri', 'sonar'].map((name) => ({ kind: 'project', name, space: name === 'offplate' || name === 'maserpanjiri' ? 'personal' : 'work' }))
const REPLIES = [
  { say: 'Setting the whole afternoon, in order.', do: [...PROJECTS, ...DAY], show: [{ kind: 'today' }], next: ['Move the 100 clients reachout to 19:00', 'Which items are left for tomorrow?', 'Plan tomorrow around the voucher website'] },
  { say: 'Here is where focus stands.', do: [], show: [{ kind: 'focus' }], next: ['Plan the evening'] },
]
const asked = []

async function run(label, browserType, viewport) {
  const browser = await browserType.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let n = 0
  await page.route('**/api.groq.com/**', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}')
    const last = body.messages?.at(-1)?.content ?? ''
    asked.push(last)
    const reply = REPLIES[Math.min(n++, REPLIES.length - 1)]
    const content = JSON.stringify(reply)
    if (body.stream) {
      await r.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` })
    } else {
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) })
    }
  })
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate(() => { localStorage.setItem('mc-groq-key', 'test'); localStorage.setItem('mc-claude-brain', '0') })
  await page.goto(`${URL}#/today`); await page.reload(); await page.waitForTimeout(800)
  /* Under 640px the app is the separate Nothing phone shell, which has its own JARVIS view; this
     room (AssistantPage) is what 640px and up shows, split into three columns from 1000px. */
  await page.getByRole('button', { name: 'JARVIS, the assistant' }).click()
  await page.waitForSelector('.as-page.jv', { timeout: 15000 }); await page.waitForTimeout(800)
  const box = (sel) => page.locator(sel).first().boundingBox()
  const split = viewport.width >= 1000
  const shot = async (name) => { if (OUT) await page.screenshot({ path: join(OUT, `${label}-${name}.png`) }) }

  /* 1. Empty room: the core fills the column. */
  const before = await box('.jv-stage'), threadBefore = await box('.jv-thread')
  assert.ok(before.height >= 200, `${label}: the empty room's core is big (${before.height})`)
  await shot('1-empty')

  /* 2. First message: it steps aside, the thread grows. */
  await page.locator('.as-input').fill('Put the whole afternoon into my day, in order, every block, nothing skipped')
  await page.locator('.as-input').press('Enter')
  await page.waitForSelector('.as-turn.is-it', { timeout: 15000 })
  await page.waitForTimeout(1400)
  const st = await box('.jv-stage'), pres = await box('.jv-presence'), threadAfter = await box('.jv-thread')
  assert.ok(Math.abs(st.width - 64) <= 2 && Math.abs(st.height - 64) <= 2, `${label}: core is a 64px mark once talking (${st.width}x${st.height})`)
  assert.ok(pres.x >= st.x + st.width - 1, `${label}: the name sits beside the mark, not under it`)
  assert.ok(Math.abs((pres.y + pres.height / 2) - (st.y + st.height / 2)) <= 10, `${label}: name and mark share a centre line`)
  assert.ok(threadAfter.height >= threadBefore.height + 120, `${label}: the thread got the height back (${threadBefore.height} -> ${threadAfter.height})`)
  await shot('2-talking')

  /* 3. The changes: right panel on wide, in the thread on the phone. */
  if (split) {
    assert.equal(await page.locator('.jv-thread .as-did').count(), 0, `${label}: no change list stacked in the chat`)
    assert.equal(await page.locator('.jv-thread .as-act-ref').count(), 1, `${label}: one pointer line in the chat`)
    const sum = (await page.locator('.as-act-toggle').innerText()).trim()
    assert.match(sum, /^\d+ changes applied$/, `${label}: summary line, got "${sum}"`)
    assert.equal(await page.locator('.as-act-list').count(), 0, `${label}: collapsed by default`)
    await page.locator('.as-act-toggle').click(); await page.waitForTimeout(250)
    assert.ok((await page.locator('.as-act-list li').count()) >= 10, `${label}: opens to every change`)
    await shot('3-changes-open')
    await page.locator('.as-act-toggle').click()
  } else {
    assert.ok((await page.locator('.jv-thread .as-did li').count()) >= 10, `${label}: the phone keeps its in-thread list`)
    assert.equal(await page.locator('.as-act').count(), 0, `${label}: no right panel on the phone`)
  }

  /* 4. Task titles keep the row. */
  const titles = await page.locator(split ? '.as-canvas .as-row-title' : '.as-card .as-row-title').evaluateAll((els) => els.map((e) => ({
    t: e.textContent, w: e.getBoundingClientRect().width, rowW: e.parentElement.getBoundingClientRect().width,
    over: e.scrollWidth > e.clientWidth + 1, tag: !!e.querySelector('.tagmark'),
  })))
  assert.ok(titles.length >= 6, `${label}: ${titles.length} task rows on screen`)
  for (const x of titles) {
    assert.equal(x.over, false, `${label}: title cut off: "${x.t}"`)
    assert.ok(x.w >= x.rowW * 0.5, `${label}: title squeezed to ${Math.round(x.w)}px of a ${Math.round(x.rowW)}px row: "${x.t}"`)
  }
  assert.ok(titles.filter((x) => x.tag).length >= 3, `${label}: project tags run inside the title`)
  assert.equal(await page.locator('.as-row > .tagmark').count(), 0, `${label}: no tag left as its own flex item`)

  /* The day leads, wherever the cards are drawn. */
  const firstCard = await page.locator(split ? '.as-canvas .as-pane-head, .as-canvas .microcap' : '.as-card h3').first().innerText()
  assert.match(firstCard, /day|today|noon/i, `${label}: the day card leads, got "${firstCard}"`)

  /* 5. A plan reads by the clock. */
  if (split) {
    const afternoon = await page.locator('.as-canvas .as-group').evaluateAll((gs) => {
      const g = gs.find((x) => /afternoon/i.test(x.querySelector('.microcap')?.textContent ?? ''))
      return g ? [...g.querySelectorAll('.as-row-min')].map((e) => e.textContent.trim()) : []
    })
    assert.deepEqual(afternoon, ['15:00', '15:30', '16:00', '16:45'], `${label}: afternoon in clock order`)
  }

  /* 6. Chips: one row, no pills. */
  const chips = await page.locator('.as-next').last().evaluate((el) => ({
    h: el.getBoundingClientRect().height, n: el.children.length,
    radii: [...el.children].map((c) => getComputedStyle(c).borderTopLeftRadius),
  }))
  assert.equal(chips.n, 3, `${label}: three suggestions`)
  assert.ok(chips.h <= 40, `${label}: the suggestions are one row (${chips.h}px)`)
  assert.ok(chips.radii.every((r) => parseFloat(r) < 12), `${label}: no pill shapes (${chips.radii})`)
  /* Too long to fit: it says so (the edge fades), and the wheel reaches the last one. */
  const row = page.locator('.as-next').last()
  const over = await row.evaluate((el) => el.scrollWidth > el.clientWidth + 2)
  if (over) {
    assert.equal(await row.getAttribute('data-more'), 'true', `${label}: an overflowing row marks itself`)
    await row.hover(); await page.mouse.wheel(0, 400); await page.waitForTimeout(300)
    assert.equal(await row.getAttribute('data-more'), 'false', `${label}: the wheel scrolls the row to its last chip`)
    const last = await row.locator('.as-chip').last().boundingBox(), rb = await row.boundingBox()
    assert.ok(last.x + last.width <= rb.x + rb.width + 1, `${label}: the last chip is fully reachable`)
  }

  /* 7. Focus starter: shows, asks the assistant. */
  if (split) {
    await page.locator('.as-input').fill('Open focus for me')
    await page.locator('.as-input').press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('.as-focus-btn').length === 3, null, { timeout: 15000 })
    assert.equal(await page.locator('.as-act').count(), 0, `${label}: the focus view does not carry an older answer's changes`)
    /* ...and they come back from that answer's own line in the chat. */
    await page.locator('.as-act-ref').first().click(); await page.waitForTimeout(300)
    assert.equal(await page.locator('.as-act').count(), 1, `${label}: the pointer line brings an older answer's changes back`)
    assert.match(await page.locator('.as-act-toggle').innerText(), /^\d+ changes applied$/, `${label}: the right answer's changes`)
    await page.locator('.as-input').fill('Open focus again')
    await page.locator('.as-input').press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('.as-act').length === 0, null, { timeout: 15000 })
    await shot('4-focus')
    await page.locator('.as-focus-btn', { hasText: '25 min' }).click(); await page.waitForTimeout(600)
    assert.ok(asked.some((q) => q.includes('Start a 25 minute focus timer')), `${label}: the starter asked the assistant`)
  }
  assert.deepEqual(errors, [], `${label}: page errors`)
  await browser.close()
  console.log(`ok  ${label}`)
}

try {
  await run('wide-1440', chromium, { width: 1440, height: 900 })
  await run('wide-1920', chromium, { width: 1920, height: 1080 })
  await run('narrow-700-webkit', webkit, { width: 700, height: 900 })
  console.log('JARVIS room: all checks passed.')
} finally { server.close() }
