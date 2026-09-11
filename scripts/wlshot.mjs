/* Look at the Watchless page with a real transcript in it. The reader endpoint
   is stubbed with a realistic payload: a live call can spend a credit against a
   monthly cap, and a screenshot is not worth money. */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, '..', 'docs')
const OUT = resolve(HERE, '..', '.wl-shots'); mkdirSync(OUT, { recursive: true })
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' }
const server = createServer((req,res)=>{
  const p = (req.url??'/').split('?')[0].replace(/^\/mission-control/,'')||'/'
  const f = join(DOCS, p==='/'?'index.html':p)
  if(!existsSync(f)){ if(extname(f)){res.writeHead(404);res.end();return}
    res.writeHead(200,{'content-type':'text/html'}); res.end(readFileSync(join(DOCS,'index.html'))); return }
  res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'}); res.end(readFileSync(f))
})
await new Promise(ok=>server.listen(0,ok))
const URL = `http://localhost:${server.address().port}/mission-control/?noremote`

const cues = []
// What YouTube auto-captions actually look like: no capitals, no full stops,
// filler left in. This is the readability problem the tidy button addresses.
const lines = [
  'so the first thing people get wrong about this is they assume the model is the hard part',
  'it is not um the hard part is the data you feed it and what you do when it is wrong',
  'we spent about six weeks on evaluation before we wrote a single prompt for production',
  'and that felt slow at the time but it is the only reason we could ship anything at all',
  'the second mistake is uh measuring the wrong thing accuracy on a benchmark is not the job',
  'what matters is whether the person on the other end trusted the answer enough to act on it',
]
for (let i = 0; i < 90; i++) {
  const t = i * 12
  cues.push({ start: t, end: t + 12, text: lines[i % lines.length] })
}
const DOC = {
  videoId: 'dQw4w9WgXcQ',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'What six weeks of evaluation taught us about shipping AI',
  channel: 'Practical Machine Learning',
  duration: 1080, thumbnail: '', captionLang: 'en', captionSource: 'innertube',
  words: cues.reduce((n,c)=>n+c.text.split(' ').length,0),
  chapters: [
    { start: 0, title: 'Why the model is not the hard part' },
    { start: 240, title: 'Six weeks of evaluation' },
    { start: 600, title: 'Measuring the wrong thing' },
  ],
  segments: cues, cost: 0, cached: true,
  summary: 'The model is rarely what makes an AI project hard. Data quality and failure handling are.\n\nSix weeks of evaluation before writing production prompts felt slow but was what made shipping possible at all. Benchmark accuracy is the wrong measure: what counts is whether the reader trusted the answer enough to act on it.',
}

const b = await chromium.launch()
const errors = []
for (const [w,tag] of [[1500,'desktop'],[430,'mobile']]) {
  const page = await b.newPage({ viewport:{width:w,height:1000}, deviceScaleFactor:2 })
  page.on('pageerror',e=>errors.push(`[${w}] ${e.message}`))
  page.on('console',m=>{ if(m.type()==='error') errors.push(`[${w}] ${m.text().slice(0,120)}`) })
  await page.route('**/api/transcript*', r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(DOC) }))
  await page.goto(`${URL}#/watchless`); await page.reload(); await page.waitForTimeout(900)
  await page.screenshot({ path: join(OUT,`wl-empty-${tag}.png`) })
  await page.locator('.wl-input').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.locator('.wl-go').click(); await page.waitForTimeout(1200)
  await page.screenshot({ path: join(OUT,`wl-read-${tag}.png`), fullPage: tag==='mobile' })
  if (tag === 'desktop') {
    console.log(`blocks: ${await page.locator('.wl-block').count()}, chapters: ${await page.locator('.wl-chapters .wl-chip').count()}`)
    await page.locator('.wl-find input').fill('evaluation'); await page.waitForTimeout(600)
    console.log(`search hits: ${await page.locator('.wl-block.is-hit').count()}, marks: ${await page.locator('.wl-text mark').count()}, count label: ${await page.locator('.wl-count').innerText()}`)
    await page.screenshot({ path: join(OUT,'wl-search-desktop.png') })
  }
  if (tag === 'desktop') {
    await page.locator('.wl-find input').fill('')
    const tidyBtn = page.locator('.wl-tool', { hasText: /Tidy/ })
    console.log(`tidy button present: ${await tidyBtn.count() > 0} (shows only with an AI key set)`)
  }
  await page.close()
}
await b.close(); server.close()
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.slice(0,6).join('\n')}` : 'no console errors')
