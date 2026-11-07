/* start_focus / stop_focus through the real registration path, and the app-side consumer
   (src/inbox-focus.ts) that turns the queued row into a real timer.
   `ZOD_PATH=... node tools/mcp-focus-test.mjs` */
import assert from 'assert/strict'
import { loadKit, fixture } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['tools-focus.ts'], extra: ["export * as appFocus from './src/inbox-focus.ts'"] })
const { M } = K
const { appFocus } = M

/* ---------- server side ---------- */
const db = K.fakeDb({ mc_inbox: [], mc_state: [{ id: 'u1', owner: 'u1', data: fixture(), updated_at: 'x' }] })
const srv = K.fakeServer(K, M.tools_focus.register, db)
assert.deepEqual(srv.names().sort(), ['start_focus', 'stop_focus'])

const a = await srv.call('start_focus', { title: 'dentist', minutes: 25 })
assert.equal(a.isError, false)
assert.equal(db.tables.mc_inbox.length, 1)
const { id, created_at, ...row } = db.tables.mc_inbox[0]
assert.match(id, /^[0-9a-f-]{36}$/)
assert.deepEqual(row, { owner: 'u1', op: 'focus', task_id: 't-b', title: 'Call the dentist', actual_min: 25 })
/* honest: queued, never started */
assert.match(a.text, /^Queued a focus on "Call the dentist" for 25 minutes\./)
assert.match(a.text, /cannot see whether it started/)
assert.match(a.text, /dropped/)
assert.doesNotMatch(a.text, /\b(Started|is running|has started)\b/)

/* the task's estimate is the default length; no task, no minutes: the app's own setting */
await srv.call('start_focus', { id: 't-b' })
assert.equal(db.tables.mc_inbox[1].actual_min, 10)
const plain = await srv.call('start_focus', { label: 'Deep work' })
assert.deepEqual([db.tables.mc_inbox[2].task_id, db.tables.mc_inbox[2].title, db.tables.mc_inbox[2].actual_min], [null, 'Deep work', null])
assert.match(plain.text, /length set in the app/)

/* refusals queue nothing */
const n = db.tables.mc_inbox.length
const none = await srv.call('start_focus', { title: 'zzzz nothing' })
assert.equal(none.isError, true)
const amb = await srv.call('start_focus', { title: 'call the' })
assert.equal(amb.isError, true); assert.match(amb.text, /matches 2/)
db.tables.mc_state[0].data.tasks[0].done = true
const done = await srv.call('start_focus', { id: 't-a' })
assert.equal(done.isError, true); assert.match(done.text, /already done/)
assert.equal(db.tables.mc_inbox.length, n, 'a refusal inserts nothing')
if (K.zodReal) {
  await assert.rejects(() => srv.call('start_focus', { minutes: 0 }), /too_small|>=1|Too small/i)
  await assert.rejects(() => srv.call('start_focus', { minutes: 9999 }), /too_big|<=480|Too big/i)
  await assert.rejects(() => srv.call('start_focus', { minutes: 2.5 }), /int|Invalid/i)
}

const st = await srv.call('stop_focus')
assert.equal(st.isError, false)
const { id: _i, created_at: _c, ...srow } = db.tables.mc_inbox.at(-1)
assert.deepEqual(srow, { owner: 'u1', op: 'focusStop', task_id: null, title: null, actual_min: null })
assert.match(st.text, /^Queued a stop\./); assert.match(st.text, /cannot see whether it started/)
assert.doesNotMatch(st.text, /\bStopped\b/)

/* a database refusal (e.g. the migration is not applied) is reported, nothing claimed */
const bad = K.fakeDb({ mc_inbox: [] }); bad.from = ((f) => (t) => { const q = f(t); if (t === 'mc_inbox') q.insert = () => Promise.resolve({ error: { message: 'new row violates row-level security policy' } }); return q })(bad.from)
const refused = await K.fakeServer(K, M.tools_focus.register, bad).call('stop_focus')
assert.equal(refused.isError, true); assert.match(refused.text, /Nothing was started|security policy/)

/* ---------- app side ---------- */
const NOW = Date.parse('2026-11-07T10:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()
const tasks = [{ id: 't-b', title: 'Call the dentist', estimateMin: 10, done: false }, { id: 't-d', title: 'Done thing', estimateMin: 5, done: true }]
const cmd = (it) => appFocus.focusCmdFromItem({ created_at: ago(5000), ...it }, tasks, NOW)

assert.deepEqual(cmd({ op: 'focus', task_id: 't-b', title: 'x', actual_min: 25 }), { do: 'start', minutes: 25, label: 'Call the dentist' })
assert.deepEqual(cmd({ op: 'focus', task_id: 't-b', actual_min: null }), { do: 'start', minutes: 10, label: 'Call the dentist' })
assert.deepEqual(cmd({ op: 'focus', title: 'Deep work' }), { do: 'start', minutes: undefined, label: 'Deep work' })
assert.deepEqual(cmd({ op: 'focusStop' }), { do: 'stop' })
/* ignored: not focus, malformed, stale, from the future, finished task */
for (const bad of [{ op: 'add', title: 'x' }, { op: 'done', task_id: 't-b' }, { op: 'focus', actual_min: 0 }, { op: 'focus', actual_min: 99999 }, { op: 'focus', actual_min: NaN }, { op: 'focus', task_id: 't-d' }, { op: 'focus', created_at: ago(11 * 60000) }, { op: 'focusStop', created_at: ago(11 * 60000) }, { op: 'focus', created_at: 'nope' }, { op: 'focus', created_at: ago(-5 * 60000) }]) {
  assert.equal(appFocus.focusCmdFromItem({ created_at: ago(5000), ...bad }, tasks, NOW), null, JSON.stringify(bad))
}
assert.equal(appFocus.focusCmdFromItem({ op: 'focus', title: 'no stamp' }, tasks, NOW), null, 'no created_at: cannot prove it is fresh')

/* the consumer drives the real timer controls */
const ctl = (phase) => { const calls = []; return { phase, calls, startFocus: (m, l) => calls.push(['start', m, l]), stop: () => calls.push(['stop']) } }
let c = ctl('idle'); assert.equal(appFocus.runFocusCmd({ do: 'start', minutes: 25, label: 'X' }, c), 'started'); assert.deepEqual(c.calls, [['start', 25, 'X']])
c = ctl('break'); assert.equal(appFocus.runFocusCmd({ do: 'start', minutes: 5 }, c), 'started')
c = ctl('await'); assert.equal(appFocus.runFocusCmd({ do: 'start' }, c), 'started')
c = ctl('focus'); assert.equal(appFocus.runFocusCmd({ do: 'start', minutes: 25 }, c), 'skipped'); assert.deepEqual(c.calls, [], 'a running block is never replaced')
c = ctl('focus'); assert.equal(appFocus.runFocusCmd({ do: 'stop' }, c), 'stopped'); assert.deepEqual(c.calls, [['stop']])
c = ctl('break'); assert.equal(appFocus.runFocusCmd({ do: 'stop' }, c), 'stopped')
c = ctl('idle'); assert.equal(appFocus.runFocusCmd({ do: 'stop' }, c), 'skipped'); assert.deepEqual(c.calls, [])
c = ctl('await'); assert.equal(appFocus.runFocusCmd({ do: 'stop' }, c), 'skipped')

console.log(`MCP focus: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
