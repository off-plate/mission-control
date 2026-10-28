// @ts-nocheck
/* The approved Nothing prototype (Jarvis scratchpad nothing-v3-src, all modules),
   moved in whole. Smallest edits: it lives in a shadow root (no globals, no CSS
   either way), reads the real data the bridge hands it (src/shells/bridge.ts)
   and every write is an existing store or pomodoro function, reached through B.
   Timers, frames and window listeners are tracked so unmount leaves nothing. */
export function mountNothing(HOST, B, INIT) {
const ROOT = HOST.shadowRoot;
let dead = false;
const TM = new Set(), IV = new Set(), RAF = new Set(), WINL = [];
const setTimeout = (f, ms) => { const id = window.setTimeout(() => { TM.delete(id); if (!dead) f(); }, ms); TM.add(id); return id; };
const clearTimeout = id => { TM.delete(id); window.clearTimeout(id); };
const setInterval = (f, ms) => { const id = window.setInterval(() => { if (!dead) f(); }, ms); IV.add(id); return id; };
const clearInterval = id => { IV.delete(id); window.clearInterval(id); };
const requestAnimationFrame = f => { const id = window.requestAnimationFrame(t => { RAF.delete(id); if (!dead) f(t); }); RAF.add(id); return id; };
const onWin = (t, f, o) => { window.addEventListener(t, f, o); WINL.push([t, f, o]); };
if (!ROOT.querySelector('#app')) { const box = document.createElement('div'); box.innerHTML = `<div id="app">
  <section class="view home root on" data-view="home" id="home"></section>
  <div id="views"></div>
  <nav class="dock" id="dock" aria-label="Main"></nav>
  <div class="cc" id="cc"></div>
  <div id="ov"></div>
  <div class="toast" id="toast" role="status"></div>
  <div class="sbar" id="sbar"></div>
  <canvas class="dz" id="dz"></canvas>
  <div class="homeind"></div>
</div>`; ROOT.append(box.firstElementChild); }
/* ---- 30-core.js ---- */
/* =====================================================================
   Core: utils, simulated clock, state store, actions bus, toast + undo
   ===================================================================== */
let MC = null;
const $ = (s, r = ROOT) => r.querySelector(s);
const $$ = (s, r = ROOT) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FRAME = /[?&]frame=1/.test(location.search);
const NOREVIEW = /[?&]noreview=1/.test(location.search);
const APP = ROOT.getElementById('app');

/* ---------- the real clock ---------- */
const NOW = () => new Date();
const TI = () => (NOW().getDay() + 6) % 7;
const pad = n => String(n).padStart(2, '0');
const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const minsOfDay = d => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
function leftOfDay() { const d = NOW(); const s = 86400 - (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()); return { h: Math.floor(s / 3600), m: Math.floor(s % 3600 / 60), s: s % 60, total: s }; }
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAYL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayDate = off => { const d = NOW(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + off); };
const dayShort = off => off === 0 ? 'TODAY' : off === 1 ? 'TOMORROW' : DAYS[(TI() + off) % 7] + ' ' + dayDate(off).getDate();
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoOff = off => { const d = dayDate(off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const todayLabel = () => DAYS[TI()] + ' ' + NOW().getDate() + ' ' + MONTHS[NOW().getMonth()];
const monT = m => MONTHS[m][0] + MONTHS[m].slice(1).toLowerCase();
const weekRange = () => { const a = dayDate(0), b = dayDate(6); return a.getDate() + ' ' + monT(a.getMonth()) + ' to ' + b.getDate() + ' ' + monT(b.getMonth()); };
function phaseOf(d = NOW()) { const h = d.getHours(); return h < 6 ? 'Night' : h < 11 ? 'Morning' : h < 14 ? 'Noon' : h < 18 ? 'Afternoon' : 'Evening'; }
const fmtMin = m => { m = Math.round(Math.abs(m)); if (!m) return '0M'; const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}H ${r}M` : `${h}H`) : `${r}M`; };
const fmtMinL = m => { m = Math.round(Math.abs(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const kc = n => Math.round(n).toLocaleString('en-US');

/* ---------- state ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const S = {
  theme: 'light',
  page: 0,                               // home page index: 0 All, 1 Personal, 2 Big Time
  pomo: { phase: 'idle', endsAt: 0, left: 0, total: 25 * 60, label: '', taskId: null, cycles: 0, focusMin: 25, breakMin: 5 },
  sync: { state: 'connected', label: '' },
  cc: { jarvis: false, dnd: false, sync: true, hevy: 'idle', review: false },
  focusTarget: 4,
  hevyBusy: false,
  dailyDone: true,
  plan: { returned: [], handoffShut: false },
  daily: { forgot: [], left: [], goals: [], quit: [] },
  ui: {},
  assistant: [],
  watchless: { state: 'idle', doc: null, recent: [] }
};
/* The real data, as the bridge (src/shells/bridge.ts) hands it over. Called on
   mount and again whenever the store changes; UI state above is kept. */
function loadMC(mc) {
  MC = mc;
  S.tasks = mc.tasks.map((t, i) => ({ ...t, order: i }));
  S.backlogExtra = 0;
  S.habits = mc.habits;
  S.routines = mc.routines.map(r => ({ ...r, steps: r.steps.map((st, i) => ({ id: r.id + '-s' + i, ...st, done: !!st.done })) }));
  S.goals = mc.goals; S.quitting = mc.quitting;
  S.notes = mc.notes.items; S.folders = mc.notes.folders;
  S.people = mc.people; S.prospects = mc.prospects; S.bills = mc.bills; S.ideas = mc.ideas; S.prompts = mc.prompts;
  S.focus = { sessions: mc.focusToday.sessions, minutes: mc.focusToday.minutes };
  S.focusWeek = mc.focusWeek; S.gym = mc.gym; S.momentum = mc.momentum;
  S.plan.returned = mc.returned; S.dailyDone = mc.dailyDone;
  S.pomo = { ...S.pomo, ...mc.pomo }; S.sync = mc.sync; S.theme = mc.theme;
}

loadMC(INIT);
/* The home page this phone was last on; All on a first launch. */
S.page = 0; // his call: the app always opens on All, the first slide

/* Where a new thing lands, and what Plan is scoped to, as words. */
const wsp = () => curSpace() === 'all' ? (MC.writeSpace || 'personal') : curSpace();
const spLabel = id => (SPACES.find(z => z.id === id) || {}).label || 'Personal';
const projFor = sp => { const pf = S.ui.planProj; if (!pf || pf === '__u') return null; const p = MC.projects.find(x => x.id === pf); return p && p.space === sp ? p : null; };
const SPACES = [{ id: 'all', label: 'All' }, { id: 'personal', label: 'Personal' }, { id: 'work', label: 'Big Time' }];
const curSpace = () => SPACES[S.page].id;
const inSp = (x, sp) => sp === 'all' || x.space === sp;
const projName = id => (MC.projects.find(p => p.id === id) || {}).name || 'Unsorted';
const task = id => S.tasks.find(t => t.id === id);
const habit = id => S.habits.find(h => h.id === id);
const routine = id => S.routines.find(r => r.id === id);

/* ---------- derived ---------- */
const openToday = (sp, day = 0) => S.tasks.filter(t => t.list === 'today' && t.day === day && !t.done && inSp(t, sp));
const doneToday = sp => S.tasks.filter(t => t.done && t.day === 0 && inSp(t, sp));
const backlog = sp => S.tasks.filter(t => t.list === 'backlog' && !t.done && inSp(t, sp));
const taskLeft = t => t.subtasks ? t.subtasks.filter(s => !s.done).reduce((a, s) => a + s.est, 0) : t.est;
const plannedMin = (sp, day = 0) => openToday(sp, day).reduce((a, t) => a + t.est, 0);
const slotMin = (sp, day, slot) => openToday(sp, day).filter(t => t.slot === slot).reduce((a, t) => a + t.est, 0);
function habitKept(h) { if (h.kind === 'measured') return h.measure === 'times' && h.per === 'week' ? h.current >= h.target : (h.today || 0) >= h.target; return !!h.doneToday; }
function habitsDue(sp) { const d = S.habits.filter(h => h.due && h.kind !== 'break' && inSp(h, sp)); return { due: d.length, kept: d.filter(habitKept).length, list: d }; }
function routineDone(r) { return r.steps.filter(s => s.done).length; }
function routineReq(r) { return r.steps.filter(s => !s.optional).length; }
function firstMove(sp) {
  const open = openToday(sp);
  return open.find(t => t.alert) || open.find(t => t.first) || open.sort((a, b) => ['admin', 'call', 'deep', 'quick'].indexOf(a.category) - ['admin', 'call', 'deep', 'quick'].indexOf(b.category))[0] || null;
}
function nextEvent() { const m = minsOfDay(NOW()); const ev = MC.calendar.filter(e => e.day === MC.today); const mm = s => +s.slice(0, 2) * 60 + +s.slice(3); return ev.find(e => mm(e.end) > m) || null; }
const overdue = () => S.people.filter(p => p.lastDays > p.cadenceDays);
const inPlay = () => S.prospects.filter(p => !['Acquired', 'Lost', 'Rejected', 'Dropped'].includes(p.stage));
const talking = () => S.prospects.filter(p => ['Responded waiting', 'Meeting planned', 'On hold'].includes(p.stage));
const billsLeft = () => (S.bills ? S.bills.items : []).filter(i => i.state !== 'paid' && i.state !== 'any').reduce((a, i) => a + i.amount, 0);
const billsOverdue = () => (S.bills ? S.bills.items : []).filter(i => i.state === 'overdue');
const focusMinToday = () => S.focus.minutes + (S.pomo.phase === 'focus' || S.pomo.phase === 'paused' ? Math.floor((S.pomo.total - pomoLeft()) / 60) : 0);
const goalPct = g => clamp(g.current / g.target, 0, 1);

/* ---------- render scheduling ---------- */
const R = { home: () => { }, view: () => { }, cc: () => { }, dock: () => { } };
let rq = 0;
function refresh() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; for (const f of [() => { const t = top_(); if (!t || t.id === 'home') R.home(); } /* a covered Home is rebuilt by back()/tab() when it returns */, R.view, R.cc, R.dock, () => repaintSheets()]) { try { f(); } catch (err) { console.warn('nothing shell render', err); } } }); }

/* ---------- actions bus ---------- */
const A = {};
let swallowClick = 0;
ROOT.addEventListener('click', e => {
  if (performance.now() < swallowClick) { e.preventDefault(); e.stopPropagation(); return; }
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (!fn) { console.warn('no action', el.dataset.a); return; }
  e.preventDefault();
  fn(el, el.dataset.x, e);
}, true);
ROOT.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[data-enter]')) { e.preventDefault(); const fn = A[e.target.dataset.enter]; fn && fn(e.target, e.target.dataset.x, e); }
  if (e.key === 'Escape') { if (closeTopSheet()) return; if (CC.open) { ccClose(); return; } if (STACK.length > 1) back(); }
});

/* ---------- toast + undo ---------- */
let toastT = 0, toastUndo = null;
function toast(text, opts = {}) {
  const el = $('#toast');
  toastUndo = opts.undo || null;
  el.innerHTML = `<div class="tx">${esc(text)}</div>${opts.undo ? `<button class="key sm" data-a="undo">Undo</button>` : opts.act ? `<button class="key sm" data-a="${opts.act}" data-x="${esc(opts.x || '')}">${esc(opts.actLabel)}</button>` : ''}<button class="x" data-a="toastX" aria-label="Dismiss">${ico('close')}</button>`;
  el.classList.toggle('low', (!$('#dock') || $('#dock').classList.contains('hide')) && !$('#home.editing'));
  el.classList.toggle('top', SHEETS.length > 0);
  el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), opts.ms || (opts.undo ? 4000 : 2500));
}
A.toastX = () => { $('#toast').classList.remove('on'); toastUndo = null; };
A.undo = () => { const u = toastUndo; toastUndo = null; $('#toast').classList.remove('on'); if (u) { u(); refresh(); toast('Undone'); } };
function undoable(label, restore) { if (restore) toast(label, { undo: restore }); else toast(label); }
/* Runs once the next store update has arrived, for a view that needs the row it just made. */
const AFTER = [];
const afterUpdate = fn => AFTER.push(fn);

/* ---- 31-dots.js ---- */
/* =====================================================================
   Dot engine: 5x7 dot numerals that morph dot by dot, 9x9 pixel icons,
   dot rings and rows that fill dot by dot, the theme dissolve.
   ===================================================================== */
const GLY = {
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['111', '010', '010', '010', '010', '010', '111'], J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
  '.': ['0', '0', '0', '0', '0', '0', '1'], ',': ['00', '00', '00', '00', '00', '01', '10'],
  ':': ['0', '0', '1', '0', '1', '0', '0'], '-': ['000', '000', '000', '111', '000', '000', '000'],
  '+': ['000', '000', '010', '111', '010', '000', '000'], '/': ['000', '001', '001', '010', '100', '100', '000'],
  ' ': ['00', '00', '00', '00', '00', '00', '00'], '°': ['010', '101', '010', '000', '000', '000', '000']
};
const gw = c => (GLY[c] || GLY[' '])[0].length;
const DMC = new Map();

/* dot numerals: dm('14:19', 7, {k:'clock', cls:'rd', grid:true}) */
function dm(v, cell = 6, o = {}) {
  return `<span class="dm ${o.cls || ''}" data-dm="${esc(String(v).toUpperCase())}" data-cell="${cell}"${o.k ? ` data-k="${o.k}"` : ''}${o.grid ? ' data-grid="1"' : ''}${o.count ? ' data-count="1"' : ''} role="img" aria-label="${esc(v)}"></span>`;
}
function dmLayout(str, cell, grid) {
  const chars = [...str]; let x = 0, cs = '';
  const r = (cell * .41).toFixed(2);
  chars.forEach((c, ci) => {
    const w = gw(c);
    for (let y = 0; y < 7; y++) for (let i = 0; i < w; i++) cs += `<circle class="c${grid ? ' g' : ''}" cx="${((x + i + .5) * cell).toFixed(1)}" cy="${((y + .5) * cell).toFixed(1)}" r="${r}"/>`;
    x += w + (ci < chars.length - 1 ? 1 : 0);
  });
  return `<svg width="${x * cell}" height="${7 * cell}" viewBox="0 0 ${x * cell} ${7 * cell}" aria-hidden="true">${cs}</svg>`;
}
function dmBits(str) { const out = []; for (const c of str) { const g = GLY[c] || GLY[' ']; for (let y = 0; y < 7; y++) for (let i = 0; i < g[0].length; i++) out.push(g[y][i] === '1'); } return out; }
const sigOf = s => [...s].map(gw).join(',');
function dmSet(el, v, animate) {
  const cell = +el.dataset.cell || 6, grid = !!el.dataset.grid;
  const sig = sigOf(v);
  let rebuilt = false;
  if (el._sig !== sig) { el.innerHTML = dmLayout(v, cell, grid); el._sig = sig; el._c = [...el.querySelectorAll('circle')]; rebuilt = true; }
  const bits = dmBits(v), cs = el._c;
  if (rebuilt && animate) { cs.forEach(c => c.classList.add('nt')); cs.forEach(c => c.classList.remove('on')); el.getBoundingClientRect(); cs.forEach(c => c.classList.remove('nt')); }
  cs.forEach((c, i) => {
    const on = bits[i];
    if (c.classList.contains('on') !== on) {
      c.style.transitionDelay = animate && !RM ? ((Math.random() * 150) | 0) + 'ms' : '0ms';
      if (!animate) c.classList.add('nt');
      c.classList.toggle('on', on);
    }
  });
  if (!animate) { el.getBoundingClientRect(); cs.forEach(c => c.classList.remove('nt')); }
  el._v = v;
}
function dmCount(el, to) {
  const m = to.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
  if (!m || RM) { dmSet(el, to, true); return; }
  const [, pre, num, suf] = m, raw = num.replace(/,/g, ''), n = parseFloat(raw), dec = (raw.split('.')[1] || '').length, comma = num.includes(',');
  let i = 0; const steps = 14; clearInterval(el._iv);
  const fmt = v => { let s = v.toFixed(dec); if (comma) s = (+s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); return pre + s.padStart(num.length, ' ') + suf; };
  dmSet(el, fmt(0), false);
  el._iv = setInterval(() => { i++; const k = 1 - Math.pow(1 - i / steps, 3); dmSet(el, i >= steps ? to : fmt(n * k), true); if (i >= steps) clearInterval(el._iv); }, 40);
}
function dmHydrate(el) {
  const v = el.dataset.dm, k = el.dataset.k;
  if (el._v === v) return;
  const prev = k ? DMC.get(k) : undefined;
  if (k) DMC.set(k, v);
  if (el._v === undefined) {
    if (el.dataset.count && prev === undefined) { dmCount(el, v); return; }
    if (prev !== undefined && prev !== v && sigOf(prev) === sigOf(v)) { dmSet(el, prev, false); requestAnimationFrame(() => dmSet(el, v, true)); return; }
    dmSet(el, v, prev === undefined || prev !== v);
    return;
  }
  dmSet(el, v, true);
}
/* live update of a dm already in the DOM (clock ticks) */
function dmLive(el, v) { if (!el) return; el.dataset.dm = v; if (el.dataset.k) DMC.set(el.dataset.k, v); dmSet(el, v, el._v !== undefined); }

/* ---------- 9x9 pixel icons as data ---------- */
const ICONS = {
  sun: ['....#....', '.#.....#.', '...###...', '..#####..', '#.#####.#', '..#####..', '...###...', '.#.....#.', '....#....'],
  cloud: ['.........', '.........', '...###...', '..#####..', '.#######.', '#########', '#########', '.#######.', '.........'],
  rain: ['...###...', '..#####..', '.#######.', '#########', '.#######.', '.........', '.#..#..#.', '#..#..#..', '.........'],
  moon: ['..####...', '.##......', '##.......', '##.......', '##.......', '##......#', '.##....##', '..######.', '...####..'],
  pin: ['..#####..', '.##...##.', '.#..#..#.', '.#.###.#.', '.#..#..#.', '.##...##.', '..##.##..', '...###...', '....#....'],
  bell: ['....#....', '...###...', '..#####..', '..#####..', '..#####..', '.#######.', '#########', '.........', '...###...'],
  plus: ['.........', '....#....', '....#....', '....#....', '.#######.', '....#....', '....#....', '....#....', '.........'],
  check: ['.........', '........#', '.......#.', '......#..', '#....#...', '.#..#....', '..##.....', '...#.....', '.........'],
  play: ['.#.......', '.##......', '.###.....', '.####....', '.#####...', '.####....', '.###.....', '.##......', '.#.......'],
  pause: ['.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.'],
  stop: ['.........', '.#######.', '.#######.', '.#######.', '.#######.', '.#######.', '.#######.', '.#######.', '.........'],
  flame: ['....#....', '...##....', '...###...', '..####.#.', '.#######.', '.###.###.', '.##...##.', '..##.##..', '...###...'],
  dumbbell: ['.........', '.........', '##.....##', '##.....##', '#########', '##.....##', '##.....##', '.........', '.........'],
  note: ['######...', '#....##..', '#....###.', '#.......#', '#.#####.#', '#.......#', '#.####..#', '#.......#', '#########'],
  people: ['.##...##.', '####.####', '.##...##.', '.........', '.##...##.', '####.####', '####.####', '.........', '.........'],
  person: ['...###...', '..#####..', '..#####..', '...###...', '.........', '.#######.', '#########', '#########', '.........'],
  calendar: ['.#.....#.', '#########', '#.......#', '#.#.#.#.#', '#.......#', '#.#.#.#.#', '#.......#', '#.#.#...#', '#########'],
  money: ['.........', '#########', '#.......#', '#...#...#', '#..###..#', '#...#...#', '#.......#', '#########', '.........'],
  bolt: ['.....##..', '....##...', '...##....', '..######.', '.....##..', '....##...', '...##....', '..##.....', '.##......'],
  search: ['..####...', '.#....#..', '#......#.', '#......#.', '#......#.', '.#....#..', '..####.#.', '.......##', '........#'],
  gear: ['....#....', '.#.###.#.', '..#####..', '.##...##.', '###...###', '.##...##.', '..#####..', '.#.###.#.', '....#....'],
  jar: ['.#######.', '..#####..', '.#.....#.', '#.......#', '#.#####.#', '#.#####.#', '#.#####.#', '#.......#', '.#######.'],
  eyeoff: ['#........', '.#.###...', '.##...##.', '#..#....#', '#...#...#', '#....#..#', '.##...##.', '...###.#.', '........#'],
  apps: ['###...###', '###...###', '###...###', '.........', '.........', '.........', '###...###', '###...###', '###...###'],
  chat: ['#########', '#.......#', '#.#####.#', '#.......#', '#.###...#', '#.......#', '#########', '.##......', '.#.......'],
  mic: ['...###...', '..#####..', '..#####..', '..#####..', '..#####..', '#..###..#', '.#.....#.', '..#####..', '....#....'],
  home: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#.....#.', '.#.###.#.', '.#.###.#.', '.#.###.#.'],
  plan: ['.........', '##.######', '.........', '.........', '##.######', '.........', '.........', '##.####..', '.........'],
  habits: ['..#####..', '.#.....#.', '#..#....#', '#...#...#', '#....####', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  back: ['.........', '...#.....', '..#......', '.#.......', '#########', '.#.......', '..#......', '...#.....', '.........'],
  fwd: ['.........', '.....#...', '......#..', '.......#.', '#########', '.......#.', '......#..', '.....#...', '.........'],
  left: ['.....#...', '....#....', '...#.....', '..#......', '.#.......', '..#......', '...#.....', '....#....', '.....#...'],
  right: ['...#.....', '....#....', '.....#...', '......#..', '.......#.', '......#..', '.....#...', '....#....', '...#.....'],
  down: ['.........', '.........', '#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '.........', '.........'],
  up: ['.........', '.........', '....#....', '...#.#...', '..#...#..', '.#.....#.', '#.......#', '.........', '.........'],
  close: ['#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '...#.#...', '..#...#..', '.#.....#.', '#.......#'],
  minus: ['.........', '.........', '.........', '.........', '#########', '.........', '.........', '.........', '.........'],
  kebab: ['.........', '.........', '.........', '.........', '#...#...#', '.........', '.........', '.........', '.........'],
  trash: ['...###...', '#########', '.#.....#.', '.#.#.#.#.', '.#.#.#.#.', '.#.#.#.#.', '.#.#.#.#.', '.#.....#.', '..#####..'],
  edit: ['......##.', '.....####', '....####.', '...###...', '..###....', '.###.....', '###......', '##.......', '#........'],
  sync: ['..#####..', '.#.....#.', '#.....###', '#......#.', '.........', '.#......#', '###.....#', '.#.....#.', '..#####..'],
  undo: ['...#.....', '..#......', '.#######.', '..#.....#', '...#....#', '........#', '.......#.', '..#####..', '.........'],
  folder: ['.........', '####.....', '#...#####', '#.......#', '#########', '#.......#', '#.......#', '#.......#', '#########'],
  list: ['.........', '#.#######', '.........', '#.#######', '.........', '#.#######', '.........', '#.#######', '.........'],
  lock: ['..#####..', '.#.....#.', '.#.....#.', '#########', '#########', '####.####', '####.####', '#########', '#########'],
  mail: ['.........', '#########', '##.....##', '#.#...#.#', '#..#.#..#', '#...#...#', '#.......#', '#########', '.........'],
  phone: ['##.......', '###......', '###......', '.##......', '..##.....', '...##.###', '....#####', '.....####', '.......##'],
  msg: ['.#######.', '#.......#', '#.#.#.#.#', '#.......#', '.#######.', '..##.....', '.##......', '.#.......', '.........'],
  video: ['.........', '######...', '#....#.##', '#....####', '#....####', '#....####', '#....#.##', '######...', '.........'],
  walk: ['....##...', '....##...', '...###...', '..#.##...', '.#..###..', '....#.#..', '...#..#..', '..#...#..', '.#.......'],
  star: ['....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.', '.........'],
  clock: ['..#####..', '.#..#..#.', '#...#...#', '#...#...#', '#...###.#', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  heart: ['.........', '.##...##.', '#########', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  zone: ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#...#.#', '#..###..#', '.#.....#.', '..#####..'],
  ideas: ['..#####..', '.#.....#.', '#.......#', '#...#...#', '.#..#..#.', '..#.#.#..', '...###...', '...###...', '....#....'],
  skills: ['....#....', '....#....', '...###...', '..#####..', '#########', '..#####..', '...###...', '....#....', '....#....'],
  bills: ['.........', '#########', '#.......#', '#########', '#########', '#.......#', '#.##..#.#', '#########', '.........'],
  projects: ['.........', '####.....', '#...#####', '#.......#', '#########', '#.......#', '#.......#', '#.......#', '#########'],
  pulse: ['.........', '...#.....', '...#.....', '..#.#....', '#.#.#.#.#', '....#.#..', '....#.#..', '.....#...', '.........'],
  quote: ['.........', '.##..##..', '#...#....', '#...#....', '###.###..', '###.###..', '.##..##..', '.........', '.........'],
  device: ['..#####..', '..#...#..', '..#...#..', '..#...#..', '..#...#..', '..#...#..', '..#...#..', '..##.##..', '..#####..'],
  key: ['.........', '.###.....', '#...#....', '#...#####', '#...#.#.#', '.###..#.#', '.........', '.........', '.........'],
  logout: ['#####....', '#........', '#...#....', '#....#...', '#.#######', '#....#...', '#...#....', '#........', '#####....'],
  out: ['...######', '.......##', '......#.#', '.....#..#', '....#...#', '...#.....', '..#......', '.#.......', '#........'],
  copy: ['..#######', '..#.....#', '#######.#', '#.....#.#', '#.....#.#', '#.....#.#', '#.....###', '#.....#..', '#######..'],
  wand: ['.#.....#.', '###...###', '.#.....#.', '.....#...', '....###..', '...###...', '..###....', '.###.....', '###......'],
  send: ['#........', '###......', '#..###...', '#....###.', '#.......#', '#....###.', '#..###...', '###......', '#........'],
  board: ['###.###.#', '###.###.#', '###.###.#', '###.###..', '###.###..', '###......', '###......', '###......', '.........'],
  grip: ['.........', '.#.#.#.#.', '.........', '.........', '.........', '.........', '.........', '.#.#.#.#.', '.........'],
  grid4: ['.........', '.........', '..#...#..', '.........', '.........', '.........', '..#...#..', '.........', '.........'],
  resize: ['.........', '......##.', '.......#.', '.........', '...#...#.', '.........', '.#.......', '.##......', '.........'],
  sunrise: ['.........', '....#....', '.#.....#.', '...###...', '..#####..', '.#######.', '.........', '#########', '.........'],
  dnd: ['..#####..', '.#.....#.', '#.......#', '#.......#', '#.#####.#', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  theme: ['..#####..', '.####..#.', '#####...#', '#####...#', '#####...#', '#####...#', '#####...#', '.####..#.', '..#####..'],
  flag: ['#........', '#######..', '#######..', '#######..', '#######..', '#........', '#........', '#........', '#........'],
  skip: ['#....#...', '##...#...', '###..#...', '####.#...', '######...', '####.#...', '###..#...', '##...#...', '#....#...'],
  face: ['.........', '..#...#..', '..#...#..', '.........', '.........', '.#.....#.', '..#####..', '.........', '.........'],
  dot: ['.........', '.........', '.........', '...###...', '...###...', '...###...', '.........', '.........', '.........']
};
const ICON_SVG = {};
for (const [n, rows] of Object.entries(ICONS)) {
  let s = ''; rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') s += `<circle cx="${x + .5}" cy="${y + .5}" r=".42"/>`; }));
  ICON_SVG[n] = `<svg class="px" viewBox="0 0 9 9" aria-hidden="true">${s}</svg>`;
}
const ico = (n, cls = '') => cls ? (ICON_SVG[n] || ICON_SVG.dot).replace('class="px"', `class="px ${cls}"`) : (ICON_SVG[n] || ICON_SVG.dot);

/* big icon with faint unlit grid, for weather cards and the Jarvis face */
function icoBig(n, size = 64, grid = false) {
  const rows = ICONS[n] || ICONS.dot; let s = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') s += `<circle cx="${x + .5}" cy="${y + .5}" r=".44"/>`; else if (grid) s += `<circle cx="${x + .5}" cy="${y + .5}" r=".2" opacity=".18"/>`; }));
  return `<svg viewBox="0 0 9 9" width="${size}" height="${size}" style="fill:var(--fg)" aria-hidden="true">${s}</svg>`;
}

/* checkbox with a tick drawn dot by dot */
const CK_DOTS = [[0, 3], [1, 4], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]].map(([x, y]) => `<circle cx="${(x * 2 + 2).toFixed(1)}" cy="${(y * 2 + 2).toFixed(1)}" r="1.1"/>`).join('');
const ck = (on, attrs = '', cls = '') => `<button class="ck ${cls} ${on ? 'on' : ''}" role="checkbox" aria-checked="${!!on}" ${attrs}><svg viewBox="0 0 16 16">${CK_DOTS}</svg></button>`;

/* ---------- dot rings / rows that fill dot by dot ---------- */
const FC = new Map();
/* ring of n dots on a circle (or around a rounded square): first `on` lit, `red` lit red instead */
function dring(o) {
  const n = o.n || 40, S0 = o.size || 100, r = o.r || 2, on = Math.round(o.on || 0), pad = o.pad == null ? r + 1 : o.pad;
  const c = S0 / 2; let s = '';
  const pts = o.square ? squarePts(n, S0, pad, o.rad || S0 * .22) : Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i / n * Math.PI * 2; return [c + (c - pad) * Math.cos(a), c + (c - pad) * Math.sin(a)]; });
  pts.forEach(([x, y], i) => { const lit = i < on; s += `<circle class="dt ${lit ? (o.red ? 'rd' : 'on') : ''}${o.redFrom != null && i >= o.redFrom && lit ? ' rd' : ''}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}"/>`; });
  const cls = o.cls == null ? 'wring' : o.cls;
  return `<svg class="dts ${cls}" ${cls === 'wring' ? '' : `width="${S0}" height="${S0}"`} viewBox="0 0 ${S0} ${S0}" preserveAspectRatio="xMidYMid meet" ${o.k ? `data-k="${o.k}" data-fill="${on}"` : ''} aria-hidden="true">${s}</svg>`;
}
function squarePts(n, S0, pad, rad) {
  /* evenly spaced points along a rounded-rect path starting top centre, clockwise */
  const w = S0 - pad * 2, rr = Math.min(rad, w / 2), straight = w - 2 * rr, arc = Math.PI * rr / 2, L = 4 * straight + 4 * arc;
  const at = d => {
    d = ((d % L) + L) % L; const x0 = pad, y0 = pad;
    const seg = [['h', straight / 2, (t) => [x0 + w / 2 + t, y0]], ['a', arc, t => { const a = -Math.PI / 2 + t / rr; return [x0 + w - rr + rr * Math.cos(a), y0 + rr + rr * Math.sin(a)]; }],
    ['v', straight, t => [x0 + w, y0 + rr + t]], ['a', arc, t => { const a = t / rr; return [x0 + w - rr + rr * Math.cos(a), y0 + w - rr + rr * Math.sin(a)]; }],
    ['h', straight, t => [x0 + w - rr - t, y0 + w]], ['a', arc, t => { const a = Math.PI / 2 + t / rr; return [x0 + rr + rr * Math.cos(a), y0 + w - rr + rr * Math.sin(a)]; }],
    ['v', straight, t => [x0, y0 + w - rr - t]], ['a', arc, t => { const a = Math.PI + t / rr; return [x0 + rr + rr * Math.cos(a), y0 + rr + rr * Math.sin(a)]; }],
    ['h', straight / 2, t => [x0 + rr + t, y0]]];
    for (const [, len, f] of seg) { if (d <= len) return f(d); d -= len; }
    return [x0 + w / 2, y0];
  };
  return Array.from({ length: n }, (_, i) => at(i / n * L));
}
/* row(s) of dots: n dots, `on` lit, extra `over` red dots after, cols wrap into rows */
function drow(n, on, o = {}) {
  const g = o.gap || 8, r = o.r || 2.4, rows = o.rows || 1, total = n + (o.over || 0), cols = Math.ceil(total / rows);
  const W = cols * g, H = rows * g; let s = '';
  for (let i = 0; i < total; i++) {
    const cx = (o.colMajor ? Math.floor(i / rows) : i % cols) * g + g / 2, cy = (o.colMajor ? i % rows : Math.floor(i / cols)) * g + g / 2;
    const cls = i >= n ? 'on rd' : i < on ? (o.red ? 'rd' : 'on') : '';
    s += `<circle class="dt ${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
  }
  return `<svg class="dts ${o.cls || ''}" ${o.fill ? `width="100%" preserveAspectRatio="xMinYMid meet"` : `width="${W}" height="${H}"`} viewBox="0 0 ${W} ${H}" ${o.k ? `data-k="${o.k}" data-fill="${on}"` : ''} aria-hidden="true">${s}</svg>`;
}
/* animate fill changes dot by dot (on first appearance from 0) */
function fillHydrate(svg) {
  const k = svg.dataset.k, to = +svg.dataset.fill; if (svg._done) return; svg._done = 1;
  const prev = FC.has(k) ? FC.get(k) : 0; FC.set(k, to);
  if (prev === to || RM) return;
  const cs = [...svg.querySelectorAll('.dt')];
  const step = clamp(380 / Math.max(1, Math.abs(to - prev)), 10, 20);
  if (to > prev) {
    for (let i = prev; i < to && i < cs.length; i++) { cs[i].classList.add('nt', 'pre'); }
    svg.getBoundingClientRect();
    for (let i = prev; i < to && i < cs.length; i++) { const c = cs[i]; c.classList.remove('nt'); c.style.transitionDelay = ((i - prev) * step) + 'ms'; c.classList.remove('pre'); }
  } else {
    for (let i = to; i < prev && i < cs.length; i++) { cs[i].classList.add('nt', 'post'); if (svg.dataset.drop) cs[i].classList.add('rdp'); }
    svg.getBoundingClientRect();
    for (let i = to; i < prev && i < cs.length; i++) { const c = cs[i]; c.classList.remove('nt'); c.style.transitionDelay = ((prev - 1 - i) * step) + 'ms'; c.classList.remove('post', 'rdp'); }
  }
}
function hydrate(root = document) {
  $$('.dm[data-dm]', root).forEach(dmHydrate);
  $$('svg[data-fill]', root).forEach(fillHydrate);
}

/* ---------- theme switch: radial dot dissolve from a point ---------- */
function dissolve(x, y, apply) {
  const cv = $('#dz');
  if (RM) { apply(); return; }
  const r = APP.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sp = 12, Rm = sp * .74, band = 140;
  const maxD = Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y), Math.hypot(x, r.height - y), Math.hypot(r.width - x, r.height - y));
  const pts = []; for (let yy = sp / 2; yy < r.height + sp; yy += sp) for (let xx = sp / 2; xx < r.width + sp; xx += sp) pts.push([xx, yy, Math.hypot(xx - x, yy - y) + (Math.random() * 30)]);
  const T1 = 300, T2 = 340; let swapped = false, col = null;
  cv.classList.add('on');
  const t0 = performance.now();
  const fr = t => {
    const e = t - t0; ctx.clearRect(0, 0, r.width, r.height);
    if (!swapped && e >= T1) { swapped = true; apply(); col = getComputedStyle(APP).backgroundColor; }
    if (!col) col = APP.dataset.next || '#000';
    ctx.fillStyle = col;
    const ph1 = e < T1, k = ph1 ? e / T1 : (e - T1) / T2;
    const front = k * (maxD + band + 30);
    ctx.beginPath();
    for (const [px, py, d] of pts) {
      const l = clamp((front - d) / band, 0, 1);
      const rad = ph1 ? l * Rm : (1 - l) * Rm;
      if (rad > .3) { ctx.moveTo(px + rad, py); ctx.arc(px, py, rad, 0, Math.PI * 2); }
    }
    ctx.fill();
    if (e < T1 + T2) requestAnimationFrame(fr); else { ctx.clearRect(0, 0, r.width, r.height); cv.classList.remove('on'); }
  };
  requestAnimationFrame(fr);
}

/* ---- 32-gest.js ---- */
/* =====================================================================
   Gesture layer: one touch/mouse tracker, direction lock, recognisers
   claim a gesture (row swipe, page swipe, control centre pull, sheet drag,
   edge back, long press...). Velocity is measured over the last 90 ms.
   ===================================================================== */
const RECS = [];
const addRec = r => RECS.push(r);
let GS = null, lastTouch = 0;
function gStart(x, y, target, kind) {
  if (GS) return;
  GS = { x0: x, y0: y, x, y, t0: performance.now(), target, kind, pts: [[x, y, performance.now()]], h: null, axis: null, dead: false };
  const st = GS;
  const lp = RECS.filter(r => r.long);
  if (lp.length) st.lt = setTimeout(() => {
    if (GS !== st || st.h || st.axis) return;
    for (const r of lp) { const h = r.long(st); if (h) { st.h = h; st.axis = 'long'; st.longed = true; if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { } break; } }
  }, 480);
}
function gMove(x, y, e) {
  const st = GS; if (!st) return;
  st.x = x; st.y = y; const t = performance.now(); st.pts.push([x, y, t]); if (st.pts.length > 12) st.pts.shift();
  const dx = x - st.x0, dy = y - st.y0;
  if (st.h) { if (e && e.cancelable) e.preventDefault(); st.h.move && st.h.move(dx, dy, x, y); return; }
  if (st.dead) return;
  if (!st.axis && Math.hypot(dx, dy) > 8) {
    clearTimeout(st.lt);
    st.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    for (const r of RECS) { if (!r.test) continue; if (r.axis && r.axis !== st.axis) continue; const h = r.test(st, dx, dy); if (h) { st.h = h; break; } }
    if (!st.h) { st.dead = true; return; }
    if (e && e.cancelable) e.preventDefault();
    st.h.move && st.h.move(dx, dy, x, y);
  }
}
function gEnd(cancel) {
  const st = GS; if (!st) return; GS = null; clearTimeout(st.lt);
  if (!st.h) return;
  const p = st.pts, now = performance.now();
  let i = p.length - 1; while (i > 0 && now - p[i - 1][2] < 90) i--;
  const a = p[i], b = p[p.length - 1], dt = Math.max(16, b[2] - a[2]);
  const vx = (b[0] - a[0]) / dt, vy = (b[1] - a[1]) / dt;
  swallowClick = performance.now() + 250;
  st.h.end && st.h.end(st.x - st.x0, st.y - st.y0, vx, vy, cancel);
}
const pos = e => { const r = APP.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
APP.addEventListener('touchstart', e => { lastTouch = performance.now(); if (e.touches.length > 1) { gEnd(true); return; } const [x, y] = pos(e.touches[0]); gStart(x, y, e.target, 'touch'); }, { passive: true });
APP.addEventListener('touchmove', e => { lastTouch = performance.now(); const [x, y] = pos(e.touches[0]); gMove(x, y, e); }, { passive: false });
APP.addEventListener('touchend', () => { lastTouch = performance.now(); gEnd(false); }, { passive: true });
APP.addEventListener('touchcancel', () => gEnd(true), { passive: true });
APP.addEventListener('mousedown', e => { if (performance.now() - lastTouch < 900 || e.button) return; if (e.target.closest('input,textarea,select')) return; const [x, y] = pos(e); gStart(x, y, e.target, 'mouse'); });
onWin('mousemove', e => { if (!GS || GS.kind !== 'mouse') return; const [x, y] = pos(e); gMove(x, y, e); });
onWin('mouseup', () => { if (GS && GS.kind === 'mouse') gEnd(false); });
/* native image/text dragging would steal mouse gestures */
APP.addEventListener('dragstart', e => e.preventDefault());

/* rubber band for drags past a limit */
const rubber = (v, lim = 120) => v <= 0 ? 0 : lim * (1 - 1 / (v / lim + 1));
const flick = (d, v, dist = 90, vel = .11) => d > dist || v > vel;

/* ---- 33-router.js ---- */
/* =====================================================================
   View router: root tabs (Home, Plan, Habits, Apps) under a dock, pushed
   views on a back stack, FLIP morph from a widget tile, edge swipe back,
   swipe down from the top to close. Sheets live here too.
   ===================================================================== */
const V = {};               // view registry: V[id] = { title, render(args), action(args), after(el,args), lazy, dark, root }
const ROOTS = ['home', 'plan', 'habits', 'apps'];
const STACK = [{ id: 'home', el: $('#home'), args: {}, root: true }];
const SEEN = new Set();
const top_ = () => STACK[STACK.length - 1];
const EASE_D = 'cubic-bezier(.32,.72,0,1)';

function vTitle(e) { const d = V[e.id]; return typeof d.title === 'function' ? d.title(e.args) : d.title; }
function buildView(e) {
  const d = V[e.id];
  const el = document.createElement('section');
  el.className = 'view' + (d.dark ? ' dark' : '') + (e.root ? ' hasdock' : '');
  el.dataset.view = e.id;
  el.innerHTML = `<div class="vtop"></div><div class="vsc noscroll"></div>`;
  $('#views').append(el);
  e.el = el;
  renderTop(e);
  const sc0 = $('.vsc', el); sc0.addEventListener('scroll', () => $('.vtop', el).classList.toggle('compact', sc0.scrollTop > 8), { passive: true });
  const first = !SEEN.has(e.id + (e.args.key || '')); SEEN.add(e.id + (e.args.key || ''));
  if (d.lazy && first && !RM) {
    $('.vsc', el).innerHTML = `<div class="skel" aria-label="Loading"><i></i><i></i><i></i><i></i></div>`;
    setTimeout(() => { if (el.isConnected) { renderBody(e, true); } }, 520);
  } else renderBody(e, true);
  return el;
}
function renderTop(e) {
  const d = V[e.id], el = e.el;
  const showBack = !(e.root && !e.tile);
  $('.vtop', el).innerHTML = `${showBack ? `<button class="kb" data-a="${d.backAct || 'back'}" aria-label="Back">${ico('back')}</button>` : d.lead ? d.lead(e.args) : '<span class="sp"></span>'}<div class="vtt">${esc(vTitle(e))}</div>${d.action ? d.action(e.args, showBack) : '<span class="sp"></span>'}`;
  el.classList.toggle('haslead', !showBack && !!d.lead);
  /* The header row starts exactly where Home's first row does, read off Home itself. */
  const hs = $('#home .hsc'); if (hs) $('.vtop', el).style.paddingTop = getComputedStyle(hs).paddingTop;
}
function renderBody(e, fresh) {
  const d = V[e.id], sc = $('.vsc', e.el), y = sc.scrollTop;
  sc.innerHTML = `<div class="${fresh ? 'vin' : ''}">${d.render(e.args, e)}</div>`;
  if (!fresh) sc.scrollTop = y;
  if (fresh) $$('.vin > *', sc).forEach((c, i) => { if (i < 14) c.style.animationDelay = (i * 40) + 'ms'; });
  hydrate(sc);
  d.after && d.after(e.el, e.args, fresh, e);
}
R.view = () => { const e = top_(); if (e.id === 'home' || !e.el) return; if (V[e.id].live === false) return; renderTop(e); if (!$('.skel', e.el)) renderBody(e, false); };
function setChrome() {
  const e = top_();
  APP.classList.toggle('sb-light', !!(V[e.id] && V[e.id].dark) && e.id !== 'home');
  R.dock();
}

/* open a view. from = a widget tile element for the morph; push = slide in from the right */
/* Pages this look does not draw itself: they open the real page in the classic app. */
const CLASSIC_V = { longevity: 'longevity', watchless: 'watchless', skills: 'skills' };
function open(id, args = {}, from = null) {
  if (CLASSIC_V[id]) { B.openClassic(CLASSIC_V[id]); return; }
  if (!V[id]) { console.warn('no view', id); return; }
  if (busyNav) return;
  closeAllSheets(); if (CC.open) ccClose();
  const cur = top_();
  if (ROOTS.includes(id) && !from) { tab(id); return; }
  const e = { id, args, root: ROOTS.includes(id), tile: from ? from.dataset.wid : null };
  buildView(e);
  STACK.push(e);
  e.el.classList.add('on');
  cur.el.classList.remove('on');
  if (from && from.isConnected) morphIn(e, from, cur); else slideIn(e, cur);
  setChrome();
}
let busyNav = false;
function lockNav(ms) { busyNav = true; setTimeout(() => busyNav = false, ms); }
function morphRect(tile) {
  const ar = APP.getBoundingClientRect(), tr = tile.getBoundingClientRect();
  const cs = getComputedStyle(tile); let rad = parseFloat(cs.borderTopLeftRadius) || 0; if (cs.borderTopLeftRadius.includes('%')) rad = tr.width / 2;
  return { t: tr.top - ar.top, l: tr.left - ar.left, r: ar.right - tr.right, b: ar.bottom - tr.bottom, w: tr.width, h: tr.height, rad, bg: cs.backgroundColor };
}
function morphIn(e, tile, under) {
  lockNav(460);
  const m = morphRect(tile), el = e.el;
  el.classList.add('vis');
  under.el.classList.add('vis');
  const clone = tile.cloneNode(true);
  clone.classList.add('morphclone'); clone.classList.remove('hidden');
  Object.assign(clone.style, { left: m.l + 'px', top: m.t + 'px', width: m.w + 'px', height: m.h + 'px', margin: 0, transform: 'none', animation: 'none' });
  el.append(clone);
  tile.classList.add('hidden');
  const vbg = getComputedStyle(el).backgroundColor;
  const dur = RM ? 1 : 430;
  const a = el.animate([{ clipPath: `inset(${m.t}px ${m.r}px ${m.b}px ${m.l}px round ${m.rad}px)`, backgroundColor: m.bg }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', backgroundColor: vbg }], { duration: dur, easing: EASE_D });
  const ar = APP.getBoundingClientRect();
  const dx = ar.width / 2 - (m.l + m.w / 2), dy = ar.height * .38 - (m.t + m.h / 2);
  clone.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translate(${dx * .5}px,${dy * .5}px) scale(1.3)` }], { duration: dur * .6, easing: 'ease-out', fill: 'forwards' });
  $$(':scope > .vtop, :scope > .vsc', el).forEach(c => c.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 0, offset: .3 }, { opacity: 1, transform: 'none' }], { duration: dur, easing: 'cubic-bezier(.23,1,.32,1)' }));
  a.onfinish = () => { clone.remove(); tile.classList.remove('hidden'); under.el.classList.remove('vis'); };
}
function slideIn(e, under) {
  lockNav(400);
  const el = e.el; el.classList.add('vis'); under.el.classList.add('vis');
  const dur = RM ? 1 : 380;
  el.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: dur, easing: EASE_D });
  const u = under.el.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(-28%)', opacity: .6 }], { duration: dur, easing: EASE_D });
  u.onfinish = () => under.el.classList.remove('vis');
}
function back(opts = {}) {
  if (busyNav && !opts.force) return;
  if (STACK.length < 2) { if (top_().id !== 'home') tab('home'); return; }
  closeAllSheets();
  const e = STACK.pop(), under = top_();
  under.el.classList.add('on');
  e.el.classList.remove('on');
  if (under.id === 'home') R.home(); else if (under.el) { renderTop(under); renderBody(under, false); }
  const tile = e.tile && $(`#home .hp:nth-child(${S.page + 1}) [data-wid="${e.tile}"]`);
  const done = () => { e.el.remove(); under.el.classList.remove('vis'); if (e.onclose) e.onclose(); };
  if (tile && under.id === 'home' && !opts.slide) morphOut(e, tile, done, opts.dy || 0);
  else slideOut(e, under, done, opts.dx || 0);
  setChrome();
}
function morphOut(e, tile, done, dy) {
  lockNav(420);
  const el = e.el; under_vis();
  const m = morphRect(tile);
  const dur = RM ? 1 : 400;
  el.style.transform = '';
  tile.classList.add('hidden');
  const a = el.animate([{ clipPath: `inset(${Math.max(0, dy)}px 0px 0px 0px round ${dy ? 30 : 0}px)`, backgroundColor: getComputedStyle(el).backgroundColor }, { clipPath: `inset(${m.t}px ${m.r}px ${m.b}px ${m.l}px round ${m.rad}px)`, backgroundColor: m.bg }], { duration: dur, easing: EASE_D, fill: 'forwards' });
  $$(':scope > .vtop, :scope > .vsc', el).forEach(c => c.animate([{ opacity: 1 }, { opacity: 0, offset: .45 }, { opacity: 0 }], { duration: dur, fill: 'forwards' }));
  a.onfinish = () => { tile.classList.remove('hidden'); done(); };
}
function under_vis() { const u = top_(); u.el.classList.add('vis'); }
function slideOut(e, under, done, dx) {
  lockNav(360);
  const el = e.el; under.el.classList.add('vis');
  const dur = RM ? 1 : 340, W = APP.clientWidth;
  el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(100%)' }], { duration: dur, easing: EASE_D, fill: 'forwards' }).onfinish = done;
  under.el.animate([{ transform: `translateX(${-28 + dx / W * 28}%)`, opacity: .6 + dx / W * .4 }, { transform: 'none', opacity: 1 }], { duration: dur, easing: EASE_D });
}
/* dock tabs: crossfade between roots, clearing the stack */
function tab(id) {
  if (busyNav) return;
  closeAllSheets(); if (CC.open) ccClose();
  const cur = top_();
  if (cur.id === id && STACK.length === 1) { if (id === 'home') { const sc = $(`#home .hp:nth-child(${S.page + 1}) .hsc`); sc && sc.scrollTo({ top: 0, behavior: 'smooth' }); } return; }
  lockNav(260);
  const old = STACK.splice(0);
  let e;
  if (id === 'home') { e = { id: 'home', el: $('#home'), args: {}, root: true }; R.home(); }
  else { e = { id, args: {}, root: true }; buildView(e); }
  STACK.push(e);
  e.el.classList.add('on', 'vis');
  e.el.style.zIndex = 7;
  const dur = RM ? 1 : 240;
  e.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease-out' }).onfinish = () => {
    e.el.style.zIndex = ''; e.el.classList.remove('vis');
    old.forEach(o => { if (o.el !== e.el) { o.el.classList.remove('on', 'vis'); if (o.id !== 'home') o.el.remove(); } });
  };
  setChrome();
}

/* ---------- dock ---------- */
R.dock = () => {
  const e = top_(), show = STACK.length === 1 && ROOTS.includes(e.id) || (STACK.length === 2 && e.root && e.tile);
  const d = $('#dock');
  d.classList.toggle('hide', !show || !!$('#home.editing') && e.id === 'home');
  const act = e.id;
  const b = (id, icon, label) => `<button class="${act === id ? 'on' : ''}" data-a="tab" data-x="${id}" aria-label="${label}" aria-current="${act === id}">${ico(icon)}<span>${label}</span></button>`;
  d.innerHTML = b('home', 'home', 'Home') + b('plan', 'plan', 'Plan') + `<button class="qa" data-a="quickAdd" data-long="jarvis" aria-label="Quick add">${ico('plus')}</button>` + b('habits', 'habits', 'Habits') + b('apps', 'apps', 'Apps');
};
A.tab = (el, id) => tab(id);
A.back = () => back();
A.open = (el, x) => { const [id, a] = x.split('|'); open(id, a ? JSON.parse(a) : {}); };

/* edge swipe back + swipe down from the top of a view */
addRec({
  axis: 'x', test(st, dx) {
    const e = top_(); if (STACK.length < 2 && !(e.root && e.id !== 'home')) return null;
    if (st.x0 > 26 || dx <= 0 || $('.sheet.on')) return null;
    if (STACK.length < 2) return null;
    const el = e.el, under = STACK[STACK.length - 2];
    under.el.classList.add('vis');
    const W = APP.clientWidth;
    return {
      move(dx) { dx = Math.max(0, dx); el.style.transform = `translateX(${dx}px)`; under.el.style.transform = `translateX(${-28 + dx / W * 28}%)`; under.el.style.opacity = .6 + dx / W * .4; },
      end(dx, dy, vx) {
        under.el.style.transform = ''; under.el.style.opacity = '';
        if (dx > W * .33 || vx > .35) { el.style.transform = `translateX(${dx}px)`; back({ slide: true, dx, force: true }); }
        else { el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 260, easing: EASE_D }); el.style.transform = ''; under.el.classList.remove('vis'); }
      }
    };
  }
});
addRec({
  axis: 'y', test(st, dx, dy) {
    const e = top_(); if (STACK.length < 2 || dy <= 0 || $('.sheet.on') || CC.open) return null;
    if (st.y0 > 130 || V[e.id].noSwipeClose) return null;
    const sc = $('.vsc', e.el); if (sc && sc.scrollTop > 2) return null;
    const el = e.el, under = STACK[STACK.length - 2]; under.el.classList.add('vis');
    return {
      move(dx, dy) { const d = rubber(Math.max(0, dy), 260); el.style.transform = `translateY(${d}px) scale(${1 - d / 1600})`; el.style.borderRadius = Math.min(32, d / 3) + 'px'; },
      end(dx, dy, vx, vy) {
        const d = rubber(Math.max(0, dy), 260);
        if (dy > 120 || vy > .45) { el.style.transform = ''; el.style.borderRadius = ''; back({ dy: d, force: true }); }
        else { el.animate([{ transform: el.style.transform }, { transform: 'none' }], { duration: 300, easing: EASE_D }); el.style.transform = ''; el.style.borderRadius = ''; under.el.classList.remove('vis'); }
      }
    };
  }
});

/* ---------- sheets: drawer curve, draggable, velocity dismiss ---------- */
const SHEETS = [];
function sheet(key, o) {
  closeSheet(key, true);
  const sc = document.createElement('div'); sc.className = 'scrim'; sc.dataset.a = 'sheetX';
  const el = document.createElement('div'); el.className = 'sheet ' + (o.cls || ''); el.dataset.key = key; el.setAttribute('role', 'dialog');
  const sh = { key, el, sc, o };
  SHEETS.push(sh);
  $('#toast').classList.add('top');
  sheetPaint(sh, true);
  $('#ov').append(sc, el);
  el.getBoundingClientRect();
  requestAnimationFrame(() => { sc.classList.add('on'); el.classList.add('on'); });
  if (o.focus) setTimeout(() => { const f = $(o.focus, el); f && f.focus(); }, 380);
  return el;
}
function sheetPaint(sh, fresh) {
  const o = sh.o, b = sh.el.querySelector('.sh-b'), y = b ? b.scrollTop : 0;
  sh.el.innerHTML = `<div class="sh-h"><i></i></div>${o.title ? `<div class="sh-t"><h2>${esc(typeof o.title === 'function' ? o.title() : o.title)}</h2>${o.head ? o.head() : `<button class="kb sm" data-a="sheetX" aria-label="Close">${ico('close')}</button>`}</div>` : ''}<div class="sh-b noscroll">${o.body()}</div>${o.foot ? `<div class="sh-f">${o.foot()}</div>` : ''}`;
  const nb = sh.el.querySelector('.sh-b'); if (!fresh) nb.scrollTop = y;
  hydrate(sh.el);
  o.after && o.after(sh.el, fresh);
}
function repaintSheets() { SHEETS.forEach(s => { if (s.o.live && !(s.el.contains(ROOT.activeElement) && ROOT.activeElement.matches('input,textarea'))) sheetPaint(s, false); }); }
function closeSheet(key, instant) {
  const i = SHEETS.findIndex(s => s.key === key); if (i < 0) return false;
  const [s] = SHEETS.splice(i, 1);
  $('#toast').classList.toggle('top', SHEETS.length > 0);
  if (instant) { s.el.remove(); s.sc.remove(); return true; }
  s.el.classList.remove('on', 'drag'); s.el.style.transform = ''; s.sc.classList.remove('on');
  setTimeout(() => { s.el.remove(); s.sc.remove(); }, 440);
  s.o.onClose && s.o.onClose();
  return true;
}
function closeTopSheet() { const s = SHEETS[SHEETS.length - 1]; return s ? closeSheet(s.key) : false; }
function closeAllSheets() { [...SHEETS].forEach(s => closeSheet(s.key)); }
A.sheetX = () => closeTopSheet();
addRec({
  axis: 'y', test(st, dx, dy) {
    const el = st.target.closest && st.target.closest('.sheet'); if (!el) return null;
    const b = el.querySelector('.sh-b');
    const onHandle = st.target.closest('.sh-h,.sh-t');
    if (!onHandle && !(dy > 0 && b && b.scrollTop <= 0 && b.contains(st.target))) return null;
    if (st.target.closest('input,textarea')) return null;
    el.classList.add('drag');
    return {
      move(dx, dy) { el.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`; },
      end(dx, dy, vx, vy) {
        el.classList.remove('drag');
        const s = SHEETS.find(s => s.el === el);
        if (flick(dy, vy)) { s && closeSheet(s.key); }
        else { el.style.transform = ''; }
      }
    };
  }
});

/* ---- 40-widgets.js ---- */
/* =====================================================================
   Widget registry. Each type: name, sizes it supports, default tone,
   render(size, space, inst) -> inner html, open (view id) or tap(inst, el).
   Sizes: '11' 1x1, '12' 1x2 portrait, '21' 2x1, '22' 2x2, '41' 4x1, '42' 4x2.
   ===================================================================== */
const W = {};
let CELL = 82;
const px2 = sz => { const c = +sz[0], r = +sz[1]; return [c * CELL + (c - 1) * 10, r * CELL + (r - 1) * 10]; };
/* Cut a title on a word, never mid-word. */
const wclip = (t, n) => { t = String(t || ''); if (t.length <= n) return t; const k = t.lastIndexOf(' ', n); return t.slice(0, k > n * .5 ? k : n).replace(/[\s,.;:]+$/, '') + '…'; };
const lb = (t, cls = '') => `<div class="lb ${cls}">${esc(t)}</div>`;
const lbRow = (a, b, bcls = '') => `<div style="display:flex;justify-content:space-between;gap:8px">${lb(a)}${b != null ? lb(b, bcls) : ''}</div>`;

function leftStr() { const l = leftOfDay(); return pad(l.h) + ':' + pad(l.m); }
function secRing(n, size, k, square) { const s = NOW().getSeconds(); return dring({ n, on: s * n / 60, size, r: size / 70, pad: size / 26, square, rad: size * .2, cls: 'wring', k }).replace('<svg', '<svg data-live="sec" data-n="' + n + '"'); }

W.clock = {
  name: 'Left of today', sizes: ['22', '12'], tone: 'k', open: 'today',
  render(sz, sp, inst) {
    const [w] = px2(sz), l = leftStr();
    if (sz === '12') return `<div class="wi c" style="gap:12px;padding-bottom:30px">${dm(l.slice(0, 2), 6.2, { k: inst.id + 'h', cls: 'lvh' })}${dm(l.slice(3), 6.2, { k: inst.id + 'm', cls: 'lvm' })}</div><div class="wi" style="justify-content:flex-end;align-items:center;padding-bottom:12px">${lb('Left')}</div>`;
    return `${secRing(60, w, inst.id + 's', true)}<div class="wi c" style="gap:9px">${dm(l.slice(0, 2), 7.2, { k: inst.id + 'h', cls: 'lvh' })}${dm(l.slice(3), 7.2, { k: inst.id + 'm', cls: 'lvm' })}<div style="height:2px"></div>${lb('Left of today')}</div>`;
  }
};
W.analog = {
  name: 'Clock, analog', sizes: ['22', '11'], tone: 'w', open: 'today',
  render(sz) {
    const [w] = px2(sz), d = NOW();
    const face = (S0, dark) => {
      let t = ''; for (let i = 0; i < 60; i += 5) { const a = i / 60 * Math.PI * 2, r1 = S0 / 2 - S0 * .06, r0 = r1 - S0 * (i % 15 === 0 ? .1 : .06); t += `<line x1="${S0 / 2 + r0 * Math.sin(a)}" y1="${S0 / 2 - r0 * Math.cos(a)}" x2="${S0 / 2 + r1 * Math.sin(a)}" y2="${S0 / 2 - r1 * Math.cos(a)}" stroke="${dark ? '#F2F2F2' : '#0A0A0A'}" stroke-width="${S0 * .014}" stroke-linecap="round"/>`; }
      const c = S0 / 2;
      return `<svg viewBox="0 0 ${S0} ${S0}" width="100%" height="100%" data-live="analog"><circle cx="${c}" cy="${c}" r="${c}" fill="${dark ? '#1B1B1B' : '#F2F2F2'}"/>${t}
        <g class="hh"><line x1="${c}" y1="${c}" x2="${c}" y2="${c - S0 * .24}" stroke="var(--red)" stroke-width="${S0 * .03}" stroke-linecap="round"/></g>
        <g class="mh"><line x1="${c}" y1="${c}" x2="${c}" y2="${c - S0 * .36}" stroke="var(--red)" stroke-width="${S0 * .03}" stroke-linecap="round"/></g>
        <g class="sh"><line x1="${c}" y1="${c + S0 * .06}" x2="${c}" y2="${c - S0 * .4}" stroke="${dark ? '#F2F2F2' : '#0A0A0A'}" stroke-width="${S0 * .008}"/></g><circle cx="${c}" cy="${c}" r="${S0 * .025}" fill="var(--red)"/></svg>`;
    };
    const tl = `${DAYS[TI()]} ${d.getDate()}`;
    if (sz === '11') return `<div class="wi" style="padding:7px">${face(100, false)}</div>`;
    return `<div class="wi" style="padding:14px 14px 12px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="lb fg" style="font-size:11px">${tl}</div><div style="background:var(--fg);color:var(--tb);border-radius:6px;font:700 10px/1 var(--mono);padding:5px 6px">${d.getHours() < 12 ? 'AM' : 'PM'}</div></div><div style="flex:1;display:grid;place-items:center;padding-top:6px"><div style="width:${w - 52}px;height:${w - 52}px">${face(100, true)}</div></div></div>`;
  }
};
W.day = {
  name: 'The day', sizes: ['41', '42'], tone: 'w', open: 'today', openArgs: { at: 'day' },
  render(sz, sp, inst) {
    const dots = MC.dayDots(), q = Math.floor(minsOfDay(NOW()) / 15);
    const cols = sz === '41' ? 48 : 24, rows = 96 / cols, [w] = px2(sz), g = (w - 32) / cols, r = g * (sz === '41' ? .32 : .34);
    let s = '';
    dots.forEach((st, i) => {
      if (i < q && st === 'free') st = 'spent'; if (i === q) st = 'now'; if (i > q && st === 'spent') st = 'free';
      const x = (i % cols) * g + g / 2, y = Math.floor(i / cols) * g + g / 2;
      const cls = st === 'now' ? 'on rd' : st === 'busy' ? 'on' : st === 'focus' ? 'ol' : st === 'spent' ? 'sp' : '';
      s += `<circle class="dt ${cls}" style="animation-delay:${i * 6}ms" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${st === 'focus' ? r * .85 : r}"/>`;
    });
    const left = 96 - q - 1;
    const ph = sz === '42' ? `<div style="display:grid;grid-template-columns:6fr 5fr 3fr 4fr 6fr;margin-top:8px">${['NIGHT', 'MORNING', 'NOON', 'AFTER', 'EVENING'].map(p => `<div class="lb ${p.startsWith(phaseOf().toUpperCase().slice(0, 5)) ? 'fg' : ''}" style="font-size:9px">${p}</div>`).join('')}</div>` : '';
    return `<div class="wi" style="justify-content:space-between">${lbRow('The day', left + ' quarters left')}<div><svg class="dts daydots" viewBox="0 0 ${w - 32} ${rows * g}" width="100%" aria-hidden="true">${s}</svg>${ph}</div></div>`;
  }
};
W.next = {
  name: 'Next', sizes: ['41', '22'], tone: 'w', open: 'plan',
  render(sz, sp) {
    const t = firstMove(sp);
    if (!t) return `<div class="wi">${lb('Next')}<div class="wt" style="margin-top:6px">Nothing open today.</div></div>`;
    if (sz === '22') return `<div class="wi" style="gap:8px">${lbRow('Next', t.est ? fmtMin(t.est) : 'NO ESTIMATE')}<div class="wt" style="font-size:14px;line-height:1.35">${esc(wclip(t.title, 64))}</div></div><button class="wkey" data-a="startTask" data-x="${t.id}">Start</button>`;
    return `<div class="wi" style="flex-direction:row;align-items:center;gap:14px"><div class="grow" style="display:grid;gap:5px">${lbRow('Next', t.est ? fmtMin(t.est) : 'NO ESTIMATE')}<div class="wt" style="font-size:12.5px;line-height:1.3">${esc(wclip(t.title, 52))}</div></div><button class="wkey" style="position:static;flex:none;height:40px;padding:0 14px" data-a="startTask" data-x="${t.id}">Start</button></div>`;
  }
};
W.plan = {
  name: 'Plan', sizes: ['22', '42'], tone: 'k', open: 'plan',
  render(sz, sp, inst) {
    const tot = plannedMin(sp), [w] = px2(sz);
    const rows = MC.slots.map(sl => {
      const m = slotMin(sp, 0, sl.id), capD = sl.capMin / 30, on = Math.min(capD, Math.ceil(m / 30)), over = Math.max(0, Math.ceil((m - sl.capMin) / 30));
      return { sl, m, capD, on, over };
    });
    const big = sz === '42';
    const g = big ? 11 : (w - 50) / 12;
    const rws = rows.map(r => `<div style="display:flex;align-items:center;gap:${big ? 12 : 8}px;height:${big ? 15 : 13}px"><div class="lb" style="width:${big ? 74 : 12}px;font-size:9px">${big ? r.sl.label : r.sl.label[0]}</div>${drow(r.capD, r.on, { gap: g, r: g * .3, over: r.over, k: inst.id + r.sl.id })}${big ? `<div class="lb ${r.over ? 'red' : ''}" style="margin-left:auto;font-size:9px">${r.over ? 'OVER ' + fmtMin(r.m - r.sl.capMin) : fmtMin(r.m)}</div>` : ''}</div>`).join('');
    return `<div class="wi" style="justify-content:space-between">${lbRow('Planned', big ? openToday(sp).length + ' open' : null)}<div style="margin:4px 0 2px">${dm(fmtMin(tot), big ? 5 : 3.6, { k: inst.id + 'tot' })}</div><div style="display:grid;gap:${big ? 4 : 2}px">${rws}</div></div>`;
  }
};
W.habits = {
  name: 'Habits', sizes: ['22', '11'], tone: 'w', open: 'habits',
  render(sz, sp, inst) {
    const hd = habitsDue(sp), [w] = px2(sz), n = sz === '11' ? 28 : 40;
    const on = hd.due ? hd.kept / hd.due * n : 0;
    if (sz === '11') return `${dring({ n, on, size: w, r: 1.6, pad: 6, k: inst.id })}<div class="wcenter">${dm(hd.kept + '/' + hd.due, 2.2)}</div>`;
    return `${dring({ n, on, size: w, r: 2.4, pad: 14, k: inst.id })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:9px">${dm(hd.kept + ' OF ' + hd.due, 3.2, { k: inst.id + 'n' })}${lb('Habits kept')}</div></div>`;
  }
};
W.measure = {
  name: 'Amount habit', sizes: ['11', '22'], tone: 'w', open: 'habits',
  render(sz, sp, inst) {
    const h = habit(inst.arg) || S.habits.find(x => x.kind === 'measured' && !x.auto && inSp(x, sp)), [w] = px2(sz), n = sz === '11' ? 30 : 40;
    if (!h) return `${dring({ n, on: 0, size: w, r: sz === '11' ? 1.7 : 2.6, pad: sz === '11' ? 5 : 14 })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:6px">${dm('0', sz === '11' ? 3 : 6)}${lb('Amount')}</div></div>`;
    const on = clamp(h.today / h.target, 0, 1) * n;
    if (sz === '11') return `${dring({ n, on, size: w, r: 1.7, pad: 5, red: true, k: inst.id })}<div class="wcenter">${dm(h.today, 3, { k: inst.id + 'n' })}</div>`;
    return `${dring({ n, on, size: w, r: 2.6, pad: 14, red: true, k: inst.id })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:8px">${dm(h.today, 6, { k: inst.id + 'n' })}${lb('/' + h.target + ' ' + h.name)}</div></div><button class="wbtn br solid" data-a="logAmount" data-x="${h.id}:${(h.presets || [1])[0]}" aria-label="Add ${(h.presets || [1])[0]}">${ico('plus')}</button>`;
  }
};
W.routine = {
  name: 'Routine', sizes: ['21'], tone: 'w', tap(inst, el) { const r = routineFor(inst, PAGES[S.page]); if (r) open('runner', { id: r.id }, el); },
  render(sz, sp, inst) {
    const r = routineFor(inst, sp);
    if (!r) return `<div class="wi">${lb('Routine')}<div class="wt" style="margin-top:6px">No routine yet.</div></div>`;
    const d = routineDone(r), n = r.steps.length;
    return `<div class="wi" style="gap:6px;padding-right:12px"><div class="wt up" style="font-size:10.5px;font-weight:700;line-height:1.25;color:var(--fd);padding-right:4px">${esc(wclip(r.title, 30))}</div><div class="wsp"></div><div style="display:flex;align-items:center;gap:6px;max-width:calc(100% - 68px);overflow:hidden">${drow(n, d, { gap: n > 6 ? 6.5 : 8, r: n > 6 ? 2.2 : 2.6, k: inst.id })}<span class="lb fg" style="flex:none">${d}/${n}</span></div></div><button class="wkey" style="bottom:10px;right:10px;padding:0 9px" data-a="runRoutine" data-x="${r.id}">${d >= n ? 'Again' : 'Start'}</button>`;
  }
};
const routineFor = (inst, sp) => routine(inst.arg) || S.routines.find(r => inSp(r, sp) && ['daily', 'prework'].includes(r.cadence) && routineDone(r) < r.steps.length) || S.routines.find(r => inSp(r, sp));
W.chain = {
  name: 'The chain', sizes: ['21'], tone: 'k', open: 'jar',
  render(sz, sp, inst) {
    const m = S.momentum, kept = habitsDue('all').kept >= habitsDue('all').due / 2;
    const dots = m.last7.slice(0, 6).map(v => v ? 'on' : '').concat([kept ? 'on' : 'on rd']);
    return `<div class="wi" style="justify-content:space-between">${lb('The chain')}${dm('DAY ' + m.chain, 3.6, { k: inst.id })}<svg class="dts" viewBox="0 0 98 10" width="98" height="10">${dots.map((c, i) => `<circle class="dt ${c}" cx="${i * 14 + 5}" cy="5" r="3.6"/>`).join('')}</svg></div>`;
  }
};
W.focusweek = {
  name: 'Focus week', sizes: ['41'], tone: 'w', open: 'focus',
  render(sz, sp, inst) {
    const [w] = px2(sz), tgt = S.focusTarget, cw = (w - 32) / 7, rows = 6, gh = 6.2;
    const wk = S.focusWeek.map((d, i) => i === 6 ? { ...d, h: focusMinToday() / 60 } : d);
    let s = '';
    wk.forEach((d, i) => {
      const cx = i * cw + cw / 2, lvl = clamp(Math.round(d.h / 5 * (rows - 1)), 0, rows - 1);
      for (let r = 0; r < rows; r++) for (let k = -1; k <= 1; k++) s += `<circle class="dt" cx="${cx + k * 7}" cy="${(rows - 1 - r) * gh + 3}" r="1.1" opacity=".55"/>`;
      const red = i < 6 && d.h < tgt / 2;
      for (let k = -1; k <= 1; k++) s += `<circle class="dt on ${red ? 'rd' : ''}" cx="${cx + k * 7}" cy="${(rows - 1 - lvl) * gh + 3}" r="2.5"/>`;
    });
    const lab = wk.map(d => `<div style="text-align:center"><div class="lb" style="font-size:8.5px">${d.d}</div><div class="lb fg" style="font-size:8.5px">${Math.floor(d.h)}H${pad(Math.round(d.h % 1 * 60))}</div></div>`).join('');
    return `<div class="wi" style="padding:10px 16px 8px;gap:4px"><svg class="dts" viewBox="0 0 ${w - 32} ${rows * gh + 1}" width="100%" aria-hidden="true">${s}</svg><div style="display:grid;grid-template-columns:repeat(7,1fr)">${lab}</div></div>`;
  }
};
W.goals = {
  name: 'Goals', sizes: ['22'], tone: 'w', open: 'habits', openArgs: { seg: 'goals' },
  render(sz, sp) {
    const gs = S.goals.filter(g => inSp(g, sp) && g.status !== 'reached').slice(0, 3);
    return `<div class="wi" style="gap:9px">${lb('Goals')}${gs.map(g => `<div><div class="wt" style="font-size:11px;white-space:nowrap;overflow:hidden">${esc(wclip(g.name, 24))}</div><div style="display:flex;align-items:center;gap:8px;margin-top:3px">${drow(10, Math.round(goalPct(g) * 10), { gap: 9, r: 2.6, red: g.status === 'push', k: 'wg' + g.id + sp })}<span class="lb ${g.status === 'push' ? 'red' : 'fg'}">${Math.round(goalPct(g) * 100)}%</span></div>${g.status === 'push' ? `<div class="lb red" style="font-size:8.5px;margin-top:1px">Needs a push</div>` : ''}</div>`).join('')}</div>`;
  }
};
W.quit = {
  name: 'Quitting', sizes: ['11'], tone: 'w', circ: true, open: 'habits', openArgs: { seg: 'quit' },
  render(sz, sp, inst) {
    const q = S.quitting[0]; if (!q) return `<div class="wcenter"><div class="lb" style="font-size:8px">Nothing to quit</div></div>`;
    const ms = [7, 30, 90, 180, 365].find(m => m > q.daysClean) || 365;
    return `${dring({ n: 30, on: q.daysClean / ms * 30, size: CELL, r: 1.7, pad: 5, k: inst.id })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:5px">${dm(q.daysClean, 3.4, { k: inst.id + 'n' })}<div class="lb" style="font-size:8px">Clean</div></div></div>`;
  }
};
W.focus = {
  name: 'Focus', sizes: ['11'], tone: 'w', circ: true, tone2: () => S.pomo.phase !== 'idle' ? 'r' : null,
  tap(inst, el) { if (S.pomo.phase === 'idle') startFocus({}); else open('zone', {}, el); },
  render(sz, sp, inst) {
    const run = S.pomo.phase !== 'idle';
    if (run) { const l = pomoLeft(); return `<div class="wcenter"><div style="display:grid;justify-items:center;gap:6px"><div class="lb fg" style="font-size:8.5px">${S.pomo.phase === 'paused' ? 'PAUSED' : 'REC'}</div><span data-live="pomo">${dm(pad(Math.floor(l / 60)) + ':' + pad(l % 60), 2.3, { k: 'wpomo' })}</span></div></div>`; }
    return `<div class="wcenter"><div style="display:grid;justify-items:center;gap:6px">${dm(S.pomo.focusMin, 3.4)}<div class="lb" style="font-size:8px">Focus</div></div></div>`;
  }
};
const WX = { 'mostly clear': 'sun', clear: 'sun', overcast: 'cloud', raining: 'rain', drizzling: 'rain' };
W.weather = {
  name: 'Weather', sizes: ['12', '11', '21'], tone: 'k', open: 'weather',
  render(sz) {
    const w = MC.weather; if (!w) return `<div class="wi c">${icoBig('cloud', 30)}<div class="lb" style="margin-top:6px">No weather</div></div>`;
    const ic = WX[w.sky] || 'cloud';
    if (sz === '11') return `<div class="wi c" style="gap:4px">${icoBig(ic, 34)}${dm(w.now + '°', 2.6)}</div>`;
    if (sz === '21') return `<div class="wi" style="flex-direction:row;align-items:center;gap:14px">${icoBig(ic, 52)}<div style="display:grid;gap:7px">${dm(w.now + '°', 3.4)}${lb(w.sky)}${lb('H ' + w.high + '° L ' + w.low + '°')}</div></div>`;
    return `<div class="wi" style="padding:16px 12px 14px"><div style="flex:1;display:grid;place-items:center">${icoBig(ic, 58)}</div><div style="display:grid;gap:7px">${dm(w.now + '°', 3.2)}<div class="lb fg" style="font-size:9.5px;white-space:normal">${w.sky}</div></div></div>`;
  }
};
W.calendar = {
  name: 'Calendar', sizes: ['21'], tone: 'w', open: 'calendar',
  render() {
    const e = nextEvent();
    return `<div class="wi" style="gap:6px">${lbRow(DAYL[TI()], e ? (e.allDay ? 'ALL DAY' : e.start) : 'FREE')}<div class="wt up" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px">${e ? esc(wclip(e.title, 34)) : 'Nothing else today'}</div></div>`;
  }
};
const initials = n => n.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
W.people = {
  name: 'People', sizes: ['22'], tone: 'w', open: 'people',
  render(sz) {
    const od = overdue(), rest = S.people.filter(p => !od.includes(p)), list = od.concat(rest).slice(0, 8), [w] = px2(sz), t = (w - 32 - 24) / 4;
    return `<div class="wi" style="gap:10px;padding:14px 16px"><div style="display:grid;grid-template-columns:repeat(4,${t}px);gap:8px">${list.map(p => `<div style="width:${t}px;height:${t}px;border-radius:${t * .3}px;background:${od.includes(p) ? 'var(--fgx)' : 'var(--fo)'};--fg:${od.includes(p) ? 'var(--tb)' : 'var(--fgx)'};display:grid;place-items:center">${dm(initials(p.name), 2.1)}</div>`).join('')}</div><div style="margin-top:auto">${lb(od.length + ' overdue', 'red')}</div></div>`;
  }
};
W.pipeline = {
  name: 'Pipeline', sizes: ['21'], tone: 'k', open: 'people', openArgs: { mode: 'business' },
  render(sz, sp, inst) { return `<div class="wi" style="justify-content:space-between">${lb('Off-Plate pipeline')}<div style="display:flex;align-items:flex-end;gap:10px">${dm(inPlay().length, 3.4, { k: inst.id })}${lb('In play', 'fg')}</div>${lb(talking().length + ' talking')}</div>`; }
};
W.bills = {
  name: 'Bills', sizes: ['21'], tone: 'w', open: 'bills',
  tone2: () => billsOverdue().length ? 'r' : null,
  render(sz, sp, inst) { if (!S.bills) return `<div class="wi" style="justify-content:space-between">${lb('Bills')}<div class="wt">Sign in to see bills.</div></div>`; const od = billsOverdue().length; return `<div class="wi" style="justify-content:space-between">${lbRow('Bills', od ? od + ' overdue' : 'on track', od ? 'fg' : '')}${dm(kc(billsLeft()), 3.3, { k: inst.id })}${lb('Kč left this month')}</div>`; }
};
W.debt = {
  name: 'Debt', sizes: ['11'], tone: 'k', circ: true, open: 'bills', openArgs: { at: 'debts' },
  render(sz, sp, inst) { const p = S.bills ? S.bills.debtPaidPct : 0; return `${dring({ n: 30, on: p / 100 * 30, size: CELL, r: 1.7, pad: 5, k: inst.id })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:5px">${dm(S.bills ? p + '%' : '-', 2.6)}<div class="lb" style="font-size:8px">${S.bills ? 'Paid' : 'Debt'}</div></div></div>`; }
};
W.notes = {
  name: 'Notes', sizes: ['22', '21'], tone: 'w', open: 'notes',
  render(sz, sp, inst) {
    const n = (inst.arg ? S.notes.find(x => x.id === inst.arg) : null) || S.notes.find(x => !x.done && inSp(x, sp)) || S.notes[0];
    if (!n) return `<div class="wi">${lb('Notes')}<div class="wt" style="margin-top:6px">No notes yet.</div></div>`;
    const f = S.folders.find(f => f.id === n.folder);
    if (sz === '21') return `<div class="wi" style="gap:5px">${lb(f ? f.name : 'Notes')}<div class="wt up" style="font-size:11px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(wclip(n.title || 'Untitled', 34))}</div></div>`;
    return `<div class="wi" style="gap:8px">${lb('Latest note')}<div class="wt up" style="font-size:12.5px;line-height:1.35">${esc(wclip(n.title || 'Untitled', 44))}</div><div class="wt" style="font-size:11px;color:var(--fd);overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical">${esc(n.body)}</div><div class="wsp"></div>${lb(f ? f.name : '')}</div>`;
  }
};
const whyToday = () => { const l = MC.why.filter(w => w.text); return l.length ? l[NOW().getDate() % l.length] : null; };
W.why = {
  name: 'Why', sizes: ['21', '42'], tone: 'k', open: 'why',
  render(sz) { const q = whyToday(); if (!q) return `<div class="wi">${lb('Why, today')}</div>`; return `<div class="wi" style="gap:8px">${lb('Why, today')}<div class="wt up" style="font-size:${sz === '42' ? 20 : 12}px;line-height:1.3;font-weight:700">${esc(q.text)}</div>${q.by ? `<div class="wsp"></div>${lb('- ' + q.by)}` : ''}</div>`; }
};
W.health = {
  name: 'Health', sizes: ['21'], tone: 'w', open: 'health',
  render(sz, sp, inst) {
    const h = MC.health; if (!h) return `<div class="wi" style="justify-content:space-between">${lbRow('Steps', 'Sleep')}<div class="wt">Health loads after you sign in.</div></div>`;
    const sl = h.sleep7.map((v, i) => { let c = ''; for (let k = 0; k < 3; k++) c += `<circle class="dt ${v >= 6 + k * .7 ? (v < 6.5 ? 'on rd' : 'on') : ''}" cx="${i * 7 + 3}" cy="${17 - k * 6.5}" r="2.3"/>`; return c; }).join('');
    return `<div class="wi" style="justify-content:space-between">${lbRow('Steps', 'Sleep')}<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px">${dm(kc(h.steps), 2.7, { k: inst.id })}<svg class="dts" viewBox="0 0 49 20" width="49" height="20">${sl}</svg></div></div>`;
  }
};
W.gym = {
  name: 'Gym', sizes: ['11'], tone: 'w', open: 'gym',
  render() { return `<div class="wi c" style="gap:6px">${icoBig('dumbbell', 30)}${dm(S.gym.target ? S.gym.week + '/' + S.gym.target : String(S.gym.week), 2.6)}</div>`; }
};
W.jar = {
  name: 'Jar', sizes: ['21'], tone: 'k', open: 'jar',
  render(sz, sp, inst) { return `<div class="wi" style="justify-content:space-between">${lbRow('Momentum', 'of 100')}${dm(S.momentum.value, 3.4, { k: inst.id })}${lb(S.momentum.state, 'fg')}</div>`; }
};
const iconW = (name, icon, view, label) => ({ name, sizes: ['11'], tone: 'w', open: view, render() { return `<div class="wi c" style="gap:7px">${icoBig(icon, 26)}<div class="lb fg" style="font-size:8.5px">${label()}</div></div>`; } });
W.ideas = iconW('Ideas', 'ideas', 'ideas', () => S.prompts.length + ' prompts');
W.skills = iconW('Skills', 'skills', 'skills', () => 'Skills');
W.watchless = iconW('Watchless', 'eyeoff', 'watchless', () => 'Watchless');
W.settings = iconW('Settings', 'gear', 'settings', () => 'Settings');
W.search = iconW('Search', 'search', 'search', () => 'Search');
W.zone = iconW('Zone', 'zone', 'zone', () => 'Zone');
W.apps = {
  name: 'Apps', sizes: ['21'], tone: 'k', open: 'apps',
  render() { return `<div class="wi" style="gap:8px">${lb('Apps')}<div style="display:flex;gap:8px">${['Today', 'Plan', 'Habits', 'Notes'].map(a => `<div style="width:34px;height:34px;border-radius:10px;background:var(--fo);display:grid;place-items:center">${dm(a[0], 2)}</div>`).join('')}</div></div>`; }
};
/* Which widgets have something to say in a space. Without it they stay off that home page. */
W.measure.has = (inst, sp) => !!(habit(inst.arg) || S.habits.find(x => x.kind === 'measured' && !x.auto && inSp(x, sp)));
W.routine.has = (inst, sp) => !!routineFor(inst, sp);
W.quit.has = () => S.quitting.length > 0;
W.bills.has = W.debt.has = () => !!S.bills;
W.health.has = () => !!MC.health;
W.weather.has = () => !!MC.weather;
W.notes.has = (inst, sp) => S.notes.some(x => !x.done && inSp(x, sp)) || (sp === 'all' && S.notes.length > 0);
W.why.has = () => MC.why.length > 0;
W.goals.has = (inst, sp) => S.goals.some(g => inSp(g, sp) && g.status !== 'reached');
W.people.has = () => S.people.length > 0;
W.pipeline.has = () => S.prospects.length > 0;
/* Jarvis face: a glyph matrix of dots, eyes blink */
const FACE = ['...............', '...............', '...##.....##...', '...##.....##...', '...............', '...............', '...............', '.....#...#.....', '......###......', '...............', '...............'];
function faceSVG(size, mood) {
  const rows = mood === 'talk' ? FACE.map((r, y) => y === 7 ? '....#.....#....' : y === 8 ? '.....#####.....' : r) : FACE;
  let s = ''; rows.forEach((r, y) => [...r].forEach((c, x) => { s += `<circle class="${c === '#' ? 'fe' + (y < 4 ? ' eye' : '') : 'fo'}" cx="${x + .5}" cy="${y + .5}" r="${c === '#' ? .44 : .22}"/>`; }));
  return `<svg class="face" viewBox="0 0 15 11" width="${size}" aria-hidden="true">${s}</svg>`;
}
W.jarvis = {
  name: 'Jarvis', sizes: ['22', '21'], tone: 'k', open: 'jarvis',
  render(sz) {
    if (sz === '21') return `<div class="wi" style="flex-direction:row;align-items:center;gap:12px">${faceSVG(70)}<div>${lb('Jarvis', 'fg')}${lb(S.cc.dnd ? 'Holding messages' : 'Ask anything')}</div></div>`;
    return `<div class="wi" style="gap:8px">${lbRow('Jarvis', S.cc.dnd ? 'DND' : 'Ready')}<div style="flex:1;display:grid;place-items:center">${faceSVG(120)}</div>${lb(S.cc.dnd ? 'Holding your messages' : 'Ask anything')}</div>`;
  }
};

/* ---- 41-home.js ---- */
/* =====================================================================
   Home: three widget pages (spaces), grid layout engine (CSS grid dense
   packing + FLIP), page swipe with parallax, pull to refresh, edit mode
   (jiggle, remove, resize, drag reorder, gallery), control centre.
   ===================================================================== */
let WID = 0;
const wi = (type, size, o = {}) => ({ id: 'w' + (++WID), type, size, ...o });
S.layout = {
  personal: [wi('clock', '22'), wi('weather', '12'), wi('focus', '11'), wi('quit', '11'), wi('day', '41'), wi('next', '41'),
    wi('plan', '22'), wi('habits', '22'), wi('chain', '21'), wi('routine', '21'), wi('measure', '11'), wi('debt', '11'),
    wi('bills', '21'), wi('health', '21'), wi('jarvis', '21')],
  work: [wi('analog', '22', { tone: 'k' }), wi('calendar', '21'), wi('weather', '11', { tone: 'w' }), wi('search', '11', { tone: 'k' }), wi('day', '41'),
    wi('plan', '22', { tone: 'w' }), wi('habits', '22', { tone: 'k' }), wi('next', '41', { tone: 'k' }), wi('routine', '21'), wi('jar', '21'),
    wi('focusweek', '41'), wi('goals', '22'), wi('notes', '22', { tone: 'k' })],
  all: [wi('clock', '22', { tone: 'w' }), wi('jar', '21'), wi('bills', '21'), wi('plan', '42'), wi('people', '22'), wi('jarvis', '22'),
    wi('focusweek', '41'), wi('pipeline', '21'), wi('why', '21', { tone: 'w' }), wi('ideas', '11'), wi('gym', '11', { tone: 'k' }), wi('notes', '21', { tone: 'k' })]
};
const PAGES = ['all', 'personal', 'work'];
/* The widget layout is how THIS phone is arranged, like the look itself: kept on the device, never synced. */
const LKEY = 'mc:nothing-layout';
const LVER = 1;
try {
  const L = JSON.parse(localStorage.getItem(LKEY) || 'null');
  if (L && L.v === LVER && PAGES.every(p => Array.isArray(L[p]))) {
    const ok = i => i && W[i.type] && typeof i.id === 'string';
    const lay = {}; PAGES.forEach(p => { lay[p] = L[p].filter(ok).map(i => ({ ...i, size: W[i.type].sizes.includes(i.size) ? i.size : W[i.type].sizes[0] })); });
    if (PAGES.some(p => lay[p].length)) { S.layout = lay; WID = Math.max(0, ...PAGES.flatMap(p => lay[p].map(i => +String(i.id).slice(1) || 0))); }
  }
} catch (e) { }
const saveLayout = () => { try { localStorage.setItem(LKEY, JSON.stringify({ v: LVER, ...S.layout })); } catch (e) { } };
/* A widget with nothing to show for this space stays out of the grid. */
const shown = (inst, p) => { const d = W[inst.type]; return !d.has || d.has(inst, p); };
let EDIT = false;

function tileHTML(inst, sp) {
  const d = W[inst.type]; if (!d) return '';
  const tone = (d.tone2 && d.tone2()) || inst.tone || d.tone || 'w';
  const circ = d.circ || (inst.size === '11' && ['habits', 'measure', 'analog'].includes(inst.type));
  let body = ''; try { body = d.render(inst.size, sp, inst); } catch (err) { console.error(err); body = `<div class="wi">${lb('This widget hit an error')}</div>`; }
  return `<div class="w s${inst.size} ${tone} ${circ ? 'circ' : ''}" data-wid="${inst.id}" data-type="${inst.type}" data-a="wtap" role="button" tabindex="0" aria-label="${esc(d.name)}" style="--jd:${(-Math.random() * .3).toFixed(2)}s">${body}<button class="wx" data-a="wRemove" data-x="${inst.id}" aria-label="Remove ${esc(d.name)}">${ico('close')}</button>${d.sizes.length > 1 ? `<button class="wz" data-a="wResize" data-x="${inst.id}" aria-label="Resize">${ico('grid4')}</button>` : ''}</div>`;
}
function homeShell() {
  const h = $('#home');
  h.innerHTML = `<div class="hp-track">${PAGES.map((p, i) => `<div class="hp" data-page="${p}"><div class="hsc noscroll"><div class="htop"><button class="spc" data-a="spacePick" aria-label="Switch space"><span class="sd"></span>${SPACES[i].label}${ico('down')}</button><div class="hdate"><span data-live="hd1">${todayLabel()}</span><br><span data-live="sbt2"></span></div></div><div class="grid"></div></div></div>`).join('')}</div>
  <div class="ptr"><div class="spin">${spinSVG()}</div></div>
  <div class="dockfade"></div>
  <div class="pdots">${PAGES.map(() => '<i></i>').join('')}</div>
  <div class="editbar"><button class="key t" data-a="gallery">${ico('plus')} Widget</button><button class="key" data-a="editDone">Done</button></div>`;
}
function spinSVG() { let s = ''; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; s += `<circle cx="${15 + 10 * Math.sin(a)}" cy="${15 - 10 * Math.cos(a)}" r="2.2" style="animation-delay:${i * .09 - .72}s"/>`; } return `<svg class="chase" viewBox="0 0 30 30" width="30" height="30">${s}</svg>`; }
function measureCell() { const w = APP.clientWidth; CELL = Math.floor((Math.min(w, 430) - 32 - 30) / 4); APP.style.setProperty('--cell', CELL + 'px'); }
R.home = () => {
  if (!$('#home .hp-track')) homeShell();
  PAGES.forEach((p, i) => {
    const g = $(`#home .hp:nth-child(${i + 1}) .grid`);
    if (DRAG_W && i === S.page) return;
    g.innerHTML = S.layout[p].filter(inst => shown(inst, p)).map(inst => tileHTML(inst, p)).join('');
    hydrate(g);
  });
  setPage(S.page, false);
};
/* The store update and the chrome accent re-render the whole app, so a swiped
   page commits them once it has settled, never while the slide is running. */
let COMMIT_T = 0;
function commitPage() { const sp = PAGES[S.page]; B.setView(sp); APP.dataset.sp = sp; R.dock(); }
function setPage(i, anim = true) {
  S.page = i;
  clearTimeout(COMMIT_T); if (anim) COMMIT_T = setTimeout(commitPage, 440); else { B.setView(PAGES[i]); APP.dataset.sp = PAGES[i]; }
  const tr = $('#home .hp-track'); tr.classList.toggle('drag', !anim);
  tr.style.transform = `translateX(${-i * 100 / 3}%)`;
  $$('#home .hp').forEach(h => h._par && h._par.forEach(e => { e.style.transform = ''; }));
  $$('#home .pdots i').forEach((d, k) => { d.classList.toggle('on', k === i); d.style.width = k === i ? '18px' : '6px'; });
}
/* page swipe with parallax */
addRec({
  axis: 'x', test(st, dx) {
    if (top_().id !== 'home' || EDIT || CC.open || $('.sheet.on')) return null;
    if (!st.target.closest('#home') || st.target.closest('.wx,.wz')) return null;
    const tr = $('#home .hp-track'), W0 = APP.clientWidth, pages = $$('#home .hp'), dots = $$('#home .pdots i');
    pages.forEach(p => { p._par = p._par || [$('.htop', p), $('.grid', p)]; });
    tr.classList.add('drag');
    return {
      move(dx) {
        let f = S.page - dx / W0; if (f < 0) f = -rubber(-f * W0, 80) / W0; if (f > 2) f = 2 + rubber((f - 2) * W0, 80) / W0;
        tr.style.transform = `translateX(${-f * W0}px)`;
        pages.forEach((p, k) => { const q = clamp(k - f, -1, 1); p._par[0].style.transform = `translateX(${q * 70}px)`; p._par[1].style.transform = `translateX(${q * 26}px)`; });
        dots.forEach((d, k) => { const a = clamp(1 - Math.abs(k - f), 0, 1); d.style.width = (6 + 12 * a) + 'px'; d.style.opacity = .25 + .75 * a; });
      },
      end(dx, dy, vx) {
        let n = S.page; if (dx < -W0 * .3 || vx < -.3) n++; else if (dx > W0 * .3 || vx > .3) n--; n = clamp(n, 0, 2);
        tr.classList.remove('drag'); dots.forEach(d => d.style.opacity = '');
        setPage(n);
      }
    };
  }
});
A.spacePick = () => sheet('space', {
  title: 'Spaces', body: () => `<div class="rows cd tight">${SPACES.map((s, i) => `<button class="row" data-a="goPage" data-x="${i}" style="width:100%"><span class="cat" style="background:${i === S.page ? 'var(--red)' : 'var(--off)'};width:9px;height:9px"></span><span class="grow rt one">${s.label}</span><span class="lb">${S.layout[s.id].length} widgets</span>${i === S.page ? ico('check') : ''}</button>`).join('')}</div><div class="empty" style="padding-top:6px">Swipe left and right on Home to move between spaces.</div>`
});
A.goPage = (el, i) => { closeSheet('space'); setTimeout(() => { setPage(+i); refresh(); }, 120); };
/* Change where things land: the same space switch as swiping Home. */
A.ctxSpace = () => A.spacePick();
/* The Plan header chip: which space, and which project, in one picker. */
A.ctxPick = () => sheet('ctx', {
  title: 'Showing', live: true, body: () => { const sp = viewSpace(), pf = S.ui.planProj, ps = MC.projects.filter(p => inSp(p, sp));
    return `<div class="sl">Space</div><div class="rows cd tight">${SPACES.map((z, i) => `<button class="row" data-a="ctxGo" data-x="${i}" style="width:100%"><span class="cat" style="background:${i === S.page ? 'var(--red)' : 'var(--off)'};width:9px;height:9px"></span><span class="grow rt one">${z.label}</span>${i === S.page ? ico('check') : ''}</button>`).join('')}</div>
    <div class="sl">Project</div><div class="cd tight rows"><button class="row" style="width:100%" data-a="ctxProj" data-x=""><span class="grow rt one">All projects</span>${!pf ? ico('check') : ''}</button>${ps.map(p => `<button class="row" style="width:100%" data-a="ctxProj" data-x="${p.id}">${ico('folder')}<span class="grow rt one">${esc(p.name)}</span>${pf === p.id ? ico('check') : ''}</button>`).join('')}<button class="row" style="width:100%" data-a="ctxProj" data-x="__u"><span class="grow rt one">Unsorted</span>${pf === '__u' ? ico('check') : ''}</button></div>`; }
});
A.ctxGo = (el, i) => { setPage(+i, false); if (S.ui.planProj && S.ui.planProj !== '__u' && !inSp(MC.projects.find(p => p.id === S.ui.planProj) || {}, curSpace())) S.ui.planProj = null; refresh(); };
A.ctxProj = (el, x) => { S.ui.planProj = x || null; closeSheet('ctx'); refresh(); };

/* tile tap: open its view with the morph */
A.wtap = (el) => {
  if (EDIT) return;
  const inst = findInst(el.dataset.wid); if (!inst) return;
  const d = W[inst.type];
  if (d.tap) return d.tap(inst, el);
  open(d.open, { ...(d.openArgs || {}), space: PAGES[S.page] }, el);
};
const findInst = id => { for (const p of PAGES) { const x = S.layout[p].find(i => i.id === id); if (x) return x; } return null; };
const pageOf = id => PAGES.find(p => S.layout[p].some(i => i.id === id));

/* ---------- pull to refresh (lower area) and control centre pull (top) ---------- */
addRec({
  axis: 'y', test(st, dx, dy) {
    if (top_().id !== 'home' || EDIT || CC.open || dy <= 0 || $('.sheet.on')) return null;
    if (!st.target.closest('#home')) return null;
    const sc = $(`#home .hp:nth-child(${S.page + 1}) .hsc`);
    if (st.y0 < 96) return ccPullHandler();
    if (sc.scrollTop > 0) return null;
    const home = $('#home'), sp = $('#home .ptr .spin');
    home.classList.add('pulling');
    return {
      move(dx, dy) { const d = rubber(Math.max(0, dy), 140); sc.style.transform = `translateY(${d}px)`; sp.style.transform = `translateY(${d * .55 - 10}px) rotate(${d * 3}deg)`; },
      end(dx, dy) {
        const d = rubber(Math.max(0, dy), 140);
        sc.classList.add('rubber'); sc.style.transform = ''; setTimeout(() => sc.classList.remove('rubber'), 460);
        if (d > 62) { sp.style.transform = 'translateY(26px)'; doRefresh(); } else { home.classList.remove('pulling'); sp.style.transform = ''; }
      }
    };
  }
});
function doRefresh() {
  const home = $('#home'); home.classList.remove('pulling'); home.classList.add('refreshing');
  B.refresh();
  setTimeout(() => {
    home.classList.remove('refreshing'); $('#home .ptr .spin').style.transform = '';
    refresh();
    toast(S.sync.label || 'Refreshed');
  }, 1300);
}

/* ---------- edit mode ---------- */
function enterEdit() { if (EDIT) return; EDIT = true; $('#home').classList.add('editing'); R.dock(); }
A.editDone = () => { EDIT = false; $('#home').classList.remove('editing'); R.dock(); saveLayout(); };
addRec({
  long(st) {
    if (st.target.closest('.dock .qa')) return { end() { open('jarvis'); } };
    if (top_().id !== 'home' || CC.open || $('.sheet.on')) return null;
    if (!st.target.closest('#home') || st.target.closest('.editbar,.htop')) return null;
    const tile = st.target.closest('.w');
    enterEdit();
    if (tile) return tileDrag(tile, st);
    return { end() { } };
  }
});
addRec({
  test(st) { if (!EDIT || top_().id !== 'home') return null; const tile = st.target.closest('#home .w'); if (!tile || st.target.closest('.wx,.wz')) return null; return tileDrag(tile, st); }
});
let DRAG_W = null;
function flipGrid(grid, mutate, skip) {
  const tiles = $$('.w', grid), before = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
  mutate();
  $$('.w', grid).forEach(t => {
    if (t === skip) return; const a = before.get(t); if (!a) return; const b = t.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top; if (!dx && !dy) return;
    t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: RM ? 1 : 300, easing: 'cubic-bezier(.23,1,.32,1)' });
  });
}
function tileDrag(tile, st) {
  const grid = tile.parentNode, p = PAGES[S.page];
  let base = tile.getBoundingClientRect(), gx = st.x0, gy = st.y0;
  const ar = APP.getBoundingClientRect();
  DRAG_W = tile.dataset.wid;
  tile.classList.add('dragging');
  let lastSwap = 0;
  return {
    move(dx, dy, x, y) {
      if (st.ox == null) { st.ox = st.x0 - (base.left - ar.left); st.oy = st.y0 - (base.top - ar.top); }
      tile.style.transform = 'none'; base = tile.getBoundingClientRect();
      tile.style.transform = `translate(${x - st.ox - (base.left - ar.left)}px,${y - st.oy - (base.top - ar.top)}px) scale(1.04)`;
      if (performance.now() - lastSwap < 160) return;
      const others = $$('.w', grid).filter(t => t !== tile);
      let best = null, bd = 1e9;
      others.forEach(t => { const r = t.getBoundingClientRect(); const d = Math.hypot(r.left - ar.left + r.width / 2 - x, r.top - ar.top + r.height / 2 - y); if (d < bd) { bd = d; best = t; } });
      /* Swap only once the finger is over the other tile, so it can never flip back and forth while it sits between two. */
      const br = best && best.getBoundingClientRect(), inside = br && x >= br.left - ar.left && x <= br.right - ar.left && y >= br.top - ar.top && y <= br.bottom - ar.top;
      if (best && inside) {
        const arr = S.layout[p], from = arr.findIndex(i => i.id === tile.dataset.wid), to = arr.findIndex(i => i.id === best.dataset.wid);
        if (from >= 0 && to >= 0 && from !== to) {
          lastSwap = performance.now();
          flipGrid(grid, () => { const [m] = arr.splice(from, 1); arr.splice(to, 0, m); const ref = to > from ? best.nextSibling : best; grid.insertBefore(tile, ref); }, tile);
          const nb = (tile.style.transform = 'none', tile.getBoundingClientRect());
          tile.style.transform = `translate(${x - st.ox - (nb.left - ar.left)}px,${y - st.oy - (nb.top - ar.top)}px) scale(1.04)`;
        }
      }
    },
    end() {
      const b = tile.getBoundingClientRect(); tile.style.transform = '';
      const a = tile.getBoundingClientRect();
      tile.animate([{ transform: `translate(${b.left - a.left}px,${b.top - a.top}px) scale(1.04)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' }).onfinish = () => tile.classList.remove('dragging');
      DRAG_W = null; saveLayout();
    }
  };
}
A.wRemove = (el, id) => {
  const p = pageOf(id), arr = S.layout[p], i = arr.findIndex(x => x.id === id), inst = arr[i];
  const grid = el.closest('.grid'), tile = el.closest('.w');
  tile.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 200, easing: 'ease-in' }).onfinish = () => {
    flipGrid(grid, () => { arr.splice(i, 1); tile.remove(); });
  };
  saveLayout(); undoable(W[inst.type].name + ' removed', () => { arr.splice(i, 0, inst); saveLayout(); });
};
A.wResize = (el, id) => {
  const inst = findInst(id), d = W[inst.type], k = d.sizes.indexOf(inst.size);
  inst.size = d.sizes[(k + 1) % d.sizes.length];
  const grid = el.closest('.grid'), old = el.closest('.w');
  flipGrid(grid, () => { const t = document.createElement('div'); t.innerHTML = tileHTML(inst, PAGES[S.page]); const n = t.firstChild; old.replaceWith(n); hydrate(n); }); saveLayout();
};
A.gallery = () => sheet('gallery', {
  title: 'Widgets', body: () => `<div class="gal">${Object.entries(W).map(([type, d]) => {
    const sz = d.sizes[0], [w, h] = px2(sz), sc = Math.min(1, 150 / w, 104 / h);
    return `<div class="gi" role="button" tabindex="0" data-a="wAdd" data-x="${type}"><div class="gp"><div style="width:${w * sc}px;height:${h * sc}px;position:relative"><div style="position:absolute;left:0;top:0;transform:scale(${sc});transform-origin:0 0">${tileHTML({ id: 'g' + type, type, size: sz }, PAGES[S.page]).replace('data-a="wtap"', '').replace(/data-k="[^"]*"/g, '').replace(/<button class="w[xz]"[^]*?<\/button>/g, '').replace(/<button([^>]*)>([^]*?)<\/button>/g, '<span$1>$2</span>').replace(/data-a="[^"]*"/g, '').replace('class="w ', `style="width:${w}px;height:${h}px" class="w `)}</div></div></div><div class="gn">${esc(d.name)}<span>${d.sizes.map(s => s[0] + 'X' + s[1]).join(' ')}</span></div></div>`;
  }).join('')}</div>`
});
A.wAdd = (el, type) => {
  closeSheet('gallery');
  const p = PAGES[S.page], inst = wi(type, W[type].sizes[0]);
  S.layout[p].push(inst); R.home(); saveLayout();
  setTimeout(() => {
    const t = $(`#home [data-wid="${inst.id}"]`); if (!t) return;
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      t.classList.add('drop'); setTimeout(() => t.classList.remove('drop'), 520);
      const ar = APP.getBoundingClientRect(), r = t.getBoundingClientRect();
      for (let i = 0; i < 14; i++) { const s = document.createElement('i'); s.className = 'sparkle'; const a = i / 14 * Math.PI * 2; s.style.left = (r.left - ar.left + r.width / 2) + 'px'; s.style.top = (r.top - ar.top + r.height / 2) + 'px'; s.style.setProperty('--dx', Math.cos(a) * (r.width / 2 + 20) + 'px'); s.style.setProperty('--dy', Math.sin(a) * (r.height / 2 + 20) + 'px'); APP.append(s); setTimeout(() => s.remove(), 650); }
    }, 300);
  }, 420);
  toast(W[type].name + ' added to ' + SPACES[S.page].label);
};

/* ---------- control centre ---------- */
const CC = { open: false, y: 0 };
function ccToggles() {
  const P = S.pomo.phase !== 'idle';
  return [
    { id: 'jarvis', icon: 'face', label: 'Jarvis mode', sub: S.cc.jarvis ? 'On' : 'Off', on: S.cc.jarvis },
    { id: 'focus', icon: 'zone', label: 'Focus', sub: P ? pomoText() + ' left' : S.pomo.focusMin + ' min block', on: P, live: P },
    { id: 'sync', icon: 'sync', label: 'Sync', sub: S.sync.state === 'saving' ? 'Saving' : S.sync.label.replace('Synced ', ''), on: S.cc.sync, live: S.sync.state === 'saving' },
    { id: 'dnd', icon: 'moon', label: 'Do not disturb', sub: S.cc.dnd ? 'Holding Jarvis' : 'Off', on: S.cc.dnd },
    { id: 'hevy', icon: 'dumbbell', label: 'Hevy sync', sub: S.hevyBusy ? 'Syncing' : S.gym.lastSync.replace('Synced from Hevy ', '').replace('Not synced from Hevy on this device', 'Not yet'), on: S.hevyBusy },
    { id: 'theme', icon: 'theme', label: 'Dark mode', sub: S.theme === 'dark' ? 'On' : 'Off', on: S.theme === 'dark' },
    { id: 'review', icon: 'sunrise', label: 'Daily review', sub: S.dailyDone ? 'Done today' : 'Yesterday', on: false },
    { id: 'search', icon: 'search', label: 'Search', sub: 'Every task', on: false }
  ];
}
R.cc = () => {
  const cc = $('#cc'); if (!cc.firstChild) cc.innerHTML = `<div class="cc-s" data-a="ccClose"></div><div class="cc-p"></div>`;
  const p = $('.cc-p', cc), d = NOW(), done = minsOfDay(d) / 1440;
  p.innerHTML = `<div class="cc-hd"><div>${dm(hm(d), 5.4, { k: 'cct' })}<div class="lb" style="margin-top:9px">${DAYL[TI()]} ${d.getDate()} ${MONTHL[d.getMonth()]}</div></div><div class="lb" style="text-align:right">${esc(S.sync.label)}<br>Week ${MC.isoWeek}</div></div>
  <div class="cc-g">${ccToggles().slice(0, 4).map((t, i) => tgHTML(t, i)).join('')}
    <button class="ccdial ccx" style="--i:4" data-a="ccDial" aria-label="Day done">${dring({ n: 48, on: done * 48, size: 160, r: 2.6, pad: 12, k: 'ccdial' })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:8px">${dm(Math.round(done * 100) + '%', 4.4, { k: 'ccdn' })}<div class="lb">Day done</div></div></div></button>
    ${ccToggles().slice(4, 6).map((t, i) => tgHTML(t, i + 5)).join('')}
    ${ccToggles().slice(6).map((t, i) => tgHTML(t, i + 7)).join('')}
    <div class="ccsl ccx" style="--i:9" data-slider="1"><div class="lb fg" style="width:58px">Focus target</div><div class="trk">${sliderSVG()}</div>${dm(S.focusTarget + 'H', 2.6, { k: 'ccsl' })}</div>
  </div><div class="cc-grab"><i></i></div>`;
  hydrate(p);
  $('.cc-s', cc).style.opacity = CC.open ? 1 : 0;
};
const tgHTML = (t, i) => `<button class="tg ${t.live ? 'live' : t.on ? 'on' : ''}" style="--i:${i}" data-a="cc" data-x="${t.id}" aria-pressed="${!!t.on}"><span class="ic">${ico(t.icon)}</span><span style="min-width:0"><b>${t.label}</b><small>${esc(t.sub)}</small></span></button>`;
function sliderSVG() { let s = ''; for (let i = 0; i < 8; i++) s += `<circle class="dt ${i < S.focusTarget ? 'on' : ''}" cx="${i * 12.5 + 6}" cy="32" r="${i < S.focusTarget ? 4 : 2.2}"/>`; return `<svg class="dts" viewBox="0 0 100 64" preserveAspectRatio="xMidYMid meet">${s}</svg>`; }
function ccSet(y, anim) {
  const p = $('#cc .cc-p'), s = $('#cc .cc-s'), H = p.offsetHeight;
  p.style.transition = anim ? 'transform .42s cubic-bezier(.32,.72,0,1)' : 'none';
  s.style.transition = anim ? 'opacity .3s' : 'none';
  p.style.transform = `translateY(${y - H}px)`; s.style.opacity = clamp(y / H, 0, 1);
}
function ccOpen() { R.cc(); CC.open = true; $('#cc').classList.add('open'); ccSet($('#cc .cc-p').offsetHeight, true); }
function ccClose() { CC.open = false; $('#cc').classList.remove('open'); ccSet(0, true); }
A.ccClose = ccClose;
A.ccOpen = ccOpen;
function ccPullHandler() {
  R.cc(); const p = $('#cc .cc-p'), H = p.offsetHeight; $('#cc').classList.add('open');
  return {
    move(dx, dy) { const y = dy > H ? H + rubber(dy - H, 60) : Math.max(0, dy); ccSet(y, false); },
    end(dx, dy, vx, vy) { if (dy > H * .3 || vy > .4) { CC.open = true; ccSet(H, true); } else ccClose(); }
  };
}
addRec({
  axis: 'y', test(st, dx, dy) {
    if (!CC.open || !st.target.closest('#cc') || st.target.closest('.ccsl')) return null;
    const H = $('#cc .cc-p').offsetHeight;
    return { move(dx, dy) { ccSet(dy < 0 ? H + dy : H + rubber(dy, 40), false); }, end(dx, dy, vx, vy) { if (dy < -60 || vy < -.35) ccClose(); else ccSet(H, true); } };
  }
});
addRec({
  axis: 'x', test(st) {
    const sl = st.target.closest && st.target.closest('.ccsl'); if (!sl) return null;
    const trk = $('.trk', sl);
    const setv = x => { const r = trk.getBoundingClientRect(), ar = APP.getBoundingClientRect(); const v = clamp(Math.round((x + ar.left - r.left) / r.width * 8 + .5), 1, 8); if (v !== S.focusTarget) { S.focusTarget = v; $$('.trk circle', sl).forEach((c, i) => { c.classList.toggle('on', i < v); c.setAttribute('r', i < v ? 4 : 2.2); }); dmLive($('.dm', sl), v + 'H'); } };
    return { move(dx, dy, x) { setv(x); }, end() { refresh(); } };
  }
});
A.ccDial = () => { ccClose(); open('today'); };
A.cc = (el, id) => {
  if (id === 'jarvis') { S.cc.jarvis = !S.cc.jarvis; APP.classList.toggle('hud', S.cc.jarvis); toast(S.cc.jarvis ? 'Jarvis mode is a look on this screen only for now' : 'Jarvis mode off'); }
  if (id === 'focus') { if (S.pomo.phase === 'idle') startFocus({}); else stopFocus(true); }
  if (id === 'sync') { B.refresh(); toast(S.sync.label || 'Sync runs by itself'); }
  if (id === 'dnd') { S.cc.dnd = !S.cc.dnd; toast(S.cc.dnd ? 'Do not disturb is not wired to anything yet' : 'Do not disturb off'); }
  if (id === 'hevy') hevySync();
  if (id === 'theme') { const r = el.getBoundingClientRect(), ar = APP.getBoundingClientRect(); setTheme(S.theme === 'dark' ? 'light' : 'dark', r.left - ar.left + r.width / 2, r.top - ar.top + r.height / 2); return; }
  if (id === 'review') { ccClose(); setTimeout(openDaily, 200); return; }
  if (id === 'search') { ccClose(); setTimeout(() => open('search'), 150); return; }
  refresh();
};
/* Light and dark are the two Nothing looks: switching one is picking the other skin. */
function setTheme(t, x, y) {
  const next = t === 'dark' ? '#000000' : '#E8E8E8';
  APP.dataset.next = next;
  dissolve(x ?? APP.clientWidth / 2, y ?? 200, () => {
    S.theme = t; HOST.dataset.theme = t;
    B.setSkin(t === 'dark' ? 'nothing-dark' : 'nothing-light');
    refresh();
  });
}
function hevySync() {
  if (S.hevyBusy) return; S.hevyBusy = true; refresh();
  B.syncHevy().then(msg => { S.hevyBusy = false; refresh(); toast(msg); }, () => { S.hevyBusy = false; refresh(); toast('Hevy could not be reached'); });
}

/* ---------- live ticker: clocks, rings, timers ---------- */
function tick() {
  pomoTick();
  if (document.hidden) return;
  /* Only what is on screen: not the two off-screen home pages, not a Home hidden under another view. */
  const on = e => { const v = e.closest('.view'); if (v && !v.classList.contains('on')) return false; const h = e.closest('.hp'); return !h || h.dataset.page === PAGES[S.page]; };
  const live = sel => $$(sel).filter(on);
  const d = NOW(), l = leftStr(), s = d.getSeconds();
  if (s % 4 === 0) live('.face').forEach(f => { f.classList.add('bl'); setTimeout(() => f.classList.remove('bl'), 400); }); /* a blink every 4 s, not an endless animation */
  live('.dm.lvh').forEach(e => dmLive(e, l.slice(0, 2)));
  live('.dm.lvm').forEach(e => dmLive(e, l.slice(3)));
  live('svg[data-live="sec"]').forEach(svg => { const n = +svg.dataset.n, on = Math.round(s * n / 60); $$('.dt', svg).forEach((c, i) => c.classList.toggle('on', i < on)); });
  live('svg[data-live="analog"]').forEach(svg => {
    const c = 50; $('.hh', svg).setAttribute('transform', `rotate(${(d.getHours() % 12 + d.getMinutes() / 60) * 30} ${c} ${c})`);
    $('.mh', svg).setAttribute('transform', `rotate(${(d.getMinutes() + s / 60) * 6} ${c} ${c})`); $('.sh', svg).setAttribute('transform', `rotate(${s * 6} ${c} ${c})`);
  });
  const st = $('#sbar .t'); if (st) st.textContent = d.getHours() + ':' + pad(d.getMinutes());
  live('[data-live="sbt2"]').forEach(e => e.textContent = 'WEEK ' + MC.isoWeek);
  live('[data-live="hd1"]').forEach(e => e.textContent = todayLabel());
  live('[data-live="left"]').forEach(e => { const L = leftOfDay(); dmLive($('.dm', e), pad(L.h) + ':' + pad(L.m) + ':' + pad(L.s)); });
  live('[data-live="now"]').forEach(e => e.textContent = hm(d));
}
function sbar() {
  $('#sbar').innerHTML = `<span class="t">9:41</span><span class="r"><i class="jd"></i><svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.5 7a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0zM1.3 4.8a9.5 9.5 0 0 1 13.4 0l-1.4 1.4a7.5 7.5 0 0 0-10.6 0z"/></svg><svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2"/><rect x="24.5" y="4.5" width="1.6" height="4" rx=".8" opacity=".45"/></svg></span>`;
}
/* tapping the status area opens the control centre */
APP.addEventListener('click', e => { if (top_().id !== 'home' || CC.open || EDIT) return; const ar = APP.getBoundingClientRect(); if (e.clientY - ar.top < (FRAME ? 50 : 20) && !e.target.closest('[data-a]')) ccOpen(); });

/* ---- 50-actions.js ---- */
/* =====================================================================
   Shared behaviour: focus engine, task rows + swipe + reorder, task
   actions (complete with How long?, delete with undo, menu, breakdown),
   habit actions, quick add.
   ===================================================================== */

/* ---------- focus: the real Pomodoro (pomodoro.tsx), shared across devices through activeFocus ---------- */
function pomoLeft() { const p = S.pomo; if (p.phase === 'focus' || p.phase === 'break') return Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000)); if (p.phase === 'paused') return p.left; return p.focusMin * 60; }
const pomoText = () => { const l = pomoLeft(); return pad(Math.floor(l / 60)) + ':' + pad(l % 60); };
function startFocus(o = {}) {
  const t = o.taskId ? task(o.taskId) : null;
  const min = o.min || (t && t.est ? Math.min(90, Math.max(5, taskLeft(t))) : S.pomo.focusMin);
  B.pomo().startFocus(min, o.label || (t ? t.title : undefined));
  toast(`Focus started: ${min} min${t ? ' on "' + t.title + '"' : ''}`, { act: 'openZone', actLabel: 'Zone' });
}
A.openZone = () => { A.toastX(); open('zone'); };
function stopFocus(bank) {
  const p = S.pomo; if (p.phase === 'idle') return;
  const spent = Math.floor((p.total - pomoLeft()) / 60);
  B.pomo().stop();
  if (bank) toast(spent > 0 ? `${spent} min banked` : 'Block ended');
}
function pauseFocus() { B.pomo().toggle(); }
let lastPomoSec = -1;
/* The display only. The end of a block is the real Pomodoro's: it logs the block and asks what next. */
function pomoTick() {
  const p = S.pomo; if (p.phase === 'idle') return;
  const l = pomoLeft();
  $$('[data-live="pomo"]').forEach(e => dmLive($('.dm', e), pad(Math.floor(l / 60)) + ':' + pad(l % 60)));
  if (typeof zoneTick === 'function') zoneTick(l);
  if (l !== lastPomoSec && l % 30 === 0) R.cc();
  lastPomoSec = l;
}
A.focusStart = (el, x) => startFocus(x ? { taskId: x } : {});
A.focusPause = () => pauseFocus();
A.focusStop = () => stopFocus(true);
A.startTask = (el, id) => { startFocus({ taskId: id }); };

/* ---------- task rows ---------- */
const catDot = c => `<span class="cat" style="background:${MC.categories[c] || 'var(--off)'}"></span>`;
function taskRow(t, o = {}) {
  const sub = t.subtasks ? `${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}` : '';
  const open_ = S.ui['sub' + t.id];
  const age = t.ageDays != null ? `<span class="age ${t.ageDays >= 30 ? 'hot' : ''}">${t.ageDays}D</span>` : '';
  const est = t.done ? `<span class="est">${t.actualMin != null ? fmtMin(t.est) + ' > ' + fmtMin(t.actualMin) : fmtMin(t.est)}</span>` : `<button class="est ${t.est ? '' : 'none'}" data-a="estEdit" data-x="${t.id}">${t.est ? fmtMin(t.est) : 'NO EST'}</button>`;
  return `<div class="sw" data-sw="task" data-id="${t.id}" ${o.reorder ? `data-reorder="${o.reorder}"` : ''}>
    <div class="sw-l">${ico('check')} Done</div>
    <div class="sw-r"><button class="key sm" data-a="taskPlanMenu" data-x="${t.id}">Plan</button><button class="key sm red" data-a="taskDel" data-x="${t.id}">Delete</button></div>
    <div class="sw-fg"><div class="row" style="padding:10px 12px">
      ${ck(t.done, `data-a="taskCk" data-x="${t.id}" aria-label="Complete ${esc(t.title)}"`)}
      <div class="grow" data-a="taskMenu" data-x="${t.id}"><div class="rt ${t.done ? 'done' : ''}">${esc(t.title)}</div><div class="rs">${catDot(t.category)}<span>${esc(o.space ? SPACES.find(s => s.id === t.space).label : projName(t.projectId))}</span>${t.at ? `<span>${t.at}</span>` : ''}${age}${t.alert ? '<span class="red">Alert</span>' : ''}${sub ? `<button class="lb fg" data-a="subToggle" data-x="${t.id}" style="padding:4px 0">${open_ ? '▾' : '▸'} ${sub}</button>` : ''}</div></div>
      ${est}${!t.done && o.play ? `<button class="kb sm" data-a="startTask" data-x="${t.id}" aria-label="Start focus" ${t.est ? '' : 'disabled'}>${ico('play')}</button>` : ''}
    </div>${open_ && t.subtasks ? `<div class="subs" style="padding:0 12px 10px 52px">${t.subtasks.map(s => `<div class="row" style="min-height:40px;padding:4px 0">${ck(s.done, `data-a="subCk" data-x="${t.id}:${s.id}"`, 'sm')}<div class="grow rt one ${s.done ? 'done' : ''}" style="font-size:13px">${esc(s.title)}</div><span class="age">${s.done && s.actualMin ? fmtMin(s.actualMin) + ' TAKEN' : fmtMin(s.est)}</span></div>`).join('')}</div>` : ''}</div>
  </div>`;
}
A.subToggle = (el, id) => { S.ui['sub' + id] = !S.ui['sub' + id]; refresh(); };
A.subCk = (el, x) => { const [tid, sid] = x.split(':'); B.store().toggleSubtask(tid, sid); };
A.taskCk = (el, id) => { const t = task(id); if (t.done) { B.store().toggleTask(id); return; } el.classList.add('on'); setTimeout(() => howLong(t), 260); };

/* complete: How long? */
function howLong(t) {
  const tracked = S.focus.sessions.filter(s => s.label === t.title).reduce((a, s) => a + s.min, 0);
  const opts = [tracked ? [tracked, tracked + 'M TRACKED'] : null, t.est ? [Math.round(t.est / 2), fmtMin(t.est / 2)] : null, t.est ? [t.est, fmtMin(t.est)] : null, t.est ? [t.est * 2, fmtMin(t.est * 2)] : null].filter(Boolean);
  sheet('howlong', {
    title: 'How long?', body: () => `<div class="cd"><div class="rt">${esc(t.title)}</div><div class="rs">Estimate ${t.est ? fmtMin(t.est) : 'none'}</div></div>
      <div class="g2">${opts.map(([m, l]) => `<button class="key t" style="height:56px" data-a="logActual" data-x="${t.id}:${m}">${l}</button>`).join('')}</div>
      <div class="hstack" style="margin-top:10px"><input class="fld" id="hlc" inputmode="numeric" placeholder="Minutes it took" data-enter="logActualCustom" data-x="${t.id}"><button class="key" data-a="logActualCustom" data-x="${t.id}">Log</button></div>
      <button class="key t wide" style="margin-top:10px" data-a="logActual" data-x="${t.id}:skip">Skip, just tick it</button>`
  });
}
/* With minutes it is logActual (time, ledger row, focus); without, a plain tick. Undo reopens it. */
function complete(t, mins) {
  if (mins != null) B.store().logActual(t.id, mins); else B.store().toggleTask(t.id);
  undoable(`Done${mins != null ? ' in ' + fmtMin(mins) : ''}: ${t.title}`, () => B.store().toggleTask(t.id));
}
A.logActual = (el, x) => { const [id, m] = x.split(':'); closeSheet('howlong'); complete(task(id), m === 'skip' ? null : +m); };
A.logActualCustom = (el, id) => { const v = +$('#hlc').value; if (!v) return; closeSheet('howlong'); complete(task(id), v); };
A.taskDel = (el, id) => {
  const t = task(id); B.store().deleteTask(id);
  undoable('Deleted: ' + t.title, () => B.store().undoDelete());
};
A.estEdit = (el, id) => {
  const t = task(id);
  sheet('est', {
    title: 'Estimate', body: () => `<div class="cd"><div class="rt">${esc(t.title)}</div></div><div class="g3">${[5, 10, 15, 20, 30, 45, 60, 90, 120].map(m => `<button class="key ${t.est === m ? '' : 't'}" style="height:52px" data-a="estSet" data-x="${id}:${m}">${fmtMin(m)}</button>`).join('')}</div>
    <div class="hstack" style="margin-top:10px"><input class="fld" id="estc" inputmode="numeric" placeholder="Minutes" data-enter="estCustom" data-x="${id}"><button class="key" data-a="estCustom" data-x="${id}">Set</button></div>`
  });
};
A.estSet = (el, x) => { const [id, m] = x.split(':'); B.store().setEstimate(id, +m); closeSheet('est'); };
A.estCustom = (el, id) => { const v = +$('#estc').value; if (v) { B.store().setEstimate(id, v); closeSheet('est'); } };

/* task action sheet */
A.taskMenu = (el, id) => {
  const t = task(id); if (!t) return;
  const projs = MC.projects.filter(p => p.space === t.space && p.id !== t.projectId);
  sheet('taskmenu', {
    title: () => 'Task', live: true, body: () => `<div class="cd"><div class="rt">${esc(t.title)}</div><div class="rs">${catDot(t.category)}${esc(projName(t.projectId))}<span>${t.est ? fmtMin(t.est) : 'No estimate'}</span>${t.ageDays != null ? `<span>${t.ageDays} days old</span>` : ''}</div></div>
    <div class="g2">
      <button class="key t" style="height:52px" data-a="taskEdit" data-x="${id}">${ico('edit')} Edit</button>
      <button class="key t" style="height:52px" data-a="breakdown" data-x="${id}">${ico('wand')} Break it down</button>
      <button class="key red" style="height:52px" data-a="taskFocus" data-x="${id}">${ico('play')} Start focus</button>
      <button class="key t" style="height:52px" data-a="taskBacklog" data-x="${id}">${ico('list')} ${t.list === 'today' ? 'Back to list' : 'On the list'}</button>
    </div>
    <div class="sl">Plan for a day</div><div class="chips">${[0, 1, 2, 3, 4, 5, 6].map(o => `<button class="chip ${t.list === 'today' && t.day === o ? 'on' : ''}" data-a="taskDay" data-x="${id}:${o}">${dayShort(o)}</button>`).join('')}</div>
    <div class="sl">Straight into today</div><div class="chips">${MC.slots.map(s => `<button class="chip ${t.list === 'today' && t.day === 0 && t.slot === s.id ? 'on' : ''}" data-a="taskSlot" data-x="${id}:${s.id}">${s.label}</button>`).join('')}</div>
    <div class="sl">Move to project</div><div class="chips"><button class="chip ${!t.projectId ? 'on' : ''}" data-a="taskProj" data-x="${id}:">Unsorted</button>${projs.map(p => `<button class="chip" data-a="taskProj" data-x="${id}:${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="sl">Move to space</div><div class="chips">${SPACES.slice(0, 2).map(s => `<button class="chip ${t.space === s.id ? 'on' : ''}" data-a="taskSpace" data-x="${id}:${s.id}">${s.label}</button>`).join('')}</div>
    <button class="key red wide" style="margin-top:18px" data-a="taskDelM" data-x="${id}">${ico('trash')} Delete</button>`
  });
};
A.taskPlanMenu = A.taskMenu;
A.taskDelM = (el, id) => { closeSheet('taskmenu'); A.taskDel(el, id); };
A.taskFocus = (el, id) => { closeSheet('taskmenu'); startFocus({ taskId: id }); };
A.taskBacklog = (el, id) => { const t = task(id), toToday = t.list !== 'today'; B.store().moveTaskList(id, toToday ? 'today' : 'backlog'); toast(toToday ? 'On today' : 'Back on the to-do list'); };
A.taskDay = (el, x) => { const [id, o] = x.split(':'); B.store().moveTaskList(id, 'today', isoOff(+o)); toast('Planned for ' + dayShort(+o).toLowerCase()); };
A.taskSlot = (el, x) => { const [id, s] = x.split(':'); B.store().moveTaskList(id, 'today'); B.store().assignSlot(id, s); toast('Into the ' + s); };
A.taskProj = (el, x) => { const [id, p] = x.split(':'); B.store().setTaskProject(id, p || undefined); toast('Moved to ' + projName(p)); };
A.taskSpace = (el, x) => { const [id, s] = x.split(':'), t = task(id); if (t.space !== s) B.store().setTaskSpace(id, s); toast('Moved to ' + SPACES.find(z => z.id === s).label); };
A.taskEdit = (el, id) => {
  const t = task(id);
  sheet('taskedit', { title: 'Edit this task', focus: '#tet', body: () => `<input class="fld" id="tet" value="${esc(t.title)}" data-enter="taskEditSave" data-x="${id}">`, foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="taskEditSave" data-x="${id}">Save changes</button>` });
};
A.taskEditSave = (el, id) => { const v = $('#tet').value.trim(); if (v) B.store().updateTask(id, { title: v }); closeSheet('taskedit'); };

/* Break it down: the real AI breakdown (ai.ts), written to the task with setSubtasks */
const BD_WHY = { 'no-key': 'There is no AI key on this device. Add one in Settings.', 'bad-key': 'The AI key was rejected.', 'rate-limit': 'The AI is rate limiting right now. Try again in a minute.', failed: 'The AI could not be reached.' };
A.breakdown = (el, id) => {
  closeSheet('taskmenu');
  const t = task(id); S.ui.bd = { id, state: 'loading', steps: [] };
  sheet('breakdown', {
    title: 'Break it down', live: true, body: () => {
      const b = S.ui.bd, steps = b.steps;
      return `<div class="cd"><div class="rt">${esc(t.title)}</div></div>
      ${b.state === 'loading' ? `<div class="cd" style="display:flex;align-items:center;gap:12px"><span class="blink3"><i></i><i></i><i></i></span><span class="wt dimt">Reading this task and working out the steps.</span></div>` :
          b.state === 'fail' ? `<div class="cd"><div class="wt">${esc(b.why)}</div></div>` :
          `<div class="cd tight rows">${steps.map((s, i) => `<div class="row bd-in" style="animation-delay:${i * 130}ms">${dm(String(i + 1).padStart(2, '0'), 2.4)}<div class="grow rt">${esc(s.title)}</div><span class="est">${fmtMin(s.est)}</span></div>`).join('')}</div><div class="lb" style="margin:4px 6px 0">Planned ${fmtMin(steps.reduce((a, s) => a + s.est, 0))}</div>`}`;
    }, foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="bdAdd" ${S.ui.bd.state !== 'ready' ? 'disabled' : ''}>Add ${S.ui.bd.steps.length || ''} steps</button>`
  });
  B.breakdown(t.title, t.category).then(r => {
    if (r.ok) { S.ui.bd.steps = r.steps.map(x => ({ title: x.title, est: x.estimateMin })); S.ui.bd.state = 'ready'; }
    else { S.ui.bd.state = 'fail'; S.ui.bd.why = BD_WHY[r.reason] || BD_WHY.failed; }
    repaintSheets();
  }, () => { S.ui.bd.state = 'fail'; S.ui.bd.why = BD_WHY.failed; repaintSheets(); });
};
A.bdAdd = () => { const b = S.ui.bd; B.store().setSubtasks(b.id, b.steps.map(x => ({ title: x.title, estimateMin: x.est }))); S.ui['sub' + b.id] = true; closeSheet('breakdown'); toast(b.steps.length + ' steps added'); };

/* swipe rows: right completes / ticks, left reveals actions */
addRec({
  axis: 'x', test(st, dx) {
    const sw = st.target.closest && st.target.closest('.sw[data-sw]'); if (!sw || EDIT) return null;
    const fg = $('.sw-fg', sw), wasOpen = sw.classList.contains('reveal');
    $$('.sw.reveal').forEach(o => o !== sw && o.classList.remove('reveal'));
    sw.classList.add('drag');
    const base = wasOpen ? -156 : 0;
    return {
      move(dx) { let x = base + dx; if (x > 0) x = Math.min(x, 160 + rubber(x - 160, 40)); if (x < -156) x = -156 - rubber(-156 - x, 30); fg.style.transform = `translateX(${x}px)`; sw.querySelector('.sw-l').style.opacity = x > 0 ? 1 : 0; },
      end(dx, dy, vx) {
        sw.classList.remove('drag'); fg.style.transform = ''; sw.querySelector('.sw-l').style.opacity = '';
        const x = base + dx;
        if (x > 96 || (x > 40 && vx > .5)) { sw.classList.remove('reveal'); swipeDone(sw); return; }
        sw.classList.toggle('reveal', x < -60 || (x < -20 && vx < -.4));
      }
    };
  }
});
function swipeDone(sw) {
  const id = sw.dataset.id, kind = sw.dataset.sw;
  if (kind === 'task') { const t = task(id); if (t.done) B.store().toggleTask(id); else howLong(t); }
  if (kind === 'habit') A.habitTick(null, id);
}
ROOT.addEventListener('click', e => { if (!e.target.closest('.sw.reveal')) $$('.sw.reveal').forEach(o => o.classList.remove('reveal')); });

/* long-press a task row to pick it up and reorder within its list */
addRec({
  long(st) {
    const sw = st.target.closest && st.target.closest('.sw[data-reorder]'); if (!sw) return null;
    const list = sw.parentNode, key = sw.dataset.reorder, sc = sw.closest('.vsc');
    sw.classList.add('lifted');
    const y0 = st.y0;
    let moved = false;
    return {
      move(dx, dy) {
        moved = true;
        sw.style.transform = 'none';
        const nt = sw.getBoundingClientRect().top; if (st.r0 == null) st.r0 = nt;
        const want = st.r0 + dy, center = want + sw.offsetHeight / 2;
        const sibs = $$(`:scope > .sw[data-reorder="${key}"]`, list).filter(s => s !== sw);
        for (const s of sibs) {
          const b = s.getBoundingClientRect(), mid = b.top + b.height / 2;
          if (b.top > nt && center > mid) { flipList(list, () => list.insertBefore(sw, s.nextSibling), sw); }
          else if (b.top < nt && center < mid) { flipList(list, () => list.insertBefore(sw, s), sw); break; }
        }
        sw.style.transform = `translateY(${want - sw.getBoundingClientRect().top}px) scale(1.02)`;
      },
      end() {
        sw.style.transform = ''; sw.classList.remove('lifted');
        if (!moved) return;
        /* The real app has no hand order for tasks yet, so nothing is written. */
        toast('Hand order is not saved yet'); refresh();
      }
    };
  }
});
function flipList(list, mutate, skip) {
  const items = $$(':scope > .sw', list), before = new Map(items.map(t => [t, t.getBoundingClientRect().top]));
  mutate();
  $$(':scope > .sw', list).forEach(t => { if (t === skip) return; const d = before.get(t) - t.getBoundingClientRect().top; if (d) t.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.23,1,.32,1)' }); });
}

/* ---------- habits ---------- */
A.habitTick = (el, id) => {
  const h = habit(id); if (!h) return;
  if (h.auto) { toast('This one fills itself from your focus blocks'); return; }
  if (h.kind === 'measured') { A.logAmount(null, id + ':' + ((h.presets || [1])[0])); return; }
  const on = !h.doneToday;
  B.store().toggleHabitDay(id, TI());
  if (on) undoable('Kept: ' + h.name, () => B.store().markHabitDay(id, TI(), false));
};
/* An amount habit writes one dated amount (logAmount); a counted one logs one time (logCount). */
A.logAmount = (el, x) => {
  const [id, n] = x.split(':'), h = habit(id), v = +n; if (!h || !v) return;
  if (h.measure === 'amount') {
    if (v < 0) return;
    const src = B.store().logAmount(id, v);
    undoable(`+${v}${h.unit ? ' ' + h.unit : ''} ${h.name}: ${h.today + v} of ${h.target}`, src ? () => B.store().removeAmount(id, src) : null);
    return;
  }
  B.store().logCount(id, v > 0 ? 1 : -1);
  if (v > 0) undoable(`+1 ${h.name}: ${(h.per === 'week' ? h.current : h.today) + 1} of ${h.target}`, () => B.store().logCount(id, -1));
};
A.runRoutine = (el, id) => { const t = el.closest('.w'); open('runner', { id }, t); };

/* ---------- quick add ---------- */
const QA_TYPES = [['task', 'Task', 'list'], ['habit', 'Habit log', 'habits'], ['note', 'Note', 'note'], ['focus', 'Focus', 'zone'], ['contact', 'Contact', 'person'], ['expense', 'Expense', 'money']];
A.quickAdd = () => {
  S.ui.qa = S.ui.qa || { type: 'task', day: 0, slot: null, habit: (S.habits.find(h => h.kind === 'measured' && !h.auto) || {}).id, person: (S.people[0] || {}).id, channel: 'call' };
  sheet('qa', {
    title: 'Add', live: true, focus: '#qat', body: () => {
      const q = S.ui.qa, ph = { task: 'What needs doing?', habit: 'How many?', note: 'Write it down', focus: 'What are you focusing on?', contact: 'How did it go? (optional)', expense: 'What was it, and how much?' }[q.type];
      const extra = q.type === 'habit' ? `<div class="chips" style="margin-top:10px">${S.habits.filter(h => h.kind === 'measured' && !h.auto).map(h => `<button class="chip ${q.habit === h.id ? 'on' : ''}" data-a="qaHabit" data-x="${h.id}">${esc(h.name)}</button>`).join('')}</div>`
        : q.type === 'contact' ? `<div class="chips" style="margin-top:10px">${S.people.slice(0, 8).map(p => `<button class="chip ${q.person === p.id ? 'on' : ''}" data-a="qaPerson" data-x="${p.id}">${esc(p.name)}</button>`).join('')}</div><div class="chips" style="margin-top:6px">${['inperson', 'call', 'message', 'video', 'email'].map(c => `<button class="chip ${q.channel === c ? 'on' : ''}" data-a="qaChan" data-x="${c}">${c === 'inperson' ? 'In person' : c}</button>`).join('')}</div>`
          : q.type === 'focus' ? `<div class="chips" style="margin-top:10px">${[15, 25, 45, 60].map(m => `<button class="chip ${(q.min || 25) === m ? 'on' : ''}" data-a="qaMin" data-x="${m}">${m} min</button>`).join('')}</div>`
            : q.type === 'task' ? `<div class="lb" style="margin-top:14px">When</div><div class="chips" style="margin-top:6px">${[0, 1, 2, 3, 4, 5, 6].map(d => `<button class="chip ${q.day === d ? 'on' : ''}" data-a="qaDay" data-x="${d}">${dayShort(d)}</button>`).join('')}<button class="chip ${q.day === null ? 'on' : ''}" data-a="qaDay" data-x="none">NO DATE</button></div>${q.day === null ? '' : `<div class="lb" style="margin-top:12px">Part of the day</div><div class="chips" style="margin-top:6px">${[[null, 'ANY TIME'], ['morning', 'MORNING'], ['noon', 'NOON'], ['afternoon', 'AFTERNOON'], ['evening', 'EVENING']].map(([v, l]) => `<button class="chip ${q.slot === v ? 'on' : ''}" data-a="qaSlot" data-x="${v || 'any'}">${l}</button>`).join('')}</div>`}` : '';
      return `<div class="chips" role="tablist">${QA_TYPES.map(([id, l, ic]) => `<button class="chip ${q.type === id ? 'on' : ''}" data-a="qaType" data-x="${id}">${ico(ic)}${l}</button>`).join('')}</div>
      <div class="hstack" style="margin-top:12px"><input class="fld" id="qat" placeholder="${ph}" value="${esc(q.text || '')}" data-enter="qaGo" ${q.type === 'habit' ? 'inputmode="numeric"' : ''}><button class="kb ${q.listening ? 'red' : ''}" data-a="qaMic" aria-label="Dictate">${q.listening ? `<span class="wave"><i></i><i></i><i></i><i></i></span>` : ico('mic')}</button></div>${extra}
      ${['task', 'habit', 'note'].includes(q.type) ? `<button class="ctx" style="margin:12px 0 0" data-a="ctxSpace"><span class="sd"></span>Adding to<b>${esc(spLabel(wsp()))}${q.type === 'task' ? ', ' + esc(projFor(wsp()) ? projFor(wsp()).name : 'Unsorted') : ''}</b>${ico('down')}</button>` : ''}`;
    }, foot: () => `<button class="key red wide" data-a="qaGo">${ico('plus')} Add</button>`
  });
};
A.qaType = (el, t) => { S.ui.qa.text = ($('#qat') || {}).value || ''; S.ui.qa.type = t; repaintSheets(); };
A.qaHabit = (el, h) => { S.ui.qa.text = $('#qat').value; S.ui.qa.habit = h; repaintSheets(); };
A.qaPerson = (el, p) => { S.ui.qa.text = $('#qat').value; S.ui.qa.person = p; repaintSheets(); };
A.qaChan = (el, c) => { S.ui.qa.text = $('#qat').value; S.ui.qa.channel = c; repaintSheets(); };
A.qaMin = (el, m) => { S.ui.qa.text = $('#qat').value; S.ui.qa.min = +m; repaintSheets(); };
A.qaDay = (el, d) => { S.ui.qa.text = $('#qat').value; S.ui.qa.day = d === 'none' ? null : +d; repaintSheets(); };
A.qaSlot = (el, v) => { S.ui.qa.text = $('#qat').value; S.ui.qa.slot = v === 'any' ? null : v; repaintSheets(); };
A.qaMic = () => toast('Dictation is not wired into this look yet. The keyboard mic works.');
A.qaGo = () => {
  const q = S.ui.qa, v = ($('#qat').value || '').trim();
  const sp = wsp(), pj = projFor(sp);
  if (q.type === 'task') {
    if (!v) return;
    const dated = q.day !== null && q.day !== undefined;
    const id = B.store().addTask({ title: v, source: 'mc', estimateMin: 0, space: sp, projectId: pj ? pj.id : undefined, list: dated ? 'today' : 'backlog', ...(dated ? { plannedOn: isoOff(q.day), ...(q.slot ? { slot: q.slot } : {}) } : {}), category: 'quick' });
    toast(dated ? 'On ' + dayShort(q.day).toLowerCase() + (q.slot ? ', ' + q.slot : '') : 'Added to the to-do list', { act: 'seeTask', x: id, actLabel: 'See it' });
  }
  if (q.type === 'habit') { if (!q.habit) return; const h = habit(q.habit); const n = h.measure === 'amount' ? (+v || (h.presets || [1])[0]) : 1; A.logAmount(null, q.habit + ':' + n); }
  if (q.type === 'note') { if (!v) return; const nid = B.addNote(sp, v); toast('Note saved', { act: 'seeNote', x: nid, actLabel: 'Open' }); }
  if (q.type === 'focus') { startFocus({ label: v || 'Focus block', min: q.min || 25 }); }
  if (q.type === 'contact') { const p = S.people.find(p => p.id === q.person); if (!p) return; B.logContact(p.id, q.channel); toast(`Logged: ${q.channel === 'inperson' ? 'in person' : q.channel} with ${p.name}`); }
  if (q.type === 'expense') { toast('Expenses are logged in Compass. Nothing was saved here.'); return; }
  q.text = ''; closeSheet('qa'); refresh();
};
A.jarvis = () => open('jarvis');

/* ---- 51-today-plan.js ---- */
/* =====================================================================
   Today, Plan, Projects, Search, Day record
   ===================================================================== */
const viewSpace = () => curSpace();
const card = (inner, cls = '') => `<div class="cd ${cls}">${inner}</div>`;
const fig = (v, k, o = {}) => `<div class="fig">${dm(v, o.cell || 3.6, { k: o.k, cls: o.cls, count: o.count })}<div class="lb ${o.lcls || ''}" style="margin-top:8px">${k}</div></div>`;

/* swipe between days on any [data-dayswipe] panel */
addRec({
  axis: 'x', test(st) {
    const p = st.target.closest && st.target.closest('[data-dayswipe]'); if (!p || st.target.closest('.sw[data-sw]')) return null;
    const key = p.dataset.dayswipe;
    return {
      move(dx) { p.style.transform = `translateX(${dx * .5}px)`; p.style.opacity = 1 - Math.min(.5, Math.abs(dx) / 500); },
      end(dx, dy, vx) {
        p.style.transform = ''; p.style.opacity = '';
        const cur = S.ui[key] || 0; let n = cur;
        if (dx < -60 || vx < -.35) n++; else if (dx > 60 || vx > .35) n--;
        n = clamp(n, 0, 6); if (n === cur) return;
        S.ui[key] = n; S.ui.dayDir = n > cur ? 1 : -1; refresh();
      }
    };
  }
});
const dayAnim = () => S.ui.dayDir ? `style="animation:dayin${S.ui.dayDir > 0 ? 'r' : 'l'} .32s var(--eo) both"` : '';
A.pickDay = (el, x) => { const [key, n] = x.split(':'); S.ui.dayDir = +n > (S.ui[key] || 0) ? 1 : -1; S.ui[key] = +n; refresh(); };

function dayStrip(key, sp) {
  const cur = S.ui[key] || 0;
  return `<div class="dstrip">${[0, 1, 2, 3, 4, 5, 6].map(o => { const m = plannedMin(sp, o); return `<button class="dpill ${o === cur ? 'on' : ''} ${o === 0 ? 'today' : ''}" data-a="pickDay" data-x="${key}:${o}"><span>${DAYS[(TI() + o) % 7]}</span><b>${dayDate(o).getDate()}</b><i class="${m ? 'has' : ''}"></i></button>`; }).join('')}</div>`;
}
function dayDots96(cols = 24, big = 1) {
  const q = Math.floor(minsOfDay(NOW()) / 15), dots = MC.dayDots(), g = 13 * big, r = 3.7 * big; let s = '';
  dots.forEach((st, i) => { if (i < q && st === 'free') st = 'spent'; if (i === q) st = 'now'; if (i > q && st === 'spent') st = 'free'; const cls = st === 'now' ? 'on rd' : st === 'busy' ? 'on' : st === 'focus' ? 'ol' : st === 'spent' ? 'sp' : ''; s += `<circle class="dt ${cls}" style="animation-delay:${i * 5}ms" cx="${(i % cols) * g + g / 2}" cy="${Math.floor(i / cols) * g + g / 2}" r="${st === 'focus' ? r * .8 : r}"/>`; });
  return `<svg class="dts daydots" viewBox="0 0 ${cols * g} ${96 / cols * g}" width="100%" aria-label="The day in quarter hours">${s}</svg>`;
}

/* ---------------- TODAY ---------------- */
V.today = {
  title: 'Today', action: () => `<button class="kb" data-a="openDaily" aria-label="Daily review">${ico('sunrise')}</button>`,
  render(a) {
    const sp = viewSpace(a), L = leftOfDay(), d = NOW(), q = Math.floor(minsOfDay(d) / 15);
    const nx = firstMove(sp), hd = habitsDue(sp), fin = doneToday(sp).length, saved = MC.timeSaved.todaySavedMin;
    const ex = (MC.exceptions[curSpace()] || []).map(x => `<div class="cd xc"><div class="hstack" style="align-items:flex-start"><span class="xdot ${x.tone}"></span><div class="grow wt">${esc(x.text)}</div></div><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="key sm ${x.tone === 'alert' ? 'red' : ''}" data-a="exAct" data-x="${x.id}">${x.action}</button></div></div>`).join('');
    const list = S.ui.todayList || 'todo';
    const lists = {
      todo: backlog(sp).sort((x, y) => x.ageDays - y.ageDays).slice(0, 10),
      clock: S.tasks.filter(t => t.list === 'today' && t.day === 0 && inSp(t, sp)).sort((x, y) => x.done - y.done || MC.slots.findIndex(s => s.id === x.slot) - MC.slots.findIndex(s => s.id === y.slot)).slice(0, 10),
      standing: S.tasks.filter(t => !t.done && t.ageDays >= 14 && inSp(t, sp)).sort((x, y) => y.ageDays - x.ageDays).slice(0, 10)
    };
    const clk = lists.clock;
    const wk = S.ui.todayWeek || 0;
    const dayItems = S.tasks.filter(t => t.list === 'today' && t.day === wk && inSp(t, sp));
    const routinesDue = S.routines.filter(r => inSp(r, sp) && ['daily', 'prework'].includes(r.cadence)).sort((x, y) => routineDone(x) / x.steps.length - routineDone(y) / y.steps.length);
    const loose = hd.list.filter(h => !h.routine);
    const goals = S.goals.filter(g => inSp(g, sp) && g.status !== 'reached').slice(0, 5);
    return `
    <div class="cd k hero" id="today-hero">${lbRow('Left of today', phaseOf().toUpperCase())}<div style="margin:14px 0 16px" data-live="left">${dm(pad(L.h) + ':' + pad(L.m) + ':' + pad(L.s), 5.6, { k: 'tleft' })}</div>
      <div class="facts"><div>${lb('Now')}<b data-live="now">${hm(d)}</b></div><div>${lb('Day')}<b>${todayLabel()}</b></div><div>${lb('Week')}<b>${MC.isoWeek}</b></div><div>${lb('Gone')}<b>${Math.round(minsOfDay(d) / 14.4)}%</b></div></div></div>
    ${ex}
    <div class="cd" id="today-day">${lbRow('The day', (95 - q) + ' quarters left')}<div style="margin:14px 0 10px">${dayDots96()}</div><div class="phases">${['Night', 'Morn', 'Noon', 'After', 'Eve'].map(p => `<span class="${phaseOf().startsWith(p.slice(0, 4)) || (p === 'Morn' && phaseOf() === 'Morning') ? 'on' : ''}">${p}</span>`).join('')}</div></div>
    ${nx ? `<div class="cd">${lbRow('Next', nx.est ? fmtMin(nx.est) : 'No estimate')}<div class="rt" style="font-size:16px;margin:10px 0 14px">${esc(nx.title)}</div><div class="hstack"><span class="age ${nx.ageDays >= 7 ? 'hot' : ''}">${nx.ageDays} DAYS OLD</span><span class="grow"></span><button class="key red" data-a="startTask" data-x="${nx.id}">${ico('play')} Start</button></div></div>` : ''}
    <div class="g2">
      <div class="cd stat">${fig(fmtMin(focusMinToday()), 'Focused', { k: 'tfoc', cell: 3.4 })}<div style="margin:10px 0">${drow(8, Math.round(focusMinToday() / 30), { gap: 9, r: 2.6, k: 'tfocd' })}</div>${S.pomo.phase === 'idle' ? `<button class="key sm" data-a="focusStart">Start a block</button>` : `<button class="key sm red" data-a="open" data-x="zone">In the zone</button>`}</div>
      <div class="cd stat">${fig(hd.kept + '/' + hd.due, 'Habits kept', { k: 'thab', cell: 3.4 })}<div style="margin-top:10px">${drow(hd.due, hd.kept, { gap: 9, r: 2.6, rows: 2, k: 'thabd' })}</div></div>
      <div class="cd stat k">${fig(fin, 'Finished', { k: 'tfin', cell: 3.4, count: true })}<div style="margin-top:10px">${drow(5, Math.min(5, fin), { gap: 9, r: 2.6, k: 'tfind' })}</div></div>
      <div class="cd stat">${fig((saved >= 0 ? '+' : '-') + fmtMin(saved), saved >= 0 ? 'Against estimate' : 'Over estimate', { k: 'tsav', cell: 3.4, cls: saved < 0 ? 'rd' : '' })}</div>
    </div>
    <div class="sl">The week<b>${weekRange()}</b></div>
    ${dayStrip('todayWeek', sp)}
    <div class="cd" data-dayswipe="todayWeek" ${dayAnim()}>${lbRow(wk === 0 ? 'Today' : DAYL[(TI() + wk) % 7], dayItems.length ? fmtMin(dayItems.filter(t => !t.done).reduce((a, t) => a + t.est, 0)) + ' planned' : '-')}
      <div class="rows" style="margin-top:6px">${dayItems.length ? ['', ...MC.slots.map(s => s.id)].map(sl => { const its = dayItems.filter(t => (t.slot || '') === sl); return its.length ? `<div class="row" style="min-height:0;padding:8px 0;align-items:flex-start"><span class="lb" style="width:74px;padding-top:2px">${sl || 'Unsorted'}</span><div class="grow">${its.map(t => `<div class="rt one ${t.done ? 'done' : ''}" style="font-size:13px;margin-bottom:3px">${catDot(t.category)} ${esc(t.title)}</div>`).join('')}</div></div>` : ''; }).join('') : `<div class="empty">Nothing planned. Swipe for other days.</div>`}</div>
      <button class="key t sm" style="margin-top:8px" data-a="tab" data-x="plan">Plan this day</button></div>
    <div class="sl">Lists</div>
    <div class="seg">${[['todo', 'To-do', S.backlogExtra + backlog(sp).length], ['clock', 'On the clock', clk.filter(t => !t.done).length + '/' + clk.length], ['standing', 'Standing', lists.standing.length]].map(([id, l, n]) => `<button class="${list === id ? 'on' : ''}" data-a="todayList" data-x="${id}">${l} <span class="n">${n}</span></button>`).join('')}</div>
    <div class="cd tight rows scan" style="margin-top:10px">${list === 'todo' ? (lists.todo.length ? lists.todo.map(t => taskRow(t)).join('') : '<div class="empty">Nothing waiting.</div>')
        : list === 'clock' ? (clk.length ? clk.map(t => `<div class="row"><span class="ck ${t.done ? 'on' : ''}" style="width:22px;height:22px;border-radius:7px"><svg viewBox="0 0 16 16">${CK_DOTS}</svg></span><span class="lb" style="width:70px">${t.slot || '-'}</span><span class="grow rt one ${t.done ? 'done' : ''}">${esc(t.title)}</span></div>`).join('') : '<div class="empty">Nothing planned into today.</div>')
          : lists.standing.map(t => `<div class="row"><span class="age ${t.ageDays >= 30 ? 'hot' : ''}" style="width:40px">${t.ageDays}D</span><span class="grow rt one">${esc(t.title)}</span></div>`).join('') || '<div class="empty">Nothing has been waiting two weeks.</div>'}</div>
    <div class="sl">Routines<b>${routinesDue.filter(r => routineDone(r) >= routineReq(r)).length}/${routinesDue.length}</b></div>
    <div class="cd tight rows">${routinesDue.map(r => `<button class="row" style="width:100%" data-a="openRunner" data-x="${r.id}"><span class="grow rt one">${esc(r.title)}</span>${drow(r.steps.length, routineDone(r), { gap: 9, r: 2.6, k: 'trr' + r.id })}<span class="lb fg" style="width:30px;text-align:right">${routineDone(r)}/${r.steps.length}</span></button>`).join('')}</div>
    <div class="sl">Habits<b>${loose.filter(habitKept).length}/${loose.length}</b></div>
    <div class="cd tight rows">${loose.map(h => habitRowMini(h)).join('')}</div>
    <div class="sl">Goals<b class="${goals.some(g => g.status === 'push') ? 'red' : ''}">${goals.filter(g => g.status === 'push').length ? goals.filter(g => g.status === 'push').length + ' behind' : 'On pace'}</b></div>
    <div class="cd tight rows">${goals.map(g => goalRowMini(g)).join('')}</div>`;
  },
  after(el, a, fresh) { if (fresh && a.at === 'day') setTimeout(() => $('#today-day', el).scrollIntoView({ block: 'center', behavior: 'smooth' }), 450); S.ui.dayDir = 0; }
};
A.todayList = (el, x) => { S.ui.todayList = x; refresh(); };
/* The alert's own action, the same four Today offers: put the task on today, add the task it names, or open the page. */
A.exAct = (el, id) => {
  const x = Object.values(MC.exceptions).flat().find(e => e.id === id); if (!x) return;
  if (x.kind === 'do-today' && x.taskId) { B.store().moveTaskList(x.taskId, 'today'); toast('On today'); return; }
  if (x.kind === 'add-task' && x.task) { B.store().addTask({ title: x.task.title, source: 'mc', estimateMin: x.task.estimateMin, estimated: true, space: 'personal', list: 'today', category: 'admin', plannedOn: isoOff(0) }); toast('On today'); return; }
  if (x.kind === 'open-goals') { S.ui.hSeg = 'goals'; tab('habits'); return; }
  S.ui.planSeg = 'day'; S.ui.planDay = 0; tab('plan');
};
A.openRunner = (el, id) => open('runner', { id });
function habitRowMini(h) {
  const kept = habitKept(h);
  if (h.kind === 'measured') return `<div class="row"><span class="grow rt one">${esc(h.name)}</span>${h.auto ? `<span class="lb">Auto</span>` : `<button class="key xs t" data-a="logAmount" data-x="${h.id}:${(h.presets || [1])[0]}">+${(h.presets || [1])[0]}</button>`}<span class="lb ${kept ? 'fg' : ''}" style="width:56px;text-align:right">${h.per === 'week' ? h.current : h.today}/${h.target}</span></div>`;
  return `<div class="sw" data-sw="habit" data-id="${h.id}"><div class="sw-l">${ico('check')} Kept</div><div class="sw-fg"><div class="row">${ck(kept, `data-a="habitTick" data-x="${h.id}" aria-label="Tick ${esc(h.name)}"`)}<span class="grow rt one">${esc(h.name)}</span><span class="lb">${h.streak}D</span></div></div></div>`;
}
function goalRowMini(g) {
  return `<div class="row" style="flex-wrap:wrap;gap:6px 12px"><span class="grow rt one">${esc(g.name)}</span><span class="lb ${g.status === 'push' ? 'red' : 'fg'}">${Math.round(goalPct(g) * 100)}%</span><div style="width:100%;display:flex;align-items:center;gap:10px">${drow(20, Math.round(goalPct(g) * 20), { gap: 8, r: 2.3, red: g.status === 'push', k: 'tg' + g.id })}<span class="lb">${g.current} of ${g.target} ${g.unit}</span></div></div>`;
}

/* ---------------- PLAN ---------------- */
const ctxChip = () => { const sp = viewSpace(), pf = S.ui.planProj; return `<button class="ctxchip" data-a="ctxPick" aria-label="Space and project"><span class="sd"></span><span class="ct"><b>${esc(sp === 'all' ? 'All' : spLabel(sp))}</b><i>${esc(!pf ? 'All projects' : pf === '__u' ? 'Unsorted' : projName(pf))}</i></span></button>`; };
V.plan = {
  title: 'Plan', lead: () => ctxChip(),
  action: (a, back) => back ? `<span class="vact">${ctxChip()}<button class="kb" data-a="open" data-x="search" aria-label="Search">${ico('search')}</button></span>` : `<button class="kb" data-a="open" data-x="search" aria-label="Search">${ico('search')}</button>`,
  render(a) {
    const sp = viewSpace(a), seg = S.ui.planSeg || 'day', day = S.ui.planDay || 0, pf = S.ui.planProj;
    const inP = t => !pf || (pf === '__u' ? !t.projectId : t.projectId === pf);
    const planned = plannedMin(sp, day), all = S.tasks.filter(t => t.list === 'today' && t.day === day && inSp(t, sp));
    const doneMin = all.filter(t => t.done).reduce((x, t) => x + t.est, 0) + all.filter(t => !t.done && t.subtasks).reduce((x, t) => x + t.subtasks.filter(s => s.done).reduce((y, s) => y + s.est, 0), 0);
    const pct = all.length ? Math.round(doneMin / Math.max(1, all.reduce((x, t) => x + t.est, 0)) * 100) : 0;
    const waiting = backlog(sp).reduce((x, t) => x + t.est, 0);
    const saved = MC.timeSaved.todaySavedMin;
    const ret = S.plan.returned.map(task).filter(t => t && t.list === 'backlog' && !t.done);
    const handoff = !S.plan.handoffShut && ret.length ? `<div class="cd r">${lb('Back from yesterday')}<div class="wt" style="margin:8px 0 12px">${ret.length} thing${ret.length > 1 ? 's' : ''} you did not finish ${ret.length > 1 ? 'are' : 'is'} back on the list.</div><div class="hstack" style="flex-wrap:wrap;gap:8px"><button class="key sm t" style="color:var(--red)" data-a="replanAll">Replan ${ret.length} for today</button><button class="key sm" style="background:rgba(255,255,255,.2);color:#fff" data-a="showReturned">Show me</button><button class="key sm" style="background:rgba(255,255,255,.2);color:#fff" data-a="openDayRec">See yesterday</button><span class="grow"></span><button class="kb sm" style="background:rgba(255,255,255,.2);color:#fff" data-a="handoffX" aria-label="Dismiss">${ico('close')}</button></div></div>` : '';
    const head = `<div class="cd k pm">${[[fmtMin(planned), 'Planned ' + dayShort(day).toLowerCase()], [pct + '%', 'Of it done'], [fmtMin(waiting), 'Waiting on the list'], [(saved >= 0 ? '+' : '-') + fmtMin(saved), saved >= 0 ? 'Saved vs estimate' : 'Over estimates']].map(([v, k], i) => `<div>${dm(v, 3.2, { k: 'pm' + i })}<div class="lb" style="margin-top:7px">${k}</div></div>`).join('')}</div>`;
    const ctrl = `<div class="hstack" style="margin:12px 0">
      <div class="seg grow">${[['day', dayShort(day)], ['todo', 'To-do']].map(([id, l]) => `<button class="${seg === id ? 'on' : ''}" data-a="planSeg" data-x="${id}">${l}${id === 'todo' ? ` <span class="n">${backlog(sp).length + S.backlogExtra}</span>` : ''}</button>`).join('')}</div>
      <button class="kb ${pf ? 'ink' : ''}" data-a="planFilter" aria-label="Project filter">${ico('folder')}</button><button class="kb" data-a="openDaily" aria-label="Yesterday">${ico('sunrise')}</button></div>`;
    let body = '';
    if (seg === 'day') {
      const open_ = S.tasks.filter(t => t.list === 'today' && t.day === day && !t.done && inSp(t, sp) && inP(t)).sort((x, y) => x.order - y.order);
      const uns = open_.filter(t => !t.slot);
      const routinesOnDay = day === 0 ? S.routines.filter(r => inSp(r, sp) && r.daypart && routineDone(r) > 0 && routineDone(r) < r.steps.length) : [];
      body = dayStrip('planDay', sp) + `<div data-dayswipe="planDay" ${dayAnim()}>` +
        (uns.length ? bucket({ id: 'uns', label: 'Unsorted', hours: 'no time yet', capMin: 0 }, uns, sp, day) : '') +
        MC.slots.map(sl => bucket(sl, open_.filter(t => t.slot === sl.id), sp, day, routinesOnDay.filter(r => r.daypart === sl.id))).join('') +
        (() => { const dn = S.tasks.filter(t => t.done && t.day === day && t.list === 'today' && inSp(t, sp) && inP(t)); return dn.length ? `<div class="sl">Done ${day === 0 ? 'today' : ''}<b>${dn.length}</b></div><div class="cd tight rows">${dn.map(t => taskRow(t)).join('')}</div>` : ''; })() +
        (!open_.length ? `<div class="empty">Nothing planned for ${dayShort(day).toLowerCase()}. Use a task's Plan menu to put it into a time of day.</div>` : '') + '</div>';
    } else {
      const sort = S.ui.todoSort || 'Newest';
      let rows = backlog(sp).filter(inP);
      const by = { Newest: (x, y) => x.ageDays - y.ageDays || x.order - y.order, Oldest: (x, y) => y.ageDays - x.ageDays, 'Most postponed': (x, y) => (y.carried || 0) - (x.carried || 0), Longest: (x, y) => y.est - x.est, Shortest: (x, y) => x.est - y.est };
      rows.sort(S.ui.todoManual ? (x, y) => x.order - y.order : by[sort]);
      body = `<div class="hstack"><input class="fld" id="newtask" aria-label="New task" placeholder="Add to ${esc(spLabel(wsp()))}, ${esc(projFor(wsp()) ? projFor(wsp()).name : 'Unsorted')}" data-enter="addTask"><button class="key red" data-a="addTask">Add</button></div>
        <div class="chips" style="margin:10px 0">${Object.keys(by).map(k => `<button class="chip ${sort === k && !S.ui.todoManual ? 'on' : ''}" data-a="todoSort" data-x="${k}">${k}</button>`).join('')}</div>
        <div class="cd tight rows scan">${rows.length ? rows.map(t => taskRow(t, { reorder: 'todo', space: sp === 'all' })).join('') : `<div class="empty">${pf ? 'Nothing in this project. Clear the filter to see everything.' : 'Nothing waiting. Add the first task above.'}</div>`}</div>
        <div class="lb" style="margin:4px 6px">${S.backlogExtra} more in other lists. Hold a row to reorder.</div>`;
    }
    const week = `<div class="sl">The week<button class="lb fg" data-a="weekToggle">${S.ui.weekOpen ? 'Hide' : 'Show'}</button></div>${S.ui.weekOpen ? `<div class="cd"><div class="wkg">${[0, 1, 2, 3, 4, 5, 6].map(o => { const m = plannedMin(sp, o), n = S.tasks.filter(t => t.list === 'today' && t.day === o && inSp(t, sp)).length; return `<button class="wkd" data-a="pickDay" data-x="planDay:${o}">${dring({ n: 16, on: m / 240 * 16, size: 40, r: 1.6, pad: 3, cls: 'wkr', red: m > 600 })}<div class="lb fg">${DAYS[(TI() + o) % 7]}</div><div class="lb">${m ? fmtMin(m) : '-'}</div></button>`; }).join('')}</div><div class="wt" style="margin-top:12px;font-size:12.5px">You have ${openToday(sp).length} tasks planned for today, taking ${fmtMinL(plannedMin(sp))} of your day.</div></div>` : ''}`;
    return head + handoff + ctrl + (pf ? `<div class="chips" style="margin-bottom:10px"><button class="chip on" data-a="planProj" data-x="">${ico('folder')} ${esc(pf === '__u' ? 'Unsorted' : projName(pf))} ${ico('close')}</button></div>` : '') + body + week +
      `<button class="key t wide" style="margin-top:14px" data-a="open" data-x="projects">${ico('projects')} Projects</button>`;
  },
  after(el, a, fresh) {
    S.ui.dayDir = 0;
    if (S.ui.flash) { const r = $(`.sw[data-id="${S.ui.flash}"]`, el); if (r) { S.ui.flash = null; setTimeout(() => { r.scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' }); r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); }, 60); } }
    if (S.ui.focusNew) { S.ui.focusNew = 0; setTimeout(() => { const f = $('#newtask', el); f && f.focus(); }, 300); }
  }
};
function bucket(sl, tasks, sp, day, rts = []) {
  const m = tasks.reduce((a, t) => a + t.est, 0), over = sl.capMin && m > sl.capMin;
  const shut = S.ui['shut' + sl.id];
  const nowSl = day === 0 && phaseOf().toLowerCase() === sl.id;
  return `<div class="bk"><button class="bkh ${nowSl ? 'now' : ''}" data-a="bkToggle" data-x="${sl.id}"><span class="lb fg">${shut ? '▸' : '▾'} ${sl.label}</span><span class="lb">${sl.hours}</span><span class="grow"></span><span class="lb ${over ? 'red' : 'fg'}">${sl.capMin ? (over ? `${fmtMin(m)} OF ${fmtMin(sl.capMin)}, ${fmtMin(m - sl.capMin)} OVER` : `${fmtMin(m)} OF ${fmtMin(sl.capMin)}`) : tasks.length + ' tasks'}</span></button>
  ${sl.capMin ? `<div style="margin:0 2px 8px">${drow(sl.capMin / 15, Math.min(sl.capMin / 15, Math.ceil(m / 15)), { gap: 7.4, r: 2.2, over: over ? Math.ceil((m - sl.capMin) / 15) : 0, k: 'bk' + sl.id + day + sp })}</div>` : ''}
  ${shut ? `<div class="lb" style="margin:0 4px 10px">${tasks.length} left</div>` : `<div class="cd tight rows">${tasks.map(t => taskRow(t, { reorder: 'slot-' + sl.id, play: true })).join('')}${rts.map(r => `<button class="row" style="width:100%" data-a="openRunner" data-x="${r.id}">${dring({ n: 12, on: routineDone(r) / r.steps.length * 12, size: 28, r: 1.5, pad: 2, cls: '' })}<span class="grow rt one">${esc(r.title)}</span><span class="lb">Routine ${routineDone(r)}/${r.steps.length}</span></button>`).join('')}${!tasks.length && !rts.length ? '<div class="empty" style="padding:14px">Nothing here yet.</div>' : ''}</div>`}</div>`;
}
A.bkToggle = (el, id) => { S.ui['shut' + id] = !S.ui['shut' + id]; refresh(); };
A.planSeg = (el, x) => { S.ui.planSeg = x; refresh(); };
A.todoSort = (el, x) => { S.ui.todoSort = x; S.ui.todoManual = false; refresh(); };
A.weekToggle = () => { S.ui.weekOpen = !S.ui.weekOpen; refresh(); };
A.handoffX = () => { S.plan.handoffShut = true; refresh(); };
A.replanAll = () => { B.store().moveTasksToToday(S.plan.returned.filter(id => task(id))); S.ui.planDay = 0; S.ui.planSeg = 'day'; toast('Replanned for today'); };
A.showReturned = () => { S.ui.planSeg = 'todo'; S.ui.flash = S.plan.returned[0]; refresh(); };
A.addTask = () => {
  const f = $('#newtask'), v = f.value.trim(); if (!v) return;
  const sp = wsp(), pf = S.ui.planProj;
  const proj = pf && pf !== '__u' ? MC.projects.find(p => p.id === pf) : null;
  B.store().addTask({ title: v, source: 'mc', estimateMin: 0, space: proj ? proj.space : sp, projectId: proj ? proj.id : undefined, list: 'backlog', category: 'quick' });
  f.value = ''; S.ui.todoManual = false; S.ui.todoSort = 'Newest'; S.ui.focusNew = 1;
};
A.planFilter = () => sheet('pf', {
  title: 'Projects', body: () => { const sp = curSpace(); const ps = MC.projects.filter(p => inSp(p, sp)); return `<div class="cd tight rows"><button class="row" style="width:100%" data-a="planProj" data-x=""><span class="grow rt one">All</span><span class="lb">${backlog(sp).length + openToday(sp).length}</span>${!S.ui.planProj ? ico('check') : ''}</button>${ps.map(p => `<button class="row" style="width:100%" data-a="planProj" data-x="${p.id}">${ico('folder')}<span class="grow rt one">${esc(p.name)}</span><span class="lb">${p.open}</span>${S.ui.planProj === p.id ? ico('check') : ''}</button>`).join('')}<button class="row" style="width:100%" data-a="planProj" data-x="__u"><span class="grow rt one">Unsorted</span>${S.ui.planProj === '__u' ? ico('check') : ''}</button></div><button class="key t wide" data-a="open" data-x="projects">Manage projects</button>`; }
});
A.planProj = (el, x) => { S.ui.planProj = x || null; closeSheet('pf'); refresh(); };

/* ---------------- PROJECTS ---------------- */
V.projects = {
  title: 'Projects', render() {
    return SPACES.slice(0, 2).map(s => `<div class="sl">${s.label}</div><div class="g2">${[{ id: '__u', name: 'Unsorted', open: S.tasks.filter(t => !t.projectId && t.space === s.id && !t.done).length }].concat(MC.projects.filter(p => p.space === s.id)).map((p, i) => {
      const waiting = S.tasks.filter(t => (p.id === '__u' ? !t.projectId : t.projectId === p.id) && t.space === s.id && !t.done).slice(0, 3);
      return `<button class="cd pfold ${i % 3 === 1 ? 'k' : ''}" data-a="openProject" data-x="${p.id}"><div class="pf-sheets">${waiting.map(t => `<div>${esc(t.title)}</div>`).join('')}</div>${icoBig('folder', 22)}<div class="rt one" style="margin-top:10px;font-weight:700;color:var(--fg)">${esc(p.name)}</div><div class="lb" style="margin-top:4px">${p.open} waiting</div></button>`;
    }).join('')}<button class="cd pfold" data-a="newProject" data-x="${s.id}" style="display:grid;place-items:center">${icoBig('plus', 26)}<div class="lb">New project</div></button></div>`).join('');
  }
};
A.openProject = (el, id) => { S.ui.planProj = id; S.ui.planSeg = 'todo'; back(); setTimeout(() => tab('plan'), 380); };
A.newProject = (el, sp) => sheet('np', { title: 'New project', focus: '#npn', body: () => `<input class="fld" id="npn" placeholder="e.g. a client name, a workstream" data-enter="npSave" data-x="${sp}">`, foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="npSave" data-x="${sp}">Create project</button>` });
A.npSave = (el, sp) => { const v = $('#npn').value.trim(); if (!v) return; B.store().addProject(v, sp); closeSheet('np'); toast('Project created'); };

/* ---------------- SEARCH ---------------- */
V.search = {
  title: 'Search', live: false, render() {
    return `<input class="fld" id="sq" placeholder="Search every task, every space" autocomplete="off"><div id="sres" style="margin-top:12px"></div>`;
  },
  after(el, a, fresh) {
    const f = $('#sq', el), out = $('#sres', el);
    const run = () => {
      const q = f.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const hits = q ? S.tasks.filter(t => !t.done && t.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)).slice(0, 8) : S.tasks.filter(t => !t.done && t.alert || t.ageDays > 30).slice(0, 4);
      out.innerHTML = (q ? '' : `<div class="sl">Worth a look</div>`) + (hits.length ? `<div class="cd tight rows">${hits.map(t => `<button class="row" style="width:100%" data-a="jumpTask" data-x="${t.id}"><span class="cat" style="background:${t.space === 'work' ? 'var(--ink)' : 'var(--off)'}"></span><div class="grow"><div class="rt one">${esc(t.title)}</div><div class="rs"><span>${t.space === 'work' ? 'Big Time' : 'Personal'}</span><span>${esc(projName(t.projectId))}</span><span>${t.list === 'today' ? "today's plan" : 'to-do list'}</span></div></div>${ico('right')}</button>`).join('')}</div>` : `<div class="empty">Nothing matches "${esc(f.value)}". Try one word from the title.</div>`);
    };
    f.oninput = run; run(); if (fresh) setTimeout(() => f.focus(), 450);
  }
};
/* One way to a task: its space, its day (or the to-do list), its part of the day open, its project, the row flashed. */
function jumpTo(id, tries = 0) {
  const t = task(id);
  if (!t) { if (tries < 3) afterUpdate(() => jumpTo(id, tries + 1)); return; }
  if (curSpace() !== 'all' && curSpace() !== t.space) setPage(PAGES.indexOf(t.space), false);
  if (t.list === 'today' && !t.done && (t.day || 0) <= 6) { S.ui.planSeg = 'day'; S.ui.planDay = t.day || 0; S.ui['shut' + (t.slot || 'uns')] = false; }
  else if (t.done) { S.ui.planSeg = 'day'; S.ui.planDay = 0; }
  else { S.ui.planSeg = 'todo'; S.ui.todoManual = false; S.ui.todoSort = 'Newest'; }
  S.ui.planProj = t.projectId || '__u'; S.ui.flash = id;
  if (top_().id === 'plan' && STACK.length === 1) { const e = top_(); renderTop(e); renderBody(e, false); } else tab('plan');
}
A.jumpTask = (el, id) => jumpTo(id);
A.seeTask = (el, id) => { A.toastX(); jumpTo(id); };
A.seeNote = (el, id) => { A.toastX(); const go = () => S.notes.some(n => n.id === id) ? open('note', { id }) : afterUpdate(go); go(); };

/* ---------------- DAY RECORD: the real Day page, read only ---------------- */
A.openDayRec = () => B.openClassic('day', isoOff(-1));

/* ---- 52-habits.js ---- */
/* =====================================================================
   Habits room: Habits / Goals / Quitting, routine runner, give-up screen
   ===================================================================== */
/* 12-week HabitKit grid: columns are weeks, rows Mon..Sun, from the real habit log; today sits at 77 + weekday */
const hkToday = () => 77 + TI();
function hkVal(h, i) { if (i === hkToday()) return h.doneToday ? 1 : 0; return MC.habitGrid(h.id)[i]; }
function hkGrid(id, done, big) {
  const h = typeof id === 'object' ? id : habit(id) || { id, doneToday: done };
  const g = big ? 13 : 9, r = big ? 4.6 : 3, HT = hkToday(); let s = '';
  for (let i = 0; i < 84; i++) { const v = hkVal(h, i), c = Math.floor(i / 7), w = i % 7; const cls = v == null ? '' : v >= 1 ? 'on' : v > 0 ? 'half' : 'miss'; s += `<circle class="dt ${cls}${i === HT ? ' hk-now' : ''}" cx="${c * g + g / 2}" cy="${w * g + g / 2}" r="${v == null ? r * .35 : r}"/>`; }
  return `<svg class="dts hk${big ? ' big' : ''}" viewBox="0 0 ${12 * g} ${7 * g}" width="100%" aria-hidden="true">${s}</svg>`;
}
V.habits = {
  title: () => ({ habits: 'Habits', goals: 'Goals', quit: 'Quitting' }[S.ui.hSeg || 'habits']),
  action: () => `<button class="kb" data-a="addHabitMenu" aria-label="Add">${ico('plus')}</button>`,
  render(a, e) {
    if (a.seg && !e.segSet) { S.ui.hSeg = a.seg; e.segSet = 1; }
    const seg = S.ui.hSeg || 'habits';
    const top = `<div class="seg" style="margin-bottom:12px">${[['habits', 'Habits'], ['goals', 'Goals'], ['quit', 'Quitting']].map(([id, l]) => `<button class="${seg === id ? 'on' : ''}" data-a="hSeg" data-x="${id}">${l}</button>`).join('')}</div>`;
    return top + (seg === 'habits' ? habitsBody() : seg === 'goals' ? goalsBody() : quitBody());
  }
};
A.hSeg = (el, x) => { S.ui.hSeg = x; const e = top_(); renderTop(e); renderBody(e, true); };
function habitsBody() {
  const daily = S.routines.filter(r => ['daily', 'prework'].includes(r.cadence) && !r.repeatable);
  const rdone = daily.filter(r => routineDone(r) >= routineReq(r)).length;
  const manual = S.habits.filter(h => h.kind === 'build' && !h.routine && h.due);
  const auto = S.habits.filter(h => h.kind === 'measured');
  const once = S.routines.filter(r => ['weekly', 'monthly'].includes(r.cadence));
  const nos = S.routines.filter(r => r.repeatable);
  const rcard = r => { const d = routineDone(r), n = r.steps.length, fin = d >= routineReq(r); return `<div class="cd rtc" role="button" tabindex="0" data-a="routineSheet" data-x="${r.id}"><div class="hstack">${dring({ n: 20, on: d / n * 20, size: 46, r: 1.9, pad: 3, cls: '', k: 'hr' + r.id })}<div class="grow"><div class="rt one" style="font-weight:700">${esc(r.title)}</div><div class="rs">${r.cadence === 'prework' ? 'Before work' : r.cadence}<span>${d} of ${n}</span>${habit(r.habitId) ? `<span>${(habit(r.habitId) || {}).streak || 0}D streak</span>` : ''}</div></div><button class="key ${fin ? 't' : 'red'} sm" data-a="openRunner" data-x="${r.id}">${fin ? 'Again' : 'Start'}</button></div></div>`; };
  return `<div class="g3" style="margin-bottom:6px">${[[rdone + '/' + daily.length, 'Routines run'], [manual.filter(habitKept).length + '/' + manual.length, 'Manual ticks'], [S.quitting.filter(q => q.today !== 'slip').length + '/' + S.quitting.length, 'Quits clean']].map(([v, l], i) => `<div class="cd ${i === 0 ? 'k' : ''}" style="padding:14px">${dm(v, 3, { k: 'hs' + i })}<div class="lb" style="margin-top:8px">${l}</div></div>`).join('')}</div>
  <div class="sl">Routines<b>${rdone} of ${daily.length} done today</b></div>${daily.map(rcard).join('')}
  <div class="sl">Manual habits<b>${manual.filter(habitKept).length}/${manual.length}</b></div>
  ${manual.map(h => `<div class="sw hcard" data-sw="habit" data-id="${h.id}"><div class="sw-l">${ico('check')} Kept</div><div class="sw-fg"><div style="padding:14px 16px"><div class="hstack"><div class="grow" data-a="habitSheet" data-x="${h.id}"><div class="rt one" style="font-weight:700">${esc(h.name)}</div><div class="rs"><span>${h.streak} day streak</span><span>${h.daypart || 'anytime'}</span></div></div>${ck(h.doneToday, `data-a="habitTick" data-x="${h.id}" aria-label="Tick ${esc(h.name)}"`)}</div><div style="margin-top:12px" data-a="habitSheet" data-x="${h.id}">${hkGrid(h)}</div><div class="lb" style="margin-top:6px">12 weeks</div></div></div></div>`).join('')}
  <div class="sl">Amounts and automatic</div>
  ${auto.map(h => { const v = h.per === 'week' ? h.current : h.today, p = clamp(v / h.target, 0, 1); return `<div class="cd"><div class="hstack"><div style="position:relative;width:64px;height:64px;flex:none">${dring({ n: 28, on: p * 28, size: 64, r: 1.9, pad: 3, red: !h.auto && !h.hevy && p < 1, k: 'ha' + h.id })}<div class="wcenter">${dm(v, 2.2)}</div></div><div class="grow" data-a="habitSheet" data-x="${h.id}"><div class="rt one" style="font-weight:700">${esc(h.name)}</div><div class="rs"><span>${v} of ${h.target}${h.measure === 'minutes' ? ' min' : ''} ${h.per === 'week' ? 'this week' : 'today'}</span></div><div class="rs">${h.auto ? 'Fills itself from your focus blocks' : h.hevy ? esc(S.gym.lastSync) : h.streak + ' day streak'}</div></div></div>
    ${h.hevy ? `<button class="key t sm" style="margin-top:12px" data-a="hevySync" ${S.hevyBusy ? 'disabled' : ''}>${S.hevyBusy ? `<span class="chase8">${spinSVG()}</span> Syncing` : ico('sync') + ' Sync Hevy'}</button>` : h.auto ? '' : `<div class="hstack" style="margin-top:12px;gap:6px">${(h.presets || [1]).map(n => `<button class="key t sm" data-a="logAmount" data-x="${h.id}:${n}">+${n}</button>`).join('')}${v > 0 && h.measure === 'times' ? `<button class="key t sm" data-a="logAmount" data-x="${h.id}:-1">Take one back</button>` : ''}</div>`}</div>`; }).join('')}
  <div class="sl">Once in a while</div>${once.map(rcard).join('')}
  <div class="sl">No set day</div>${nos.map(rcard).join('')}`;
}
A.hevySync = () => hevySync();
A.addHabitMenu = () => sheet('addh', {
  title: 'Add', body: () => `<div class="seg" style="margin-bottom:12px">${['Keep', 'Quit', 'Amount'].map((k, i) => `<button class="${(S.ui.hk || 0) === i ? 'on' : ''}" data-a="hkPick" data-x="${i}">${k}</button>`).join('')}</div><input class="fld" id="hname" placeholder="${['e.g. Read 10 pages', 'e.g. Scrolling in bed', 'e.g. Push-ups'][S.ui.hk || 0]}" data-enter="habitAdd"><div class="sl">When in the day</div><div class="chips">${['Morning', 'Noon', 'Afternoon', 'Evening', 'Anytime'].map((s, i) => `<button class="chip ${i === 0 ? 'on' : ''}">${s}</button>`).join('')}</div><div class="sl">How often</div><div class="chips">${['Every day', 'Mon to Fri', 'A few times a week', 'Once a week'].map((s, i) => `<button class="chip ${i === 0 ? 'on' : ''}">${s}</button>`).join('')}</div>`,
  foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="habitAdd">Add habit</button>`, live: true
});
A.hkPick = (el, i) => { S.ui.hk = +i; repaintSheets(); };
A.habitAdd = () => {
  const v = $('#hname').value.trim(); if (!v) return; const k = S.ui.hk || 0;
  const st = B.store();
  if (k === 1) st.addHabit({ name: v, kind: 'break', frequency: 'daily', quitSince: isoOff(0) });
  else if (k === 2) st.addHabit({ name: v, kind: 'measured', measure: 'times', per: 'day', targetCount: 10, frequency: 'daily' });
  else st.addHabit({ name: v, kind: 'build', frequency: 'daily', daypart: 'morning', startedOn: isoOff(0) });
  closeSheet('addh'); toast(k === 1 ? 'Added to Quitting' : 'Habit added');
};

function goalsBody() {
  const bands = [['weekly', 'This week', '26 Oct to 1 Nov'], ['monthly', 'This month', 'October'], ['quarter', 'This quarter', 'Oct to Dec'], ['half', 'Half year', 'Jul to Dec']];
  return bands.map(([tf, name, range]) => {
    const gs = S.goals.filter(g => g.timeframe === tf);
    return `<div class="sl">${name}<b>${gs.filter(g => g.status === 'reached' || g.current >= g.target).length}/${gs.length} reached</b></div>${gs.map(g => {
      const p = goalPct(g), st = g.current >= g.target ? 'reached' : g.status, op = S.ui['gm' + g.id];
      return `<div class="cd"><div class="hstack" style="align-items:flex-start"><div class="grow"><div class="rt" style="font-weight:700">${esc(g.name)}</div><div class="rs"><span>${g.current} of ${g.target} ${g.unit}</span>${g.habitLinked ? '<span>Automatic</span>' : ''}<span class="${st === 'push' ? 'red' : ''}">${{ on: 'On pace', push: 'Needs a push', reached: 'Reached', planned: 'Planned' }[st]}</span></div></div>${dm(Math.round(p * 100) + '%', 2.6, { k: 'gp' + g.id, cls: st === 'push' ? 'rd' : '' })}</div>
      <div style="margin:12px 0 2px">${drow(24, Math.round(p * 24), { gap: 13.2, r: 3.4, red: st === 'push', k: 'gb' + g.id, fill: true })}</div>
      <div class="hstack" style="margin-top:10px;gap:6px">${!g.habitLinked && !g.milestones ? `<button class="key t sm" data-a="goalBump" data-x="${g.id}:-1" ${g.current <= 0 ? 'disabled' : ''}>-1</button><button class="key sm" data-a="goalBump" data-x="${g.id}:1" ${g.current >= g.target ? 'disabled' : ''}>+1</button>` : ''}${g.milestones ? `<button class="key t sm" data-a="gmToggle" data-x="${g.id}">${op ? 'Hide' : 'Milestones'} ${g.milestones.filter(m => m.done).length}/${g.milestones.length}</button>` : ''}</div>
      ${op ? `<div class="rows" style="margin-top:8px">${g.milestones.map((m, i) => `<div class="row" style="min-height:44px">${ck(m.done, `data-a="msTick" data-x="${g.id}:${i}"`)}<span class="grow rt one ${m.done ? 'done' : ''}">${esc(m.title)}</span></div>`).join('')}</div>` : ''}</div>`;
    }).join('') || `<div class="empty">No goals were set for this one.</div>`}`;
  }).join('');
}
A.goalBump = (el, x) => { const [id, n] = x.split(':'); B.store().bumpGoal(id, +n); };
A.gmToggle = (el, id) => { S.ui['gm' + id] = !S.ui['gm' + id]; refresh(); };
A.msTick = (el, x) => { const [id, i] = x.split(':'), g = S.goals.find(g => g.id === id); B.store().toggleGoalMilestone(id, g.milestones[+i].id); };

function quitHeat(q) {
  let s = ''; for (let i = 0; i < 126; i++) { const c = Math.floor(i / 7), r = i % 7, ago = 125 - i - (6 - TI()); const before = ago > q.sinceAgo; const slip = q.slipAgo.includes(ago); const fut = ago < 0; s += `<circle class="dt ${fut ? '' : slip ? 'on rd' : before ? '' : 'on'}" cx="${c * 7 + 3.5}" cy="${r * 7 + 3.5}" r="${fut || before ? 1 : 2.4}"/>`; }
  return `<svg class="dts" viewBox="0 0 126 49" width="100%" aria-hidden="true">${s}</svg>`;
}
function quitBody() {
  const tot = S.quitting.reduce((a, q) => a + q.daysClean, 0);
  return `<div class="cd k">${lbRow(S.quitting.length + ' things you are not doing', 'Clean days')}<div style="margin-top:12px">${dm(tot, 5, { k: 'qtot', count: true })}</div></div>` +
    [...S.quitting].sort((a, b) => b.daysClean - a.daysClean).map(q => {
      const ms = [7, 30, 90, 100, 180, 365].find(m => m > q.daysClean) || 365, hold = q.daysClean < 14 ? 'Just started' : q.slips === 0 ? 'Solid' : q.slips < 3 ? 'Steady' : 'Shaky';
      return `<div class="cd"><div class="hstack" style="align-items:flex-start"><div class="grow"><div class="rt" style="font-weight:700">${esc(q.name)}</div><div class="rs"><span>Since ${q.since.slice(8)} ${MONTHS[+q.since.slice(5, 7) - 1]}</span><span>${hold}</span><span>Best ${q.best}D</span></div></div><div style="text-align:right">${dm(q.today === 'slip' ? 0 : q.daysClean, 4, { k: 'qd' + q.id, cls: q.today === 'slip' ? 'rd' : '' })}<div class="lb" style="margin-top:6px">Days clean</div></div></div>
      <div style="margin:14px 0 6px">${drow(ms > 60 ? 30 : ms, Math.round(q.daysClean / ms * (ms > 60 ? 30 : ms)), { gap: 10.6, r: 2.8, k: 'qm' + q.id, fill: true })}</div><div class="lb">${ms - q.daysClean} to ${ms} days</div>
      <div style="margin:14px 0">${quitHeat(q)}</div>
      <div class="hstack" style="gap:8px">${q.today === 'slip' ? `<span class="key sm t" style="color:var(--red)">Slipped today</span>` : `<button class="key sm t" data-a="quitClean" data-x="${q.id}">${q.today === 'clean' ? ico('check') + ' Clean today' : 'Clean'}</button><button class="key sm red" data-a="quitSlip" data-x="${q.id}">I slipped</button>`}<span class="grow"></span><button class="key sm t" data-a="giveUp" data-x="${q.id}">I wanna give up</button></div></div>`;
    }).join('');
}
A.quitClean = () => toast('Clean days count themselves. Log a slip only if one happens.');
A.quitSlip = (el, id) => { const q = S.quitting.find(q => q.id === id); B.store().logSlip(id); undoable('Slip logged: ' + q.name, () => B.store().undoDelete()); };
A.giveUp = (el, id) => open('giveup', { id });

/* ---------------- routine runner: one step at a time ---------------- */
V.runner = {
  title: 'Routine', noSwipeClose: true,
  render(a, e) {
    const r = routine(a.id), n = r.steps.length;
    if (e.i == null) { e.i = a.again ? 0 : r.steps.findIndex(s => !s.done); if (e.i < 0) e.i = 0; }
    if (e.finished) return `<div class="runfin">${burst()}<div style="text-align:center">${dm('DONE', 9, { k: 'rf' })}<div class="wt" style="margin:22px 0 8px">${esc(r.title)} finished. ${routineDone(r)} of ${n} steps.</div><div class="lb">${habit(r.habitId) ? 'Streak ' + habit(r.habitId).streak + ' days' : ''}</div></div><button class="key red wide" style="margin-top:30px;height:56px" data-a="back">Close</button></div>`;
    const s = r.steps[e.i], timer = s.kind === 'timer';
    const left = timer ? (e.tLeft ?? s.seconds) : 0;
    return `<div class="runbar">${r.steps.map((x, i) => `<i class="${x.done ? 'on' : ''} ${i === e.i ? 'cur' : ''}"></i>`).join('')}</div>
    <div class="lb" style="margin-top:12px">${esc(r.title)}</div><div class="runstep vin" key="${e.i}">
      <div class="hstack" style="align-items:flex-end;margin:18px 0 6px">${dm(pad(e.i + 1), 9, { k: 'rs' + r.id })}<span class="lb" style="padding-bottom:4px">of ${n}</span>${s.optional ? '<span class="chip" style="margin-left:auto">Optional</span>' : ''}</div>
      <div class="d1" style="font-size:31px;margin:14px 0 12px;line-height:1.05">${esc(s.title)}</div>
      ${s.note ? `<div class="wt" style="font-size:15px;color:var(--dim)">${esc(s.note)}</div>` : ''}
      ${s.done ? `<div class="lb" style="margin-top:10px">Already kept today. Next takes you past it.</div>` : ''}
      ${s.example ? `<div class="cd k" style="margin-top:16px">${lb('Say it three times')}<div class="wt" style="font-size:18px;margin-top:8px">${esc(s.example)}</div></div>` : ''}
      ${s.alts ? `<div class="g2" style="margin-top:16px">${s.alts.map((al, i) => `<button class="cd alt ${e.alt === i ? 'k' : ''}" data-a="runAlt" data-x="${i}" style="text-align:left"><div class="rt" style="font-weight:700;color:var(--fg)">${al.title}</div><div class="wt" style="font-size:12px;color:var(--fd);margin-top:6px">${esc(al.note)}</div></button>`).join('')}</div>` : ''}
      ${s.gate ? `<div class="cd" style="margin-top:16px">${lb(s.gate)}<div class="hstack" style="margin-top:10px"><input class="fld" id="wpm" inputmode="numeric" placeholder="Speed you hit" data-enter="runGate"><button class="key" data-a="runGate">Log it</button></div>${e.gate ? `<div class="wt" style="margin-top:10px;${e.gate >= s.gateTarget ? '' : 'color:var(--red)'}">${e.gate} WPM today. ${e.gate >= s.gateTarget ? 'Passed.' : (s.gateTarget - e.gate) + ' short. Go again.'}</div>` : ''}</div>` : ''}
      ${s.link ? `<button class="key t sm" style="margin-top:14px" data-a="runLink">${ico('out')} ${esc(s.link)}</button>` : ''}
      ${!timer && !s.alts && !s.gate && !s.example ? `<div class="cd" style="margin-top:22px">${lb('Coming up')}<div class="rows" style="margin-top:4px">${r.steps.slice(e.i + 1, e.i + 4).map((x, k) => `<div class="row" style="min-height:42px">${dm(pad(e.i + 2 + k), 2.2, { cls: 'dim' })}<span class="grow rt one" style="color:var(--dim)">${esc(x.title)}</span></div>`).join('') || '<div class="empty" style="padding:10px">Last step.</div>'}</div></div>` : ''}
      ${timer ? `<div class="runtimer" style="margin-top:22px"><div class="rtw">${dring({ n: 60, on: left / s.seconds * 60, size: 220, r: 3, pad: 8, red: !!e.tRun, k: 'rt' + r.id + e.i }).replace('<svg', '<svg data-drop="1"')}<div class="wcenter" data-live="rtimer">${dm(pad(Math.floor(left / 60)) + ':' + pad(left % 60), 5.4, { k: 'rtt' })}</div></div><div class="hstack" style="justify-content:center;margin-top:16px">${e.tRun ? `<button class="key t" data-a="runTimer">${ico('pause')} Pause</button>` : `<button class="key red" data-a="runTimer">${ico('play')} ${left < s.seconds ? 'Resume' : 'Start timer'}</button>`}</div></div>` : ''}
    </div>
    <div class="runfoot"><button class="key t" data-a="runBack" ${e.i === 0 ? 'disabled' : ''}>${ico('back')}</button><button class="key t" data-a="runSkip">Skip</button><button class="key grow" style="height:52px" data-a="runNext" ${s.gate && !(e.gate >= s.gateTarget) && !s.done ? 'disabled' : ''} ${s.alts && e.alt == null && !s.done ? 'disabled' : ''}>${e.i === n - 1 ? 'Finish' : 'Done, next'}</button></div>
    <div class="lb" style="text-align:center;margin-top:12px">${routineDone(r)} of ${n} kept today</div>`;
  }
};
function burst() { let s = ''; for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2, d = 70 + (i % 3) * 30; s += `<i style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:${(i % 6) * 40}ms"></i>`; } return `<div class="burst">${s}</div>`; }
const runE = () => top_();
A.runNext = () => { const e = runE(), r = routine(e.args.id), st = r.steps[e.i]; if (!st.done) B.store().markHabitDay(st.id, TI(), true); stopRunTimer(e); if (e.i >= r.steps.length - 1) e.finished = true; else { e.i++; e.alt = null; e.gate = null; e.tLeft = null; } refresh(); };
A.runSkip = () => { const e = runE(), r = routine(e.args.id); stopRunTimer(e); if (e.i >= r.steps.length - 1) e.finished = true; else { e.i++; e.alt = null; e.tLeft = null; } refresh(); };
A.runBack = () => { const e = runE(); stopRunTimer(e); e.i = Math.max(0, e.i - 1); e.tLeft = null; refresh(); };
A.runAlt = (el, i) => { const e = runE(), st = routine(e.args.id).steps[e.i]; if (e.alt !== +i) B.store().pickHabitAlt(st.id, st.alts[+i].id); e.alt = +i; refresh(); };
A.runGate = () => { const e = runE(), v = +$('#wpm').value, st = routine(e.args.id).steps[e.i]; if (!v) return; B.store().logHabitNumber(st.id, v); e.gate = v; refresh(); };
A.runLink = () => { const e = runE(), st = routine(e.args.id).steps[e.i]; if (st.href) window.open(st.href, '_blank', 'noopener'); };
A.runTimer = () => {
  const e = runE(), r = routine(e.args.id), s = r.steps[e.i];
  if (e.tRun) { stopRunTimer(e); refresh(); return; }
  if (e.tLeft == null) e.tLeft = s.seconds;
  e.tRun = true; let last = performance.now(), acc = 0;
  e.tIv = setInterval(() => {
    const now = performance.now(); acc += now - last; last = now;
    while (acc >= 1000 && e.tLeft > 0) { acc -= 1000; e.tLeft--; }
    const el = e.el && $('[data-live="rtimer"] .dm', e.el); if (el) dmLive(el, pad(Math.floor(e.tLeft / 60)) + ':' + pad(e.tLeft % 60));
    const svg = e.el && $('.rtw svg', e.el); if (svg) { const on = Math.round(e.tLeft / s.seconds * 60); $$('.dt', svg).forEach((c, i) => { c.classList.toggle('rd', i < on); c.classList.toggle('on', i < on); }); FC.set(svg.dataset.k, on); }
    if (e.tLeft <= 0) { stopRunTimer(e); toast('Time. ' + s.title + ' done.'); A.runNext(); }
  }, 250);
  refresh();
};
function stopRunTimer(e) { clearInterval(e.tIv); e.tRun = false; }

/* ---------------- give-up: two lives ---------------- */
V.giveup = {
  title: 'Two lives', dark: true, render(a) {
    const q = S.quitting.find(q => q.id === a.id) || S.quitting[0];
    const hz = S.ui.gh || 0, H = ['Tonight', 'This week', 'This month', '3 months', 'A year'];
    if (!q) return `<div class="empty">Nothing on the Quitting list yet.</div><button class="key red wide" style="height:58px;margin-top:6px" data-a="back">Ok. Let's go.</button>`;
    const keep = [`You go to bed with ${q.daysClean + 1} days clean.`, 'Seven mornings that start clear.', 'A month of this, and it is not a fight any more.', 'The chain is past 100. People notice before you say anything.', 'A year from now this is just who you are.'][hz];
    const stop = [`${q.name}, and tomorrow starts from zero.`, 'The same week as the last one, with one more thing to feel bad about.', 'The list is longer. The calls still not made.', 'Same evenings, same list.', 'A year from now, the same list.'][hz];
    return `<div class="cd k" style="text-align:center">${lb('Clean so far')}<div style="margin:14px 0 6px">${dm(q.daysClean, 8, { k: 'gu', count: true })}</div>${lb('days. Before you do, this is where you are.')}</div>
    <div class="chips" style="margin:6px 0 12px">${H.map((h, i) => `<button class="chip ${i === hz ? 'on' : ''}" data-a="ghz" data-x="${i}">${h}</button>`).join('')}</div>
    <div class="cd" style="background:#F2F2F2;color:#0A0A0A">${lb('If you keep going')}<div class="wt" style="font-size:17px;margin-top:10px;color:#0A0A0A">${esc(keep)}</div></div>
    <div class="cd r">${lb('If you stop now')}<div class="wt" style="font-size:17px;margin-top:10px">${esc(stop)}</div></div>
    <div class="g2"><div class="cd">${dm(q.best, 3.4)}${lb('Best run, days')}</div><div class="cd">${dm('DAY ' + S.momentum.chain, 3.4)}${lb('The chain')}</div></div>
    <button class="key red wide" style="height:58px;margin-top:6px" data-a="back">Ok. Let's go.</button>`;
  }
};
A.ghz = (el, i) => { S.ui.gh = +i; refresh(); };


/* ---------------- habit sheet: rises from the bottom like the real MC habit sheet ---------------- */
const hBest = h => h.best || h.streak || 0;
const L7 = () => { const t = hkToday(); return [t - 6, t - 5, t - 4, t - 3, t - 2, t - 1, t]; };
const gridMonths = () => [0, 6, 11].map(c => MONTHS[dayDate(c * 7 - hkToday()).getMonth()]);
function openHabitSheet(id) {
  const h = habit(id); if (!h) return;
  S.ui.hsEdit = { daypart: h.daypart || 'anytime', freq: h.frequency || 'daily' };
  sheet('habit', {
    cls: 'hsheet', live: true, title: () => habit(id) ? habit(id).name : '', body: () => {
      const h = habit(id); if (!h) return '';
      const HT = hkToday(), meas = h.kind === 'measured', v = meas ? (h.per === 'week' ? h.current : h.today || 0) : 0;
      const kept = L7().filter(i => hkVal(h, i) >= 1).length, r = h.routine && routine(h.routine);
      const days = L7().map((i, k) => { const d = dayDate(k - 6), val = hkVal(h, i); return `<button class="hday ${val >= 1 ? 'on' : ''} ${i === HT ? 'today' : ''}" data-a="hsDay" data-x="${id}:${i}" aria-pressed="${val >= 1}" ${h.auto || meas ? 'disabled' : ''}><span>${DAYS[(d.getDay() + 6) % 7]}</span><b>${d.getDate()}</b><i></i></button>`; }).join('');
      const e = S.ui.hsEdit;
      return `<div class="g3 hstat"><div class="cd k">${dm(h.streak, 3.6, { k: 'hss' + id })}<div class="lb">Day streak</div></div><div class="cd">${dm(hBest(h), 3.6)}<div class="lb">Best run</div></div><div class="cd">${dm(kept + ' OF 7', 2.6, { k: 'hsk' + id })}<div class="lb">Last 7 days</div></div></div>
      <div class="cd">${lbRow('12 weeks', h.auto ? 'Fills itself' : 'Kept dots are solid')}<div style="margin-top:12px">${hkGrid(h, 0, true)}</div><div class="hkm">${gridMonths().map(m => `<span>${m}</span>`).join('')}</div></div>
      <div class="sl">This week<b>${h.auto ? 'From your focus blocks' : meas ? 'Kept by the amount' : 'Tap a day to fix it'}</b></div><div class="hweek">${days}</div>
      ${meas ? `<div class="sl">Amount<b>${v} of ${h.target}${h.unit ? ' ' + h.unit : ''} ${h.per === 'week' ? 'this week' : 'today'}</b></div><div class="cd hamt"><div class="hstack"><div style="position:relative;width:96px;height:96px;flex:none">${dring({ n: 32, on: clamp(v / h.target, 0, 1) * 32, size: 96, r: 2.4, pad: 5, red: !h.auto && v < h.target, cls: '', k: 'hsa' + id })}<div class="wcenter">${dm(v, 3, { k: 'hsv' + id })}</div></div><div class="grow">${h.auto ? `<div class="wt" style="color:var(--dim)">Counts your focus minutes. Start a block to move it.</div><button class="key sm red" style="margin-top:10px" data-a="hsFocus" data-x="${id}">${ico('play')} Start a block</button>` : `<div class="hstack" style="flex-wrap:wrap;gap:6px">${(h.presets || [1]).map(n => `<button class="key sm" data-a="logAmount" data-x="${id}:${n}">+${n}</button>`).join('')}${v > 0 && h.measure === 'times' ? `<button class="key sm t" data-a="logAmount" data-x="${id}:-1">-1</button>` : ''}</div>${h.measure === 'amount' ? `<div class="hstack" style="margin-top:8px"><input class="fld" id="hsamt" inputmode="numeric" placeholder="Custom amount" data-enter="hsCustom" data-x="${id}" style="height:42px"><button class="key" data-a="hsCustom" data-x="${id}">Log</button></div>` : ''}`}</div></div></div>` : ''}
      ${r ? `<div class="sl">Routine</div><div class="cd"><div class="hstack">${dring({ n: 20, on: routineDone(r) / r.steps.length * 20, size: 46, r: 1.9, pad: 3, cls: '', k: 'hsr' + r.id })}<div class="grow"><div class="rt one" style="font-weight:700">${esc(r.title)}</div><div class="rs"><span>${routineDone(r)} of ${r.steps.length} steps today</span></div></div><button class="key red sm" data-a="hsRoutine" data-x="${r.id}">${routineDone(r) >= r.steps.length ? 'Again' : 'Start'}</button></div></div>` : ''}
      <div class="sl">Edit</div><div class="cd hedit">
        <input class="fld" id="hsname" value="${esc(h.name)}" aria-label="Name" ${r ? 'disabled' : ''}>${r ? `<div class="lb" style="margin-top:6px">Name and days follow the routine</div>` : ''}
        <div class="lb" style="margin:14px 0 8px">How often</div><div class="chips">${[['daily', 'Every day'], ['weekdays', 'Mon to Fri'], ['times-per-week', 'A few times a week'], ['weekly', 'Once a week']].map(([f, l]) => `<button class="chip ${e.freq === f ? 'on' : ''}" data-a="hsFreq" data-x="${f}" ${r ? 'disabled' : ''}>${l}</button>`).join('')}</div>
        ${meas && h.measure !== 'amount' ? `<div class="lb" style="margin:14px 0 8px">Target</div><input class="fld" id="hstgt" inputmode="numeric" value="${h.target}" aria-label="Target" style="width:120px">` : ''}
        <div class="lb" style="margin:14px 0 8px">When in the day</div><div class="chips">${['morning', 'noon', 'afternoon', 'evening', 'anytime'].map(d => `<button class="chip ${e.daypart === d ? 'on' : ''}" data-a="hsPart" data-x="${d}">${d}</button>`).join('')}</div>
        <button class="key wide" style="margin-top:16px" data-a="hsSave" data-x="${id}">Save changes</button>
      </div>
      <button class="key t wide" style="color:var(--red);margin-top:4px" data-a="hsArchive" data-x="${id}">${ico('trash')} Archive this habit</button>`;
    }
  });
}
A.habitSheet = (el, id) => openHabitSheet(id);
/* A past day is the store's dated toggle (markHabitOn); today is the ordinary tick. */
A.hsDay = (el, x) => {
  const [id, i] = x.split(':'), h = habit(id), k = +i, HT = hkToday();
  if (k === HT) { A.habitTick(null, id); return; }
  B.store().markHabitOn(id, isoOff(k - HT), !(hkVal(h, k) >= 1));
};
A.hsCustom = (el, id) => { const f = $('#hsamt'), n = +(f && f.value); if (!n) return; A.logAmount(null, id + ':' + n); };
A.hsFocus = () => { closeSheet('habit'); startFocus({}); };
A.hsRoutine = (el, rid) => { closeSheet('habit'); setTimeout(() => open('runner', { id: rid }), 200); };
A.hsFreq = (el, f) => { S.ui.hsEdit.freq = f; repaintSheets(); };
A.hsPart = (el, d) => { S.ui.hsEdit.daypart = d; repaintSheets(); };
A.hsSave = (el, id) => {
  const h = habit(id), n = $('#hsname'), t = $('#hstgt'), patch = { daypart: S.ui.hsEdit.daypart === 'anytime' ? undefined : S.ui.hsEdit.daypart };
  if (n && !n.disabled && n.value.trim()) patch.name = n.value.trim();
  if (!h.routine) patch.frequency = S.ui.hsEdit.freq;
  if (t && +t.value > 0) { if (h.measure === 'times') patch.targetCount = +t.value; else if (h.measure === 'minutes') patch.dailyTargetMin = +t.value; }
  B.store().updateHabit(id, patch);
  if (S.ui.hsEdit.daypart === 'anytime') B.store().setLook('habit', id, { daypart: null });
  toast('Habit saved');
};
A.hsArchive = (el, id) => { const h = habit(id); closeSheet('habit'); B.store().deleteHabit(id); undoable('Archived: ' + h.name, () => B.store().undoDelete()); };
/* the amount widget on Home opens the same sheet */
W.measure.tap = (inst) => { const h = habit(inst.arg) || S.habits.find(x => x.kind === 'measured' && !x.auto && inSp(x, PAGES[S.page])); if (h) openHabitSheet(h.id); };

/* ---------------- routine sheet: same bottom-up mechanics; its steps are the folder's habits ---------------- */
const CAD = { daily: 'Every day', prework: 'Before work', weekly: 'Once a week', monthly: 'Once a month' };
const rHabit = r => habit(r.habitId) || { id: r.habitId || r.id, streak: 0, best: 0, doneToday: routineDone(r) >= routineReq(r) };
function openRoutineSheet(id) {
  const r0 = routine(id); if (!r0) return;
  S.ui.rsEdit = { cadence: r0.cadence, daypart: r0.daypart || 'anytime', open: false };
  sheet('routine', {
    cls: 'hsheet', live: true, title: () => routine(id) ? routine(id).title : '', body: () => {
      const r = routine(id); if (!r) return '';
      const d = routineDone(r), n = r.steps.length, h = rHabit(r), e = S.ui.rsEdit, fin = d >= routineReq(r);
      const steps = r.steps.map((st, i) => `<div class="row rstep" style="align-items:flex-start">${ck(st.done, `data-a="rsStep" data-x="${id}:${i}" aria-label="Tick ${esc(st.title)}"`)}
        <div class="grow"><div class="hstack" style="gap:8px;align-items:baseline">${dm(pad(i + 1), 2, { cls: 'dim' })}<span class="rt ${st.done ? 'done' : ''}">${esc(st.title)}</span></div>
        <div class="rs">${st.optional ? '<span>Optional</span>' : ''}${st.kind === 'timer' ? `<span>${ico('clock')} ${Math.round(st.seconds / 60)} min timer</span>` : ''}${st.gate ? `<span class="red">${esc(st.gate)}</span>` : ''}${st.link ? `<span>${esc(st.link)}</span>` : ''}</div>
        ${st.alts ? `<div class="g2 rsalts">${st.alts.map((al, k) => `<button class="cd alt ${st.alt === k ? 'k' : ''}" data-a="rsAlt" data-x="${id}:${i}:${k}" aria-pressed="${st.alt === k}"><div class="rt" style="font-weight:700;color:var(--fg)">${esc(al.title)}</div><div class="wt" style="font-size:11.5px;color:var(--fd);margin-top:4px">${esc(al.note)}</div></button>`).join('')}</div>` : ''}</div></div>`).join('');
      const ed = r.steps.map((st, i) => `<div class="hstack rse"><input class="fld rse-step" data-i="${i}" value="${esc(st.title)}" aria-label="Step ${i + 1}"><button class="kb sm" data-a="rsMove" data-x="${id}:${i}:-1" aria-label="Move up" ${i ? '' : 'disabled'}>${ico('up')}</button><button class="kb sm" data-a="rsMove" data-x="${id}:${i}:1" aria-label="Move down" ${i < n - 1 ? '' : 'disabled'}>${ico('down')}</button><button class="kb sm" data-a="rsDel" data-x="${id}:${i}" aria-label="Remove step">${ico('close')}</button></div>`).join('');
      return `<div class="lb" style="margin:-4px 2px 12px">${CAD[r.cadence] || r.cadence}${r.daypart ? ', ' + r.daypart : ''}${r.repeatable ? ', no set day' : ''}</div>
      <div class="cd k"><div class="hstack" style="justify-content:space-between">${lb('Today')}${dm(d + ' OF ' + n, 3.2, { k: 'rsd' + id })}</div><div style="margin-top:14px">${drow(n, d, { gap: 22, r: 6, k: 'rsr' + id })}</div></div>
      <div class="g2 hstat"><div class="cd">${dm(h.streak, 3.6)}<div class="lb">Day streak</div></div><div class="cd">${dm(hBest(h), 3.6)}<div class="lb">Best run</div></div></div>
      <div class="cd">${lbRow('Finished days, 12 weeks', fin ? 'Done today' : d + ' of ' + n + ' today')}<div style="margin-top:12px">${hkGrid(h, 0, true)}</div></div>
      <div class="hstack" style="gap:8px;margin-bottom:10px"><button class="key red grow" style="height:52px" data-a="rsStart" data-x="${id}">${ico('play')} ${fin ? 'Run it again' : d ? 'Continue' : 'Start'}</button>${r.repeatable ? `<button class="key t" style="height:52px" data-a="rsAgain" data-x="${id}">${ico('undo')} Run again</button>` : ''}</div>
      <div class="sl">Steps<b>${d} of ${n} done</b></div><div class="cd tight rows">${steps}</div>
      <div class="sl"><span>Edit</span><button class="lb fg" data-a="rsEditToggle">${e.open ? 'Close' : 'Open'}</button></div>
      ${e.open ? `<div class="cd hedit"><input class="fld" id="rsname" value="${esc(r.title)}" aria-label="Name">
        <div class="lb" style="margin:14px 0 8px">Cadence</div><div class="chips">${Object.entries(CAD).map(([c, l]) => `<button class="chip ${e.cadence === c ? 'on' : ''}" data-a="rsCad" data-x="${c}">${l}</button>`).join('')}</div>
        <div class="lb" style="margin:14px 0 8px">When in the day</div><div class="chips">${['morning', 'noon', 'afternoon', 'evening', 'anytime'].map(p => `<button class="chip ${e.daypart === p ? 'on' : ''}" data-a="rsPart" data-x="${p}">${p}</button>`).join('')}</div>
        <div class="lb" style="margin:14px 0 8px">Steps</div><div style="display:grid;gap:6px">${ed}</div>
        <div class="hstack" style="margin-top:8px"><input class="fld" id="rsnew" placeholder="Add a step" data-enter="rsAdd" data-x="${id}"><button class="key" data-a="rsAdd" data-x="${id}">Add</button></div>
        <button class="key wide" style="margin-top:16px" data-a="rsSave" data-x="${id}">Save changes</button></div>` : ''}
      <button class="key t wide" style="color:var(--red);margin-top:4px" data-a="rsArchive" data-x="${id}">${ico('trash')} Archive this routine</button>`;
    }
  });
}
/* Renamed steps are written when they change, through the step habit's own edit. */
function rsKeepNames(id) { const r = routine(id); $$('.sheet .rse-step').forEach(f => { const st = r.steps[+f.dataset.i]; if (st && f.value.trim() && f.value.trim() !== st.title) B.store().updateHabit(st.id, { name: f.value.trim() }); }); }
A.routineSheet = (el, id) => openRoutineSheet(id);
A.rsStep = (el, x) => { const [id, i] = x.split(':'), st = routine(id).steps[+i]; if (st.alts && st.alt == null && !st.done) { toast('Pick one of the two first'); return; } B.store().toggleHabitDay(st.id, TI()); };
A.rsAlt = (el, x) => { const [id, i, k] = x.split(':'), st = routine(id).steps[+i]; B.store().pickHabitAlt(st.id, st.alts[+k].id); };
A.rsStart = (el, id) => { closeSheet('routine'); setTimeout(() => open('runner', { id }), 220); };
A.rsAgain = (el, id) => { closeSheet('routine'); setTimeout(() => open('runner', { id, again: 1 }), 220); };
A.rsEditToggle = () => { S.ui.rsEdit.open = !S.ui.rsEdit.open; repaintSheets(); };
A.rsCad = (el, c) => { S.ui.rsEdit.cadence = c; repaintSheets(); };
A.rsPart = (el, p) => { S.ui.rsEdit.daypart = p; repaintSheets(); };
A.rsMove = () => toast('Step order is not editable in the real app yet');
A.rsDel = (el, x) => { const [id, i] = x.split(':'), st = routine(id).steps[+i]; rsKeepNames(id); B.store().deleteHabit(st.id); undoable('Step removed: ' + st.title, () => B.store().undoDelete()); };
A.rsAdd = () => toast('Adding steps is not in the real app yet. Add it as a habit in the routine for now.');
A.rsSave = (el, id) => {
  const r = routine(id), n = $('#rsname'); rsKeepNames(id);
  B.store().updateRoutine(id, { title: n && n.value.trim() ? n.value.trim() : r.title, cadence: S.ui.rsEdit.cadence });
  if (r.habitId) B.store().setLook('habit', r.habitId, { daypart: S.ui.rsEdit.daypart === 'anytime' ? null : S.ui.rsEdit.daypart });
  S.ui.rsEdit.open = false; toast('Routine saved');
};
A.rsArchive = (el, id) => { const r = routine(id); closeSheet('routine'); B.store().deleteRoutine(id); undoable('Archived: ' + r.title, () => B.store().undoDelete()); };
/* the routine widget on Home opens the sheet; its START key still goes straight to the runner */
W.routine.tap = (inst) => { const r = routineFor(inst, PAGES[S.page]); if (r) openRoutineSheet(r.id); };

/* ---- 53-zone.js ---- */
/* =====================================================================
   The Zone: a 25x25 glyph matrix that drains as the block runs, real
   countdown, pause, end, task steps. Focus: history and lengths.
   ===================================================================== */
const GM_N = 25;
const GM_ORDER = (() => {
  const c = (GM_N - 1) / 2, R = GM_N / 2 - .2, pts = [];
  for (let y = 0; y < GM_N; y++) for (let x = 0; x < GM_N; x++) { const d = Math.hypot(x - c, y - c); if (d <= R) { let a = Math.atan2(x - c, -(y - c)); if (a < 0) a += Math.PI * 2; pts.push({ x, y, a, d }); } }
  pts.sort((p, q) => p.a - q.a || p.d - q.d);
  return pts;
})();
function gmSVG() {
  return `<svg class="gm" viewBox="0 0 ${GM_N} ${GM_N}" aria-hidden="true">${GM_ORDER.map(p => `<circle cx="${p.x + .5}" cy="${p.y + .5}" r=".36"/>`).join('')}</svg>`;
}
function zoneTick(l, root) {
  const v = root ? { el: root } : top_(); if (!root && v.id !== 'zone' || !v.el) return;
  const p = S.pomo, svg = $('.gm', v.el); if (!svg) return;
  const total = p.phase === 'idle' ? 1 : p.total, frac = p.phase === 'idle' ? 1 : l / total;
  const on = Math.round(frac * GM_ORDER.length), cs = svg._c || (svg._c = [...svg.querySelectorAll('circle')]);
  const cls = p.phase === 'focus' ? 'r' : p.phase === 'break' ? 'w' : 'w';
  cs.forEach((c, i) => { const k = i < on ? cls : ''; if (c._k !== k) { c._k = k; c.setAttribute('class', k); } });
  const t = $('[data-live="ztime"] .dm', v.el); if (t) dmLive(t, pad(Math.floor(l / 60)) + ':' + pad(l % 60));
}
V.zone = {
  title: 'Zone', dark: true, live: true,
  action: () => `<button class="kb" data-a="open" data-x="focus" aria-label="Focus history">${ico('clock')}</button>`,
  render() {
    const p = S.pomo, t = p.taskId ? task(p.taskId) : null, run = p.phase !== 'idle';
    const l = pomoLeft();
    const pick = openToday(curSpace() === 'all' ? 'all' : curSpace()).slice(0, 8);
    const word = { idle: 'Ready', focus: 'Focusing', paused: 'Paused', break: 'Break' }[p.phase];
    return `<div class="zone-top"><div class="lb" style="color:${p.phase === 'focus' ? 'var(--red)' : 'var(--dim)'}">${word}</div><div class="lb">${hm(NOW())} ${phaseOf().toUpperCase()}</div></div>
    <div class="gmw ${p.phase}">${gmSVG()}</div>
    <div style="text-align:center;margin-top:18px" data-live="ztime">${dm(pad(Math.floor(l / 60)) + ':' + pad(l % 60), 6.4, { k: 'ztime' })}</div>
    <div class="zcyc">${[0, 1, 2, 3].map(i => `<i class="${i < p.cycles ? 'on' : ''}"></i>`).join('')}</div>
    <div class="wt" style="text-align:center;font-size:15px;margin:8px 20px 18px">${esc(run ? p.label : (t ? t.title : 'Pick a task, or just start'))}</div>
    <div class="hstack" style="justify-content:center;gap:10px">${run ? `<button class="key t" style="height:54px;min-width:110px" data-a="focusPause">${ico(p.phase === 'paused' ? 'play' : 'pause')} ${p.phase === 'paused' ? 'Resume' : 'Pause'}</button><button class="key red" style="height:54px;min-width:110px" data-a="focusStop">${ico('stop')} End</button>` : `<button class="key red" style="height:58px;min-width:200px" data-a="zoneStart">${ico('play')} Start ${p.focusMin} min</button>`}</div>
    ${!run ? `<div class="chips" style="justify-content:center;margin-top:14px">${[15, 25, 45, 60, 90].map(m => `<button class="chip ${p.focusMin === m ? 'on' : ''}" data-a="zoneLen" data-x="${m}">${m}</button>`).join('')}</div>` : ''}
    ${t && t.subtasks ? `<div class="sl">Steps<b>${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</b></div><div class="cd tight rows">${t.subtasks.map(s => `<div class="row">${ck(s.done, `data-a="subCk" data-x="${t.id}:${s.id}"`)}<span class="grow rt one ${s.done ? 'done' : ''}">${esc(s.title)}</span><span class="age">${fmtMin(s.est)}</span></div>`).join('')}</div>` : ''}
    ${!run ? `<div class="sl">Focus on</div><div class="cd tight rows">${pick.map(x => `<button class="row" style="width:100%" data-a="zonePick" data-x="${x.id}"><span class="grow rt one">${esc(x.title)}</span><span class="age">${x.est ? fmtMin(x.est) : '-'}</span>${S.ui.zonePick === x.id ? ico('check') : ''}</button>`).join('') || '<div class="empty">Nothing on today\'s list.</div>'}</div>` : ''}`;
  },
  after(el) { zoneTick(pomoLeft(), el); }
};
A.zoneStart = () => startFocus(S.ui.zonePick ? { taskId: S.ui.zonePick } : {});
A.zoneLen = (el, m) => B.pomo().setFocusMin(+m);
A.zonePick = (el, id) => { S.ui.zonePick = S.ui.zonePick === id ? null : id; const t = task(id); if (t && t.est && S.ui.zonePick) B.pomo().setFocusMin(clamp(t.est, 5, 90)); refresh(); };

V.focus = {
  title: 'Focus', render() {
    const s = S.focus.sessions;
    return `<div class="cd k">${lbRow('Focused today', 'Target ' + S.focusTarget + 'H')}<div style="margin:12px 0">${dm(fmtMin(focusMinToday()), 5, { k: 'ft' })}</div>${drow(S.focusTarget * 2, Math.round(focusMinToday() / 30), { gap: 14, r: 4, k: 'ftd' })}</div>
    ${S.pomo.phase !== 'idle' ? `<div class="cd r">${lbRow(S.pomo.phase === 'paused' ? 'Paused' : 'Running', esc(S.pomo.label))}<div style="margin:10px 0" data-live="pomo">${dm(pomoText(), 4, { k: 'fpomo' })}</div><div class="hstack"><button class="key sm" style="background:#fff;color:var(--red)" data-a="focusPause">${S.pomo.phase === 'paused' ? 'Resume' : 'Pause'}</button><button class="key sm" style="background:rgba(255,255,255,.2);color:#fff" data-a="focusStop">Stop</button></div></div>` : `<button class="key red wide" style="height:52px;margin-bottom:10px" data-a="focusStart">${ico('play')} Start a ${S.pomo.focusMin} min block</button>`}
    <div class="sl">Focus length</div><div class="chips">${[15, 25, 30, 45, 60, 90].map(m => `<button class="chip ${S.pomo.focusMin === m ? 'on' : ''}" data-a="zoneLen" data-x="${m}">${m} min</button>`).join('')}</div>
    <div class="sl">Break after each block</div><div class="chips">${[3, 5, 10, 15].map(m => `<button class="chip ${S.pomo.breakMin === m ? 'on' : ''}" data-a="brkLen" data-x="${m}">${m} min</button>`).join('')}</div>
    <div class="sl">Today<b>${fmtMin(S.focus.minutes)}</b></div><div class="cd tight rows">${s.slice().reverse().map(x => `<div class="row"><span class="lb" style="width:44px">${x.at}</span><span class="grow rt one">${esc(x.label)}</span><span class="est">${fmtMin(x.min)}</span></div>`).join('')}</div>
    <div class="sl">Last 7 days</div><div class="cd">${W.focusweek.render('41', 'all', { id: 'fw' }).replace('class="wi"', 'class="wi" style="position:static;padding:0"')}</div>`;
  }
};
A.brkLen = (el, m) => B.pomo().setBreakMin(+m);

/* ---- 54-sections.js ---- */
/* =====================================================================
   Calendar, Notes (+ editor), Ideas / Prompts, People (personal and
   business pipeline), Bills, Weather
   ===================================================================== */

/* ---------------- CALENDAR ---------------- */
V.calendar = {
  title: 'Calendar', lazy: true,
  action: () => `<button class="kb" data-a="calRefresh" aria-label="Refresh">${ico('sync')}</button>`,
  render() {
    const now = NOW(), Y = now.getFullYear(), M = now.getMonth(), td = now.getDate(), sel = S.ui.calDay || td;
    const iso = d => Y + '-' + pad(M + 1) + '-' + pad(d);
    const first = new Date(Y, M, 1).getDay(), off = (first + 6) % 7, dim = new Date(Y, M + 1, 0).getDate(); let cells = '';
    for (let i = 0; i < 42; i++) { const d = i - off + 1, inM = d >= 1 && d <= dim, has = inM && MC.calendar.some(e => e.day === iso(d)); cells += `<button class="mc ${inM ? '' : 'out'} ${d === td ? 'today' : ''} ${d === sel ? 'on' : ''}" ${inM ? `data-a="calPick" data-x="${d}"` : ''}><span>${inM ? d : ''}</span>${has ? '<i></i>' : ''}</button>`; }
    const from = iso(sel), days = [...new Set(MC.calendar.map(e => e.day))].filter(d => d >= from).sort();
    const nm = minsOfDay(now), mm = x => +x.slice(0, 2) * 60 + +x.slice(3), t0 = isoOff(0), t1 = isoOff(1);
    return `<div class="cd"><div class="hstack" style="margin-bottom:10px"><div class="grow d1" style="font-size:22px">${MONTHL[M]} ${Y}</div><button class="kb sm" data-a="calMonth" aria-label="Previous month">${ico('left')}</button><button class="kb sm" data-a="calMonth" aria-label="Next month">${ico('right')}</button></div><div class="mgrid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span class="lb" style="text-align:center">${d}</span>`).join('')}${cells}</div></div>
    ${days.map(d => { const dd = new Date(d + 'T12:00:00'), n = dd.getDate(), es = MC.calendar.filter(e => e.day === d); return `<div class="agd"><div class="agh">${dm(n, 4)}<div><div class="lb fg">${d === t0 ? 'Today' : d === t1 ? 'Tomorrow' : DAYL[(dd.getDay() + 6) % 7]}</div><div class="lb">${es.length} event${es.length > 1 ? 's' : ''}</div></div></div><div class="cd tight rows">${es.map(e => { const live = d === t0 && !e.allDay && mm(e.start) <= nm && mm(e.end) > nm, past = d === t0 && !e.allDay && mm(e.end) <= nm; return `<div class="row" style="${past ? 'opacity:.5' : ''}"><div style="width:52px">${e.allDay ? lb('All day', 'fg') : lb(e.start, 'fg') + lb(e.end)}</div><div class="grow"><div class="rt">${esc(e.title)}</div><div class="rs"><span>${esc(e.where)}</span>${live ? '<span class="red">Now</span>' : ''}</div></div><button class="key xs t" data-a="writeUp" data-x="${esc(e.title)}">Write it up</button></div>`; }).join('')}</div></div>`; }).join('') || `<div class="empty">${esc(MC.calNote)}</div>`}`;
  }
};
A.calPick = (el, d) => { S.ui.calDay = +d; refresh(); };
A.calMonth = () => toast('Other months are not in this look yet');
A.calRefresh = (el) => { el.innerHTML = spinSVG(); B.refresh(); setTimeout(() => { refresh(); toast('Calendar read again'); }, 900); };
A.writeUp = (el, title) => {
  const id = B.addNote('work', title + '\n\n- ');
  afterUpdate(() => open('note', { id, fresh: 1 }));
};

/* ---------------- NOTES ---------------- */
V.notes = {
  title: 'Notes', lazy: true,
  action: () => `<button class="kb ink" data-a="newNote" aria-label="New note">${ico('plus')}</button>`,
  render() {
    const f = S.ui.nf || 'all', q = (S.ui.nq || '').toLowerCase();
    let items = S.notes.filter(n => !n.done && (f === 'all' || n.folder === f) && (!q || (n.title + ' ' + n.body).toLowerCase().includes(q)));
    if (f === 'done') items = S.notes.filter(n => n.done);
    const pinned = items.filter(n => n.pinned), rest = items.filter(n => !n.pinned);
    const grp = { Today: rest.filter(n => /h$|now/.test(n.ago)), 'Previous 7 days': rest.filter(n => /d$/.test(n.ago)), Earlier: rest.filter(n => /w$/.test(n.ago)) };
    const ev = nextEvent();
    const row = n => `<div class="row" style="min-height:68px">${ck(n.done, `data-a="noteDone" data-x="${n.id}" aria-label="Done"`)}<button class="grow" style="min-width:0" data-a="openNote" data-x="${n.id}"><div class="rt one" style="font-weight:700">${esc(n.title || 'Untitled')}</div><div class="rs" style="text-transform:none;letter-spacing:0;font-weight:400;font-size:12px"><span>${n.ago}</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${esc(n.body.split('\n')[0])}</span></div></button></div>`;
    return `${ev ? `<div class="cd k"><div class="hstack"><span class="chip red" style="height:24px">Next</span><div class="grow wt" style="font-size:12.5px">${esc(ev.title)} at ${ev.start}</div><button class="key xs" style="background:var(--inki);color:var(--ti)" data-a="writeUp" data-x="${esc(ev.title)}">Write it up</button></div></div>` : ''}
    <input class="fld" id="nq" placeholder="Search notes" value="${esc(S.ui.nq || '')}" style="margin-bottom:10px">
    <div class="chips" style="margin-bottom:10px"><button class="chip ${f === 'all' ? 'on' : ''}" data-a="nf" data-x="all">All ${S.notes.length}</button>${S.folders.map(x => `<button class="chip ${f === x.id ? 'on' : ''}" data-a="nf" data-x="${x.id}">${esc(x.name)} ${x.count}</button>`).join('')}${S.notes.some(n => n.done) ? `<button class="chip ${f === 'done' ? 'on' : ''}" data-a="nf" data-x="done">${ico('check')} Done</button>` : ''}</div>
    ${pinned.length ? `<div class="sl">Pinned</div><div class="cd tight rows">${pinned.map(row).join('')}</div>` : ''}
    ${Object.entries(grp).filter(([, v]) => v.length).map(([k, v]) => `<div class="sl">${k}</div><div class="cd tight rows">${v.map(row).join('')}</div>`).join('')}
    ${!items.length ? `<div class="empty">${q ? 'Nothing matches.' : 'No notes here yet.'}</div>` : ''}`;
  },
  after(el) { const f = $('#nq', el); if (f) f.oninput = () => { S.ui.nq = f.value; const p = f.selectionStart; R.view(); const g = $('#nq', top_().el); g.focus(); g.setSelectionRange(p, p); }; }
};
A.nf = (el, x) => { S.ui.nf = x; refresh(); };
A.openNote = (el, id) => open('note', { id });
A.noteDone = (el, id) => { const n = S.notes.find(x => x.id === id); B.store().setNoteDone(id, !n.done); toast(!n.done ? 'Moved to Done' : 'Put back'); };
A.newNote = () => { const f = S.ui.nf && S.ui.nf !== 'all' && S.ui.nf !== 'done' ? S.ui.nf : MC.notes.defaultFolder[curSpace() === 'work' ? 'work' : 'personal']; const id = B.store().addNote(f); afterUpdate(() => open('note', { id, fresh: 1 })); };
V.note = {
  title: a => (S.folders.find(f => f.id === (S.notes.find(n => n.id === a.id) || {}).folder) || { name: 'Note' }).name, live: false, noSwipeClose: true,
  action: a => `<button class="kb" data-a="noteMenu" data-x="${a.id}" aria-label="Note options">${ico('kebab')}</button>`,
  render(a) {
    const n = S.notes.find(x => x.id === a.id);
    if (!n) return `<div class="empty">This note is not here any more.</div>`;
    return `<div class="lb" style="margin:2px 4px 10px">${esc(n.whenLabel)}${n.pinned ? ', pinned' : ''}</div>
    <textarea class="ntitle" id="ntt" rows="1" placeholder="Untitled">${esc(n.title)}</textarea>
    <textarea class="nbody" id="ntb" placeholder="Start writing. Type /task to put a line on the list.">${esc(n.body)}</textarea>
    <div class="ai-bar"><div class="chips">${MC.notes.aiActions.map(x => `<button class="chip" data-a="noteAI" data-x="${x}">${ico('wand')}${x}</button>`).join('')}</div><button class="kb ${S.ui.dict ? 'red' : 'ink'}" data-a="noteDict" aria-label="Dictate">${S.ui.dict ? `<span class="wave"><i></i><i></i><i></i><i></i></span>` : ico('mic')}</button></div>`;
  },
  after(el, a) {
    const n = S.notes.find(x => x.id === a.id), t = $('#ntt', el), b = $('#ntb', el); if (!n) return;
    const grow = x => { x.style.height = 'auto'; x.style.height = x.scrollHeight + 'px'; };
    t.oninput = () => { grow(t); B.store().updateNote(n.id, { title: t.value }); }; b.oninput = () => B.store().updateNote(n.id, { body: b.value });
    t.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); b.focus(); } };
    b.onkeydown = e => { if (e.key === 'Enter') { const line = b.value.slice(0, b.selectionStart).split('\n').pop(); const m = line.match(/^(.*)\/task\s*(.*)$/); if (m) { const title = (m[1] + m[2]).trim(); if (title) { B.store().addTask({ title, source: 'mc', estimateMin: 0, space: n.space, list: 'backlog', category: 'quick' }); toast('On the list: ' + title); } } } };
    grow(t);
    if (a.fresh) setTimeout(() => t.focus(), 450);
  }
};
A.noteAI = () => toast('The note AI is not wired into this look yet');
A.noteDict = () => toast('Dictation is not wired into this look yet. The keyboard mic works.');
A.noteMenu = (el, id) => {
  const n = S.notes.find(x => x.id === id);
  sheet('notemenu', {
    title: 'Note', body: () => `<div class="g2"><button class="key t" style="height:52px" data-a="notePin" data-x="${id}">${ico('pin')} ${n.pinned ? 'Unpin' : 'Pin to the top'}</button><button class="key t" style="height:52px" data-a="noteTask" data-x="${id}">${ico('list')} Make it a task</button></div>
    <div class="sl">Move to</div><div class="chips">${S.folders.filter(f => f.id !== n.folder).map(f => `<button class="chip" data-a="noteMove" data-x="${id}:${f.id}">${esc(f.name)}</button>`).join('')}</div>
    <button class="key red wide" style="margin-top:16px" data-a="noteDel" data-x="${id}">${ico('trash')} Delete</button>`
  });
};
A.notePin = (el, id) => { const n = S.notes.find(x => x.id === id); B.store().updateNote(id, { pinned: !n.pinned }); closeSheet('notemenu'); toast(!n.pinned ? 'Pinned' : 'Unpinned'); };
A.noteTask = (el, id) => { const n = S.notes.find(x => x.id === id); const tid = B.store().addTask({ title: n.title || 'Note task', source: 'mc', estimateMin: 0, space: n.space, list: 'backlog', category: 'deep' }); closeSheet('notemenu'); toast('On the to-do list', { act: 'seeTask', x: tid, actLabel: 'See it' }); };
A.noteMove = (el, x) => { const [id, f] = x.split(':'); B.store().moveNote(id, f); closeSheet('notemenu'); afterUpdate(() => renderTop(top_())); toast('Moved to ' + S.folders.find(z => z.id === f).name); };
A.noteDel = (el, id) => { B.store().deleteNote(id); closeSheet('notemenu'); back(); undoable('Note deleted', () => B.store().undoDelete()); };

/* ---------------- IDEAS / PROMPTS ---------------- */
V.ideas = {
  title: () => S.ui.iface === 'prompts' ? 'Prompts' : 'Ideas', lazy: true,
  action: () => `<button class="kb ink" data-a="ideaAdd" aria-label="Add">${ico('plus')}</button>`,
  render() {
    const f = S.ui.iface || 'ideas';
    const seg = `<div class="seg" style="margin-bottom:12px"><button class="${f === 'ideas' ? 'on' : ''}" data-a="iface" data-x="ideas">Ideas <span class="n">${S.ideas.length}</span></button><button class="${f === 'prompts' ? 'on' : ''}" data-a="iface" data-x="prompts">Prompts <span class="n">${S.prompts.filter(p => !p.sent).length}</span></button></div>`;
    if (f === 'ideas') return seg + (S.ideas.length ? `<div class="g2">${S.ideas.map((x, i) => `<div class="cd idea ${i % 3 === 0 ? 'k' : ''}" role="button" tabindex="0" data-a="ideaOpen" data-x="${esc(x.id)}">${lb(x.done ? 'Done' : x.kind)}<div class="wt up" style="font-size:13px;margin:10px 0 6px;color:var(--fg);font-weight:700">${esc(x.title)}</div>${x.body ? `<div class="idprev">${esc(x.body)}</div>` : ''}<button class="lb" data-a="ideaDone" data-x="${i}" style="color:var(--fd);margin-top:10px">${x.done ? 'Reopen' : 'Mark done'}</button></div>`).join('')}</div>` : '<div class="empty">No ideas yet. Tap + to write one down.</div>');
    const waiting = S.prompts.filter(p => !p.sent);
    return seg + `<div class="cd k"><div class="hstack"><div class="grow">${lb('Claude window')}<div class="wt" style="margin-top:6px;color:var(--fg)">${waiting.length} waiting, oldest first.</div></div>${dm(waiting.length, 4)}</div></div>
    <div class="hstack" style="margin-bottom:10px"><input class="fld" id="pq" placeholder="Write a prompt" data-enter="promptAdd"><button class="key" data-a="promptAdd">Add</button></div>
    <div class="cd tight rows">${S.prompts.map(p => `<div class="row" style="align-items:flex-start;padding:14px 0"><div class="grow" data-a="promptOpen" data-x="${esc(p.id)}"><div class="rt">${esc(p.text)}</div><div class="rs"><span>${p.kind}</span><span>${esc(p.project)}</span><span>${p.age}</span>${p.sent ? '<span>Sent</span>' : ''}</div></div>${p.sent ? '' : `<button class="key xs" data-a="promptSend" data-x="${p.id}">${ico('copy')} Copy</button>`}</div>`).join('')}</div>`;
  }
};
A.iface = (el, x) => { S.ui.iface = x; const e = top_(); renderTop(e); renderBody(e, false); };
A.ideaDone = (el, i) => { const x = S.ideas[+i]; B.store().updateIdeaCard(x.id, { done: !x.done }); };
/* ---------------- idea and prompt sheets: rise from the bottom, edit in place, save by themselves ---------------- */
const fmtDay = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const growTa = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
/* One saver for both: edits go to the store 600 ms after the last key and again when the sheet closes, so closing mid-typing loses nothing. */
function noteSheet(key, st, o) {
  S.ui[key] = st; st.t = 0;
  const flush = () => { clearTimeout(st.t); if (S.ui[key] === st) o.save(st); };
  sheet(key === 'ideaSt' ? 'idea' : 'prompt', {
    cls: 'hsheet', live: false, title: o.title, focus: o.focus, onClose: () => { flush(); if (S.ui[key] === st) S.ui[key] = null; },
    body: () => o.body(st),
    after(el) {
      const ta = $('.idbody', el), ti = $('#idt', el);
      const sched = () => { clearTimeout(st.t); st.t = setTimeout(flush, 600); };
      if (ti) ti.addEventListener('input', () => { st.title = ti.value; sched(); });
      ta.addEventListener('input', () => { st.body = ta.value; growTa(ta); sched(); });
      requestAnimationFrame(() => growTa(ta)); setTimeout(() => growTa(ta), 460);
    }
  });
  st.flush = flush;
}
function openIdeaSheet(id) {
  const x = id ? S.ideas.find(i => i.id === id) : null; if (id && !x) return;
  const st = { id: x ? x.id : null, title: x ? x.title : '', body: x ? x.body : '', done: x ? x.done : false, saved: x ? { title: x.title, body: x.body.trim() } : { title: '', body: '' } };
  noteSheet('ideaSt', st, {
    title: x ? 'Idea' : 'New idea', focus: x ? null : '#idt',
    save(st) {
      const title = st.title.trim(), body = st.body.trim();
      if (title === st.saved.title && body === st.saved.body) return;
      if (st.id) B.store().updateIdeaCard(st.id, { title: title || st.saved.title, body });
      else if (title || body) { const n = S.ideas.length; st.id = B.store().addIdeaCard({ title: title || body.split('\n')[0].slice(0, 60), body, x: 40 + (n % 6) * 240, y: 40 + Math.floor(n / 6) * 170 }); }
      else return;
      st.saved = { title: title || st.saved.title, body };
    },
    body: st => `<input class="fld" id="idt" value="${esc(st.title)}" placeholder="Title" aria-label="Title" autocomplete="off"><textarea class="fld idbody" placeholder="Write it out" aria-label="Idea text">${esc(st.body)}</textarea>
      ${x ? `<div class="lb" style="margin:10px 4px 0">Written ${fmtDay(x.createdAt)}, changed ${fmtDay(x.updatedAt)}</div>` : ''}
      <div class="g2" style="margin-top:14px">${x ? `<button class="key t" id="idtgl" data-a="ideaTgl">${st.done ? 'Reopen' : 'Mark done'}</button>` : ''}<button class="key t" data-a="ideaTask">Make it a task</button></div>
      ${x ? `<button class="key t wide" style="color:var(--alert);margin-top:10px" data-a="ideaDel">${ico('trash')} Delete</button>` : `<button class="key wide" style="margin-top:10px" data-a="sheetX">Save idea</button>`}`
  });
}
A.ideaOpen = (el, id) => openIdeaSheet(id);
A.ideaAdd = () => { if (S.ui.iface === 'prompts') { $('#pq') && $('#pq').focus(); return; } openIdeaSheet(null); };
A.ideaTgl = () => { const st = S.ui.ideaSt; if (!st || !st.id) return; st.flush(); st.done = !st.done; B.store().updateIdeaCard(st.id, { done: st.done }); $('#idtgl').textContent = st.done ? 'Reopen' : 'Mark done'; };
A.ideaTask = () => {
  const st = S.ui.ideaSt || S.ui.promptSt; if (!st) return; st.flush();
  const t = (st.title || st.body || '').trim().split('\n')[0].slice(0, 120); if (!t) { toast('Write something first'); return; }
  const tid = B.store().addTask({ title: t, source: 'mc', estimateMin: 0, space: wsp(), list: 'backlog', category: 'quick' });
  toast('On the to-do list', { act: 'seeTask', x: tid, actLabel: 'See it' });
};
A.ideaDel = () => { const st = S.ui.ideaSt; if (!st || !st.id) return; const id = st.id; S.ui.ideaSt = null; clearTimeout(st.t); closeSheet('idea'); B.store().deleteIdeaCard(id); undoable('Idea deleted', () => B.store().undoDelete()); };
function openPromptSheet(id) {
  const x = S.prompts.find(p => p.id === id); if (!x) return;
  const st = { id, body: x.text, sent: x.sent, saved: { body: x.text.trim() } };
  noteSheet('promptSt', st, {
    title: 'Prompt',
    save(st) { const body = st.body.trim(); if (!body || body === st.saved.body) return; B.store().updatePrompt(st.id, { text: body }); st.saved = { body }; },
    body: st => `<div class="lb" style="margin:-4px 2px 10px">${esc(x.kind)}, ${esc(x.project)}</div><textarea class="fld idbody" aria-label="Prompt text">${esc(st.body)}</textarea>
      <div class="lb" style="margin:10px 4px 0">Written ${fmtDay(x.createdAt)}, changed ${fmtDay(x.updatedAt)}</div>
      <div class="g2" style="margin-top:14px"><button class="key" id="pmsent" data-a="promptSentTgl">${st.sent ? 'Put back' : 'Copy and mark sent'}</button><button class="key t" data-a="ideaTask">Make it a task</button></div>
      <button class="key t wide" style="color:var(--alert);margin-top:10px" data-a="promptDel">${ico('trash')} Delete</button>`
  });
}
A.promptOpen = (el, id) => openPromptSheet(id);
A.promptSentTgl = () => { const st = S.ui.promptSt; if (!st) return; st.flush(); st.sent = !st.sent; B.store().setPromptSent(st.id, st.sent); if (st.sent) { try { navigator.clipboard && navigator.clipboard.writeText(st.body); } catch (e) { } toast('Copied. Marked sent.'); } $('#pmsent').textContent = st.sent ? 'Put back' : 'Copy and mark sent'; };
A.promptDel = () => { const st = S.ui.promptSt; if (!st) return; const id = st.id; S.ui.promptSt = null; clearTimeout(st.t); closeSheet('prompt'); B.store().deletePrompt(id); undoable('Prompt deleted', () => B.store().undoDelete()); };
A.promptAdd = () => { const v = $('#pq').value.trim(); if (!v) return; B.store().addPrompt({ project: 'General', session: 'General', kind: 'Idea', text: v }); };
A.promptSend = (el, id) => { const p = S.prompts.find(x => x.id === id); B.store().setPromptSent(id, true); try { navigator.clipboard && navigator.clipboard.writeText(p.text); } catch (e) { } toast('Copied. Marked sent.'); };

/* ---------------- PEOPLE ---------------- */
const TIERS = [['core', 'Inner circle'], ['close', 'Close'], ['friends', 'Friends'], ['business', 'Business'], ['wider', 'Wider'], ['distant', 'Distant']];
V.people = {
  title: 'People', lazy: true,
  action: () => `<button class="kb ink" data-a="personAdd" aria-label="Add">${ico('plus')}</button>`,
  render(a, e) {
    if (a.mode && !e.modeSet) { S.ui.pmode = a.mode; e.modeSet = 1; }
    const m = S.ui.pmode || 'personal';
    const seg = `<div class="seg" style="margin-bottom:12px"><button class="${m === 'personal' ? 'on' : ''}" data-a="pmode" data-x="personal">Personal</button><button class="${m === 'business' ? 'on' : ''}" data-a="pmode" data-x="business">Business</button></div>`;
    return seg + (m === 'personal' ? peoplePersonal() : peopleBusiness());
  }
};
A.pmode = (el, x) => { S.ui.pmode = x; renderBody(top_(), true); };
function peoplePersonal() {
  const od = overdue(), wk = S.people.filter(p => !od.includes(p) && p.cadenceDays - p.lastDays <= 7);
  const R0 = 150, rings = [36, 62, 88, 112, 132, 148];
  let svg = rings.map((r, i) => { let s = ''; const n = Math.round(r * .9); for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; s += `<circle cx="${R0 + r * Math.cos(a)}" cy="${R0 + r * Math.sin(a)}" r=".9" class="dt"/>`; } return s; }).join('');
  S.people.forEach((p, i) => { const ti = TIERS.findIndex(t => t[0] === p.tier), r = rings[ti], a = -Math.PI / 2 + (i * 2.39996), late = p.lastDays > p.cadenceDays; svg += `<g data-a="personOpen" data-x="${p.id}" style="cursor:pointer"><circle cx="${R0 + r * Math.cos(a)}" cy="${R0 + r * Math.sin(a)}" r="${late ? 9 : 7}" class="dt ${late ? 'on rd' : 'on'}"/><text x="${R0 + r * Math.cos(a)}" y="${R0 + r * Math.sin(a) + 3}" text-anchor="middle" font-size="7" font-family="Space Mono" font-weight="700" fill="${late ? '#fff' : 'var(--t)'}">${initials(p.name)}</text></g>`; });
  svg += `<circle cx="${R0}" cy="${R0}" r="14" class="dt on"/><text x="${R0}" y="${R0 + 3}" text-anchor="middle" font-size="7.5" font-family="Space Mono" font-weight="700" fill="var(--t)">YOU</text>`;
  const sorted = [...S.people].sort((x, y) => (x.cadenceDays - x.lastDays) - (y.cadenceDays - y.lastDays));
  return `<div class="g3" style="margin-bottom:10px"><div class="cd r" style="padding:14px">${dm(od.length, 4)}<div class="lb" style="margin-top:8px">Overdue</div></div><div class="cd" style="padding:14px">${dm(wk.length, 4)}<div class="lb" style="margin-top:8px">This week</div></div><div class="cd k" style="padding:14px">${dm(S.people.length, 4)}<div class="lb" style="margin-top:8px">In touch</div></div></div>
  <div class="cd" style="padding:8px"><svg class="dts" viewBox="0 0 300 300" width="100%" aria-label="Your circles">${svg}</svg></div>
  <div class="sl">Who to reach</div><div class="cd tight rows">${sorted.map(p => { const left = p.cadenceDays - p.lastDays; return `<button class="row" style="width:100%" data-a="personOpen" data-x="${p.id}"><span class="av ${left < 0 ? 'late' : ''}">${dm(initials(p.name), 2)}</span><div class="grow"><div class="rt one">${esc(p.name)}</div><div class="rs"><span>${esc(p.rel)}</span>${p.nameDay ? `<span>Name day ${p.nameDay}</span>` : ''}${p.birthday ? `<span>Birthday ${p.birthday}</span>` : ''}</div></div><span class="lb ${left < 0 ? 'red' : left <= 0 ? 'fg' : ''}">${left < 0 ? -left + 'D OVERDUE' : left === 0 ? 'DUE TODAY' : 'IN ' + left + 'D'}</span></button>`; }).join('')}</div>`;
}
A.personOpen = (el, id) => {
  sheet('person', {
    live: true, title: () => S.people.find(p => p.id === id).name, body: () => {
      const p = S.people.find(p => p.id === id), left = p.cadenceDays - p.lastDays;
      return `<div class="cd ${left < 0 ? 'r' : 'k'}">${lbRow(p.rel, TIERS.find(t => t[0] === p.tier)[1])}<div style="margin:12px 0 6px">${dm(p.lastDays + 'D', 4.4)}</div>${lb(p.lastDays === 0 ? 'Spoke today' : 'Since you last spoke')}<div style="margin-top:12px">${drow(14, clamp(14 - Math.round(p.lastDays / p.cadenceDays * 7), 0, 14), { gap: 11, r: 3, fill: true })}</div><div class="wt" style="margin-top:8px;font-size:12.5px">${left < 0 ? -left + ' days overdue' : left === 0 ? 'Due today' : 'Due in ' + left + ' days'}. Every ${p.cadenceDays} days.</div></div>
      ${p.note ? `<div class="cd">${lb('Note')}<div class="wt" style="margin-top:6px">${esc(p.note)}</div></div>` : ''}
      <div class="sl">Log a contact</div><div class="g3">${[['inperson', 'walk', 'In person'], ['call', 'phone', 'Call'], ['message', 'msg', 'Message'], ['video', 'video', 'Video'], ['email', 'mail', 'Email']].map(([c, i, l]) => `<button class="cd chb" data-a="logContact" data-x="${id}:${c}">${icoBig(i, 22)}<div class="lb fg" style="margin-top:8px">${l}</div></button>`).join('')}</div>
      <div class="sl">Talk to them</div><div class="chips">${[[1, 'Every day'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month'], [90, 'Every 3 months']].map(([d, l]) => `<button class="chip ${p.cadenceDays === d ? 'on' : ''}" data-a="cadence" data-x="${id}:${d}">${l}</button>`).join('')}</div>
      <div class="sl">History</div><div class="cd tight rows">${p.log.map(l => `<div class="row"><span class="grow rt one">${l.channel === 'inperson' ? 'In person' : l.channel[0].toUpperCase() + l.channel.slice(1)}</span><span class="lb">${l.day}</span></div>`).join('') || '<div class="empty">Nothing logged yet.</div>'}</div>`;
    }
  });
};
A.logContact = (el, x) => {
  const [id, c] = x.split(':'); B.logContact(id, c);
  undoable(`Logged: ${c === 'inperson' ? 'in person' : c}, today`, () => { const st = B.store(), c0 = st.personContacts.filter(z => z.personId === id && z.channel === c && z.day === isoOff(0)).sort((a, b) => b.createdAt - a.createdAt)[0]; if (c0) st.removeContact(c0.id); });
};
A.cadence = (el, x) => { const [id, d] = x.split(':'); B.store().updatePerson(id, { cadenceDays: +d }); };
A.personAdd = () => {
  if ((S.ui.pmode || 'personal') === 'business') return A.prospectAdd();
  sheet('padd', { title: 'Add a person', focus: '#pn', body: () => `<input class="fld" id="pn" placeholder="Name" data-enter="personSave"><input class="fld" id="pr" placeholder="Who they are to you" style="margin-top:8px"><div class="sl">Circle</div><div class="chips">${TIERS.map(([t, l], i) => `<button class="chip ${i === 2 ? 'on' : ''}" data-a="tierPick" data-x="${t}">${l}</button>`).join('')}</div>`, foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="personSave">Add</button>` });
};
A.tierPick = (el, t) => { S.ui.tier = t; $$('.sheet .chip').forEach(c => c.classList.toggle('on', c === el)); };
A.personSave = () => { const v = $('#pn').value.trim(); if (!v) return; B.addPerson(v, $('#pr').value.trim(), S.ui.tier || 'friends'); closeSheet('padd'); toast(v + ' added'); };

const PHASE = s => { const i = MC.prospectStages.indexOf(s); return i < 4 ? 'research' : i < 5 ? 'reach' : i < 10 ? 'contacted' : i < 13 ? 'talking' : i === 13 ? 'won' : 'lost'; };
function peopleBusiness() {
  const lay = S.ui.blay || 'board';
  const lanes = MC.prospectStages.map(st => ({ st, ps: S.prospects.filter(p => p.stage === st) })).filter(l => l.ps.length || ['Responded waiting', 'Acquired', 'Lost'].includes(l.st));
  return `<div class="g2" style="margin-bottom:10px"><div class="cd k">${dm(inPlay().length, 4.4, { k: 'bp' })}<div class="lb" style="margin-top:8px">In play of ${S.prospects.length}</div></div><div class="cd">${dm(talking().length, 4.4, { k: 'bt' })}<div class="lb" style="margin-top:8px">Talking</div></div></div>
  <div class="hstack" style="margin-bottom:10px"><div class="seg grow"><button class="${lay === 'board' ? 'on' : ''}" data-a="blay" data-x="board">Board</button><button class="${lay === 'list' ? 'on' : ''}" data-a="blay" data-x="list">List</button></div></div>
  ${lay === 'board' ? `<div class="board noscroll">${lanes.map(l => `<div class="lane"><div class="lnh"><span class="lb fg">${esc(l.st)}</span><span class="lb">${l.ps.length}</span></div>${l.ps.map(p => prospectCard(p)).join('') || '<div class="empty" style="padding:14px 6px">Empty</div>'}</div>`).join('')}</div><div class="lb" style="text-align:center;margin-top:8px">Swipe across ${lanes.length} stages</div>`
      : `<div class="cd tight rows">${S.prospects.map(p => `<button class="row" style="width:100%" data-a="prospectOpen" data-x="${p.id}"><div class="grow"><div class="rt one">${esc(p.name)}</div><div class="rs"><span>${esc(p.stage)}</span><span>${esc(p.next)}</span></div></div><span class="lb fg">${p.value}</span></button>`).join('')}</div>`}`;
}
const prospectCard = p => `<button class="pc ${PHASE(p.stage) === 'talking' ? 'k' : PHASE(p.stage) === 'won' ? 'won' : ''}" data-a="prospectOpen" data-x="${p.id}"><div class="rt" style="font-weight:700;font-size:13px;color:inherit">${esc(p.name)}</div><div class="rs" style="color:inherit;opacity:.75"><span>${esc(p.next)}</span></div><div class="hstack" style="margin-top:10px;gap:6px">${drow(10, Math.round(p.value / 10), { gap: 7, r: 2 })}<span class="lb" style="color:inherit">${p.value}</span></div></button>`;
A.blay = (el, x) => { S.ui.blay = x; refresh(); };
A.prospectOpen = (el, id) => {
  sheet('prospect', {
    live: true, title: () => S.prospects.find(p => p.id === id).name, body: () => {
      const p = S.prospects.find(p => p.id === id), si = MC.prospectStages.indexOf(p.stage), steps = ['Prep', 'Outreach', 'Replied', 'Acquired'], sti = si < 5 ? 0 : si < 10 ? 1 : si < 13 ? 2 : 3;
      return `<div class="lb" style="margin:-4px 2px 12px">${esc(p.domain)}</div>
      <div class="cd k"><div class="stp">${steps.map((s, i) => `<div class="${i <= sti ? 'on' : ''}"><i></i>${lb(s, i <= sti ? 'fg' : '')}</div>`).join('')}</div></div>
      <div class="g2"><div class="cd">${dm(p.value, 4)}<div class="lb" style="margin-top:8px">Value</div></div><div class="cd">${dm(p.odds == null ? '-' : p.odds, 4)}<div class="lb" style="margin-top:8px">Reply odds</div></div></div>
      <div class="cd">${lb('Next step')}<div class="rt" style="margin-top:6px">${esc(p.next)}</div><div class="rs"><span>Source: ${p.source}</span></div></div>
      <div class="sl">Stage<b>${esc(p.stage)}</b></div><div class="chips" id="stchips">${MC.prospectStages.map(s => `<button class="chip ${s === p.stage ? 'on' : ''}" data-a="stageSet" data-x="${id}|${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="sl">Touches<b>${p.touches.length}</b></div><div class="cd tight rows">${p.touches.map(t => `<div class="row"><span class="grow rt one">${t.step}</span><span class="lb">${t.day}</span></div>`).join('') || '<div class="empty">No touches yet.</div>'}</div>
      <div class="chips">${['Work email', 'Reminder', 'Personal email', 'Call', 'Visit'].map(s => `<button class="chip" data-a="touchLog" data-x="${id}|${s}">${ico('plus')}${s}</button>`).join('')}</div>`;
    }, after(el) { const c = $('#stchips .chip.on', el); c && c.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  });
};
A.stageSet = (el, x) => { const [id, s] = x.split('|'), p = S.prospects.find(p => p.id === id), was = p.stage; B.store().updateProspect(id, { stage: s }); toast(`${p.name}: ${s}`, { undo: () => B.store().updateProspect(id, { stage: was }) }); };
A.touchLog = (el, x) => { const [id, s] = x.split('|'); B.logTouch(id, s); toast('Logged: ' + s); };
A.prospectAdd = () => sheet('pradd', { title: 'Add a prospect', focus: '#prn', body: () => `<input class="fld" id="prn" placeholder="Business" data-enter="prospectSave"><input class="fld" id="prd" placeholder="Domain" style="margin-top:8px">`, foot: () => `<button class="key t" data-a="sheetX">Cancel</button><button class="key" data-a="prospectSave">Add</button>` });
A.prospectSave = () => { const v = $('#prn').value.trim(); if (!v) return; const d = ($('#prd').value || '').trim().replace(/^https?:\/\//, ''); const id = B.store().addProspect({ name: v, domain: d || undefined, source: 'found', stage: 'Ready to contact' }); closeSheet('pradd'); afterUpdate(() => A.prospectOpen(null, id)); };

/* ---------------- BILLS: Compass, read only, and only once signed in ---------------- */
const ordn = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
V.bills = {
  title: 'Bills', lazy: true, render(a) {
    const b = S.bills;
    if (!b) return `<div class="cd k">${lb('Bills')}<div class="wt" style="margin-top:10px">Bills and debts come from Compass. They show here once you are signed in.</div></div><button class="key t wide" data-a="openClassic" data-x="bills">${ico('out')} Open Bills</button>`;
    const row = x => `<div class="row"><div class="grow"><div class="rt one">${esc(x.name)}</div><div class="rs"><span class="${x.state === 'overdue' ? 'red' : ''}">${x.state === 'paid' ? 'Paid' : x.state === 'overdue' ? 'Overdue' : 'Due the ' + ordn(x.day)}</span></div></div><span class="lb fg">${kc(x.amount)} KČ</span></div>`;
    return `<div class="cd k" id="bills-hero">${lbRow('Debt paid off', b.openDebts + ' open')}<div style="margin:14px 0 10px">${dm(b.debtPaidPct + '%', 6, { k: 'bfree', count: true })}</div>${lb(kc(b.owed) + ' Kč still owed')}<div style="margin-top:14px">${drow(30, Math.round(b.debtPaidPct / 100 * 30), { gap: 10.8, r: 2.8, fill: true, k: 'bpaid' })}</div></div>
    <div class="sl" id="bills-debts">This month<b>${kc(b.monthly)} KČ</b></div><div class="cd tight rows">${b.items.map(row).join('') || '<div class="empty">No payments this month.</div>'}</div>
    <button class="key t wide" style="margin-top:6px" data-a="openClassic" data-x="bills">${ico('out')} Open Bills</button>`;
  },
  after(el, a, fresh) { if (fresh && a.at === 'debts') setTimeout(() => { const d = $('#bills-debts', el); d && d.scrollIntoView({ behavior: 'smooth' }); }, 700); }
};
A.openClassic = (el, x) => B.openClassic(x);

/* ---------------- WEATHER ---------------- */
V.weather = {
  title: 'Prague', render() {
    const w = MC.weather; if (!w) return `<div class="empty">No weather right now. It loads when the phone is online.</div>`;
    const ic = WX[w.sky] || 'cloud';
    return `<div class="cd k" style="display:grid;place-items:center;padding:30px 16px">${icoBig(ic, 120, true)}<div style="margin:20px 0 10px">${dm(w.now + '°', 8, { k: 'wn' })}</div>${lb(w.sky, 'fg')}</div>
    <div class="g3"><div class="cd">${dm(w.feels + '°', 3.4)}${lb('Feels like')}</div><div class="cd">${dm(w.high + '°', 3.4)}${lb('High')}</div><div class="cd">${dm(w.rain + '%', 3.4)}${lb('Rain')}</div></div>
    <div class="sl">Next 8 hours</div><div class="cd"><div class="hrs">${w.hourly.map(h => `<div>${lb(h.at)}${icoBig(h.icon, 22)}<b>${h.t}°</b></div>`).join('')}</div></div>
    <div class="empty">Prague is ${w.sky}, ${w.now} degrees, feels like ${w.feels}, up to ${w.high} today, ${w.rain}% chance of rain.</div>`;
  }
};

/* ---- 55-more.js ---- */
/* =====================================================================
   Jar world (Jar, Health, Gym, Longevity, Why), Jarvis, Apps drawer,
   Settings, Skills, Watchless, embedded app host, Daily review
   ===================================================================== */
const jarNav = cur => `<div class="chips" style="margin-bottom:12px">${[['jar', 'Jar'], ['health', 'Health'], ['gym', 'Gym'], ['longevity', 'Longevity'], ['why', 'The wall']].map(([id, l]) => `<button class="chip ${cur === id ? 'on' : ''}" data-a="jarGo" data-x="${id}">${l}</button>`).join('')}</div>`;
A.jarGo = (el, id) => { if (CLASSIC_V[id]) { B.openClassic(CLASSIC_V[id]); return; } const e = top_(); if (e.id === id) return; e.id = id; e.args = {}; e.el.dataset.view = id; e.el.classList.toggle('dark', !!V[id].dark); setChrome(); renderTop(e); renderBody(e, true); };

V.jar = {
  title: 'Jar', lazy: true, render() {
    const m = S.momentum;
    let proj = ''; for (let i = 0; i < 28; i++) { const push = Math.min(100, m.value + i * 1.6), drift = Math.max(0, m.value * Math.pow(.95, i)); proj += `<circle class="dt on" cx="${i * 11 + 5}" cy="${100 - push}" r="2.4"/><circle class="dt on rd" cx="${i * 11 + 5}" cy="${100 - drift}" r="2.4"/>`; }
    return jarNav('jar') + `<div class="cd k" style="text-align:center;padding:26px 16px"><div style="position:relative;width:220px;height:220px;margin:0 auto">${dring({ n: 50, on: m.value / 2, size: 220, r: 3.2, pad: 8, k: 'jarring' })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:10px">${dm(m.value, 9, { k: 'jarv', count: true })}${lb('of 100')}</div></div></div><div class="d1" style="font-size:26px;margin-top:16px">${m.state}</div></div>
    <div class="g2"><div class="cd">${dm('DAY ' + m.chain, 3.4, { k: 'jc' })}<div class="lb" style="margin:8px 0 10px">Chain, longest ${m.longest}</div>${drow(7, m.last7.filter(Boolean).length, { gap: 12, r: 3.4 })}</div><div class="cd">${dm(fmtMin(MC.timeSaved.weekMin), 3.4)}<div class="lb" style="margin-top:8px">Saved this week</div></div></div>
    <div class="cd">${lb('The promise')}<div class="wt" style="margin-top:8px;font-size:15px">${esc(m.promise)}</div></div>
    <div class="cd">${lbRow('Next 4 weeks', 'Push vs drift')}<svg class="dts" viewBox="0 0 308 104" width="100%" style="margin-top:10px">${proj}</svg><div class="hstack" style="margin-top:8px"><span class="lb fg">${ico('dot')} Keep the rate</span><span class="lb red">${ico('dot')} Stop now</span></div></div>
    ${S.quitting.length ? `<button class="key red wide" style="height:52px" data-a="giveUp" data-x="${S.quitting[0].id}">I want to give up</button>` : ''}`;
  }
};
V.health = {
  title: 'Health', lazy: true, render() {
    const h = MC.health;
    if (!h) return jarNav('health') + `<div class="cd"><div class="wt">Health reads the watch pipeline once you are signed in.</div></div><button class="key t wide" data-a="openClassic" data-x="health">${ico('out')} Open Health</button>`;
    const rg = (v, l, red) => `<div class="cd" style="padding:12px;text-align:center"><div style="position:relative;width:84px;height:84px;margin:0 auto">${dring({ n: 30, on: v * 30, size: 84, r: 2, pad: 4, red, k: 'hr' + l })}<div class="wcenter">${dm(Math.round(v * 100), 2.4)}</div></div><div class="lb" style="margin-top:8px">${l}</div></div>`;
    let sl = ''; h.sleep7.forEach((v, i) => { for (let k = 0; k < 9; k++) sl += `<circle class="dt ${k < Math.round(v) ? (v < 6.5 ? 'on rd' : 'on') : ''}" cx="${i * 44 + 22}" cy="${96 - k * 11}" r="${k < Math.round(v) ? 4 : 1.2}"/>`; });
    return jarNav('health') + `<div class="g3">${rg(h.rings.move, 'Move')}${rg(h.rings.train, 'Train', true)}${rg(h.rings.sleep, 'Sleep')}</div>
    <div class="cd">${lbRow('Sleep, 7 days', 'Average ' + h.sleepAvg.toFixed(1) + 'H')}<svg class="dts" viewBox="0 0 308 104" width="100%" style="margin-top:12px">${sl}</svg><div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center">${h.sleepDays.map(d => lb(d)).join('')}</div></div>
    <div class="g2"><div class="cd">${dm(kc(h.steps), 3.4, { k: 'hst' })}<div class="lb" style="margin-top:8px">Steps today</div><div class="lb">${kc(h.stepsYesterday)} yesterday</div></div><div class="cd">${dm(h.restingHR == null ? '-' : h.restingHR, 3.4)}<div class="lb" style="margin-top:8px">Resting HR</div></div><div class="cd">${dm(h.sleepAvg.toFixed(1), 3.4)}<div class="lb" style="margin-top:8px">Sleep, hours</div></div><div class="cd">${dm(h.weight == null ? '-' : h.weight, 3.4)}<div class="lb" style="margin-top:8px">Weight, kg</div></div></div>
    ${h.lastRead ? `<div class="lb" style="text-align:center;margin-top:6px">Last read from the watch ${h.lastRead}</div>` : ''}`;
  }
};
V.gym = {
  title: 'Gym', lazy: true, render() {
    const g = S.gym;
    return jarNav('gym') + `<div class="cd k">${lbRow('This week', esc(g.lastSync))}<div class="hstack" style="margin-top:14px">${icoBig('dumbbell', 48)}${dm(g.target ? g.week + '/' + g.target : String(g.week), 7, { k: 'gw' })}</div></div>
    <button class="key ${S.hevyBusy ? 't' : ''} wide" style="height:50px;margin-bottom:10px" data-a="hevySync" ${S.hevyBusy ? 'disabled' : ''}>${S.hevyBusy ? `<span class="chase8">${spinSVG()}</span> Syncing from Hevy` : ico('sync') + ' Sync Hevy'}</button>
    <div class="sl">Targets</div>${g.targets.map(t => `<div class="cd"><div class="hstack"><span class="grow rt" style="font-weight:700">${esc(t.name)}</span>${dm(t.current, 2.6)}<span class="lb">of ${t.goal} ${esc(t.unit)}</span></div><div style="margin-top:12px">${drow(30, Math.round(clamp(t.goal ? t.current / t.goal : 0, 0, 1) * 30), { gap: 10.8, r: 2.8, fill: true, k: 'gt' + t.name })}</div></div>`).join('') || '<div class="empty">No targets set yet.</div>'}
    <div class="sl">Sessions</div><div class="cd tight rows">${g.workouts.map(w => `<div class="row"><span class="lb" style="width:36px">${w.day}</span><div class="grow"><div class="rt one">${esc(w.name)}</div><div class="rs"><span>${w.min} min</span></div></div></div>`).join('') || '<div class="empty">No sessions read yet.</div>'}</div>`;
  }
};
V.why = {
  title: 'The wall', dark: true, render() {
    return jarNav('why') + MC.why.map((w, i) => `<div class="cd ${i % 3 === 1 ? 'r' : i % 3 === 2 ? '' : 'k'}" style="transform:rotate(${[-1.2, .8, -.6, 1.1][i % 4]}deg);margin-bottom:14px">${w.kind === 'number' ? `${dm(w.value, 7)}<div class="wt up" style="margin-top:12px;color:var(--fg)">${esc(w.label)}</div>` : `<div class="wt up" style="font-size:${w.kind === 'statement' ? 22 : 17}px;line-height:1.25;font-weight:700;color:var(--fg)">${esc(w.text)}</div>${w.by ? `<div class="lb" style="margin-top:12px">- ${w.by}</div>` : ''}`}</div>`).join('');
  }
};

/* ---------------- JARVIS: the prototype's face and thread, driven by the real assistant ---------------- */
/* The conversation, the model calls, the actions and their undo all live in the app's own assistant
   (assistantcore.tsx). This view only draws what B.assistant hands it, and never re-renders its own
   input: the thread repaints in place, so the keyboard stays up while a reply streams in. */
function jvFace() {
  let s = '';
  for (let y = 0; y < 11; y++) for (let x = 0; x < 15; x++) s += `<circle class="fo" cx="${x + .5}" cy="${y + .5}" r=".22"/>`;
  [[3, 2], [4, 2], [3, 3], [4, 3], [10, 2], [11, 2], [10, 3], [11, 3]].forEach(([x, y]) => { s += `<circle class="fe eye" cx="${x + .5}" cy="${y + .5}" r=".44"/>`; });
  s += '<g class="m0">' + [[5, 7], [9, 7], [6, 8], [7, 8], [8, 8]].map(([x, y]) => `<circle class="fe" cx="${x + .5}" cy="${y + .5}" r=".44"/>`).join('') + '</g>';
  s += '<g class="m1">' + [[4, 7], [10, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8]].map(([x, y]) => `<circle class="fe" cx="${x + .5}" cy="${y + .5}" r=".44"/>`).join('') + '</g>';
  return `<svg class="face" viewBox="0 0 15 11" aria-hidden="true">${s}</svg>`;
}
const JV_LABEL = { today: 'Today', backlog: 'The list', habits: 'Habits', calendar: 'Calendar', goals: 'Goals', focus: 'Focus', stale: 'Waiting longest', weather: 'Weather', planned: 'Planned', projects: 'Projects', routines: 'Routines', notes: 'Notes', people: 'People', ideas: 'Ideas', bills: 'Bills', gym: 'Gym', prompts: 'Prompts', business: 'Pipeline' };
const JV_STATIC = ['Plan my evening', 'What is overdue?', 'Start a focus block'];
const jvRow = (text, right, a, x) => `<button class="row" style="width:100%" ${a ? `data-a="${a}" data-x="${esc(x || '')}"` : ''}><span class="grow rt one">${esc(text)}</span>${right ? `<span class="lb">${esc(right)}</span>` : ''}</button>`;
function jvRows(kind) {
  const cut = (a, n) => a.slice(0, n), t0 = isoOff(0);
  const open_ = S.tasks.filter(t => !t.done);
  switch (kind) {
    case 'today': return cut(open_.filter(t => t.list === 'today' && t.day === 0), 6).map(t => jvRow(t.title, t.slot || (t.est ? fmtMin(t.est) : ''), 'seeTask', t.id));
    case 'planned': return cut(open_.filter(t => t.list === 'today' && t.day > 0).sort((a, b) => a.day - b.day), 6).map(t => jvRow(t.title, dayShort(t.day), 'seeTask', t.id));
    case 'backlog': return cut(open_.filter(t => t.list === 'backlog').sort((a, b) => b.ageDays - a.ageDays), 6).map(t => jvRow(t.title, t.ageDays + 'D', 'seeTask', t.id));
    case 'stale': return cut(open_.filter(t => t.ageDays >= 14).sort((a, b) => b.ageDays - a.ageDays), 6).map(t => jvRow(t.title, t.ageDays + 'D', 'seeTask', t.id));
    case 'habits': return cut(S.habits.filter(h => h.due && h.kind !== 'break'), 7).map(h => jvRow(h.name, habitKept(h) ? 'Done' : h.streak + 'D', 'jvTab', 'habits'));
    case 'routines': return cut(S.routines, 7).map(r => jvRow(r.title, routineDone(r) + '/' + r.steps.length, 'jvTab', 'habits'));
    case 'goals': return cut(S.goals.filter(g => g.status !== 'reached'), 6).map(g => jvRow(g.name, Math.round(goalPct(g) * 100) + '%', 'jvOpen', 'goals'));
    case 'calendar': return cut(MC.calendar.filter(e => e.day >= t0), 6).map(e => jvRow(e.title, (e.day === t0 ? '' : shortDayIso(e.day) + ' ') + (e.allDay ? 'All day' : e.start), 'jvOpen', 'calendar'));
    case 'focus': return [jvRow(fmtMin(focusMinToday()) + ' focused today', S.focus.sessions.length + ' blocks', 'jvOpen', 'focus'), jvRow('Last 7 days', fmtMinL(Math.round(S.focusWeek.reduce((a, d) => a + d.h, 0) * 60)), 'jvOpen', 'focus')];
    case 'weather': return MC.weather ? [jvRow(MC.weather.now + ' degrees, ' + MC.weather.sky, 'H ' + MC.weather.high + ' L ' + MC.weather.low, 'jvOpen', 'weather')] : [];
    case 'projects': return cut(MC.projects, 7).map(p => jvRow(p.name, p.open + ' open', 'jvProj', p.id));
    case 'notes': return cut(S.notes.filter(n => !n.done), 5).map(n => jvRow(n.title || 'Untitled', n.ago, 'seeNote', n.id));
    case 'people': return cut(overdue(), 6).map(p => jvRow(p.name, (p.lastDays - p.cadenceDays) + 'D late', 'jvOpen', 'people'));
    case 'ideas': return cut(S.ideas, 5).map(i => jvRow(i.title, i.done ? 'Done' : '', 'jvOpen', 'ideas'));
    case 'prompts': return cut(S.prompts.filter(p => !p.sent), 5).map(p => jvRow(p.text, p.kind, 'jvOpen', 'ideas'));
    case 'business': return cut(inPlay(), 6).map(p => jvRow(p.name, p.stage, 'jvOpen', 'people'));
    case 'bills': return S.bills ? cut(S.bills.items, 6).map(i => jvRow(i.name, kc(i.amount) + ' KC', 'jvOpen', 'bills')) : [];
    case 'gym': return [jvRow('Sessions this week', S.gym.target ? S.gym.week + '/' + S.gym.target : String(S.gym.week), 'jvOpen', 'gym')];
  }
  return [];
}
const shortDayIso = iso => { const d = new Date(iso + 'T12:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
function jvCard(kind) {
  if (!JV_LABEL[kind]) return '';
  const rows = jvRows(kind);
  return `<div class="jvcard">${lb(JV_LABEL[kind])}<div class="rows">${rows.join('') || '<div class="empty" style="padding:12px 0">Nothing here.</div>'}</div></div>`;
}
const jvDone = (d, ti, di) => `<div class="did ${d.ok ? '' : 'no'} ${d.undone ? 'undone' : ''}"><span class="lb">${ico(d.ok ? 'check' : 'close')}<span>${esc(d.text)}${d.undone ? ', reverted' : ''}</span></span>${d.needsActual && !d.undone ? `<button class="key xs t" data-a="jvLog" data-x="${esc(d.needsActual.taskId)}">How long?</button>` : ''}${d.ok && !d.undone && d.at && d.at.key && task(d.at.key) ? `<button class="key xs t" data-a="jvGo" data-x="${ti}:${di}">Open</button>` : ''}${d.undo && !d.undone ? `<button class="key xs t" data-a="jvUndo" data-x="${ti}:${di}">${ico('undo')} Undo</button>` : ''}</div>`;
function jvThread(st) {
  const out = st.turns.map((t, ti) => {
    if (t.who === 'you') return `<div class="msg you">${esc(t.text)}</div>`;
    const cards = (t.reply && t.reply.show ? [...new Set(t.reply.show.map(c => c.kind))] : []).slice(0, 3).map(jvCard).join('');
    const done = (t.done || []).map((d, di) => jvDone(d, ti, di)).join('');
    return `<div class="msg it">${esc(t.text)}${done}${cards}</div>`;
  });
  if (st.busy) out.push(st.live ? `<div class="msg it" id="jvlive">${esc(st.live)}</div>` : `<div class="msg it" id="jvlive"><span class="blink3"><i></i><i></i><i></i></span></div>`);
  if (st.err) out.push(`<div class="msg it err">${esc(st.err)}${st.errHint ? `<div class="lb" style="margin-top:8px">${esc(st.errHint)}</div>` : ''}${/Settings/.test(st.errHint || '') ? `<button class="key sm" style="margin-top:10px" data-a="openClassic" data-x="settings">${ico('gear')} Open Settings</button>` : ''}</div>`);
  if (!out.length) out.push(`<div class="msg it">Ask anything. I can add and move tasks, tick habits, log amounts, write notes and start a focus block.</div>`);
  return out.join('');
}
function jvChips(st) {
  const last = st.turns[st.turns.length - 1], next = last && last.who === 'it' && last.reply && last.reply.next ? last.reply.next.slice(0, 3) : [];
  const items = [...next.map(x => [x, x]), ...B.assistant.skills.map(k => [k.label, k.ask]), ...JV_STATIC.map(x => [x, x])];
  return items.map(([l, ask], i) => `<button class="chip" data-a="jvAsk" data-x="${i}" data-q="${esc(ask)}" data-l="${esc(l)}">${esc(l)}</button>`).join('');
}
let jvSig = '';
function jvPaint(e, force) {
  if (!e.el.isConnected) { e.jvOff && e.jvOff(); return; }
  const st = B.assistant.state(), face = $('#jvface', e.el); if (!face) return;
  const typing = !!($('#jvq', e.el) || {}).value, mic = B.assistant.mic.state() !== 'idle';
  if (st.turns.length > (e.jvN || 0) && st.turns[st.turns.length - 1].who === 'it') { e.jvTalk = Date.now() + 1800; setTimeout(() => jvPaint(e), 1900); }
  e.jvN = st.turns.length;
  const mode = st.busy && st.live ? 'talk' : st.busy ? 'think' : Date.now() < (e.jvTalk || 0) ? 'talk' : (typing || mic) ? 'listen' : 'idle';
  face.className = 'jface ' + mode + (st.err ? ' err' : '');
  $('#jvstat', e.el).innerHTML = { idle: 'Standing by', listen: mic ? 'Listening' : 'Reading', think: 'Thinking', talk: 'Speaking' }[mode] + (mode === 'think' || mode === 'listen' ? ' <span class="blink3"><i></i><i></i><i></i></span>' : '');
  const sig = st.turns.length + '|' + st.busy + '|' + (st.busy && st.live ? 1 : 0) + '|' + st.err + '|' + st.turns.map(t => (t.done || []).map(d => d.undone ? 1 : 0).join('')).join(',');
  const th = $('#jvthread', e.el), sc = $('.vsc', e.el), near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
  if (force || sig !== jvSig + e.id) { th.innerHTML = jvThread(st); $('#jvchips', e.el).innerHTML = jvChips(st); jvSig = sig + e.id; hydrate(th); }
  else { const lv = $('#jvlive', e.el); if (lv && st.live) lv.textContent = st.live; }
  $('#jvmic', e.el).classList.toggle('red', mic);
  $('#jvmic', e.el).innerHTML = mic ? '<span class="wave"><i></i><i></i><i></i><i></i></span>' : ico('mic');
  const send = $('#jvsend', e.el); send.disabled = st.busy;
  if (near || st.busy) sc.scrollTop = sc.scrollHeight;
}
V.jarvis = {
  title: 'Jarvis', live: false, noSwipeClose: true,
  render() {
    return `<div class="jface idle" id="jvface">${jvFace()}<div class="lb" id="jvstat"></div></div>
    <div class="thread" id="jvthread"></div>
    <div class="chips" id="jvchips"></div>
    <div class="hstack jask"><input class="fld" id="jvq" placeholder="Speak or type to Jarvis" enterkeyhint="send" autocomplete="off" data-enter="jvSend"><button class="kb" id="jvmic" data-a="jvMic" aria-label="Dictate"></button><button class="kb red" id="jvsend" data-a="jvSend" aria-label="Send">${ico('send')}</button></div>`;
  },
  after(el, a, fresh, e) {
    if (!e || e.jvOff) return;
    jvSig = '';
    const go = () => jvPaint(e), off1 = B.assistant.subscribe(go), off2 = B.assistant.mic.subscribe(go);
    e.jvOff = () => { off1(); off2(); }; e.onclose = e.jvOff;
    const q = $('#jvq', el); q.addEventListener('input', go);
    jvPaint(e, true);
    const sc = $('.vsc', el); sc.scrollTop = sc.scrollHeight;
  }
};
A.jvSend = () => { const e = top_(), q = $('#jvq', e.el), v = (q.value || '').trim(), st = B.assistant.state(); if (!v || st.busy) return; q.value = ''; B.assistant.send(v); jvPaint(e); };
A.jvAsk = (el) => { const st = B.assistant.state(); if (st.busy) return; B.assistant.send(el.dataset.q, el.dataset.l !== el.dataset.q ? el.dataset.l : undefined); };
A.jvMic = () => { const e = top_(), q = $('#jvq', e.el); if (!B.assistant.mic.available()) { toast('Dictation needs a Groq key or a browser that can listen'); return; } B.assistant.mic.toggle(q.value, t => { q.value = t; jvPaint(e); }); };
A.jvUndo = (el, x) => { const [ti, di] = x.split(':'); B.assistant.undo(+ti, +di); };
A.jvLog = (el, id) => { const t = task(id); if (t) howLong(t); };
A.jvGo = (el, x) => { const [ti, di] = x.split(':'), d = B.assistant.state().turns[+ti].done[+di]; if (d && d.at && d.at.key && task(d.at.key)) jumpTo(d.at.key); };
A.jvTab = (el, id) => tab(id);
A.jvProj = (el, id) => { S.ui.planProj = id; S.ui.planSeg = 'todo'; tab('plan'); };
A.jvOpen = (el, id) => { if (id === 'goals') { S.ui.hSeg = 'goals'; tab('habits'); } else open(id, id === 'people' ? { mode: 'personal' } : {}); };
/* ---------------- APPS DRAWER (root tab) ---------------- */
const DRAWER = [['today', 'clock', 'Today'], ['plan', 'plan', 'Plan'], ['habits', 'habits', 'Habits'], ['calendar', 'calendar', 'Calendar'], ['notes', 'note', 'Notes'], ['ideas', 'ideas', 'Ideas'], ['people', 'people', 'People'], ['bills', 'bills', 'Bills'], ['jar', 'jar', 'Jar'], ['health', 'heart', 'Health'], ['gym', 'dumbbell', 'Gym'], ['longevity', 'pulse', 'Longevity'], ['zone', 'zone', 'Zone'], ['focus', 'bolt', 'Focus'], ['projects', 'projects', 'Projects'], ['jarvis', 'face', 'Jarvis'], ['skills', 'skills', 'Skills'], ['watchless', 'eyeoff', 'Watchless'], ['weather', 'sun', 'Weather'], ['why', 'quote', 'The wall'], ['search', 'search', 'Search'], ['settings', 'gear', 'Settings']];
V.apps = {
  title: 'Apps', render() {
    const badge = { plan: openToday('all').length, habits: habitsDue('all').due - habitsDue('all').kept, people: overdue().length, bills: billsOverdue().length, ideas: S.prompts.filter(p => !p.sent).length };
    return `<div class="drawer">${DRAWER.map(([id, ic, l], i) => `<button class="dapp ${[1, 6, 8, 15].includes(i) ? 'k' : ''} ${id === 'bills' && badge.bills ? 'r' : ''}" data-a="drawerOpen" data-x="${id}">${icoBig(ic, 30)}<span class="dl">${l}</span>${badge[id] ? `<i class="bd">${badge[id]}</i>` : ''}</button>`).join('')}</div>
    <button class="key t wide" style="margin-top:16px" data-a="openClassic" data-x="apps">${ico('apps')} Embedded apps</button>`;
  }
};
A.drawerOpen = (el, id) => { if (id === 'plan' || id === 'habits') tab(id); else open(id); };
/* ---------------- SETTINGS: the look, and the way to everything else ---------------- */
V.settings = {
  title: 'Settings', render() {
    return `<div class="sl">Look</div><div class="cd tight rows">${MC.skins.map(k => `<button class="row" style="width:100%" data-a="skinPick" data-x="${k.id}"><span class="grow rt one">${esc(k.label)}</span>${k.id === MC.skin ? ico('check') : ''}</button>`).join('')}</div>
    <div class="cd tight rows"><div class="row"><span class="grow rt one">Dark mode</span><button class="tgl ${S.theme === 'dark' ? 'on' : ''}" data-a="themeTgl" aria-pressed="${S.theme === 'dark'}"><i></i></button></div></div>
    <div class="sl">Sync</div><div class="cd"><div class="hstack"><span class="xdot ${S.sync.state === 'saving' ? 'warn' : S.sync.state === 'error' ? 'alert' : 'ok'}"></span><div class="grow"><div class="rt one">${esc(S.sync.label)}</div><div class="rs">${esc(MC.device)}</div></div></div></div>
    <div class="sl">Keys on this device</div><div class="cd tight rows">${[['AI key', MC.keys.ai], ['Hevy key', MC.keys.hevy]].map(([k, v]) => `<div class="row"><span class="grow rt one">${k}</span><span class="lb">${v ? 'Set' : 'Not set'}</span></div>`).join('')}</div>
    <button class="key t wide" data-a="openClassic" data-x="settings">${ico('gear')} All settings</button>
    <div class="sl">This build</div><div class="cd"><div class="row"><span class="grow rt one">${esc(MC.build)}</span><button class="key xs t" data-a="reload">Reload</button></div></div>`;
  }
};
A.skinPick = (el, id) => { if (id === 'nothing-light' || id === 'nothing-dark') { const r = el.getBoundingClientRect(), ar = APP.getBoundingClientRect(); setTheme(id === 'nothing-dark' ? 'dark' : 'light', r.left - ar.left + r.width / 2, r.top - ar.top + r.height / 2); } else B.setSkin(id); };
A.themeTgl = (el) => { const r = el.getBoundingClientRect(), ar = APP.getBoundingClientRect(); setTheme(S.theme === 'dark' ? 'light' : 'dark', r.left - ar.left + r.width / 2, r.top - ar.top + r.height / 2); };
A.reload = () => location.reload();

/* ---------------- DAILY REVIEW: a card stack you swipe through ---------------- */
function openDaily() {
  if (top_().id === 'daily') return;
  const r = S.ui.dvSnap = { ...MC.dailyReview, quit: S.quitting.map(q => ({ id: q.id, name: q.name, daysClean: q.daysClean })) };
  S.daily = { forgot: r.forgot.map(() => false), left: r.notDone.map(() => null), quit: r.quit.map(() => null), log: {} };
  S.ui.dv = 0; open('daily');
}
A.openDaily = openDaily;
const DV_N = 6;
/* ---- goals: every kind gets the control that fits it ---- */
const AMT_UNIT = /^(czk|kc|kč|eur|usd|gbp|\$|€|£)$/i;
const goalKind = g => g.habitLinked ? 'habit' : g.milestones && g.milestones.length ? 'steps' : g.target <= 1 ? 'yesno' : AMT_UNIT.test((g.unit || '').trim()) || g.target >= 100 ? 'amount' : 'count';
const fmtAmt = n => { const [i, d] = String(Math.round(n * 100) / 100).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? ',' + d : ''); };
const niceN = x => { if (x <= 1) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
const amtPresets = g => [...new Set([.01, .05, .1].map(f => niceN(g.target * f)))].filter(v => v >= 1);
function dvGoalBlock(n) {
  const g = S.goals.find(x => x.id === n.id); if (!g) return '';
  const kind = goalKind(g), unit = (g.unit || '').toUpperCase();
  const done = g.milestones ? g.milestones.filter(m => m.done).length : g.current, tot = g.milestones ? g.milestones.length : g.target;
  const pct = clamp(tot ? done / tot : 0, 0, 1), reached = tot && done >= tot;
  const bar = drow(20, Math.round(pct * 20), { gap: 8, r: 2.3, red: g.status === 'push', fill: true, k: 'dg' + g.id });
  let stat, ctl = '';
  if (kind === 'steps') {
    stat = `${done} OF ${tot} STEPS`;
    ctl = `<div class="dvms">${g.milestones.map(m => `<div class="row">${ck(m.done, `data-a="dvMs" data-x="${esc(g.id)}:${esc(m.id)}" aria-label="${esc(m.title)}"`)}<span class="grow rt ${m.done ? 'done' : ''}">${esc(m.title)}</span></div>`).join('')}</div>`;
  } else if (kind === 'yesno') {
    stat = reached ? 'YES, DONE' : 'NOT YET';
    ctl = `<div class="dvacts"><button class="key ${reached ? '' : 't'}" data-a="dvYes" data-x="${esc(g.id)}:yes" aria-pressed="${!!reached}">Yes</button><button class="key ${reached ? 't' : ''}" data-a="dvYes" data-x="${esc(g.id)}:no" aria-pressed="${!reached}">Not yet</button></div>`;
  } else if (kind === 'amount') {
    const left = Math.max(0, g.target - g.current), last = (S.daily.log[g.id] || []).slice(-1)[0];
    stat = `${fmtAmt(g.current)} OF ${fmtAmt(g.target)} ${unit}`.trim() + (left ? `, ${fmtAmt(left)} LEFT` : ', REACHED');
    ctl = `<div class="chips dvpre">${amtPresets(g).map(v => `<button class="chip" data-a="dvAmt" data-x="${esc(g.id)}:${v}">+${fmtAmt(v)}</button>`).join('')}</div>
      <div class="hstack dvcust"><input class="fld dvamt" data-g="${esc(g.id)}" data-f="amt" inputmode="decimal" placeholder="Other amount" aria-label="Amount" autocomplete="off"><input class="fld dvnote" data-g="${esc(g.id)}" data-f="note" placeholder="Note" aria-label="Note" maxlength="60" autocomplete="off"><button class="key" data-a="dvAmt" data-x="${esc(g.id)}:custom">Log</button></div>
      ${last ? `<div class="hstack" style="margin-top:8px"><span class="lb grow">Logged +${fmtAmt(last.v)}</span><button class="key xs t" data-a="dvAmtUndo" data-x="${esc(g.id)}">${ico('undo')} Undo</button></div>` : ''}`;
  } else if (kind === 'count') {
    stat = `${g.current} OF ${g.target} ${unit}`.trim();
    ctl = `<div class="dvstep"><button class="kb" data-a="dvStep" data-x="${esc(g.id)}:-1" aria-label="One less" ${g.current <= 0 ? 'disabled' : ''}>${ico('minus')}</button><div class="grow lb fg" style="text-align:center">${esc(stat)}</div><button class="kb" data-a="dvStep" data-x="${esc(g.id)}:1" aria-label="One more" ${g.current >= g.target ? 'disabled' : ''}>${ico('plus')}</button></div>`;
  } else {
    stat = `${g.current} OF ${g.target} ${unit}`.trim();
    ctl = `<div class="lb">Fills from ${esc(g.habitName || 'its habit')}</div>`;
  }
  return `<div class="dvg"><div class="rt" style="font-weight:700">${esc(g.name)}</div><div class="rs" style="margin-bottom:8px"><span class="${g.status === 'push' && !reached ? 'red' : ''}">${stat}</span></div>${bar}<div class="dvgc">${ctl}</div></div>`;
}
V.daily = {
  title: 'Yesterday', noSwipeClose: true, live: false, backAct: 'dvPrev',
  action: () => `<button class="kb" data-a="dvClose" aria-label="Close">${ico('close')}</button>`,
  render() {
    const r = S.ui.dvSnap, i = S.ui.dv || 0, d = S.daily;
    const open_ = d.forgot.filter(x => !x).length + d.left.filter(x => !x).length;
    const cards = [
      `<div class="dvh">${lb(r.yesterday)}<div class="d1" style="font-size:34px;margin:12px 0 0">Yesterday</div></div>
       <div class="dvmid"><div class="dvring">${dring({ n: 48, on: r.habitsPct / 100 * 48, size: 240, r: 3.3, pad: 10, cls: 'wring', k: 'dvr' })}<div class="wcenter"><div style="display:grid;justify-items:center;gap:8px">${dm(r.habitsPct + '%', 5.4, { k: 'dvp', count: true })}${lb('Habits kept')}</div></div></div></div>
       <div class="facts"><div>${lb('Finished')}<b>${r.finished}</b></div><div>${lb('Habits')}<b>${r.habits}</b></div><div>${lb('Focus')}<b>${fmtMin(r.focusedMin)}</b></div><div>${lb('Routines')}<b>${r.routines}</b></div></div>`,
      `<div class="dvh">${lbRow('Forgot to tick?', d.forgot.filter(x => !x).length + ' open')}</div><div class="dvb rows">${r.forgot.map((f, k) => `<div class="row">${ck(d.forgot[k], `data-a="dvForgot" data-x="${k}" ${d.forgot[k] ? 'disabled' : ''}`)}<span class="grow rt">${esc(f.name)}</span></div>`).join('') || '<div class="empty dvempty">Nothing was left unticked.</div>'}</div>`,
      `<div class="dvh">${lbRow('Did not get done', r.notDone.length + '', 'red')}</div><div class="dvb rows">${r.notDone.map((t, k) => `<div class="row dvrow"><span class="rt">${esc(t.title)}</span>${d.left[k] ? `<span class="lb fg">${{ today: 'Carried to today', keep: 'Left on the list', drop: 'Dropped' }[d.left[k]]}</span>` : `<div class="dvacts"><button class="key sm" data-a="dvLeft" data-x="${k}:today">Today</button><button class="key sm t" data-a="dvLeft" data-x="${k}:keep">Keep</button><button class="key sm t" data-a="dvLeft" data-x="${k}:drop">Drop</button></div>`}</div>`).join('') || '<div class="empty dvempty">Everything planned got done, or went back on purpose.</div>'}</div>`,
      `<div class="dvh">${lbRow('Goals', r.goals.length ? r.goals.length + ' this period' : '')}</div><div class="dvb">${r.goals.map(dvGoalBlock).join('') || '<div class="empty dvempty">No goals are running this period.</div>'}</div>`,
      `<div class="dvh">${lb('Quitting')}</div><div class="dvb rows">${r.quit.map((q, k) => `<div class="row dvrow"><div><div class="rt">${esc(q.name)}</div><div class="rs">${q.daysClean} ${q.daysClean === 1 ? 'day' : 'days'} clean</div></div>${d.quit[k] ? `<span class="lb ${d.quit[k] === 'slip' ? 'red' : 'fg'}">${d.quit[k] === 'slip' ? 'Slipped' : 'Clean'}</span>` : `<div class="dvacts"><button class="key sm" data-a="dvQuit" data-x="${k}:clean">Clean</button><button class="key sm t" data-a="dvQuit" data-x="${k}:slip">Slipped</button></div>`}</div>`).join('') || '<div class="empty dvempty">Nothing on the Quitting list.</div>'}</div>`,
      `<div class="dvmid" style="text-align:center"><div>${icoBig('sunrise', 90)}<div class="d1" style="font-size:30px;margin:22px 0 12px">Start the day</div><div class="wt" style="color:var(--fd)">${open_ ? open_ + ' still open, that is fine.' : 'All answered.'}</div></div></div><button class="key red wide" style="height:58px;flex:none" data-a="dvDone">Done, start the day</button>`
    ];
    return `<div class="dvdots">${cards.map((c, k) => `<i class="${k === i ? 'on' : ''} ${k < i ? 'past' : ''}"></i>`).join('')}</div>
    <div class="dvstack">${cards.map((c, k) => `<div class="dv-card cd ${k === 0 || k === 5 ? 'k' : ''}" data-k="${k}" style="${dvStyle(k, i)}">${c}</div>`).join('')}</div>
    <div class="hstack dvctl"><button class="key t" data-a="dvPrev" aria-label="Previous card" ${i === 0 ? 'disabled' : ''}>${ico('back')}</button><span class="grow lb" style="text-align:center">${i + 1} of ${DV_N}</span><button class="key" data-a="dvNext" aria-label="Next card" ${i === DV_N - 1 ? 'disabled' : ''}>${ico('fwd')}</button></div>`;
  }
};
/* At rest only the current card is on screen and it has no transform at all. The next one is only shown while a card is being dragged. */
function dvStyle(k, i) { const o = k - i; if (o < 0) return 'transform:translateX(-110%);opacity:0;pointer-events:none;z-index:1'; if (o === 0) return 'transform:none;opacity:1;z-index:10'; return `transform:scale(.96);opacity:0;pointer-events:none;z-index:${10 - o}`; }
function dvGo(n) {
  S.ui.dv = clamp(n, 0, DV_N - 1); const e = top_(); if (e.id !== 'daily') return;
  $$('.dv-card', e.el).forEach(c => { c.style.cssText = dvStyle(+c.dataset.k, S.ui.dv); if (+c.dataset.k === S.ui.dv) c.scrollTop = 0; });
  $$('.dvdots i', e.el).forEach((d, k) => { d.classList.toggle('on', k === S.ui.dv); d.classList.toggle('past', k < S.ui.dv); });
  $$('[data-a="dvPrev"]', e.el).forEach(b => b.disabled = S.ui.dv === 0); $$('[data-a="dvNext"]', e.el).forEach(b => b.disabled = S.ui.dv === DV_N - 1);
  const c = $('.dvctl .grow', e.el); if (c) c.textContent = (S.ui.dv + 1) + ' of ' + DV_N;
}
A.dvNext = () => dvGo((S.ui.dv || 0) + 1);
A.dvPrev = () => dvGo((S.ui.dv || 0) - 1);
addRec({
  axis: 'x', test(st) {
    const c = st.target.closest && st.target.closest('.dv-card'); if (!c || st.target.closest('input,.chips,.dvms')) return null;
    const k = +c.dataset.k, nx = $(`.dv-card[data-k="${k + 1}"]`, c.parentNode);
    c.style.transition = 'none'; if (nx) { nx.style.transition = 'none'; nx.style.opacity = 1; }
    return {
      move(dx) { c.style.transform = `translateX(${Math.min(0, dx)}px)`; },
      end(dx, dy, vx) { const i = S.ui.dv || 0; if ((dx < -80 || vx < -.4) && i < DV_N - 1) dvGo(i + 1); else if ((dx > 80 || vx > .4) && i > 0) dvGo(i - 1); else dvGo(i); }
    };
  }
});
/* Re-render in place, keeping each card's scroll and whatever is typed in the amount fields. */
const dvRe = () => {
  const e = top_(); if (e.id !== 'daily') return;
  const keep = {}, vals = {}; $$('.dv-card', e.el).forEach(c => { keep[c.dataset.k] = c.scrollTop; });
  $$('input[data-g]', e.el).forEach(f => { vals[f.dataset.g + f.dataset.f] = f.value; });
  renderBody(e, false);
  $$('.dv-card', e.el).forEach(c => { c.scrollTop = keep[c.dataset.k] || 0; });
  $$('input[data-g]', e.el).forEach(f => { const v = vals[f.dataset.g + f.dataset.f]; if (v != null) f.value = v; });
};
const dvAfter = () => afterUpdate(dvRe);
A.dvForgot = (el, k) => { const r = S.ui.dvSnap, it = r.forgot[+k]; S.daily.forgot[+k] = true; if (it.routine) B.store().assertRoutineOn(it.id, r.day, true); else B.store().markHabitOn(it.id, r.day, true); dvRe(); };
A.dvLeft = (el, x) => { const [k, v] = x.split(':'), t = S.ui.dvSnap.notDone[+k]; S.daily.left[+k] = v; if (v === 'today') B.store().moveTasksToToday([t.id]); if (v === 'drop') { B.store().deleteTask(t.id); undoable('Dropped: ' + t.title, () => { B.store().undoDelete(); S.daily.left[+k] = null; dvRe(); }); } dvRe(); };
A.dvMs = (el, x) => { const [gid, mid] = x.split(':'); B.store().toggleGoalMilestone(gid, mid); dvAfter(); };
A.dvYes = (el, x) => { const [gid, v] = x.split(':'), g = S.goals.find(z => z.id === gid), done = g.current >= g.target; if (v === 'yes' && !done) B.store().bumpGoal(gid, Math.max(1, g.target - g.current)); else if (v === 'no' && done) B.store().bumpGoal(gid, -g.current); dvAfter(); };
A.dvStep = (el, x) => { const [gid, n] = x.split(':'); B.store().bumpGoal(gid, +n); dvAfter(); };
const dvField = (gid, f) => $$('input[data-g]').find(i => i.dataset.g === gid && i.dataset.f === f);
A.dvAmt = (el, x) => {
  const [gid, v] = x.split(':'); let n = +v, note = '';
  if (v === 'custom') { const f = dvField(gid, 'amt'); n = parseFloat(String(f.value).replace(/[\s ]/g, '').replace(',', '.')); note = (dvField(gid, 'note').value || '').trim(); if (!(n > 0)) { toast('Type an amount first'); return; } }
  const eid = B.store().logGoalAmount(gid, n, note);
  S.daily.log[gid] = [...(S.daily.log[gid] || []), { eid, v: n }];
  if (v === 'custom') { dvField(gid, 'amt').value = ''; dvField(gid, 'note').value = ''; }
  dvAfter();
};
A.dvAmtUndo = (el, gid) => { const l = S.daily.log[gid] || [], last = l.pop(); if (!last) return; B.store().removeGoalEntry(gid, last.eid); dvAfter(); };
ROOT.addEventListener('input', e => { const f = e.target; if (f && f.matches && f.matches('input.dvamt')) { const raw = f.value.replace(/[^\d.,]/g, ''), [i, ...d] = raw.split(/[.,]/); f.value = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d.length ? ',' + d.join('').slice(0, 2) : /[.,]$/.test(raw) ? ',' : ''); } });
A.dvQuit = (el, x) => { const [k, v] = x.split(':'), r = S.ui.dvSnap; S.daily.quit[+k] = v; if (v === 'slip') { B.store().logSlipOn(r.quit[+k].id, r.day); undoable('Slip logged', () => { B.store().undoDelete(); S.daily.quit[+k] = null; dvRe(); }); } dvRe(); };
A.dvDone = () => { B.store().closeDaily(true); back(); toast('Have a good day'); };
A.dvClose = () => { B.store().closeDaily(false); back(); };

/* ---- 60-boot.js ---- */
/* =====================================================================
   Boot
   ===================================================================== */
if (FRAME) APP.classList.add('frame');
sbar();
measureCell();
R.home(); R.dock(); R.cc();
setInterval(tick, 1000); tick();
window.addEventListener('resize', () => { const c = CELL; measureCell(); if (c !== CELL) R.home(); });
/* the daily review opens itself once, shortly after load */
if (!NOREVIEW) setTimeout(() => { if (!S.dailyDone && top_().id === 'home') openDaily(); }, 1400);



return {
  update(mc) { loadMC(mc); HOST.dataset.theme = mc.theme; refresh(); requestAnimationFrame(() => { AFTER.splice(0).forEach(fn => fn()); const e = STACK.find(x => x.id === 'jarvis'); if (e) jvPaint(e, true); }); },
  unmount() {
    dead = true;
    TM.forEach(id => window.clearTimeout(id)); IV.forEach(id => window.clearInterval(id)); RAF.forEach(id => window.cancelAnimationFrame(id));
    WINL.forEach(([t, f, o]) => window.removeEventListener(t, f, o));
    ROOT.innerHTML = '';
  }
};
}
