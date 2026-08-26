/* Find any element still rendering the OLD green.

   Direction A has no green. It kept coming back one selector at a time because
   `--progress` had 75 uses and I was fixing them by hand from screenshots. This
   walks every element on every page and flags any fill, text or border whose
   hue lands in the green band, so the answer is a number instead of an opinion.

   Michael's Corner's mint accent (#86E9B4) is a real per-space accent and is
   expected to show up here. Everything else is a leftover.

   Usage: node tools/green-test.mjs docs
*/
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
const ROOT=process.argv[2]??'docs'
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.jpg':'image/jpeg','.webp':'image/webp'}
const PAGES=['today','plan','habits','goals','apps','assistant','notes','focus','settings','calendar']
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]).replace(/^\/mission-control/,'');if(p==='/'||p==='')p='/index.html'
 const f=join(ROOT,p);if(!existsSync(f)){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(join(ROOT,'index.html')))}
 r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(readFileSync(f))})
await new Promise(ok=>s.listen(0,ok))
const B=`http://localhost:${s.address().port}/mission-control/?noremote`
const br=await chromium.launch();const p=await br.newPage({viewport:{width:1600,height:1000}})
await p.goto(B,{waitUntil:'networkidle'});await p.waitForTimeout(1800)
/* A green is any colour whose hue sits in 90-170 degrees with real saturation.
   Naming hexes would miss the ones mixed with color-mix. */
const isGreen=`(c)=>{const m=c.match(/[\\d.]+/g);if(!m||m.length<3)return false;
 const [r,g,b]=m.slice(0,3).map(Number);const a=m.length>3?+m[3]:1;if(a<0.25)return false;
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn<26)return false;if(g!==mx)return false;
 /* HSL hue when green is the max channel is 60*(2 + (b-r)/delta). I had the
   subtraction the wrong way round, which scored lime at 173 instead of 67 and
   reported the palette's own accent as a leftover. */
 let h=60*(2+(b-r)/(mx-mn));return h>=95&&h<=185}`
let total=0
for(const pg of PAGES){
 await p.evaluate(h=>{location.hash='#/'+h},pg);await p.waitForTimeout(900)
 const hits=await p.evaluate(([src])=>{const isG=eval(src);const out=[]
  document.querySelectorAll('body *').forEach(el=>{const cs=getComputedStyle(el)
   const r=el.getBoundingClientRect();if(r.width<3||r.height<3)return
   for(const prop of ['backgroundColor','color','borderTopColor','borderLeftColor']){
    const v=cs[prop];if(isG(v)){out.push((el.className||el.tagName).toString().slice(0,30)+' '+prop+' '+v);break}}})
  return [...new Set(out)]},[isGreen])
 if(hits.length){console.log('--- '+pg);hits.slice(0,6).forEach(h=>console.log('   '+h))}
 total+=hits.length
}
console.log('green elements remaining: '+total)
await br.close();s.close();process.exitCode=total?1:0
