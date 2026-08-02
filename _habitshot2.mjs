import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, 'docs')
const OUT = '/private/tmp/claude-501/-Users-michaelflorianrvltdigital-Claude-Helpers-Jarvis/b6bada4e-ea5d-4da2-b7b8-c483cb34e1d5/scratchpad/shots'
mkdirSync(OUT, { recursive: true })
const PORT = 8401
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0].replace(/^\/mission-control/, '') || '/'
  const file = join(DOCS, path === '/' ? 'index.html' : path)
  if (!existsSync(file)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(PORT, ok))
const URL = `http://localhost:${PORT}/mission-control/?noremote`
const KEY = 'mission-control-demo-v12'
const b = await chromium.launch()

const seed = async (ctx) => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: 2560, height: 1400 })
  await p.goto(URL); await p.waitForTimeout(400)
  await p.evaluate((K) => localStorage.removeItem(K), KEY)
  await p.goto(`${URL}#/habits`); await p.reload(); await p.waitForTimeout(900)
  const cards = await p.locator('.habit-card').all()
  for (let ci = 0; ci < cards.length; ci++) {
    const dots = await cards[ci].locator('.daydot:not([disabled])').all()
    for (let di = 0; di < dots.length; di++) if ((ci + di) % 3 !== 0) { try { await dots[di].click({ timeout: 700 }) } catch {} }
  }
  await p.waitForTimeout(500)
  await p.close()
}

const ctx = await b.newContext({ viewport: { width: 2560, height: 1400 }, deviceScaleFactor: 1 })
await seed(ctx)
const grab = async (name, w, h, opts = {}) => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width: w, height: h })
  await p.goto(`${URL}#/habits`); await p.waitForTimeout(1000)
  if (opts.dark) { await p.evaluate(() => { const t = document.querySelector('[aria-label*="heme" i], .theme-toggle'); }); }
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300)
  if (opts.clip) { const el = p.locator(opts.clip).first(); await el.screenshot({ path: join(OUT, name + '.png') }) }
  else await p.screenshot({ path: join(OUT, name + '.png'), fullPage: !!opts.full })
  if (opts.report) {
    const r = await p.evaluate(() => {
      const out = {}
      const head = document.querySelector('.section-head')
      if (head) { const l = head.querySelector('.microcap').getBoundingClientRect(); const c = head.querySelector('.section-count').getBoundingClientRect(); out.headGap = Math.round(c.left - l.right) }
      out.sections = [...document.querySelectorAll('.habit-section')].map(s => ({ label: s.querySelector('.microcap')?.textContent, n: s.querySelectorAll('.habit-card').length, h: Math.round(s.getBoundingClientRect().height) }))
      const card = document.querySelector('.habit-card')
      if (card) { const cs = getComputedStyle(card); out.card = { shadow: cs.boxShadow, border: cs.border, radius: cs.borderRadius, pad: cs.padding, h: Math.round(card.getBoundingClientRect().height), w: Math.round(card.getBoundingClientRect().width) } }
      const f = (sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e); return { text: e.textContent.trim().slice(0,40), size: cs.fontSize, weight: cs.fontWeight, color: cs.color, family: cs.fontFamily.split(',')[0] } }
      out.type = { name: f('.habit-name'), count: f('.habit-count'), freq: f('.habit-freq'), weeks: f('.habit-weeks'), auto: f('.habit-auto'), micro: f('.section-head .microcap'), sectioncount: f('.section-count') }
      const dot = document.querySelector('.daydot'); if (dot) { const r = dot.getBoundingClientRect(); out.dot = { w: Math.round(r.width), h: Math.round(r.height) } }
      const doc = document.documentElement
      out.overflow = doc.scrollWidth > doc.clientWidth ? doc.scrollWidth - doc.clientWidth : 0
      out.pageH = Math.round(document.querySelector('.page').getBoundingClientRect().height)
      return out
    })
    console.log(name, JSON.stringify(r, null, 1))
  }
  await p.close()
}
await grab('top-2560', 2560, 1400, { report: true })
await grab('top-1440', 1440, 900, { report: true })
await grab('card-detail', 2560, 1400, { clip: '.habit-card' })
await grab('section-detail', 2560, 1400, { clip: '.habit-section' })

// phone
const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = await pctx.newPage()
await pp.goto(URL); await pp.waitForTimeout(300)
await pp.evaluate((K, s) => localStorage.setItem(K, s), KEY, await (async () => { const t = await ctx.newPage(); await t.goto(URL); await t.waitForTimeout(400); const v = await t.evaluate((K) => localStorage.getItem(K), KEY); await t.close(); return v })())
await pp.goto(`${URL}#/habits`); await pp.reload(); await pp.waitForTimeout(1000)
await pp.screenshot({ path: join(OUT, 'phone-top.png') })
await pp.screenshot({ path: join(OUT, 'phone-fullpage.png'), fullPage: true })
const pr = await pp.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, pageH: Math.round(document.querySelector('.page').getBoundingClientRect().height), dot: (() => { const d = document.querySelector('.daydot'); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })(), card: Math.round(document.querySelector('.habit-card').getBoundingClientRect().height) }))
console.log('phone', JSON.stringify(pr))
await pp.close()
console.log('done')
await b.close(); server.close()
