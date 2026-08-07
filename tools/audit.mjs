#!/usr/bin/env node
/**
 * audit — contrast + overflow gate. Copy into any web project as tools/audit.mjs.
 *
 *   node tools/audit.mjs <base-url> [page,page,...] [--widths 390,834,1440,2560] [--themes light,dark]
 *
 *   node tools/audit.mjs http://localhost:8471/docs
 *   node tools/audit.mjs http://localhost:5173 /,/about,/pricing --widths 390,1440
 *
 * With no page list it crawls same-origin links from the base URL (depth 1, capped at 25).
 * Dark theme is requested with a #dark hash; make the project honour that in its theme
 * bootstrap script, e.g.
 *   if (location.hash === '#dark') document.documentElement.dataset.theme = 'dark';
 *
 * Contrast: computed text colour composited over its EFFECTIVE background, WCAG 2.1.
 *   - walks ancestors for the first opaque background
 *   - if that lands on the page background, re-checks the painted stack via
 *     elementsFromPoint, which catches text sitting under an overlay panel
 *   - skips text over background images (a picture cannot be judged numerically; the
 *     screenshot review catches those)
 *   - skips aria-hidden and outline-drawn (text-stroke, transparent fill) display type
 * Overflow: documentElement.scrollWidth vs clientWidth at each width.
 *
 * Exits 1 on any failure. Fix the tool rather than waiving a false positive: every
 * refinement above came from one, and each caught a real bug later.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const req = createRequire(import.meta.url);
let chromium;
for (const p of [
  resolve(process.cwd(), 'node_modules/playwright/index.js'),
  resolve(homedir(), 'Claude Helpers/Mission Control/node_modules/playwright/index.js'),
  resolve(homedir(), 'Claude Helpers/maps-leads/node_modules/playwright/index.js'),
]) { try { chromium = req(p).chromium; break; } catch {} }
if (!chromium) { console.error('playwright not found in any known project'); process.exit(2); }

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const BASE = (positional[0] || 'http://localhost:8000').replace(/\/$/, '');
const WIDTHS = flag('widths', '390,834,1440,2560').split(',').map(Number);
const THEMES = flag('themes', 'light,dark').split(',');

const AUDIT_JS = () => {
  const parse = c => {
    const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const comp = (fg, bg) => fg[3] >= 1 ? fg : [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const pageBg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  const bgOf = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0.9) return c;
      if (cs.backgroundImage !== 'none' && n !== el) return null;
      n = n.parentElement;
    }
    return pageBg;
  };
  const fails = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode, el = t.parentElement;
    if (!el || !t.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('[hidden],[aria-hidden="true"]')) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    if (fg[3] === 0 && cs.webkitTextStroke && cs.webkitTextStroke !== '0px') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    let bg = bgOf(el);
    if (bg && Math.abs(lum(bg) - lum(pageBg)) < 0.001) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rr = el.getBoundingClientRect();
      const x = Math.min(Math.max(rr.left + rr.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(rr.top + rr.height / 2, 1), innerHeight - 1);
      let past = false;
      for (const s of document.elementsFromPoint(x, y)) {
        if (s === el) { past = true; continue; }
        if (!past || s.contains(el)) continue;
        const scs = getComputedStyle(s);
        if (scs.backgroundImage !== 'none') { bg = null; break; }
        const sc = parse(scs.backgroundColor);
        if (sc && sc[3] > 0.9) { bg = sc; break; }
      }
    }
    if (!bg) continue;

    const cr = ratio(comp(fg, bg), bg);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 600);
    const need = large ? 3 : 4.5;
    if (cr < need) fails.push({
      text: t.textContent.trim().slice(0, 40),
      sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''),
      cr: Math.round(cr * 100) / 100, need,
    });
  }
  return { fails, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};

const browser = await chromium.launch();
const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p0 = await ctx0.newPage();

let PAGES;
if (positional[1]) {
  PAGES = positional[1].split(',');
} else {
  await p0.goto(BASE, { waitUntil: 'networkidle' });
  PAGES = await p0.evaluate(base => {
    const origin = new URL(base).origin;
    const out = new Set(['']);
    for (const a of document.querySelectorAll('a[href]')) {
      const u = new URL(a.href, location.href);
      if (u.origin !== origin) continue;
      if (!u.pathname.startsWith(new URL(base).pathname)) continue;
      const rel = u.pathname.slice(new URL(base).pathname.length).replace(/^\//, '');
      if (!rel || /\.(png|jpe?g|webp|svg|pdf|zip)$/i.test(rel)) continue;
      out.add(rel);
    }
    return [...out].slice(0, 25);
  }, BASE);
  console.log(`crawled ${PAGES.length} pages from ${BASE}`);
}
await ctx0.close();

let bad = 0;
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 } });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      const url = `${BASE}/${p}`.replace(/([^:])\/\/+/g, '$1/') + (theme === 'dark' ? '#dark' : '');
      await page.goto(url, { waitUntil: 'networkidle' });
      if (theme === 'dark') await page.reload({ waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const { fails, overflow } = await page.evaluate(AUDIT_JS);
      if (overflow > 1) { console.log(`OVERFLOW ${theme} ${w} ${p || '/'}: +${overflow}px`); bad++; }
      for (const f of fails) {
        console.log(`CONTRAST ${theme} ${w} ${p || '/'}: ${f.cr} < ${f.need} on <${f.sel}> "${f.text}"`);
        bad++;
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? 'AUDIT CLEAN' : `AUDIT: ${bad} failures`);
process.exit(bad === 0 ? 0 : 1);
