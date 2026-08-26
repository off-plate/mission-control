/* Hover every button on every page and assert the label survives.

   Written because a screenshot of the Morning brief button turned up black
   with no text on it. The cause was `.btn::before`, a hover wipe applied
   app-wide, painting over any label that was a bare text node rather than an
   element. It looked fine in the one place I checked and was broken in the
   rest, which is exactly the class of bug a gate exists for.

   Two things this script learned the hard way and both matter:
   - a `::before` scaled in IS the effective background at any z-index, since
     -1 still paints above the button's own fill and below its text;
   - a background may be TRANSLUCENT, and a 5% ink wash is not near-black. The
     whole stack is composited down to an opaque colour before comparing, or
     every wash reads as a failure that is not there.

   Usage: node tools/button-test.mjs docs
*/
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
const ROOT=process.argv[2] ?? 'docs';
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.jpg':'image/jpeg','.webp':'image/webp'};
function lin(c){c/=255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4)}
function L(a){return 0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2])}
function parse(s){if(!s)return[0,0,0,1];
 if(s.startsWith('color(')){const n=s.match(/[\d.]+/g).map(Number);return[n[0]*255,n[1]*255,n[2]*255,n.length>3?n[3]:1]}
 const n=s.match(/[\d.]+/g).map(Number);return[n[0],n[1],n[2],n.length>3?n[3]:1]}
const over=(f,b)=>[0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3]));
/* A background may be TRANSLUCENT, and a 5% ink wash is not near-black, it is
   very slightly darker than whatever is behind it. Composite the stack down to
   an opaque colour before comparing, or every wash reads as a failure. */
function compositeStack(stack){
  let out=[250,248,244];
  for(let i=stack.length-1;i>=0;i--){const c=parse(stack[i]);if(!c[3])continue;out=over(c,out)}
  return out;
}
const PAGES=['today','plan','habits','goals','apps','assistant','notes','focus','settings','calendar'];
const s=createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]).replace(/^\/mission-control/,'');if(p==='/'||p==='')p='/index.html';
 const f=join(ROOT,p);if(!existsSync(f)){r.writeHead(200,{'Content-Type':'text/html'});return r.end(readFileSync(join(ROOT,'index.html')))}
 r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(readFileSync(f))});
s.listen(0,async()=>{const B='http://localhost:'+s.address().port+'/mission-control/?noremote';
const br=await chromium.launch();let bad=0,n=0;
const p=await br.newPage({viewport:{width:1600,height:1000}});
await p.goto(B,{waitUntil:'networkidle'});await p.waitForTimeout(1800);
for(const pg of PAGES){
 await p.evaluate(h=>{location.hash='#/'+h},pg);await p.waitForTimeout(900);
 const btns=await p.$$('button, a.btn');
 for(const b of btns){
  const info=await b.evaluate(el=>{
   const t=el.textContent.trim(); if(!t) return null;
   const r=el.getBoundingClientRect(); if(r.width<8||r.height<8) return null;
   return {t:t.slice(0,24),cls:(el.className||'').toString().slice(0,30)}});
  if(!info) continue;
  // read the label colour against the button's own fill, at rest and hovered
  const read=async()=>b.evaluate(el=>{const cs=getComputedStyle(el);
    const st=[];let node=el;
    while(node){const b=getComputedStyle(node).backgroundColor;
      if(b&&!/rgba\(0, 0, 0, 0\)/.test(b)&&b!=='transparent')st.push(b);node=node.parentElement}
    // the wipe pseudo, if it is covering, decides what the label sits on
    const pb=getComputedStyle(el,'::before');
    /* a ::before scaled in IS the effective background, at any z-index: -1 still
       paints above the button's own fill and below its text. */
    const covering=pb.content!=='none'&&pb.transform&&!/matrix\(0/.test(pb.transform);
    return {fg:cs.color,bg:covering?[pb.backgroundColor,...st]:st}});
  const rest=await read();
  await b.hover({force:true}).catch(()=>{}); await p.waitForTimeout(220);
  const hov=await read();
  await p.mouse.move(0,0); await p.waitForTimeout(80);
  n++;
  for(const [state,v] of [['rest',rest],['hover',hov]]){
   const bg=compositeStack(v.bg),fg=over(parse(v.fg),bg);
   const c=(Math.max(L(fg),L(bg))+0.05)/(Math.min(L(fg),L(bg))+0.05);
   if(c<3){bad++;console.log('LOW '+c.toFixed(2)+'  '+pg.padEnd(10)+state.padEnd(6)+'."'+info.cls+'"  "'+info.t+'"  fg '+v.fg+'  bg '+v.bg)}
  }
 }
}
console.log('buttons checked: '+n+'   label-unreadable states: '+bad);
await br.close();s.close();process.exitCode=bad?1:0;});
