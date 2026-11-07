/* Mission Control's state, as plain functions on the one JSON blob.

   NO Deno, NO network, NO Supabase in this file: the Edge Function and the Node
   tests (tools/mcp-ops-test.mjs) both import it, so every rule here is tested
   without a database.

   Why it re-implements the app's rules instead of calling the app: the store
   lives inside React (src/store/*.ts) and cannot run on a server. So each
   operation below is a line-for-line port of what the app's own function does,
   with the app's file named beside it. Where the app does something this file
   does NOT yet do (a habit that is measured, gated or linked to a routine; the
   time a task took), the tool REFUSES and says so, instead of half-doing it.

   Three rules that come from the merge engine (src/sync-merge.ts):
   - a deleted row is also BURIED (graveyard), or the next merge brings it back
   - a note keeps the hash of every body it had (hist), or another device raises
     a conflict banner on a note that was merely behind
   - never invent a number: an estimate he did not give is 0, "not estimated" */

export type Row = Record<string, any>
export type Blob = Record<string, any>

/* A cascade is the one honest reason an operation removes more than one row: deleting a person
   removes their logged contacts, deleting a project can remove its tasks. commit.ts's safety stop
   normally allows ONE removed row per collection; an operation that KNOWS it is cascading declares
   exactly how many extra rows it will remove, per collection, and the stop allows that many and no
   more. The declaration lives on a symbol, so it never reaches the saved JSON. A bug that removes
   more than the operation declared is still stopped. */
const ALLOW = Symbol.for('mc.allowShrink')
export function allowShrink(b: Blob, collection: string, extra: number): void {
  if (extra <= 0) return
  const cur: Record<string, number> = (b as any)[ALLOW] ?? {}
  ;(b as any)[ALLOW] = { ...cur, [collection]: (cur[collection] ?? 0) + extra }
}
export const shrinkAllowance = (b: Blob): Record<string, number> => (b as any)[ALLOW] ?? {}

/** A refusal the person should read: ambiguous match, unknown project, a habit
 *  this connector cannot tick safely. Never a crash. */
export class McError extends Error {}

/* ---- time: his clock is Prague's, the server's is UTC ---------------------- */

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' })
/** 'YYYY-MM-DD' in Prague. The app uses the browser's own clock, which for him is the same. */
export const dateKey = (d = new Date()): string => dayFmt.format(d)
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
export const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
/** Mon=0 .. Sun=6, the app's habit week. */
export const weekdayIndex = (day: string): number => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7

export type Slot = 'morning' | 'noon' | 'afternoon' | 'evening'
export const SLOTS: Slot[] = ['morning', 'noon', 'afternoon', 'evening']
/** src/util.ts slotForTime. */
export function slotForTime(hhmm: string): Slot {
  const [h, m] = hhmm.split(':').map(Number)
  const x = h + m / 60
  return x < 12 ? 'morning' : x < 14 ? 'noon' : x < 18 ? 'afternoon' : 'evening'
}

/* ---- ids and text ---------------------------------------------------------- */

let seq = 0
/** src/store/shared.ts newId. */
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

/** src/sync-merge.ts bodyHash (FNV-1a). Parity is asserted by the test. */
export function bodyHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
export const HIST = 60

/** Lower case, accents off: "Připravit" matches "pripravit". */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
/** src/tags.ts slugTag. */
export const slugTag = (name: string): string => fold(name).replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'project'
export const tagOf = (p: Row): string => p.tag || slugTag(String(p.name ?? ''))
/** src/store/notes.ts noteTitle. */
export function noteTitle(body: string): string {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return first.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+(\[[ xX]\]\s*)?/, '').slice(0, 120)
}

export const arr = (b: Blob, k: string): Row[] => (Array.isArray(b[k]) ? b[k] : [])
/** For writes: the collection, created only when something is being added to it. */
export const ensure = (b: Blob, k: string): Row[] => (Array.isArray(b[k]) ? b[k] : (b[k] = []))

/** A deleted row is buried so the merge cannot bring it back (store/graveyard.ts). */
export function bury(b: Blob, ...keys: string[]): void {
  const now = Date.now()
  const g: Row[] = Array.isArray(b.graveyard) ? b.graveyard : []
  const drop = new Set(keys)
  b.graveyard = [...g.filter((t) => !drop.has(t.k)), ...keys.map((k) => ({ k, at: now }))].slice(-900)
}
/** src/sync-merge.ts rowKey for the entity collections. */
export const rowKey = (field: string, row: Row): string => `${field}:${String(row.id)}`

/* ---- picking one row by what he said ---------------------------------------- */

export interface Ref { id?: string; title?: string }

/** One row, by id or by words. A wrong guess changes his real data, so it NEVER
 *  guesses: no match and several matches are both refusals that name the rows. */
export function pick(rows: Row[], ref: Ref, label: string, nameOf: (r: Row) => string): Row {
  if (ref.id) {
    const hit = rows.find((r) => r.id === ref.id)
    if (!hit) throw new McError(`No ${label} has the id "${ref.id}". List them first to get a real id.`)
    return hit
  }
  const q = fold(ref.title ?? '')
  if (!q) throw new McError(`Say which ${label}: pass its id, or part of its title.`)
  const exact = rows.filter((r) => fold(nameOf(r)) === q)
  const hits = exact.length ? exact : rows.filter((r) => fold(nameOf(r)).includes(q))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new McError(`No ${label} matches "${ref.title}".`)
  const names = hits.slice(0, 8).map((r) => `${r.id}: ${nameOf(r)}`).join(' | ')
  throw new McError(`"${ref.title}" matches ${hits.length} ${label}s (${names}${hits.length > 8 ? ' ...' : ''}). Pass the id of the one you mean.`)
}
export const findTask = (b: Blob, ref: Ref) => pick(arr(b, 'tasks'), ref, 'task', (t) => String(t.title ?? ''))
export const findProject = (b: Blob, name: string): Row => {
  const q = fold(name).replace(/^#/, '')
  const rows = arr(b, 'projects')
  const hit = rows.find((p) => fold(String(p.name)) === q || tagOf(p) === q.replace(/[^a-z0-9_-]/g, ''))
    ?? rows.find((p) => fold(String(p.name)).includes(q))
  if (!hit) throw new McError(`No project is called "${name}". Projects: ${rows.map((p) => p.name).join(', ') || '(none)'}.`)
  return hit
}

/* ============================== TASKS ======================================== */
/* Ports of src/store/planner.ts. */

export interface AddTaskInput {
  title: string
  space?: 'personal' | 'work'
  list?: 'today' | 'backlog'
  date?: string
  slot?: Slot
  at?: string
  minutes?: number
  project?: string
  steps?: { title: string; minutes?: number }[]
  category?: 'call' | 'admin' | 'deep' | 'quick'
  allowDuplicate?: boolean
}

export function addTask(b: Blob, i: AddTaskInput): { id: string; text: string } {
  const title = (i.title ?? '').trim()
  if (!title) throw new McError('A task needs a title.')
  if (title.length > 300) throw new McError('That title is over 300 characters. Shorten it, put the rest in a note.')
  if (i.date !== undefined && !isDate(i.date)) throw new McError(`date must be YYYY-MM-DD, got "${i.date}".`)
  if (i.at !== undefined && !isTime(i.at)) throw new McError(`at must be HH:MM (24h), got "${i.at}".`)
  const dupe = arr(b, 'tasks').find((t) => !t.done && fold(String(t.title)) === fold(title))
  if (dupe && !i.allowDuplicate) {
    throw new McError(`There is already an open task "${dupe.title}" (id ${dupe.id}). Move or edit that one, or pass allow_duplicate: true if this is a different task.`)
  }
  let space = i.space ?? 'personal'
  let projectId: string | undefined
  if (i.project) {
    const p = findProject(b, i.project)
    if (i.space && i.space !== p.space) throw new McError(`Project "${p.name}" belongs to ${p.space}, not ${i.space}. Drop space, or pick another project.`)
    projectId = p.id
    space = p.space
  }
  const list = i.date || i.at ? 'today' : (i.list ?? 'backlog')
  const row: Row = {
    id: newId('t'), title, source: 'mc', estimateMin: 0, done: false, space, list, category: i.category ?? 'quick',
    createdAt: dateKey(), addedAt: Date.now(),
  }
  if (projectId) row.projectId = projectId
  if (list === 'today') row.plannedOn = i.date ?? dateKey()
  if (i.at) { row.at = i.at; row.slot = slotForTime(i.at) } else if (i.slot) {
    if (!SLOTS.includes(i.slot)) throw new McError(`slot must be one of ${SLOTS.join(', ')}.`)
    row.slot = i.slot
  }
  if (i.steps?.length) {
    row.subtasks = i.steps.map((s, k) => ({
      id: `${row.id}s${k}`, title: String(s.title).trim(), estimateMin: s.minutes ? Math.max(1, Math.round(s.minutes)) : 0, done: false,
    })).filter((s) => s.title)
    const sum = row.subtasks.reduce((a: number, s: Row) => a + s.estimateMin, 0)
    row.estimateMin = sum
    row.estimated = sum > 0
  } else if (i.minutes !== undefined) {
    row.estimateMin = Math.max(1, Math.round(i.minutes))
    row.estimated = true
  }
  ensure(b, 'tasks').unshift(row) // the app prepends: newest first
  return { id: row.id, text: `Added "${title}" (${space}${projectId ? `, #${tagOf(findProject(b, i.project!))}` : ''}, ${list === 'today' ? `on ${row.plannedOn}${row.at ? ` at ${row.at}` : ''}` : 'on the list'}).` }
}

export interface UpdateTaskInput {
  title?: string
  minutes?: number
  space?: 'personal' | 'work'
  /** a project name, or null to take it out of its project */
  project?: string | null
  /** HH:MM, or null to unpin the time */
  at?: string | null
  slot?: Slot
  list?: 'today' | 'backlog'
  date?: string
}

export function updateTask(b: Blob, ref: Ref, p: UpdateTaskInput): { id: string; text: string } {
  const t = findTask(b, ref)
  const did: string[] = []
  if (p.title !== undefined) {
    const title = p.title.trim()
    if (!title) throw new McError('A title cannot be empty.')
    t.title = title; did.push('title')
  }
  if (p.minutes !== undefined) {
    if (t.subtasks?.length) throw new McError(`"${t.title}" has steps, so its estimate is the sum of the steps. Change the steps instead.`)
    t.estimateMin = Math.max(1, Math.round(p.minutes)); t.estimated = true; did.push(`${t.estimateMin} min`)
  }
  if (p.space !== undefined && p.space !== t.space) {
    t.space = p.space; delete t.projectId; did.push(`moved to ${p.space}`) // setTaskSpace clears the project
  }
  if (p.project !== undefined) {
    if (p.project === null) { delete t.projectId; did.push('left its project') } else {
      const pr = findProject(b, p.project)
      t.projectId = pr.id; t.space = pr.space; did.push(`#${tagOf(pr)}`) // the task follows the project to its space
    }
  }
  if (p.list !== undefined || p.date !== undefined) {
    if (p.date !== undefined && !isDate(p.date)) throw new McError(`date must be YYYY-MM-DD, got "${p.date}".`)
    const list = p.list ?? 'today' // a date implies the day plan
    if (list === 'today') { t.list = 'today'; t.plannedOn = p.date ?? t.plannedOn ?? dateKey(); did.push(`on ${t.plannedOn}`) } else {
      t.list = 'backlog'; delete t.plannedOn; t.addedAt = Date.now(); delete t.at; did.push('back on the list') // moveTaskList: a fresh arrival
      const pl = b.plan
      if (pl && Array.isArray(pl.returnedIds) && pl.returnedIds.includes(t.id)) {
        pl.returnedIds = pl.returnedIds.filter((x: string) => x !== t.id); pl.returnedCount = pl.returnedIds.length
      }
    }
  }
  if (p.at !== undefined) {
    if (p.at === null) { delete t.at; did.push('unpinned') } else {
      if (!isTime(p.at)) throw new McError(`at must be HH:MM (24h), got "${p.at}".`)
      t.at = p.at; t.list = 'today'; t.plannedOn = t.plannedOn ?? dateKey(); t.slot = slotForTime(p.at); did.push(`at ${p.at}`) // a clock time implies a part of the day
    }
  } else if (p.slot !== undefined) {
    if (!SLOTS.includes(p.slot)) throw new McError(`slot must be one of ${SLOTS.join(', ')}.`)
    t.slot = p.slot; did.push(p.slot)
  }
  if (!did.length) throw new McError('Nothing to change: pass at least one field.')
  return { id: t.id, text: `Updated "${t.title}": ${did.join(', ')}.` }
}

export function completeTask(b: Blob, ref: Ref): { id: string; text: string } {
  const t = findTask(b, ref)
  if (t.done) return { id: t.id, text: `"${t.title}" was already done.` }
  t.done = true
  t.doneAt = new Date().toISOString() // finishing is a moment
  if (Array.isArray(t.subtasks)) t.subtasks = t.subtasks.map((s: Row) => ({ ...s, done: true }))
  return { id: t.id, text: `Marked "${t.title}" done. No time was logged against it.` }
}

export function reopenTask(b: Blob, ref: Ref): { id: string; text: string } {
  const t = findTask(b, ref)
  if (!t.done) return { id: t.id, text: `"${t.title}" was not done.` }
  t.done = false; delete t.doneAt; delete t.actualMin
  if (Array.isArray(t.subtasks)) t.subtasks = t.subtasks.map((s: Row) => { const { actualMin: _a, ...rest } = s; return { ...rest, done: false } })
  return { id: t.id, text: `Reopened "${t.title}".` }
}

export function deleteTask(b: Blob, ref: Ref): { id: string; text: string } {
  const t = findTask(b, ref)
  b.tasks = arr(b, 'tasks').filter((x) => x.id !== t.id)
  bury(b, rowKey('tasks', t))
  return { id: t.id, text: `Deleted "${t.title}". (It can be put back from the app's Undo only while the app still shows the toast; otherwise add it again.)` }
}

export function setSteps(b: Blob, ref: Ref, steps: { title: string; minutes?: number }[]): { id: string; text: string } {
  const t = findTask(b, ref)
  const subs = steps.map((s, k) => ({
    id: `${t.id}s${k}${Date.now().toString(36)}`, title: String(s.title).trim(), estimateMin: s.minutes ? Math.max(1, Math.round(s.minutes)) : 0, done: false,
  })).filter((s) => s.title)
  if (!subs.length) { delete t.subtasks; t.estimated = false; return { id: t.id, text: `Removed the steps from "${t.title}".` } }
  t.subtasks = subs
  const sum = subs.reduce((a, s) => a + s.estimateMin, 0)
  t.estimateMin = sum; t.estimated = sum > 0
  return { id: t.id, text: `"${t.title}" now has ${subs.length} steps.` }
}

/* ============================== PROJECTS ===================================== */

export function addProject(b: Blob, name: string, space: 'personal' | 'work'): { id: string; text: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new McError('A project needs a name.')
  const projects = ensure(b, 'projects')
  if (projects.some((p) => fold(String(p.name)) === fold(trimmed))) throw new McError(`A project called "${trimmed}" already exists.`)
  // Two projects named alike would answer to one tag; the second gets "2", then "3" (src/tags.ts freeTag: "home" then "home2").
  const taken = new Set(projects.map(tagOf))
  const base = slugTag(trimmed)
  let tag = base
  for (let n = 2; taken.has(tag); n++) tag = `${base}${n}`
  const row: Row = { id: newId('proj'), name: trimmed, space, createdAt: dateKey() }
  if (tag !== base) row.tag = tag
  projects.push(row)
  return { id: row.id, text: `Created project "${trimmed}" (#${tag}) in ${space}.` }
}

export function renameProject(b: Blob, nameOrId: string, to: string): { id: string; text: string } {
  const trimmed = (to ?? '').trim()
  if (!trimmed) throw new McError('A project needs a name.')
  const p = arr(b, 'projects').find((x) => x.id === nameOrId) ?? findProject(b, nameOrId)
  const old = p.name; p.name = trimmed
  return { id: p.id, text: `Renamed project "${old}" to "${trimmed}".` }
}

/* ============================== NOTES ======================================== */
/* Ports of src/store/notes.ts. The dev stamp is "claude": a merge uses it to tell
   a different device's edit from this one's own. */

export const DEV = 'claude'

export function addNote(b: Blob, i: { body: string; space?: 'personal' | 'work'; folderId?: string }): { id: string; text: string } {
  const body = i.body ?? ''
  if (!body.trim()) throw new McError('A note needs some text.')
  const space = i.space ?? 'personal'
  const folderId = i.folderId ?? `nf-space-${space}`
  if (i.folderId && !/^nf-space-/.test(i.folderId) && !arr(b, 'noteFolders').some((f) => f.id === i.folderId)) {
    throw new McError(`No note folder has the id "${i.folderId}".`)
  }
  const row: Row = {
    id: newId('note'), space, folderId, title: noteTitle(body), body, color: 'amber', when: dateKey(), updatedAt: Date.now(), hist: [], dev: DEV,
  }
  ensure(b, 'notes').unshift(row)
  return { id: row.id, text: `Saved note "${row.title}".` }
}

const findNote = (b: Blob, ref: Ref) => pick(arr(b, 'notes'), ref, 'note', (n) => String(n.title ?? ''))

/** Writing a note IS appending, and appending is the one edit a merge always
 *  recognises as ordinary propagation. */
export function appendNote(b: Blob, ref: Ref, text: string): { id: string; text: string } {
  const n = findNote(b, ref)
  if (!String(text ?? '').trim()) throw new McError('Nothing to append.')
  const old = String(n.body ?? '')
  const body = old + (old && !old.endsWith('\n') ? '\n' : '') + text
  n.hist = [...(Array.isArray(n.hist) ? n.hist : []), bodyHash(old)].slice(-HIST)
  n.body = body; n.title = noteTitle(body); n.dev = DEV; n.updatedAt = Date.now()
  return { id: n.id, text: `Added to note "${n.title}".` }
}

/** Replaces the whole text. The old body's hash goes into hist so another device
 *  sees it as an ancestor instead of a divergence. */
export function replaceNote(b: Blob, ref: Ref, body: string): { id: string; text: string } {
  const n = findNote(b, ref)
  if (!String(body ?? '').trim()) throw new McError('A note cannot be emptied this way. Delete it instead.')
  const old = String(n.body ?? '')
  if (old !== body) n.hist = [...(Array.isArray(n.hist) ? n.hist : []), bodyHash(old)].slice(-HIST)
  n.body = body; n.title = noteTitle(body); n.dev = DEV; n.updatedAt = Date.now()
  return { id: n.id, text: `Rewrote note "${n.title}".` }
}

export function deleteNote(b: Blob, ref: Ref): { id: string; text: string } {
  const n = findNote(b, ref)
  b.notes = arr(b, 'notes').filter((x) => x.id !== n.id)
  bury(b, rowKey('notes', n))
  return { id: n.id, text: `Deleted note "${n.title}".` }
}

export function setNoteDone(b: Blob, ref: Ref, done: boolean): { id: string; text: string } {
  const n = findNote(b, ref)
  // Ticking is not an edit of the text, so hist and body stay; a done note leaves the pinned slot.
  if (done) { n.done = Date.now(); n.pinned = false } else delete n.done
  n.dev = DEV; n.updatedAt = Date.now()
  return { id: n.id, text: done ? `Marked note "${n.title}" done.` : `Reopened note "${n.title}".` }
}

/* ============================== READS ======================================== */

const projName = (b: Blob, id?: string): string | undefined => (id ? arr(b, 'projects').find((p) => p.id === id)?.name : undefined)

export function taskLine(b: Blob, t: Row): Row {
  const steps = Array.isArray(t.subtasks) ? t.subtasks : []
  return {
    id: t.id, title: t.title, done: !!t.done, space: t.space,
    ...(t.projectId ? { project: projName(b, t.projectId), tag: (() => { const p = arr(b, 'projects').find((x) => x.id === t.projectId); return p ? `#${tagOf(p)}` : undefined })() } : {}),
    list: t.list, ...(t.plannedOn ? { date: t.plannedOn } : {}), ...(t.slot ? { slot: t.slot } : {}), ...(t.at ? { at: t.at } : {}),
    ...(t.estimateMin ? { minutes: t.estimateMin } : {}),
    ...(steps.length ? { steps: steps.map((s: Row) => ({ title: s.title, done: !!s.done, ...(s.estimateMin ? { minutes: s.estimateMin } : {}) })) } : {}),
    ...(t.createdAt ? { added: t.createdAt } : {}),
  }
}

export interface ListTasksInput {
  where?: 'today' | 'planned' | 'backlog' | 'done' | 'open' | 'all'
  date?: string
  space?: 'personal' | 'work'
  project?: string
  query?: string
  limit?: number
}

export function listTasks(b: Blob, i: ListTasksInput): { count: number; shown: number; tasks: Row[] } {
  const today = dateKey()
  const where = i.where ?? 'open'
  const q = i.query ? fold(i.query) : ''
  const pid = i.project ? findProject(b, i.project).id : undefined
  let rows = arr(b, 'tasks').filter((t) => {
    if (i.space && t.space !== i.space) return false
    if (pid && t.projectId !== pid) return false
    if (q && !fold(String(t.title)).includes(q)) return false
    const day = t.plannedOn ?? today
    switch (where) {
      case 'today': return t.list === 'today' && day === (i.date ?? today) && (i.date ? true : !t.done || dateKey(new Date(t.doneAt ?? 0)) === today)
      case 'planned': return t.list === 'today' && !t.done && day > today
      case 'backlog': return t.list === 'backlog' && !t.done
      case 'done': return !!t.done
      case 'open': return !t.done
      default: return true
    }
  })
  if (i.date && where !== 'today') rows = rows.filter((t) => (t.plannedOn ?? today) === i.date)
  const limit = Math.min(Math.max(i.limit ?? 50, 1), 200)
  return { count: rows.length, shown: Math.min(rows.length, limit), tasks: rows.slice(0, limit).map((t) => taskLine(b, t)) }
}

/** A day's plan, in clock order inside each part of the day. */
export function getDay(b: Blob, date?: string): Row {
  const day = date ?? dateKey()
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  const rows = arr(b, 'tasks').filter((t) => t.list === 'today' && (t.plannedOn ?? dateKey()) === day)
  const slots: Row = {}
  for (const s of [...SLOTS, 'unsorted'] as const) {
    const items = rows.filter((t) => (s === 'unsorted' ? !t.slot : t.slot === s))
      .sort((a, c) => (a.at ?? '99:99').localeCompare(c.at ?? '99:99'))
    if (items.length) slots[s] = items.map((t) => taskLine(b, t))
  }
  const open = rows.filter((t) => !t.done)
  return { date: day, open: open.length, done: rows.length - open.length, plannedMinutes: open.reduce((a, t) => a + (t.estimateMin || 0), 0), slots }
}

export function listProjects(b: Blob): Row[] {
  return arr(b, 'projects').map((p) => ({
    id: p.id, name: p.name, tag: `#${tagOf(p)}`, space: p.space,
    openTasks: arr(b, 'tasks').filter((t) => t.projectId === p.id && !t.done).length,
  }))
}


export function listNotes(b: Blob, i: { query?: string; limit?: number }): { count: number; notes: Row[] } {
  const q = i.query ? fold(i.query) : ''
  const rows = arr(b, 'notes').filter((n) => !q || fold(`${n.title} ${n.body}`).includes(q))
    .sort((a, c) => Number(c.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
  const limit = Math.min(Math.max(i.limit ?? 30, 1), 100)
  return {
    count: rows.length,
    notes: rows.slice(0, limit).map((n) => ({
      id: n.id, title: n.title, space: n.space, folderId: n.folderId, pinned: !!n.pinned, done: !!n.done,
      updated: n.updatedAt ? dateKey(new Date(n.updatedAt)) : undefined, preview: String(n.body ?? '').slice(0, 160),
    })),
  }
}

export function getNote(b: Blob, ref: Ref): Row {
  const n = findNote(b, ref)
  return { id: n.id, title: n.title, space: n.space, folderId: n.folderId, pinned: !!n.pinned, done: !!n.done, body: n.body, hasConflict: !!n.conflict }
}

/** Collections `browse` may read: whatever shape they have, returned as stored,
 *  so nothing is guessed about fields this file does not model. */
export const BROWSABLE = [
  'goals', 'routines', 'people', 'personBonds', 'personContacts', 'prospects', 'ideaBoard', 'gymGoals', 'prompts',
  'noteFolders', 'focusSessions', 'ledger', 'invoices', 'invoiceClients', 'habitLog', 'dayLog',
] as const

const shrink = (v: any, depth = 0): any => {
  if (typeof v === 'string') return v.length > 400 ? `${v.slice(0, 400)}...[+${v.length - 400} chars]` : v
  if (Array.isArray(v)) return v.length > 40 ? [...v.slice(0, 40).map((x) => shrink(x, depth + 1)), `...[+${v.length - 40} more]`] : v.map((x) => shrink(x, depth + 1))
  if (v && typeof v === 'object') {
    if (depth > 3) return '[nested]'
    const out: Row = {}
    for (const [k, x] of Object.entries(v)) { if (k === 'hist' || k === 'history') continue; out[k] = shrink(x, depth + 1) }
    return out
  }
  return v
}

export function browse(b: Blob, i: { collection: string; query?: string; limit?: number }): Row {
  if (!(BROWSABLE as readonly string[]).includes(i.collection)) throw new McError(`Cannot browse "${i.collection}". Choose one of: ${BROWSABLE.join(', ')}.`)
  const q = i.query ? fold(i.query) : ''
  let rows = arr(b, i.collection)
  if (q) rows = rows.filter((r) => fold(JSON.stringify(r)).includes(q))
  if (i.collection === 'habitLog' || i.collection === 'focusSessions' || i.collection === 'ledger') rows = [...rows].reverse() // newest first
  const limit = Math.min(Math.max(i.limit ?? 30, 1), 100)
  return { collection: i.collection, count: rows.length, shown: Math.min(rows.length, limit), rows: rows.slice(0, limit).map((r) => shrink(r)) }
}

export function overview(b: Blob): Row {
  const today = dateKey(); const i = weekdayIndex(today)
  const tasks = arr(b, 'tasks')
  const onToday = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? today) === today)
  const habits = arr(b, 'habits').filter((h) => !h.archivedAt && !h.paused && h.kind !== 'break')
  const log = arr(b, 'habitLog')
  const kept = habits.filter((h) => log.some((t) => t.habitId === h.id && t.day === today) || (Array.isArray(h.days) && h.days[i]))
  return {
    today, weekday: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i],
    day: { open: onToday.filter((t) => !t.done).length, done: onToday.filter((t) => t.done).length },
    overdue: tasks.filter((t) => t.list === 'today' && !t.done && (t.plannedOn ?? today) < today).length,
    planned: tasks.filter((t) => t.list === 'today' && !t.done && (t.plannedOn ?? today) > today).length,
    backlog: tasks.filter((t) => t.list === 'backlog' && !t.done).length,
    habits: { tracked: habits.length, keptToday: kept.length },
    counts: Object.fromEntries(['projects', 'notes', 'goals', 'routines', 'people', 'prospects', 'ideaBoard', 'gymGoals', 'prompts'].map((k) => [k, arr(b, k).length])),
    lastWrite: b.lastWrite ? { by: b.lastWrite.name, at: new Date(b.lastWrite.at).toISOString() } : undefined,
  }
}
