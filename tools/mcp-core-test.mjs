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
assert.equal(names.length, 22, `22 tools, got ${names.length}: ${names}`)
for (const n of names) {
  const c = srv.tools[n].cfg
  assert.ok(c.title && c.description && c.inputSchema && c.annotations, `${n} is fully described`)
}
const reads = names.filter((n) => srv.tools[n].cfg.annotations.readOnlyHint)
assert.deepEqual(reads.sort(), ['browse', 'get_day', 'get_note', 'get_overview', 'list_habits', 'list_notes', 'list_projects', 'list_tasks'])
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

console.log(`MCP core registry: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
