/* A stale device must not undo what another device did (2026-11-22).
   A background browser tab (no pulls while hidden) saved its old copy: its savedAt was newer, so the
   merge let its stale task rows and activeFocus win, and his ticks plus his running focus, written from
   the sidebar through the connector, were gone. With the copy the saver last SAW as a base, anything the
   saver did not change itself takes the server's version.
   node tools/merge3-test.mjs */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const out = join(mkdtempSync(join(tmpdir(), 'm3-')), 'm.mjs')
await build({ entryPoints: [new URL('../src/sync-merge.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' })
const { mergeStates } = await import(out)
const T = (id, title, done = false) => ({ id, title, done, estimateMin: 30, list: 'today', plannedOn: '2026-11-22' })
const blob = (o) => JSON.stringify({ schema: 1, tasks: [], focusSessions: [], ledger: [], graveyard: [], ...o })

// what the background tab last saw: two open tasks, a focus running on Recepty
const base = { savedAt: 1000, tasks: [T('a', 'Recepty'), T('b', 'Uklidit')], activeFocus: { phase: 'focus', taskId: 'a', endsAt: 5000 } }
// the server since then (sidebar via connector): Recepty done with a ledger row, a new focus on Uklidit
const remote = { savedAt: 2000, tasks: [T('a', 'Recepty', true), T('b', 'Uklidit')], activeFocus: { phase: 'focus', taskId: 'b', endsAt: 9000 },
  ledger: [{ id: 'l1', title: 'Recepty', estimateMin: 30, actualMin: 25, when: '2026-11-22' }] }
// the stale tab saves: nothing changed on its side, but it stamps savedAt = now (newest)
const stale = { ...base, savedAt: 3000 }

const before = JSON.parse(mergeStates(blob(stale), blob(remote)))
console.log('without a base (old rule): Recepty done =', before.tasks.find((t) => t.id === 'a').done, '| focus on', before.activeFocus?.taskId)

const m = JSON.parse(mergeStates(blob(stale), blob(remote), blob(base)))
assert.equal(m.tasks.find((t) => t.id === 'a').done, true, 'a tick made elsewhere survives a stale save')
assert.equal(m.activeFocus?.taskId, 'b', 'a focus started elsewhere survives a stale save')
assert.equal(m.ledger.length, 1, 'the ledger row stays')

// but the saver's OWN change still wins: the tab really ticked Uklidit itself
const own = { ...base, savedAt: 3000, tasks: [T('a', 'Recepty'), T('b', 'Uklidit', true)] }
const m2 = JSON.parse(mergeStates(blob(own), blob(remote), blob(base)))
assert.equal(m2.tasks.find((t) => t.id === 'b').done, true, "the saver's own tick is kept")
assert.equal(m2.tasks.find((t) => t.id === 'a').done, true, "and the other device's tick too")

// both changed the same task: the newer save wins, as before
const both = { ...base, savedAt: 3000, tasks: [T('a', 'Recepty renamed'), T('b', 'Uklidit')] }
const m3 = JSON.parse(mergeStates(blob(both), blob(remote), blob(base)))
assert.equal(m3.tasks.find((t) => t.id === 'a').title, 'Recepty renamed', 'a real conflict still goes to the newer save')

// no base given: behaviour unchanged (every other caller)
assert.deepEqual(JSON.parse(mergeStates(blob(stale), blob(remote))), before, 'two-way merge is unchanged')
console.log('merge3: all checks passed')
