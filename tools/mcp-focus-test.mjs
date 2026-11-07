/* The focus timer, written the way the app writes it (the synced `activeFocus` field).
   `ZOD_PATH=... node tools/mcp-focus-test.mjs`
   What it holds the connector to:
   - a start writes EXACTLY the shape src/pomodoro.tsx mirrors out, with a foreign `dev`, so every
     device adopts it
   - a start never replaces a focus block that is running, paused or finished-but-unlogged
   - a stop banks the whole minutes worked (a remote stop is adopted WITHOUT banking by the app,
     so the connector must), and the app's own mirror shape never collides with it
   - pause and resume keep the remaining time exact; extend banks then restarts; a break
     cannot start over a focus block
   - the app's real merge keeps the connector's timer against a stale copy */
import assert from 'assert/strict'
import { loadKit } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['tools-focus.ts', 'ops-focus.ts'] })
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const F = M.ops_focus
const T0 = Date.parse('2026-11-09T09:00:00.000Z') // a Monday morning
const MIN = 60_000

/* start on a task: the row is exactly what pomodoro.tsx would write */
{
  const b = fixture()
  b.tasks.find((t) => t.id === 't-b').estimateMin = 10
  const r = F.startFocus(b, { title: 'call the dentist' }, T0)
  assert.match(r.text, /Focus started on "Call the dentist": 10 minutes/)
  assert.deepEqual(b.activeFocus, {
    phase: 'focus', endsAt: T0 + 10 * MIN, pausedLeft: null, startedAt: T0, blockMin: 10, focusLabel: 'Call the dentist', taskId: 't-b', space: 'personal', dev: 'claude-mcp', updatedAt: T0,
  })
  assert.equal(b.activeFocus.dev !== 'd-test', true, 'a foreign device id, so every device adopts it')
}
/* explicit minutes, no task: needs a space; label is free text */
{
  const b = fixture()
  refuses(() => F.startFocus(b, { minutes: 25 }, T0), /Which space/)
  refuses(() => F.startFocus(b, { space: 'work' }, T0), /How many minutes/)
  F.startFocus(b, { minutes: 25, space: 'work', label: '  Deep work ' }, T0)
  assert.deepEqual([b.activeFocus.blockMin, b.activeFocus.focusLabel, b.activeFocus.space, b.activeFocus.taskId], [25, 'Deep work', 'work', undefined])
  refuses(() => F.startFocus(fixture(), { title: 'call the insurance' }, T0), /has no estimate/, 'no invented default length')
  refuses(() => F.startFocus(fixture(), { title: 'nope', minutes: 5 }, T0), /No task matches/)
  const d = fixture(); d.tasks[0].done = true
  refuses(() => F.startFocus(d, { id: 't-a', minutes: 5 }, T0), /already done/)
  for (const bad of [0, 481, 1.5, -3]) refuses(() => F.startFocus(fixture(), { minutes: bad, space: 'work' }, T0), /whole number from 1 to 480/)
}
/* never replace a block that holds time */
{
  const b = fixture()
  F.startFocus(b, { minutes: 25, space: 'work', label: 'A' }, T0)
  refuses(() => F.startFocus(b, { minutes: 5, space: 'work' }, T0 + 5 * MIN), /already running with 20 min 00 s left/)
  F.pauseFocus(b, T0 + 5 * MIN)
  refuses(() => F.startFocus(b, { minutes: 5, space: 'work' }, T0 + 6 * MIN), /already paused with 20 min 00 s left/)
  refuses(() => F.startFocus(b, { minutes: 5, space: 'work' }, T0 + 90 * MIN), /already paused/)
  const e = fixture(); F.startFocus(e, { minutes: 25, space: 'work', label: 'A' }, T0)
  refuses(() => F.startFocus(e, { minutes: 5, space: 'work' }, T0 + 40 * MIN), /run out its time but has not been logged/, 'a finished-but-unlogged block is not overwritten')
  refuses(() => F.startBreak(e, 5, T0 + 5 * MIN), /stop_focus first/)
}
/* stop banks whole minutes worked, exactly the app's bankPartial */
{
  const b = fixture(); F.startFocus(b, { minutes: 25, space: 'work', label: 'Write deck' }, T0)
  const r = F.stopFocus(b, T0 + 10 * MIN + 40_000)
  assert.match(r.text, /Stopped the focus timer\. 10 minutes were logged as focus on "Write deck"/)
  assert.equal(b.activeFocus, null)
  assert.equal(b.focusSessions.length, 1)
  assert.deepEqual([b.focusSessions[0].minutes, b.focusSessions[0].label, b.focusSessions[0].space, b.focusSessions[0].day], [10, 'Write deck', 'work', '2026-11-09'])
  assert.equal(b.ledger.length, 1); assert.equal(b.ledger[0].actualMin, 10)
  // under a minute: nothing logged
  const c = fixture(); F.startFocus(c, { minutes: 25, space: 'work' }, T0)
  assert.match(F.stopFocus(c, T0 + 50_000).text, /Under a minute/); assert.equal(c.focusSessions.length, 0)
  // an expired block logs the FULL block (the app logs blockMin at zero)
  const d = fixture(); F.startFocus(d, { minutes: 25, space: 'work', label: 'X' }, T0)
  F.stopFocus(d, T0 + 3 * 60 * MIN); assert.equal(d.focusSessions[0].minutes, 25, 'never more than the block')
  // nothing running
  assert.match(F.stopFocus(fixture()).text, /No focus or break timer is running/)
  // a break stops without logging
  const e = fixture(); F.startBreak(e, 5, T0); F.stopFocus(e, T0 + 2 * MIN); assert.equal(e.activeFocus, null); assert.equal(e.focusSessions.length, 0)
}
/* pause and resume keep the time exact */
{
  const b = fixture(); F.startFocus(b, { minutes: 25, space: 'work' }, T0)
  F.pauseFocus(b, T0 + 7 * MIN)
  assert.deepEqual([b.activeFocus.endsAt, b.activeFocus.pausedLeft, b.activeFocus.phase], [null, 18 * 60, 'focus'])
  assert.match(F.pauseFocus(b, T0 + 8 * MIN).text, /already paused/)
  F.resumeFocus(b, T0 + 30 * MIN)
  assert.deepEqual([b.activeFocus.endsAt, b.activeFocus.pausedLeft], [T0 + 48 * MIN, null], 'resumes from the 18 minutes it had left')
  assert.match(F.resumeFocus(b, T0 + 31 * MIN).text, /already running/)
  refuses(() => F.pauseFocus(fixture()), /No timer is running/)
}
/* extend banks the worked time, then a fresh block under the same name */
{
  const b = fixture(); F.startFocus(b, { minutes: 25, space: 'work', label: 'Deck' }, T0)
  const r = F.extendFocus(b, 15, T0 + 25 * MIN)
  assert.match(r.text, /new 15 minute block on "Deck" is running; the 25 minutes already worked were logged/)
  assert.equal(b.focusSessions[0].minutes, 25)
  assert.deepEqual([b.activeFocus.blockMin, b.activeFocus.endsAt, b.activeFocus.startedAt], [15, T0 + 40 * MIN, T0 + 25 * MIN])
  refuses(() => F.extendFocus(fixture(), 5), /No focus block is running/)
}
/* a break, and the status read */
{
  const b = fixture(); F.startBreak(b, 5, T0)
  assert.deepEqual([b.activeFocus.phase, b.activeFocus.blockMin, b.activeFocus.focusLabel], ['break', 5, null])
  F.startFocus(b, { minutes: 10, space: 'work' }, T0 + MIN) // a running break is simply replaced
  assert.equal(b.activeFocus.phase, 'focus')
  const st = F.focusStatus(b, T0 + 4 * MIN)
  assert.deepEqual([st.running, st.phase, st.paused, st.secondsLeft, st.startedBy], [true, 'focus', false, 7 * 60, 'Claude'])
  assert.equal(F.focusStatus(fixture()).running, false)
  const done = fixture(); F.startFocus(done, { minutes: 5, space: 'work' }, T0)
  assert.match(F.focusStatus(done, T0 + 99 * MIN).warning, /not been logged/)
}
/* through registration + real zod + real commit, and the app's real merge */
{
  const db = stateDb(fixture())
  const srv = fakeServer(K, M.tools_focus.register, db)
  assert.deepEqual(srv.names().sort(), ['extend_focus', 'get_focus_timer', 'pause_focus', 'resume_focus', 'start_break', 'start_focus', 'stop_focus'])
  if (K.zodReal) {
    await assert.rejects(() => srv.call('start_focus', { minutes: 0, space: 'work' }), /too_small|>=1|Too small/i)
    await assert.rejects(() => srv.call('start_focus', { minutes: 481, space: 'work' }), /too_big|<=480|Too big/i)
    await assert.rejects(() => srv.call('extend_focus', {}), /minutes|Invalid|expected/i)
  }
  const bad = await srv.call('start_focus', { minutes: 20 }); assert.equal(bad.isError, true); assert.match(bad.text, /Which space/)
  const ok = await srv.call('start_focus', { minutes: 20, space: 'work', label: 'Deck' })
  assert.equal(ok.isError, false, ok.text)
  const saved = db.tables.mc_state[0].data
  assert.equal(saved.activeFocus.dev, 'claude-mcp'); assert.equal(saved.activeFocus.blockMin, 20)
  const dupe = await srv.call('start_focus', { minutes: 5, space: 'work' }); assert.equal(dupe.isError, true); assert.match(dupe.text, /already running/)
  const stat = await srv.call('get_focus_timer'); assert.equal(stat.json.running, true)
  // a stale copy (no timer, older save) merging against the connector's write keeps the timer
  const stale = { ...fixture(), savedAt: 500, activeFocus: null }
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(saved)))
  assert.equal(merged.activeFocus?.dev, 'claude-mcp', 'the timer survives a stale save')
  // and a stop is not undone by a stale copy that still shows the timer
  await srv.call('stop_focus')
  const after = db.tables.mc_state[0].data
  assert.equal(after.activeFocus, null)
  const staleRunning = { ...clone(saved), savedAt: 500 }
  const m2 = JSON.parse(M.mergeStates(JSON.stringify(staleRunning), JSON.stringify(after)))
  assert.equal(m2.activeFocus, null, 'a stop is not resurrected by an older copy')
}

console.log(`MCP focus timer: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
