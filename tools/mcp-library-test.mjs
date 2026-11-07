/* Library area: note extras, ideas board, prompts, gym goals. Through the real registration
   path, real zod, real commit(), and the app's real merge engine.
   ZOD_PATH=... node tools/mcp-library-test.mjs */
import assert from 'assert/strict'
import { loadKit } from './mcp-test-kit.mjs'

const K = await loadKit({ modules: ['tools-library.ts', 'ops-library.ts', 'tools-core.ts'] })
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const L = M.ops_library
const noWait = { sleep: async () => {} }

/* ---------- surface ---------- */
{
  const srv = fakeServer(K, [M.tools_core.register, M.tools_library.register], stateDb(fixture())) // no name collides with core
  const lib = fakeServer(K, M.tools_library.register, stateDb(fixture()))
  assert.equal(lib.names().length, 19)
  for (const n of lib.names()) { const c = lib.tools[n].cfg; assert.ok(c.title && c.description && c.inputSchema && c.annotations, n); assert.match(n, /^[a-z]+(_[a-z0-9]+)+$/) }
  assert.deepEqual(lib.names().filter((n) => lib.tools[n].cfg.annotations.readOnlyHint).sort(), ['list_gym_goals', 'list_ideas', 'list_note_folders', 'list_prompts'])
  assert.deepEqual(lib.names().filter((n) => lib.tools[n].cfg.annotations.destructiveHint).sort(), ['delete_gym_goal', 'delete_idea', 'delete_note_folder', 'delete_prompt', 'edit_prompt'])
  assert.ok(srv.names().length >= 39) // core (20, after the habit tools moved to tools-growth) + library (19)
}

/* ---------- notes: edit_note ---------- */
{
  const b = fixture()
  const n = b.notes[0]
  L.editNote(b, { id: 'note-1' }, { color: 'blue', pinned: true })
  assert.deepEqual([n.color, n.pinned, n.body, n.hist, n.dev], ['blue', true, 'Groceries\nmilk', [], 'claude'])
  assert.ok(n.updatedAt > 500)
  // a title is the first line; the rest stays; old body hash left behind
  L.editNote(b, { id: 'note-1' }, { title: 'Shopping' })
  assert.deepEqual([n.body, n.title, n.hist], ['Shopping\nmilk', 'Shopping', [M.appBodyHash('Groceries\nmilk')]])
  assert.match(L.editNote(b, { id: 'note-1' }, { title: 'Shopping' }).text, /already has that title/)
  assert.equal(n.hist.length, 1, 'no change, no new hash')
  L.editNote(b, { id: 'note-1' }, { title: '# Big' }); assert.equal(n.title, 'Big')
  L.editNote(b, { id: 'note-1' }, { pinned: false }); assert.equal(n.pinned, false)
  refuses(() => L.editNote(b, { id: 'note-1' }, {}), /Nothing to change/)
  refuses(() => L.editNote(b, { id: 'note-1' }, { color: 'neon' }), /color must be/)
  refuses(() => L.editNote(b, { id: 'note-1' }, { title: '  ' }), /cannot be empty/)
  refuses(() => L.editNote(b, { id: 'note-1' }, { title: 'a\nb' }), /one line/)
  refuses(() => L.editNote(b, { id: 'nope' }, { color: 'blue' }), /No note has the id/)
  b.notes.push({ id: 'note-2', space: 'personal', folderId: 'nf-space-personal', title: 'Groceries too', body: 'Groceries too' })
  b.notes.push({ id: 'note-3', space: 'personal', folderId: 'nf-space-personal', title: 'Groceries three', body: 'Groceries three' })
  refuses(() => L.editNote(b, { title: 'groceries' }, { color: 'blue' }), /matches 2 notes/)
  refuses(() => L.editNote(b, { title: 'zzz' }, { color: 'blue' }), /No note matches/)
}

/* ---------- folders + move ---------- */
{
  const b = fixture()
  const f = L.addNoteFolder(b, 'work', '  Clients ')
  assert.deepEqual(b.noteFolders[0], { id: f.id, space: 'work', name: 'Clients', parentId: 'nf-space-work', order: 0 })
  assert.match(f.id, /^nf-/)
  const f2 = L.addNoteFolder(b, 'work', 'Ideas'); assert.equal(b.noteFolders[1].order, 1)
  const f3 = L.addNoteFolder(b, 'personal', 'Clients'); assert.equal(b.noteFolders[2].order, 0, 'order counts per space')
  refuses(() => L.addNoteFolder(b, 'work', 'clients'), /already exists/)
  refuses(() => L.addNoteFolder(b, 'work', ' '), /needs a name/)
  refuses(() => L.addNoteFolder(b, 'home', 'x'), /space must/)

  // move: by id, by name, back to a root; space stays
  const n = b.notes[0]
  L.moveNote(b, { id: 'note-1' }, { folder_id: f.id })
  assert.deepEqual([n.folderId, n.space, n.body], [f.id, 'personal', 'Groceries\nmilk'])
  assert.match(L.moveNote(b, { id: 'note-1' }, { folder_id: f.id }).text, /already in/)
  L.moveNote(b, { id: 'note-1' }, { folder: 'ideas' }); assert.equal(n.folderId, f2.id)
  L.moveNote(b, { id: 'note-1' }, { folder_id: 'nf-space-work' }); assert.equal(n.folderId, 'nf-space-work')
  refuses(() => L.moveNote(b, { id: 'note-1' }, { folder_id: 'nf-nope' }), /No note folder/)
  refuses(() => L.moveNote(b, { id: 'note-1' }, { folder_id: 'nf-space-home' }), /No note folder/)
  refuses(() => L.moveNote(b, { id: 'note-1' }, { folder: 'cli' }), /note folder|matches/) // "Clients" x2 -> ambiguous
  refuses(() => L.moveNote(b, { id: 'note-1' }, {}), /Say which folder/)
  assert.match(L.listNoteFolders(b).folders.map((x) => x.name).join(), /Clients/)
  assert.equal(L.listNoteFolders(b).workspace_folders.find((x) => x.id === 'nf-space-work').notes, 1)

  // rename
  L.renameNoteFolder(b, { id: f2.id }, ' Backlog '); assert.equal(b.noteFolders[1].name, 'Backlog')
  refuses(() => L.renameNoteFolder(b, { id: f2.id }, 'clients'), /already exists/)
  L.renameNoteFolder(b, { id: f3.id }, 'clients') // different space: fine (same name as itself, case)
  refuses(() => L.renameNoteFolder(b, { id: f2.id }, ''), /needs a name/)
  refuses(() => L.renameNoteFolder(b, { id: 'nf-space-work' }, 'x'), /not stored/)

  // delete: notes go up, folder gone and buried
  b.notes.push({ id: 'note-9', space: 'work', folderId: f.id, title: 'In', body: 'In', updatedAt: 1 })
  const r = L.deleteNoteFolder(b, { id: f.id })
  assert.match(r.text, /1 note was moved up/)
  assert.equal(b.notes.find((x) => x.id === 'note-9').folderId, 'nf-space-work')
  assert.equal(b.noteFolders.some((x) => x.id === f.id), false)
  assert.ok(b.graveyard.some((t) => t.k === `noteFolders:${f.id}`))
  assert.equal(b.notes.length, 2, 'no note is deleted')
  refuses(() => L.deleteNoteFolder(b, { id: 'nf-space-personal' }), /not stored/)
  refuses(() => L.deleteNoteFolder(b, { id: 'nf-nope' }), /No note folder/)
}

/* ---------- ideas ---------- */
{
  const b = fixture()
  const a = L.addIdea(b, { title: '  Tiny garden  ', body: ' herbs ' })
  const c = b.ideaBoard[0]
  assert.deepEqual([c.id, c.title, c.body, c.color, c.x, c.y, c.doneAt], [a.id, 'Tiny garden', 'herbs', 'amber', 40, 40, undefined])
  assert.match(c.id, /^idea-/); assert.equal(c.createdAt, c.updatedAt)
  const a2 = L.addIdea(b, { title: 'Second', color: 'blue' })
  assert.deepEqual([b.ideaBoard[1].x, b.ideaBoard[1].y, b.ideaBoard[1].color], [280, 40, 'blue'], 'the next free grid slot, as the app places a dictated card')
  refuses(() => L.addIdea(b, { title: 'tiny GARDEN' }), /already has an idea/)
  refuses(() => L.addIdea(b, { title: ' ' }), /needs a title/)
  refuses(() => L.addIdea(b, { title: 'x', color: 'paper' }), /color must/)
  // edit
  L.editIdea(b, { title: 'second' }, { done: true, body: ' b ', x: 10.6 })
  const s2 = b.ideaBoard[1]
  assert.deepEqual([s2.body, s2.x, typeof s2.doneAt], ['b', 11, 'number'])
  const stamp = s2.doneAt; await new Promise((r) => setTimeout(r, 3))
  L.editIdea(b, { id: a2.id }, { done: true, title: 'Second!' }); assert.equal(s2.doneAt, stamp, 'saving an untouched done flag keeps the date')
  L.editIdea(b, { id: a2.id }, { done: false }); assert.equal('doneAt' in s2, false)
  refuses(() => L.editIdea(b, { id: a2.id }, {}), /Nothing to change/)
  refuses(() => L.editIdea(b, { id: a2.id }, { title: 'tiny garden' }), /already has an idea/)
  refuses(() => L.editIdea(b, { id: a2.id }, { title: ' ' }), /cannot be empty/)
  refuses(() => L.editIdea(b, { title: 'zzz' }, { done: true }), /No idea card matches/)
  assert.equal(L.listIdeas(b, { include_done: false }).count, 2)
  // delete
  const r = L.deleteIdea(b, { id: a.id })
  assert.equal(b.ideaBoard.length, 1); assert.ok(b.graveyard.some((t) => t.k === `ideaBoard:${a.id}`)); assert.match(r.text, /Deleted idea "Tiny garden"/)
  // the slot logic: 7 cards fill the first row then wrap
  const b2 = fixture(); for (let i = 0; i < 8; i++) L.addIdea(b2, { title: `i${i}` })
  assert.equal(new Set(b2.ideaBoard.map((c) => `${c.x},${c.y}`)).size, 8, 'no two cards share a spot')
}

/* ---------- prompts ---------- */
{
  const b = fixture()
  const a = L.addPrompt(b, { text: '  Fix the sheet bug  ' })
  const p = b.prompts[0]
  assert.deepEqual([p.id, p.project, p.session, p.kind, p.text, p.sentAt], [a.id, 'General', 'General', 'Idea', 'Fix the sheet bug', undefined])
  assert.match(p.id, /^prompt-/)
  L.addPrompt(b, { text: 'Add dark toggle', project: ' MC ', session: '', kind: 'Update' })
  assert.deepEqual([b.prompts[1].project, b.prompts[1].session, b.prompts[1].kind], ['MC', 'General', 'Update'])
  refuses(() => L.addPrompt(b, { text: ' ' }), /needs some text/)
  refuses(() => L.addPrompt(b, { text: 'x', kind: 'Rant' }), /kind must/)
  L.setPromptSent(b, { title: 'sheet bug' }, true); assert.equal(typeof p.sentAt, 'number')
  assert.equal(L.listPrompts(b, {}).count, 1, 'queue hides sent'); assert.equal(L.listPrompts(b, { state: 'sent' }).prompts[0].id, a.id); assert.equal(L.listPrompts(b, { state: 'all' }).count, 2)
  L.setPromptSent(b, { id: a.id }, false); assert.equal('sentAt' in p, false)
  L.editPrompt(b, { id: a.id }, { kind: 'Bug', project: '' }); assert.deepEqual([p.kind, p.project], ['Bug', 'General'])
  refuses(() => L.editPrompt(b, { id: a.id }, {}), /Nothing to change/)
  refuses(() => L.editPrompt(b, { id: a.id }, { text: ' ' }), /cannot be emptied/)
  b.prompts.push({ id: 'prompt-z', project: 'x', session: 'x', kind: 'Idea', text: 'Fix the header too', createdAt: 1, updatedAt: 1 })
  refuses(() => L.setPromptSent(b, { title: 'fix the' }, true), /matches 2 saved prompts/)
  L.deletePrompt(b, { id: 'prompt-z' }); assert.equal(b.prompts.length, 2); assert.ok(b.graveyard.some((t) => t.k === 'prompts:prompt-z'))
}

/* ---------- gym goals ---------- */
{
  const b = fixture()
  const a = L.addGymGoal(b, { name: ' Bench e1RM ', goal: 100, unit: ' kg ', exercise: 'Bench Press (Barbell)' })
  const g = b.gymGoals[0]
  assert.deepEqual([g.id, g.name, g.goal, g.unit, g.metric, g.exerciseName, g.lowerIsBetter, g.current], [a.id, 'Bench e1RM', 100, 'kg', 'e1rm', 'Bench Press (Barbell)', undefined, undefined])
  assert.match(g.id, /^gymgoal-/); assert.equal(g.createdAt, g.updatedAt)
  L.addGymGoal(b, { name: 'Bodyweight', goal: 80, unit: 'kg', lower_is_better: true })
  assert.deepEqual([b.gymGoals[1].metric, b.gymGoals[1].lowerIsBetter, 'exerciseName' in b.gymGoals[1]], ['manual', true, false])
  refuses(() => L.addGymGoal(b, { name: 'Pull', goal: 20, unit: 'reps', metric: 'repTotal' }), /exercise is required/)
  refuses(() => L.addGymGoal(b, { name: 'bench e1rm', goal: 1, unit: 'kg' }), /already a gym goal/)
  refuses(() => L.addGymGoal(b, { name: 'X', goal: -1, unit: 'kg' }), /between 0/)
  refuses(() => L.addGymGoal(b, { name: 'X', goal: 1, unit: '' }), /needs a unit/)
  refuses(() => L.addGymGoal(b, { name: 'X', goal: 1, unit: 'kg', metric: 'vibes' }), /metric must/)
  // edit
  L.editGymGoal(b, { title: 'bench' }, { goal: 110 }); assert.equal(g.goal, 110); assert.ok(g.updatedAt >= g.createdAt)
  L.editGymGoal(b, { title: 'bodyweight' }, { current: 86.5, note: ' cut ' }); assert.deepEqual([b.gymGoals[1].current, b.gymGoals[1].note], [86.5, 'cut'])
  L.editGymGoal(b, { title: 'bodyweight' }, { note: null }); assert.equal('note' in b.gymGoals[1], false)
  refuses(() => L.editGymGoal(b, { id: a.id }, { current: 90 }), /Only manual goals take current/)
  refuses(() => L.editGymGoal(b, { id: a.id }, { exercise: ' ' }), /needs an exercise/)
  refuses(() => L.editGymGoal(b, { id: a.id }, { metric: 'sessions', unit: 'x'.repeat(21) }), /1 to 20/)
  refuses(() => L.editGymGoal(b, { id: a.id }, { name: 'Bodyweight' }), /already a gym goal/)
  refuses(() => L.editGymGoal(b, { id: a.id }, {}), /Nothing to change/)
  L.editGymGoal(b, { id: a.id }, { metric: 'sessions' }); assert.equal(g.metric, 'sessions')
  assert.equal(g.goal, 110, 'refused edits changed nothing, valid edits kept the rest')
  const r = L.deleteGymGoal(b, { id: a.id })
  assert.equal(b.gymGoals.length, 1); assert.ok(b.graveyard.some((t) => t.k === `gymGoals:${a.id}`)); assert.match(r.text, /Deleted gym goal/)
}

/* ---------- through the real registration path: zod, commit, safety stop ---------- */
{
  const db = stateDb(fixture())
  const srv = fakeServer(K, M.tools_library.register, db)
  const data = () => db.tables.mc_state[0].data
  const idea = await srv.call('add_idea', { title: 'Rooftop bar', body: 'maybe' }); assert.equal(idea.isError, false)
  assert.equal(data().ideaBoard[0].title, 'Rooftop bar'); assert.equal(data().lastWrite.name, 'Claude')
  const dup = await srv.call('add_idea', { title: 'rooftop bar' }); assert.equal(dup.isError, true); assert.match(dup.text, /already has an idea/)
  const edit = await srv.call('edit_note', { id: 'note-1', new_title: 'Food', color: 'green', pinned: true }); assert.match(edit.text, /Food/)
  assert.equal(data().notes[0].body, 'Food\nmilk')
  await srv.call('add_note_folder', { space: 'personal', name: 'Home' })
  const fid = data().noteFolders[0].id
  assert.match((await srv.call('move_note', { id: 'note-1', folder: 'home' })).text, /Moved note/)
  assert.equal((await srv.call('move_note', { id: 'note-1' })).isError, true)
  const lf = await srv.call('list_note_folders'); assert.equal(lf.json.folders[0].notes, 1)
  assert.match((await srv.call('delete_note_folder', { id: fid })).text, /moved up/)
  assert.equal(data().notes[0].folderId, 'nf-space-personal')
  await srv.call('add_prompt', { text: 'Do the thing', kind: 'Bug' })
  assert.equal((await srv.call('list_prompts')).json.count, 1)
  await srv.call('set_prompt_sent', { title: 'do the', sent: true })
  assert.equal((await srv.call('list_prompts')).json.count, 0)
  await srv.call('add_gym_goal', { name: 'Squat', goal: 140, unit: 'kg', exercise: 'Squat (Barbell)' })
  assert.equal((await srv.call('list_gym_goals')).json.goals[0].metric, 'e1rm')
  assert.equal((await srv.call('edit_gym_goal', { title: 'squat', current: 3 })).isError, true)
  if (K.zodReal) {
    await assert.rejects(() => srv.call('add_gym_goal', { name: 'x', goal: 1 }), /unit|Invalid|expected/i)
    await assert.rejects(() => srv.call('add_gym_goal', { name: 'x', goal: 1, unit: 'kg', metric: 'vibes' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('edit_note', { id: 'note-1', color: 'neon' }), /Invalid|enum/i)
    await assert.rejects(() => srv.call('add_prompt', { text: 'x', kind: 'Rant' }), /Invalid|enum/i)
  }
  const before = JSON.stringify(data())
  await srv.call('delete_idea', { title: 'zzz' }); await srv.call('delete_gym_goal', { title: 'zzz' })
  assert.equal(JSON.stringify(data()), before, 'refused deletes change nothing')
  // safety stop: an op that tried to drop two rows is stopped by commit()
  const three = fixture(); three.ideaBoard = [1, 2, 3].map((i) => ({ id: `i${i}`, title: `t${i}`, body: '', color: 'amber', x: 0, y: 0, createdAt: 1, updatedAt: 1 }))
  const db3 = stateDb(three)
  await assert.rejects(() => M.commit(db3, 'u1', (b) => { b.ideaBoard = [] }, noWait), /Safety stop/)
}

/* ---------- the app's REAL merge: a stale copy keeps our changes, resurrects nothing ---------- */
{
  const app = fixture()
  app.ideaBoard = [{ id: 'idea-old', title: 'Old', body: '', color: 'amber', x: 40, y: 40, createdAt: 1, updatedAt: 1 }]
  app.prompts = [{ id: 'prompt-old', project: 'General', session: 'General', kind: 'Idea', text: 'old prompt', createdAt: 1, updatedAt: 1 }]
  app.gymGoals = [{ id: 'gymgoal-old', name: 'Old goal', goal: 5, unit: 'kg', metric: 'manual', createdAt: 1, updatedAt: 1 }]
  app.noteFolders = [{ id: 'nf-old', space: 'personal', name: 'Old', parentId: 'nf-space-personal', order: 0 }]
  app.notes.push({ id: 'note-in', space: 'personal', folderId: 'nf-old', title: 'Inside', body: 'Inside', color: 'amber', when: '2026-11-01', updatedAt: 600, hist: [], dev: 'dphone' })
  const db = stateDb(clone(app))
  const srv = fakeServer(K, M.tools_library.register, db)
  await srv.call('delete_idea', { id: 'idea-old' })
  await srv.call('delete_prompt', { id: 'prompt-old' })
  await srv.call('delete_gym_goal', { id: 'gymgoal-old' })
  await srv.call('delete_note_folder', { id: 'nf-old' })
  await srv.call('add_idea', { title: 'Fresh idea' })
  await srv.call('add_gym_goal', { name: 'Fresh goal', goal: 9, unit: 'kg' })
  await srv.call('edit_note', { id: 'note-1', color: 'coral', pinned: true })
  await srv.call('set_prompt_sent', { title: 'x', sent: true }).catch(() => {})
  const head = db.tables.mc_state[0].data
  const stale = { ...app, savedAt: 500 }
  const merged = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(head)))
  assert.equal(merged.ideaBoard.some((c) => c.id === 'idea-old'), false, 'deleted idea stays deleted')
  assert.equal(merged.prompts.some((c) => c.id === 'prompt-old'), false)
  assert.equal(merged.gymGoals.some((c) => c.id === 'gymgoal-old'), false)
  assert.equal(merged.noteFolders.some((c) => c.id === 'nf-old'), false, 'deleted folder stays deleted')
  assert.ok(merged.ideaBoard.some((c) => c.title === 'Fresh idea') && merged.gymGoals.some((g) => g.name === 'Fresh goal'))
  const inside = merged.notes.find((n) => n.id === 'note-in')
  assert.equal(inside.folderId, 'nf-space-personal', 'the note that was in the folder is not lost nor orphaned'); assert.equal(inside.conflict, undefined)
  const n1 = merged.notes.find((n) => n.id === 'note-1')
  assert.deepEqual([n1.color, n1.pinned, n1.conflict], ['coral', true, undefined])
  // title edit through a stale copy: not a conflict banner
  await srv.call('edit_note', { id: 'note-1', new_title: 'Renamed' })
  const m2 = JSON.parse(M.mergeStates(JSON.stringify(stale), JSON.stringify(db.tables.mc_state[0].data)))
  const n2 = m2.notes.find((n) => n.id === 'note-1')
  assert.equal(n2.title, 'Renamed'); assert.equal(n2.conflict, undefined, 'a retitle is ordinary propagation (hist carries the old hash)')
  // un-delete: an id re-created is not blocked by the app's own key format
  assert.equal(M.appRowKey('ideaBoard', { id: 'x' }), 'ideaBoard:x'); assert.equal(M.appRowKey('gymGoals', { id: 'x' }), 'gymGoals:x')
  assert.equal(M.appRowKey('prompts', { id: 'x' }), 'prompts:x'); assert.equal(M.appRowKey('noteFolders', { id: 'x' }), 'noteFolders:x')
}

console.log(`MCP library area: all checks passed (${K.zodReal ? 'schemas validated with zod' : 'schemas NOT validated'}).`)
