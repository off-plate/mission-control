/* The core tool module through the real registration path (reg.ts), a fake server that
   validates input with the real zod, and the real commit(). This is also the TEMPLATE for
   every other area's test: copy its shape.
   `ZOD_PATH=... node tools/mcp-core-test.mjs` */
import assert from 'assert/strict'
import { loadKit } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['tools-core.ts'] })
const { M, fixture, stateDb, fakeServer } = K

const db = stateDb(fixture())
const srv = fakeServer(K, M.tools_core.register, db)

/* The surface: every tool has a title, a description, an input schema and annotations. */
const names = srv.names()
assert.equal(names.length, new Set(names).size)
assert.equal(names.length, 21, `21 tools, got ${names.length}: ${names}`)
for (const n of names) {
  const c = srv.tools[n].cfg
  assert.ok(c.title && c.description && c.inputSchema && c.annotations, `${n} is fully described`)
}
const reads = names.filter((n) => srv.tools[n].cfg.annotations.readOnlyHint)
assert.deepEqual(reads.sort(), ['browse', 'get_day', 'get_note', 'get_overview', 'list_notes', 'list_projects', 'list_tasks'])
assert.deepEqual(names.filter((n) => srv.tools[n].cfg.annotations.destructiveHint).sort(), ['delete_note', 'delete_task', 'replace_note'])

/* A read, a change, a refusal. */
const ov = await srv.call('get_overview')
assert.equal(ov.isError, false); assert.equal(ov.json.backlog, 2)
const add = await srv.call('add_task', { title: 'From the connector', project: 'sonar', minutes: 15 })
assert.match(add.text, /Added "From the connector"/)
assert.equal(db.tables.mc_state[0].data.tasks[0].title, 'From the connector')
assert.equal(db.tables.mc_state[0].data.lastWrite.name, 'Claude')
const dupe = await srv.call('add_task', { title: 'from the connector' })
assert.equal(dupe.isError, true); assert.match(dupe.text, /already an open task/)
const amb = await srv.call('update_task', { title: 'call the', minutes: 5 })
assert.equal(amb.isError, true); assert.match(amb.text, /matches 2 tasks/)

/* Bad input is refused by the schema before any handler runs. */
if (K.zodReal) {
  await assert.rejects(() => srv.call('add_task', {}), /title|Invalid|expected/i)
  await assert.rejects(() => srv.call('update_task', { id: 't-a', minutes: 0 }), /too_small|>=1|Too small/i)
  await assert.rejects(() => srv.call('browse', { collection: 'tasks' }), /Invalid|enum/i)
}
const before = JSON.stringify(db.tables.mc_state[0].data)
await srv.call('delete_task', { title: 'zzz' })
assert.equal(JSON.stringify(db.tables.mc_state[0].data), before, 'a refused delete changes nothing')

/* His report (2026-11-09): "it can write into the note but cannot edit it, so every adjustment makes a
   new note". A status note updated step by step must stay ONE note, and every edit must work. */
const notes = () => db.tables.mc_state[0].data.notes
const n0 = notes().length
const made = await srv.call('add_note', { body: 'Sonar status\n- design: todo\n- copy: todo' })
assert.equal(made.isError, false); assert.equal(notes().length, n0 + 1)
const nid = notes()[0].id
/* A second note with the same title is refused and the refusal names the edit tools. */
const twin = await srv.call('add_note', { body: 'sonar status\nanother copy' })
assert.equal(twin.isError, true); assert.match(twin.text, /already exists/); assert.match(twin.text, /edit_note_text/)
assert.equal(notes().length, n0 + 1, 'the refused add made no second note')
/* Edit one piece in place. */
const e1 = await srv.call('edit_note_text', { id: nid, find: '- design: todo', replace: '- design: done' })
assert.equal(e1.isError, false, e1.text); assert.match(e1.text, /Edited note/)
assert.equal(notes().find((n) => n.id === nid).body, 'Sonar status\n- design: done\n- copy: todo')
assert.ok(notes().find((n) => n.id === nid).hist.length >= 1, 'the old text is an ancestor, so a merge sees an ordinary edit')
/* Append, then edit the appended line, still one note. */
await srv.call('append_to_note', { id: nid, text: '- launch: planned' })
await srv.call('edit_note_text', { title: 'sonar status', find: 'launch: planned', replace: 'launch: Friday' })
assert.match(notes().find((n) => n.id === nid).body, /launch: Friday/)
/* Remove a line (empty replace). */
await srv.call('edit_note_text', { id: nid, find: '\n- copy: todo', replace: '' })
assert.doesNotMatch(notes().find((n) => n.id === nid).body, /copy/)
/* Refusals change nothing: not found, ambiguous, empty find, emptying the note. */
const snap = JSON.stringify(notes())
assert.match((await srv.call('edit_note_text', { id: nid, find: 'not in the note', replace: 'x' })).text, /not in the note/)
await srv.call('append_to_note', { id: nid, text: '- design: again' })
const snap2 = JSON.stringify(notes())
const amb2 = await srv.call('edit_note_text', { id: nid, find: 'design', replace: 'UX' })
assert.equal(amb2.isError, true); assert.match(amb2.text, /2 times/)
assert.equal(JSON.stringify(notes()), snap2, 'an ambiguous edit changes nothing')
const all2 = await srv.call('edit_note_text', { id: nid, find: 'design', replace: 'UX', replace_all: true })
assert.match(all2.text, /2 places/)
assert.equal((await srv.call('edit_note_text', { id: nid, find: notes().find((n) => n.id === nid).body, replace: '  ' })).isError, true, 'cannot empty a note this way')
if (K.zodReal) await assert.rejects(() => srv.call('edit_note_text', { id: nid, find: '', replace: 'x' }), /too_small|>=1|Too small|at least/i)
/* The title follows the first line when that line is edited. */
await srv.call('edit_note_text', { id: nid, find: 'Sonar status', replace: 'Sonar status board' })
assert.equal(notes().find((n) => n.id === nid).title, 'Sonar status board')
/* Rewrite keeps the same note; delete removes only it. */
const rw = await srv.call('replace_note', { id: nid, body: 'Sonar status board\nall done' })
assert.equal(rw.isError, false); assert.equal(notes().find((n) => n.id === nid).id, nid)
assert.equal(notes().length, n0 + 1)
/* He really wants a second one: allowed on purpose. */
assert.equal((await srv.call('add_note', { body: 'Sonar status board\nsecond on purpose', even_if_exists: true })).isError, false)
assert.equal(notes().length, n0 + 2)
const del = await srv.call('delete_note', { id: nid })
assert.equal(del.isError, false); assert.equal(notes().length, n0 + 1)
assert.ok(!notes().some((n) => n.id === nid))
assert.equal(srv.tools.edit_note_text.cfg.annotations.destructiveHint, false, 'an in-place edit does not ask for approval')

console.log(`MCP core registry: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
