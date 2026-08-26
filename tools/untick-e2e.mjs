/* Untick a habit, reload, and it must still be unticked.

   His report: "I checked one of the habits, and then I realized that I didn't
   basically do the habit. And I'm trying to unclick it. But whenever I unclick
   it, on the next synchronization or page reload, it's brought back."

   Two independent causes, and this covers the STORE's half: removing the row
   from habitLog left no tombstone, so the merge's union handed it straight back
   from the other device. Every other removal in store.tsx buries its key; this
   one did not. The MERGE's half is covered by tools/untick-test.mjs.

   It runs on its own rather than inside scripts/qa.mjs. Seventy five steps run
   before it there and the same click that passes first time on a clean page
   times out at the end of the suite, which is a fact about the harness and not
   about the app. A gate that is flaky for reasons unrelated to what it asserts
   teaches you to ignore it.

   Run: node tools/untick-e2e.mjs [docs]
*/
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const ROOT = process.argv[2] ?? 'docs'
const KEY = 'mission-control-demo-v12'
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const srv = createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/mission-control/, '')
  if (p === '/' || p === '') p = '/index.html'
  const f = join(ROOT, p)
  if (!existsSync(f)) { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end(readFileSync(join(ROOT, 'index.html'))) }
  r.writeHead(200, { 'Content-Type': T[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f))
})
await new Promise((ok) => srv.listen(0, ok))
const URL_ = `http://localhost:${srv.address().port}/mission-control/?noremote`

let fail = 0
const ok = (cond, what) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + what); if (!cond) fail++ }

const br = await chromium.launch()
const page = await br.newPage({ viewport: { width: 1500, height: 1200 } })
try {
  /* Let the app seed itself, then record today as already reviewed and reload.

     The daily review is `aria-modal` and swallows every click behind it. Fought
     from the UI it kept coming back: it renders a beat after load so a bare
     count() finds nothing, it returns after the final reload, and its dismiss
     button is inside the very subtree that is intercepting. Setting the fact it
     asks about is one line and cannot race.

     The failure was invisible in a screenshot and named plainly in Playwright's
     own log: "dr-screen subtree intercepts pointer events". Read the whole
     error before theorising about the app. */
  await page.goto(URL_); await page.waitForTimeout(1200)
  await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K) ?? '{}')
    const d = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    st.dailySkipped = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    localStorage.setItem(K, JSON.stringify(st))
  }, KEY)
  await page.goto(`${URL_}#/habits`); await page.reload(); await page.waitForTimeout(1000)
  if (await page.locator('.dr-screen').count()) throw new Error('the daily review is still up; it will swallow every click')

  /* Not disabled: some habits are gated, and a locked dot is not his to tick
     by clicking. */
  const dot = page.locator('.day-cell.is-today .daydot:not([disabled]):visible').first()
  const label = await dot.getAttribute('aria-label')

  await dot.click(); await page.waitForTimeout(400)
  ok((await dot.getAttribute('aria-checked')) === 'true', 'the tick takes')

  await dot.click(); await page.waitForTimeout(400)
  ok((await dot.getAttribute('aria-checked')) === 'false', 'the untick takes on screen')

  const buried = await page.evaluate((K) => {
    const st = JSON.parse(localStorage.getItem(K))
    return (st.graveyard ?? []).some((t) => t.k.startsWith('habitLog:') && !t.undone)
  }, KEY)
  ok(buried, 'the untick leaves a tombstone, so a sync cannot hand the tick back')

  await page.reload(); await page.waitForTimeout(900)
  const after = page.locator(`.day-cell.is-today .daydot[aria-label="${label}"]`).first()
  ok((await after.getAttribute('aria-checked')) === 'false', 'and it is still unticked after a reload')
} finally {
  await br.close(); srv.close()
}
console.log(fail ? `\n${fail} failed` : '\nall untick checks passed')
process.exitCode = fail ? 1 : 0
