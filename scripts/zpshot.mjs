import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, extname, resolve } from 'path'
const DOCS=resolve('/tmp/mc-zp/docs'), OUT='/tmp/zp-shots'; mkdirSync(OUT,{recursive:true})
const M={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}
const s=createServer((q,r)=>{const p=(q.url??'/').split('?')[0].replace(/^\/mission-control/,'')||'/'
 const f=join(DOCS,p==='/'?'index.html':p)
 if(!existsSync(f)){if(extname(f)){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':'text/html'});r.end(readFileSync(join(DOCS,'index.html')));return}
 r.writeHead(200,{'content-type':M[extname(f)]??'application/octet-stream'});r.end(readFileSync(f))})
await new Promise(ok=>s.listen(0,ok))
const URL=`http://localhost:${s.address().port}/mission-control/?noremote`, KEY='mission-control-demo-v12'
const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1500,height:1100},deviceScaleFactor:2})
const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,120))})
await page.goto(URL); await page.waitForTimeout(300)
await page.evaluate(()=>{localStorage.setItem('mc-view','personal');localStorage.setItem('mc-space','personal');localStorage.removeItem('mc-pomodoro')})
await page.goto(`${URL}#/zone`); await page.reload(); await page.waitForTimeout(1500)
const skip=page.getByRole('button',{name:'Not today'}); if(await skip.count()){await skip.first().click();await page.waitForTimeout(300)}
console.log('source line (default):', await page.locator('.zplayer-source').innerText())
await page.locator('.zplayer-btn[aria-label="Show the queue"]').click(); await page.waitForTimeout(500)
console.log('queue rows:', await page.locator('.zqueue-row').count())
await page.screenshot({path:join(OUT,'queue.png')})
// paste his own links
await page.locator('.zqueue-add').click(); await page.waitForTimeout(400)
await page.locator('.zlib textarea').fill(['https://www.youtube.com/watch?v=jfKfPfyJRdk','https://youtu.be/5qap5aO4i9A','not-a-link','https://www.youtube.com/watch?v=lTRiuFIWV54'].join('\n'))
await page.waitForTimeout(300)
console.log('library foot:', await page.locator('.zlib-foot span').innerText())
await page.screenshot({path:join(OUT,'library.png')})
await page.locator('.zlib-save').click(); await page.waitForTimeout(2500)
console.log('source line (his):', await page.locator('.zplayer-source').innerText())
console.log('header title:', await page.locator('.zplayer-title').innerText())
await page.locator('.zplayer-btn[aria-label="Show the queue"]').click(); await page.waitForTimeout(1200)
const titles=await page.locator('.zqueue-title').allInnerTexts()
console.log('his queue:', titles.length, '->', titles.map(t=>t.slice(0,34)).join(' | '))
await page.screenshot({path:join(OUT,'his-queue.png')})
// click the third track directly
await page.locator('.zqueue-row').nth(2).click(); await page.waitForTimeout(900)
console.log('now playing row on?', await page.locator('.zqueue-row.is-on').count(), 'index-2 is on?', await page.locator('.zqueue-row').nth(2).evaluate(e=>e.classList.contains('is-on')))
console.log('persisted tunes:', await page.evaluate(K=>(JSON.parse(localStorage.getItem(K)??'{}').tunes??[]).length, KEY))
await b.close(); s.close()
console.log(errs.length?`ERRORS: ${errs.slice(0,4).join(' | ')}`:'no console errors')
