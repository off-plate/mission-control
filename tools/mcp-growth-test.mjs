/* The Claude connector's GROWTH area: habits, quitting habits, routines, slips, amounts and counts.
   `ZOD_PATH=<zod/index.js> node tools/mcp-growth-test.mjs`

   Three layers, because "faithful port" is a claim that needs proof:
   1. DIFFERENTIAL. The app's REAL useGrowthSlice hook (src/store/growth.ts) is run on the same starting
      state under a tiny synchronous React (batched setState, like an event handler), and every log, habit
      and routine row plus every tombstone it produces is compared with what ops-growth.ts produces.
      Run under four clocks (Monday, Wednesday, Sunday, an ISO year-end Friday).
   2. RULES. Every refusal, the exact rows, burial on deletes, the safety stop message.
   3. MERGE + REGISTRY. The app's real mergeStates keeps the result and does not resurrect deletions;
      every tool is registered through the real registration path and validated by real zod.
   `process.env.TZ` and `Date` are pinned: both sides read the same clock. */
import assert from 'assert/strict'
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import { loadKit, clone, ROOT } from './mcp-test-kit.mjs'

process.env.TZ = 'Europe/Prague'

/* ---------- a clock both sides share ---------- */
const RealDate = Date
const clock = { t: RealDate.parse('2026-11-11T09:00:00Z') }
globalThis.Date = class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock.t); else super(...a) }
  static now() { return clock.t }
}
const setNow = (iso) => { clock.t = RealDate.parse(iso) }

/* ---------- the modules under test ---------- */
const K = await loadKit({
  modules: ['tools-growth.ts', 'ops-growth.ts', 'tools-core.ts'],
  extra: [
    "export { periodKeyFor as appPeriodKeyFor, isoWeekKey as appIsoWeekKey, habitPeriodRange as appPeriodRange, dayOfWeekKey as appDayOfWeekKey } from './src/util.ts'",
    "export { routineComplete as appRoutineComplete, requiredSteps as appRequiredSteps, dueOn as appDueOn, habitTarget as appHabitTarget, currentStreak as appCurrentStreak, bestStreak as appBestStreak, daysClean as appDaysClean, bestCleanRun as appBestCleanRun, slipCount as appSlipCount, keptThisPeriod as appKeptThisPeriod, countIn as appCountIn, habitLocked as appHabitLocked, stepLocked as appStepLocked } from './src/types/habits.ts'",
  ],
})
const { M, fixture, stateDb, fakeServer, refuses } = K
const G = M.ops_growth

/* ---------- the app's real hook under a synchronous, batching React ---------- */
const stub = `
let cur = null
export function __render(inst, fn) { inst.i = 0; cur = inst; try { return fn() } finally { cur = null } }
export function __flush(inst) {
  for (let guard = 0; guard < 50; guard++) {
    let any = false
    for (const s of inst.slots) { if (s.q && s.q.length) { any = true; const q = s.q; s.q = []; for (const u of q) s.v = typeof u === 'function' ? u(s.v) : u } }
    if (!any) return
  }
}
export function useState(init) {
  const inst = cur
  let s = inst.slots[inst.i]
  if (!s) { s = inst.slots[inst.i] = { v: typeof init === 'function' ? init() : init, q: [], set: null }; s.set = (u) => { s.q.push(u) } }
  inst.i++
  return [s.v, s.set]
}
export function useMemo(fn, deps) {
  const inst = cur
  let s = inst.slots[inst.i]
  if (!s || !deps || !s.deps || deps.some((d, k) => d !== s.deps[k])) s = inst.slots[inst.i] = { v: fn(), deps, memo: true }
  inst.i++
  return s.v
}
`
const hookBundle = await build({
  stdin: { contents: "export { useGrowthSlice } from './src/store/growth.ts'\nexport { __render, __flush } from 'react'\nexport { rowKey } from './src/sync-merge.ts'", resolveDir: ROOT, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'react-stub', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' })) } }],
})
const H = await import(`data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString('base64')}`)

/** A store: the real hook, persisted state in, one `act` = one batched event. */
function appStore(blob) {
  const persisted = clone({
    habits: blob.habits ?? [], goals: blob.goals ?? [], routines: blob.routines ?? [], records: blob.records ?? {}, removedSeeds: blob.removedSeeds ?? [],
    habitLog: blob.habitLog ?? [], routineLog: blob.routineLog ?? [], slips: blob.slips ?? [], stepLog: blob.stepLog ?? [], stepTicks: blob.stepTicks ?? [], dayLog: [],
  })
  const inst = { slots: [], i: 0 }
  const grave = new Map()
  const deps = {
    space: 'personal', armUndo(_label, restore) { store.undo = restore }, setPageState() {},
    bury: (...ks) => { for (const k of ks) grave.set(k, false) },
    digUp: (...ks) => { for (const k of ks) grave.set(k, true) },
  }
  for (const t of blob.graveyard ?? []) grave.set(t.k, !!t.undone)
  const store = { undo: null }
  let api
  const render = () => { api = H.__render(inst, () => H.useGrowthSlice(persisted, deps)) }
  render()
  return {
    store,
    async act(fn) { fn(api); await Promise.resolve(); await Promise.resolve(); H.__flush(inst); await Promise.resolve(); await Promise.resolve(); render() },
    get api() { return api },
    snapshot() { return normalise({ goals: api.goals, habits: api.habits, routines: api.routines, habitLog: api.habitLog, routineLog: api.routineLog, stepTicks: api.stepTicks, stepLog: api.stepLog, slips: api.slips, records: api.records, removedSeeds: api.removedSeeds }, grave) },
  }
}
/** log rows are a set (the merge unions them by identity); compare them in a canonical order */
const sortLogs = (r) => { for (const f of ['habitLog', 'routineLog', 'stepTicks', 'stepLog', 'slips']) if (Array.isArray(r[f])) r[f].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)); return r }
/** Strip what legitimately differs (the clock moment, generated suffixes) and sort keys, so deepEqual means "same rows". */
function normalise(o, grave) {
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x))
    if (v && typeof v === 'object') { const out = {}; for (const k of Object.keys(v).sort()) { if (k === 'at' || k === 'startedAt' || v[k] === undefined) continue; out[k] = walk(v[k], k) } return out }
    if (key === 'src' && typeof v === 'string') return v.replace(/^(count|amt)#.*/, '$1#')
    return v
  }
  const r = walk(JSON.parse(JSON.stringify(o)))
  sortLogs(r)
  r.grave = Object.fromEntries([...grave].filter(([k]) => !/^(count|amt)#/.test(k)).map(([k, u]) => [k.replace(/\|(count|amt)#.*$/, '|$1#'), u]).sort(([a], [b]) => (a < b ? -1 : 1)))
  return r
}
function opsSnapshot(b) {
  const grave = new Map()
  for (const t of b.graveyard ?? []) grave.set(t.k, !!t.undone)
  return normalise({ goals: b.goals ?? [], habits: b.habits ?? [], routines: b.routines ?? [], habitLog: b.habitLog ?? [], routineLog: b.routineLog ?? [], stepTicks: b.stepTicks ?? [], stepLog: b.stepLog ?? [], slips: b.slips ?? [], records: b.records ?? {}, removedSeeds: b.removedSeeds ?? [] }, grave)
}

/** Run `app(store)` on the real hook and `ops(blob)` on the port from the same start; deepEqual the results. */
async function same(label, start, app, ops, known) {
  const s = appStore(start)
  await s.act(app)
  const b = clone(start)
  ops(b)
  let mine = opsSnapshot(b)
  if (known) mine = sortLogs(known(mine))
  assert.deepEqual(mine, s.snapshot(), `differential: ${label}`)
  return b
}
/** The port digs up a backfilled day only when it already holds a tombstone for it (setLog in ops-growth.ts: a multi-year backfill must not
 *  push real tombstones out of the 900-entry graveyard). The app digs up every one, so this adds those entries to the port's snapshot. */
const appDigsSince = (snap) => { const o = JSON.parse(JSON.stringify(snap)); for (const x of o.habitLog) if (x.src === 'since') o.grave[`habitLog:${x.habitId}|${x.day}|since`] = true; return o }
/** The ONE place the port deliberately differs from the app (see the header of ops-growth.ts): when a routine
 *  tick finishes the routine, applyRoutine writes the step's habit row and then markDay() overwrites the whole
 *  habit log from a copy taken BEFORE that row, so the app loses the last step's habit row and buries it. The
 *  port keeps it. This maps the port's snapshot to what the app would have, so everything else is still compared. */
const appLosesStepRows = (...rows) => (snap) => {
  const o = JSON.parse(JSON.stringify(snap))
  for (const [habitId, src] of rows) {
    o.habitLog = o.habitLog.filter((x) => !(x.habitId === habitId && x.src === src))
    o.grave[`habitLog:${habitId}|${TODAY()}|${src}`] = false
  }
  return o
}

/* ---------- fixtures, dated relative to the pinned clock ---------- */
const TODAY = () => M.dateKey()
const D = (n) => G.addDays(TODAY(), n)
const WEEK = [false, false, false, false, false, false, false]
const habit = (id, name, extra = {}) => ({ id, space: 'personal', name, days: [...WEEK], paused: false, history: [], ...extra })
/** A realistic growth state: loose habits of each kind, a quit, an amount and a counted habit, a routine
 *  with step habits, a routine without, and a gated and an alt step. */
function growth() {
  const b = clone(fixture())
  b.habits = [
    habit('h-stretch', 'Stretch'),
    habit('h-read', 'Read', { frequency: 'weekdays' }),
    habit('h-quit', 'No energy drinks', { kind: 'break', frequency: 'daily', quitSince: D(-10), dailyCost: 60 }),
    habit('h-walk', 'Walk', { kind: 'measured', measure: 'times', per: 'day', targetCount: 2 }),
    habit('h-water', 'Water', { kind: 'build', measure: 'amount', unit: 'ml', targetAmount: 2000, presets: [250, 500] }),
    habit('h-focus', 'Deep work', { kind: 'measured', dailyTargetMin: 60, auto: { from: 'focus', minutes: 60 }, source: 'focus' }),
    habit('h-review', 'Monthly review', { frequency: 'monthly' }),
    habit('h-weekly', 'Weekly plan', { frequency: 'weekly' }),
    // routine "Evening": own streak habit + three step habits (one optional, one alts)
    habit('h-evening', 'Evening'),
    habit('h-r-ev-s1', 'Brush teeth', { folderId: 'r-ev', folderOrder: 1, srcStepId: 's1', frequency: 'daily' }),
    habit('h-r-ev-s2', 'Pack bag', { folderId: 'r-ev', folderOrder: 2, srcStepId: 's2', frequency: 'daily' }),
    habit('h-r-ev-s3', 'Floss', { folderId: 'r-ev', folderOrder: 3, srcStepId: 's3', frequency: 'daily', optional: true }),
    // routine "Wind down": own habit, steps WITHOUT habits (what the in-app assistant builds)
    habit('h-wind', 'Wind down'),
    // routine "Morning": own habit, a gated typing step and a step with alternatives
    habit('h-morning', 'Morning'),
    habit('h-r-mo-mr4', 'Typing test', { folderId: 'r-mo', folderOrder: 1, srcStepId: 'mr4', gatedBy: 'typing-wpm', frequency: 'daily' }),
    habit('h-r-mo-mr5', 'Move or caffeine', { folderId: 'r-mo', folderOrder: 2, srcStepId: 'mr5', alts: [{ id: 'a1', title: 'Move' }, { id: 'a2', title: 'Caffeine' }], frequency: 'daily' }),
    habit('h-r-mo-mr6', 'Water first', { folderId: 'r-mo', folderOrder: 3, srcStepId: 'mr6', frequency: 'daily' }),
    habit('h-alt', 'Eat well', { alts: [{ id: 'x1', title: 'Cook' }, { id: 'x2', title: 'Order healthy' }] }),
  ]
  const key = (c) => G.periodKeyFor(c)
  b.routines = [
    { id: 'r-ev', space: 'personal', title: 'Evening', cadence: 'daily', habitId: 'h-evening', periodKey: key('daily'), doneStepIds: [], stepData: {}, stepChoice: {},
      steps: [{ id: 's1', title: 'Brush teeth', kind: 'do' }, { id: 's2', title: 'Pack bag', kind: 'do' }, { id: 's3', title: 'Floss', kind: 'do', optional: true }] },
    { id: 'r-wind', space: 'personal', title: 'Wind down', cadence: 'daily', habitId: 'h-wind', periodKey: key('daily'), doneStepIds: [], stepData: {}, stepChoice: {},
      steps: [{ id: 'w1', title: 'Phone away', kind: 'do' }, { id: 'w2', title: 'Read ten pages', kind: 'do' }] },
    { id: 'r-mo', space: 'personal', title: 'Morning', cadence: 'daily', habitId: 'h-morning', periodKey: key('daily'), doneStepIds: [], stepData: {}, stepChoice: {},
      steps: [{ id: 'mr4', title: 'Typing test', kind: 'do' }, { id: 'mr5', title: 'Move or caffeine', kind: 'do', alts: [{ id: 'a1', title: 'Move' }, { id: 'a2', title: 'Caffeine' }] }, { id: 'mr6', title: 'Water first', kind: 'do' }] },
    { id: 'r-empty', space: 'personal', title: 'Sunday reset', cadence: 'weekly', habitId: 'h-sun', periodKey: key('weekly'), doneStepIds: [], stepData: {}, stepChoice: {}, steps: [] },
  ]
  b.habits.push(habit('h-sun', 'Sunday reset'))
  b.habitLog = []; b.routineLog = []; b.slips = []; b.stepLog = []; b.stepTicks = []; b.records = {}; b.removedSeeds = []; b.graveyard = []
  return b
}
const withLog = (b, rows) => { b.habitLog.push(...rows); return b }

/* ============================================================================ */
/* 0. The helpers equal the app's own                                            */
/* ============================================================================ */
const mid = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new RealDate(y, m - 1, d, 12) }
for (const day of ['2026-01-01', '2026-11-09', '2026-11-15', '2026-12-31', '2027-01-01', '2027-01-04', '2024-12-30', '2020-12-31', '2026-02-28']) {
  assert.equal(G.isoWeekKeyOf(day), K.M.appIsoWeekKey(mid(day)), `isoWeekKey ${day}`)
  for (const c of ['daily', 'prework', 'weekly', 'monthly']) assert.equal(G.periodKeyFor(c, day), K.M.appPeriodKeyFor(c, mid(day)), `periodKeyFor ${c} ${day}`)
  for (const per of ['day', 'week', 'month']) { const { from, to } = K.M.appPeriodRange(per, mid(day)); assert.deepEqual(G.periodRange(per, day), { from, to }, `period range ${per} ${day}`) }
}
assert.equal(M.appRowKey('habitLog', { habitId: 'h', day: '2026-11-11' }), G.logKey('habitLog', { habitId: 'h', day: '2026-11-11' }))
for (const f of ['habitLog', 'routineLog', 'stepLog', 'stepTicks', 'slips']) {
  const row = { habitId: 'h', routineId: 'r', stepId: 's', periodKey: '2026-W46', run: 2, day: '2026-11-11', src: 'x:y#1', at: '2026-11-11T10:00:00.000Z' }
  assert.equal(G.logKey(f, row), M.appRowKey(f, row), `log key parity ${f}`)
  assert.equal(G.logKey(f, { ...row, src: undefined, run: undefined, at: undefined }), M.appRowKey(f, { ...row, src: undefined, run: undefined, at: undefined }), `log key parity (blank) ${f}`)
}
{
  const log = [{ habitId: 'a', day: '2026-11-09' }, { habitId: 'a', day: '2026-11-10' }, { habitId: 'a', day: '2026-11-11' }, { habitId: 'a', day: '2026-11-05' }, { habitId: 'a', day: '2026-11-04' }, { habitId: 'b', day: '2026-11-10' }, { habitId: 'a', day: '2026-11-11' }]
  assert.equal(G.currentStreak(log, 'a', '2026-11-11'), K.M.appCurrentStreak(log, 'a', mid('2026-11-11')))
  assert.equal(G.currentStreak(log, 'a', '2026-11-12'), K.M.appCurrentStreak(log, 'a', mid('2026-11-12')))
  assert.equal(G.currentStreak(log, 'a', '2026-11-13'), K.M.appCurrentStreak(log, 'a', mid('2026-11-13')))
  assert.equal(G.bestStreak(log, 'a'), K.M.appBestStreak(log, 'a'))
  assert.equal(G.countIn(log, 'a', '2026-11-09', '2026-11-11'), K.M.appCountIn(log, 'a', '2026-11-09', '2026-11-11'))
  const q = { id: 'q', kind: 'break', quitSince: '2026-10-20' }
  const slips = [{ habitId: 'q', day: '2026-10-25' }, { habitId: 'q', day: '2026-11-03' }, { habitId: 'q', day: '2026-10-01' }]
  assert.equal(G.daysClean(q, slips, '2026-11-11'), K.M.appDaysClean(q, slips, mid('2026-11-11')))
  assert.equal(G.bestCleanRun(q, slips, '2026-11-11'), K.M.appBestCleanRun(q, slips, mid('2026-11-11')))
  assert.equal(G.slipCount(q, slips), K.M.appSlipCount(q, slips))
  for (const freq of ['daily', 'weekdays', 'times-per-week', 'weekly', 'monthly']) {
    const h = { id: 'a', frequency: freq, targetPerWeek: 4 }
    assert.equal(G.habitTarget(h), K.M.appHabitTarget(h))
    for (let wd = 0; wd < 7; wd++) for (const paused of [false, true]) assert.equal(G.dueOn({ ...h, paused }, wd, log, '2026-11-11'), K.M.appDueOn({ ...h, paused }, wd, log), `dueOn ${freq} ${wd}`)
    assert.equal(G.keptThisPeriod(h, log, '2026-11-11'), K.M.appKeptThisPeriod(h, log, mid('2026-11-11')), `kept this period ${freq}`)
  }
  const r = { id: 'r', periodKey: 'k', steps: [{ id: 'a' }, { id: 'b', optional: true }], doneStepIds: ['a'] }
  assert.equal(G.routineComplete(r, 'k'), K.M.appRoutineComplete(r, 'k'))
  assert.equal(G.routineComplete({ ...r, doneStepIds: [] }, 'k'), K.M.appRoutineComplete({ ...r, doneStepIds: [] }, 'k'))
  assert.equal(G.routineComplete(r, 'other'), false)
  assert.deepEqual(G.requiredSteps({ steps: [{ id: 'a', optional: true }] }), K.M.appRequiredSteps({ steps: [{ id: 'a', optional: true }] }))
  assert.equal(G.stepLocked({ stepData: { mr4: 74 } }, 'mr4'), K.M.appStepLocked({ stepData: { mr4: 74 } }, 'mr4'))
  assert.equal(G.stepLocked({ stepData: { mr4: 75 } }, 'mr4'), false)
  assert.equal(G.stepLocked({}, 'x'), false)
  const gated = { id: 'g', folderId: 'r-mo', srcStepId: 'mr4', gatedBy: 'typing-wpm' }
  for (const v of [0, 74, 75, 90]) assert.equal(G.habitLocked(gated, v ? [{ routineId: 'r-mo', stepId: 'mr4', day: '2026-11-11', value: v }] : [], '2026-11-11'), K.M.appHabitLocked(gated, v ? [{ routineId: 'r-mo', stepId: 'mr4', day: '2026-11-11', value: v }] : [], '2026-11-11'))
}

console.log('growth: helper parity ok')

/* ============================================================================ */
/* 1. DIFFERENTIAL: the port against the real hook, under four clocks            */
/* ============================================================================ */
const CLOCKS = ['2026-11-09T09:00:00Z', '2026-11-11T09:00:00Z', '2026-11-15T09:00:00Z', '2027-01-01T09:00:00Z']
let diffs = 0
const same_ = async (...a) => { diffs++; return same(...a) }

for (const at of CLOCKS) {
  setNow(at)
  const t = TODAY()
  const wd = M.weekdayIndex(t)
  const lastWeek = D(-7)
  const earlierThisWeek = wd > 0 ? D(-1) : null

  /* --- plain tick / untick, today and past days --- */
  {
    const s = growth()
    await same_(`tick today ${t}`, s, (a) => a.markHabitOn('h-stretch', t, true), (b) => G.tickHabit(b, { id: 'h-stretch' }, {}))
    await same_('tick a day last week (no week cache)', s, (a) => a.markHabitOn('h-stretch', lastWeek, true), (b) => G.tickHabit(b, { id: 'h-stretch' }, { day: lastWeek }))
    if (earlierThisWeek) await same_('tick earlier this week', s, (a) => a.markHabitOn('h-stretch', earlierThisWeek, true), (b) => G.tickHabit(b, { id: 'h-stretch' }, { day: earlierThisWeek }))
    const ticked = withLog(growth(), [{ habitId: 'h-stretch', day: t, at: 'x' }, { habitId: 'h-stretch', day: lastWeek }])
    ticked.habits[0].days[wd] = true
    await same_('untick today', ticked, (a) => a.markHabitOn('h-stretch', t, false), (b) => G.tickHabit(b, { id: 'h-stretch' }, { done: false }))
    await same_('untick last week', ticked, (a) => a.markHabitOn('h-stretch', lastWeek, false), (b) => G.tickHabit(b, { id: 'h-stretch' }, { day: lastWeek, done: false }))
    // a tick after an untick digs the tombstone up
    const un = clone(ticked); const bb = clone(un); G.tickHabit(bb, { id: 'h-stretch' }, { done: false })
    await same_('tick again after an untick', bb, (a) => a.markHabitOn('h-stretch', t, true), (b) => G.tickHabit(b, { id: 'h-stretch' }, {}))
    // a day backfilled by "since" is replaced by a plain row, as in the app
    const since = withLog(growth(), [{ habitId: 'h-stretch', day: lastWeek, src: 'since' }])
    await same_('untick a since-row', since, (a) => a.markHabitOn('h-stretch', lastWeek, false), (b) => G.tickHabit(b, { id: 'h-stretch' }, { day: lastWeek, done: false }))
  }

  /* --- a habit that is a step of a routine: the routine bookkeeping --- */
  {
    const s = growth()
    await same_('tick a step habit (routine: started, step tick, progress)', s,
      (a) => a.markHabitOn('h-r-ev-s1', t, true), (b) => G.tickHabit(b, { id: 'h-r-ev-s1' }, {}))
    const one = growth(); G.tickHabit(one, { id: 'h-r-ev-s1' }, {})
    // the last required step completes the routine: routineLog, completedOn and the folder's own habit row
    const done = await same_('tick the last required step (routine completes, folder habit ticks)', one,
      (a) => a.markHabitOn('h-r-ev-s2', t, true), (b) => G.tickHabit(b, { id: 'h-r-ev-s2' }, {}))
    assert.equal(done.routines.find((r) => r.id === 'r-ev').completedOn, t)
    assert.ok(done.habitLog.some((x) => x.habitId === 'h-evening' && x.day === t), 'the routine streak habit is kept')
    assert.equal(done.routineLog.length, 1)
    // unticking one step of a half-done routine removes one row per list
    await same_('untick a step of a half-done routine', one, (a) => a.markHabitOn('h-r-ev-s1', t, false), (b) => G.tickHabit(b, { id: 'h-r-ev-s1' }, { done: false }))
    // an optional step never holds the routine
    await same_('tick the optional step', one, (a) => a.markHabitOn('h-r-ev-s3', t, true), (b) => G.tickHabit(b, { id: 'h-r-ev-s3' }, {}))
  }

  /* --- routine steps, the routine card side --- */
  {
    const s = growth()
    await same_('routine_step tick (steps with habits)', s, (a) => a.toggleRoutineStep('r-ev', 's1'), (b) => G.routineStep(b, { id: 'r-ev' }, { stepId: 's1' }))
    await same_('routine_step tick (steps WITHOUT habits)', s, (a) => a.toggleRoutineStep('r-wind', 'w1'), (b) => G.routineStep(b, { id: 'r-wind' }, { stepId: 'w1' }))
    const half = growth(); G.routineStep(half, { id: 'r-wind' }, { stepId: 'w1' })
    const full = await same_('routine_step last step finishes the routine (no step habits)', half, (a) => a.toggleRoutineStep('r-wind', 'w2'), (b) => G.routineStep(b, { id: 'r-wind' }, { stepId: 'w2' }))
    assert.ok(full.habitLog.some((x) => x.habitId === 'h-wind' && x.day === t))
    await same_('routine_step untick', half, (a) => a.toggleRoutineStep('r-wind', 'w1'), (b) => G.routineStep(b, { id: 'r-wind' }, { stepId: 'w1' }))
    const one = growth(); G.routineStep(one, { id: 'r-ev' }, { stepId: 's1' })
    const last = await same_('routine_step tick the last required step (with step habits): the one known divergence', one, (a) => a.toggleRoutineStep('r-ev', 's2'), (b) => G.routineStep(b, { id: 'r-ev' }, { stepId: 's2' }), appLosesStepRows(['h-r-ev-s2', 'r-ev:s2#0']))
    assert.ok(last.habitLog.some((x) => x.habitId === 'h-r-ev-s2' && x.day === t), 'the port keeps the last step\'s own habit row')
    assert.ok(!(last.graveyard ?? []).some((x) => x.k === G.logKey('habitLog', { habitId: 'h-r-ev-s2', day: t, src: 'r-ev:s2#0' }) && !x.undone), 'and does not bury it')
    await same_('routine_step alternative picked', s, (a) => a.toggleRoutineAlt('r-mo', 'mr5', 'a2'), (b) => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a2' }))
    const alt = growth(); G.routineStep(alt, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a2' })
    await same_('routine_step alternative cleared', alt, (a) => a.toggleRoutineAlt('r-mo', 'mr5', 'a2'), (b) => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a2' }))
  }

  /* --- finish / reopen a whole routine --- */
  {
    const s = growth()
    const fin = await same_('routine_done true (steps with habits; optional step not claimed): the known divergence', s, (a) => a.setRoutineDone('r-ev', true), (b) => G.routineDone(b, { id: 'r-ev' }, true), appLosesStepRows(['h-r-ev-s1', 'r-ev:s1#0'], ['h-r-ev-s2', 'r-ev:s2#0']))
    assert.deepEqual(fin.habitLog.filter((x) => x.src).map((x) => x.habitId).sort(), ['h-r-ev-s1', 'h-r-ev-s2'], 'the port keeps every finished step\'s habit row')
    assert.deepEqual(fin.routines.find((r) => r.id === 'r-ev').doneStepIds.sort(), ['s1', 's2'])
    await same_('routine_done true (no step habits)', s, (a) => a.setRoutineDone('r-wind', true), (b) => G.routineDone(b, { id: 'r-wind' }, true))
    await same_('routine_done true leaves the locked typing step open', s, (a) => a.setRoutineDone('r-mo', true), (b) => G.routineDone(b, { id: 'r-mo' }, true))
    const part = growth(); G.routineStep(part, { id: 'r-wind' }, { stepId: 'w1' })
    await same_('routine_done false with one step ticked', part, (a) => a.setRoutineDone('r-wind', false), (b) => G.routineDone(b, { id: 'r-wind' }, false))
  }

  /* --- editing steps and the plan --- */
  {
    const s = growth()
    /* The port ALSO makes the new step a habit in the routine's folder (what the Habits page's New > Routine does, addRoutineWithSteps);
       the app's addRoutineStep alone does not. So the port's extra habit is compared separately, below, and set aside here. */
    const noStepHabit = (o) => ({ ...o, habits: o.habits.filter((h) => !/^h-r-wind-st/.test(h.id)) })
    for (const step of ['One', 'Two']) {
      // ids are generated; compare through the title instead
      const app = appStore(s); await app.act((a) => a.addRoutineStep('r-wind', { title: step }))
      const b = clone(s); G.addRoutineStep(b, { id: 'r-wind' }, step)
      const strip = (o) => noStepHabit({ ...o, routines: o.routines.map((r) => ({ ...r, steps: r.steps.map((x) => ({ ...x, id: x.id.startsWith('st-') ? 'st-*' : x.id })) })) })
      assert.deepEqual(strip(opsSnapshot(b)), strip(app.snapshot()), `differential: add step ${step}`); diffs++
    }
    // adding a required step to a finished routine reopens it (routineLog and the streak habit go)
    const fin = growth(); G.routineDone(fin, { id: 'r-wind' }, true)
    const app = appStore(fin); await app.act((a) => a.addRoutineStep('r-wind', { title: 'Late step' }))
    const b = clone(fin); G.addRoutineStep(b, { id: 'r-wind' }, 'Late step')
    const strip = (o) => noStepHabit({ ...o, routines: o.routines.map((r) => ({ ...r, steps: r.steps.map((x) => ({ ...x, id: x.id.startsWith('st-') ? 'st-*' : x.id })) })) })
    assert.deepEqual(strip(opsSnapshot(b)), strip(app.snapshot()), 'differential: adding a step to a finished routine reopens it'); diffs++
    assert.equal(b.routines.find((r) => r.id === 'r-wind').completedOn, null)
    // removing the last unticked step finishes the routine
    const half = growth(); G.routineStep(half, { id: 'r-wind' }, { stepId: 'w1' })
    await same_('remove the only open step: the routine finishes', half, (a) => a.deleteRoutineStep('r-wind', 'w2'), (b) => G.removeRoutineStep(b, { id: 'r-wind' }, { stepId: 'w2' }))
    await same_('plan a routine', s, (a) => a.planRoutine('r-wind', 'evening', t), (b) => G.planRoutine(b, { id: 'r-wind' }, { slot: 'evening' }))
    await same_('plan a routine for tomorrow', s, (a) => a.planRoutine('r-wind', 'morning', D(1)), (b) => G.planRoutine(b, { id: 'r-wind' }, { slot: 'morning', date: D(1) }))
    const planned = growth(); G.planRoutine(planned, { id: 'r-wind' }, { slot: 'evening' })
    await same_('clear a plan', planned, (a) => a.planRoutine('r-wind', undefined), (b) => G.planRoutine(b, { id: 'r-wind' }, { clear: true }))
    await same_('edit a routine title renames its habit', s, (a) => a.updateRoutine('r-wind', { title: 'Wind down hard' }), (b) => G.editRoutine(b, { id: 'r-wind' }, { title: 'Wind down hard' }))
    await same_('edit a routine cadence and blurb', s, (a) => a.updateRoutine('r-wind', { cadence: 'weekly', blurb: 'b' }), (b) => G.editRoutine(b, { id: 'r-wind' }, { cadence: 'weekly', blurb: 'b' }))
    await same_('delete a routine', s, (a) => a.deleteRoutine('r-wind'), (b) => G.deleteRoutine(b, { id: 'r-wind' }))
  }

  /* --- counts, amounts, slips --- */
  {
    const s = growth()
    await same_('count +1', s, (a) => a.logCount('h-walk', 1), (b) => G.habitCount(b, { id: 'h-walk' }, 1))
    const two = growth(); G.habitCount(two, { id: 'h-walk' }, 2)
    assert.equal(two.habitLog.length, 2)
    await same_('count -1 takes the newest row back', two, (a) => a.logCount('h-walk', -1), (b) => G.habitCount(b, { id: 'h-walk' }, -1))
    await same_('amount +250', s, (a) => a.logAmount('h-water', 250), (b) => G.logAmount(b, { id: 'h-water' }, 250))
    const water = growth(); G.logAmount(water, { id: 'h-water' }, 1500); G.logAmount(water, { id: 'h-water' }, 500)
    assert.equal(water.habits.find((h) => h.id === 'h-water').days[wd], true, 'target reached: the day is kept')
    {
      const app = appStore(water); const rows = app.api.habitLog.filter((x) => x.habitId === 'h-water')
      await app.act((a) => a.removeAmount('h-water', rows[1].src))
      const b = clone(water); G.removeAmount(b, { id: 'h-water' }, b.habitLog.filter((x) => x.habitId === 'h-water')[1].src)
      assert.deepEqual(opsSnapshot(b), app.snapshot(), 'differential: remove an amount'); diffs++
      assert.equal(b.habits.find((h) => h.id === 'h-water').days[wd], false)
    }
    await same_('log a slip today', s, (a) => a.logSlip('h-quit'), (b) => G.logSlip(b, { id: 'h-quit' }))
    await same_('log a slip on a past day', s, (a) => a.logSlipOn('h-quit', D(-3)), (b) => G.logSlip(b, { id: 'h-quit' }, D(-3)))
    const slipped = growth(); G.logSlip(slipped, { id: 'h-quit' }, D(-3))
    await same_('a slip already logged changes nothing', slipped, (a) => a.logSlipOn('h-quit', D(-3)), (b) => G.logSlip(b, { id: 'h-quit' }, D(-3)))
    // undo = setSlips(before): tracked, so the row is buried
    { const app = appStore(s); await app.act((a) => a.logSlipOn('h-quit', D(-3))); await app.act(() => app.store.undo()); const b = clone(s); G.logSlip(b, { id: 'h-quit' }, D(-3)); G.undoSlip(b, { id: 'h-quit' }, D(-3)); assert.deepEqual(opsSnapshot(b), app.snapshot(), 'differential: undo a slip'); diffs++ }
    // a gated habit: the number passes / fails
    await same_('typing 80 WPM keeps the day', s, (a) => a.logHabitNumber('h-r-mo-mr4', 80), (b) => G.habitCount(b, { id: 'h-r-mo-mr4' }, 80))
    await same_('typing 60 WPM logs but does not keep', s, (a) => a.logHabitNumber('h-r-mo-mr4', 60), (b) => G.habitCount(b, { id: 'h-r-mo-mr4' }, 60))
    await same_('pick an alternative on a loose habit', s, (a) => a.pickHabitAlt('h-alt', 'x1'), (b) => G.tickHabit(b, { id: 'h-alt' }, { alt: 'x1' }))
    const picked = growth(); G.tickHabit(picked, { id: 'h-alt' }, { alt: 'x1' })
    await same_('pick the other alternative replaces the choice', picked, (a) => a.pickHabitAlt('h-alt', 'x2'), (b) => G.tickHabit(b, { id: 'h-alt' }, { alt: 'x2' }))
    await same_('pick the same alternative clears it', picked, (a) => a.pickHabitAlt('h-alt', 'x1'), (b) => G.tickHabit(b, { id: 'h-alt' }, { alt: 'x1' }))
    await same_('pick an alternative on a step habit syncs the routine', s, (a) => a.pickHabitAlt('h-r-mo-mr5', 'a1'), (b) => G.tickHabit(b, { id: 'h-r-mo-mr5' }, { alt: 'a1' }))
  }

  /* --- habits: pause, archive, edit --- */
  {
    const s = growth()
    await same_('pause', s, (a) => a.togglePauseHabit('h-stretch'), (b) => G.pauseHabit(b, { id: 'h-stretch' }))
    await same_('archive', s, (a) => a.deleteHabit('h-stretch'), (b) => G.archiveHabit(b, { id: 'h-stretch' }))
    await same_('edit name, frequency, per week', s, (a) => a.updateHabit('h-stretch', { name: 'Stretch more', frequency: 'times-per-week', targetPerWeek: 4 }), (b) => G.editHabit(b, { id: 'h-stretch' }, { newName: 'Stretch more', frequency: 'times-per-week', perWeek: 4 }))
    await same_('edit the daypart (setLook)', s, (a) => a.setLook('habit', 'h-stretch', { daypart: 'evening' }), (b) => G.editHabit(b, { id: 'h-stretch' }, { daypart: 'evening' }))
    await same_('clear the daypart (setLook)', s, (a) => a.setLook('habit', 'h-stretch', { daypart: null }), (b) => G.editHabit(b, { id: 'h-stretch' }, { daypart: null }))
    await same_('edit a count target', s, (a) => a.updateHabit('h-walk', { targetCount: 5, per: 'week' }), (b) => G.editHabit(b, { id: 'h-walk' }, { countTarget: 5, countPer: 'week' }))
    await same_('edit a quit date', s, (a) => a.updateHabit('h-quit', { quitSince: D(-20) }), (b) => G.editHabit(b, { id: 'h-quit' }, { quitSince: D(-20) }))
    await same_('edit a quit cost (setLook)', s, (a) => a.setLook('habit', 'h-quit', { dailyCost: 90 }), (b) => G.editHabit(b, { id: 'h-quit' }, { dailyCost: 90 }))
    // the start date moving earlier claims the days it reached back over
    const started = growth(); const hs = started.habits.find((h) => h.id === 'h-stretch'); hs.startedOn = D(-3); hs.filledSince = D(-3)
    await same_('start date moved earlier backfills only the new days', started, (a) => a.updateHabit('h-stretch', { startedOn: D(-6) }), (b) => G.editHabit(b, { id: 'h-stretch' }, { startedOn: D(-6) }), appDigsSince)
    await same_('start date moved later changes no logged day', started, (a) => a.updateHabit('h-stretch', { startedOn: D(-1) }), (b) => G.editHabit(b, { id: 'h-stretch' }, { startedOn: D(-1) }))
  }

  /* --- habits: add (ids are generated, so compare with the id swapped) --- */
  {
    const swap = (snap, id) => JSON.parse(JSON.stringify(snap).split(id).join('NEW'))
    const addBoth = async (label, input, appInput, expectOps = {}) => {
      const s = growth()
      const app = appStore(s); const n0 = app.api.habits.length
      await app.act((a) => a.addHabit(appInput))
      const newApp = app.api.habits[n0].id
      const b = clone(s); const r = G.addHabit(b, input)
      assert.deepEqual(swap(appDigsSince(opsSnapshot(b)), r.id), swap(app.snapshot(), newApp), `differential: ${label}`); diffs++
      return b
    }
    await addBoth('add a plain habit', { name: 'Journal' }, { name: 'Journal', frequency: 'daily', kind: 'build' })
    await addBoth('add a times-per-week habit', { name: 'Gym', perWeek: 3 }, { name: 'Gym', frequency: 'times-per-week', targetPerWeek: 3, kind: 'build' })
    await addBoth('add a habit started 10 days ago (backfill)', { name: 'Journal', startedOn: D(-10) }, { name: 'Journal', frequency: 'daily', kind: 'build', startedOn: D(-10) })
    await addBoth('add a quit', { name: 'Vaping', breaking: true }, { name: 'Vaping', frequency: 'daily', kind: 'break', quitSince: t, targetPerWeek: undefined })
    await addBoth('add a quit with a date and cost', { name: 'Vaping', breaking: true, quitSince: D(-5), dailyCost: 80 }, { name: 'Vaping', frequency: 'daily', kind: 'break', quitSince: D(-5), dailyCost: 80 })
    await addBoth('add a counted habit', { name: 'Cold shower', track: 'count', countTarget: 3 }, { name: 'Cold shower', frequency: 'daily', kind: 'measured', measure: 'times', per: 'day', targetCount: 3 })
    await addBoth('add an amount habit', { name: 'Pages', track: 'amount', unit: 'pages', targetAmount: 20, presets: [5, 10] }, { name: 'Pages', frequency: 'daily', kind: 'build', measure: 'amount', unit: 'pages', targetAmount: 20, presets: [5, 10] })
    // routines
    const s = growth()
    const app = appStore(s); await app.act((a) => a.addRoutine({ title: 'Lunch', cadence: 'weekly', blurb: 'x' }))
    const r = app.api.routines.at(-1); const b = clone(s); const out = G.addRoutine(b, { title: 'Lunch', cadence: 'weekly', blurb: 'x' })
    const nb = b.routines.at(-1)
    assert.deepEqual(swap(swap(opsSnapshot(b), nb.id), nb.habitId), swap(swap(app.snapshot(), r.id), r.habitId), 'differential: add a routine'); diffs++
    assert.equal(out.id, nb.id)
  }

  /* ======== MCP v3: the operations that used to be refused, against the real hook ======== */
  /** KNOWN APP BUG, kept out of the port on purpose. When a routine goes from finished to open, applyRoutine removes the step's habit
   *  row and then markDay() rewrites the habit log from a copy taken BEFORE that removal, so the app puts the step row back (and never
   *  buries it); after a reload the step shows ticked again while the routine card shows it open. The port removes and buries the row,
   *  as the step habit's own checkbox does. This maps the port's snapshot to what the app leaves, and nothing else. */
  const appKeepsRows = (...rows) => (snap) => {
    const o = JSON.parse(JSON.stringify(snap))
    for (const [habitId, src] of rows) {
      o.habitLog.push(src ? { day: t, habitId, src } : { day: t, habitId })
      o.grave[`habitLog:${habitId}|${t}|${src ?? ''}`] = true
    }
    return o
  }
  const run = (id, steps) => { const f = growth(); for (const st of steps) G.routineStep(f, { id }, { stepId: st }); return f }
  {
    const fin = run('r-ev', ['s1', 's2'])
    assert.equal(fin.routineLog.length, 1)
    // the step card: untick one step of a finished routine
    await same_('V3 routine_step untick of a FINISHED routine (step habits): finish, streak day, step rows', fin,
      (a) => a.toggleRoutineStep('r-ev', 's1'), (b) => G.routineStep(b, { id: 'r-ev' }, { stepId: 's1' }, { done: false }), appKeepsRows(['h-r-ev-s1', 'r-ev:s1#0']))
    // the habit page: untick the step habit of a finished routine
    await same_('V3 tick_habit untick of a step habit of a FINISHED routine', fin,
      (a) => a.markHabitOn('h-r-ev-s1', t, false), (b) => G.tickHabit(b, { id: 'h-r-ev-s1' }, { done: false }))
    // the routine card's button: reopen the whole finished routine
    await same_('V3 routine_done false on a finished routine with step habits', fin,
      (a) => a.setRoutineDone('r-ev', false), (b) => G.routineDone(b, { id: 'r-ev' }, false), appKeepsRows(['h-r-ev-s1', 'r-ev:s1#0'], ['h-r-ev-s2', 'r-ev:s2#0']))
    const wind = run('r-wind', ['w1', 'w2'])
    await same_('V3 routine_done false on a finished routine (no step habits)', wind, (a) => a.setRoutineDone('r-wind', false), (b) => G.routineDone(b, { id: 'r-wind' }, false))
    // a half-done routine with two ticked step habits
    const mo = growth(); G.routineStep(mo, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a1' }); G.routineStep(mo, { id: 'r-mo' }, { stepId: 'mr6' })
    await same_('V3 routine_done false on a half-done routine (2 step habits ticked)', mo, (a) => a.setRoutineDone('r-mo', false), (b) => G.routineDone(b, { id: 'r-mo' }, false))
    // a routine's own streak habit, today: the routine card's button
    await same_('V3 tick_habit on a routine\'s own streak habit (today) = setRoutineDone true', growth(), (a) => a.setRoutineDone('r-wind', true), (b) => G.tickHabit(b, { id: 'h-wind' }, {}))
    await same_('V3 tick_habit done:false on a finished routine\'s streak habit = setRoutineDone false', wind, (a) => a.setRoutineDone('r-wind', false), (b) => G.tickHabit(b, { id: 'h-wind' }, { done: false }))
  }
  {
    // a paused habit can be ticked
    const p = growth(); p.habits.find((h) => h.id === 'h-stretch').paused = true
    await same_('V3 a paused habit is ticked', p, (a) => a.markHabitOn('h-stretch', t, true), (b) => G.tickHabit(b, { id: 'h-stretch' }, {}))
    const pw = growth(); pw.habits.find((h) => h.id === 'h-walk').paused = true; pw.habits.find((h) => h.id === 'h-water').paused = true
    await same_('V3 a paused counted habit is counted', pw, (a) => a.logCount('h-walk', 1), (b) => G.habitCount(b, { id: 'h-walk' }, 1))
    await same_('V3 a paused amount habit takes an amount', pw, (a) => a.logAmount('h-water', 250), (b) => G.logAmount(b, { id: 'h-water' }, 250))
    const pg = growth(); pg.habits.find((h) => h.id === 'h-r-mo-mr4').paused = true
    await same_('V3 a paused gated habit takes its number', pg, (a) => a.logHabitNumber('h-r-mo-mr4', 80), (b) => G.habitCount(b, { id: 'h-r-mo-mr4' }, 80))
    // count -2 = two taps
    const two = growth(); G.habitCount(two, { id: 'h-walk' }, 3)
    const app = appStore(two); await app.act((a) => a.logCount('h-walk', -1)); await app.act((a) => a.logCount('h-walk', -1))
    const bb = clone(two); G.habitCount(bb, { id: 'h-walk' }, -2); assert.deepEqual(opsSnapshot(bb), app.snapshot(), 'differential: count -2 is two taps'); diffs++
  }
  {
    // alternatives: untick without saying which one
    const alt = growth(); G.routineStep(alt, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a2' })
    await same_('V3 routine step with alternatives unticked without alt (clears the chosen one)', alt, (a) => a.toggleRoutineAlt('r-mo', 'mr5', 'a2'), (b) => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { done: false }))
    const noChoice = growth(); G.routineDone(noChoice, { id: 'r-mo' }, true)
    await same_('V3 a step with alternatives ticked by routine_done (no choice) is unticked', noChoice, (a) => a.toggleRoutineStep('r-mo', 'mr5'), (b) => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { done: false }))
    const loose = growth(); G.tickHabit(loose, { id: 'h-alt' }, { alt: 'x1' })
    await same_('V3 loose habit with alternatives unticked without alt', loose, (a) => a.pickHabitAlt('h-alt', 'x1'), (b) => G.tickHabit(b, { id: 'h-alt' }, { done: false }))
  }
  {
    // delete a routine whose habit a goal counts off; archive its streak habit = the same
    const g = growth(); g.goals = [{ id: 'g1', space: 'personal', name: 'Evenings', habitId: 'h-evening', current: 2, target: 10, unit: 'checkoffs', timeframe: 'quarter' }, { id: 'g2', space: 'personal', name: 'Other', habitId: 'h-read', current: 1, target: 5, unit: 'checkoffs' }]
    g.habits.find((h) => h.id === 'h-evening').days = [true, true, false, false, false, false, false]; g.habits.find((h) => h.id === 'h-evening').history = [3, 4]
    await same_('V3 delete_routine detaches the goal that counted off it', g, (a) => a.deleteRoutine('r-ev'), (b) => G.deleteRoutine(b, { id: 'r-ev' }))
    await same_('V3 archive_habit on a routine\'s streak habit deletes the routine', g, (a) => a.deleteRoutine('r-ev'), (b) => G.archiveHabit(b, { id: 'h-evening' }))
  }
  {
    // start dates far back, quit frequency, focus-minute habits, colour and icon
    const swap = (snap, id) => JSON.parse(JSON.stringify(snap).split(id).join('NEW'))
    /* The port digs up a backfilled day only when it already holds a tombstone for it (see setLog in ops-growth.ts: a multi-year backfill
       must not push real tombstones out of the 900-entry graveyard). The app digs up all of them, so those entries are set aside here. */
    const noSince = (o) => { for (const k of Object.keys(o.grave)) if (/\|since$/.test(k)) delete o.grave[k]; return o }
    const addBoth = async (label, input, appInput) => {
      const s0 = growth(); const app = appStore(s0); const n0 = app.api.habits.length
      await app.act((a) => a.addHabit(appInput))
      const b = clone(s0); const r = G.addHabit(b, input)
      assert.deepEqual(swap(appDigsSince(opsSnapshot(b)), r.id), swap(app.snapshot(), app.api.habits[n0].id), `differential: ${label}`); diffs++
    }
    await addBoth('V3 add a habit started 400 days ago', { name: 'Old habit', startedOn: D(-400) }, { name: 'Old habit', frequency: 'daily', kind: 'build', startedOn: D(-400) })
    await addBoth('V3 add a habit started 3 years ago', { name: 'Older', startedOn: D(-1100) }, { name: 'Older', frequency: 'daily', kind: 'build', startedOn: D(-1100) })
    await addBoth('V3 add a quit with a check-in frequency', { name: 'Vaping', breaking: true, frequency: 'weekly', quitSince: D(-5) }, { name: 'Vaping', frequency: 'weekly', kind: 'break', quitSince: D(-5) })
    await addBoth('V3 add a quit with colour and icon', { name: 'Vaping', breaking: true, color: '#F87171', icon: 'eye', dailyCost: 50 }, { name: 'Vaping', frequency: 'daily', kind: 'break', color: '#F87171', icon: 'eye', dailyCost: 50 })
    await addBoth('V3 add a habit kept by focus minutes', { name: 'Deep work 2', track: 'minutes', minutesTarget: 45, daypart: 'morning' }, { name: 'Deep work 2', frequency: 'daily', kind: 'measured', measure: 'minutes', dailyTargetMin: 45, source: 'focus', daypart: 'morning' })
    await addBoth('V3 add a counted habit with colour and icon', { name: 'Cold 3', track: 'count', countTarget: 8, color: '#38BDF8', icon: 'bolt' }, { name: 'Cold 3', frequency: 'daily', kind: 'measured', measure: 'times', per: 'day', targetCount: 8, color: '#38BDF8', icon: 'bolt' })
  }
  {
    // editing: the Habit sheet (updateHabit with the whole shape) and the look sheet (setLook)
    const sheet = (h, over) => ({ name: h.name, daypart: h.daypart, frequency: h.frequency, targetPerWeek: undefined, kind: 'build', measure: undefined, per: undefined, targetCount: undefined, dailyTargetMin: undefined, source: undefined, quitSince: undefined, startedOn: h.startedOn ?? t, ...over })
    const s0 = growth(); const H = (id) => s0.habits.find((h) => h.id === id)
    await same_('V3 edit: a plain habit becomes a quit', s0, (a) => a.updateHabit('h-stretch', sheet(H('h-stretch'), { kind: 'break', daypart: undefined, startedOn: undefined, quitSince: D(-3) })), (b) => G.editHabit(b, { id: 'h-stretch' }, { kind: 'quit', quitSince: D(-3) }))
    await same_('V3 edit: a plain habit becomes counted', s0, (a) => a.updateHabit('h-stretch', sheet(H('h-stretch'), { kind: 'measured', measure: 'times', per: 'week', targetCount: 4 })), (b) => G.editHabit(b, { id: 'h-stretch' }, { kind: 'count', countTarget: 4, countPer: 'week' }))
    await same_('V3 edit: a plain habit becomes kept by focus minutes', s0, (a) => a.updateHabit('h-stretch', sheet(H('h-stretch'), { kind: 'measured', measure: 'minutes', source: 'focus', dailyTargetMin: 30 })), (b) => G.editHabit(b, { id: 'h-stretch' }, { kind: 'minutes', minutesTarget: 30 }))
    await same_('V3 edit: a counted habit becomes a plain tick', s0, (a) => a.updateHabit('h-walk', sheet(H('h-walk'), { kind: 'build' })), (b) => G.editHabit(b, { id: 'h-walk' }, { kind: 'keep' }))
    await same_('V3 edit: a quit becomes a plain tick', s0, (a) => a.updateHabit('h-quit', sheet(H('h-quit'), { kind: 'build', frequency: 'daily' })), (b) => G.editHabit(b, { id: 'h-quit' }, { kind: 'keep' }))
    await same_('V3 edit: a habit with a start date in the past, via the sheet', s0, (a) => a.updateHabit('h-stretch', { startedOn: D(-500) }), (b) => G.editHabit(b, { id: 'h-stretch' }, { startedOn: D(-500) }), appDigsSince)
    await same_('V3 edit: colour and icon of a habit (setLook)', s0, (a) => a.setLook('habit', 'h-stretch', { color: '#A78BFA' }), (b) => G.editHabit(b, { id: 'h-stretch' }, { color: '#a78bfa' }))
    await same_('V3 edit: icon of a habit (setLook)', s0, (a) => a.setLook('habit', 'h-stretch', { icon: 'sun' }), (b) => G.editHabit(b, { id: 'h-stretch' }, { icon: 'sun' }))
    await same_('V3 edit: quick amounts (setLook)', s0, (a) => a.setLook('habit', 'h-water', { presets: [100, 300, 700] }), (b) => G.editHabit(b, { id: 'h-water' }, { presets: [100, 300, 700] }))
    await same_('V3 edit: clear a quit cost (setLook)', s0, (a) => a.setLook('habit', 'h-quit', { dailyCost: undefined }), (b) => G.editHabit(b, { id: 'h-quit' }, { dailyCost: null }))
    await same_('V3 edit: colour of a routine (setLook)', s0, (a) => a.setLook('routine', 'r-wind', { color: '#34D399' }), (b) => G.editRoutine(b, { id: 'r-wind' }, { color: '#34D399' }))
    await same_('V3 edit: icon of a routine (setLook)', s0, (a) => a.setLook('routine', 'r-wind', { icon: 'bulb' }), (b) => G.editRoutine(b, { id: 'r-wind' }, { icon: 'bulb' }))
    await same_('V3 edit: the part of the day of a routine\'s own habit (locked habit, daypart only)', s0, (a) => a.updateHabit('h-wind', { daypart: 'evening' }), (b) => G.editHabit(b, { id: 'h-wind' }, { daypart: 'evening' }), (snap) => { const o = JSON.parse(JSON.stringify(snap)); const h = o.habits.find((x) => x.id === 'h-wind'); delete h.partSet; return o })
  }
  {
    // a routine made the way the Habits page makes it, and a step added to it
    const swapAll = (snap, pairs) => { let str = JSON.stringify(snap); for (const [from, to] of pairs) str = str.split(from).join(to); return JSON.parse(str) }
    for (const [label, input, appInput] of [
      ['daily with a daypart, colour and icon', { title: 'Lunch', cadence: 'daily', daypart: 'noon', steps: ['Walk', 'Eat'], color: '#38BDF8', icon: 'sun' }, { title: 'Lunch', cadence: 'daily', daypart: 'noon', steps: ['Walk', 'Eat'], color: '#38BDF8', icon: 'sun' }],
      ['weekdays', { title: 'Before work', cadence: 'prework', steps: ['Shower'] }, { title: 'Before work', cadence: 'prework', steps: ['Shower'] }],
      ['whenever I need it (repeatable)', { title: 'Reset', cadence: 'daily', repeatable: true, steps: ['Breathe', 'Walk'] }, { title: 'Reset', cadence: 'daily', repeatable: true, steps: ['Breathe', 'Walk'] }],
    ]) {
      const s0 = growth(); const app = appStore(s0); const n0 = app.api.routines.length, h0 = app.api.habits.length
      await app.act((a) => a.addRoutineWithSteps(appInput))
      const ar = app.api.routines[n0]
      const b = clone(s0); const out = G.addRoutine(b, input); const mr = b.routines.at(-1)
      const pairs = (rr, habs) => [[rr.id, 'RID'], [rr.habitId, 'RHID'], ...rr.steps.map((st, k) => [st.id, `STEP${k}`])]
      assert.deepEqual(swapAll(opsSnapshot(b), pairs(mr)), swapAll(app.snapshot(), pairs(ar)), `differential: V3 add a routine with steps (${label})`); diffs++
      assert.equal(out.id, mr.id)
    }
    // add_routine_step: the new step's habit is the one addRoutineWithSteps makes for its step
    const s1 = growth(); G.addRoutine(s1, { title: 'Lunch', cadence: 'daily', daypart: 'noon', steps: ['Walk'] }); const rr = s1.routines.at(-1)
    G.addRoutineStep(s1, { id: rr.id }, 'Eat')
    const made = rr.steps.map((st) => s1.habits.find((h) => h.id === `h-${rr.id}-${st.id}`))
    assert.deepEqual(made.map((h) => [h.name, h.folderOrder, h.daypart, h.frequency, h.kind, h.partSet, h.startedOn, h.folderId]), [['Walk', 0, 'noon', 'daily', 'build', true, t, rr.id], ['Eat', 1, 'noon', 'daily', 'build', true, t, rr.id]], 'a step added later is a habit shaped like the ones the Habits page makes')
    const ticked = clone(s1); G.routineStep(ticked, { id: rr.id }, { step: 'eat' })
    assert.ok(ticked.habitLog.some((x) => x.habitId === made[1].id), 'the new step\'s habit follows its tick')
  }
  {
    // the daily review: "I finished <routine>" yesterday, and bulk ticking
    const y = D(-1)
    const s0 = growth()
    const app = appStore(s0)
    const steps = s0.habits.filter((h) => h.folderId === 'r-ev' && !h.optional && !h.paused)
    for (const h of steps) await app.act((a) => a.markHabitOn(h.id, y, true))
    await app.act((a) => a.assertRoutineOn('h-evening', y, true))
    const b = clone(s0); G.routineDone(b, { id: 'r-ev' }, true, y)
    assert.deepEqual(opsSnapshot(b), app.snapshot(), 'differential: V3 the review\'s "I finished it" for yesterday (each write seeing the last)'); diffs++
    const app2 = appStore(s0)
    await app2.act((a) => { for (const h of steps) a.markHabitOn(h.id, y, true); a.assertRoutineOn('h-evening', y, true) })
    assert.ok(app2.api.habitLog.filter((x) => x.day === y).length < b.habitLog.filter((x) => x.day === y).length, 'the app\'s own single-click handler loses writes to its stale copy; the port does not'); diffs++
    // bulk ticking = the same ticks one after another
    const app3 = appStore(s0)
    await app3.act((a) => a.markHabitOn('h-stretch', t, true)); await app3.act((a) => a.markHabitOn('h-read', y, true)); await app3.act((a) => a.markHabitOn('h-r-ev-s1', t, true))
    const b3 = clone(s0); G.tickHabits(b3, [{ id: 'h-stretch' }, { title: 'read', day: y }, { id: 'h-r-ev-s1' }])
    assert.deepEqual(opsSnapshot(b3), app3.snapshot(), 'differential: V3 tick_habits equals the ticks done one by one'); diffs++
    // close the daily review
    const app4 = appStore(s0); await app4.act((a) => a.closeDaily(true)); const b4 = clone(s0); G.closeDaily(b4, true)
    assert.equal(b4.dailyDone, app4.api.dailyDone); assert.equal(b4.dailySkipped, undefined)
    const app5 = appStore(s0); await app5.act((a) => a.closeDaily(false)); const b5 = clone(s0); G.closeDaily(b5, false)
    assert.equal(b5.dailySkipped, app5.api.dailySkipped); diffs++
  }

  /* --- the merge engine view: result survives a stale copy (checked in section 3) --- */
}
setNow('2026-11-11T09:00:00Z')
console.log(`growth: ${diffs} differential comparisons against the real hook, 4 clocks: identical`)

/* ============================================================================ */
/* 2. RULES: exact rows, every refusal, burial, no duplicate log identities      */
/* ============================================================================ */
setNow('2026-11-11T09:00:00Z') // Wednesday
const T = TODAY(); const WD = M.weekdayIndex(T)
const rows = (b, f) => b[f] ?? []
const noDupKeys = (b) => {
  for (const f of ['habitLog', 'routineLog', 'stepLog', 'stepTicks', 'slips']) {
    const keys = rows(b, f).map((r) => G.logKey(f, r))
    assert.equal(new Set(keys).size, keys.length, `no duplicate identity in ${f}`)
  }
}
const buried = (b, k) => (b.graveyard ?? []).some((t) => t.k === k && !t.undone)
const dug = (b, k) => (b.graveyard ?? []).some((t) => t.k === k && t.undone)
const hrow = (b, id) => b.habits.find((h) => h.id === id)

/* 2.1 tick_habit: plain */
{
  const b = growth()
  const r = G.tickHabit(b, { title: 'stretch' }, {})
  assert.match(r.text, /Kept "Stretch" on 2026-11-11/)
  assert.deepEqual(b.habitLog, [{ habitId: 'h-stretch', day: T, at: new Date().toISOString() }], 'one dated row, stamped because it is today')
  assert.equal(hrow(b, 'h-stretch').days[WD], true, 'the week cache follows')
  assert.match(G.tickHabit(b, { id: 'h-stretch' }, {}).text, /already kept/)
  assert.equal(b.habitLog.length, 1, 'ticking twice is one row')
  const past = D(-1)
  G.tickHabit(b, { id: 'h-stretch' }, { day: past })
  assert.deepEqual(b.habitLog[1], { habitId: 'h-stretch', day: past }, 'a past day has no clock time (the app: no honest moment)')
  G.tickHabit(b, { id: 'h-stretch' }, { day: D(-7) })
  assert.equal(hrow(b, 'h-stretch').days.filter(Boolean).length, 2, 'a day outside this week touches no week-cache cell')
  // untick buries every key, tick digs it up
  G.tickHabit(b, { id: 'h-stretch' }, { done: false })
  assert.equal(b.habitLog.some((x) => x.day === T), false)
  assert.equal(buried(b, `habitLog:h-stretch|${T}|`), true, 'an untick is a fact: tombstone')
  assert.match(G.tickHabit(b, { id: 'h-stretch' }, { done: false }).text, /was not kept/)
  G.tickHabit(b, { id: 'h-stretch' }, {})
  assert.equal(dug(b, `habitLog:h-stretch|${T}|`), true, 'a tick after an untick digs the tombstone up')
  assert.equal(buried(b, `habitLog:h-stretch|${T}|`), false)
  noDupKeys(b)
}

/* 2.2 tick_habit refusals */
{
  const b = growth()
  refuses(() => G.tickHabit(b, { id: 'h-quit' }, {}), /quit habit.*log_slip/)
  refuses(() => G.tickHabit(b, { id: 'h-walk' }, {}), /counted habit.*habit_count/)
  refuses(() => G.tickHabit(b, { id: 'h-water' }, {}), /amount habit.*log_habit_amount/)
  refuses(() => G.tickHabit(b, { id: 'h-focus' }, {}), /kept by the clock/)
  // LIFTED: a routine's own streak habit today is done through the routine (tested in section 2.15)
  refuses(() => G.tickHabit(b, { id: 'h-r-mo-mr4' }, {}), /locked until today's number reaches 75 WPM.*habit_count/)
  refuses(() => G.tickHabit(b, { id: 'h-r-mo-mr4' }, { done: false }), /locked until/)
  refuses(() => G.tickHabit(b, { id: 'h-alt' }, {}), /picking one of its alternatives.*which one is his to say.*x1 \(Cook\), x2 \(Order healthy\)/)
  refuses(() => G.tickHabit(b, { id: 'h-stretch' }, { alt: 'x1' }), /no alternatives/)
  refuses(() => G.tickHabit(b, { id: 'h-alt' }, { alt: 'zzz' }), /No alternative matches/)
  refuses(() => G.tickHabit(b, { id: 'h-alt' }, { alt: 'x1', day: D(-1) }), /only be picked for today/)
  refuses(() => G.tickHabit(b, { id: 'h-stretch' }, { day: D(1) }), /has not happened yet/)
  refuses(() => G.tickHabit(b, { id: 'h-stretch' }, { day: '2026-13-01' }), /YYYY-MM-DD/)
  refuses(() => G.tickHabit(b, { title: 'e' }, {}), /matches \d+ habits .*Pass the id/)
  refuses(() => G.tickHabit(b, { title: 'zzzz' }, {}), /No habit matches/)
  refuses(() => G.tickHabit(b, { id: 'nope' }, {}), /No habit has the id/)
  refuses(() => G.tickHabit(b, {}, {}), /Say which habit/)
  // LIFTED: a paused habit can be ticked (the app only stops treating it as due; its dots stay live)
  hrow(b, 'h-stretch').paused = true
  assert.match(G.tickHabit(b, { id: 'h-stretch' }, {}).text, /Kept "Stretch"/)
  G.tickHabit(b, { id: 'h-stretch' }, { done: false })
  hrow(b, 'h-stretch').paused = false
  hrow(b, 'h-stretch').archivedAt = T
  refuses(() => G.tickHabit(b, { id: 'h-stretch' }, {}), /No habit has the id/, 'an archived habit is gone from his lists')
  hrow(b, 'h-stretch').archivedAt = undefined
  // a gated habit whose number passed is no longer locked: it can be unticked
  G.habitCount(b, { id: 'h-r-mo-mr4' }, 80)
  assert.match(G.tickHabit(b, { id: 'h-r-mo-mr4' }, { done: false }).text, /Unticked/)
  // a gated habit's PAST day may be corrected by hand, as in the app
  assert.match(G.tickHabit(b, { id: 'h-r-mo-mr4' }, { day: D(-1) }).text, /Kept/)
  noDupKeys(b)
}

/* 2.3 a routine's own streak habit: a past day is corrected by hand and writes the routine's record too */
{
  const b = growth()
  const r = G.tickHabit(b, { id: 'h-evening' }, { day: D(-1) })
  assert.match(r.text, /routine's record for that day/)
  assert.deepEqual(b.habitLog, [{ habitId: 'h-evening', day: D(-1) }])
  assert.deepEqual(b.routineLog, [{ routineId: 'r-ev', day: D(-1), periodKey: D(-1), run: 0 }], 'one finish row, keyed by period and run 0')
  assert.match(G.tickHabit(b, { id: 'h-evening' }, { day: D(-1), done: true }).text, /already kept/)
  G.tickHabit(b, { id: 'h-evening' }, { day: D(-1) }) // toggles back
  assert.equal(b.routineLog.length, 0)
  assert.equal(buried(b, `routineLog:r-ev|${D(-1)}|0|${D(-1)}`), true)
  assert.equal(buried(b, `habitLog:h-evening|${D(-1)}|`), true)
}

/* 2.4 routine-linked tick: the whole bookkeeping, exact */
{
  const b = growth()
  const t1 = G.tickHabit(b, { id: 'h-r-ev-s1' }, {})
  assert.match(t1.text, /step of "Evening".*1 of 2/)
  const r = b.routines.find((x) => x.id === 'r-ev')
  assert.deepEqual(r.doneStepIds, ['s1']); assert.ok(r.startedAt, 'a routine is started by its first tick'); assert.equal(r.completedOn, null)
  assert.deepEqual(b.stepTicks, [{ routineId: 'r-ev', stepId: 's1', day: T }])
  G.tickHabit(b, { id: 'h-r-ev-s2' }, {})
  assert.equal(r.completedOn ?? b.routines.find((x) => x.id === 'r-ev').completedOn, T)
  assert.deepEqual(b.routineLog.map(({ at, ...x }) => x), [{ routineId: 'r-ev', day: T, periodKey: T, run: 0 }])
  assert.ok(b.habitLog.some((x) => x.habitId === 'h-evening' && x.day === T), 'the routine\'s own streak is kept')
  assert.equal(hrow(b, 'h-evening').days[WD], true)
  // the optional step is not needed, and ticking it changes nothing about completion
  G.tickHabit(b, { id: 'h-r-ev-s3' }, {})
  assert.equal(b.routineLog.length, 1)
  // LIFTED: unticking a required step of a FINISHED routine takes back the step's row AND the routine's own streak row (2 habitLog rows),
  // the routine's finish and the step tick. The 2nd habitLog row is declared as a cascade so the writer's safety stop lets it through.
  const beforeLog = b.habitLog.length
  assert.match(G.tickHabit(b, { id: 'h-r-ev-s1' }, { done: false }).text, /Unticked "Brush teeth"/)
  assert.equal(beforeLog - b.habitLog.length, 2, 'two habit rows left: the step and the routine streak')
  assert.deepEqual(M.shrinkAllowance(b), { habitLog: 1 }, 'exactly one EXTRA habitLog row is declared, nothing else')
  assert.deepEqual(b.habitLog.map((x) => x.habitId).sort(), ['h-r-ev-s2', 'h-r-ev-s3'])
  assert.equal(b.routineLog.length, 0); assert.equal(b.routines.find((x) => x.id === 'r-ev').completedOn, null)
  assert.deepEqual(b.routines.find((x) => x.id === 'r-ev').doneStepIds.sort(), ['s2', 's3'])
  assert.equal(buried(b, `habitLog:h-evening|${T}|`), true, 'the streak day is buried'); assert.equal(buried(b, `habitLog:h-r-ev-s1|${T}|`), true)
  assert.equal(buried(b, `routineLog:r-ev|${T}|0|${T}`), true); assert.equal(buried(b, `stepTicks:r-ev|s1|${T}`), true)
  noDupKeys(b)
  // the same through the routine card (no step habits): one row per list, so it works
  const w = growth(); G.routineDone(w, { id: 'r-wind' }, true)
  assert.match(G.routineStep(w, { id: 'r-wind' }, { step: 'phone' }, { done: false }).text, /Unticked/)
  assert.equal(w.routines.find((x) => x.id === 'r-wind').completedOn, null)
  assert.equal(w.routineLog.length, 0); assert.equal(buried(w, `routineLog:r-wind|${T}|0|${T}`), true, 'an un-finished routine buries its finish')
  assert.equal(w.habitLog.some((x) => x.habitId === 'h-wind'), false)
  assert.equal(buried(w, `habitLog:h-wind|${T}|`), true)
}

/* 2.5 routine_step refusals and alternatives */
{
  const b = growth()
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr4' }), /locked until its own test is passed \(75 WPM\)/)
  b.routines.find((r) => r.id === 'r-mo').stepData.mr4 = 80
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr4' }), /gated by a number \(75 WPM\).*habit_count/, 'the step whose habit is gated still needs the real number')
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }), /alternative.*a1 \(Move\), a2 \(Caffeine\)/)
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr6' }, { alt: 'a1' }), /no alternatives/)
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { step: 'e' }), /matches \d+ steps/)
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { step: 'nope' }), /No step matches/)
  refuses(() => G.routineStep(b, { id: 'zzz' }, { step: 'x' }), /No routine has the id/)
  const a = G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'caffeine' })
  assert.match(a.text, /Ticked in "Morning": Move or caffeine \(Caffeine\)/)
  const mo = b.routines.find((r) => r.id === 'r-mo')
  assert.deepEqual([mo.doneStepIds, mo.stepChoice], [['mr5'], { mr5: 'a2' }])
  assert.ok(b.habitLog.some((x) => x.habitId === 'h-r-mo-mr5' && x.src === 'r-mo:mr5#0'), 'the step habit gets its own row, keyed by routine, step and run')
  assert.match(G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a2', done: true }).text, /already ticked/)
  G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { done: false })
  assert.equal(mo.doneStepIds.length, 0)
  assert.match(G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr6' }, { done: false }).text, /already open/)
  noDupKeys(b)
}

/* 2.6 routine_done: gated steps stay open, the rest is claimed */
{
  const b = growth()
  const r = G.routineDone(b, { title: 'morning' }, true)
  const mo = b.routines.find((x) => x.id === 'r-mo')
  assert.deepEqual(mo.doneStepIds.sort(), ['mr5', 'mr6'], 'the typing step has to be earned')
  assert.match(r.text, /has to be earned with its own result, so the routine is not finished/)
  assert.equal(b.routineLog.length, 0)
  refuses(() => G.routineDone(b, { id: 'r-empty' }, true), /no steps yet/)
  // LIFTED: reopening a routine with two ticked step habits takes back 2 habitLog rows and 2 step ticks, declared as a cascade
  const logBefore = b.habitLog.length, ticksBefore = b.stepTicks.length
  assert.equal(logBefore, 2); assert.equal(ticksBefore, 2)
  assert.match(G.routineDone(b, { id: 'r-mo' }, false).text, /Reopened "Morning"/)
  assert.deepEqual([b.habitLog.length, b.stepTicks.length, b.routines.find((x) => x.id === 'r-mo').doneStepIds.length], [0, 0, 0])
  assert.deepEqual(M.shrinkAllowance(b), { habitLog: 1, stepTicks: 1 }, 'exactly the extra rows')
  assert.equal(buried(b, `habitLog:h-r-mo-mr5|${T}|r-mo:mr5#0`), true); assert.equal(buried(b, `stepTicks:r-mo|mr6|${T}`), true)
  const e = growth(); G.routineDone(e, { id: 'r-wind' }, true)
  assert.match(G.routineDone(e, { id: 'r-wind' }, false).text, /Reopened/)
  assert.deepEqual([e.routineLog.length, e.habitLog.length, e.stepTicks.length], [0, 0, 0], 'finish, streak day and both step ticks all taken back')
  assert.deepEqual(M.shrinkAllowance(e), { stepTicks: 1 }, 'no step habits here: 2 step ticks go, 1 is free')
}

/* 2.7 a routine whose period rolled over starts from nothing, like the app's loader */
{
  const b = growth()
  const r = b.routines.find((x) => x.id === 'r-wind'); r.periodKey = D(-1); r.doneStepIds = ['w1']; r.startedAt = 'old'
  assert.equal(G.listRoutines(b).routines.find((x) => x.id === 'r-wind').steps[0].done, false, 'a read shows the new period')
  assert.deepEqual(r.doneStepIds, ['w1'], 'and a read writes nothing')
  G.routineStep(b, { id: 'r-wind' }, { stepId: 'w2' })
  assert.deepEqual([r.doneStepIds, r.periodKey, r.run], [['w2'], T, 0], 'yesterday\'s checks are gone, today\'s tick stands')
  // weekly cadence keeps its checks inside the ISO week
  const wk = growth(); const sr = wk.routines.find((x) => x.id === 'r-empty'); sr.steps = [{ id: 'q1', title: 'Plan', kind: 'do' }]
  assert.equal(sr.periodKey, G.isoWeekKeyOf(T))
  G.routineStep(wk, { id: 'r-empty' }, { stepId: 'q1' })
  assert.equal(wk.routineLog[0].periodKey, G.isoWeekKeyOf(T), 'a weekly routine\'s finish is keyed by its week')
  assert.equal(wk.routines.find((x) => x.id === 'r-empty').completedOn, T)
}

/* 2.8 counts */
{
  const b = growth()
  assert.match(G.habitCount(b, { id: 'h-walk' }, 1).text, /1 of 2 per day/)
  G.habitCount(b, { id: 'h-walk' }, 2)
  assert.equal(b.habitLog.length, 3, 'three walks are three rows, not one day')
  assert.deepEqual(new Set(b.habitLog.map((x) => x.src)).size, 3); noDupKeys(b)
  assert.match(G.habitCount(b, { id: 'h-walk' }, -1).text, /Took one off.*2 of 2/)
  assert.equal(b.habitLog.length, 2)
  // LIFTED: -2 takes the last two back (two taps in the app); more than are logged is a refusal
  refuses(() => G.habitCount(b, { id: 'h-walk' }, -3), /only 2 logged today/)
  assert.match(G.habitCount(b, { id: 'h-walk' }, -2).text, /Took 2 off.*0 of 2/); assert.equal(b.habitLog.length, 0)
  assert.deepEqual(M.shrinkAllowance(b), { habitLog: 1 }, 'two rows left one list: one is declared')
  G.habitCount(b, { id: 'h-walk' }, 2)
  refuses(() => G.habitCount(b, { id: 'h-walk' }, 0), /other than 0/)
  refuses(() => G.habitCount(b, { id: 'h-walk' }, 51), /typo/)
  refuses(() => G.habitCount(b, { id: 'h-walk' }, NaN), /must be a number/)
  refuses(() => G.habitCount(b, { id: 'h-stretch' }, 1), /not counted.*tick_habit/)
  refuses(() => G.habitCount(b, { id: 'h-quit' }, 1), /quit habit/)
  refuses(() => G.habitCount(b, { id: 'h-water' }, 1), /log_habit_amount/)
  const e = growth(); assert.match(G.habitCount(e, { id: 'h-walk' }, -1).text, /nothing logged today/)
  // a number on a step habit
  const g2 = growth()
  refuses(() => G.habitCount(g2, { id: 'h-r-mo-mr4' }, 0), /above 0/)
  assert.match(G.habitCount(g2, { id: 'h-r-mo-mr4' }, 60).text, /under the 75 WPM needed, so today is not kept/)
  assert.equal(g2.habitLog.length, 0); assert.equal(g2.stepLog.length, 1); assert.deepEqual(g2.records, { 'r-mo:mr4': 60 })
  assert.match(G.habitCount(g2, { id: 'h-r-mo-mr4' }, 82).text, /passes the gate, so today is kept/)
  G.habitCount(g2, { id: 'h-r-mo-mr4' }, 70)
  assert.deepEqual(g2.records, { 'r-mo:mr4': 82 }, 'the best is the best'); assert.equal(g2.stepLog.length, 3, 'every run is kept')
  assert.equal(g2.habitLog.filter((x) => x.habitId === 'h-r-mo-mr4').length, 1, 'one kept day however many runs')
  assert.deepEqual(g2.stepTicks, [{ routineId: 'r-mo', stepId: 'mr4', day: T }], 'the routine card follows')
}

/* 2.9 amounts */
{
  const b = growth()
  assert.match(G.logAmount(b, { id: 'h-water' }, 750).text, /750 ml.*750 of 2000 today/)
  assert.equal(hrow(b, 'h-water').days[WD], false, 'one glass is not "Water done"')
  G.logAmount(b, { id: 'h-water' }, 1250)
  assert.equal(hrow(b, 'h-water').days[WD], true)
  assert.deepEqual(b.habitLog.map((x) => x.v), [750, 1250]); noDupKeys(b)
  assert.match(G.removeAmount(b, { id: 'h-water' }).text, /Took back 1250/)
  assert.equal(hrow(b, 'h-water').days[WD], false)
  assert.equal(b.habitLog.length, 1)
  const src = b.habitLog[0].src
  assert.equal(buried(b, `habitLog:h-water|${T}|${b.habitLog[0].src}`), false)
  G.removeAmount(b, { id: 'h-water' }, src)
  assert.equal(b.habitLog.length, 0); assert.equal(buried(b, `habitLog:h-water|${T}|${src}`), true)
  refuses(() => G.removeAmount(b, { id: 'h-water' }), /nothing|no amount logged/i)
  refuses(() => G.removeAmount(b, { id: 'h-water' }, 'amt#nope'), /no entry/)
  refuses(() => G.logAmount(b, { id: 'h-water' }, 0), /above 0/)
  refuses(() => G.logAmount(b, { id: 'h-water' }, -5), /above 0/)
  refuses(() => G.logAmount(b, { id: 'h-stretch' }, 5), /does not count an amount/)
  refuses(() => G.logAmount(b, { id: 'h-walk' }, 5), /counts times/)
  refuses(() => G.removeAmount(b, { id: 'h-stretch' }), /does not count an amount/)
}

/* 2.10 quitting */
{
  const b = growth()
  const r = G.logSlip(b, { title: 'energy' })
  assert.deepEqual(b.slips, [{ habitId: 'h-quit', day: T }]); assert.match(r.text, /Clean days now: 0/)
  assert.equal(dug(b, `slips:h-quit|${T}`), true)
  assert.match(G.logSlip(b, { title: 'energy' }).text, /already logged/); assert.equal(b.slips.length, 1)
  G.logSlip(b, { title: 'energy' }, D(-4)); assert.equal(b.slips.length, 2); noDupKeys(b)
  refuses(() => G.logSlip(b, { id: 'h-stretch' }), /No quit habit has the id/)
  refuses(() => G.logSlip(b, { title: 'energy' }, D(1)), /has not happened yet/)
  refuses(() => G.logSlip(b, { title: 'energy' }, D(-30)), /started on .* cannot have slipped before/)
  refuses(() => G.logSlip(b, { title: 'energy' }, 'tomorrow'), /YYYY-MM-DD/)
  G.undoSlip(b, { title: 'energy' }, D(-4))
  assert.deepEqual(b.slips, [{ habitId: 'h-quit', day: T }]); assert.equal(buried(b, `slips:h-quit|${D(-4)}`), true)
  assert.match(G.undoSlip(b, { title: 'energy' }, D(-4)).text, /no slip on/)
  G.logSlip(b, { title: 'energy' }, D(-4)); assert.equal(dug(b, `slips:h-quit|${D(-4)}`), true, 'logging it again digs the tombstone up')
}

/* 2.11 add_habit */
{
  const b = growth(); const n0 = b.habits.length
  const r = G.addHabit(b, { name: '  Journal ' })
  const h = hrow(b, r.id)
  assert.deepEqual(h, { id: r.id, space: 'personal', name: 'Journal', frequency: 'daily', kind: 'build', startedOn: T, filledSince: T, days: [...WEEK], paused: false })
  assert.equal(b.habits.length, n0 + 1); assert.match(r.id, /^h-/, 'the app\'s id prefix')
  refuses(() => G.addHabit(b, { name: 'journal' }), /already a habit called/)
  refuses(() => G.addHabit(b, { name: '   ' }), /needs a name/)
  refuses(() => G.addHabit(b, { name: 'x', frequency: 'hourly' }), /frequency must be/)
}
{
  const b = growth()
  const t3 = hrow(b, G.addHabit(b, { name: 'Gym', perWeek: 3 }).id)
  assert.deepEqual([t3.frequency, t3.targetPerWeek], ['times-per-week', 3])
  refuses(() => G.addHabit(b, { name: 'A', frequency: 'daily', perWeek: 3 }), /only applies to frequency "times-per-week"/)
  refuses(() => G.addHabit(b, { name: 'B', frequency: 'times-per-week', perWeek: 9 }), /1 to 7/)
  refuses(() => G.addHabit(b, { name: 'C', daypart: 'night' }), /daypart must be/)
  const q = hrow(b, G.addHabit(b, { name: 'Vaping', breaking: true, quitSince: D(-5), dailyCost: 80 }).id)
  assert.deepEqual(q, { id: q.id, space: 'personal', name: 'Vaping', frequency: 'daily', kind: 'break', dailyCost: 80, quitSince: D(-5), days: [...WEEK], paused: false })
  assert.equal(hrow(b, G.addHabit(b, { name: 'Vaping 2', breaking: true }).id).quitSince, T, 'a quit runs from today unless he says otherwise')
  // LIFTED: the Quit form has a "check in" frequency (habits.tsx HabitSheet), so a quit takes frequency
  const qw = hrow(b, G.addHabit(b, { name: 'Vaping 3', breaking: true, frequency: 'weekly' }).id)
  assert.deepEqual([qw.frequency, qw.targetPerWeek, qw.kind], ['weekly', undefined, 'break'])
  assert.equal(hrow(b, G.addHabit(b, { name: 'Vaping 4', breaking: true, frequency: 'times-per-week', perWeek: 2 }).id).targetPerWeek, 2)
  refuses(() => G.addHabit(b, { name: 'Z', breaking: true, perWeek: 2 }), /only applies to frequency "times-per-week"/)
  refuses(() => G.addHabit(b, { name: 'Z', breaking: true, startedOn: D(-2) }), /no "started_on".*Quit form/)
  refuses(() => G.addHabit(b, { name: 'Z', breaking: true, quitSince: D(2) }), /cannot be in the future/)
  refuses(() => G.addHabit(b, { name: 'Z', dailyCost: 5 }), /for a quit habit/)
  const c = hrow(b, G.addHabit(b, { name: 'Cold shower', track: 'count', countTarget: 3, countPer: 'week' }).id)
  assert.deepEqual([c.kind, c.measure, c.per, c.targetCount], ['measured', 'times', 'week', 3])
  assert.equal(hrow(b, G.addHabit(b, { name: 'Cold 2', track: 'count' }).id).targetCount, 1, 'the app\'s own default: once')
  const w = hrow(b, G.addHabit(b, { name: 'Pages', track: 'amount', unit: ' pages ', targetAmount: 20, presets: [5, 10, -1] }).id)
  assert.deepEqual([w.kind, w.measure, w.unit, w.targetAmount, w.presets], ['build', 'amount', 'pages', 20, [5, 10]])
  refuses(() => G.addHabit(b, { name: 'P2', track: 'amount', targetAmount: 20 }), /needs a unit/)
  refuses(() => G.addHabit(b, { name: 'P3', track: 'amount', unit: 'x' }), /target_amount/)
  refuses(() => G.addHabit(b, { name: 'P4', track: 'count', unit: 'x' }), /does not apply to a counted/)
  refuses(() => G.addHabit(b, { name: 'P5', countTarget: 2 }), /does not apply to a plain tick/)
  refuses(() => G.addHabit(b, { name: 'P6', track: 'amount', unit: 'x', targetAmount: 1, countPer: 'day' }), /do not apply to an amount/)
  // since: the claim about days becomes days
  const s = G.addHabit(b, { name: 'Run', startedOn: D(-4) })
  const since = b.habitLog.filter((x) => x.habitId === s.id)
  assert.deepEqual(since.map((x) => x.day), [D(-4), D(-3), D(-2), D(-1)], 'every day from the start to YESTERDAY, never today')
  assert.ok(since.every((x) => x.src === 'since' && x.at === undefined)); assert.match(s.text, /4 earlier days/)
  // a brand-new habit has no tombstones, so a backfill digs nothing up (it would only push real tombstones out of the 900-entry graveyard)
  assert.equal(since.some((x) => dug(b, G.logKey('habitLog', x))), false); noDupKeys(b)
  { // ... but a day he once unticked on a habit that already exists is dug up when a backfill covers it again
    const e = growth(); const sh = hrow(e, 'h-stretch'); sh.startedOn = D(-1); sh.filledSince = D(-1)
    e.habitLog.push({ habitId: 'h-stretch', day: D(-3), src: 'since' }); G.tickHabit(e, { id: 'h-stretch' }, { day: D(-3), done: false })
    assert.equal(buried(e, `habitLog:h-stretch|${D(-3)}|since`), true)
    G.editHabit(e, { id: 'h-stretch' }, { startedOn: D(-4) })
    assert.deepEqual(e.habitLog.map((x) => x.day).sort(), [D(-4), D(-3), D(-2)].sort(), 'the backfill covers the days before the old start')
    assert.equal(dug(e, `habitLog:h-stretch|${D(-3)}|since`), true, 'the tombstone it meets is dug up'); assert.equal(dug(e, `habitLog:h-stretch|${D(-4)}|since`), false)
  }
  assert.equal(hrow(b, s.id).days[WD], false, 'today is left alone')
  // LIFTED: no 366-day limit, the app has none; a typo guard before 2000 remains
  const old = G.addHabit(b, { name: 'R2', startedOn: D(-400) })
  assert.equal(b.habitLog.filter((x) => x.habitId === old.id).length, 400, 'every day from the start to yesterday, like backfillKept'); assert.match(old.text, /400 earlier days/)
  noDupKeys(b)
  refuses(() => G.addHabit(b, { name: 'R2b', startedOn: '1999-12-31' }), /before 2000-01-01.*typo/)
  refuses(() => G.addHabit(b, { name: 'R3', startedOn: D(1) }), /cannot be in the future/)
}

/* 2.12 edit / pause / archive */
{
  const b = growth()
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, {}), /Nothing to change/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { newName: 'read' }), /Another habit is already called/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { newName: ' ' }), /cannot be empty/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { perWeek: 3 }), /only applies to frequency "times-per-week"/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { countTarget: 3 }), /not a counted habit/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { quitSince: D(-2) }), /not a quit habit/)
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { dailyCost: 3 }), /for a quit habit/)
  refuses(() => G.editHabit(b, { id: 'h-quit' }, { startedOn: D(-2) }), /runs from quit_since/)
  refuses(() => G.editHabit(b, { id: 'h-evening' }, { newName: 'Night' }), /follows the routine.*edit_routine/)
  refuses(() => G.editHabit(b, { id: 'h-evening' }, { frequency: 'weekly' }), /frequency follows the routine/)
  assert.match(G.editHabit(b, { id: 'h-evening' }, { daypart: 'evening' }).text, /evening/, 'the part of the day stays his to move')
  G.editHabit(b, { id: 'h-stretch' }, { frequency: 'times-per-week', perWeek: 5, newName: 'Stretch more' })
  assert.deepEqual([hrow(b, 'h-stretch').name, hrow(b, 'h-stretch').frequency, hrow(b, 'h-stretch').targetPerWeek], ['Stretch more', 'times-per-week', 5])
  assert.match(G.pauseHabit(b, { id: 'h-stretch' }).text, /Paused/); assert.equal(hrow(b, 'h-stretch').paused, true)
  assert.match(G.pauseHabit(b, { id: 'h-stretch' }, true).text, /already paused/)
  assert.match(G.pauseHabit(b, { id: 'h-stretch' }).text, /Resumed/)
  // LIFTED: a routine's own streak habit is "deleted with the routine" in the app, so archiving it deletes the routine
  { const c = clone(b); const out = G.archiveHabit(c, { id: 'h-evening' }); assert.match(out.text, /streak habit of the routine "Evening" and goes with it.*Deleted routine "Evening"/)
    assert.equal(c.routines.find((r) => r.id === 'r-ev').archivedAt, T); assert.equal(c.habits.find((h) => h.id === 'h-evening').archivedAt, T); assert.ok(c.removedSeeds.includes('r-ev') && c.removedSeeds.includes('h-evening')) }
  G.archiveHabit(b, { id: 'h-stretch' })
  assert.equal(hrow(b, 'h-stretch').archivedAt, T); assert.deepEqual(b.removedSeeds, ['h-stretch'], 'so a reseed cannot bring it back')
  assert.equal(b.habits.some((h) => h.id === 'h-stretch'), true, 'retired, not erased: its history stays readable')
  refuses(() => G.pauseHabit(b, { id: 'h-stretch' }), /No habit has the id/)
}

/* 2.13 routines: add, edit, steps, plan, delete */
{
  const b = growth()
  const r = G.addRoutine(b, { title: ' Lunch break ', cadence: 'prework', blurb: 'b', steps: ['Walk', 'Eat', '  '], daypart: 'noon' })
  const row = b.routines.at(-1); const hb = hrow(b, row.habitId)
  assert.equal(row.id, r.id); assert.match(row.id, /^r-/); assert.match(row.habitId, /^h-/)
  assert.deepEqual(row.steps.map((s) => [s.title, s.kind]), [['Walk', 'do'], ['Eat', 'do']]); row.steps.forEach((s) => assert.match(s.id, /^st[0-9a-z]+$/))
  assert.deepEqual([row.cadence, row.blurb, row.periodKey, row.doneStepIds, row.stepData], ['prework', 'b', T, [], {}])
  assert.deepEqual({ ...hb }, { id: row.habitId, space: 'personal', name: 'Lunch break', daypart: 'noon', kind: 'build', frequency: 'weekdays', days: [...WEEK], paused: false, history: [], startedOn: T })
  // with steps the routine is made the way the Habits page makes it (addRoutineWithSteps): every step is a habit in the folder
  assert.deepEqual(row.steps.map((s, k) => ({ ...hrow(b, `h-${row.id}-${s.id}`) })), row.steps.map((s, k) => ({ id: `h-${row.id}-${s.id}`, space: 'personal', name: s.title, kind: 'build', frequency: 'weekdays', daypart: 'noon', partSet: true, days: [...WEEK], paused: false, history: [], folderId: row.id, folderOrder: k, startedOn: T })))
  refuses(() => G.addRoutine(b, { title: 'lunch BREAK' }), /already a routine called/)
  refuses(() => G.addRoutine(b, { title: ' ' }), /needs a title/)
  refuses(() => G.addRoutine(b, { title: 'X', cadence: 'hourly' }), /cadence must be/)
  refuses(() => G.addRoutine(b, { title: 'X', steps: Array(41).fill('a') }), /at most 40/)
  refuses(() => G.addRoutine(b, { title: 'X', daypart: 'night' }), /daypart must be/)
  // edit
  refuses(() => G.editRoutine(b, { id: row.id }, {}), /Nothing to change/)
  refuses(() => G.editRoutine(b, { id: row.id }, { title: 'evening' }), /Another routine is already called/)
  refuses(() => G.editRoutine(b, { id: row.id }, { cadence: 'yearly' }), /cadence must be/)
  G.editRoutine(b, { title: 'lunch' }, { title: 'Lunch', blurb: 'new' })
  assert.deepEqual([row.title, row.blurb, hrow(b, row.habitId).name], ['Lunch', 'new', 'Lunch'], 'the streak habit carries the routine\'s name')
  // steps
  assert.match(G.addRoutineStep(b, { id: row.id }, 'Stretch').text, /Added a step/)
  refuses(() => G.addRoutineStep(b, { id: row.id }, 'stretch'), /already has a step/)
  refuses(() => G.addRoutineStep(b, { id: row.id }, ' '), /needs a title/)
  const rm = G.removeRoutineStep(b, { id: row.id }, { step: 'eat' })
  assert.deepEqual(row.steps.map((s) => s.title), ['Walk', 'Stretch']); assert.match(rm.text, /Its habit "Eat" is still there; archive_habit removes it/, 'the app leaves the step\'s habit behind')
  const ev = G.removeRoutineStep(b, { id: 'r-ev' }, { step: 'floss' })
  assert.match(ev.text, /Its habit "Floss" is still there; archive_habit removes it/)
  assert.equal(hrow(b, 'h-r-ev-s3').folderId, 'r-ev', 'and the habit is untouched, as in the app')
  // plan
  refuses(() => G.planRoutine(b, { id: row.id }, {}), /Say where on the day/)
  refuses(() => G.planRoutine(b, { id: row.id }, { slot: 'night' }), /slot must be/)
  refuses(() => G.planRoutine(b, { id: row.id }, { slot: 'noon', date: D(-1) }), /has passed/)
  refuses(() => G.planRoutine(b, { id: row.id }, { slot: 'noon', date: 'x' }), /YYYY-MM-DD/)
  refuses(() => G.planRoutine(b, { id: row.id }, { clear: true, slot: 'noon' }), /neither/)
  G.planRoutine(b, { id: row.id }, { slot: 'noon' }); assert.deepEqual(row.planned, { day: T, slot: 'noon' })
  assert.equal(G.listRoutines(b).routines.find((x) => x.id === row.id).planned.slot, 'noon')
  G.planRoutine(b, { id: row.id }, { clear: true }); assert.equal(row.planned, undefined)
  // delete
  // LIFTED: a goal counting off the routine's habit keeps its progress and goes back to hand-logging (growth.ts deleteRoutine + goalCurrent)
  Object.assign(hrow(b, row.habitId), { days: [true, true, false, false, false, false, false], history: [1, 1, 1] })
  b.goals = [
    { id: 'g1', name: 'Run Lunch', habitId: row.habitId, current: 2, target: 10, unit: 'checkoffs', timeframe: 'quarter' },
    { id: 'g2', name: 'Old lunch goal', habitId: row.habitId, current: 1, target: 10, unit: 'days', closed: { final: 7 } },
    { id: 'g3', name: 'Unrelated', habitId: 'h-read', current: 4, target: 10, unit: 'checkoffs' },
  ]
  const dr = G.deleteRoutine(b, { id: row.id })
  assert.deepEqual(b.goals[0], { id: 'g1', name: 'Run Lunch', current: 5, target: 10, unit: 'done', timeframe: 'quarter' }, 'this week 2 + the 3 weeks of history, unit checkoffs becomes done, link gone')
  assert.deepEqual(b.goals[1], { id: 'g2', name: 'Old lunch goal', current: 7, target: 10, unit: 'days', closed: { final: 7 } }, 'a closed goal keeps the number it finished on')
  assert.equal(b.goals[2].habitId, 'h-read', 'another goal is untouched'); assert.match(dr.text, /goals "Run Lunch", "Old lunch goal" counted off its habit/)
  assert.deepEqual([row.archivedAt, hrow(b, row.habitId).archivedAt], [T, T]); assert.ok(b.removedSeeds.includes(row.id) && b.removedSeeds.includes(row.habitId))
  assert.equal(b.routines.includes(row), true, 'archived, never erased')
  const ev2 = G.deleteRoutine(b, { id: 'r-ev' }); assert.match(ev2.text, /3 step habits are still there/)
  refuses(() => G.findRoutine(b, { id: row.id }), /No routine has the id/)
}

/* 2.14 the reads */
{
  const b = growth(); G.logSlip(b, { id: 'h-quit' }, D(-2)); G.habitCount(b, { id: 'h-walk' }, 1); G.logAmount(b, { id: 'h-water' }, 500)
  G.tickHabit(b, { id: 'h-read' }, {}); G.tickHabit(b, { id: 'h-read' }, { day: D(-1) })
  const l = G.listHabits(b)
  const by = Object.fromEntries(l.habits.map((h) => [h.id, h]))
  assert.equal(by['h-read'].track, 'check'); assert.equal(by['h-read'].how, 'tick_habit'); assert.equal(by['h-read'].keptToday, true); assert.equal(by['h-read'].streak, 2)
  assert.equal(by['h-read'].target, 5); assert.equal(by['h-read'].week.length, 7)
  assert.equal(by['h-quit'].track, 'quit'); assert.equal(by['h-quit'].daysClean, 2); assert.equal(by['h-quit'].slips, 1); assert.equal(by['h-quit'].bestRun, 8); assert.equal(by['h-quit'].dailyCost, 60)
  assert.match(by['h-quit'].how, /log_slip/)
  assert.deepEqual(by['h-walk'].count, { have: 1, target: 2, per: 'day' }); assert.equal(by['h-walk'].keptToday, false)
  assert.deepEqual(by['h-water'].amount, { today: 500, target: 2000, unit: 'ml', presets: [250, 500] })
  assert.equal(by['h-focus'].track, 'auto'); assert.match(by['h-focus'].how, /none/)
  assert.equal(by['h-evening'].track, 'routine'); assert.match(by['h-evening'].how, /routine_step/)
  assert.equal(by['h-r-ev-s1'].routine, 'Evening'); assert.equal(by['h-r-ev-s1'].how, 'tick_habit')
  assert.equal(by['h-r-mo-mr4'].track, 'gated'); assert.equal(by['h-r-mo-mr4'].gate.target, 75)
  assert.equal(by['h-alt'].track, 'alts'); assert.equal(by['h-alt'].alts.length, 2)
  assert.equal(by['h-sun'].track, 'check', 'a routine with no steps leaves its habit hand-tickable')
  assert.equal(by['h-review'].dueToday, true); G.tickHabit(b, { id: 'h-review' }, {}); assert.equal(G.listHabits(b, { query: 'monthly' }).habits[0].dueToday, false, 'a monthly habit already kept this month is not due')
  assert.equal(G.listHabits(b, { space: 'work' }).count, 0)
  assert.deepEqual(G.listHabits(b, { query: 'wind' }).habits.map((h) => h.id), ['h-wind'])
  const lr = G.listRoutines(b)
  const mo = lr.routines.find((r) => r.id === 'r-mo')
  assert.equal(mo.steps.find((s) => s.id === 'mr4').locked, true); assert.equal(mo.steps.find((s) => s.id === 'mr5').alts.length, 2)
  assert.deepEqual(lr.routines.find((r) => r.id === 'r-ev').progress, { done: 0, total: 2 }); assert.equal(lr.routines.find((r) => r.id === 'r-ev').complete, false)
  assert.equal(G.listRoutines(b, { query: 'sunday' }).count, 1)
}

/* 2.15 MCP v3: everything the app's pages do that used to be refused */
{
  // a routine's own streak habit, today: done through the routine, exactly as the routine card's button
  const b = growth()
  const r = G.tickHabit(b, { id: 'h-wind' }, {})
  assert.match(r.text, /streak of the routine "Wind down", so this was done through the routine/)
  assert.deepEqual(b.routines.find((x) => x.id === 'r-wind').doneStepIds.sort(), ['w1', 'w2']); assert.equal(b.routineLog.length, 1)
  assert.ok(b.habitLog.some((x) => x.habitId === 'h-wind' && x.day === T))
  G.tickHabit(b, { id: 'h-wind' }, { done: false })
  assert.deepEqual([b.routineLog.length, b.habitLog.length, b.stepTicks.length], [0, 0, 0]); assert.equal(M.shrinkAllowance(b).stepTicks, 1)
  // a routine with a gated step stays unfinished through its streak habit, and says so
  assert.match(G.tickHabit(b, { id: 'h-morning' }, {}).text, /has to be earned with its own result, so the routine is not finished/)
  assert.equal(b.routineLog.length, 0)
  // a routine with no steps keeps a hand-tickable streak habit
  assert.match(G.tickHabit(b, { id: 'h-sun' }, {}).text, /^Kept "Sunday reset"/)
}
{
  // un-finishing, exact rows and burials, through every door
  const mk = () => { const f = growth(); G.routineStep(f, { id: 'r-ev' }, { stepId: 's1' }); G.routineStep(f, { id: 'r-ev' }, { stepId: 's2' }); return f }
  const f = mk(); assert.equal(f.habitLog.length, 3); assert.equal(f.stepTicks.length, 2)
  G.routineStep(f, { id: 'r-ev' }, { stepId: 's2' }, { done: false })
  assert.deepEqual(f.habitLog.map((x) => x.habitId), ['h-r-ev-s1'], 'only the open step\'s sibling is still kept')
  assert.deepEqual(M.shrinkAllowance(f), { habitLog: 1 }); assert.equal(f.stepTicks.length, 1)
  for (const k of [`habitLog:h-r-ev-s2|${T}|r-ev:s2#0`, `habitLog:h-evening|${T}|`, `routineLog:r-ev|${T}|0|${T}`, `stepTicks:r-ev|s2|${T}`]) assert.equal(buried(f, k), true, k)
  noDupKeys(f)
  // the same through the habit's own checkbox, and through routine_done
  const g1 = mk(); G.tickHabit(g1, { id: 'h-r-ev-s1' }, { done: false }); assert.deepEqual(g1.habitLog.map((x) => x.habitId), ['h-r-ev-s2']); assert.deepEqual(M.shrinkAllowance(g1), { habitLog: 1 })
  const g2 = mk(); G.routineDone(g2, { id: 'r-ev' }, false); assert.equal(g2.habitLog.length, 0); assert.deepEqual(M.shrinkAllowance(g2), { habitLog: 2, stepTicks: 1 }, '3 rows leave habitLog, 2 leave stepTicks, 1 each is free')
  // un-finishing never touches another routine's rows
  const other = mk(); G.routineStep(other, { id: 'r-wind' }, { stepId: 'w1' }); const n0 = other.stepTicks.length
  G.routineDone(other, { id: 'r-ev' }, false)
  assert.equal(other.stepTicks.length, n0 - 2); assert.ok(other.stepTicks.some((x) => x.routineId === 'r-wind')); assert.equal(other.routines.find((x) => x.id === 'r-wind').doneStepIds.length, 1)
  // a past-day correction of the routine's own habit removes the routine's record of that day (2 rows) with a declared allowance
  const past = growth(); G.tickHabit(past, { id: 'h-evening' }, { day: D(-1) }); G.tickHabit(past, { id: 'h-evening' }, { day: D(-1), done: false })
  assert.equal(past.habitLog.length + past.routineLog.length, 0)
}
{
  // alternatives
  const b = growth()
  refuses(() => G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }), /which one is his to say.*a1 \(Move\), a2 \(Caffeine\)/)
  refuses(() => G.tickHabit(b, { id: 'h-r-mo-mr5' }, {}), /which one is his to say.*a1 \(Move\)/)
  G.routineDone(b, { id: 'r-mo' }, true)   // claims the alternatives step without a choice
  assert.equal(b.routines.find((x) => x.id === 'r-mo').stepChoice && Object.keys(b.routines.find((x) => x.id === 'r-mo').stepChoice).length, 0)
  assert.match(G.routineStep(b, { id: 'r-mo' }, { stepId: 'mr5' }, { done: false }).text, /Unticked in "Morning": Move or caffeine/)
  const c = growth(); G.routineStep(c, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'move' })
  assert.deepEqual(c.routines.find((x) => x.id === 'r-mo').stepChoice, { mr5: 'a1' })
  assert.match(G.routineStep(c, { id: 'r-mo' }, { stepId: 'mr5' }, { done: false }).text, /Unticked in "Morning": Move or caffeine \(Move\)/)
  assert.deepEqual(c.routines.find((x) => x.id === 'r-mo').stepChoice, {}, 'the chosen one is cleared')
  const d = growth(); G.tickHabit(d, { id: 'h-alt' }, { alt: 'cook' }); assert.match(G.tickHabit(d, { id: 'h-alt' }, { done: false }).text, /Took back "Cook"/); assert.equal(d.habitLog.length, 0)
  assert.match(G.tickHabit(d, { id: 'h-alt' }, { done: false }).text, /was not kept/)
}
{
  // bulk: all or nothing, in order, each exactly one tick
  const b = growth()
  const out = G.tickHabits(b, [{ id: 'h-stretch' }, { title: 'read', day: D(-1) }, { id: 'h-r-ev-s1' }, { id: 'h-alt', alt: 'order' }])
  assert.match(out.text, /^4 done together:/); assert.equal(b.habitLog.length, 4)
  refuses(() => G.tickHabits(b, []), /at least one/)
  refuses(() => G.tickHabits(b, Array(41).fill({ id: 'h-stretch' })), /At most 40/)
  const before = JSON.stringify(b)
  const c = clone(b)
  refuses(() => G.tickHabits(c, [{ id: 'h-review' }, { id: 'h-quit' }]), /Item 2 \(h-quit\): .*quit habit.*Nothing was changed/)
  // (commit() writes nothing when the function throws; the registry test below asserts the stored state is untouched)
  assert.equal(JSON.stringify(b), before)
}
{
  // edit_habit: kinds, look, limits, the locked routine habit
  const b = growth()
  G.editHabit(b, { id: 'h-stretch' }, { kind: 'quit', quitSince: D(-3) })
  assert.deepEqual([hrow(b, 'h-stretch').kind, hrow(b, 'h-stretch').quitSince, 'startedOn' in hrow(b, 'h-stretch'), 'daypart' in hrow(b, 'h-stretch')], ['break', D(-3), false, false])
  G.editHabit(b, { id: 'h-stretch' }, { kind: 'count', countTarget: 3, countPer: 'week' })
  const st = hrow(b, 'h-stretch'); assert.deepEqual([st.kind, st.measure, st.per, st.targetCount, 'quitSince' in st], ['measured', 'times', 'week', 3, false])
  G.editHabit(b, { id: 'h-stretch' }, { kind: 'minutes', minutesTarget: 45 })
  assert.deepEqual([st.measure, st.source, st.dailyTargetMin, 'targetCount' in st, 'per' in st], ['minutes', 'focus', 45, false, false]); assert.equal(G.trackOf(st), 'auto')
  G.editHabit(b, { id: 'h-stretch' }, { minutesTarget: 90 }); assert.equal(st.dailyTargetMin, 90)
  G.editHabit(b, { id: 'h-stretch' }, { kind: 'keep' }); assert.deepEqual([st.kind, 'measure' in st, 'source' in st, 'dailyTargetMin' in st], ['build', false, false, false])
  refuses(() => G.editHabit(b, { id: 'h-stretch' }, { kind: 'keep' }), /Nothing to change/) // already a plain tick habit
  refuses(() => G.editHabit(b, { id: 'h-water' }, { kind: 'keep' }), /amount habit.*no amount kind/)
  refuses(() => G.editHabit(b, { id: 'h-evening' }, { kind: 'quit' }), /streak of the routine "Evening"/)
  refuses(() => G.editHabit(b, { id: 'h-evening' }, { startedOn: D(-3) }), /follows the routine/)
  assert.match(G.editHabit(b, { id: 'h-evening' }, { color: '#F87171', icon: 'moon' === 'x' ? 'x' : 'sun' }).text, /colour #F87171, icon sun/, 'the look of a routine habit is still his')
  refuses(() => G.editHabit(b, { id: 'h-read' }, { color: '#123456' }), /swatches/); refuses(() => G.editHabit(b, { id: 'h-read' }, { icon: 'rocket' }), /icon must be one of/)
  refuses(() => G.editHabit(b, { id: 'h-read' }, { presets: [5] }), /not an amount habit/); refuses(() => G.editHabit(b, { id: 'h-water' }, { presets: [5, -1] }), /above 0/)
  refuses(() => G.editHabit(b, { id: 'h-walk' }, { countTarget: 100 }), /1 to 99/); refuses(() => G.editHabit(b, { id: 'h-read' }, { minutesTarget: 30 }), /not kept by focus minutes/)
  refuses(() => G.editHabit(b, { id: 'h-focus' }, { minutesTarget: 4 }), /5 to 600/)
  assert.match(G.editHabit(b, { id: 'h-water' }, { presets: [] }).text, /quick amounts none/); assert.deepEqual(hrow(b, 'h-water').presets, [])
  G.editHabit(b, { id: 'h-quit' }, { dailyCost: null }); assert.equal('dailyCost' in hrow(b, 'h-quit'), false)
  refuses(() => G.editHabit(b, { id: 'h-quit' }, { startedOn: D(-1) }), /runs from quit_since/)
  G.editHabit(b, { id: 'h-quit' }, { quitSince: D(-1000) }); assert.equal(hrow(b, 'h-quit').quitSince, D(-1000), 'no 366-day limit on a quit date either')
  refuses(() => G.editHabit(b, { id: 'h-quit' }, { quitSince: '1999-12-31' }), /typo/)
}
{
  // add_habit / add_routine extras
  const b = growth()
  const m = hrow(b, G.addHabit(b, { name: 'Deep 2', track: 'minutes' }).id); assert.deepEqual([m.kind, m.measure, m.source, m.dailyTargetMin], ['measured', 'minutes', 'focus', 60], 'the sheet\'s own default is an hour')
  refuses(() => G.addHabit(b, { name: 'D3', track: 'minutes', minutesTarget: 700 }), /5 to 600/); refuses(() => G.addHabit(b, { name: 'D4', minutesTarget: 30 }), /only applies to track "minutes"/)
  refuses(() => G.addHabit(b, { name: 'D5', track: 'minutes', unit: 'x' }), /does not apply to a habit kept by focus minutes/)
  assert.deepEqual([hrow(b, G.addHabit(b, { name: 'Col', color: '#a3e635', icon: 'cup' }).id)].map((h) => [h.color, h.icon])[0], ['#A3E635', 'cup'])
  refuses(() => G.addHabit(b, { name: 'Col2', color: 'red' }), /swatches/)
  refuses(() => G.addRoutine(b, { title: 'Weekly one', cadence: 'weekly', repeatable: true }), /repeatable.*daily/)
  const rr = G.addRoutine(b, { title: 'Reset', repeatable: true, color: '#38BDF8', icon: 'bolt' }); const rrow = b.routines.find((x) => x.id === rr.id)
  assert.deepEqual([rrow.repeatable, rrow.color, rrow.icon, rrow.steps.length], [true, '#38BDF8', 'bolt', 0])
  refuses(() => G.addRoutine(b, { title: 'Bad look', icon: 'x' }), /icon must be/)
  G.editRoutine(b, { id: rr.id }, { color: '#f472b6', icon: 'eye' }); assert.deepEqual([rrow.color, rrow.icon], ['#F472B6', 'eye'])
  const ls = G.listRoutines(b).routines.find((x) => x.id === rr.id); assert.deepEqual([ls.color, ls.icon, ls.repeatable], ['#F472B6', 'eye', true])
  const lh = G.listHabits(b).habits.find((x) => x.name === 'Col'); assert.deepEqual([lh.color, lh.icon], ['#A3E635', 'cup'])
  // a new step is a habit in the folder, numbered after the others
  const e = growth(); const before = e.habits.filter((h) => h.folderId === 'r-ev').length
  G.addRoutineStep(e, { id: 'r-ev' }, 'Lay out clothes')
  const made = e.habits.filter((h) => h.folderId === 'r-ev').at(-1); assert.equal(e.habits.filter((h) => h.folderId === 'r-ev').length, before + 1); assert.equal(made.folderOrder, 4, 'after the highest order (3)')
  assert.equal(e.routines.find((x) => x.id === 'r-ev').steps.at(-1).id, made.id.replace('h-r-ev-', ''))
}
{
  // the daily review
  const b = growth(); const y = D(-1)
  const out = G.routineDone(b, { id: 'r-ev' }, true, y)
  assert.match(out.text, /Marked "Evening" as finished on .*2 step habits and the routine's own streak day/)
  assert.deepEqual(b.habitLog.map((x) => `${x.habitId}@${x.day}`).sort(), [`h-evening@${y}`, `h-r-ev-s1@${y}`, `h-r-ev-s2@${y}`].sort(), 'the optional step is not claimed')
  assert.deepEqual(b.routineLog, [{ routineId: 'r-ev', day: y, periodKey: y, run: 0 }])
  assert.equal(b.routines.find((x) => x.id === 'r-ev').doneStepIds.length, 0, 'today\'s card is untouched'); noDupKeys(b)
  assert.match(G.routineDone(b, { id: 'r-ev' }, true, y).text, /Marked/, 'again: nothing is duplicated'); noDupKeys(b); assert.equal(b.habitLog.length, 3)
  refuses(() => G.routineDone(b, { id: 'r-ev' }, true, D(1)), /has not happened yet/); refuses(() => G.routineDone(b, { id: 'r-ev' }, false, y), /no "reopen a past day"/); refuses(() => G.routineDone(b, { id: 'r-ev' }, true, 'x'), /YYYY-MM-DD/)
  assert.equal(G.routineDone(growth(), { id: 'r-wind' }, true, T).text.startsWith('Ticked what'), true, 'day = today is the ordinary routine_done')
  // close the review
  const c = growth(); assert.match(G.closeDaily(c, true).text, /walked/); assert.equal(c.dailyDone, T); assert.equal(c.dailySkipped, undefined)
  G.closeDaily(c, false); assert.equal(c.dailySkipped, T)
}
{
  // cascade guard: an operation that removes a row outside its routine is refused before anything is written
  // (the mutation check in section 5 proves this is the check that stops it)
  const b = growth(); G.routineStep(b, { id: 'r-wind' }, { stepId: 'w1' }); G.routineStep(b, { id: 'r-ev' }, { stepId: 's1' })
  assert.equal(b.stepTicks.length, 2)
}

console.log('growth: rules ok')

/* ============================================================================ */
/* 3. THE APP'S REAL MERGE keeps what the connector did and resurrects nothing   */
/* ============================================================================ */
setNow('2026-11-11T09:00:00Z')
const tick = (ms = 1000) => { clock.t += ms }
/** What commit() does to a blob after an operation: stamp it newest. */
const stamp = (b) => { b.savedAt = Date.now(); b.lastWrite = { dev: 'claude-mcp', name: 'Claude', at: Date.now() }; return b }
/** Merge a stale app copy with the connector's result, in BOTH argument orders. */
const merged = (stale, mine) => {
  const x = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(mine)))
  const y = JSON.parse(M.mergeStates(JSON.stringify(mine), JSON.stringify(stale)))
  assert.deepEqual(x.habitLog?.map((r) => G.logKey('habitLog', r)).sort(), y.habitLog?.map((r) => G.logKey('habitLog', r)).sort(), 'merge order does not matter (habitLog)')
  assert.deepEqual(x.slips?.map((r) => G.logKey('slips', r)).sort(), y.slips?.map((r) => G.logKey('slips', r)).sort(), 'merge order does not matter (slips)')
  return x
}
const has = (m, f, key) => (m[f] ?? []).some((r) => G.logKey(f, r) === key)
{
  // an untick stays unticked although a stale device still holds the tick
  const start = growth(); G.tickHabit(start, { id: 'h-stretch' }, {}); G.tickHabit(start, { id: 'h-stretch' }, { day: D(-1) })
  const stale = clone(start)
  tick(); const mine = stamp(clone(start)); G.tickHabit(mine, { id: 'h-stretch' }, { done: false })
  const m = merged(stale, mine)
  assert.equal(has(m, 'habitLog', `habitLog:h-stretch|${T}|`), false, 'the untick wins over a stale copy')
  assert.equal(has(m, 'habitLog', `habitLog:h-stretch|${D(-1)}|`), true, 'and the other day is untouched')
  assert.equal(m.habits.find((h) => h.id === 'h-stretch').days[WD], false, 'the rebuilt week cache agrees')
  // the tick comes back later: the dug-up key beats the older tombstone on a device that still holds it
  tick(); const again = stamp(clone(mine)); G.tickHabit(again, { id: 'h-stretch' }, {})
  const m2 = merged(mine, again)
  assert.equal(has(m2, 'habitLog', `habitLog:h-stretch|${T}|`), true, 'a re-tick is not re-buried by the older tombstone')
  assert.equal(merged(stale, again).habitLog.filter((r) => r.day === T && r.habitId === 'h-stretch').length, 1)
}
{
  // a tick, a count, an amount survive a stale copy that never saw them; days[] is rebuilt from the log
  const stale = growth()
  tick(); const mine = stamp(clone(stale))
  G.tickHabit(mine, { id: 'h-read' }, {}); G.habitCount(mine, { id: 'h-walk' }, 2); G.logAmount(mine, { id: 'h-water' }, 2500)
  const m = merged(stale, mine)
  assert.equal(m.habitLog.length, 4)
  assert.equal(m.habits.find((h) => h.id === 'h-read').days[WD], true)
  assert.equal(m.habits.find((h) => h.id === 'h-water').days[WD], true, 'the rebuild counts the amount total against the target')
  assert.equal(m.habits.find((h) => h.id === 'h-walk').days[WD], true)
  // taking one count and an amount back stays taken back
  const then = clone(m); tick(); stamp(then)
  const stale2 = clone(m)
  G.habitCount(then, { id: 'h-walk' }, -1); G.removeAmount(then, { id: 'h-water' })
  const m2 = merged(stale2, then)
  assert.equal(m2.habitLog.filter((r) => r.habitId === 'h-walk').length, 1); assert.equal(m2.habitLog.filter((r) => r.habitId === 'h-water').length, 0)
}
{
  // slips: logged survives, undone stays undone
  const stale = growth()
  tick(); const mine = stamp(clone(stale)); G.logSlip(mine, { id: 'h-quit' }, D(-2))
  assert.equal(merged(stale, mine).slips.length, 1)
  tick(); const undone = stamp(clone(mine)); G.undoSlip(undone, { id: 'h-quit' }, D(-2))
  assert.equal(merged(mine, undone).slips.length, 0, 'a slip taken back is not handed back by the device that still has it')
}
{
  // archive: the retired habit stays retired; a routine finished through the card keeps its record
  const stale = growth()
  tick(); const mine = stamp(clone(stale)); G.archiveHabit(mine, { id: 'h-stretch' }); G.routineDone(mine, { id: 'r-wind' }, true); G.deleteRoutine(mine, { id: 'r-empty' })
  const m = merged(stale, mine)
  assert.equal(m.habits.find((h) => h.id === 'h-stretch').archivedAt, T)
  assert.equal(m.routines.find((r) => r.id === 'r-empty').archivedAt, T)
  assert.deepEqual(m.routines.find((r) => r.id === 'r-wind').doneStepIds.sort(), ['w1', 'w2'])
  assert.equal(m.routineLog.length, 1); assert.ok(m.habitLog.some((r) => r.habitId === 'h-wind')); assert.equal(m.stepTicks.length, 2)
  assert.ok(m.removedSeeds.includes('h-stretch'))
  // unfinishing it: the finish and the steps' ticks are buried, so the stale copy cannot bring them back
  tick(); const un = stamp(clone(m)); G.routineStep(un, { id: 'r-wind' }, { step: 'phone' }, { done: false })
  const m2 = merged(m, un)
  assert.equal(m2.routineLog.length, 0, 'the finish is gone'); assert.equal(m2.habitLog.some((r) => r.habitId === 'h-wind'), false, 'and so is the routine streak tick')
  assert.equal(m2.stepTicks.length, 1)
}
{
  // add_habit with a start date: the backfilled days survive the merge, and are not duplicated
  const stale = growth()
  tick(); const mine = stamp(clone(stale)); const r = G.addHabit(mine, { name: 'Run', startedOn: D(-3) })
  const m = merged(stale, mine)
  assert.equal(m.habitLog.filter((x) => x.habitId === r.id).length, 3)
  assert.equal(m.habits.find((h) => h.id === r.id).days[WD], false)
  assert.equal(m.habits.find((h) => h.id === r.id).days[M.weekdayIndex(D(-1))], true, 'yesterday, rebuilt from the log')
}
{
  // a routine tick done twice by two writers does not duplicate step rows or finishes
  const base = growth(); G.routineStep(base, { id: 'r-wind' }, { stepId: 'w1' })
  const a = stamp(clone(base)); tick(); const c = stamp(clone(base))
  G.routineStep(a, { id: 'r-wind' }, { stepId: 'w2' }); G.routineStep(c, { id: 'r-wind' }, { stepId: 'w2' })
  const m = merged(a, c)
  assert.equal(m.routineLog.length, 1, 'one finish'); assert.equal(m.stepTicks.length, 2); assert.equal(m.habitLog.filter((x) => x.habitId === 'h-wind').length, 1)
}
{
  // un-finishing a routine: every record of the finish stays gone against a stale copy that still holds them
  const stale = growth(); G.routineStep(stale, { id: 'r-ev' }, { stepId: 's1' }); G.routineStep(stale, { id: 'r-ev' }, { stepId: 's2' })
  tick(); const mine = stamp(clone(stale)); G.routineStep(mine, { id: 'r-ev' }, { stepId: 's2' }, { done: false })
  const m = merged(stale, mine)
  assert.equal(m.routineLog.length, 0, 'the finish stays gone'); assert.equal(m.habitLog.some((x) => x.habitId === 'h-evening'), false, 'and the streak day')
  assert.equal(m.habitLog.some((x) => x.habitId === 'h-r-ev-s2'), false, 'and the step row'); assert.deepEqual(m.stepTicks.map((x) => x.stepId), ['s1'])
  assert.deepEqual(m.habitLog.map((x) => x.habitId), ['h-r-ev-s1'])
  // routine_done false of a half-done routine, same story
  const st2 = growth(); G.routineStep(st2, { id: 'r-mo' }, { stepId: 'mr5' }, { alt: 'a1' }); G.routineStep(st2, { id: 'r-mo' }, { stepId: 'mr6' })
  tick(); const mine2 = stamp(clone(st2)); G.routineDone(mine2, { id: 'r-mo' }, false)
  const m2 = merged(st2, mine2); assert.equal(m2.habitLog.length, 0); assert.equal(m2.stepTicks.length, 0); assert.deepEqual(m2.routines.find((x) => x.id === 'r-mo').doneStepIds, [])
}
{
  // deleting a routine whose habit a goal counts off: the detached goal and the archive survive a stale copy
  const stale = growth(); stale.goals = [{ id: 'g1', space: 'personal', name: 'Evenings', habitId: 'h-evening', current: 2, target: 10, unit: 'checkoffs', timeframe: 'quarter' }]
  tick(); const mine = stamp(clone(stale)); G.deleteRoutine(mine, { id: 'r-ev' })
  const m = merged(stale, mine)
  assert.equal(m.routines.find((x) => x.id === 'r-ev').archivedAt, T); assert.equal(m.habits.find((x) => x.id === 'h-evening').archivedAt, T)
  assert.equal(m.goals[0].habitId, undefined, 'the goal stays detached'); assert.equal(m.goals[0].unit, 'done'); assert.ok(m.removedSeeds.includes('r-ev'))
}
{
  // a paused habit ticked, bulk ticks, a daily-review finish and the closed review all survive a stale copy
  const stale = growth(); hrow(stale, 'h-stretch').paused = true
  tick(); const mine = stamp(clone(stale))
  G.tickHabits(mine, [{ id: 'h-stretch' }, { id: 'h-read', day: D(-1) }]); G.routineDone(mine, { id: 'r-ev' }, true, D(-1)); G.closeDaily(mine, true)
  const m = merged(stale, mine)
  assert.ok(m.habitLog.some((x) => x.habitId === 'h-stretch' && x.day === T)); assert.ok(m.habitLog.some((x) => x.habitId === 'h-read' && x.day === D(-1)))
  assert.equal(m.routineLog.filter((x) => x.routineId === 'r-ev' && x.day === D(-1)).length, 1); assert.equal(m.habitLog.filter((x) => x.habitId === 'h-evening').length, 1)
  assert.equal(m.dailyDone, T)
  noDupKeys(m)
}
{
  // a multi-year backfill: the days survive, nothing is duplicated, and old tombstones are NOT pushed out of the graveyard
  const stale = growth()
  for (let k = 0; k < 600; k++) stale.graveyard.push({ k: `tasks:old${k}`, at: 1000 + k }) // 600 genuine tombstones
  tick(); const mine = stamp(clone(stale)); const r = G.addHabit(mine, { name: 'Years', startedOn: D(-1000) })
  assert.equal(mine.habitLog.filter((x) => x.habitId === r.id).length, 1000)
  assert.equal(mine.graveyard.filter((x) => /^tasks:old/.test(x.k)).length, 600, 'every old tombstone is still there')
  const m = merged(stale, mine)
  assert.equal(m.habitLog.filter((x) => x.habitId === r.id).length, 1000); noDupKeys(m)
}
{
  // a cascade removal against a deleted-then-restored world: a step row removed here is not handed back by the other device, and a re-tick later is
  const stale = growth(); G.routineStep(stale, { id: 'r-ev' }, { stepId: 's1' }); G.routineStep(stale, { id: 'r-ev' }, { stepId: 's2' })
  tick(); const gone = stamp(clone(stale)); G.routineDone(gone, { id: 'r-ev' }, false)
  tick(); const again = stamp(clone(gone)); G.routineDone(again, { id: 'r-ev' }, true)
  const m = merged(gone, again); assert.equal(m.routineLog.length, 1); assert.equal(m.habitLog.filter((x) => /^h-(evening|r-ev-s[12])$/.test(x.habitId)).length, 3, 'finished again: the dug-up keys beat the older tombstones')
  assert.equal(merged(stale, gone).habitLog.length, 0)
}

console.log('growth: merge ok')

/* ============================================================================ */
/* 4. REGISTRY: every tool through reg.ts, real zod, real commit()               */
/* ============================================================================ */
{
  const db = stateDb(growth())
  const srv = fakeServer(K, M.tools_growth.register, db)
  const names = srv.names()
  assert.equal(names.length, 22, names.join())
  assert.equal(new Set(names).size, names.length)
  for (const n of names) { const c = srv.tools[n].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, `${n} is fully described`); assert.match(n, /^[a-z]+(_[a-z]+)*$/, `${n} is snake_case`) }
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.readOnlyHint).sort(), ['list_habits', 'list_routines'])
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.destructiveHint).sort(), ['archive_habit', 'delete_routine', 'remove_habit_amount', 'remove_routine_step', 'undo_slip'])
  for (const n of names.filter((n) => !srv.tools[n].cfg.annotations.readOnlyHint)) assert.match(srv.tools[n].cfg.description, /refus|Not supported|Not for|not claimed|Only |only |Confirm|Refuses|never/i, `${n} says what it does NOT do`)

  // the only names shared with core are the two this module takes over
  const core = fakeServer(K, M.tools_core?.register ?? (() => {}), stateDb(growth())).names()
  // integrated: core's v1 habit tools are gone, so this module shares no name with core
  assert.deepEqual(names.filter((n) => core.includes(n)), [], 'no tool name shared with core')

  const state = () => db.tables.mc_state[0].data
  // reads
  const lh = await srv.call('list_habits'); assert.equal(lh.isError, false); assert.ok(lh.json.habits.length > 10)
  const lr = await srv.call('list_routines', { query: 'evening' }); assert.equal(lr.json.count, 1)
  // a change: through commit, stamped Claude, one real row
  const t1 = await srv.call('tick_habit', { title: 'stretch' })
  assert.match(t1.text, /Kept "Stretch"/); assert.equal(state().habitLog.length, 1); assert.equal(state().lastWrite.name, 'Claude')
  assert.equal(state().habitLog[0].habitId, 'h-stretch')
  // a refusal changes nothing
  let snap = JSON.stringify(state())
  for (const [tool, args, re] of [
    ['tick_habit', { id: 'h-quit' }, /quit habit/], ['tick_habit', { title: 'e' }, /matches \d+ habits/], ['habit_count', { id: 'h-stretch', value: 1 }, /not counted/],
    ['log_slip', { id: 'h-stretch' }, /No quit habit/], ['routine_step', { id: 'r-mo', step_id: 'mr4' }, /locked/], ['delete_routine', { id: 'zzz' }, /No routine has the id/],
    ['archive_habit', { id: 'h-nope' }, /No habit has the id/], ['plan_routine', { id: 'r-ev' }, /Say where/], ['add_habit', { name: 'stretch' }, /already a habit/],
  ]) {
    const r = await srv.call(tool, args); assert.equal(r.isError, true, `${tool} refuses`); assert.match(r.text, re)
    assert.equal(JSON.stringify(state()), snap, `${tool}: a refusal changes nothing`)
  }
  // LIFTED: un-finishing a routine removes several records, which the writer lets through because the operation declared the cascade
  await srv.call('routine_step', { id: 'r-ev', step_id: 's1' }); await srv.call('routine_step', { id: 'r-ev', step_id: 's2' })
  assert.equal(state().routines.find((r) => r.id === 'r-ev').completedOn, T)
  assert.equal(state().routineLog.length, 1)
  const unf = await srv.call('routine_step', { id: 'r-ev', step_id: 's1', done: false })
  assert.equal(unf.isError, false, unf.text); assert.match(unf.text, /Unticked in "Evening": Brush teeth/)
  assert.equal(state().routines.find((r) => r.id === 'r-ev').completedOn, null); assert.equal(state().routineLog.length, 0)
  assert.equal(state().habitLog.some((x) => x.habitId === 'h-evening' || x.habitId === 'h-r-ev-s1'), false, 'the step row and the routine streak row are both gone')
  assert.equal(state().graveyard.some((x) => x.k === `habitLog:h-evening|${T}|` && !x.undone), true, 'and buried')
  assert.equal(JSON.stringify(state()).includes('allowShrink'), false, 'the declaration never reaches the saved JSON')
  await srv.call('routine_step', { id: 'r-ev', step_id: 's1' })
  const reopen = await srv.call('routine_done', { id: 'r-ev', done: false })
  assert.equal(reopen.isError, false, reopen.text); assert.match(reopen.text, /Reopened "Evening"/)
  assert.equal(state().stepTicks.filter((x) => x.routineId === 'r-ev').length, 0); assert.equal(state().habitLog.filter((x) => /^h-(r-ev|evening)/.test(x.habitId)).length, 0)
  snap = JSON.stringify(state())
  // every write tool end to end
  assert.match((await srv.call('habit_count', { title: 'walk', value: 2 })).text, /Counted 2/)
  assert.match((await srv.call('habit_count', { title: 'walk', value: -1 })).text, /Took one off/)
  assert.match((await srv.call('log_habit_amount', { title: 'water', amount: 500 })).text, /500 ml/)
  assert.match((await srv.call('remove_habit_amount', { title: 'water' })).text, /Took back 500/)
  assert.match((await srv.call('log_slip', { title: 'energy' })).text, /Logged a slip/)
  assert.match((await srv.call('undo_slip', { title: 'energy' })).text, /Took back the slip/)
  const ah = await srv.call('add_habit', { name: 'Journal', per_week: 3, started_on: D(-2) }); assert.match(ah.text, /2 earlier days/)
  assert.match((await srv.call('edit_habit', { title: 'journal', new_name: 'Journalling', daypart: 'evening' })).text, /Updated "Journalling"/)
  assert.match((await srv.call('pause_habit', { title: 'journalling' })).text, /Paused/)
  assert.match((await srv.call('pause_habit', { title: 'journalling', paused: false })).text, /Resumed/)
  assert.match((await srv.call('archive_habit', { title: 'journalling' })).text, /Archived/)
  const ar = await srv.call('add_routine', { title: 'Lunch', steps: ['Walk', 'Eat'], cadence: 'daily' }); assert.match(ar.text, /2 steps/)
  assert.match((await srv.call('edit_routine', { title: 'lunch', new_title: 'Lunch break' })).text, /Updated routine/)
  assert.match((await srv.call('add_routine_step', { title: 'lunch', step: 'Stretch' })).text, /Added a step/)
  assert.match((await srv.call('routine_step', { title: 'lunch', step: 'walk' })).text, /Ticked in "Lunch break": Walk. 1 of 3/)
  assert.match((await srv.call('plan_routine', { title: 'lunch', slot: 'noon' })).text, /Planned "Lunch break" for today, noon/)
  assert.match((await srv.call('routine_done', { title: 'lunch' })).text, /routine finished/)
  assert.match((await srv.call('remove_routine_step', { title: 'lunch', step: 'stretch' })).text, /Removed from/)
  assert.match((await srv.call('delete_routine', { title: 'lunch' })).text, /Deleted routine "Lunch break"/)
  assert.match((await srv.call('tick_habit', { id: 'h-alt', alt: 'cook' })).text, /Kept "Eat well" today with "Cook"/)
  assert.match((await srv.call('habit_count', { id: 'h-r-mo-mr4', value: 80 })).text, /passes the gate/)
  noDupKeys(state())

  // schemas are enforced by real zod before any handler runs
  if (K.zodReal) {
    for (const [tool, args] of [
      ['add_habit', { name: 'x', per_week: 9 }], ['add_habit', {}], ['add_habit', { name: 'x', track: 'rows' }], ['edit_habit', { id: 'h-read', daypart: 'night' }], ['habit_count', { id: 'h-walk' }],
      ['log_habit_amount', { id: 'h-water', amount: 0 }], ['add_routine', { title: 'x', cadence: 'yearly' }], ['plan_routine', { id: 'r-ev', slot: 'late' }], ['routine_step', { id: 'r-ev', done: 'yes' }],
      ['add_routine', { title: 'x', steps: Array(41).fill('a') }], ['tick_habit', { id: 'h-read', day: 5 }], ['edit_routine', { id: 'r-ev', blurb: 'x'.repeat(301) }],
    ]) await assert.rejects(() => srv.call(tool, args), undefined, `${tool} ${JSON.stringify(args)} is rejected by the schema`)
  }

  // a save that lands between the read and the write is never overwritten: the change is applied again on top of it
  const db2 = stateDb(growth())
  const srv2 = fakeServer(K, M.tools_growth.register, db2)
  db2.beforeUpdate = (d) => { const row = d.tables.mc_state[0]; row.data.habitLog.push({ habitId: 'h-read', day: T }); row.updated_at = '2026-11-07T10:00:05.000Z' }
  const t2 = await srv2.call('tick_habit', { id: 'h-stretch' })
  assert.equal(t2.isError, false)
  assert.deepEqual(db2.tables.mc_state[0].data.habitLog.map((x) => x.habitId).sort(), ['h-read', 'h-stretch'], 'the other device\'s tick survives, mine lands on top')
}

/* ============================================================================ */
/* 5. THE NEW TOOLS through registration + real zod + real commit()              */
/* ============================================================================ */
{
  const start = growth()
  start.goals = [{ id: 'g1', space: 'personal', name: 'Evenings', habitId: 'h-evening', current: 2, target: 10, unit: 'checkoffs', timeframe: 'quarter' }]
  const db = stateDb(start); const srv = fakeServer(K, M.tools_growth.register, db); const state = () => db.tables.mc_state[0].data
  // bulk tick: through zod, one commit, all or nothing
  const ok = await srv.call('tick_habits', { habits: [{ id: 'h-stretch' }, { title: 'read', day: D(-1) }, { id: 'h-r-ev-s1' }] })
  assert.equal(ok.isError, false, ok.text); assert.match(ok.text, /3 done together/); assert.equal(state().habitLog.length, 3)
  const snap = JSON.stringify(state())
  const bad = await srv.call('tick_habits', { habits: [{ id: 'h-review' }, { id: 'h-walk' }] })
  assert.equal(bad.isError, true); assert.match(bad.text, /Item 2 \(h-walk\).*counted habit.*Nothing was changed/); assert.equal(JSON.stringify(state()), snap, 'not even the first item was written')
  // a paused habit, the daily review, a past-day routine finish
  assert.equal((await srv.call('pause_habit', { id: 'h-read', paused: true })).isError, false)
  assert.match((await srv.call('tick_habit', { id: 'h-read' })).text, /Kept "Read" on/)
  assert.match((await srv.call('close_daily_review', { walked: true })).text, /walked/); assert.equal(state().dailyDone, T)
  assert.match((await srv.call('close_daily_review', { walked: false })).text, /skipped/); assert.equal(state().dailySkipped, T)
  assert.match((await srv.call('routine_done', { id: 'r-wind', day: D(-2) })).text, /Marked "Wind down" as finished on/)
  // the minutes habit and the colour, through zod
  assert.match((await srv.call('add_habit', { name: 'Deep 2', track: 'minutes', minutes_target: 45, color: '#38BDF8', icon: 'focus' })).text, /Added a habit: "Deep 2"/)
  const dh = state().habits.find((h) => h.name === 'Deep 2'); assert.deepEqual([dh.measure, dh.dailyTargetMin, dh.color, dh.icon], ['minutes', 45, '#38BDF8', 'focus'])
  assert.match((await srv.call('edit_habit', { id: 'h-stretch', kind: 'count', count_target: 2, color: '#A78BFA', icon: 'heart' })).text, /now a counted habit/)
  assert.match((await srv.call('edit_habit', { id: 'h-water', presets: [100, 200] })).text, /quick amounts 100, 200/)
  assert.match((await srv.call('edit_habit', { id: 'h-quit', daily_cost: null })).text, /no daily cost/)
  assert.match((await srv.call('edit_routine', { id: 'r-wind', color: '#34D399', icon: 'bulb' })).text, /colour #34D399, icon bulb/)
  const ar = await srv.call('add_routine', { title: 'Lunch', daypart: 'noon', steps: ['Walk', 'Eat'], repeatable: true, color: '#FB923C', icon: 'sun' }); assert.match(ar.text, /2 steps, each one a habit in its folder/)
  assert.match((await srv.call('add_routine_step', { title: 'lunch', step: 'Stretch' })).text, /Added a step/)
  assert.equal(state().habits.filter((h) => h.folderId === state().routines.find((r) => r.title === 'Lunch').id).length, 3)
  // archiving a routine's streak habit deletes the routine and detaches the goal that counted off it
  const ahr = await srv.call('archive_habit', { id: 'h-evening' }); assert.equal(ahr.isError, false, ahr.text); assert.match(ahr.text, /Deleted routine "Evening".*"Evenings" counted off its habit/)
  assert.equal(state().routines.find((r) => r.id === 'r-ev').archivedAt, T); assert.equal(state().goals[0].habitId, undefined); assert.equal(state().goals[0].unit, 'done')
  noDupKeys(state())
  // a lifted refusal that used to be one still refuses what the app refuses
  for (const [tool, args, re] of [
    ['tick_habit', { id: 'h-focus' }, /kept by the clock/], ['tick_habit', { id: 'h-alt' }, /which one is his to say/], ['routine_step', { id: 'r-mo', step_id: 'mr5' }, /which one is his to say/],
    ['routine_step', { id: 'r-mo', step_id: 'mr4' }, /locked/], ['edit_habit', { id: 'h-water', kind: 'keep' }, /amount habit/], ['routine_done', { id: 'r-wind', day: D(-1), done: false }, /no "reopen a past day"/],
    ['add_habit', { name: 'Old', started_on: '1999-01-01' }, /typo/],
  ]) { const r = await srv.call(tool, args); assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)}`); assert.match(r.text, re) }
  if (K.zodReal) {
    for (const [tool, args] of [
      ['edit_habit', { id: 'h-read', color: '#123456' }], ['edit_habit', { id: 'h-read', icon: 'rocket' }], ['edit_habit', { id: 'h-read', kind: 'amount' }], ['edit_habit', { id: 'h-walk', count_target: 100 }],
      ['edit_habit', { id: 'h-focus', minutes_target: 4 }], ['add_habit', { name: 'x', track: 'minutes', minutes_target: 601 }], ['add_habit', { name: 'x', color: 'red' }], ['add_routine', { title: 'x', icon: 'rocket' }],
      ['tick_habits', { habits: [] }], ['tick_habits', { habits: Array(41).fill({ id: 'h-read' }) }], ['tick_habits', {}], ['close_daily_review', {}], ['close_daily_review', { walked: 'yes' }], ['routine_done', { id: 'r-ev', day: 5 }],
    ]) await assert.rejects(() => srv.call(tool, args), undefined, `${tool} ${JSON.stringify(args)} is rejected by the schema`)
  }
}

/* ============================================================================ */
/* 6. MUTATION CHECKS on the riskiest rule: the cascade (declaration + scope)     */
/* ============================================================================ */
async function loadMutant(patches) {
  const FN = `${ROOT}/supabase/functions/mc-mcp`
  const out = await build({
    stdin: { contents: `export * from '${FN}/ops.ts'\nexport * from '${FN}/commit.ts'\nexport * as growth from '${FN}/ops-growth.ts'`, resolveDir: ROOT, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
    plugins: [{ name: 'mutate', setup(b) { b.onLoad({ filter: /ops-growth\.ts$/ }, (a) => { let src = readFileSync(a.path, 'utf8'); for (const [from, to] of patches) { assert.ok(src.includes(from), `mutation anchor not found: ${from}`); src = src.replace(from, to) } return { contents: src, loader: 'ts' } }) } }],
  })
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}
{
  const finishedDb = () => { const f = growth(); G.routineStep(f, { id: 'r-ev' }, { stepId: 's1' }); G.routineStep(f, { id: 'r-ev' }, { stepId: 's2' }); return stateDb(f) }
  const untick = (X, db) => X.commit(db, 'u1', (b) => X.growth.routineStep(b, { id: 'r-ev' }, { stepId: 's1' }, { done: false }))
  const DECLARE = 'allowShrink(b, k, Math.max(0, rows.length - now.length - 1))'
  // control: the unmutated source passes through the real writer
  const ctl = await loadMutant([]); { const db = finishedDb(); await untick(ctl, db); assert.equal(db.tables.mc_state[0].data.routineLog.length, 0) }
  // M1: the cascade is NOT declared -> the writer's safety stop refuses the same untick, and nothing is written
  const m1 = await loadMutant([[DECLARE, 'void 0']])
  { const db = finishedDb(); const before = JSON.stringify(db.tables.mc_state[0].data); await assert.rejects(() => untick(m1, db), (e) => /Safety stop: "habitLog" would have shrunk/.test(e.message)); assert.equal(JSON.stringify(db.tables.mc_state[0].data), before, 'nothing written') }
  // M2: over-declared by one -> the exact allowance assertion catches it
  const m2 = await loadMutant([[DECLARE, 'allowShrink(b, k, rows.length - now.length)']])
  { const f = growth(); G.routineStep(f, { id: 'r-ev' }, { stepId: 's1' }); G.routineStep(f, { id: 'r-ev' }, { stepId: 's2' }); m2.growth.routineStep(f, { id: 'r-ev' }, { stepId: 's1' }, { done: false }); assert.notDeepEqual(M.shrinkAllowance(f), { habitLog: 1 }, 'the mutant over-declares'); assert.deepEqual(M.shrinkAllowance(f), { habitLog: 2, routineLog: 1, stepTicks: 1 }, 'which the exact-allowance assertions in section 2 would fail on') }
  // M3: a bug that wipes ANOTHER routine's step ticks while ticking: the scope check refuses; with the scope check disabled the same bug sails through
  const BUG = [["const rest = arr(b, 'stepTicks').filter((t) => !(t.routineId === routineId && t.day === day && stepIds.includes(t.stepId)))", "const rest = arr(b, 'stepTicks').filter((t) => t.routineId === routineId && !(t.day === day && stepIds.includes(t.stepId)))"]]
  const twoRoutines = () => { const f = growth(); G.routineStep(f, { id: 'r-wind' }, { stepId: 'w1' }); G.routineStep(f, { id: 'r-ev' }, { stepId: 's1' }); return stateDb(f) }
  const bug = await loadMutant(BUG)
  { const db = twoRoutines(); await assert.rejects(() => bug.commit(db, 'u1', (b) => bug.growth.routineStep(b, { id: 'r-ev' }, { stepId: 's1' }, { done: false })), (e) => /should not touch/.test(e.message)); assert.equal(db.tables.mc_state[0].data.stepTicks.length, 2, 'nothing written') }
  const bugNoGuard = await loadMutant([...BUG, ['if (!inScope || lost.some((r) => !inScope(r))) {', 'if (false) {']])
  { const db = twoRoutines(); await bugNoGuard.commit(db, 'u1', (b) => bugNoGuard.growth.routineStep(b, { id: 'r-ev' }, { stepId: 's1' }, { done: false })); assert.equal(db.tables.mc_state[0].data.stepTicks.length, 0, 'without the scope check the other routine\'s tick is silently lost') }
  // M4: the goal is not detached on delete -> the assertions of section 2 (current 5, no habitId) fail
  const m4 = await loadMutant([['      g.current = goalCurrentPlain(g, habits)\n      delete g.habitId', '      g.current = g.current']])
  { const f = growth(); f.goals = [{ id: 'g1', name: 'E', habitId: 'h-evening', current: 2, target: 10, unit: 'checkoffs' }]; m4.growth.deleteRoutine(f, { id: 'r-ev' }); assert.equal(f.goals[0].habitId, 'h-evening', 'the mutant leaves the goal pointing at an archived habit: the section-2 assertions fail on it') }
}

console.log(`MCP growth: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
