/* The Claude brain's mailbox, both halves, against an in-memory fake Supabase.
   `node tools/claude-brain-queue-test.mjs` -- exits non-zero on the first broken rule.

   No network, no key, no real model, no data of his. What it holds:
   - a request is claimed by exactly one answerer, never two
   - a bad row, an unknown model or a crashed model never reaches him as a hang
   - a stale 'working' row is failed, an old row is pruned
   - the app skips Claude at once when the Mac's heartbeat is stale
   - the app gives up on an unclaimed request and deletes it
   - the row is deleted after the answer is read, whatever the answer was
   - the assistant sends EVERY request to Claude by default, and falls back to
     the other brains when Claude is off, asleep or unreadable */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import assert from 'assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))

/* ---- a fake Supabase: just the calls these two files make ------------------- */
function fakeDb() {
  const tables = { mc_brain: [] }
  let n = 0
  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.cols = null; this.ret = false; this.one = null; this.ord = null; this.lim = null }
    select(c) { if (this.op === 'select') this.cols = c; else this.ret = true; this.retCols = c; return this }
    insert(r) { this.op = 'insert'; this.row = r; return this }
    update(p) { this.op = 'update'; this.patch = p; return this }
    delete() { this.op = 'delete'; return this }
    eq(k, v) { this.f.push((r) => r[k] === v); return this }
    lt(k, v) { this.f.push((r) => r[k] != null && r[k] < v); return this }
    order(k, o) { this.ord = [k, o?.ascending !== false]; return this }
    limit(x) { this.lim = x; return this }
    single() { this.one = 'single'; return this }
    maybeSingle() { this.one = 'maybe'; return this }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej) }
    proj(r, cols) {
      if (!cols || cols === '*') return { ...r }
      const o = {}
      for (const k of cols.split(',').map((x) => x.trim())) o[k] = r[k]
      return o
    }
    run() {
      const rows = tables[this.t]
      const hit = () => rows.filter((r) => this.f.every((fn) => fn(r)))
      if (this.op === 'insert') {
        const r = { id: `id${++n}`, kind: 'ask', status: 'queued', model: 'claude-haiku-5-5', reply: null, error: null, claimed_at: null, finished_at: null, beat_at: null, created_at: new Date().toISOString(), request: null, ...this.row }
        rows.push(r)
        if (!this.ret) return { data: null, error: null }
        return { data: this.one ? this.proj(r, this.retCols) : [this.proj(r, this.retCols)], error: null }
      }
      if (this.op === 'update') {
        const m = hit(); m.forEach((r) => Object.assign(r, this.patch))
        return { data: this.ret ? m.map((r) => this.proj(r, this.retCols)) : null, error: null }
      }
      if (this.op === 'delete') {
        for (const r of hit()) rows.splice(rows.indexOf(r), 1)
        return { data: null, error: null }
      }
      let m = hit()
      if (this.ord) m = [...m].sort((a, b) => (a[this.ord[0]] < b[this.ord[0]] ? -1 : 1) * (this.ord[1] ? 1 : -1))
      if (this.lim) m = m.slice(0, this.lim)
      const out = m.map((r) => this.proj(r, this.cols))
      if (this.one) return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }
  }
  return { tables, from: (t) => new Q(t) }
}

/* ---- the code under test, bundled once -------------------------------------- */
const out = await build({
  stdin: {
    contents: "export * from './src/assistant.ts'; export * as B from './src/claudebrain.ts'",
    resolveDir: resolve(HERE, '..'), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
  define: { 'import.meta.env': '{}' },
})
const store = { 'mc-groq-key': 'test' }
globalThis.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {} }
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }
const A = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
const D = await import('./claude-brain.mjs')

const UID = 'u1'
const db = fakeDb()
const wipe = () => { db.tables.mc_brain.length = 0 }
const req = (extra = {}) => ({ owner: UID, kind: 'ask', request: { system: 'S', turns: [{ role: 'user', content: 'hi' }] }, ...extra })
const ok = (text) => async () => ({ text, ms: 5, usage: {}, cost: 0 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 1. The transcript. One turn is passed as is; several become a log. */
assert.equal(D.transcriptOf([{ role: 'user', content: 'a' }]), 'a')
const t2 = D.transcriptOf([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }])
assert.match(t2, /USER:\na\n\nYOU \(earlier reply\):\nb\n\nUSER:\nc/)
assert.match(t2, /single JSON object\.$/)

/* 2. Bad rows are named, not run. */
assert.match(D.checkRequest({ request: null }), /no system prompt/)
assert.match(D.checkRequest({ request: { system: 'S', turns: [] } }), /no turns/)
assert.match(D.checkRequest({ request: { system: 'S', turns: [{ role: 'tool', content: 'x' }] } }), /malformed/)
assert.match(D.checkRequest({ request: { system: 'S', turns: [{ role: 'user', content: 'x'.repeat(250_000) }] } }), /too large/)
assert.equal(D.checkRequest(req()), null)

/* 3. A queued row is claimed and answered once; a second answerer gets nothing. */
{
  wipe(); db.tables.mc_brain.push({ id: 'r1', status: 'queued', model: 'claude-haiku-5-5', created_at: '2026-01-01T00:00:00Z', ...req() })
  let runs = 0
  const run = async (a) => { runs++; assert.equal(a.model, 'claude-haiku-5-5'); assert.equal(a.system, 'S'); return { text: '{"say":"ok"}', ms: 1, usage: {}, cost: 0 } }
  const row = { id: 'r1', model: 'claude-haiku-5-5', request: req().request }
  assert.equal(await D.handle(db, row, run), true)
  assert.equal(await D.handle(db, row, run), false, 'already claimed: a second daemon must not answer it')
  assert.equal(runs, 1)
  assert.equal(db.tables.mc_brain[0].status, 'done')
  assert.equal(db.tables.mc_brain[0].reply, '{"say":"ok"}')
}

/* 4. A crashed model becomes an error row, not a hang. */
{
  wipe(); db.tables.mc_brain.push({ id: 'r2', status: 'queued', created_at: '2026-01-01T00:00:00Z', ...req() })
  await D.handle(db, { id: 'r2', model: 'claude-haiku-5-5', request: req().request }, async () => { throw new Error('boom') })
  assert.equal(db.tables.mc_brain[0].status, 'error')
  assert.match(db.tables.mc_brain[0].error, /boom/)
}

/* 5. A malformed request is failed without spawning anything. */
{
  wipe(); db.tables.mc_brain.push({ id: 'r3', status: 'queued', created_at: '2026-01-01T00:00:00Z', ...req({ request: { system: '', turns: [] } }) })
  let spawned = false
  await D.handle(db, { id: 'r3', model: 'claude-haiku-5-5', request: { system: '', turns: [] } }, async () => { spawned = true; return { text: '' } })
  assert.equal(spawned, false)
  assert.equal(db.tables.mc_brain[0].status, 'error')
}

/* 6. A model name that is not on the list never reaches the command line. */
{
  wipe(); db.tables.mc_brain.push({ id: 'r4', status: 'queued', created_at: '2026-01-01T00:00:00Z', ...req() })
  let seen = null
  await D.handle(db, { id: 'r4', model: '--dangerously-skip-permissions', request: req().request }, async (a) => { seen = a.model; return { text: '{}', ms: 1, usage: {}, cost: 0 } })
  assert.equal(seen, 'claude-haiku-5-5')
}

/* 7. A sweep answers oldest first, fails a stuck row, prunes an old one. */
{
  wipe()
  const old = new Date(Date.now() - 10 * 60_000).toISOString()
  const ancient = new Date(Date.now() - 48 * 3600_000).toISOString()
  const mk = (c) => ({ request: { system: 'S', turns: [{ role: 'user', content: c }] } })
  const mins = (m) => new Date(Date.now() - m * 60_000).toISOString()
  db.tables.mc_brain.push(
    { id: 'b', status: 'queued', model: 'claude-haiku-5-5', created_at: mins(1), ...req(), ...mk('second') },
    { id: 'a', status: 'queued', model: 'claude-haiku-5-5', created_at: mins(2), ...req(), ...mk('first') },
    { id: 'stuck', status: 'working', claimed_at: old, created_at: mins(20), ...req() },
    { id: 'gone', status: 'done', created_at: ancient, ...req() },
  )
  const order = []
  const n = await D.sweep(db, UID, async (a) => { order.push(a.turns[0].content); return { text: '{}', ms: 1, usage: {}, cost: 0 } })
  assert.equal(n, 2)
  assert.equal(db.tables.mc_brain.find((r) => r.id === 'stuck').status, 'error')
  assert.equal(db.tables.mc_brain.some((r) => r.id === 'gone'), false)
  assert.deepEqual(order, ['first', 'second'], 'oldest request first')
  assert.equal(db.tables.mc_brain.find((r) => r.id === 'a').status, 'done')
}

/* 8. The heartbeat is one row, created then touched. */
{
  wipe()
  const st = await D.beat(db, UID)
  assert.equal(db.tables.mc_brain.filter((r) => r.kind === 'beat').length, 1)
  const first = db.tables.mc_brain[0].beat_at
  await sleep(5)
  await D.beat(db, UID, st)
  assert.equal(db.tables.mc_brain.filter((r) => r.kind === 'beat').length, 1)
  assert.notEqual(db.tables.mc_brain[0].beat_at, first)
}

/* ---- the app half ----------------------------------------------------------- */
const B = A.B
B.__setBrainClient({ client: db, uid: UID })
const W = { claim: 250, reply: 2000, poll: 15 }
const msgs = [{ role: 'system', content: 'SYS' }, { role: 'system', content: 'BRIEF' }, { role: 'user', content: 'do the thing' }]

/* 9. No heartbeat: off at once, nothing written. */
{
  wipe()
  const r = await B.askClaude(msgs, 'claude-haiku-5-5', W)
  assert.deepEqual(r, { ok: false, reason: 'mac-off' })
  assert.equal(db.tables.mc_brain.length, 0, 'no request left behind when the Mac is known to be off')
}

/* 10. A stale heartbeat counts as off. */
{
  wipe()
  db.tables.mc_brain.push({ id: 'hb', kind: 'beat', status: 'done', owner: UID, beat_at: new Date(Date.now() - 5 * 60_000).toISOString() })
  assert.equal(await B.macOnline(), false)
}

/* 11. Live Mac: request goes in, the daemon answers, the app reads it, the row is gone. */
{
  wipe(); await D.beat(db, UID)
  assert.equal(await B.macOnline(), true)
  let got = null
  const daemon = (async () => { await sleep(60); await D.sweep(db, UID, async (a) => { got = a; return { text: '{"say":"yes"}', ms: 1, usage: {}, cost: 0 } }) })()
  const r = await B.askClaude(msgs, 'claude-sonnet-5-5', W)
  await daemon
  assert.deepEqual(r, { ok: true, text: '{"say":"yes"}' })
  assert.equal(got.model, 'claude-sonnet-5-5')
  assert.equal(got.system, 'SYS\n\nBRIEF', 'the two system messages are merged for claude')
  assert.deepEqual(got.turns, [{ role: 'user', content: 'do the thing' }])
  await sleep(20)
  assert.equal(db.tables.mc_brain.filter((r) => r.kind === 'ask').length, 0, 'what he dictated leaves the table once read')
}

/* 12. Heartbeat fresh but nobody claims it: give up, delete, fall back. */
{
  wipe(); await D.beat(db, UID)
  const r = await B.askClaude(msgs, 'claude-haiku-5-5', W)
  assert.deepEqual(r, { ok: false, reason: 'mac-off' })
  await sleep(20)
  assert.equal(db.tables.mc_brain.filter((r) => r.kind === 'ask').length, 0)
}

/* 13. The daemon failed: the app is told, and the row is cleaned up. */
{
  wipe(); await D.beat(db, UID)
  const daemon = (async () => { await sleep(60); await D.sweep(db, UID, async () => { throw new Error('nope') }) })()
  const r = await B.askClaude(msgs, 'claude-haiku-5-5', W)
  await daemon
  assert.deepEqual(r, { ok: false, reason: 'failed' })
  await sleep(20)
  assert.equal(db.tables.mc_brain.filter((r) => r.kind === 'ask').length, 0)
}

/* 14. Claude is the default brain: on unless he switched it off, any length. */
const long = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ')
delete store['mc-claude-brain']
assert.equal(B.claudeWanted('tick groceries'), true, 'no saved choice means ON: Claude is the default')
store['mc-claude-brain'] = '0'
assert.equal(B.claudeWanted(long), false, 'off means off')
store['mc-claude-brain'] = '1'
assert.equal(B.claudeWanted(long), true)
assert.equal(B.claudeWanted('tick groceries'), true, 'no word limit')
store['mc-claude-model'] = 'rm -rf'
assert.equal(B.getClaudeModel(), 'claude-haiku-5-5', 'an unknown stored model falls back to Haiku')

/* ---- the assistant, end to end ---------------------------------------------- */
const brief = {
  now: '09:00', weekday: 'Saturday', planned: [], backlogCount: 0, backlog: [], oldest: [],
  habits: { due: 0, kept: 0, open: [] }, allHabits: [], routines: { due: 0, kept: 0, open: [] },
  meetings: [], blocks: [], tomorrow: [], tomorrowMeetings: [], focusToday: 0, goals: [],
  unfinishedYesterday: [], completedYesterday: [], weather: null, bills: null, quitting: [], nextTask: null,
}
const ran = []
const hands = { run: async (acts) => acts.map((a) => { ran.push(a); return { ok: true, text: `${a.kind} ok` } }), find: () => '(none)' }
let fetched = 0
globalThis.fetch = async () => {
  fetched++
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: 'From the backup brain.' }) } }] }), { status: 200 })
}
store['mc-claude-model'] = 'claude-haiku-5-5'
B.__setBrainClient({ client: db, uid: UID })

/* 15. A request, Mac awake: Claude answers, the backup brain is never called. */
{
  wipe(); await D.beat(db, UID); ran.length = 0; fetched = 0
  const daemon = (async () => { await sleep(80); await D.sweep(db, UID, ok('{"say":"On it.","do":[{"kind":"add","title":"Call the dentist"}]}')) })()
  const r = await A.ask(long, brief, [], hands)
  await daemon
  assert.equal(r.ok, true)
  assert.equal(r.reply.say, 'On it.')
  assert.equal(ran.length, 1)
  assert.equal(ran[0].kind, 'add')
  assert.equal(fetched, 0, 'Claude answered; Gemini and Groq were not asked')
}

/* 16. Mac asleep: the same dictation is answered by the backup brain, no error. */
{
  wipe(); ran.length = 0; fetched = 0
  const r = await A.ask(long, brief, [], hands)
  assert.equal(r.ok, true)
  assert.equal(r.reply.say, 'From the backup brain.')
  assert.equal(fetched, 1)
}

/* 17. Claude answers with something unreadable: the backup brain takes over. */
{
  wipe(); await D.beat(db, UID); fetched = 0
  const daemon = (async () => { await sleep(80); await D.sweep(db, UID, ok('')) })()
  const r = await A.ask(long, brief, [], hands)
  await daemon
  assert.equal(r.ok, true)
  assert.equal(r.reply.say, 'From the backup brain.')
  assert.equal(fetched, 1)
}

/* 18. A short command goes to Claude too when the Mac is awake. */
{
  wipe(); await D.beat(db, UID); fetched = 0; ran.length = 0
  const daemon = (async () => { await sleep(80); await D.sweep(db, UID, ok('{"say":"Ticked.","do":[{"kind":"done","match":"Groceries"}]}')) })()
  const r = await A.ask('tick groceries', brief, [], hands)
  await daemon
  assert.equal(r.reply.say, 'Ticked.')
  assert.equal(ran[0].kind, 'done')
  assert.equal(fetched, 0)
}

/* 19. And a short command with the Mac asleep is answered at once by the backup. */
{
  wipe(); fetched = 0
  const t0 = Date.now()
  const r = await A.ask('tick groceries', brief, [], hands)
  assert.equal(r.reply.say, 'From the backup brain.')
  assert.equal(fetched, 1)
  assert.ok(Date.now() - t0 < 500, 'no waiting on a sleeping Mac')
}

console.log('Claude brain mailbox: all checks passed.')
