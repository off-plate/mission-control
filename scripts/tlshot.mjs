import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, extname } from 'path'
const HERE = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(HERE, '..', 'docs')
const OUT = resolve(HERE, '..', '.tl-shots'); mkdirSync(OUT, { recursive: true })
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}
const server=createServer((q,r)=>{const p=(q.url??'/').split('?')[0].replace(/^\/mission-control/,'')||'/'
 const f=join(DOCS,p==='/'?'index.html':p)
 if(!existsSync(f)){if(extname(f)){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':'text/html'});r.end(readFileSync(join(DOCS,'index.html')));return}
 r.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'});r.end(readFileSync(f))})
await new Promise(ok=>server.listen(0,ok))
const URL=`http://localhost:${server.address().port}/mission-control/?noremote`
const KEY='mission-control-demo-v12'
const d=new Date(); const key=(n)=>{const x=new Date(d);x.setDate(x.getDate()-n);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}

const b=await chromium.launch(); const errors=[]
for (const [w,tag] of [[1600,'desktop'],[430,'mobile']]) {
  const page=await b.newPage({viewport:{width:w,height:1000},deviceScaleFactor:2})
  page.on('pageerror',e=>errors.push(`[${w}] ${e.message}`))
  page.on('console',m=>{if(m.type()==='error')errors.push(`[${w}] ${m.text().slice(0,120)}`)})
  await page.goto(URL); await page.waitForTimeout(300)
  await page.evaluate(()=>{localStorage.setItem('mc-view','personal');localStorage.setItem('mc-space','personal')})
  await page.goto(`${URL}#/today`); await page.reload(); await page.waitForTimeout(900)
  await page.evaluate(([K,key0,key9,key40])=>{
    const s=JSON.parse(localStorage.getItem(K))
    s.tasks=[
      {id:'a1',title:'Email Moneta about the payment plan',list:'today',done:false,space:'personal',createdAt:key40,plannedOn:key0,estimateMin:30,estimated:true},
      {id:'a2',title:'Confirm VZP got the form',list:'today',done:false,space:'personal',createdAt:key9,plannedOn:key0,estimateMin:20,estimated:true},
      {id:'a3',title:'Status-check ARSTAS on documents',list:'backlog',done:false,space:'personal',createdAt:key9},
      {id:'a4',title:'Something fresh',list:'today',done:false,space:'personal',createdAt:key0},
    ]
    s.habits=[
      {id:'h1',name:'Sleep before 1 AM',kind:'build',frequency:'daily',space:'personal'},
      {id:'h2',name:'Workout / Gym / Fitness',kind:'build',frequency:'daily',space:'personal'},
      {id:'h3',name:'Doomscrolling',kind:'break',space:'personal'},
    ]
    s.habitLog=[{habitId:'h1',day:key0},{habitId:'h1',day:key9}]
    s.slips=[{habitId:'h3',day:key0},{habitId:'h3',day:key9},{habitId:'h3',day:key40}]
    s.goals=[{id:'g1',name:'Tax return filed',current:1,target:4,unit:'steps',space:'personal',deadline:key9},
             {id:'g2',name:'Payment plans agreed',current:3,target:4,unit:'steps',space:'personal'}]
    s.routines=[{id:'r1',title:'Sunday weekly reset',cadence:'weekly',space:'personal'},
                {id:'r2',title:'Morning ritual',cadence:'daily',space:'personal'}]
    s.routineLog=[{routineId:'r2',day:key0,periodKey:key0}]
    localStorage.setItem(K,JSON.stringify(s))
  },[KEY,key(0),key(9),key(40)])
  await page.goto(`${URL}#/timeline`); await page.reload(); await page.waitForTimeout(1100)
  const skip=page.getByRole('button',{name:'Not today'}); if(await skip.count()){await skip.first().click();await page.waitForTimeout(300)}
  await page.screenshot({path:join(OUT,`tl-${tag}.png`)})
  const gu=page.locator('.tl-giveup'); await gu.click(); await page.waitForTimeout(900)
  await page.screenshot({path:join(OUT,`giveup-${tag}.png`), fullPage: tag==='mobile'})
  if(tag==='desktop'){
    console.log(`cards: ${await page.locator('.tl-stat').count()}`)
    console.log(`header still there: ${await page.locator('.tl-giveup').count()>0}`)
    console.log(`button now says: "${(await gu.innerText()).trim()}"`)
    console.log(`old slider gone: ${await page.locator('.tl-scrub, .tl-stops').count()===0}`)
    const labels = await page.locator('.tl-stat-l').allInnerTexts()
    console.log('widgets:', labels.join(', '))
    await gu.click(); await page.waitForTimeout(600)
    console.log(`back to ladder via the same button: ${await page.locator('.tl-stat').count()===0}`)
  }
  await page.close()
}
await b.close(); server.close()
console.log(errors.length?`CONSOLE ERRORS:\n${errors.slice(0,6).join('\n')}`:'no console errors')
