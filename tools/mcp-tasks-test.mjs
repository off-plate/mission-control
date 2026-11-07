/* Bulk task tools (supabase/functions/mc-mcp/ops-tasks.ts, tools-tasks.ts): add_tasks, complete_tasks,
   reopen_tasks, delete_tasks, update_tasks. All or nothing, checked against the single-task functions,
   the goal credit of complete_task, the writer's safety stop and the app's real merge.
   `ZOD_PATH=... node tools/mcp-tasks-test.mjs` */
import assert from 'assert/strict'
import { readFileSync } from 'fs'
import { loadKit, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['ops-tasks.ts', 'tools-tasks.ts', 'tools-core.ts', 'tools-goals.ts', 'ops-goals.ts'] })
const { M, fixture, stateDb, fakeServer, clone } = K
const T = M.ops_tasks, G = M.ops_goals
let n = 0
const check = (name, fn) => { fn(); n++ }

function world() {
  const b = fixture()
  b.projects = [{ id: 'p-sonar', name: 'Sonar', space: 'work', createdAt: '2026-10-01' }, { id: 'p-off', name: 'Off-Plate', space: 'personal', createdAt: '2026-10-01' }]
  b.goals = [
    { id: 'g-week', space: 'personal', name: 'Send 20 emails', current: 4, target: 20, unit: 'emails', note: '', timeframe: 'weekly', category: 'offplate', periodKey: G.goalPeriodKey('weekly'), milestones: [] },
    { id: 'g-month', space: 'personal', name: 'Clear the backlog', current: 0, target: 10, unit: 'tasks', note: '', timeframe: 'monthly', category: 'life', periodKey: G.goalPeriodKey('monthly'), milestones: [] },
  ]
  b.tasks.push(
    { id: 't-d', title: 'Pay rent', source: 'mc', estimateMin: 0, done: true, doneAt: '2026-11-02T08:00:00.000Z', space: 'personal', list: 'today', plannedOn: TODAY, category: 'quick', createdAt: '2026-11-01', addedAt: 4, goalId: 'g-week', goalAmt: 3 },
    { id: 't-e', title: 'Email Anna', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', createdAt: '2026-11-01', addedAt: 5, goalId: 'g-week', goalAmt: 2 },
    { id: 't-f', title: 'Email Boris', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', createdAt: '2026-11-01', addedAt: 6, goalId: 'g-month', goalAmt: 1 },
  )
  return b
}
const setup = (b = world()) => { const db = stateDb(clone(b)); const srv = fakeServer(K, [M.tools_tasks.register, M.tools_core.register, M.tools_goals.register], db); return { db, srv, data: () => db.tables.mc_state[0].data } }
const nothing = async (srv, db, name, args, re, what) => {
  const before = JSON.stringify(db.tables.mc_state[0].data), calls = db.calls.updates
  const r = await srv.call(name, args)
  assert.equal(r.isError, true, `${what}: should be refused: ${r.text}`); assert.match(r.text, re, what)
  assert.equal(JSON.stringify(db.tables.mc_state[0].data), before, `${what}: data untouched`); assert.equal(db.calls.updates, calls, `${what}: no write`)
  return r
}

/* ============================== surface ============================== */
{
  const { srv } = setup()
  const names = ['add_tasks', 'complete_tasks', 'reopen_tasks', 'delete_tasks', 'update_tasks']
  check('registered, described, annotated', () => {
    for (const nm of names) { const c = srv.tools[nm].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, nm); assert.match(c.description, /all or nothing/i); assert.match(c.description, /60/) }
    assert.equal(srv.tools.delete_tasks.cfg.annotations.destructiveHint, true); assert.equal(srv.tools.add_tasks.cfg.annotations.destructiveHint, false)
  })
}

/* ============================== add_tasks ============================== */
{
  const { db, srv, data } = setup()
  const before = data().tasks.length
  const items = [
    { title: 'Call plumber', date: TODAY, at: '09:30' },
    { title: 'Order paint', list: 'backlog', minutes: 15 },
    { title: 'Draft proposal', project: 'sonar', steps: [{ title: 'Outline', minutes: 20 }, { title: 'Write', minutes: 40 }] },
    { title: 'Buy gift', space: 'personal', slot: 'evening', date: TODAY },
  ]
  const r = await srv.call('add_tasks', { items })
  check('add_tasks adds every item, in the order given, exactly as add_task would', () => {
    assert.equal(r.isError, false, r.text); assert.equal(data().tasks.length, before + 4)
    const mine = data().tasks.slice(0, 4); assert.deepEqual(mine.map((t) => t.title), items.map((i) => i.title))
    // each row equals what the single-task function builds
    items.forEach((it, k) => {
      const solo = world(); const res = M.addTask(solo, { ...it }); const want = solo.tasks.find((t) => t.id === res.id)
      const norm = (t) => ({ ...t, id: 0, addedAt: 0, ...(t.subtasks ? { subtasks: t.subtasks.map((x) => ({ ...x, id: 0 })) } : {}) })
      assert.deepEqual(norm(mine[k]), norm(want), it.title)
    })
    assert.deepEqual(mine[0].at && [mine[0].slot, mine[0].list], ['morning', 'today']); assert.equal(mine[2].projectId, 'p-sonar'); assert.equal(mine[2].estimateMin, 60)
    assert.equal(new Set(data().tasks.map((t) => t.id)).size, data().tasks.length, 'unique ids'); assert.match(r.text, /Added 4 tasks/)
  })
  // a dictated list of 60 in one call, then 61 refused
  const many = Array.from({ length: 60 }, (_, k) => ({ title: `Dictated ${k}` }))
  const r60 = await srv.call('add_tasks', { items: many })
  check('60 items in one commit', () => { assert.equal(r60.isError, false, r60.text); assert.deepEqual(data().tasks.slice(0, 60).map((t) => t.title), many.map((m) => m.title)) })
  if (K.zodReal) { await assert.rejects(() => srv.call('add_tasks', { items: [...many, { title: 'one more' }] }), /too_big|Too big|<=60/i); await assert.rejects(() => srv.call('add_tasks', { items: [] }), /too_small|Too small/i) }
  check('the ops layer also caps it', () => assert.throws(() => T.addTasks(world(), Array.from({ length: 61 }, (_, k) => ({ title: `x${k}` }))), (e) => e instanceof M.McError && /over the limit of 60/.test(e.message)))
  // refusals: nothing is added, the first bad item is named
  const snapDb = setup(); 
  { const s = setup(); s.data().tasks.find((t) => t.id === 't-d').done = false
    await nothing(s.srv, s.db, 'add_tasks', { items: [{ title: 'A' }, { title: 'Pay rent' }, { title: 'C' }] }, /Item 2 \("Pay rent"\): There is already an open task/, 'dupe of existing') }
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Same thing' }, { title: 'same THING' }] }, /Item 2 \("same THING"\): There is already an open task "Same thing"/, 'dupe inside the batch')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Ok' }, { title: 'Bad date', date: '2026-13-45' }] }, /Item 2 .*date must be YYYY-MM-DD/, 'bad date')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Ok' }, { title: 'Bad time', at: '25:00' }] }, /Item 2 .*at must be HH:MM/, 'bad time')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Ok' }, { title: 'No project', project: 'zzz' }] }, /Item 2 .*No project is called "zzz"/, 'bad project')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: '   ' }] }, /Item 1 .*needs a title/, 'blank')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Ok', period_key: '2026-11' }] }, /period_key goes with a horizon/, 'orphan period_key')
  await nothing(snapDb.srv, snapDb.db, 'add_tasks', { items: [{ title: 'Ok', horizon: 'weekly', period_key: '2026-11' }] }, /not a weekly key/, 'wrong period kind')
  // allow_duplicate lets the second through
  const ok = await srv.call('add_tasks', { items: [{ title: 'Twin' }, { title: 'Twin', allow_duplicate: true }] }); check('allow_duplicate in a batch', () => { assert.equal(ok.isError, false, ok.text); assert.equal(data().tasks.filter((t) => t.title === 'Twin').length, 2) })
  // horizon + goal extras
  const s2 = setup()
  const x = await s2.srv.call('add_tasks', { items: [{ title: 'Plan the month', horizon: 'monthly' }, { title: 'Pinned week', horizon: 'weekly', period_key: '2026-W50' }, { title: 'Send 5 intros', goal: 'send 20 emails', goal_amount: 5 }, { title: 'Clear a thing', goal: 'g-month' }] })
  check('horizon and goal extras', () => {
    assert.equal(x.isError, false, x.text); const t = (title) => s2.data().tasks.find((r) => r.title === title)
    assert.deepEqual([t('Plan the month').horizon, t('Plan the month').horizonKey], ['monthly', G.goalPeriodKey('monthly')]); assert.deepEqual([t('Pinned week').horizon, t('Pinned week').horizonKey], ['weekly', '2026-W50'])
    assert.deepEqual([t('Send 5 intros').goalId, t('Send 5 intros').goalAmt], ['g-week', 5]); assert.deepEqual([t('Clear a thing').goalId, t('Clear a thing').goalAmt], ['g-month', 1])
  })
  await nothing(s2.srv, s2.db, 'add_tasks', { items: [{ title: 'Ok' }, { title: 'x', goal: 'no such goal' }] }, /Item 2 .*No goal matches/, 'unknown goal')
  await nothing(s2.srv, s2.db, 'add_tasks', { items: [{ title: 'x', goal_amount: 3 }] }, /goal_amount goes with a goal/, 'orphan amount')
  // merge: a stale app copy does not drop what we added
  const app = world(); const d3 = setup(app)
  await d3.srv.call('add_tasks', { items: [{ title: 'From Claude 1' }, { title: 'From Claude 2' }] })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(d3.data())))
  check('merge: the new tasks survive a stale app copy', () => { assert.ok(merged.tasks.some((t) => t.title === 'From Claude 1') && merged.tasks.some((t) => t.title === 'From Claude 2')); assert.equal(merged.tasks.length, app.tasks.length + 2) })
  void db
}

/* ============================== complete_tasks / reopen_tasks: goal credit as core's complete_task ============================== */
{
  // the reference: the single tools, one by one
  const single = setup()
  for (const t of ['t-e', 't-f', 't-a']) await single.srv.call('complete_task', { id: t })
  const bulk = setup()
  const r = await bulk.srv.call('complete_tasks', { tasks: [{ id: 't-e' }, { title: 'Email Boris' }, { title: 'tabulku' }] })
  check('complete_tasks == complete_task one by one (rows and goal credit)', () => {
    assert.equal(r.isError, false, r.text)
    const strip = (d) => ({ tasks: d.tasks.map((t) => ({ ...t, doneAt: t.done ? 'x' : undefined })), goals: d.goals })
    assert.deepEqual(strip(bulk.data()), strip(single.data()))
    assert.equal(bulk.data().goals.find((g) => g.id === 'g-week').current, 6); assert.equal(bulk.data().goals.find((g) => g.id === 'g-month').current, 1)
    assert.match(r.text, /Goal: Send 20 emails \+2 \(now 6 of 20 emails\)/); assert.match(r.text, /Goal: Clear the backlog \+1/)
  })
  // an already-done task is not credited twice; the same task twice credits once
  const again = await bulk.srv.call('complete_tasks', { tasks: [{ id: 't-e' }, { id: 't-d' }] })
  check('already done: no second credit', () => { assert.match(again.text, /already done/); assert.equal(bulk.data().goals.find((g) => g.id === 'g-week').current, 6) })
  const dup = setup(); await dup.srv.call('complete_tasks', { tasks: [{ id: 't-e' }, { id: 't-e' }] })
  check('same task twice credits once', () => assert.equal(dup.data().goals.find((g) => g.id === 'g-week').current, 6))
  // reopen == reopen_task; credit taken back; never below 0
  const rr = await bulk.srv.call('reopen_tasks', { tasks: [{ id: 't-e' }, { id: 't-f' }, { id: 't-b' }] })
  check('reopen_tasks takes the credit back', () => {
    assert.equal(rr.isError, false, rr.text); assert.equal(bulk.data().goals.find((g) => g.id === 'g-week').current, 4); assert.equal(bulk.data().goals.find((g) => g.id === 'g-month').current, 0)
    assert.equal(bulk.data().tasks.find((t) => t.id === 't-e').done, false); assert.equal('doneAt' in bulk.data().tasks.find((t) => t.id === 't-e'), false); assert.match(rr.text, /was not done/)
  })
  // a finished goal is not rewritten by a late tick
  const closed = setup(); closed.data().goals[0].closed = { on: '2026-10-04', final: 4 }
  await closed.srv.call('complete_tasks', { tasks: [{ id: 't-e' }] }); check('closed goal untouched', () => assert.equal(closed.data().goals[0].current, 4))
  // refusals: unknown, ambiguous; nothing changes even for items before the bad one
  await nothing(bulk.srv, bulk.db, 'complete_tasks', { tasks: [{ id: 't-a' }, { id: 'nope' }] }, /Item 2 \(id nope\): No task has the id "nope"/, 'unknown id')
  await nothing(bulk.srv, bulk.db, 'complete_tasks', { tasks: [{ id: 't-a' }, { title: 'call the' }] }, /Item 2 \("call the"\): "call the" matches 2 tasks/, 'ambiguous')
  await nothing(bulk.srv, bulk.db, 'reopen_tasks', { tasks: [{ title: 'zzzz' }] }, /Item 1 .*No task matches/, 'none')
  await nothing(bulk.srv, bulk.db, 'complete_tasks', { tasks: [{}] }, /Item 1 .*Say which task/, 'empty ref')
  if (K.zodReal) await assert.rejects(() => bulk.srv.call('complete_tasks', { tasks: Array.from({ length: 61 }, () => ({ id: 't-a' })) }), /too_big|Too big/i)
  // merge: a stale copy keeps our completions and credits
  const app = world(); const m = setup(app); await m.srv.call('complete_tasks', { tasks: [{ id: 't-e' }, { id: 't-f' }] })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(m.data())))
  check('merge: completions and goal numbers survive a stale copy', () => { assert.equal(merged.tasks.find((t) => t.id === 't-e').done, true); assert.equal(merged.goals.find((g) => g.id === 'g-week').current, 6) })
}

/* ============================== update_tasks ============================== */
{
  const s = setup()
  const items = [{ id: 't-a', new_title: 'Prepare the sheet', minutes: 25 }, { title: 'dentist', date: '2026-12-01', at: '14:00' }, { id: 't-c', project: 'sonar' }, { id: 't-e', list: 'backlog' }]
  const r = await s.srv.call('update_tasks', { items })
  const ref = setup()
  await ref.srv.call('update_task', { id: 't-a', new_title: 'Prepare the sheet', minutes: 25 }); await ref.srv.call('update_task', { title: 'dentist', date: '2026-12-01', at: '14:00' }); await ref.srv.call('update_task', { id: 't-c', project: 'sonar' }); await ref.srv.call('update_task', { id: 't-e', list: 'backlog' })
  check('update_tasks == update_task one by one', () => {
    assert.equal(r.isError, false, r.text)
    const strip = (d) => d.tasks.map((t) => ({ ...t, addedAt: 0 })); assert.deepEqual(strip(s.data()), strip(ref.data()))
    assert.match(r.text, /Updated 4 tasks/); assert.equal(s.data().tasks.find((t) => t.id === 't-a').title, 'Prepare the sheet')
  })
  // references are resolved BEFORE items apply: a retitle does not change what a later item means
  const s2 = setup()
  const r2 = await s2.srv.call('update_tasks', { items: [{ id: 't-a', new_title: 'Call the plumber' }, { title: 'Call the dentist', minutes: 5 }] })
  check('refs resolved on the state as it was', () => { assert.equal(r2.isError, false, r2.text); assert.equal(s2.data().tasks.find((t) => t.id === 't-b').estimateMin, 5) })
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-a', minutes: 5 }, { id: 'nope', minutes: 5 }] }, /Item 2 \(id nope\)/, 'unknown')
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-a', minutes: 5 }, { id: 't-b' }] }, /Item 2 .*Nothing to change/, 'no field')
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-a', minutes: 5 }, { id: 't-c', date: 'soon' }] }, /Item 2 .*date must be YYYY-MM-DD/, 'bad date')
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-a', minutes: 5 }, { title: 'Prepare the sheet', at: '09:00' }] }, /Item 2 .*same task as item 1/, 'same task twice')
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-c', project: 'zzz' }] }, /No project is called "zzz"/, 'bad project')
  await nothing(s.srv, s.db, 'update_tasks', { items: [{ id: 't-a', new_title: '  ' }] }, /title cannot be empty/, 'blank title')
  const cl = await s.srv.call('update_tasks', { items: [{ id: 't-c', project: null }, { id: 't-b', at: null }] }); check('null clears', () => { assert.equal(cl.isError, false, cl.text); assert.equal('projectId' in s.data().tasks.find((t) => t.id === 't-c'), false) })
}

/* ============================== delete_tasks ============================== */
{
  const b = world(); for (let i = 0; i < 25; i++) b.tasks.push({ id: `t-del${i}`, title: `Junk ${i}`, source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'quick', addedAt: 50 + i })
  const s = setup(b)
  const ids = Array.from({ length: 25 }, (_, i) => `t-del${i}`)
  const r = await s.srv.call('delete_tasks', { tasks: [...ids.map((id) => ({ id })), { id: 't-del3' }, { title: 'Email Anna' }] })
  check('delete_tasks: 26 rows removed in one commit, each buried', () => {
    assert.equal(r.isError, false, r.text); assert.match(r.text, /Deleted 26 tasks/)
    assert.deepEqual(s.data().tasks.map((t) => t.id), ['t-a', 't-b', 't-c', 't-d', 't-f'])
    const keys = s.data().graveyard.map((x) => x.k).sort(); assert.deepEqual(keys, [...ids.map((i) => `tasks:${i}`), 'tasks:t-e'].sort())
    for (const id of [...ids, 't-e']) assert.equal(M.appRowKey('tasks', { id }), `tasks:${id}`)
  })
  const one = setup(); const r1 = await one.srv.call('delete_tasks', { tasks: [{ id: 't-a' }] }); check('delete_tasks with one', () => { assert.equal(r1.isError, false); assert.equal(one.data().tasks.length, 5) })
  // refusal deletes nothing, even the items before the bad one
  await nothing(s.srv, s.db, 'delete_tasks', { tasks: [{ id: 't-a' }, { id: 't-b' }, { id: 'nope' }] }, /Item 3 \(id nope\)/, 'unknown')
  await nothing(s.srv, s.db, 'delete_tasks', { tasks: [{ id: 't-a' }, { title: 'call the' }] }, /Item 2 .*matches 2 tasks/, 'ambiguous')
  // titles are resolved on the state as it was: "Email" matches two, so it is refused even if one is also named
  const amb = setup(); await nothing(amb.srv, amb.db, 'delete_tasks', { tasks: [{ title: 'Email Anna' }, { title: 'Email' }] }, /Item 2 .*matches 2 tasks/, 'resolved before deleting')
  // merge: a stale app copy still holding them does not bring them back
  const app = clone(b); const m = setup(clone(b)); await m.srv.call('delete_tasks', { tasks: ids.slice(0, 10).map((id) => ({ id })) })
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(m.data())))
  check('merge: deleted tasks stay deleted', () => { assert.equal(merged.tasks.some((t) => ids.slice(0, 10).includes(t.id)), false); assert.equal(merged.tasks.length, app.tasks.length - 10) })
  // delete then the writer stop is exact: removing ONE MORE than declared is still stopped
  const bad = setup(clone(b)).db
  await assert.rejects(() => M.commit(bad, 'u1', (x) => { T.deleteTasks(x, [{ id: 't-del0' }, { id: 't-del1' }, { id: 't-del2' }]); x.tasks = x.tasks.filter((t) => t.id !== 't-a'); return { text: 'x' } }, { sleep: async () => {} }), /Safety stop: "tasks"/)
}

/* ============================== MUTATION: the delete allowance is exact ============================== */
{
  const { build } = await import('esbuild')
  const FN = new URL('../supabase/functions/mc-mcp/', import.meta.url).pathname
  const src = readFileSync(`${FN}ops-tasks.ts`, 'utf8')
  const bundle = async (mut) => {
    const out = await build({
      stdin: { contents: `export * from '${FN}ops.ts'; export * from '${FN}commit.ts'; export * as T from '${FN}ops-tasks.ts'`, resolveDir: FN, loader: 'ts' },
      bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
      plugins: [{ name: 'mut', setup(bd) { bd.onLoad({ filter: /ops-tasks\.ts$/ }, () => ({ contents: mut ? src.replace(mut[0], mut[1]) : src, loader: 'ts' })) } }],
    })
    return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  }
  const refs = [{ id: 't-a' }, { id: 't-b' }, { id: 't-c' }, { id: 't-e' }]
  const real = await bundle(null)
  await real.commit(stateDb(world()), 'u1', (b) => real.T.deleteTasks(b, refs), { sleep: async () => {} })
  const from = "allowShrink(b, 'tasks', ids.length - 1)"
  assert.ok(src.includes(from))
  for (const to of ["allowShrink(b, 'tasks', ids.length - 2)", '/* none */']) {
    const bad = await bundle([from, to])
    await assert.rejects(() => bad.commit(stateDb(world()), 'u1', (b) => bad.T.deleteTasks(b, refs), { sleep: async () => {} }), /Safety stop/, `mutant ${to}`)
  }
  // and the goal credit is the rule that is easiest to lose: a mutant that skips it is caught by the same assertion the test makes
  const m2 = await bundle(['const fed = !was ? creditGoal(b, t, 1) : null', 'const fed = null'])
  const w = world(); m2.T.completeTasks(w, [{ id: 't-e' }])
  const w2 = world(); real.T.completeTasks(w2, [{ id: 't-e' }])
  check('mutation: delete allowance off by one / none is stopped; a complete_tasks that skips the goal credit is detected', () => { assert.equal(w.goals[0].current, 4); assert.equal(w2.goals[0].current, 6) })
}

console.log(`MCP bulk tasks: ${n} named checks and all inline assertions passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
