/* The two-workspace migration, tested (2026-10-02).
   Off-Plate and Michael's Corner stopped being spaces and became projects inside
   Personal. Lost tasks do not come back, so this asserts the move on a saved
   blob shaped like his, and that running it twice changes nothing. */

import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const out = join(mkdtempSync(join(tmpdir(), 'mc-spaces-')), 'fold.mjs')
await build({ entryPoints: ['src/foldspaces.ts'], bundle: true, format: 'esm', outfile: out, logLevel: 'silent' })
const { foldSpaces } = await import(out)

const blob = () => ({
  removedSeeds: [],
  spaces: { personal: [{ id: 'w1' }], work: [{ id: 'w2' }], offplate: [{ id: 'w3' }], corner: [{ id: 'w4' }] },
  tasks: [
    { id: 't1', title: 'cold emails', space: 'offplate' },
    { id: 't2', title: 'MC post', space: 'corner' },
    { id: 't3', title: 'pay tax', space: 'personal' },
    { id: 't4', title: 'sprint', space: 'work' },
    { id: 't5', title: 'in a project already', space: 'offplate', projectId: 'p-home' },
  ],
  projects: [{ id: 'p-home', name: 'Home', space: 'personal', createdAt: '2026-01-01' }],
  habits: [{ id: 'h1', space: 'offplate' }, { id: 'h2', space: 'work' }],
  routines: [{ id: 'r1', space: 'corner' }],
  goals: [{ id: 'g1', space: 'offplate' }],
  focusSessions: [{ id: 'f1', space: 'corner' }],
  notes: [{ id: 'n1', space: 'offplate', folderId: 'nf-braindump-offplate' }, { id: 'n2', space: 'personal', folderId: 'nf-space-corner' }],
  noteFolders: [
    { id: 'nf-braindump-offplate', space: 'offplate', name: 'Brain dumps', parentId: 'nf-space-offplate' },
    { id: 'nf-braindump-personal', space: 'personal', name: 'Brain dumps', parentId: 'nf-space-personal' },
    { id: 'nf-mine', space: 'corner', name: 'Mine', parentId: 'nf-space-corner' },
  ],
})

const p = blob()
foldSpaces(p, '2026-10-02')
const t = Object.fromEntries(p.tasks.map((x) => [x.id, x]))

assert.equal(p.projects.find((x) => x.id === 'proj-offplate')?.name, 'Off-Plate')
assert.equal(p.projects.find((x) => x.id === 'proj-corner')?.space, 'personal')
assert.ok(p.projects.some((x) => x.id === 'p-home'), 'existing project kept')
assert.deepEqual([t.t1.space, t.t1.projectId], ['personal', 'proj-offplate'])
assert.deepEqual([t.t2.space, t.t2.projectId], ['personal', 'proj-corner'])
assert.deepEqual([t.t3.space, t.t3.projectId], ['personal', undefined])
assert.deepEqual([t.t4.space, t.t4.projectId], ['work', undefined])
assert.equal(t.t5.projectId, 'p-home', 'a task that already has a project keeps it')
assert.equal(p.tasks.length, 5, 'no task lost')
for (const k of ['habits', 'routines', 'goals', 'focusSessions', 'notes', 'noteFolders']) {
  assert.ok(p[k].every((r) => r.space === 'personal' || r.space === 'work'), `${k} has no retired space`)
}
assert.equal(p.habits.find((h) => h.id === 'h2').space, 'work')
assert.deepEqual(Object.keys(p.spaces).sort(), ['personal', 'work'])
assert.equal(p.noteFolders.filter((f) => f.id === 'nf-braindump-personal').length, 1, 'brain dump folders merged')
assert.equal(p.noteFolders.find((f) => f.id === 'nf-mine').parentId, 'nf-space-personal')
assert.equal(p.notes.find((n) => n.id === 'n1').folderId, 'nf-braindump-personal')
assert.equal(p.notes.find((n) => n.id === 'n2').folderId, 'nf-space-personal')
assert.ok(p.removedSeeds.includes('fix:spaces-two'))

// Idempotent: a second pass changes nothing.
const once = JSON.stringify(p)
foldSpaces(p, '2026-10-03')
assert.equal(JSON.stringify(p), once, 'second run is a no-op')

// He deletes the Off-Plate project; a stale device then sends an old-space task.
p.projects = p.projects.filter((x) => x.id !== 'proj-offplate')
p.tasks.push({ id: 't9', space: 'offplate' })
foldSpaces(p, '2026-10-04')
assert.ok(!p.projects.some((x) => x.id === 'proj-offplate'), 'a deleted project is not resurrected')
const t9 = p.tasks.find((x) => x.id === 't9')
assert.deepEqual([t9.space, t9.projectId], ['personal', undefined], 'stale row still lands in Personal')

// Empty and minimal blobs do not throw.
foldSpaces({}, '2026-10-02')
foldSpaces({ tasks: [], projects: undefined }, '2026-10-02')

console.log('spaces-test: all assertions passed')
