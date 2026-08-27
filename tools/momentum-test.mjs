/* THE MOMENTUM MODEL, TESTED.

   The wheel is the one thing on the Timeline that no screenshot can check: it
   is arithmetic replayed over a log, and a weight that is quietly wrong looks
   exactly like a weight that is right. Two real defects were caught here rather
   than on the page.

     THE 50% WIPE NEVER FIRED. It tested points EARNED, and the model then had a
     passive source -- a break habit is earned by not doing something, which on a
     day he did nothing at all he satisfies by definition. A completely empty day
     therefore still scored, and the harshest rule in the model was unreachable.
     Break habits are gone now, on his instruction, and the wipe tests an empty
     day directly.

     THE BASELINE ASKED FOR EVERY DAILY HABIT. He tracks more than forty, so a
     genuinely good day scored a seventh of the bar and the wheel read ZERO on
     thirty days of real effort. "thirty good days does not read zero" is that
     bug, kept.

   The module is pure and takes its clock as an argument, so this needs no
   browser, no network and no fixed date. Run it with `node tools/momentum-test.mjs`.
*/
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'mom-'))
await build({ entryPoints: [new URL('../src/momentum.ts', import.meta.url).pathname], bundle: true, format: 'esm',
  outfile: join(dir, 'm.mjs'), external: ['react', 'react-dom'] })
const M = await import(join(dir, 'm.mjs'))

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message) } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ?? ''} ${a} !== ${b}`) }
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error(`${m ?? ''} ${a} not near ${b}`) }

const D = (n) => { const d = new Date(2026, 7, 27); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const TODAY = new Date(2026, 7, 27)
const habits = Array.from({ length: 42 }, (_, i) => ({ id: 'h' + i, name: 'h' + i, kind: 'build', frequency: 'daily', days: [], space: 'personal' }))
const inView = () => true

function run(opts = {}) {
  const { fullDays = 0, tasksPerDay = 3, habitsPerDay = 5, focusPerDay = 120, hard = false, days = 10, skip = 0 } = opts
  const habitLog = [], tasks = [], focusSessions = []
  for (let i = skip; i < skip + fullDays; i++) {
    const day = D(i)
    for (let h = 0; h < habitsPerDay; h++) habitLog.push({ habitId: 'h' + h, day })
    for (let k = 0; k < tasksPerDay; k++) tasks.push({ id: `t${i}-${k}`, title: 'task', done: true, doneAt: `${day}T12:00:00`, space: 'personal', createdAt: day })
    if (focusPerDay) focusSessions.push({ id: 'f' + i, day, minutes: focusPerDay, space: 'personal' })
    if (hard) tasks.push({ id: `hd${i}`, title: 'The Moneta letter', done: true, doneAt: `${day}T18:00:00`, space: 'personal', createdAt: D(i + 14) })
  }
  return M.momentumRun({ habits, habitLog, tasks, focusSessions, inView }, days, TODAY)
}

t('baseline is fixed and reachable, not 42 habits', () => {
  const r = run({ fullDays: 1 })
  eq(r[r.length - 1].baseline, 5 * 10 + 3 * 6 + 12 * 4 + 12, 'baseline')
})
t('a full day including the hard thing hits ratio 1', () => {
  /* Two ordinary tasks plus the old one is three: exactly the target. */
  const r = run({ fullDays: 1, tasksPerDay: 2, hard: true })
  eq(r[r.length - 1].earned, 128)
  eq(r[r.length - 1].ratio, 1)
})
t('a full day without the hard thing does not hit 1', () => {
  const r = run({ fullDays: 1 })
  if (r[r.length - 1].ratio >= 1) throw new Error('no hard thing still scored a full day')
})
t('a task finished the day it appeared is not a hard thing', () => {
  const r = run({ fullDays: 1 })
  if (r[r.length - 1].hard) throw new Error('same-day task counted as hard')
})
t('the oldest finished task is the hard thing', () => {
  const r = run({ fullDays: 1, hard: true })
  eq(r[r.length - 1].hard.title, 'The Moneta letter')
  eq(r[r.length - 1].hard.waited, 14)
})
t('a task with no createdAt is never a hard thing', () => {
  const day = D(0)
  const r = M.momentumRun({ habits, habitLog: [], focusSessions: [],
    tasks: [{ id: 'x', title: 'imported', done: true, doneAt: `${day}T09:00:00`, space: 'personal' }], inView }, 3, TODAY)
  if (r[r.length - 1].hard) throw new Error('a task with no birthday was called old')
})
t('EMPTY DAY HALVES THE WHEEL', () => {
  /* Thirty full days, then four days of nothing running up to today. */
  const r = run({ fullDays: 30, hard: true, days: 40, skip: 4 })
  const good = r[r.length - 5]
  const empty = r[r.length - 1]
  eq(empty.empty, true, 'today should be empty')
  near(empty.momentum, good.momentum * Math.pow(M.FRICTION * M.EMPTY_WIPE, 4), 0.5, 'four empty days')
})
t('the wipe fires on the first empty day', () => {
  const r = run({ fullDays: 20, hard: true, days: 30, skip: 1 })
  const last = r[r.length - 1]
  const prev = r[r.length - 2]
  eq(last.empty, true)
  near(last.momentum, prev.momentum * M.FRICTION * M.EMPTY_WIPE, 0.01)
})
t('thirty good days does not read zero', () => {
  const r = run({ fullDays: 30, hard: true, days: 30 })
  if (M.momentumNow(r) < 40) throw new Error('thirty full days read ' + M.momentumNow(r))
})
t('momentum never exceeds the ceiling', () => {
  const r = run({ fullDays: 200, hard: true, days: 200 })
  if (M.momentumNow(r) > M.CEILING) throw new Error('over ceiling')
})
t('sources are capped: ten tasks score five', () => {
  const a = run({ fullDays: 1, tasksPerDay: 5 })
  const b = run({ fullDays: 1, tasksPerDay: 10 })
  eq(a[a.length - 1].parts.tasks, b[b.length - 1].parts.tasks)
})
t('focus is capped at four hours', () => {
  const a = run({ fullDays: 1, focusPerDay: 240 })
  const b = run({ fullDays: 1, focusPerDay: 600 })
  eq(a[a.length - 1].parts.focus, b[b.length - 1].parts.focus)
})
t('the curve charges for under a quarter of a day', () => {
  eq(M.curveFor(0.1) < 0, true)
  eq(M.curveFor(1) > 0, true)
})

/* ---- the chain ---- */
t('chain counts consecutive kept days', () => {
  const r = run({ fullDays: 6, hard: true, days: 20 })
  eq(M.chainOf(r).current, 6)
})
t('an empty today does not break the chain', () => {
  const habitLog = [], tasks = [], focusSessions = []
  for (let i = 1; i <= 6; i++) {
    const day = D(i)
    for (let h = 0; h < 5; h++) habitLog.push({ habitId: 'h' + h, day })
    focusSessions.push({ id: 'f' + i, day, minutes: 120, space: 'personal' })
  }
  const r = M.momentumRun({ habits, habitLog, tasks, focusSessions, inView }, 20, TODAY)
  const c = M.chainOf(r)
  eq(c.current, 6, 'chain should survive an unfinished today')
  eq(c.todayPending, true)
})
t('toBeat is how many more days beat the record', () => {
  const r = run({ fullDays: 3, hard: true, days: 20 })
  const c = M.chainOf(r)
  eq(c.toBeat, Math.max(0, c.longest - c.current + 1))
})
t('no data means no chain and no record', () => {
  const c = M.chainOf(M.momentumRun({ habits, habitLog: [], tasks: [], focusSessions: [], inView }, 20, TODAY))
  eq(c.current, 0); eq(c.longest, 0)
})

/* ---- roll-ups ---- */
t('a week rolls up as total over total, not a mean of ratios', () => {
  const r = run({ fullDays: 30, hard: true, days: 34 })
  const wk = M.rollUp(r, 'w')
  for (const p of wk) {
    const e = p.days.reduce((a, d) => a + d.earned, 0)
    const b = p.days.reduce((a, d) => a + d.baseline, 0)
    near(p.ratio, e / b, 1e-9, 'week ratio')
  }
})
t('roll-up keeps every day exactly once', () => {
  const r = run({ fullDays: 30, hard: true, days: 60 })
  for (const z of ['w', 'm']) {
    const n = M.rollUp(r, z).reduce((a, p) => a + p.days.length, 0)
    eq(n, r.length, 'zoom ' + z)
  }
})
t('month momentum is the last day of the month, not an average', () => {
  const r = run({ fullDays: 40, hard: true, days: 70 })
  for (const p of M.rollUp(r, 'm')) {
    eq(p.momentum, p.days[0].momentum, 'newest-first days[0] is the last day')
  }
})
t('days zoom is one period per day', () => {
  const r = run({ fullDays: 5, days: 12 })
  eq(M.rollUp(r, 'd').length, r.length)
})
t('a week with blank days reads worse than one without', () => {
  const good = M.rollUp(run({ fullDays: 14, hard: true, days: 13 }), 'w')
  const patchy = M.rollUp(run({ fullDays: 14, hard: true, tasksPerDay: 0, habitsPerDay: 1, days: 13 }), 'w')
  if (!(good[0].ratio > patchy[0].ratio)) throw new Error('patchy week did not read worse')
})

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
