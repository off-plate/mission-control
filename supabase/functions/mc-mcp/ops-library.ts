/* The rest of the blob collections core does not cover: note extras (edit title /
   colour / pin, move, folders), the Ideas board, saved Prompts, Gym goals.

   Pure functions on the state blob: NO Deno, NO network. Each is a port of the app's
   own store function, named beside it. Where the app would do something a server
   cannot repeat exactly, the function REFUSES and says what to do instead.

   Deliberate refusals / choices (the app has none of these checks, a server must):
   - a title/name that is empty or an exact twin of an existing row is refused, so a
     retried call cannot silently create a duplicate that later makes matching ambiguous
   - gym `current` is refused unless the goal's metric is manual (the app only READS it
     for manual goals, so setting it elsewhere would be silently ignored)
   - gym exercise names cannot be checked against Hevy here; they are stored as given */

import {
  McError, arr, ensure, bury, rowKey, pick, fold, newId, noteTitle, bodyHash, HIST, DEV,
  dateKey, type Blob, type Row, type Ref,
} from './ops.ts'

type Out = { id: string; text: string }
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/* Colour ids the app offers: src/notes.tsx NOTE_COLORS, src/ideasdock.tsx IDEA_COLORS. */
export const NOTE_COLORS = ['amber', 'coral', 'green', 'blue', 'clay', 'paper']
export const IDEA_COLORS = ['amber', 'coral', 'green', 'blue', 'clay']
export const PROMPT_KINDS = ['Idea', 'Bug', 'Update', 'Version']
export const GYM_METRICS = ['e1rm', 'repTotal', 'sessions', 'manual']
export const SPACE_IDS = ['personal', 'work']

/* ============================ NOTES: edit / move ============================ */

const findNote = (b: Blob, ref: Ref) => pick(arr(b, 'notes'), ref, 'note', (n) => String(n.title ?? ''))

/** src/store/notes.ts updateNote (patch: title/body/color/pinned) as reached from the
 *  assistant's noteEdit / notePin. NOTE: in the app a `title` patch alone is
 *  overwritten by the cached title, because a note's title IS its first line. So a title
 *  change is written as the first line of the body (assistantcore.tsx noteEdit) and
 *  therefore leaves a hash in hist, like any body change. */
export function editNote(b: Blob, ref: Ref, p: { title?: string; color?: string; pinned?: boolean }): Out {
  const n = findNote(b, ref)
  const did: string[] = []
  if (p.title === undefined && p.color === undefined && p.pinned === undefined) throw new McError('Nothing to change: pass title, color or pinned. (To change the text use replace_note or append_to_note.)')
  if (p.color !== undefined && !NOTE_COLORS.includes(p.color)) throw new McError(`color must be one of ${NOTE_COLORS.join(', ')}.`)
  let body: string | undefined
  if (p.title !== undefined) {
    const t = p.title.trim()
    if (!t) throw new McError('A note title cannot be empty.')
    if (/[\r\n]/.test(t)) throw new McError('A note title is one line. Remove the line break.')
    const rest = String(n.body ?? '').split('\n').slice(1).join('\n')
    body = `${t}\n${rest}`
  }
  const old = String(n.body ?? '')
  const bodyChanged = body !== undefined && body !== old
  if (p.title !== undefined && !bodyChanged && p.color === undefined && p.pinned === undefined) return { id: n.id, text: `Note "${n.title}" already has that title.` }
  if (body !== undefined) {
    n.title = noteTitle(body)
    if (bodyChanged) { n.hist = [...(Array.isArray(n.hist) ? n.hist : []), bodyHash(old)].slice(-HIST); n.body = body }
    did.push(`title "${n.title}"`)
  }
  if (p.color !== undefined) { n.color = p.color; did.push(`colour ${p.color}`) }
  if (p.pinned !== undefined) { n.pinned = p.pinned; did.push(p.pinned ? 'pinned' : 'unpinned') }
  n.dev = DEV; n.updatedAt = Date.now()
  return { id: n.id, text: `Note "${n.title}": ${did.join(', ')}.` }
}

const SPACE_ROOT = /^nf-space-(personal|work)$/
const isRoot = (id: string) => SPACE_ROOT.test(id)

/** The folders a note can be filed in: the two derived roots (never stored) and the stored folders. */
function findFolder(b: Blob, folder: string): { id: string; name: string; root: boolean } {
  const f = folder.trim()
  if (isRoot(f)) return { id: f, name: f.endsWith('personal') ? 'Personal' : 'Work', root: true }
  const row = pick(arr(b, 'noteFolders'), { id: f }, 'note folder', (x) => String(x.name ?? ''))
  return { id: row.id, name: row.name, root: false }
}
/** src/store/notes.ts moveNote. Only folderId and updatedAt change: filing a note
 *  keeps it in the workspace it was written in (the store's own comment says so). */
export function moveNote(b: Blob, ref: Ref, to: { folder_id?: string; folder?: string }): Out {
  const n = findNote(b, ref)
  if (!to.folder_id && !to.folder) throw new McError('Say which folder: folder_id or folder.')
  let target: { id: string; name: string; root: boolean }
  if (to.folder_id) target = findFolder(b, to.folder_id)
  else { const t = pick(arr(b, 'noteFolders'), { title: to.folder }, 'note folder', (x) => String(x.name ?? '')); target = { id: t.id, name: t.name, root: false } }
  if (n.folderId === target.id) return { id: n.id, text: `Note "${n.title}" is already in ${target.name}.` }
  n.folderId = target.id; n.updatedAt = Date.now()
  return { id: n.id, text: `Moved note "${n.title}" to ${target.root ? `the ${target.name} workspace folder` : `folder "${target.name}"`}.` }
}

/* ============================ NOTES: folders ================================ */

/** src/store/notes.ts addNoteFolder. */
export function addNoteFolder(b: Blob, space: string, name: string): Out {
  if (!SPACE_IDS.includes(space)) throw new McError(`space must be one of ${SPACE_IDS.join(', ')}.`)
  const nm = (name ?? '').trim()
  if (!nm) throw new McError('A folder needs a name.')
  const folders = ensure(b, 'noteFolders')
  const twin = folders.find((f) => f.space === space && fold(String(f.name)) === fold(nm))
  if (twin) throw new McError(`A ${space} folder called "${twin.name}" already exists (id ${twin.id}).`)
  const row: Row = { id: newId('nf'), space, name: nm, parentId: `nf-space-${space}`, order: folders.filter((f) => f.space === space).length }
  folders.push(row)
  return { id: row.id, text: `Made folder "${nm}" in ${space}.` }
}

function folderTarget(b: Blob, ref: Ref): Row {
  if (ref.id && isRoot(ref.id)) throw new McError('The workspace folders (nf-space-personal, nf-space-work) are not stored, they exist with the workspace. They cannot be renamed or deleted.')
  return pick(arr(b, 'noteFolders'), ref, 'note folder', (x) => String(x.name ?? ''))
}

/** src/store/notes.ts renameNoteFolder (an empty name keeps the old one in the app; here it is refused). */
export function renameNoteFolder(b: Blob, ref: Ref, name: string): Out {
  const f = folderTarget(b, ref)
  const nm = (name ?? '').trim()
  if (!nm) throw new McError('A folder needs a name.')
  const twin = arr(b, 'noteFolders').find((x) => x.id !== f.id && x.space === f.space && fold(String(x.name)) === fold(nm))
  if (twin) throw new McError(`A ${f.space} folder called "${twin.name}" already exists (id ${twin.id}).`)
  const old = f.name; f.name = nm
  return { id: f.id, text: `Renamed folder "${old}" to "${nm}".` }
}

/** src/store/notes.ts deleteNoteFolder: notes inside go UP to the workspace folder
 *  (never deleted), the folder is removed and buried. */
export function deleteNoteFolder(b: Blob, ref: Ref): Out {
  const f = folderTarget(b, ref)
  const now = Date.now()
  let moved = 0
  for (const n of arr(b, 'notes')) if (n.folderId === f.id) { n.folderId = f.parentId; n.updatedAt = now; moved++ }
  b.noteFolders = arr(b, 'noteFolders').filter((x) => x.id !== f.id)
  bury(b, rowKey('noteFolders', f))
  return { id: f.id, text: `Deleted folder "${f.name}"${moved ? `; its ${moved} ${moved === 1 ? 'note was' : 'notes were'} moved up to the ${f.space} workspace folder` : ''}.` }
}

export function listNoteFolders(b: Blob): Row {
  const notes = arr(b, 'notes')
  const count = (id: string) => notes.filter((n) => n.folderId === id).length
  return {
    note: 'The two workspace folders are derived (never stored) and cannot be renamed or deleted. File a note with move_note.',
    workspace_folders: SPACE_IDS.map((s) => ({ id: `nf-space-${s}`, name: s === 'personal' ? 'Personal' : 'Work', space: s, notes: count(`nf-space-${s}`) })),
    folders: arr(b, 'noteFolders').slice().sort((a, c) => (a.order ?? 0) - (c.order ?? 0)).map((f) => ({ id: f.id, name: f.name, space: f.space, notes: count(f.id) })),
  }
}

/* ============================ IDEAS BOARD =================================== */
/* src/store/ideaboard.ts; placement from src/assistantcore.tsx case 'idea'. */

const ideaOf = (b: Blob, ref: Ref) => pick(arr(b, 'ideaBoard'), ref, 'idea card', (c) => String(c.title ?? ''))

/** First free spot on a grid from the board's home corner (assistantcore.tsx 'idea'). */
export function freeSpot(board: Row[]): { x: number; y: number } {
  const taken = (x: number, y: number) => board.some((c) => Math.abs(c.x - x) < 200 && Math.abs(c.y - y) < 160)
  let x = 40, y = 40
  for (let i = 0; i < 200 && taken(x, y); i++) { x = 40 + (i % 6) * 240; y = 40 + Math.floor(i / 6) * 200 }
  return { x, y }
}

export function addIdea(b: Blob, i: { title: string; body?: string; color?: string }): Out {
  const title = (i.title ?? '').trim()
  if (!title) throw new McError('An idea needs a title.')
  if (i.color !== undefined && !IDEA_COLORS.includes(i.color)) throw new McError(`color must be one of ${IDEA_COLORS.join(', ')}.`)
  const board = ensure(b, 'ideaBoard')
  const twin = board.find((c) => fold(String(c.title)) === fold(title))
  if (twin) throw new McError(`The board already has an idea "${twin.title}" (id ${twin.id}). Edit that one with edit_idea.`)
  const { x, y } = freeSpot(board)
  const now = Date.now()
  const row: Row = { id: newId('idea'), title, body: (i.body ?? '').trim(), color: i.color ?? 'amber', x: Math.round(x), y: Math.round(y), createdAt: now, updatedAt: now }
  board.push(row)
  return { id: row.id, text: `On the ideas board: "${title}".` }
}

/** ideaboard.ts updateIdeaCard: done only re-stamps on a real change; text is trimmed; x,y rounded. */
export function editIdea(b: Blob, ref: Ref, p: { title?: string; body?: string; color?: string; x?: number; y?: number; done?: boolean }): Out {
  const c = ideaOf(b, ref)
  if (Object.values(p).every((v) => v === undefined)) throw new McError('Nothing to change: pass title, body, color, x, y or done.')
  if (p.title !== undefined && !p.title.trim()) throw new McError('An idea title cannot be empty.')
  if (p.color !== undefined && !IDEA_COLORS.includes(p.color)) throw new McError(`color must be one of ${IDEA_COLORS.join(', ')}.`)
  if ((p.x !== undefined && !num(p.x)) || (p.y !== undefined && !num(p.y))) throw new McError('x and y must be numbers.')
  if (p.title !== undefined) {
    const twin = arr(b, 'ideaBoard').find((x) => x.id !== c.id && fold(String(x.title)) === fold(p.title!))
    if (twin) throw new McError(`The board already has an idea "${twin.title}" (id ${twin.id}).`)
  }
  const did: string[] = []
  if (p.title !== undefined) { c.title = p.title.trim(); did.push('title') }
  if (p.body !== undefined) { c.body = p.body.trim(); did.push('body') }
  if (p.color !== undefined) { c.color = p.color; did.push(`colour ${p.color}`) }
  if (p.x !== undefined) { c.x = Math.round(p.x); did.push('x') }
  if (p.y !== undefined) { c.y = Math.round(p.y); did.push('y') }
  if (p.done !== undefined && p.done !== !!c.doneAt) { if (p.done) c.doneAt = Date.now(); else delete c.doneAt; did.push(p.done ? 'done' : 'reopened') }
  c.updatedAt = Date.now()
  return { id: c.id, text: `Idea "${c.title}": ${did.join(', ') || 'nothing changed'}.` }
}

export function deleteIdea(b: Blob, ref: Ref): Out {
  const c = ideaOf(b, ref)
  b.ideaBoard = arr(b, 'ideaBoard').filter((x) => x.id !== c.id)
  bury(b, rowKey('ideaBoard', c))
  return { id: c.id, text: `Deleted idea "${c.title}".` }
}

export function listIdeas(b: Blob, i: { query?: string; include_done?: boolean }): Row {
  const q = fold(i.query ?? '')
  const rows = arr(b, 'ideaBoard').filter((c) => (i.include_done !== false || !c.doneAt) && (!q || fold(`${c.title} ${c.body}`).includes(q)))
  return { count: rows.length, ideas: rows.map((c) => ({ id: c.id, title: c.title, body: c.body, color: c.color, done: !!c.doneAt, ...(c.doneAt ? { done_on: dateKey(new Date(c.doneAt)) } : {}), created: dateKey(new Date(c.createdAt)) })) }
}

/* ============================ PROMPTS ======================================= */
/* src/store/prompts.ts. The app matches a prompt by the first 120 characters of its text. */

const promptOf = (b: Blob, ref: Ref) => pick(arr(b, 'prompts'), ref, 'saved prompt', (p) => String(p.text ?? '').slice(0, 120))

export function addPrompt(b: Blob, i: { text: string; project?: string; session?: string; kind?: string }): Out {
  const text = (i.text ?? '').trim()
  if (!text) throw new McError('A prompt needs some text.')
  const kind = i.kind ?? 'Idea' // assistantcore.tsx 'prompt': type defaults to Idea
  if (!PROMPT_KINDS.includes(kind)) throw new McError(`kind must be one of ${PROMPT_KINDS.join(', ')}.`)
  const now = Date.now()
  const row: Row = { id: newId('prompt'), project: (i.project ?? '').trim() || 'General', session: (i.session ?? '').trim() || 'General', kind, text, createdAt: now, updatedAt: now }
  ensure(b, 'prompts').push(row)
  return { id: row.id, text: `Saved the prompt for later (${row.project} / ${row.session}, ${kind}).` }
}

export function editPrompt(b: Blob, ref: Ref, p: { text?: string; project?: string; session?: string; kind?: string }): Out {
  const x = promptOf(b, ref)
  if (Object.values(p).every((v) => v === undefined)) throw new McError('Nothing to change: pass text, project, session or kind.')
  if (p.kind !== undefined && !PROMPT_KINDS.includes(p.kind)) throw new McError(`kind must be one of ${PROMPT_KINDS.join(', ')}.`)
  if (p.text !== undefined && !p.text.trim()) throw new McError('A prompt cannot be emptied. Delete it instead.')
  if (p.text !== undefined) x.text = p.text.trim()
  if (p.project !== undefined) x.project = p.project.trim() || 'General'
  if (p.session !== undefined) x.session = p.session.trim() || 'General'
  if (p.kind !== undefined) x.kind = p.kind
  x.updatedAt = Date.now()
  return { id: x.id, text: `Updated the prompt (${x.project} / ${x.session}, ${x.kind}).` }
}

/** prompts.ts setPromptSent: sentAt set, or removed. */
export function setPromptSent(b: Blob, ref: Ref, sent: boolean): Out {
  const x = promptOf(b, ref)
  if (sent) x.sentAt = Date.now(); else delete x.sentAt
  x.updatedAt = Date.now()
  return { id: x.id, text: sent ? 'Marked the prompt sent.' : 'Put the prompt back in the queue.' }
}

export function deletePrompt(b: Blob, ref: Ref): Out {
  const x = promptOf(b, ref)
  b.prompts = arr(b, 'prompts').filter((r) => r.id !== x.id)
  bury(b, rowKey('prompts', x))
  return { id: x.id, text: 'Deleted the prompt.' }
}

export function listPrompts(b: Blob, i: { state?: 'queue' | 'sent' | 'all'; project?: string; query?: string; limit?: number }): Row {
  const st = i.state ?? 'queue'
  const q = fold(i.query ?? ''), pr = fold(i.project ?? '')
  const rows = arr(b, 'prompts').filter((p) => (st === 'all' || (st === 'sent') === !!p.sentAt) && (!pr || fold(String(p.project)) === pr) && (!q || fold(String(p.text)).includes(q)))
  const shown = rows.slice(0, i.limit ?? 50)
  return { count: rows.length, shown: shown.length, prompts: shown.map((p) => ({ id: p.id, project: p.project, session: p.session, kind: p.kind, sent: !!p.sentAt, text: p.text })) }
}

/* ============================ GYM GOALS ===================================== */
/* src/store/gym.ts; the field rules from src/assistant.ts KINDS gymGoal / gymGoalEdit. */

const goalOf = (b: Blob, ref: Ref) => pick(arr(b, 'gymGoals'), ref, 'gym goal', (g) => String(g.name ?? ''))
const needsExercise = (m: string) => m === 'e1rm' || m === 'repTotal'

function checkGoalNumber(n: unknown, what: string): void {
  if (!num(n) || n < 0 || n > 1e6) throw new McError(`${what} must be a number between 0 and 1000000.`)
}

export function addGymGoal(b: Blob, i: { name: string; goal: number; unit: string; exercise?: string; metric?: string; lower_is_better?: boolean }): Out {
  const name = (i.name ?? '').trim(), unit = (i.unit ?? '').trim()
  if (!name) throw new McError('A gym goal needs a name.')
  if (!unit) throw new McError('A gym goal needs a unit (kg, reps, sessions ...).')
  if (unit.length > 20) throw new McError('The unit is at most 20 characters.')
  checkGoalNumber(i.goal, 'goal')
  const exercise = i.exercise?.trim() || undefined
  const metric = i.metric ?? (exercise ? 'e1rm' : 'manual') // assistantcore.tsx 'gymGoal'
  if (!GYM_METRICS.includes(metric)) throw new McError(`metric must be one of ${GYM_METRICS.join(', ')}.`)
  if (needsExercise(metric) && !exercise) throw new McError(`Metric "${metric}" reads a Hevy exercise, so exercise is required (the exact Hevy title, e.g. "Bench Press (Barbell)").`)
  const twin = ensure(b, 'gymGoals').find((g) => fold(String(g.name)) === fold(name))
  if (twin) throw new McError(`There is already a gym goal "${twin.name}" (id ${twin.id}). Edit it with edit_gym_goal.`)
  const now = Date.now()
  const row: Row = { id: newId('gymgoal'), name, goal: i.goal, unit, metric, ...(exercise ? { exerciseName: exercise } : {}), ...(i.lower_is_better !== undefined ? { lowerIsBetter: i.lower_is_better } : {}), createdAt: now, updatedAt: now }
  b.gymGoals.push(row)
  return { id: row.id, text: `New gym goal: ${name} (${i.goal} ${unit}, ${metric}${exercise ? `, ${exercise}` : ''}).` }
}

/** gym.ts updateGymGoal: {...goal, ...patch, updatedAt}. The result must still be a valid goal. */
export function editGymGoal(b: Blob, ref: Ref, p: { name?: string; goal?: number; current?: number; unit?: string; exercise?: string; metric?: string; note?: string | null; lower_is_better?: boolean }): Out {
  const g = goalOf(b, ref)
  if (Object.values(p).every((v) => v === undefined)) throw new McError('Nothing to change: pass at least one field.')
  const next: Row = { ...g }
  if (p.name !== undefined) { if (!p.name.trim()) throw new McError('A gym goal needs a name.'); next.name = p.name.trim() }
  if (p.unit !== undefined) { const u = p.unit.trim(); if (!u || u.length > 20) throw new McError('The unit is 1 to 20 characters.'); next.unit = u }
  if (p.goal !== undefined) { checkGoalNumber(p.goal, 'goal'); next.goal = p.goal }
  if (p.metric !== undefined) { if (!GYM_METRICS.includes(p.metric)) throw new McError(`metric must be one of ${GYM_METRICS.join(', ')}.`); next.metric = p.metric }
  if (p.exercise !== undefined) { const e = p.exercise.trim(); if (e) next.exerciseName = e; else delete next.exerciseName }
  if (p.current !== undefined) checkGoalNumber(p.current, 'current')
  if (p.current !== undefined && next.metric !== 'manual') throw new McError(`"${next.name}" reads its number from Hevy (${next.metric}), so a current value would be ignored. Only manual goals take current. Change metric to manual first if that is what he means.`)
  if (p.current !== undefined) next.current = p.current
  if (needsExercise(next.metric) && !next.exerciseName) throw new McError(`Metric "${next.metric}" reads a Hevy exercise, so the goal needs an exercise (the exact Hevy title).`)
  if (p.note !== undefined) { if (p.note === null || !p.note.trim()) delete next.note; else next.note = p.note.trim() }
  if (p.lower_is_better !== undefined) next.lowerIsBetter = p.lower_is_better
  if (p.name !== undefined) {
    const twin = arr(b, 'gymGoals').find((x) => x.id !== g.id && fold(String(x.name)) === fold(next.name))
    if (twin) throw new McError(`There is already a gym goal "${twin.name}" (id ${twin.id}).`)
  }
  for (const k of Object.keys(g)) delete g[k]
  Object.assign(g, next, { updatedAt: Date.now() })
  return { id: g.id, text: `Updated gym goal "${g.name}" (${g.goal} ${g.unit}${g.metric === 'manual' && g.current != null ? `, now ${g.current}` : ''}).` }
}

export function deleteGymGoal(b: Blob, ref: Ref): Out {
  const g = goalOf(b, ref)
  b.gymGoals = arr(b, 'gymGoals').filter((x) => x.id !== g.id)
  bury(b, rowKey('gymGoals', g))
  return { id: g.id, text: `Deleted gym goal "${g.name}".` }
}

export function listGymGoals(b: Blob): Row {
  return {
    note: 'Targets only. get_gym returns each goal with its live current value and % from Hevy.',
    goals: arr(b, 'gymGoals').map((g) => ({ id: g.id, name: g.name, goal: g.goal, unit: g.unit, metric: g.metric, ...(g.exerciseName ? { exercise: g.exerciseName } : {}), ...(g.current != null ? { current: g.current } : {}), ...(g.lowerIsBetter ? { lower_is_better: true } : {}), ...(g.note ? { note: g.note } : {}) })),
  }
}
