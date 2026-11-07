/* Every connector module registered TOGETHER, the way index.ts does it.
   `ZOD_PATH=... node tools/mcp-all-test.mjs`
   What it catches that the per-area tests cannot: two areas claiming the same tool name, a
   tool left without a description or annotations, a destructive tool not marked destructive,
   and a flow that crosses areas (a task that feeds a goal, finished through the core tool). */
import assert from 'assert/strict'
import { loadKit } from './mcp-test-kit.mjs'
import { readFileSync } from 'fs'

const MODULES = ['tools-core.ts', 'tools-goals.ts', 'tools-people.ts', 'tools-money.ts', 'tools-planning.ts', 'tools-library.ts', 'tools-focus.ts', 'tools-growth.ts', 'tools-tasks.ts', 'tools-reminders.ts']
const present = MODULES.filter((m) => { try { readFileSync(new URL(`../supabase/functions/mc-mcp/${m}`, import.meta.url)); return true } catch { return false } })
const K = await loadKit({ modules: present })
const { M, fixture, stateDb, fakeDb, fakeServer } = K
const regs = present.map((m) => M[m.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]+/g, '_')].register)

const db = fakeDb({ mc_state: [{ id: 'u1', owner: 'u1', data: fixture(), updated_at: '2026-11-07T10:00:00.000Z' }], mc_inbox: [], compass_transactions: [], compass_recurring: [], compass_planned: [], compass_debts: [], compass_cycle_income: [], compass_profile: [] })
const srv = fakeServer(K, regs, db) // throws on a duplicate tool name
const names = srv.names()

assert.equal(names.length, new Set(names).size)
for (const n of names) {
  const c = srv.tools[n].cfg
  assert.match(n, /^[a-z][a-z0-9_]*$/, `${n}: snake_case`)
  assert.ok(n.length <= 64, `${n}: name length`)
  assert.ok(c.title && c.description && c.inputSchema && c.annotations, `${n} is fully described`)
  assert.ok(c.description.length >= 30 && c.description.length < 2500, `${n}: description length ${c.description.length}`)
  assert.equal(typeof c.annotations.readOnlyHint, 'boolean', `${n}: readOnlyHint set`)
}
/* A tool that is not read-only and deletes or overwrites must say so; a read-only tool must not write. */
const del = names.filter((n) => /^(delete|remove|replace|unmark)_|_delete$/.test(n))
for (const n of del) assert.equal(srv.tools[n].cfg.annotations.destructiveHint, true, `${n} must be marked destructive`)
for (const n of names.filter((x) => /^(list|get|browse|day_capacity|focus_stats)/.test(x))) assert.equal(srv.tools[n].cfg.annotations.readOnlyHint, true, `${n} must be read-only`)

/* A flow across areas: a weekly goal, a task feeding it, finished through the CORE tool. */
const g = await srv.call('add_goal', { name: 'Ship the banners', target: 5, unit: 'tasks', timeframe: 'weekly' })
assert.equal(g.isError, false, g.text)
const t = await srv.call('add_task', { title: 'Send banner sizes' })
assert.equal(t.isError, false, t.text)
const link = await srv.call('set_task_goal', { title: 'Send banner sizes', goal: 'Ship the banners', amount: 2 })
assert.equal(link.isError, false, link.text)
const done = await srv.call('complete_task', { title: 'Send banner sizes' })
assert.match(done.text, /Goal: Ship the banners \+2 \(now 2 of 5 tasks\)/, done.text)
const goal = db.tables.mc_state[0].data.goals.find((x) => x.name === 'Ship the banners')
assert.equal(goal.current, 2, 'finishing through the core tool fed the goal')
await srv.call('reopen_task', { title: 'Send banner sizes' })
assert.equal(db.tables.mc_state[0].data.goals.find((x) => x.name === 'Ship the banners').current, 0, 'reopening took it back')

/* The Shadek case end to end, through registration and validation: the name was typed without
   the accents and has to be fixed; and the accented name must still be found by the plain one. */
const add1 = await srv.call('add_person', { name: 'Milan Shadek', tier: 'business' })
assert.equal(add1.isError, false, add1.text)
const fix = await srv.call('edit_person', { person: 'Milan Shadek', new_name: 'Milan Šádek' })
assert.equal(fix.isError, false, `the original failing request must work: ${fix.text}`)
assert.ok(db.tables.mc_state[0].data.people.some((p) => p.name === 'Milan Šádek'), 'the person is now spelled right')
const again = await srv.call('list_people', { query: 'milan shadek' })
assert.equal(again.isError, false); assert.match(again.text, /Milan Šádek/, 'and the plain spelling still finds him')

console.log(`MCP all modules together: ${names.length} tools from ${present.length} modules, no collisions. All checks passed.`)
console.log(present.join(', '))
