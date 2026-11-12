/* Planning the day, time tracking and the calendar for the Claude connector.
   `ZOD_PATH=... node tools/mcp-planning-test.mjs`

   Held to the app's own rules (src/store/planner.ts, src/store.tsx logActual / logSubtaskActual /
   logFocusOn, src/types/core.ts SLOTS, src/calkind.ts) and to the app's REAL merge: a stale app
   copy merging against what the connector wrote must keep it. */
import assert from 'assert/strict'
import { loadKit, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['tools-planning.ts', 'ops-planning.ts'],
  extra: [
    "export { SLOTS as appSLOTS, slotMinutes as appSlotMinutes } from './src/types/core.ts'",
    "export { taskMinutes as appTaskMinutes, isEstimated as appIsEstimated, fmtDuration as appFmt, isoWeekKey as appIsoWeekKey } from './src/util.ts'",
    "export { isMeeting as appIsMeeting } from './src/calkind.ts'",
  ],
})
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const P = M.ops_planning

const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const TOMORROW = addDays(TODAY, 1)
const NOW = new Date('2026-11-07T10:00:00Z') // 11:00 in Prague, 2026-11-07

/* a blob with the rows these areas need */
const base = () => {
  const b = fixture()
  b.tasks.push(
    { id: 't-steps', title: 'Zpracovat feedback', source: 'mc', estimateMin: 15, estimated: true, done: false, space: 'work', list: 'backlog', category: 'deep', createdAt: '2026-11-01', addedAt: 4,
      subtasks: [{ id: 't-steps-s0', title: 'one', estimateMin: 5, done: false }, { id: 't-steps-s1', title: 'two', estimateMin: 10, done: false }] },
    { id: 't-done', title: 'Already finished', source: 'mc', estimateMin: 5, done: true, space: 'personal', list: 'today', plannedOn: TODAY, category: 'quick', createdAt: '2026-11-01', addedAt: 5 },
    { id: 't-goal', title: 'Write the report', source: 'mc', estimateMin: 40, estimated: true, done: false, space: 'work', list: 'today', plannedOn: TODAY, slot: 'afternoon', category: 'deep', goalId: 'g-week', goalAmt: 2, createdAt: '2026-11-01', addedAt: 6 },
    { id: 't-pin', title: 'Dentist visit', source: 'mc', estimateMin: 60, estimated: true, done: false, space: 'personal', list: 'today', plannedOn: TODAY, slot: 'noon', at: '13:00', category: 'call', createdAt: '2026-11-01', addedAt: 7 },
  )
  b.goals = [{ id: 'g-week', name: 'Ship 3 reports', current: 1, target: 3 }, { id: 'g-old', name: 'Closed', current: 3, target: 3, closed: { final: 3 } }]
  b.plan = { returnedIds: ['t-b'], returnedCount: 1 }
  return b
}
const ids = (rows) => rows.map((r) => r.id)

/* ---- 1. parity with the app's own helpers ---------------------------------------- */
for (const s of M.SLOTS) {
  assert.equal(P.slotMinutes(s), M.appSlotMinutes(s), `slotMinutes parity: ${s}`)
  const app = M.appSLOTS.find((x) => x.id === s)
  assert.deepEqual(P.SLOT_HOURS[s], { from: app.from, to: app.to }, `slot hours parity: ${s}`)
}
for (const t of [{ estimateMin: 0 }, { estimateMin: 25, estimated: true }, { estimateMin: 25 }, { estimateMin: 99, subtasks: [{ estimateMin: 5 }, { estimateMin: 10 }] }, { estimateMin: 0, subtasks: [] }]) {
  assert.equal(P.taskMinutes(t), M.appTaskMinutes(t), `taskMinutes parity ${JSON.stringify(t)}`)
  assert.equal(P.isEstimated(t), M.appIsEstimated(t), `isEstimated parity ${JSON.stringify(t)}`)
}
for (const n of [0, 5, 60, 75, 120, -30, 479]) assert.equal(P.fmtDuration(n), M.appFmt(n), `fmtDuration parity ${n}`)
for (const d of ['2026-01-01', '2026-11-07', '2026-12-31', '2027-01-01', '2024-12-30', '2021-01-03', '2026-08-31']) {
  assert.equal(P.isoWeekKey(d), M.appIsoWeekKey(new Date(`${d}T12:00:00`)), `isoWeekKey parity ${d}`)
}
for (const e of [{ allDay: true, people: ['a', 'b'] }, { allDay: false, link: 'x' }, { allDay: false, people: ['a'] }, { allDay: false, people: ['a', 'b'] }, { allDay: false }]) {
  assert.equal(P.isMeeting(e), M.appIsMeeting(e), `isMeeting parity ${JSON.stringify(e)}`)
}
assert.equal(P.pragueInstant('2026-11-07', '14:30').toISOString(), '2026-11-07T13:30:00.000Z', 'winter: Prague is UTC+1')
assert.equal(P.pragueInstant('2026-07-07', '14:30').toISOString(), '2026-07-07T12:30:00.000Z', 'summer: Prague is UTC+2')
assert.equal(P.pragueInstant('2026-03-29', '03:30').toISOString(), '2026-03-29T01:30:00.000Z', 'the morning the clocks go forward')

/* ---- 2. plan_day ------------------------------------------------------------------ */
{
  const b = base()
  const r = P.planDay(b, [
    { id: 't-a', date: TOMORROW, at: '09:30', minutes: 30 },       // backlog -> a day, pinned, estimated
    { title: 'insurance', slot: 'afternoon' },                     // backlog, slot only -> goes on today
    { id: 't-b', slot: 'evening' },                                // already on today: keeps its day
    { id: 't-pin', list: 'backlog' },                              // back on the list: loses day and pinned time
  ], TODAY)
  const t = (id) => b.tasks.find((x) => x.id === id)
  // what planner.ts moveTaskList + setTaskAt + setEstimate leave behind
  assert.deepEqual([t('t-a').list, t('t-a').plannedOn, t('t-a').at, t('t-a').slot, t('t-a').estimateMin, t('t-a').estimated], ['today', TOMORROW, '09:30', 'morning', 30, true])
  assert.deepEqual([t('t-c').list, t('t-c').plannedOn, t('t-c').slot, t('t-c').at], ['today', TODAY, 'afternoon', undefined], 'a slot on a list task puts it on today (assistant move)')
  assert.deepEqual([t('t-b').list, t('t-b').plannedOn, t('t-b').slot], ['today', TODAY, 'evening'])
  assert.deepEqual([t('t-pin').list, t('t-pin').plannedOn, t('t-pin').at], ['backlog', undefined, undefined])
  assert.deepEqual(b.plan.returnedIds, ['t-b'], 'a task that stayed on a day is still "returned"')
  assert.match(r.text, /Placed 4 tasks/)
  assert.deepEqual(r.days, [TODAY, TOMORROW].sort())
  // a returned task sent back to the list leaves the "you did not finish this" set (planner.ts moveTaskList)
  const b2 = base(); P.planDay(b2, [{ id: 't-b', list: 'backlog' }], TODAY)
  assert.deepEqual(b2.plan, { returnedIds: [], returnedCount: 0 })
  // a clock time implies its part of the day, even over a stale slot
  const b3 = base(); P.planDay(b3, [{ id: 't-b', at: '19:15' }], TODAY)
  assert.deepEqual([b3.tasks.find((x) => x.id === 't-b').slot, b3.tasks.find((x) => x.id === 't-b').at], ['evening', '19:15'])
}
/* every refusal is all-or-nothing and names the item */
{
  const cases = [
    [[{ id: 't-a', slot: 'morning' }, { id: 'nope', slot: 'noon' }], /Nothing was changed\. item 2 \(nope\): No task has the id "nope"/],
    [[{ id: 't-a', slot: 'morning' }, { title: 'call the', slot: 'noon' }], /item 2 \("call the"\): "call the" matches 2 tasks/],
    [[{ title: 'zzz-no-such', slot: 'noon' }], /item 1 \("zzz-no-such"\): No task matches/],
    [[{ id: 't-a', slot: 'morning' }, { id: 't-done', slot: 'noon' }], /item 2 \(t-done\): "Already finished" is already done/],
    [[{ id: 't-a', slot: 'morning' }, { id: 't-a', slot: 'noon' }], /item 2 \(t-a\) is the same task as item 1/],
    [[{ id: 't-a', at: '09:00', slot: 'evening' }], /09:00 is in the morning, not the evening/],
    [[{ id: 't-a', list: 'backlog', date: TOMORROW }], /cannot be combined/],
    [[{ id: 't-a' }], /nothing to place/],
    [[{ id: 't-steps', minutes: 20 }], /has steps, so its estimate is the sum/],
    [[{ id: 't-a', date: '07.11.2026' }], /date must be YYYY-MM-DD/],
    [[{ id: 't-a', at: '9:00' }], /at must be HH:MM/],
    [[], /at least one task/],
    [Array.from({ length: 41 }, () => ({ id: 't-a', slot: 'noon' })), /At most 40/],
  ]
  for (const [items, re] of cases) {
    const b = base(); const before = clone(b)
    refuses(() => P.planDay(b, items, TODAY), re)
    assert.deepEqual(b, before, `a refused batch changes nothing: ${JSON.stringify(items).slice(0, 80)}`)
  }
}
/* through the real registration path, real zod, real commit */
const db = stateDb(base())
const srv = fakeServer(K, M.tools_planning.register, db)
{
  const names = srv.names()
  assert.deepEqual(names.sort(), ['day_capacity', 'delete_focus_block', 'edit_focus_block', 'focus_stats', 'get_calendar', 'list_focus_blocks', 'log_focus', 'log_task_time', 'plan_day'])
  for (const n of names) { const c = srv.tools[n].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, `${n} fully described`) }
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.readOnlyHint).sort(), ['day_capacity', 'focus_stats', 'get_calendar', 'list_focus_blocks'])
  assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.destructiveHint), ['delete_focus_block'], 'only deleting a focus block is destructive')
  assert.match(srv.tools.log_task_time.cfg.description, /instead of complete_task/)
  assert.equal(srv.tools.get_calendar.cfg.annotations.openWorldHint, true)

  const ok = await srv.call('plan_day', { items: [{ id: 't-a', date: TOMORROW, at: '08:00', minutes: 20 }, { title: 'insurance', slot: 'noon' }] })
  assert.equal(ok.isError, false, ok.text)
  const rows = db.tables.mc_state[0].data.tasks
  assert.equal(rows.find((t) => t.id === 't-a').at, '08:00')
  assert.equal(rows.find((t) => t.id === 't-c').slot, 'noon')
  assert.equal(db.tables.mc_state[0].data.lastWrite.name, 'Claude')
  const writes = db.calls.updates
  const bad = await srv.call('plan_day', { items: [{ id: 't-b', slot: 'morning' }, { title: 'call the', slot: 'noon' }] })
  assert.equal(bad.isError, true); assert.match(bad.text, /item 2/)
  assert.equal(db.calls.updates, writes, 'a refused plan sends no write at all')
  if (K.zodReal) {
    await assert.rejects(() => srv.call('plan_day', { items: [] }), /too_small|>=1|Too small/i)
    await assert.rejects(() => srv.call('plan_day', { items: [{ id: 't-a', slot: 'lunch' }] }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('plan_day', { items: [{ id: 't-a', minutes: 0 }] }), /too_small|>=1|Too small/i)
    await assert.rejects(() => srv.call('log_task_time', { id: 't-a', minutes: 481 }), /too_big|<=480|Too big/i)
  }
}
/* the app's real merge keeps it */
{
  const stale = base(); stale.savedAt = 500
  const remote = clone(db.tables.mc_state[0].data)
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(remote)))
  const a = merged.tasks.find((t) => t.id === 't-a')
  assert.deepEqual([a.plannedOn, a.at, a.estimateMin], [TOMORROW, '08:00', 20], 'a stale app copy does not undo the plan')
  assert.equal(merged.tasks.find((t) => t.id === 't-c').slot, 'noon')
}

/* ---- 3. day_capacity --------------------------------------------------------------- */
{
  const b = base()
  b.tasks.push({ id: 't-big', title: 'Deep work block', estimateMin: 400, estimated: true, done: false, space: 'work', list: 'today', plannedOn: TODAY, slot: 'morning', category: 'deep' })
  b.tasks.push({ id: 't-unk', title: 'Mystery', estimateMin: 0, done: false, space: 'work', list: 'today', plannedOn: TODAY, slot: 'evening', category: 'quick' })
  b.tasks.push({ id: 't-unk2', title: 'Pinned, no length', estimateMin: 0, done: false, space: 'work', list: 'today', plannedOn: TODAY, slot: 'afternoon', at: '15:00', category: 'quick' })
  b.tasks.push({ id: 't-loose', title: 'No slot yet', estimateMin: 30, estimated: true, done: false, space: 'work', list: 'today', plannedOn: TODAY, category: 'quick' })
  b.tasks.push({ id: 't-old', title: 'Stale default', estimateMin: 20, done: false, space: 'work', list: 'today', plannedOn: TODAY, slot: 'noon', category: 'quick' })
  const c = P.dayCapacity(b, TODAY)
  const part = (s) => c.parts.find((p) => p.slot === s)
  assert.deepEqual([part('morning').capacityMin, part('noon').capacityMin, part('afternoon').capacityMin, part('evening').capacityMin], [360, 120, 240, 360])
  assert.equal(part('morning').plannedMin, 410, 'dentist-call 10 + big 400')
  assert.equal(part('morning').fits, 'no'); assert.equal(part('morning').overByMin, 50)
  assert.equal(part('evening').fits, 'unknown', 'an unestimated task is never "fits"'); assert.deepEqual(ids(part('evening').unestimatedTasks), ['t-unk'])
  assert.equal(part('evening').plannedMin, 0, 'and it is not counted as zero effort in a claim: it is listed')
  assert.equal(part('afternoon').fits, 'unknown'); assert.equal(part('afternoon').plannedMin, 40)
  assert.equal(part('noon').fits, 'yes'); assert.equal(part('noon').plannedMin, 80, 'dentist 60 + stale default 20')
  assert.deepEqual(ids(part('noon').unconfirmedEstimateTasks), ['t-old'], 'a bare default number is flagged, as the app\'s isEstimated does')
  assert.deepEqual(c.unsorted, { tasks: 1, plannedMin: 30, note: c.unsorted.note })
  assert.equal(c.dayCapacityMin, 1080); assert.equal(c.fitsWholeDay, 'unknown')
  assert.equal(c.done, 1); assert.equal(c.open, 8)
  assert.deepEqual(c.pinned.map((p) => [p.id, p.at, p.minutes]), [['t-pin', '13:00', 60], ['t-unk2', '15:00', 'not estimated']])
  assert.equal(c.pinned[0].ends, '14:00')
  // free windows: 06:00-24:00 minus the dentist 13:00-14:00 (the unestimated pin is NOT cut out)
  assert.deepEqual(c.freeWindows, [{ from: '06:00', to: '13:00', minutes: 420 }, { from: '14:00', to: '24:00', minutes: 600 }])
  assert.match(c.note, /1 pinned task\(s\) have no estimate/)
  // meetings passed in cut the windows and merge when they overlap
  const c2 = P.dayCapacity(b, TODAY, [{ from: '09:00', to: '10:30' }, { from: '10:00', to: '11:00' }, { from: '13:30', to: '15:00' }])
  assert.deepEqual(c2.freeWindows, [{ from: '06:00', to: '09:00', minutes: 180 }, { from: '11:00', to: '13:00', minutes: 120 }, { from: '15:00', to: '24:00', minutes: 540 }])
  refuses(() => P.dayCapacity(b, TODAY, [{ from: '11:00', to: '10:00' }]), /busy blocks need from and to/)
  refuses(() => P.dayCapacity(b, '07.11.2026'), /date must be/)
  // a quiet day fits for sure; nothing else on that date
  const q = P.dayCapacity(b, addDays(TODAY, 5))
  assert.equal(q.fitsWholeDay, 'yes'); assert.deepEqual(q.freeWindows, [{ from: '06:00', to: '24:00', minutes: 1080 }])
  // the read tool, with real zod
  const r = await fakeServer(K, M.tools_planning.register, stateDb(b)).call('day_capacity', { date: TODAY, busy: [{ from: '09:00', to: '10:00' }] })
  assert.equal(r.isError, false); assert.equal(r.json.parts.length, 4); assert.equal(r.json.freeWindows[0].to, '09:00')
}

/* ---- 4. log_task_time -------------------------------------------------------------- */
{
  // a flat task: store.tsx logActual
  const b = base(); const goalBefore = clone(b.goals)
  const r = P.logTaskTime(b, { id: 't-goal' }, 55, undefined, NOW)
  const t = b.tasks.find((x) => x.id === 't-goal')
  assert.deepEqual([t.done, t.actualMin, t.doneAt], [true, 55, NOW.toISOString()])
  assert.equal(b.ledger.length, 1); assert.equal(b.focusSessions.length, 1)
  const [l, f] = [b.ledger[0], b.focusSessions[0]]
  assert.deepEqual({ ...l, id: undefined }, { id: undefined, title: 'Write the report', category: 'deep', estimateMin: 40, actualMin: 55, when: '2026-11-07', space: 'work', weekKey: '2026-W45' })
  assert.match(l.id, /^l-/); assert.match(f.id, /^f-/)
  assert.deepEqual({ ...f, id: undefined }, { id: undefined, day: '2026-11-07', minutes: 55, label: 'Write the report', space: 'work', ledgerId: l.id, at: NOW.toISOString() })
  assert.deepEqual([b.goals[0].current, b.goals[0].touchedAt], [3, '2026-11-07'], 'the weekly goal the task feeds moved by goalAmt, capped at its target')
  assert.deepEqual(b.goals[1], goalBefore[1], 'a closed goal is history')
  assert.match(r.text, /55m logged/); assert.match(r.text, /Ship 3 reports/)
  // logging again: only the number changes, no second ledger/focus row, no second goal credit
  const again = P.logTaskTime(b, { id: 't-goal' }, 60, undefined, NOW)
  assert.equal(b.tasks.find((x) => x.id === 't-goal').actualMin, 60)
  assert.equal(b.ledger.length, 1); assert.equal(b.focusSessions.length, 1); assert.equal(b.goals[0].current, 3)
  assert.match(again.text, /no second ledger or focus row/)
  // a task finished earlier with complete_task (done, no actualMin) gets its rows now, without a goal credit
  const b2 = base(); M.completeTask(b2, { id: 't-goal' }); const cur = b2.goals[0].current
  P.logTaskTime(b2, { id: 't-goal' }, 30, undefined, NOW)
  assert.equal(b2.ledger.length, 1); assert.equal(b2.goals[0].current, cur)
  // no estimate: the ledger keeps 0 (= not estimated), and the answer says so
  const b3 = base(); const r3 = P.logTaskTime(b3, { id: 't-a' }, 12, undefined, NOW)
  assert.equal(b3.ledger[0].estimateMin, 0); assert.match(r3.text, /no estimate/)
  // a task with steps: all steps tick done (their own minutes untouched), ledger uses the steps' sum
  const b4 = base(); P.logTaskTime(b4, { id: 't-steps' }, 20, undefined, NOW)
  assert.deepEqual(b4.tasks.find((x) => x.id === 't-steps').subtasks.map((s) => [s.done, s.actualMin]), [[true, undefined], [true, undefined]])
  assert.equal(b4.ledger[0].estimateMin, 15)
}
{
  // one step at a time: store.tsx logSubtaskActual
  const b = base()
  const r1 = P.logTaskTime(b, { id: 't-steps' }, 7, { title: 'one' }, NOW)
  let t = b.tasks.find((x) => x.id === 't-steps')
  assert.deepEqual([t.done, t.subtasks[0].done, t.subtasks[0].actualMin, t.subtasks[1].done], [false, true, 7, false])
  assert.equal(b.ledger.length, 0); assert.equal(b.focusSessions.length, 0, 'not finished yet: no rows')
  assert.match(r1.text, /1 step\(s\) still open/)
  const r2 = P.logTaskTime(b, { id: 't-steps' }, 14, { id: 't-steps-s1' }, NOW)
  t = b.tasks.find((x) => x.id === 't-steps')
  assert.deepEqual([t.done, t.doneAt, t.actualMin], [true, NOW.toISOString(), undefined], 'the parent closes; the app leaves its own actualMin unset')
  assert.deepEqual({ ...b.ledger[0], id: undefined }, { id: undefined, title: 'Zpracovat feedback', category: 'deep', estimateMin: 15, actualMin: 21, when: '2026-11-07', space: 'work', weekKey: '2026-W45' })
  assert.deepEqual([b.focusSessions[0].minutes, b.focusSessions[0].ledgerId], [21, b.ledger[0].id])
  assert.match(r2.text, /21m in total/)
  // re-logging a step of a finished task writes nothing new
  P.logTaskTime(b, { id: 't-steps' }, 9, { id: 't-steps-s0' }, NOW)
  assert.equal(b.ledger.length, 1); assert.equal(b.focusSessions.length, 1); assert.equal(t.subtasks[0].actualMin, 9)
  refuses(() => P.logTaskTime(base(), { id: 't-a' }, 5, { title: 'x' }, NOW), /has no steps/)
  refuses(() => P.logTaskTime(base(), { id: 't-steps' }, 5, { title: 'nothing' }, NOW), /No step matches/)
}
{
  const b = base(); const before = clone(b)
  refuses(() => P.logTaskTime(b, { id: 'nope' }, 5, undefined, NOW), /No task has the id/)
  refuses(() => P.logTaskTime(b, { title: 'call the' }, 5, undefined, NOW), /matches 2 tasks/)
  refuses(() => P.logTaskTime(b, { id: 't-a' }, 0, undefined, NOW), /whole number from 1 to 480/)
  refuses(() => P.logTaskTime(b, { id: 't-a' }, 500, undefined, NOW), /whole number from 1 to 480/)
  refuses(() => P.logTaskTime(b, { id: 't-a' }, 2.5 * 0 + NaN, undefined, NOW), /whole number/)
  assert.deepEqual(b, before)
  // a goal with no numbers is refused whole, not half-credited
  const g = base(); g.goals[0].target = 'three'
  refuses(() => P.logTaskTime(g, { id: 't-goal' }, 5, undefined, NOW), /no numeric progress/)
}
{
  // the registered tool + the real merge
  const d = stateDb(base()); const s = fakeServer(K, M.tools_planning.register, d)
  const r = await s.call('log_task_time', { id: 't-b', minutes: 11 })
  assert.equal(r.isError, false, r.text)
  const data = d.tables.mc_state[0].data
  assert.equal(data.ledger.length, 1); assert.equal(data.focusSessions.length, 1); assert.equal(data.tasks.find((t) => t.id === 't-b').actualMin, 11)
  const stale = base(); stale.savedAt = 500
  stale.ledger = [{ id: 'l-app', title: 'older', category: 'quick', estimateMin: 5, actualMin: 5, when: '2026-11-01' }]
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(clone(data))))
  assert.equal(merged.ledger.length, 2, 'the app\'s own ledger row and the connector\'s are both kept')
  assert.equal(merged.focusSessions.length, 1)
  assert.equal(merged.tasks.find((t) => t.id === 't-b').done, true, 'a stale copy does not reopen the task')
}

/* ---- 5. log_focus ------------------------------------------------------------------ */
{
  const b = base()
  const r = P.logFocus(b, { minutes: 45, label: 'write the REPORT' }, NOW) // label = a task title, any case: the task's space (work) wins
  const f = b.focusSessions[0]; const l = b.ledger[0]
  assert.deepEqual({ ...f, id: undefined }, { id: undefined, day: '2026-11-07', minutes: 45, label: 'write the REPORT', space: 'work', ledgerId: l.id, at: NOW.toISOString() })
  assert.deepEqual({ ...l, id: undefined }, { id: undefined, title: 'Focus: write the REPORT', category: 'deep', estimateMin: 45, actualMin: 45, when: '2026-11-07', space: 'work', weekKey: '2026-W45' })
  assert.match(r.text, /Logged 45m of focus on write the REPORT \(work\)/)
  // a label that is a STEP's title files under the task that holds it
  const bs = base(); P.logFocus(bs, { minutes: 10, label: 'TWO' }, NOW); assert.equal(bs.focusSessions[0].space, 'work')
  // an unknown label / no label: the app uses the viewed space, which a server cannot see
  const b2 = base()
  refuses(() => P.logFocus(b2, { minutes: 20, label: 'Reading' }, NOW), /pass space/)
  refuses(() => P.logFocus(b2, { minutes: 20 }, NOW), /pass space/)
  P.logFocus(b2, { minutes: 20, space: 'personal' }, NOW)
  assert.deepEqual({ ...b2.ledger[0], id: undefined }, { id: undefined, title: 'Focus block', category: 'deep', estimateMin: 20, actualMin: 20, when: '2026-11-07', space: 'personal', weekKey: '2026-W45' })
  assert.equal('label' in b2.focusSessions[0], false, 'no label key at all, as JSON of the app\'s row')
  refuses(() => P.logFocus(base(), { minutes: 20, label: 'Write the report', space: 'personal' }, NOW), /files focus under the task's space/)
  // a day in the past with a clock time: "at" becomes the real instant it ended (the app's own readers parse an ISO string)
  const b3 = base(); P.logFocus(b3, { minutes: 30, label: 'Call the dentist', date: '2026-11-03', at: '14:30' }, NOW)
  assert.deepEqual([b3.focusSessions[0].day, b3.focusSessions[0].at, b3.ledger[0].when, b3.ledger[0].weekKey, b3.focusSessions[0].space], ['2026-11-03', '2026-11-03T13:30:00.000Z', '2026-11-03', '2026-W45', 'personal'])
  // newest first, like the app (prepended); ids unique; both log collections keep distinct identity keys
  const b4 = base()
  P.logFocus(b4, { minutes: 5, space: 'work' }, NOW); P.logFocus(b4, { minutes: 6, space: 'work' }, NOW)
  assert.deepEqual(b4.focusSessions.map((x) => x.minutes), [6, 5])
  assert.equal(new Set([...b4.focusSessions, ...b4.ledger].map((x) => x.id)).size, 4)
  assert.equal(new Set(b4.focusSessions.map((x) => M.appRowKey('focusSessions', x))).size, 2)
  // refusals
  const bad = base(); const before = clone(bad)
  refuses(() => P.logFocus(bad, { minutes: 0, space: 'work' }, NOW), /whole number from 1 to 480/)
  refuses(() => P.logFocus(bad, { minutes: 481, space: 'work' }, NOW), /whole number from 1 to 480/)
  refuses(() => P.logFocus(bad, { minutes: 5, space: 'work', date: '2026-11-08' }, NOW), /has not happened yet/)
  refuses(() => P.logFocus(bad, { minutes: 5, space: 'work', date: 'yesterday' }, NOW), /date must be/)
  refuses(() => P.logFocus(bad, { minutes: 5, space: 'work', at: '12:00' }, NOW), /has not happened yet/)
  refuses(() => P.logFocus(bad, { minutes: 5, space: 'work', at: '7pm' }, NOW), /at must be HH:MM/)
  assert.deepEqual(bad, before)
  // a double send is refused, a different block is not
  const dup = base()
  P.logFocus(dup, { minutes: 25, label: 'Reading', space: 'personal' }, NOW)
  refuses(() => P.logFocus(dup, { minutes: 25, label: 'Reading', space: 'personal' }, new Date(NOW.getTime() + 30000)), /already logged/)
  P.logFocus(dup, { minutes: 25, label: 'Reading', space: 'personal' }, new Date(NOW.getTime() + 600000))
  P.logFocus(dup, { minutes: 26, label: 'Reading', space: 'personal' }, new Date(NOW.getTime() + 30000))
  assert.equal(dup.focusSessions.length, 3)
  // the registered tool + merge
  const d = stateDb(base()); const s = fakeServer(K, M.tools_planning.register, d)
  const res = await s.call('log_focus', { minutes: 40, label: 'Deep work', space: 'work' })
  assert.equal(res.isError, false, res.text)
  const no = await s.call('log_focus', { minutes: 40 })
  assert.equal(no.isError, true); assert.match(no.text, /pass space/)
  const data = d.tables.mc_state[0].data
  assert.equal(data.focusSessions.length, 1)
  const stale = base(); stale.savedAt = 500; stale.focusSessions = [{ id: 'f-app', day: '2026-11-01', minutes: 25, space: 'work' }]
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(clone(data))))
  assert.deepEqual(merged.focusSessions.map((x) => x.id).sort(), ['f-app', data.focusSessions[0].id].sort(), 'union by id: neither side loses a block')
}

/* ---- 6. focus_stats ---------------------------------------------------------------- */
{
  const b = base()
  b.focusSessions = [
    { id: 'f1', day: '2026-11-07', minutes: 30, label: 'A', space: 'work' },
    { id: 'f2', day: '2026-11-07', minutes: 45, label: 'A', space: 'work' },
    { id: 'f3', day: '2026-11-06', minutes: 25, space: 'personal' },
    { id: 'f4', day: '2026-11-01', minutes: 60, label: 'B', space: 'work' }, // previous ISO week (W44), week of 10-26..11-01
    { id: 'f5', day: '2026-10-20', minutes: 90, label: 'old', space: 'work' },
  ]
  const s = P.focusStats(b, { from: '2026-11-01', to: '2026-11-07' })
  assert.deepEqual(s.buckets.map((x) => [x.day, x.minutes, x.blocks]), [['2026-11-07', 75, 2], ['2026-11-06', 25, 1], ['2026-11-01', 60, 1]])
  assert.equal(s.totalMin, 160); assert.equal(s.total, '2h 40m'); assert.equal(s.blocks, 4)
  assert.deepEqual(s.topLabels.slice(0, 2), [{ label: 'A', minutes: 75 }, { label: 'B', minutes: 60 }])
  const w = P.focusStats(b, { from: '2026-10-01', to: '2026-11-07', by: 'week', space: 'work' })
  assert.deepEqual(w.buckets.map((x) => [x.week, x.minutes]), [['2026-W45', 75], ['2026-W44', 60], ['2026-W43', 90]])
  assert.equal(w.totalMin, 225)
  const none = P.focusStats(b, { from: '2026-01-01', to: '2026-01-07' })
  assert.deepEqual([none.totalMin, none.buckets.length], [0, 0])
  refuses(() => P.focusStats(b, { from: '2026-11-08', to: '2026-11-07' }), /from is after to/)
  refuses(() => P.focusStats(b, { from: '2020-01-01', to: '2026-11-07' }), /At most 366/)
  const r = await fakeServer(K, M.tools_planning.register, stateDb(b)).call('focus_stats', { from: '2026-11-06', to: '2026-11-07', by: 'day' })
  assert.equal(r.json.totalMin, 100)
}

/* ---- 7. get_calendar --------------------------------------------------------------- */
{
  const ICAL_JSON = { events: [
    { uid: 'e1', day: TODAY, start: 570, end: 600, title: 'Standup', allDay: false, people: ['Boss', 'Michael'], link: 'https://meet.example/x' },
    { uid: 'e2', day: TODAY, start: null, end: null, title: 'Team offsite', allDay: true, people: [] },
    { uid: 'e3', day: TODAY, start: 720, end: 780, title: 'Gym', allDay: false, people: ['Michael'] },
    { uid: 'e4', day: addDays(TODAY, 2), start: 840, end: 870, title: 'Review', where: 'Room 4', allDay: false, people: ['A', 'B', 'C'] },
    { uid: 'e5', day: addDays(TODAY, 20), start: 600, end: 660, title: 'Far away', allDay: false, people: ['A', 'B'] },
  ] }
  const dbWith = (invoke) => { const d = stateDb(base()); d.functions = { invoke }; return d }
  const calls = []
  const okDb = dbWith(async (name, opts) => { calls.push([name, opts]); return { data: ICAL_JSON, error: null } })
  const s = fakeServer(K, M.tools_planning.register, okDb)

  const today = await s.call('get_calendar', {})
  assert.equal(today.isError, false, today.text)
  assert.match(calls[0][0], /^calendar\?days=\d+$/); assert.equal(calls[0][1].method, 'GET')
  assert.deepEqual(today.json.events.map((e) => [e.title, e.start ?? 'all-day', e.meeting]), [['Team offsite', 'all-day', false], ['Standup', '09:30', true], ['Gym', '12:00', false]], 'all-day leads, then clock order; own blocks are not meetings')
  assert.equal(today.json.events[1].end, '10:00'); assert.deepEqual(today.json.events[1].people, ['Boss', 'Michael'])
  const range = await s.call('get_calendar', { from: TODAY, to: addDays(TODAY, 3), only_meetings: true })
  assert.deepEqual(range.json.events.map((e) => e.title), ['Standup', 'Review'])
  assert.equal(range.json.events[1].where, 'Room 4')
  // read and empty is said as such
  const empty = await s.call('get_calendar', { from: addDays(TODAY, 5), to: addDays(TODAY, 5) })
  assert.equal(empty.json.count, 0); assert.match(empty.json.empty, /read and has no entries/)
  // the function also answers a JSON string
  const str = await fakeServer(K, M.tools_planning.register, dbWith(async () => ({ data: JSON.stringify(ICAL_JSON), error: null }))).call('get_calendar', {})
  assert.equal(str.json.count, 3)

  // it must SAY SO when it cannot see the calendar, never answer an empty day
  const failing = async (invoke) => fakeServer(K, M.tools_planning.register, dbWith(invoke)).call('get_calendar', {})
  const resp = (status, body) => ({ status, clone() { return this }, text: async () => body })
  const notSet = await failing(async () => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: resp(503, 'No calendar configured.') } }))
  assert.equal(notSet.isError, true); assert.match(notSet.text, /No work calendar is set up/); assert.doesNotMatch(notSet.text, /"events"/)
  const denied = await failing(async () => ({ data: null, error: { message: 'x', context: resp(401, 'Not allowed.') } }))
  assert.equal(denied.isError, true); assert.match(denied.text, /only answers his own session/)
  const down = await failing(async () => ({ data: null, error: { message: 'x', context: resp(502, 'Calendar feed answered 500.') } }))
  assert.equal(down.isError, true); assert.match(down.text, /could not be read \(502\)/); assert.match(down.text, /do not know what is on his day/)
  const thrown = await failing(async () => { throw new Error('fetch failed') })
  assert.equal(thrown.isError, true); assert.match(thrown.text, /could not be reached \(fetch failed\)/)
  const weird = await failing(async () => ({ data: { nothing: true }, error: null }))
  assert.equal(weird.isError, true); assert.match(weird.text, /do not assume the days are free/)
  const noFns = await fakeServer(K, M.tools_planning.register, stateDb(base())).call('get_calendar', {})
  assert.equal(noFns.isError, true); assert.match(noFns.text, /cannot be reached from here/)
  // window rules
  assert.equal((await s.call('get_calendar', { from: addDays(TODAY, -1) })).isError, true)
  assert.match((await s.call('get_calendar', { from: addDays(TODAY, -1) })).text, /only answers from today/)
  assert.match((await s.call('get_calendar', { to: addDays(TODAY, 40) })).text, /at most 31 days/)
  assert.match((await s.call('get_calendar', { from: TOMORROW, to: TODAY })).text, /to is before from/)
  // the window: forward from today only, at most 31 days, counted from the server's UTC day
  assert.deepEqual(P.calendarWindow({}, NOW), { from: '2026-11-07', to: '2026-11-07', days: 1 })
  assert.equal(P.calendarWindow({ to: '2026-12-07' }, NOW).days, 31)
  refuses(() => P.calendarWindow({ to: '2026-12-08' }, NOW), /at most 31 days/)
  const late = new Date('2026-11-07T23:30:00Z') // already 08 Nov in Prague, still 07 Nov on the server
  assert.deepEqual(P.calendarWindow({}, late), { from: '2026-11-08', to: '2026-11-08', days: 2 }, 'asks one day more so Prague\'s day is inside the feed\'s window')
  refuses(() => P.calendarWindow({ from: '2026-11-06' }, NOW), /only answers from today/)
}


/* ---- past focus blocks: list, edit, delete (src/store.tsx updateFocus / deleteFocus) ---- */
{
  const b = base()
  b.focusSessions = [
    { id: 'f-1', day: TODAY, minutes: 25, label: 'Write the report', space: 'work', ledgerId: 'l-1', at: '2026-11-07T09:30:00.000Z' },
    { id: 'f-2', day: addDays(TODAY, -1), minutes: 50, space: 'personal', ledgerId: 'l-2', at: '2026-11-06T18:00:00.000Z' },
    { id: 'f-old', day: addDays(TODAY, -30), minutes: 10, space: 'personal' },
  ]
  b.ledger = [
    { id: 'l-1', title: 'Focus: Write the report', estimateMin: 25, actualMin: 25, when: TODAY, space: 'work' },
    { id: 'l-2', title: 'Focus block', estimateMin: 50, actualMin: 50, when: addDays(TODAY, -1), space: 'personal' },
  ]
  const list = P.listFocusBlocks(b, {})
  assert.deepEqual(list.items.map((x) => x.id), ['f-1', 'f-2'], 'last 7 days, newest first')
  assert.equal(list.items[0].ended, '10:30', 'ended shown in Prague time')
  assert.deepEqual(P.listFocusBlocks(b, { from: addDays(TODAY, -40), label: 'report' }).items.map((x) => x.id), ['f-1'])

  const e = clone(b)
  P.editFocusBlock(e, { id: 'f-2', minutes: 70, label: 'Deep work' })
  assert.deepEqual([e.focusSessions[1].minutes, e.focusSessions[1].label], [70, 'Deep work'])
  assert.deepEqual([e.ledger[1].estimateMin, e.ledger[1].actualMin, e.ledger[1].title], [70, 70, 'Focus: Deep work'], 'ledger row follows, as in the app')
  P.editFocusBlock(e, { id: 'f-2', label: '' })
  assert.equal(e.focusSessions[1].label, undefined); assert.equal(e.ledger[1].title, 'Focus block')
  refuses(() => P.editFocusBlock(e, { id: 'nope', minutes: 5 }), /No focus block/)
  refuses(() => P.editFocusBlock(e, { id: 'f-1' }), /Nothing to change/)
  refuses(() => P.editFocusBlock(e, { id: 'f-1', minutes: 900 }), /1 to 480/)

  const d = clone(b)
  P.deleteFocusBlock(d, 'f-1')
  assert.deepEqual(d.focusSessions.map((x) => x.id), ['f-2', 'f-old'])
  assert.deepEqual(d.ledger.map((x) => x.id), ['l-2'], 'its ledger row goes too')
  const keys = d.graveyard.map((g) => g.k)
  assert.ok(keys.includes(M.appRowKey('focusSessions', { id: 'f-1' })) && keys.includes(M.appRowKey('ledger', { id: 'l-1' })), 'both buried with the app\'s own keys')
  // A stale app copy that still has the block must not bring it back.
  const merged = JSON.parse(M.mergeStates(JSON.stringify(b), JSON.stringify(d)))
  assert.ok(!merged.focusSessions.some((x) => x.id === 'f-1'), 'deleted block stays deleted after the real merge')
  assert.ok(!merged.ledger.some((x) => x.id === 'l-1'), 'its ledger row stays deleted after the real merge')

  // through the server: the commit safety stop accepts one focus + one ledger row
  const db = stateDb(clone(b))
  const srv = fakeServer(K, M.tools_planning.register, db)
  const r1 = await srv.call('delete_focus_block', { id: 'f-2' })
  assert.ok(!r1.isError, r1.text)
  const r2 = await srv.call('edit_focus_block', { id: 'f-1', minutes: 40 })
  assert.ok(!r2.isError, r2.text)
  const saved = db.tables.mc_state[0].data
  assert.deepEqual(saved.focusSessions.map((x) => [x.id, x.minutes]), [['f-1', 40], ['f-old', 10]])
  assert.equal(srv.tools.delete_focus_block.cfg.annotations.destructiveHint, true)
}

console.log(`MCP planning: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
