/* Goals + the task-goal bridge (supabase/functions/mc-mcp/ops-goals.ts, tools-goals.ts), checked against the
   app's own functions and the app's real merge engine.
   `ZOD_PATH=... node tools/mcp-goals-test.mjs` */
import assert from 'assert/strict'
import { loadKit, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['ops-goals.ts', 'tools-goals.ts'],
  extra: [
    "export { goalPeriodKey as appPeriodKey, goalPeriodRange as appPeriodRange, periodIsPast as appPeriodIsPast } from './src/util.ts'",
    "export { freeTag as appFreeTag, cleanTag as appCleanTag } from './src/tags.ts'",
    "export { goalCurrent as appGoalCurrent } from './src/types/goals.ts'",
  ],
})
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const G = M.ops_goals

let n = 0
const check = (name, fn) => { fn(); n++ }

/* a state with goals, a habit, projects and tasks */
function world() {
  const b = fixture()
  b.habits = [
    { id: 'h-gym', name: 'Gym', space: 'personal', kind: 'build', days: [false, false, false, false, false, false, false], history: [2, 3, 1] },
    { id: 'h-focus', name: 'Deep work', space: 'work', kind: 'build', auto: { from: 'focus', minutes: 60 }, days: [false, false, false, false, false, false, false], history: [] },
    { id: 'h-quit', name: 'No sugar', space: 'personal', kind: 'break', quitSince: '2026-01-01', days: [false, false, false, false, false, false, false], history: [] },
  ]
  b.slips = [{ habitId: 'h-quit', day: '2026-01-05' }]
  b.projects = [
    { id: 'p-sonar', name: 'Sonar', space: 'work', createdAt: '2026-10-01' },
    { id: 'p-off', name: 'Off-Plate', space: 'personal', createdAt: '2026-10-01' },
    { id: 'p-home', name: 'Home', space: 'personal', createdAt: '2026-10-01' },
    { id: 'p-car', name: 'Car', space: 'personal', createdAt: '2026-10-01', tag: 'garage' },
  ]
  b.tasks.push(
    { id: 't-h1', title: 'Paint hallway', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', projectId: 'p-home', createdAt: '2026-11-01', addedAt: 4 },
    { id: 't-c1', title: 'Change oil', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', projectId: 'p-car', createdAt: '2026-11-01', addedAt: 5 },
    { id: 't-c2', title: 'Wash car', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', projectId: 'p-car', createdAt: '2026-11-01', addedAt: 6 },
  )
  b.goals = [
    { id: 'g-save', space: 'personal', name: 'Save money', current: 5000, target: 40000, unit: 'CZK', note: '', timeframe: 'monthly', category: 'money', periodKey: G.goalPeriodKey('monthly'), createdAt: '2026-11-01', touchedAt: '2026-11-01', milestones: [], entries: [{ id: 'ge-1', day: '2026-11-02', v: 5000, note: 'salary' }] },
    { id: 'g-ship', space: 'work', name: 'Ship the audit', current: 1, target: 3, unit: 'milestones', note: '', timeframe: 'quarter', category: 'work', periodKey: G.goalPeriodKey('quarter'), createdAt: '2026-11-01', touchedAt: '2026-11-01', milestones: [{ id: 'ms-1', label: 'Draft report', done: true }, { id: 'ms-2', label: 'Client review', done: false }, { id: 'ms-3', label: 'Send invoice', done: false }] },
    { id: 'g-emails', space: 'personal', name: 'Send 20 cold emails', current: 4, target: 20, unit: 'emails', note: '', timeframe: 'weekly', category: 'offplate', periodKey: G.goalPeriodKey('weekly'), createdAt: '2026-11-01', touchedAt: '2026-11-01', milestones: [] },
    { id: 'g-gym', space: 'personal', name: 'Gym 3 times', current: 0, target: 3, unit: 'checkoffs', note: '', timeframe: 'weekly', habitId: 'h-gym', category: 'habits', periodKey: G.goalPeriodKey('weekly'), createdAt: '2026-11-01', touchedAt: '2026-11-01' },
    { id: 'g-old', space: 'personal', name: 'Read a book', current: 1, target: 2, unit: 'books', note: '', timeframe: 'monthly', category: 'life', periodKey: '2026-09', createdAt: '2026-09-01', touchedAt: '2026-09-20', closed: { on: '2026-09-30', final: 1 }, entries: [{ id: 'ge-old', day: '2026-09-10', v: 1 }], milestones: [{ id: 'ms-o1', label: 'Pick it', done: true }, { id: 'ms-o2', label: 'Finish it', done: false }] },
  ]
  return b
}

/* ============================== surface ============================== */
{
  const srv = fakeServer(K, M.tools_goals.register, stateDb(world()))
  const names = srv.names()
  check('count', () => assert.equal(names.length, 15, names.join()))
  for (const nm of names) { const c = srv.tools[nm].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, nm); assert.match(nm, /^[a-z]+(_[a-z]+)*$/) }
  check('reads', () => assert.deepEqual(names.filter((x) => srv.tools[x].cfg.annotations.readOnlyHint), ['list_goals']))
  check('destructive', () => assert.deepEqual(names.filter((x) => srv.tools[x].cfg.annotations.destructiveHint).sort(), ['delete_goal', 'delete_project', 'remove_goal_entry']))
}

/* ============================== periods == the app's util.ts ============================== */
{
  let cmp = 0
  for (let t = Date.UTC(2024, 11, 20); t < Date.UTC(2028, 2, 5); t += 86400000 * 3) {
    const day = new Date(t).toISOString().slice(0, 10)
    const [y, m, d] = day.split('-').map(Number)
    const local = new Date(y, m - 1, d, 12)
    for (const tf of ['weekly', 'monthly', 'quarter', 'half']) {
      const key = M.appPeriodKey(tf, local)
      assert.equal(G.goalPeriodKey(tf, day), key, `${tf} ${day}`)
      const a = M.appPeriodRange(tf, key), b = G.goalPeriodRange(tf, key)
      assert.equal(b.from, a.from, `${tf} ${key} from`); assert.equal(b.to, a.to, `${tf} ${key} to`)
      assert.equal(G.validPeriodKey(tf, key), true)
      cmp++
    }
  }
  check('period parity', () => assert.ok(cmp > 1000))
  // the half-year edges (14 Feb / 14 Aug) and ISO-week year edges
  assert.equal(G.goalPeriodKey('half', '2026-02-14'), '2025-H2'); assert.equal(G.goalPeriodKey('half', '2026-02-15'), '2026-H1')
  assert.equal(G.goalPeriodKey('half', '2026-08-14'), '2026-H1'); assert.equal(G.goalPeriodKey('half', '2026-08-15'), '2026-H2')
  assert.equal(G.goalPeriodKey('weekly', '2026-12-31'), '2026-W53'); assert.equal(G.goalPeriodKey('weekly', '2027-01-03'), '2026-W53')
  assert.equal(G.validPeriodKey('weekly', '2026-W54'), false); assert.equal(G.validPeriodKey('monthly', '2026-13'), false)
  assert.equal(G.periodIsPast('monthly', '2026-09', '2026-10-01'), true); assert.equal(G.periodIsPast('monthly', '2026-09', '2026-09-30'), false)
  assert.equal(G.periodIsPast('monthly', '2026-09', '2026-09-30'), M.appPeriodIsPast('monthly', '2026-09', new Date(2026, 8, 30)))
}

/* ============================== freeTag / cleanTag == the app ============================== */
{
  const ps = [{ id: 'a', name: 'Home', space: 'personal' }, { id: 'b', name: 'Car', space: 'personal', tag: 'garage' }, { id: 'c', name: 'Home 2', space: 'personal', tag: 'home2' }]
  for (const want of ['home', '#Garage', 'Ho me!', 'dodge-fixes', '___', 'Masér', '', 'x'.repeat(60)]) {
    for (const own of [true, false]) for (const except of [undefined, 'a', 'b']) {
      assert.equal(G.freeTag(want, ps, except, own), M.appFreeTag(want, ps, except, own), `${want}/${own}/${except}`)
    }
    assert.equal(G.cleanTag(want), M.appCleanTag(want))
  }
  check('tag parity', () => {})
}

/* ============================== goalCurrent == the app ============================== */
{
  const b = world()
  const log = [{ habitId: 'h-gym', day: '2026-11-02' }, { habitId: 'h-gym', day: '2026-11-02' }, { habitId: 'h-gym', day: '2026-11-04' }, { habitId: 'h-gym', day: '2026-12-01' }, { habitId: 'x', day: '2026-11-03' }]
  const sessions = [{ day: '2026-11-03', minutes: 95, space: 'work' }, { day: '2026-11-03', minutes: 30, space: 'personal' }, { day: '2026-10-30', minutes: 600, space: 'work' }]
  const range = { from: '2026-11-02', to: '2026-11-08' }
  const gym = b.goals.find((g) => g.id === 'g-gym')
  const cases = [
    [gym, log, range], [{ ...gym, target: 1 }, log, range], [{ ...gym, habitId: 'h-focus', target: 10 }, log, range],
    [{ ...gym, habitId: 'h-quit', target: 99 }, log, { from: '2026-01-01', to: '2026-01-31' }],
    [{ ...gym, habitId: 'nope', current: 7 }, log, range], [{ ...gym, closed: { on: 'x', final: 2 } }, log, range],
    [{ ...gym, timeframe: 'quarter', target: 50 }, undefined, undefined], [{ ...gym, timeframe: 'monthly', target: 50 }, undefined, undefined],
    [{ ...gym, habitId: undefined, current: 9 }, log, range],
  ]
  for (const [g, l, r] of cases) {
    assert.equal(G.goalCurrent(g, b.habits, l, r, b.slips, sessions, '2026-12-31'), M.appGoalCurrent(g, b.habits, l, r, b.slips, sessions), JSON.stringify([g.habitId, g.target, g.timeframe]))
  }
  assert.equal(G.goalCurrent({ ...gym, habitId: 'h-focus', target: 10 }, b.habits, log, range, b.slips, sessions, '2026-12-31'), 1.6) // 95 min of work-space focus
  check('goalCurrent parity', () => {})
}

/* ============================== add_goal ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const r = await srv.call('add_goal', { name: '  Run 10 km  ', target: 10, unit: 'km', timeframe: 'weekly', category: 'health', why: 'Feel fit' })
  assert.equal(r.isError, false, r.text)
  const row = data().goals.at(-1)
  check('add_goal row', () => {
    assert.match(row.id, /^g-/); assert.match(r.text, /Run 10 km/)
    assert.deepEqual({ ...row, id: undefined }, {
      id: undefined, space: 'personal', name: 'Run 10 km', current: 0, note: '', target: 10, unit: 'km', timeframe: 'weekly', category: 'health',
      periodKey: G.goalPeriodKey('weekly'), createdAt: TODAY, touchedAt: TODAY, milestones: [], why: 'Feel fit',
    })
  })
  // defaults of the assistant: monthly, life, unit "steps"
  const d = await srv.call('add_goal', { name: 'Tidy the cellar', target: 5 })
  const dr = data().goals.at(-1)
  check('add_goal defaults', () => { assert.equal(dr.timeframe, 'monthly'); assert.equal(dr.category, 'life'); assert.equal(dr.unit, 'steps'); assert.equal(dr.periodKey, G.goalPeriodKey('monthly')); assert.equal('why' in dr, false) })
  // milestones: target = count, unit milestones, a given target is ignored
  const m = await srv.call('add_goal', { name: 'Move flat', target: 99, milestones: ['Find flat', 'Sign lease', '  ', 'Move boxes'], timeframe: 'quarter', space: 'work' })
  const mr = data().goals.at(-1)
  check('add_goal milestones', () => {
    assert.equal(mr.target, 3); assert.equal(mr.unit, 'milestones'); assert.equal(mr.space, 'work')
    assert.deepEqual(mr.milestones.map((x) => [x.label, x.done]), [['Find flat', false], ['Sign lease', false], ['Move boxes', false]])
    assert.equal(new Set(mr.milestones.map((x) => x.id)).size, 3); assert.ok(mr.milestones.every((x) => /^ms-[0-9a-z]+-\d$/.test(x.id)))
  })
  // refusals
  const before = JSON.stringify(data())
  const noTarget = await srv.call('add_goal', { name: 'Vague' })
  check('add_goal no target', () => { assert.equal(noTarget.isError, true); assert.match(noTarget.text, /needs a target number or milestones/) })
  const dupe = await srv.call('add_goal', { name: 'run 10 KM', target: 3, timeframe: 'weekly' })
  check('add_goal duplicate', () => { assert.equal(dupe.isError, true); assert.match(dupe.text, /already an open weekly goal/) })
  assert.equal((await srv.call('add_goal', { name: 'run 10 km', target: 3, timeframe: 'weekly', allow_duplicate: true })).isError, false)
  data().goals.pop(); // keep the world tidy
  const blank = await srv.call('add_goal', { name: '   ', target: 1 })
  check('add_goal blank', () => assert.equal(blank.isError, true))
  if (K.zodReal) {
    await assert.rejects(() => srv.call('add_goal', { name: 'x', target: 0 }), /too_small|Too small|>=1/i)
    await assert.rejects(() => srv.call('add_goal', { name: 'x', target: 1, timeframe: 'yearly' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('add_goal', { name: 'x', target: 1, category: 'fun' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('add_goal', { name: 'x'.repeat(201), target: 1 }), /too_big|Too big|<=200/i)
    await assert.rejects(() => srv.call('add_goal', { name: 'x', milestones: Array(31).fill('a') }), /too_big|Too big/i)
  }
  assert.equal(JSON.stringify(data()).includes('Vague'), false); void before
  // a past-month goal does not count as duplicate of this month's
  const pure = world(); G.addGoal(pure, { name: 'Read a book', target: 2, timeframe: 'monthly' })
  check('closed goal is no duplicate', () => assert.equal(pure.goals.filter((g) => g.name === 'Read a book').length, 2))
  // deterministic period at a chosen day
  const b2 = world(); G.addGoal(b2, { name: 'Edge', target: 1, timeframe: 'half' }, '2026-02-14')
  check('period at day', () => assert.equal(b2.goals.at(-1).periodKey, '2025-H2'))
}

/* ============================== edit / progress / milestones / entries ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const goal = (id) => data().goals.find((g) => g.id === id)

  // edit
  const e = await srv.call('edit_goal', { title: 'save mon', name: 'Save 40k', target: 50000, unit: 'Kč', why: 'Debt' })
  check('edit_goal', () => { assert.equal(e.isError, false, e.text); const g = goal('g-save'); assert.deepEqual([g.name, g.target, g.unit, g.why, g.touchedAt, g.current], ['Save 40k', 50000, 'Kč', 'Debt', TODAY, 5000]) })
  const eNone = await srv.call('edit_goal', { id: 'g-save' })
  check('edit nothing', () => { assert.equal(eNone.isError, true); assert.match(eNone.text, /Nothing to change/) })
  // LIFTED in round 3: the Goals sheet moves a goal to another timeframe (its new tests are in the sections below)
  assert.doesNotThrow(() => G.editGoal(world(), { id: 'g-save' }, { timeframe: 'weekly' }))
  refuses(() => G.editGoal(data(), { id: 'g-ship' }, { target: 5 }), /measured in its 3 milestones/)
  assert.doesNotThrow(() => G.editGoal(world(), { id: 'g-ship' }, { target: 3, name: 'Ship it' }))
  // LIFTED in round 3: a finished goal can be corrected (name/target/unit/why/deadline/category); period, habit, milestones stay history
  const eClosed = await srv.call('edit_goal', { id: 'g-old', name: 'Read a novel', why: 'Calm' })
  check('edit closed', () => { assert.equal(eClosed.isError, false, eClosed.text); const g = goal('g-old'); assert.deepEqual([g.name, g.why, g.closed, g.periodKey], ['Read a novel', 'Calm', { on: '2026-09-30', final: 1 }, '2026-09']) })
  const eClosedWords = await srv.call('edit_goal', { title: 'read a novel', unit: 'novels' })
  check('edit closed by words', () => { assert.equal(eClosedWords.isError, false, eClosedWords.text); assert.equal(goal('g-old').unit, 'novels') })
  for (const [a, re] of [[{ timeframe: 'weekly' }, /is finished .* period is history/], [{ milestones: ['a'] }, /milestones is history/], [{ habit: 'gym' }, /habit link is history/], [{ move_to_current_period: true }, /period is history/]]) {
    const x = await srv.call('edit_goal', { id: 'g-old', ...a }); check(`edit closed refusal ${Object.keys(a)}`, () => { assert.equal(x.isError, true); assert.match(x.text, re) })
  }
  const eNo = await srv.call('edit_goal', { title: 'zzzz', name: 'x' })
  check('edit none', () => { assert.equal(eNo.isError, true); assert.match(eNo.text, /No goal matches/) })
  const eAmb = await srv.call('edit_goal', { title: 'e', name: 'x' }) // "Save 40k"? no: 'e' is in several names
  check('edit ambiguous', () => { assert.equal(eAmb.isError, true); assert.match(eAmb.text, /matches \d goals/) })
  const eId = await srv.call('edit_goal', { id: 'nope', name: 'x' })
  check('edit bad id', () => assert.match(eId.text, /No goal has the id "nope"/))

  // progress: by is clamped 0..target (bumpGoal), set is not (updateGoal)
  let r = await srv.call('set_goal_progress', { id: 'g-emails', by: 3 })
  check('by', () => { assert.equal(goal('g-emails').current, 7); assert.equal(goal('g-emails').touchedAt, TODAY); assert.match(r.text, /7 of 20/) })
  r = await srv.call('set_goal_progress', { id: 'g-emails', by: 500 }); check('by clamps top', () => assert.equal(goal('g-emails').current, 20))
  r = await srv.call('set_goal_progress', { id: 'g-emails', by: -500 }); check('by clamps bottom', () => assert.equal(goal('g-emails').current, 0))
  r = await srv.call('set_goal_progress', { id: 'g-emails', set: 25 }); check('set may pass target', () => assert.equal(goal('g-emails').current, 25))
  r = await srv.call('set_goal_progress', { title: 'cold emails', set: 8 }); check('set by words', () => assert.equal(goal('g-emails').current, 8))
  for (const [args, re] of [
    [{ id: 'g-emails' }, /Pass by/], [{ id: 'g-emails', by: 1, set: 2 }, /either by or set/],
    [{ id: 'g-gym', by: 1 }, /counts itself from its habit/], [{ id: 'g-ship', set: 2 }, /measured in its milestones/],
    [{ id: 'g-old', by: 1 }, /finished goal/],
  ]) { const x = await srv.call('set_goal_progress', args); check(`progress refusal ${JSON.stringify(args)}`, () => { assert.equal(x.isError, true); assert.match(x.text, re) }) }
  if (K.zodReal) await assert.rejects(() => srv.call('set_goal_progress', { id: 'g-emails', set: -1 }), /too_small|Too small/i)

  // log amount / remove entry == growth.ts
  r = await srv.call('log_goal_amount', { id: 'g-save', amount: 12000, note: 'invoice' })
  const ent = goal('g-save').entries.at(-1)
  check('log_goal_amount', () => {
    assert.equal(goal('g-save').current, 17000); assert.match(ent.id, /^ge-/); assert.deepEqual({ ...ent, id: undefined }, { id: undefined, day: TODAY, v: 12000, note: 'invoice' })
    assert.equal(goal('g-save').entries.length, 2); assert.equal(r.isError, false)
  })
  r = await srv.call('log_goal_amount', { id: 'g-save', amount: -100000 }); check('log below zero floors at 0', () => { assert.equal(goal('g-save').current, 0); assert.equal(goal('g-save').entries.length, 3) })
  r = await srv.call('log_goal_amount', { id: 'g-save', amount: 90000 }); check('log past target is not capped', () => assert.equal(goal('g-save').current, 90000))
  const eid = goal('g-save').entries.at(-1).id
  r = await srv.call('remove_goal_entry', { id: 'g-save', entry_id: eid })
  check('remove_goal_entry', () => { assert.equal(goal('g-save').current, 0); assert.equal(goal('g-save').entries.some((x) => x.id === eid), false); assert.equal(goal('g-save').entries.length, 3) })
  r = await srv.call('remove_goal_entry', { id: 'g-save', entry_id: 'ge-1' }); check('remove first entry', () => assert.equal(goal('g-save').entries.length, 2))
  r = await srv.call('remove_goal_entry', { id: 'g-save', entry_id: 'ge-zzz' }); check('remove unknown entry', () => { assert.equal(r.isError, true); assert.match(r.text, /no entry with the id/) })
  for (const [name, args, re] of [
    ['log', { id: 'g-gym', amount: 1 }, /counts itself/], ['log', { id: 'g-ship', amount: 1 }, /milestones/], ['log', { id: 'g-old', amount: 1 }, /finished/], ['log', { id: 'g-save', amount: 0 }, /non-zero/],
  ]) { const x = await srv.call(name === 'log' ? 'log_goal_amount' : name, args); check(`log refusal ${re}`, () => { assert.equal(x.isError, true); assert.match(x.text, re) }) }

  // milestones
  r = await srv.call('tick_milestone', { title: 'ship the audit', milestone: 'client review' })
  check('tick_milestone', () => { const g = goal('g-ship'); assert.equal(g.milestones[1].done, true); assert.equal(g.current, 2); assert.equal(g.touchedAt, TODAY) })
  r = await srv.call('tick_milestone', { id: 'g-ship', milestone: 'client review', done: true }); check('tick idempotent', () => { assert.match(r.text, /already done/); assert.equal(goal('g-ship').current, 2) })
  r = await srv.call('tick_milestone', { id: 'g-ship', milestone: 'ms-1', done: false }); check('untick by milestone id', () => { assert.equal(goal('g-ship').milestones[0].done, false); assert.equal(goal('g-ship').current, 1) })
  r = await srv.call('tick_milestone', { id: 'g-ship', milestone: 'client review' }); check('toggle flips', () => { assert.equal(goal('g-ship').milestones[1].done, false); assert.equal(goal('g-ship').current, 0) })
  r = await srv.call('tick_milestone', { id: 'g-ship', milestone: 'zzz' }); check('milestone none', () => { assert.equal(r.isError, true); assert.match(r.text, /No milestone matches/) })
  r = await srv.call('tick_milestone', { id: 'g-ship', milestone: 'e' }); check('milestone ambiguous', () => { assert.equal(r.isError, true); assert.match(r.text, /matches \d milestones/) })
  r = await srv.call('tick_milestone', { id: 'g-save', milestone: 'x' }); check('no milestones', () => assert.match(r.text, /has no milestones/))
  // a milestone goal whose unit is NOT its count keeps its own counter (toggleGoalMilestone)
  const other = world(); other.goals.find((g) => g.id === 'g-ship').target = 10; other.goals.find((g) => g.id === 'g-ship').current = 4
  G.tickMilestone(other, { id: 'g-ship' }, { title: 'client review' }, undefined)
  check('counter kept when target != count', () => assert.equal(other.goals.find((g) => g.id === 'g-ship').current, 4))
}

/* ============================== repeat ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const r = await srv.call('repeat_goal', { id: 'g-old' })
  const copy = data().goals.at(-1)
  check('repeat_goal', () => {
    assert.equal(r.isError, false, r.text); assert.notEqual(copy.id, 'g-old'); assert.match(copy.id, /^g-/)
    assert.deepEqual({ ...copy, id: undefined }, {
      id: undefined, space: 'personal', name: 'Read a book', current: 0, target: 2, unit: 'books', note: '', timeframe: 'monthly', category: 'life',
      periodKey: G.goalPeriodKey('monthly'), createdAt: TODAY, touchedAt: TODAY, milestones: [{ id: 'ms-o1', label: 'Pick it', done: false }, { id: 'ms-o2', label: 'Finish it', done: false }],
    })
    const old = data().goals.find((g) => g.id === 'g-old'); assert.deepEqual(old.closed, { on: '2026-09-30', final: 1 }); assert.equal(old.entries.length, 1); assert.equal(old.milestones[0].done, true)
  })
  const again = await srv.call('repeat_goal', { id: 'g-old' })
  check('repeat idempotent', () => { assert.match(again.text, /already running/); assert.equal(data().goals.filter((g) => g.name === 'Read a book').length, 2) })
  // by words: now two goals have this name, so it is ambiguous and says so
  const amb = await srv.call('repeat_goal', { title: 'read a book' })
  check('repeat ambiguous by words', () => { assert.equal(amb.isError, true); assert.match(amb.text, /matches 2 goals/) })
  // a habit-fed goal repeats with its habit link
  const hb = world(); hb.goals.find((g) => g.id === 'g-gym').closed = { on: '2026-10-04', final: 2 }; hb.goals.find((g) => g.id === 'g-gym').periodKey = '2026-W40'
  G.repeatGoal(hb, { id: 'g-gym' })
  check('repeat keeps habit link', () => { const c = hb.goals.at(-1); assert.equal(c.habitId, 'h-gym'); assert.equal(c.periodKey, G.goalPeriodKey('weekly')); assert.equal(c.closed, undefined); assert.equal('closed' in c, false) })
  // a goal still running this period: repeating it adds nothing
  const run = await srv.call('repeat_goal', { id: 'g-emails' })
  check('repeat running goal', () => { assert.match(run.text, /already running/); assert.equal(data().goals.length, 6) })
}

/* ============================== delete_goal: buried, and the real merge ============================== */
{
  const app = world() // what an app that has not seen the connector's writes still holds
  const db = stateDb(clone(app))
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const before = data().goals.length
  const r = await srv.call('delete_goal', { title: 'cold emails' })
  check('delete_goal', () => { assert.equal(r.isError, false); assert.equal(data().goals.length, before - 1); assert.equal(data().goals.some((g) => g.id === 'g-emails'), false) })
  check('buried', () => { const k = data().graveyard.find((t) => t.k === 'goals:g-emails'); assert.ok(k); assert.equal(typeof k.at, 'number'); assert.equal(M.appRowKey('goals', { id: 'g-emails' }), 'goals:g-emails') })
  await srv.call('set_goal_progress', { id: 'g-save', set: 777 })
  await srv.call('tick_milestone', { id: 'g-ship', milestone: 'client review' })
  await srv.call('log_goal_amount', { id: 'g-save', amount: 3, note: 'x' })
  const add = await srv.call('add_goal', { name: 'From Claude', target: 3 })
  // the stale app copy saves after us
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(data())))
  check('merge: deleted goal stays deleted', () => assert.equal(merged.goals.some((g) => g.id === 'g-emails'), false))
  check('merge: our edits and new goal survive', () => {
    const save = merged.goals.find((g) => g.id === 'g-save'); assert.equal(save.current, 780); assert.equal(save.entries.length, 2)
    assert.equal(merged.goals.find((g) => g.id === 'g-ship').milestones[1].done, true)
    assert.ok(merged.goals.some((g) => g.name === 'From Claude'))
  })
  // closed goals can be deleted by id, and by words only when no open goal answers
  const d2 = await srv.call('delete_goal', { title: 'read a book' })
  check('delete closed by words (fallback)', () => { assert.equal(d2.isError, false, d2.text); assert.ok(data().graveyard.some((t) => t.k === 'goals:g-old')) })
  const d3 = await srv.call('delete_goal', { id: 'g-old' }); check('delete twice', () => assert.equal(d3.isError, true))
  // the writer's safety stop is intact: two goals cannot go in one call
  await assert.rejects(() => M.commit(db, 'u1', (b) => { b.goals = []; return { text: 'x' } }, { sleep: async () => {} }), /Safety stop/)
  // a task that pointed at it stays and the answer says so
  const tb = world(); tb.tasks[0].goalId = 'g-emails'
  check('linked task note', () => assert.match(G.deleteGoal(tb, { id: 'g-emails' }).text, /1 task\(s\) still point at it/))
}

/* ============================== the bridge: task <-> goal ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const task = (id) => data().tasks.find((t) => t.id === id)
  let r = await srv.call('set_task_goal', { id: 't-a', goal: 'cold emails', amount: 10 })
  check('set_task_goal', () => { assert.equal(r.isError, false, r.text); assert.deepEqual([task('t-a').goalId, task('t-a').goalAmt], ['g-emails', 10]) })
  r = await srv.call('set_task_goal', { id: 't-c', goal_id: 'g-emails' }); check('amount defaults to 1', () => assert.deepEqual([task('t-c').goalId, task('t-c').goalAmt], ['g-emails', 1]))
  if (K.zodReal) await assert.rejects(() => srv.call('set_task_goal', { id: 't-c', goal_id: 'g-emails', amount: 0.5 }), /too_small|Too small/i)
  // refusals
  for (const [args, re] of [
    [{ id: 't-b', goal_id: 'g-ship' }, /measured in its milestones/], [{ id: 't-b', goal_id: 'g-gym' }, /counts itself from a habit/],
    [{ id: 't-b', goal_id: 'g-old' }, /finished goal/], [{ id: 't-b', goal_id: 'nope' }, /No goal has the id/],
    [{ id: 'nope', goal_id: 'g-emails' }, /No task has the id/],
  ]) { r = await srv.call('set_task_goal', args); check(`set_task_goal refusal ${re}`, () => { assert.equal(r.isError, true); assert.match(r.text, re) }) }
  // LIFTED in round 3: a non-weekly goal, or one of another period, can be fed (the store takes any goal; creditGoal feeds any running one)
  const stale = world(); stale.goals.find((g) => g.id === 'g-emails').periodKey = '2026-W01'
  assert.match(G.setTaskGoal(stale, { id: 't-b' }, { id: 'g-emails' }).text, /for 2026-W01, not the period running now/)
  assert.match(G.setTaskGoal(world(), { id: 't-b' }, { id: 'g-save' }, 3).text, /adds 3 to Save money/)
  // creditGoal == store.tsx creditGoal + growth.ts bumpGoal
  const b = clone(data())
  const t = b.tasks.find((x) => x.id === 't-a'); const g = b.goals.find((x) => x.id === 'g-emails')
  g.current = 4
  assert.match(G.creditGoal(b, t, 1), /g-emails|Send 20 cold emails \+10/); check('credit +', () => assert.equal(g.current, 14))
  G.creditGoal(b, t, 1); check('credit clamps at target', () => assert.equal(g.current, 20))
  G.creditGoal(b, t, -1); check('reopen takes it back', () => assert.equal(g.current, 10))
  g.current = 3; G.creditGoal(b, t, -1); check('never below 0', () => assert.equal(g.current, 0))
  g.closed = { on: 'x', final: 1 }; g.current = 5; assert.equal(G.creditGoal(b, t, 1), null); check('closed goal is history', () => assert.equal(g.current, 5))
  delete g.closed; g.habitId = 'h-gym'; assert.equal(G.creditGoal(b, t, 1), null); check('habit goal counts itself', () => assert.equal(g.current, 5))
  assert.equal(G.creditGoal(b, { id: 'z' }, 1), null); assert.equal(G.creditGoal(b, { goalId: 'gone' }, 1), null)
  // with the core ops: complete then credit == the app's toggleTask
  const w = clone(data()); const goal = w.goals.find((x) => x.id === 'g-emails'); const before = goal.current
  const tk = w.tasks.find((x) => x.id === 't-a'); M.completeTask(w, { id: 't-a' }); G.creditGoal(w, tk, 1)
  assert.equal(goal.current, Math.min(20, before + 10)); M.reopenTask(w, { id: 't-a' }); G.creditGoal(w, tk, -1)
  check('complete then reopen round trip', () => assert.equal(goal.current, before))
  // remove the link
  r = await srv.call('set_task_goal', { id: 't-a' })
  check('unlink', () => { assert.equal('goalId' in task('t-a'), false); assert.equal('goalAmt' in task('t-a'), false) })
  r = await srv.call('set_task_goal', { id: 't-a' }); check('unlink twice', () => assert.match(r.text, /was not counting/))

  // commit_task == planner.ts commitTask
  r = await srv.call('commit_task', { id: 't-a', horizon: 'monthly' })
  check('commit_task', () => assert.deepEqual([task('t-a').horizon, task('t-a').horizonKey], ['monthly', G.goalPeriodKey('monthly')]))
  r = await srv.call('commit_task', { id: 't-a', horizon: 'weekly', period_key: '2026-W50' }); check('commit pinned key', () => assert.deepEqual([task('t-a').horizon, task('t-a').horizonKey], ['weekly', '2026-W50']))
  r = await srv.call('commit_task', { id: 't-a', horizon: 'weekly', period_key: '2026-11' }); check('commit wrong key kind', () => { assert.equal(r.isError, true); assert.match(r.text, /not a weekly key/) })
  r = await srv.call('commit_task', { id: 't-a', horizon: null }); check('uncommit', () => assert.deepEqual(['horizon' in task('t-a'), 'horizonKey' in task('t-a')], [false, false]))
  r = await srv.call('commit_task', { id: 't-a', horizon: null, period_key: '2026-11' }); check('uncommit with key', () => assert.equal(r.isError, true))
  if (K.zodReal) await assert.rejects(() => srv.call('commit_task', { id: 't-a' }), /Invalid|expected|Required/i)
  if (K.zodReal) await assert.rejects(() => srv.call('commit_task', { id: 't-a', horizon: 'yearly' }), /Invalid|enum/i)
}

/* ============================== projects ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data

  // move: the project goes (buried), its task stays without projectId
  let r = await srv.call('delete_project', { name: 'home' })
  check('delete_project move', () => {
    assert.equal(r.isError, false, r.text); assert.equal(data().projects.some((p) => p.id === 'p-home'), false)
    const t = data().tasks.find((x) => x.id === 't-h1'); assert.ok(t); assert.equal('projectId' in t, false); assert.equal(t.title, 'Paint hallway')
    assert.deepEqual(data().graveyard.map((x) => x.k), ['projects:p-home'])
  })
  // delete with ONE task: both buried
  const one = stateDb(world()); one.tables.mc_state[0].data.tasks = one.tables.mc_state[0].data.tasks.filter((t) => t.id !== 't-c2')
  const s1 = fakeServer(K, M.tools_goals.register, one)
  r = await s1.call('delete_project', { name: 'car', mode: 'delete' })
  check('delete_project delete (one task)', () => {
    assert.equal(r.isError, false, r.text); const d = one.tables.mc_state[0].data
    assert.equal(d.projects.some((p) => p.id === 'p-car'), false); assert.equal(d.tasks.some((t) => t.id === 't-c1'), false)
    assert.deepEqual(d.graveyard.map((x) => x.k).sort(), ['projects:p-car', 'tasks:t-c1'])
  })
  // LIFTED in round 3: delete with TWO tasks cascades (allowShrink declares the extra row)
  const two = stateDb(world()); const s2b = fakeServer(K, M.tools_goals.register, two)
  r = await s2b.call('delete_project', { name: 'car', mode: 'delete' })
  check('delete_project delete (two tasks)', () => {
    assert.equal(r.isError, false, r.text); const d = two.tables.mc_state[0].data
    assert.deepEqual(d.tasks.map((t) => t.id).sort(), ['t-a', 't-b', 't-c', 't-h1']); assert.match(r.text, /its 2 tasks/)
    assert.deepEqual(d.graveyard.map((x) => x.k).sort(), ['projects:p-car', 'tasks:t-c1', 'tasks:t-c2'])
  })
  // move with two tasks works and the safety stop is not hit
  r = await srv.call('delete_project', { name: 'car' }); check('delete_project move (two tasks)', () => { assert.equal(r.isError, false); assert.ok(data().tasks.filter((t) => t.id === 't-c1' || t.id === 't-c2').every((t) => !('projectId' in t))) })
  r = await srv.call('delete_project', { name: 'zzz' }); check('delete_project none', () => assert.match(r.text, /No project matches/))
  r = await srv.call('delete_project', { name: 'o' }); check('delete_project ambiguous', () => assert.match(r.text, /matches \d projects/))
  r = await srv.call('delete_project', { id: 'p-nope' }); check('delete_project bad id', () => assert.match(r.text, /No project has the id/))

  // merge: a stale app still holding the project / tasks does not bring them back
  const app = world(); const d2 = stateDb(clone(app)); const s2 = fakeServer(K, M.tools_goals.register, d2)
  const solo = d2.tables.mc_state[0].data; solo.tasks = solo.tasks.filter((t) => t.id !== 't-c2'); app.tasks = app.tasks.filter((t) => t.id !== 't-c2')
  await s2.call('delete_project', { id: 'p-car', mode: 'delete' })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(d2.tables.mc_state[0].data)))
  check('merge: deleted project and task stay deleted', () => { assert.equal(merged.projects.some((p) => p.id === 'p-car'), false); assert.equal(merged.tasks.some((t) => t.id === 't-c1'), false) })
  // move + merge: the stale copy's task has projectId p-car/p-home, ours has none; the project stays deleted
  const app3 = world(); const d3 = stateDb(clone(app3)); const s3 = fakeServer(K, M.tools_goals.register, d3)
  await s3.call('delete_project', { id: 'p-home' })
  const m3 = JSON.parse(M.mergeStates(JSON.stringify({ ...app3, savedAt: 500 }), JSON.stringify(d3.tables.mc_state[0].data)))
  check('merge: moved task stays, project stays deleted', () => { assert.equal(m3.projects.some((p) => p.id === 'p-home'), false); assert.ok(m3.tasks.some((t) => t.id === 't-h1')) })

  // tag == freeTag
  const d4 = stateDb(world()); const s4 = fakeServer(K, M.tools_goals.register, d4); const p4 = (id) => d4.tables.mc_state[0].data.projects.find((p) => p.id === id)
  r = await s4.call('set_project_tag', { id: 'p-sonar', tag: '#Dodge-Fixes' }); check('set tag', () => assert.equal(p4('p-sonar').tag, 'dodge-fixes'))
  r = await s4.call('set_project_tag', { id: 'p-home', tag: 'garage' }); check('tag taken -> garage2', () => { assert.equal(p4('p-home').tag, 'garage2'); assert.match(r.text, /was taken/) })
  r = await s4.call('set_project_tag', { id: 'p-home', tag: 'garage' }); check('tag retake keeps own', () => assert.equal(p4('p-home').tag, 'garage2')) // garage is still the car's
  r = await s4.call('set_project_tag', { id: 'p-car', tag: '' }); check('tag cleared follows name', () => { assert.equal('tag' in p4('p-car'), false); assert.match(r.text, /#car/) })
  r = await s4.call('set_project_tag', { id: 'p-home', tag: '###' }); check('tag with nothing usable', () => assert.equal(r.isError, true))
  // colour
  r = await s4.call('set_project_color', { id: 'p-home', color: 'terra' }); check('set colour', () => assert.equal(p4('p-home').hue, 'terra'))
  if (K.zodReal) await assert.rejects(() => s4.call('set_project_color', { id: 'p-home', color: 'purple' }), /Invalid|enum/i)
  refuses(() => G.setProjectHue(world(), { id: 'p-home' }, 'purple'), /colour must be one of/)
}

/* ============================== list_goals ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  data().tasks[0].goalId = 'g-emails'; data().tasks[0].goalAmt = 5
  data().tasks[1].horizon = 'monthly'; data().tasks[1].horizonKey = G.goalPeriodKey('monthly')
  const all = (await srv.call('list_goals', { where: 'all' })).json
  const open = (await srv.call('list_goals')).json
  const closed = (await srv.call('list_goals', { where: 'closed' })).json
  check('list filters', () => { assert.equal(all.count, 5); assert.equal(open.count, 4); assert.equal(closed.count, 1); assert.equal(closed.goals[0].id, 'g-old') })
  const by = (id) => all.goals.find((g) => g.id === id)
  check('list: hand goal', () => { const g = by('g-save'); assert.deepEqual(g.progress, { current: 5000, target: 40000, unit: 'CZK', percent: 13, reached: false }); assert.equal(g.source, 'by hand'); assert.equal(g.period.status, 'running'); assert.equal(g.entryCount, 1); assert.equal(g.committedTasks[0].id, 't-b') })
  check('list: habit goal counts from the habit, not the stored number', () => {
    const d = data(); const range = G.goalPeriodRange('weekly', G.goalPeriodKey('weekly'))
    d.habitLog = [{ habitId: 'h-gym', day: range.from }, { habitId: 'h-gym', day: range.from }, { habitId: 'h-gym', day: range.to }]
    const g = G.listGoals(d, { where: 'all' }).goals.find((x) => x.id === 'g-gym')
    assert.equal(g.progress.current, 2); assert.equal(d.goals.find((x) => x.id === 'g-gym').current, 0); assert.match(g.source, /counted from habit "Gym"/)
  })
  check('list: closed goal keeps its final', () => { assert.deepEqual(by('g-old').progress.current, 1); assert.equal(by('g-old').period.status, 'closed'); assert.deepEqual(by('g-old').closed, { on: '2026-09-30', final: 1 }) })
  check('list: milestones and feeders', () => { assert.equal(by('g-ship').milestones.length, 3); assert.equal(by('g-ship').source, 'milestones'); assert.deepEqual(by('g-emails').feedingTasks, [{ id: 't-a', title: 'Připravit tabulku pro Michala', done: false, adds: 5 }]) })
  check('list: ended but not yet closed', () => { const d = world(); d.goals.find((g) => g.id === 'g-save').periodKey = '2026-09'; const x = G.listGoals(d, { where: 'open' }, '2026-11-07').goals.find((g) => g.id === 'g-save'); assert.match(x.period.status, /ended/) })
  const q = (await srv.call('list_goals', { query: 'audit', timeframe: 'quarter', space: 'work' })).json
  check('list query', () => assert.deepEqual(q.goals.map((g) => g.id), ['g-ship']))
}

/* ============================== nothing else is disturbed ============================== */
{
  const db = stateDb(world())
  const srv = fakeServer(K, M.tools_goals.register, db)
  const data = () => db.tables.mc_state[0].data
  const snap = clone(data())
  await srv.call('set_goal_progress', { id: 'g-emails', by: 1 })
  const now = data()
  check('only the goal changed', () => {
    for (const k of Object.keys(snap)) { if (['goals', 'lastWrite', 'savedAt'].includes(k)) continue; assert.deepEqual(now[k], snap[k], k) }
    assert.deepEqual(now.goals.filter((g) => g.id !== 'g-emails'), snap.goals.filter((g) => g.id !== 'g-emails'))
    assert.equal(now.lastWrite.name, 'Claude')
  })
  // a refusal writes nothing at all
  const calls = db.calls.updates
  await srv.call('set_goal_progress', { id: 'g-gym', by: 1 })
  check('refusal writes nothing', () => assert.equal(db.calls.updates, calls))
}

/* ============================== round 3: edit_goal in full (the Goals sheet) ============================== */
{
  const D = '2026-11-07', local = new Date(2026, 10, 7, 12)
  // timeframe change == GoalSheet save: periodKey = shiftPeriodKey(newTf, 0) = the period running now; number and entries untouched
  for (const from of ['weekly', 'monthly', 'quarter', 'half']) for (const to of ['weekly', 'monthly', 'quarter', 'half']) {
    if (from === to) continue
    const b = world(); const g = b.goals.find((x) => x.id === 'g-save'); g.timeframe = from; g.periodKey = G.goalPeriodKey(from, '2026-03-01')
    const old = clone(g)
    G.editGoal(b, { id: 'g-save' }, { timeframe: to }, D)
    assert.deepEqual(g, { ...old, timeframe: to, periodKey: M.appPeriodKey(to, local), touchedAt: D }, `${from} -> ${to}`)
  }
  check('timeframe change == the sheet, all 12 pairs', () => {})
  { // same timeframe, move_to_current_period moves a stale key; at the current period it changes nothing and says so
    const b = world(); b.goals.find((x) => x.id === 'g-emails').periodKey = '2026-W01'
    const r = G.editGoal(b, { id: 'g-emails' }, { moveToCurrentPeriod: true }, D)
    check('move_to_current_period', () => { assert.equal(b.goals.find((x) => x.id === 'g-emails').periodKey, M.appPeriodKey('weekly', local)); assert.match(r.text, /period 2026-W01 to /) })
    refuses(() => G.editGoal(b, { id: 'g-emails' }, { moveToCurrentPeriod: true }, D), /Nothing to change/)
  }
  { // why / deadline set and cleared; category
    const b = world()
    G.editGoal(b, { id: 'g-save' }, { why: 'Debt', deadline: 'End of July', category: 'health' }, D)
    const g = b.goals.find((x) => x.id === 'g-save')
    check('why/deadline/category', () => assert.deepEqual([g.why, g.deadline, g.category], ['Debt', 'End of July', 'health']))
    G.editGoal(b, { id: 'g-save' }, { why: '', deadline: null }, D)
    check('cleared', () => { assert.equal('why' in g, false); assert.equal('deadline' in g, false) })
    refuses(() => G.editGoal(b, { id: 'g-save' }, { category: 'fun' }, D), /category must be one of/)
  }
  { // milestones: the full list; kept labels keep id + tick; target follows (GoalSheet), the count is right
    const b = world(); const g = b.goals.find((x) => x.id === 'g-ship')
    G.editGoal(b, { id: 'g-ship' }, { milestones: ['Draft report', 'Client review', 'Send invoice', 'Archive'] }, D)
    check('milestones add', () => { assert.deepEqual(g.milestones.slice(0, 3), [{ id: 'ms-1', label: 'Draft report', done: true }, { id: 'ms-2', label: 'Client review', done: false }, { id: 'ms-3', label: 'Send invoice', done: false }]); assert.match(g.milestones[3].id, /^ms-/); assert.deepEqual([g.target, g.unit, g.current], [4, 'milestones', 1]) })
    G.editGoal(b, { id: 'g-ship' }, { milestones: ['Client review', 'Archive'] }, D) // removes the ticked one
    check('milestones remove a ticked one: the number follows', () => { assert.deepEqual(g.milestones.map((m) => m.label), ['Client review', 'Archive']); assert.deepEqual([g.target, g.current], [2, 0]) })
    refuses(() => G.editGoal(b, { id: 'g-ship' }, { milestones: ['a', 'b'], target: 9 }, D), /Leave target out/)
    refuses(() => G.editGoal(world(), { id: 'g-ship' }, { target: 7 }, D), /Pass milestones to change the list/)
    G.editGoal(b, { id: 'g-ship' }, { milestones: [] }, D)
    check('milestones cleared', () => assert.deepEqual([g.milestones, g.target], [[], 2]))
    refuses(() => G.editGoal(b, { id: 'g-ship' }, { milestones: Array(31).fill('x') }, D), /at most 30/)
    // a plain goal gets milestones: target becomes their count, the unit "milestones"
    const c = world(); G.editGoal(c, { id: 'g-save' }, { milestones: ['a', 'b'] }, D)
    check('plain goal gets milestones', () => { const s = c.goals.find((x) => x.id === 'g-save'); assert.deepEqual([s.target, s.unit, s.current], [2, 'milestones', 0]) })
  }
  { // habit link and unlink
    const b = world()
    refuses(() => G.editGoal(b, { id: 'g-save' }, { habit: 'deep work' }, D), /No personal habit matches/) // the Sheet offers only the goal's own space
    G.editGoal(b, { id: 'g-save' }, { habit: 'gym', unit: undefined }, D)
    const g = b.goals.find((x) => x.id === 'g-save')
    check('link habit', () => assert.deepEqual([g.habitId, g.unit], ['h-gym', 'checkoffs']))
    refuses(() => G.editGoal(b, { id: 'g-save' }, { unit: 'x' }, D), /unit follows the habit/)
    refuses(() => G.editGoal(world(), { id: 'g-ship' }, { habit: 'deep' }, D), /milestones/) // a milestone goal cannot also be habit-fed
    const w = world(); G.editGoal(w, { id: 'g-ship' }, { habit: 'deep work', milestones: [] }, D)
    check('time-fed habit => hours', () => assert.deepEqual([w.goals.find((x) => x.id === 'g-ship').habitId, w.goals.find((x) => x.id === 'g-ship').unit], ['h-focus', 'hours']))
    // unlink keeps the number the app was showing
    const u = world(); const gg = u.goals.find((x) => x.id === 'g-gym'); const range = G.goalPeriodRange('weekly', gg.periodKey)
    u.habitLog = [{ habitId: 'h-gym', day: range.from }, { habitId: 'h-gym', day: range.to }]
    const shown = G.goalNow(u, gg)
    G.editGoal(u, { id: 'g-gym' }, { habit: null }, D)
    check('unlink keeps the shown number', () => { assert.equal(shown, 2); assert.equal('habitId' in gg, false); assert.equal(gg.current, 2) })
    refuses(() => G.editGoal(u, { id: 'g-gym' }, { habit: null }, D), /not tied to a habit/)
    refuses(() => G.editGoal(world(), { id: 'g-save' }, { habit: 'nope' }, D), /No personal habit matches/)
    const paused = world(); paused.habits[0].paused = true
    refuses(() => G.editGoal(paused, { id: 'g-save' }, { habit: 'gym' }, D), /No personal habit matches/)
  }
  // through the tool, with zod
  const db = stateDb(world()); const srv = fakeServer(K, M.tools_goals.register, db); const data = () => db.tables.mc_state[0].data
  let r = await srv.call('edit_goal', { id: 'g-save', timeframe: 'weekly' })
  check('edit_goal tool: timeframe', () => { assert.equal(r.isError, false, r.text); const g = data().goals.find((x) => x.id === 'g-save'); assert.deepEqual([g.timeframe, g.periodKey, g.current, g.entries.length], ['weekly', G.goalPeriodKey('weekly'), 5000, 1]) })
  r = await srv.call('edit_goal', { id: 'g-save', why: null, deadline: 'Friday' })
  check('edit_goal tool: nullable why', () => assert.equal(data().goals.find((x) => x.id === 'g-save').deadline, 'Friday'))
  if (K.zodReal) await assert.rejects(() => srv.call('edit_goal', { id: 'g-save', timeframe: 'yearly' }), /Invalid|enum/i)
  // merge: a stale app copy does not undo the timeframe move or the milestone edit
  const app = world(); const d2 = stateDb(clone(app)); const s2 = fakeServer(K, M.tools_goals.register, d2)
  await s2.call('edit_goal', { id: 'g-save', timeframe: 'weekly', category: 'health' }); await s2.call('edit_goal', { id: 'g-ship', milestones: ['Draft report', 'Ship'] })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(d2.tables.mc_state[0].data)))
  check('merge: edits survive a stale copy', () => { const g = merged.goals.find((x) => x.id === 'g-save'); assert.deepEqual([g.timeframe, g.category], ['weekly', 'health']); assert.deepEqual(merged.goals.find((x) => x.id === 'g-ship').milestones.map((m) => m.label), ['Draft report', 'Ship']) })
}

/* ============================== round 3: add_goal with deadline, habit, period ============================== */
{
  const db = stateDb(world()); const srv = fakeServer(K, M.tools_goals.register, db); const data = () => db.tables.mc_state[0].data
  let r = await srv.call('add_goal', { name: 'Ship v2', target: 4, timeframe: 'weekly', period_key: '2026-W50', deadline: 'Fri', why: 'Launch' })
  check('add_goal planned forward + deadline', () => { assert.equal(r.isError, false, r.text); const g = data().goals.at(-1); assert.deepEqual([g.periodKey, g.deadline, g.why, g.timeframe], ['2026-W50', 'Fri', 'Launch', 'weekly']) })
  r = await srv.call('add_goal', { name: 'Ship v2', target: 4, timeframe: 'weekly', period_key: '2026-W50' }); check('same name, same planned period = duplicate', () => assert.match(r.text, /already an open weekly goal .* 2026-W50/))
  r = await srv.call('add_goal', { name: 'x', target: 1, timeframe: 'weekly', period_key: '2026-11' }); check('bad period_key', () => assert.match(r.text, /not a weekly key/))
  r = await srv.call('add_goal', { habit: 'gym', target: 12, timeframe: 'monthly' })
  check('add_goal from habit: name, space, unit, link', () => { assert.equal(r.isError, false, r.text); const g = data().goals.at(-1); assert.deepEqual([g.name, g.space, g.habitId, g.unit, g.target, g.current, g.milestones], ['Gym', 'personal', 'h-gym', 'checkoffs', 12, 0, []]) })
  r = await srv.call('add_goal', { habit: 'deep work', name: 'Focus 10h', target: 10, timeframe: 'weekly' })
  check('time-fed habit goal in the habit\'s space', () => { const g = data().goals.at(-1); assert.deepEqual([g.space, g.unit, g.name], ['work', 'hours', 'Focus 10h']) })
  r = await srv.call('add_goal', { habit: 'deep work', space: 'personal', target: 1 }); check('habit of another space refused', () => assert.match(r.text, /No personal habit matches/))
  r = await srv.call('add_goal', { habit: 'gym', milestones: ['a'], target: 1 }); check('habit + milestones refused', () => assert.match(r.text, /habit or milestones, not both/))
  r = await srv.call('add_goal', { habit: 'gym', timeframe: 'quarter' }); check('habit goal still needs a target', () => assert.match(r.text, /needs a target/))
  r = await srv.call('add_goal', { target: 3 }); check('no name and no habit', () => assert.equal(r.isError, true))
  const hb = world(); hb.habits[0].archivedAt = '2026-10-01'
  refuses(() => G.addGoal(hb, { habit: 'gym', target: 3 }), /No personal habit matches|No habit matches/)
}

/* ============================== round 3: close_ended_goals == store.tsx rollover ============================== */
{
  const D = '2026-11-07'
  const mk = () => {
    const b = world()
    b.goals = [
      { id: 'g-m', space: 'personal', name: 'Save', current: 7, target: 10, unit: 'CZK', note: '', timeframe: 'monthly', category: 'money', periodKey: '2026-09', milestones: [] },
      { id: 'g-run', space: 'personal', name: 'Still running', current: 1, target: 3, unit: 'x', note: '', timeframe: 'monthly', category: 'life', periodKey: G.goalPeriodKey('monthly', D), milestones: [] },
      { id: 'g-h', space: 'personal', name: 'Gym', current: 0, target: 3, unit: 'checkoffs', note: '', timeframe: 'weekly', habitId: 'h-gym', category: 'habits', periodKey: '2026-W40', milestones: [{ id: 'x', label: 'x', done: true }] },
      { id: 'g-f', space: 'work', name: 'Focus', current: 0, target: 5, unit: 'hours', note: '', timeframe: 'weekly', habitId: 'h-focus', category: 'habits', periodKey: '2026-W41', milestones: [] },
      { id: 'g-q', space: 'personal', name: 'No sugar', current: 0, target: 30, unit: 'checkoffs', note: '', timeframe: 'quarter', habitId: 'h-quit', category: 'habits', periodKey: '2026-Q3', milestones: [] },
      { id: 'g-done', space: 'personal', name: 'Old', current: 2, target: 2, unit: 'x', note: '', timeframe: 'monthly', periodKey: '2026-08', closed: { on: '2026-08-31', final: 2 } },
      { id: 'g-nokey', space: 'personal', name: 'Nokey', current: 0, target: 1, unit: 'x', note: '', timeframe: 'monthly' },
    ]
    b.habitLog = [{ habitId: 'h-gym', day: '2026-09-29' }, { habitId: 'h-gym', day: '2026-10-01' }, { habitId: 'h-gym', day: '2026-10-02' }, { habitId: 'h-gym', day: '2026-10-04' }]
    b.focusSessions = [{ day: '2026-10-06', minutes: 90, space: 'work' }, { day: '2026-10-07', minutes: 45, space: 'work' }, { day: '2026-10-08', minutes: 600, space: 'personal' }]
    return b
  }
  const b = mk(); const before = clone(b)
  const res = G.closeEndedGoals(b, D)
  const g = (id) => b.goals.find((x) => x.id === id)
  // each final == the app's own goalCurrent over the goal's own period (src/types/goals.ts), the same call store.tsx makes
  const appFinal = (id) => { const o = before.goals.find((x) => x.id === id); return M.appGoalCurrent(o, before.habits, before.habitLog, M.appPeriodRange(o.timeframe, o.periodKey), before.slips, before.focusSessions) }
  check('closes the ended ones with the app\'s numbers', () => {
    assert.deepEqual(g('g-m').closed, { on: '2026-09-30', final: 7 })
    assert.deepEqual(g('g-h').closed, { on: M.appPeriodRange('weekly', '2026-W40').to, final: appFinal('g-h') }); assert.equal(g('g-h').closed.final, 3) // 4 ticks over the week 28 Sep to 4 Oct, capped... counted days: 29 Sep, 1, 2, 4 Oct = 4, min(target 3)
    assert.deepEqual(g('g-f').closed, { on: M.appPeriodRange('weekly', '2026-W41').to, final: appFinal('g-f') }); assert.equal(g('g-f').closed.final, 2.3)
    assert.deepEqual(g('g-q').closed, { on: '2026-09-30', final: appFinal('g-q') })
  })
  check('left alone: running, already closed; a missing key is stamped', () => {
    assert.equal('closed' in g('g-run'), false); assert.deepEqual(g('g-done'), before.goals.find((x) => x.id === 'g-done'))
    assert.equal(g('g-nokey').periodKey, G.goalPeriodKey('monthly', D)); assert.equal('closed' in g('g-nokey'), false)
  })
  check('habit-fed goals renew for the period running now (store.tsx renewals)', () => {
    const rg = g('g-h-r2026W45'); assert.ok(rg); assert.deepEqual({ ...rg }, { ...before.goals.find((x) => x.id === 'g-h'), id: 'g-h-r2026W45', current: 0, milestones: [], periodKey: G.goalPeriodKey('weekly', D) }); assert.equal('closed' in rg, false)
    assert.ok(g('g-f-r2026W45')); assert.ok(g('g-q-r2026Q4'))
    assert.equal(b.goals.some((x) => x.id === 'g-m-r2026-09'), false); assert.equal(b.goals.filter((x) => /-r20\d\d/.test(x.id)).length, 3) // hand-logged goals stay one-off
    assert.match(res.text, /Closed 4 ended goals/); assert.match(res.text, /Renewed 3/); assert.match(res.text, /Stamped 1/)
  })
  const snap = clone(b); const again = G.closeEndedGoals(b, D)
  check('idempotent', () => { assert.deepEqual(b, snap); assert.match(again.text, /nothing was changed/) })
  // a renewal already running for the period is not doubled
  const c = mk(); c.goals.push({ ...before.goals.find((x) => x.id === 'g-h'), id: 'mine', periodKey: G.goalPeriodKey('weekly', D), milestones: [] })
  G.closeEndedGoals(c, D); check('no double renewal', () => assert.equal(c.goals.some((x) => x.id === 'g-h-r2026W45'), false))
  assert.match(G.closeEndedGoals({ goals: [] }, D).text, /no goals/)
  // through the tool + the real merge: the stale app copy (goals still open) does not reopen them
  const app = mk(); const db = stateDb(clone(app)); const srv = fakeServer(K, M.tools_goals.register, db)
  const out = await srv.call('close_ended_goals', {})
  const d = db.tables.mc_state[0].data
  check('close_ended_goals tool', () => { assert.equal(out.isError, false, out.text); assert.equal(d.goals.find((x) => x.id === 'g-m').closed.final, 7); assert.ok(d.goals.some((x) => /^g-h-r20/.test(x.id))) })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(d)))
  check('merge: closed goals stay closed against a stale open copy', () => { assert.deepEqual(merged.goals.find((x) => x.id === 'g-m').closed, { on: '2026-09-30', final: 7 }); assert.ok(merged.goals.some((x) => /^g-h-r20/.test(x.id))) })
  // list_goals still says "ended" before and "closed" after
  const lb = G.listGoals(mk(), { where: 'open' }, D).goals.find((x) => x.id === 'g-m'); const la = G.listGoals(d, { where: 'closed' }, D).goals.find((x) => x.id === 'g-m')
  check('list_goals follows', () => { assert.match(lb.period.status, /ended/); assert.equal(la.period.status, 'closed') })
}

/* ============================== round 3: set_task_goal for any running goal; credit ============================== */
{
  const db = stateDb(world()); const srv = fakeServer(K, M.tools_goals.register, db); const data = () => db.tables.mc_state[0].data
  let r = await srv.call('set_task_goal', { id: 't-a', goal: 'save money', amount: 500 })
  check('monthly goal can be fed', () => { assert.equal(r.isError, false, r.text); assert.deepEqual([data().tasks.find((t) => t.id === 't-a').goalId, data().tasks.find((t) => t.id === 't-a').goalAmt], ['g-save', 500]) })
  const w = clone(data()); const t = w.tasks.find((x) => x.id === 't-a'); M.completeTask(w, { id: 't-a' }); G.creditGoal(w, t, 1)
  check('and is credited on finishing (creditGoal feeds any running goal)', () => assert.equal(w.goals.find((x) => x.id === 'g-save').current, 5500))
  r = await srv.call('set_task_goal', { id: 't-a', goal_id: 'g-old' }); check('finished goal still refused (never credited)', () => assert.match(r.text, /finished goal/))
}

/* ============================== round 3: delete_project with MANY tasks ============================== */
{
  const N = 30
  const app = world(); for (let i = 0; i < N; i++) app.tasks.push({ id: `t-bulk${i}`, title: `Bulk ${i}`, source: 'mc', estimateMin: 0, done: i % 2 === 0, space: 'personal', list: 'backlog', category: 'quick', projectId: 'p-home', createdAt: '2026-11-01', addedAt: 100 + i })
  const db = stateDb(clone(app)); const srv = fakeServer(K, M.tools_goals.register, db); const data = () => db.tables.mc_state[0].data
  const keep = app.tasks.filter((t) => t.projectId !== 'p-home').map((t) => t.id)
  const r = await srv.call('delete_project', { name: 'home', mode: 'delete' })
  check(`delete_project delete (${N + 1} tasks)`, () => {
    assert.equal(r.isError, false, r.text); assert.match(r.text, new RegExp(`its ${N + 1} tasks`))
    assert.deepEqual(data().tasks.map((t) => t.id), keep, 'only the others remain, in order'); assert.equal(data().projects.some((p) => p.id === 'p-home'), false)
    const keys = data().graveyard.map((x) => x.k); assert.equal(keys.length, N + 2); assert.ok(keys.includes('projects:p-home') && keys.includes('tasks:t-h1') && keys.includes(`tasks:t-bulk${N - 1}`))
    for (const k of keys) assert.match(k, /^(projects|tasks):/)
  })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(data())))
  check('merge: nothing of it comes back from a stale copy', () => { assert.equal(merged.projects.some((p) => p.id === 'p-home'), false); assert.equal(merged.tasks.some((t) => t.projectId === 'p-home' || /^t-bulk|^t-h1$/.test(t.id)), false); assert.equal(merged.tasks.length, keep.length) })
  // the allowance is EXACT: one extra removed row, or one too few declared, is still stopped by the writer
  const bad = world(); for (let i = 0; i < 5; i++) bad.tasks.push({ id: `t-x${i}`, title: `X ${i}`, projectId: 'p-home', done: false })
  const sdb = () => stateDb(clone(bad))
  await M.commit(sdb(), 'u1', (b) => G.deleteProject(b, { id: 'p-home' }, 'delete'), { sleep: async () => {} }) // exact: passes
  await assert.rejects(() => M.commit(sdb(), 'u1', (b) => { G.deleteProject(b, { id: 'p-home' }, 'delete'); b.tasks = b.tasks.filter((t) => t.id !== 't-a'); return { text: 'x' } }, { sleep: async () => {} }), /Safety stop: "tasks"/)
  // move mode needs no allowance and removes no task
  const mv = world(); G.deleteProject(mv, { id: 'p-car' }, 'move'); check('move keeps every task', () => assert.equal(mv.tasks.length, world().tasks.length))
  // a project with no tasks in delete mode
  const none = world(); const rr = G.deleteProject(none, { id: 'p-sonar' }, 'delete'); check('delete mode, no tasks', () => assert.match(rr.text, /^Deleted project "Sonar"/))
}

/* ============================== MUTATION: the cascade allowance is the rule that keeps this safe ============================== */
{
  const { build } = await import('esbuild')
  const src = (await import('fs')).readFileSync(new URL('../supabase/functions/mc-mcp/ops-goals.ts', import.meta.url), 'utf8')
  const FN = new URL('../supabase/functions/mc-mcp/', import.meta.url).pathname
  const bundle = async (mut) => {
    const out = await build({
      stdin: { contents: `export * from '${FN}ops.ts'; export * from '${FN}commit.ts'; export * as G from '${FN}ops-goals.ts'`, resolveDir: FN, loader: 'ts' },
      bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
      plugins: [{ name: 'mut', setup(bd) { bd.onLoad({ filter: /ops-goals\.ts$/ }, () => ({ contents: mut ? src.replace(mut[0], mut[1]) : src, loader: 'ts' })) } }],
    })
    return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  }
  const world5 = () => { const b = world(); for (let i = 0; i < 5; i++) b.tasks.push({ id: `t-m${i}`, title: `M ${i}`, projectId: 'p-home', done: false }); return b }
  const real = await bundle(null)
  await real.commit(stateDb(world5()), 'u1', (b) => real.G.deleteProject(b, { id: 'p-home' }, 'delete'), { sleep: async () => {} })
  const mutants = [['allowShrink(b, \'tasks\', theirs.length - 1)', 'allowShrink(b, \'tasks\', theirs.length - 2)'], ['allowShrink(b, \'tasks\', theirs.length - 1)', '/* no allowance */']]
  for (const [from, to] of mutants) {
    assert.ok(src.includes(from), 'mutation target exists')
    const bad = await bundle([from, to])
    await assert.rejects(() => bad.commit(stateDb(world5()), 'u1', (b) => bad.G.deleteProject(b, { id: 'p-home' }, 'delete'), { sleep: async () => {} }), /Safety stop/, `mutant "${to}" must be caught`)
  }
  check('mutation: an allowance one short, or none, makes the cascade fail; the real one passes', () => {})
  // mutation on the rollover: if a past goal were not closed, the test's "closes the ended ones" would fail
  const m2 = await bundle(['if (g.closed || !validPeriodKey(tf, key) || !periodIsPast(tf, key, today)) continue', 'continue'])
  const m1 = world(); m1.goals[0].periodKey = '2026-09'; real.G.closeEndedGoals(m1, '2026-11-07')
  const bb = world(); bb.goals[0].periodKey = '2026-09'; m2.G.closeEndedGoals(bb, '2026-11-07')
  check('mutation: the real rollover closes the ended goal, a mutant that closes nothing leaves it open (so the checks above would fail)', () => { assert.deepEqual(m1.goals[0].closed, { on: '2026-09-30', final: 5000 }); assert.equal(!!bb.goals[0].closed, false) })
}

console.log(`MCP goals: ${n} named checks and all inline assertions passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
