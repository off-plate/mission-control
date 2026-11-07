/* The Claude connector's data layer, no network, no model, no real data.
   `node tools/mcp-ops-test.mjs` -- exits non-zero on the first broken rule.

   What it holds the connector to:
   - every operation does what the app's own store function does (ids, ordering,
     slot-from-time, the project's space, the steps' estimate, the tombstone)
   - it NEVER guesses: an ambiguous title, an unknown project, a duplicate task,
     a habit it cannot tick safely are all refusals that name the rows
   - it never invents a number: an estimate he did not give stays 0
   - the writer is a compare-and-swap: a save that landed in between is never
     overwritten, and a bug that would wipe a list stops before it writes
   - THE APP'S REAL MERGE (src/sync-merge.ts) keeps what the connector did: a
     delete stays deleted, an appended note raises no conflict, a new task survives */
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import assert from 'assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const out = await build({
  stdin: {
    contents: `
      export * from './supabase/functions/mc-mcp/ops.ts'
      export * from './supabase/functions/mc-mcp/commit.ts'
      export { mergeStates, rowKey as appRowKey, bodyHash as appBodyHash } from './src/sync-merge.ts'
      export { slugTag as appSlugTag } from './src/tags.ts'
      export { slotForTime as appSlotForTime } from './src/util.ts'
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error',
  define: { 'import.meta.env': '{}' },
})
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const M = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
const refuses = (fn, re, msg) => assert.throws(fn, (e) => e instanceof M.McError && re.test(e.message), msg)

/* ---- a small real-shaped blob --------------------------------------------- */
const fixture = () => ({
  schema: 'v1', savedAt: 1000,
  tasks: [
    { id: 't-a', title: 'Připravit tabulku pro Michala', source: 'mc', estimateMin: 0, done: false, space: 'work', list: 'backlog', category: 'quick', createdAt: '2026-11-01', addedAt: 1 },
    { id: 't-b', title: 'Call the dentist', source: 'mc', estimateMin: 10, estimated: true, done: false, space: 'personal', list: 'today', plannedOn: M.dateKey(), slot: 'morning', category: 'call', createdAt: '2026-11-01', addedAt: 2 },
    { id: 't-c', title: 'Call the insurance', source: 'mc', estimateMin: 0, done: false, space: 'personal', list: 'backlog', category: 'call', createdAt: '2026-11-01', addedAt: 3 },
    { id: 't-d', title: 'Zpracovat feedback', source: 'mc', estimateMin: 0, done: false, space: 'work', list: 'backlog', projectId: 'p-sonar', category: 'quick', createdAt: '2026-11-01', addedAt: 4,
      subtasks: [{ id: 't-ds0', title: 'one', estimateMin: 5, done: false }, { id: 't-ds1', title: 'two', estimateMin: 10, done: false }] },
  ],
  projects: [
    { id: 'p-sonar', name: 'Sonar', space: 'work', createdAt: '2026-10-01' },
    { id: 'p-off', name: 'Off-Plate', space: 'personal', createdAt: '2026-10-01' },
  ],
  habits: [
    { id: 'h-stretch', name: 'Stretch', space: 'personal', paused: false, days: [false, false, false, false, false, false, false] },
    { id: 'h-quit', name: 'No energy drinks', space: 'personal', paused: false, kind: 'break', days: [false, false, false, false, false, false, false] },
    { id: 'h-routine', name: 'Brush', space: 'personal', paused: false, folderId: 'r1', srcStepId: 's1', days: [false, false, false, false, false, false, false] },
    { id: 'h-gated', name: 'Typing', space: 'personal', paused: false, gatedBy: 'typing-wpm', days: [false, false, false, false, false, false, false] },
    { id: 'h-measured', name: 'Read', space: 'personal', paused: false, measure: 'minutes', days: [false, false, false, false, false, false, false] },
  ],
  habitLog: [],
  notes: [
    { id: 'note-1', space: 'personal', folderId: 'nf-space-personal', title: 'Groceries', body: 'Groceries\nmilk', color: 'amber', when: '2026-11-01', updatedAt: 500, hist: [], dev: 'dphone' },
  ],
  goals: [{ id: 'g1', name: 'Run 10k', current: 4, target: 10 }],
  graveyard: [],
})
const clone = (x) => JSON.parse(JSON.stringify(x))

/* 1. His clock is Prague's. */
assert.equal(M.dateKey(new Date('2026-11-07T23:30:00Z')), '2026-11-08', 'late evening UTC is already tomorrow in Prague')
assert.equal(M.dateKey(new Date('2026-07-07T22:30:00Z')), '2026-07-08', 'and in summer time')
assert.equal(M.weekdayIndex('2026-11-09'), 0, 'Monday is 0')
assert.equal(M.weekdayIndex('2026-11-08'), 6, 'Sunday is 6')

/* 2. Parity with the app's own tiny helpers. */
for (const n of ['Michael\'s Corner', 'Masér Jiří', 'Off-Plate', '###', '']) assert.equal(M.slugTag(n), M.appSlugTag(n), `slugTag parity: ${n}`)
for (const t of ['00:00', '11:59', '12:00', '13:59', '14:00', '17:59', '18:00', '23:59']) assert.equal(M.slotForTime(t), M.appSlotForTime(t), `slot parity: ${t}`)
for (const s of ['', 'a', 'Připravit tabulku\nmilk', 'x'.repeat(500)]) assert.equal(M.bodyHash(s), M.appBodyHash(s), 'bodyHash parity')
assert.equal(M.rowKey('tasks', { id: 'q' }), M.appRowKey('tasks', { id: 'q' }))
assert.equal(M.rowKey('notes', { id: 'q' }), M.appRowKey('notes', { id: 'q' }))

/* 3. add_task */
{
  const b = fixture()
  const r = M.addTask(b, { title: '  Send the banner sizes ' })
  const t = b.tasks[0]
  assert.equal(b.tasks.length, 5); assert.equal(t.id, r.id, 'newest first, like the app')
  assert.deepEqual([t.title, t.list, t.space, t.estimateMin, t.done, t.source, t.category], ['Send the banner sizes', 'backlog', 'personal', 0, false, 'mc', 'quick'])
  assert.equal(t.estimated, undefined, 'no number he did not give')
  assert.equal(t.plannedOn, undefined)
  assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}$/); assert.equal(typeof t.addedAt, 'number')

  M.addTask(b, { title: 'Dentist follow-up', date: '2026-11-12', at: '15:30', minutes: 20 })
  const d = b.tasks[0]
  assert.deepEqual([d.list, d.plannedOn, d.at, d.slot, d.estimateMin, d.estimated], ['today', '2026-11-12', '15:30', 'afternoon', 20, true], 'a clock time implies the part of the day')

  M.addTask(b, { title: 'Draft subject lines', project: 'off-plate' })
  assert.deepEqual([b.tasks[0].projectId, b.tasks[0].space], ['p-off', 'personal'], 'the task follows the project to its space')
  M.addTask(b, { title: 'Sonar thing', project: '#sonar' })
  assert.equal(b.tasks[0].space, 'work', 'a hashtag finds the project too')

  M.addTask(b, { title: 'Ship', steps: [{ title: 'one', minutes: 5 }, { title: 'two' }] })
  const s = b.tasks[0]
  assert.deepEqual(s.subtasks.map((x) => [x.title, x.estimateMin]), [['one', 5], ['two', 0]])
  assert.equal(s.estimateMin, 5, 'the estimate is the sum of the steps, an unknown step adds nothing')

  refuses(() => M.addTask(b, { title: 'call the DENTIST' }), /already an open task/, 'a duplicate is refused')
  M.addTask(b, { title: 'call the dentist', allowDuplicate: true })
  refuses(() => M.addTask(b, { title: '   ' }), /needs a title/)
  refuses(() => M.addTask(b, { title: 'x', date: '2026-13-40' }), /YYYY-MM-DD/)
  refuses(() => M.addTask(b, { title: 'x', at: '25:00' }), /HH:MM/)
  refuses(() => M.addTask(b, { title: 'x', project: 'nope' }), /No project is called "nope"/)
  refuses(() => M.addTask(b, { title: 'x', project: 'Sonar', space: 'personal' }), /belongs to work/)
}

/* 4. update_task */
{
  const b = fixture()
  refuses(() => M.updateTask(b, { title: 'call the' }, { minutes: 5 }), /matches 2 tasks .*t-b.*t-c/, 'an ambiguous title lists the candidates and changes nothing')
  assert.equal(b.tasks.find((t) => t.id === 't-b').estimateMin, 10)
  refuses(() => M.updateTask(b, { title: 'zzz' }, { minutes: 5 }), /No task matches/)
  refuses(() => M.updateTask(b, { id: 'nope' }, { minutes: 5 }), /No task has the id/)
  refuses(() => M.updateTask(b, { id: 't-a' }, {}), /Nothing to change/)

  M.updateTask(b, { title: 'pripravit tabulku' }, { new_title: undefined, title: undefined, minutes: 25, at: '09:15' }) // accents fold; at pins and plans
  const a = b.tasks.find((t) => t.id === 't-a')
  assert.deepEqual([a.estimateMin, a.estimated, a.at, a.list, a.slot, a.plannedOn], [25, true, '09:15', 'today', 'morning', M.dateKey()])

  refuses(() => M.updateTask(b, { id: 't-d' }, { minutes: 99 }), /has steps/, 'a breakdown owns the estimate')

  M.updateTask(b, { id: 't-a' }, { list: 'backlog' })
  assert.deepEqual([a.list, a.plannedOn, a.at], ['backlog', undefined, undefined], 'sent back: no day, no pinned time')
  M.updateTask(b, { id: 't-a' }, { date: '2026-11-20' })
  assert.deepEqual([a.list, a.plannedOn], ['today', '2026-11-20'], 'a date implies the day plan')

  M.updateTask(b, { id: 't-d' }, { project: null })
  assert.equal(b.tasks.find((t) => t.id === 't-d').projectId, undefined)
  M.updateTask(b, { id: 't-d' }, { project: 'Off-Plate' })
  const dd = b.tasks.find((t) => t.id === 't-d')
  assert.deepEqual([dd.projectId, dd.space], ['p-off', 'personal'], 'a project moves the task into its space')
  M.updateTask(b, { id: 't-d' }, { space: 'work' })
  assert.deepEqual([dd.space, dd.projectId], ['work', undefined], 'changing space clears a project that cannot follow')
  M.updateTask(b, { id: 't-c' }, { slot: 'evening', title: 'Call the insurer' })
  assert.deepEqual([b.tasks.find((t) => t.id === 't-c').slot, b.tasks.find((t) => t.id === 't-c').title], ['evening', 'Call the insurer'])
}

/* 5. complete / reopen / delete */
{
  const b = fixture()
  M.completeTask(b, { id: 't-d' })
  const d = b.tasks.find((t) => t.id === 't-d')
  assert.equal(d.done, true); assert.ok(Date.parse(d.doneAt)); assert.ok(d.subtasks.every((s) => s.done), 'its steps go with it')
  assert.match(M.completeTask(b, { id: 't-d' }).text, /already done/)
  M.reopenTask(b, { id: 't-d' })
  assert.deepEqual([d.done, d.doneAt, d.actualMin, d.subtasks.every((s) => !s.done)], [false, undefined, undefined, true])

  const before = clone(b)
  const r = M.deleteTask(b, { id: 't-c' })
  assert.equal(b.tasks.some((t) => t.id === 't-c'), false)
  assert.ok(b.graveyard.some((t) => t.k === 'tasks:t-c'), 'buried, or the next merge brings it back')
  assert.equal(b.tasks.length, before.tasks.length - 1); assert.match(r.text, /Deleted "Call the insurance"/)
}

/* 6. steps + projects */
{
  const b = fixture()
  M.setSteps(b, { id: 't-a' }, [{ title: 'one', minutes: 10 }, { title: 'two', minutes: 20 }])
  const a = b.tasks.find((t) => t.id === 't-a')
  assert.deepEqual([a.subtasks.length, a.estimateMin, a.estimated], [2, 30, true])
  M.setSteps(b, { id: 't-a' }, [])
  assert.deepEqual([a.subtasks, a.estimated], [undefined, false])

  const r = M.addProject(b, "Michael's Corner", 'personal')
  assert.equal(b.projects.at(-1).id, r.id); assert.equal(b.projects.at(-1).tag, undefined, 'the default tag follows the name')
  M.addProject(b, "Michaels Corner 2", 'work') // slug "michaelscorner2", a different tag
  b.projects.push({ id: 'p-x', name: 'Zzz', space: 'work', tag: 'sonar2' })
  refuses(() => M.addProject(b, 'sonar', 'work'), /already exists/)
  const dup = M.addProject(b, 'So-nar!', 'work') // slug "sonar" is taken by Sonar
  assert.equal(b.projects.find((p) => p.id === dup.id).tag, 'sonar3', 'the app\'s freeTag: sonar taken, sonar2 taken (Zzz), so sonar3')
  M.renameProject(b, 'Off-Plate', 'Off-Plate 2')
  assert.equal(b.projects.find((p) => p.id === 'p-off').name, 'Off-Plate 2')
}

/* 7. notes */
{
  const b = fixture()
  const r = M.addNote(b, { body: '# Standup idea\nwalk and talk' })
  const n = b.notes[0]
  assert.deepEqual([n.id, n.title, n.folderId, n.space, n.dev, n.hist], [r.id, 'Standup idea', 'nf-space-personal', 'personal', 'claude', []])
  refuses(() => M.addNote(b, { body: '  ' }), /needs some text/)
  refuses(() => M.addNote(b, { body: 'x', folderId: 'nf-nope' }), /No note folder/)

  const old = b.notes.find((x) => x.id === 'note-1').body
  M.appendNote(b, { id: 'note-1' }, 'bread')
  const g = b.notes.find((x) => x.id === 'note-1')
  assert.equal(g.body, 'Groceries\nmilk\nbread'); assert.deepEqual(g.hist, [M.appBodyHash(old)], 'the old body left its hash behind')
  assert.equal(g.dev, 'claude'); assert.ok(g.updatedAt > 500)
  M.replaceNote(b, { id: 'note-1' }, 'Groceries\nrewritten')
  assert.equal(g.hist.length, 2)
  refuses(() => M.replaceNote(b, { id: 'note-1' }, ' '), /Delete it instead/)
  M.setNoteDone(b, { id: 'note-1' }, true); assert.ok(g.done && g.pinned === false)
  M.setNoteDone(b, { id: 'note-1' }, false); assert.equal(g.done, undefined)
  M.deleteNote(b, { id: 'note-1' })
  assert.equal(b.notes.some((x) => x.id === 'note-1'), false); assert.ok(b.graveyard.some((t) => t.k === 'notes:note-1'))
}

/* 8. habits: moved to tools/mcp-growth-test.mjs (the full habit set replaced the v1 tick). */

/* 9. reads */
{
  const b = fixture()
  assert.equal(M.listTasks(b, { where: 'backlog' }).count, 3)
  assert.equal(M.listTasks(b, { where: 'today' }).count, 1)
  assert.equal(M.listTasks(b, { query: 'PRIPRAVIT' }).count, 1, 'accents and case fold')
  assert.equal(M.listTasks(b, { project: 'sonar' }).tasks[0].tag, '#sonar')
  assert.equal(M.listTasks(b, { space: 'work' }).count, 2)
  M.addTask(b, { title: 'Late', date: M.dateKey(), at: '17:00' }); M.addTask(b, { title: 'Early', date: M.dateKey(), at: '08:00' })
  const day = M.getDay(b)
  assert.deepEqual(day.slots.morning.map((t) => t.title), ['Early', 'Call the dentist'].sort((a, c) => ({ Early: '08:00', 'Call the dentist': '99:99' }[a].localeCompare({ Early: '08:00', 'Call the dentist': '99:99' }[c]))))
  assert.equal(day.slots.afternoon[0].title, 'Late'); assert.equal(day.open, 3)
  const o = M.overview(b)
  assert.equal(o.counts.goals, 1); assert.equal(o.backlog, 3)
  assert.equal(M.listNotes(b, { query: 'milk' }).count, 1)
  assert.equal(M.getNote(b, { title: 'grocer' }).body, 'Groceries\nmilk')
  assert.equal(M.browse(b, { collection: 'goals' }).rows[0].name, 'Run 10k')
  refuses(() => M.browse(b, { collection: 'tasks' }), /Cannot browse/, 'only the allowed collections')
  refuses(() => M.browse(b, { collection: 'graveyard' }), /Cannot browse/)
  const big = { ...fixture(), people: [{ id: 'x', name: 'A', notes: 'y'.repeat(2000), hist: ['a'] }] }
  const r = M.browse(big, { collection: 'people' }).rows[0]
  assert.ok(r.notes.length < 500 && r.hist === undefined, 'long text is trimmed and the history is left out')
}

/* ---- the writer: compare-and-swap against a fake mc_state ------------------- */
function fakeDb(initial) {
  const row = initial ? { id: 'u1', owner: 'u1', data: initial, updated_at: '2026-11-07T10:00:00.000Z' } : null
  const calls = { updates: 0 }
  const db = {
    row, calls, beforeUpdate: null,
    from() {
      const q = { op: 'select', f: [], patch: null, one: false, ret: false }
      const api = {
        select() { if (q.op === 'update') q.ret = true; return api },
        update(p) { q.op = 'update'; q.patch = p; return api },
        eq(k, v) { q.f.push([k, v]); return api },
        maybeSingle() { q.one = true; return api },
        then(res, rej) {
          return Promise.resolve().then(() => {
            const match = db.row && q.f.every(([k, v]) => db.row[k] === v)
            if (q.op === 'select') return { data: match ? clone(db.row) : null, error: null }
            calls.updates++
            if (db.beforeUpdate) { const h = db.beforeUpdate; db.beforeUpdate = null; h(db) }
            const hit = db.row && q.f.every(([k, v]) => db.row[k] === v)
            if (hit) { Object.assign(db.row, clone(q.patch)); return { data: [{ id: 'u1' }], error: null } }
            return { data: [], error: null }
          }).then(res, rej)
        },
      }
      return api
    },
  }
  return db
}
const noWait = { sleep: async () => {} }

/* 10. A normal write: applied, stamped, and the row's updated_at moves. */
{
  const db = fakeDb(fixture())
  const r = await M.commit(db, 'u1', (b) => M.addTask(b, { title: 'New thing' }), noWait)
  assert.match(r.text, /Added "New thing"/)
  assert.equal(db.row.data.tasks[0].title, 'New thing'); assert.equal(db.row.data.tasks.length, 5)
  assert.deepEqual([db.row.data.lastWrite.name, db.row.data.lastWrite.dev], ['Claude', 'claude-mcp'])
  assert.ok(db.row.data.savedAt > 1000, 'stamped newer, so the merge counts it as the latest save')
  assert.notEqual(db.row.updated_at, '2026-11-07T10:00:00.000Z')
}

/* 11. Another device saved between the read and the write: nothing is overwritten. */
{
  const db = fakeDb(fixture())
  db.beforeUpdate = (d) => { // the phone saves a new task right now
    d.row.data = { ...d.row.data, tasks: [{ id: 't-phone', title: 'From the phone', done: false, list: 'backlog', space: 'personal', estimateMin: 0 }, ...d.row.data.tasks] }
    d.row.updated_at = '2026-11-07T10:00:05.000Z'
  }
  await M.commit(db, 'u1', (b) => M.addTask(b, { title: 'From Claude' }), noWait)
  const titles = db.row.data.tasks.map((t) => t.title)
  assert.ok(titles.includes('From the phone') && titles.includes('From Claude'), `both survive: ${titles}`)
  assert.equal(db.calls.updates, 2, 'the first attempt wrote nothing; the second re-applied on the fresh row')
}

/* 12. It gives up honestly when the row never settles, and writes nothing. */
{
  const db = fakeDb(fixture())
  let n = 0
  const origFrom = db.from.bind(db)
  db.from = () => { const api = origFrom(); const t = api.then.bind(api); api.then = (res, rej) => { n++; db.row.updated_at = `2026-11-07T10:00:${String(n).padStart(2, '0')}.000Z`; return t(res, rej) }; return api }
  const before = clone(db.row.data)
  await assert.rejects(() => M.commit(db, 'u1', (b) => M.addTask(b, { title: 'x' }), { tries: 3, sleep: async () => {} }), (e) => e instanceof M.McError && /changing at the same moment/.test(e.message))
  assert.deepEqual(db.row.data, before, 'nothing changed')
}

/* 13. A refusal, a bug that would wipe a list, and a missing row all write nothing. */
{
  const db = fakeDb(fixture()); const before = clone(db.row.data)
  await assert.rejects(() => M.commit(db, 'u1', (b) => M.deleteTask(b, { title: 'call the' }), noWait), (e) => e instanceof M.McError && /matches 2 tasks/.test(e.message))
  await assert.rejects(() => M.commit(db, 'u1', (b) => { b.tasks = []; return { text: 'wiped' } }, noWait), (e) => e instanceof M.McError && /Safety stop: "tasks" would have shrunk from 4 to 0/.test(e.message))
  await assert.rejects(() => M.commit(db, 'u1', (b) => { delete b.notes; return { text: 'x' } }, noWait), (e) => /Safety stop: "notes" would have been removed/.test(e.message))
  assert.deepEqual(db.row.data, before); assert.equal(db.calls.updates, 0, 'not one write went out')
  const empty = fakeDb(null)
  await assert.rejects(() => M.commit(empty, 'u1', (b) => M.addTask(b, { title: 'x' }), noWait), (e) => /never creates your data from nothing/.test(e.message))
  await assert.rejects(() => M.readState(empty, 'u1'), /Open the app once/)
  assert.equal(empty.calls.updates, 0)
}

/* 13b. A cascade may remove exactly as many extra rows as it declares, and no more. */
{
  const db = fakeDb(fixture())
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }))
  const withRows = { ...fixture(), contacts: rows(6) }
  const db2 = fakeDb(withRows)
  await assert.rejects(() => M.commit(db2, 'u1', (b) => { b.contacts = b.contacts.slice(3); return { text: 'x' } }, noWait), (e) => /Safety stop: "contacts" would have shrunk from 6 to 3/.test(e.message), 'removing 3 with no declaration is stopped')
  await M.commit(db2, 'u1', (b) => { M.allowShrink(b, 'contacts', 2); b.contacts = b.contacts.slice(3); return { text: 'x' } }, noWait)
  assert.equal(db2.row.data.contacts.length, 3, 'removing 3 with 2 extra declared (1 is always allowed) goes through')
  await assert.rejects(() => M.commit(db2, 'u1', (b) => { M.allowShrink(b, 'contacts', 1); b.contacts = []; return { text: 'x' } }, noWait), (e) => /Safety stop/.test(e.message), 'a bug removing more than it declared is still stopped')
  assert.equal(db2.row.data.contacts.length, 3)
  assert.equal(JSON.stringify(db2.row.data).includes('allow'), false, 'the declaration never reaches the saved data')
}

/* 14. THE APP'S REAL MERGE keeps what the connector did. */
{
  const app = fixture() // what an app that has not seen the connector's write still holds
  const db = fakeDb(clone(app))
  await M.commit(db, 'u1', (b) => M.addTask(b, { title: 'Brand new from Claude' }), noWait)
  await M.commit(db, 'u1', (b) => M.deleteTask(b, { id: 't-c' }), noWait)
  await M.commit(db, 'u1', (b) => M.appendNote(b, { id: 'note-1' }, 'bread'), noWait)
  // The older app copy saves after the connector, the way a phone left open does: it merges against the head.
  const merged = JSON.parse(M.mergeStates(JSON.stringify({ ...app, savedAt: 500 }), JSON.stringify(db.row.data)))
  assert.ok(merged.tasks.some((t) => t.title === 'Brand new from Claude'), 'the new task survives a stale save')
  assert.equal(merged.tasks.some((t) => t.id === 't-c'), false, 'the deleted task stays deleted: this is what the tombstone is for')
  const note = merged.notes.find((n) => n.id === 'note-1')
  assert.equal(note.body, 'Groceries\nmilk\nbread'); assert.equal(note.conflict, undefined, 'an appended note is ordinary propagation, not a conflict banner')
  // And the other direction: the app's newer save merges into ours without dropping the connector's rows.
  const phone = { ...clone(db.row.data), savedAt: Date.now() + 5000, tasks: [{ id: 't-phone', title: 'Phone', done: false, list: 'backlog', space: 'personal', estimateMin: 0 }, ...db.row.data.tasks] }
  const m2 = JSON.parse(M.mergeStates(JSON.stringify(phone), JSON.stringify(db.row.data)))
  assert.ok(['Phone', 'Brand new from Claude'].every((t) => m2.tasks.some((x) => x.title === t)))
}

console.log('MCP data layer: all checks passed.')
