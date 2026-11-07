/* REMINDERS area: lists, reminders, flags, repeats, completed ones kept.
   Ports of src/store/reminders.ts (addReminder, updateReminder, toggleReminder, deleteReminder,
   add/update/deleteReminderList, nextRepeat/toLocalStamp/fromLocalStamp) and of every mutation
   src/remindersPage.tsx performs (smart lists, flag, move between lists, clearing the time
   clears the repeat, deleting a list takes its reminders with it, the last list stays).

   Pure functions on the state blob: NO Deno, NO network.

   Time: `remindAt` is a LOCAL wall-time stamp 'YYYY-MM-DDTHH:MM' (Prague, no zone), exactly as
   the app stores it. The app computes repeats with the browser's Date in his zone; a server is in
   UTC, so the same calendar arithmetic is done on the wall-clock fields directly (Date.UTC is used
   only as a calendar, never as an instant), including JS's month overflow (Jan 31 + 1 month is
   Mar 3 or Mar 2) and Prague's spring-forward gap (a wall time of 02:xx on the last Sunday of
   March does not exist; a browser in Prague turns it into 03:xx, and so does this).

   Deliberate refusals (the app has no such operation, or it would store something it cannot show):
   - a repeat without a time: the page offers Repeat only once a time is set, and toggleReminder
     only repeats a reminder that has both
   - the last list cannot be deleted (deleteReminderList is a no-op for it)
   - an empty title / list name (the page ignores them) */
import {
  McError, allowShrink, arr, bury, ensure, fold, newId, pick, rowKey,
  type Blob, type Row, type Ref,
} from './ops.ts'

type Out = { id: string; text: string }

export const DEFAULT_LIST_ID = 'rl-reminders' // src/store/reminders.ts
export const REPEATS = ['daily', 'weekly', 'monthly']
/* src/remindersPage.tsx REMINDER_COLORS (names; the hex values are the page's own). */
export const REMINDER_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'brown']
export const NEW_LIST_COLOR = 'purple' // the page's "Add list" starts on purple
export const SMART_VIEWS = ['today', 'scheduled', 'all', 'flagged', 'completed']
export const MAX_BULK = 40

/* ============================ local stamps (src/store/reminders.ts) ============================ */

const pad = (n: number) => String(n).padStart(2, '0')
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Strict: a real calendar date, 00:00 to 23:59. */
export function parseStamp(s: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = STAMP.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  if (h > 23 || mi > 59 || mo < 1 || mo > 12) return null
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null
  return { y, mo, d, h, mi }
}
export const isStamp = (s: unknown): s is string => typeof s === 'string' && parseStamp(s) !== null

/** Last Sunday of March, day of month, for a year (the EU change Prague follows). */
function marchChangeDay(y: number): number {
  const last = new Date(Date.UTC(y, 2, 31))
  return 31 - last.getUTCDay()
}
const fmt = (y: number, mo: number, d: number, h: number, mi: number) => `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`

/** new Date(y, m, d, h, mm) in Prague, back to a stamp: the gap hour moves forward, as in a browser. */
function wall(ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const t = new Date(ms)
  let h = t.getUTCHours()
  const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate()
  if (mo === 3 && d === marchChangeDay(y) && h === 2) h = 3
  return { y, mo, d, h, mi: t.getUTCMinutes() }
}

/** src/store/reminders.ts nextRepeat(stamp, repeat). */
export function nextRepeat(stamp: string, repeat: 'daily' | 'weekly' | 'monthly'): string {
  const p = parseStamp(stamp)
  if (!p) throw new McError(`"${stamp}" is not a time like 2026-11-07T09:00.`)
  const from = wall(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)) // fromLocalStamp: a gap time is already 03:xx
  const to = repeat === 'daily' ? Date.UTC(from.y, from.mo - 1, from.d + 1, from.h, from.mi)
    : repeat === 'weekly' ? Date.UTC(from.y, from.mo - 1, from.d + 7, from.h, from.mi)
      : Date.UTC(from.y, from.mo, from.d, from.h, from.mi) // setMonth(+1), overflow included
  const w = wall(to)
  return fmt(w.y, w.mo, w.d, w.h, w.mi)
}

const nowFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** The current Prague wall time as a stamp. */
export function nowStamp(d = new Date()): string {
  const p = Object.fromEntries(nowFmt.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/* ============================ lists ============================ */

const defaultList = (): Row => ({ id: DEFAULT_LIST_ID, name: 'Reminders', color: 'blue', createdAt: 0, updatedAt: 0 })

/** The lists as the app shows them: an empty collection is the one fixed default list. */
export const effLists = (b: Blob): Row[] => (arr(b, 'reminderLists').length ? arr(b, 'reminderLists') : [defaultList()])
/** For writes: store the default list the app shows when nothing is stored (same fixed id, so no device invents its own). */
function ensureLists(b: Blob): Row[] {
  const l = ensure(b, 'reminderLists')
  if (!l.length) l.push(defaultList())
  return l
}
const checkColor = (c: string): string => {
  if (!REMINDER_COLORS.includes(c)) throw new McError(`color must be one of ${REMINDER_COLORS.join(', ')}.`)
  return c
}
/** A list by id, exact name, or words in the name. */
function findList(b: Blob, ref: string | Ref): Row {
  const r: Ref = typeof ref === 'string' ? (effLists(b).some((l) => l.id === ref) ? { id: ref } : { title: ref }) : ref
  return pick(effLists(b), r, 'reminder list', (l) => String(l.name ?? ''))
}
const openCount = (b: Blob, listId: string) => arr(b, 'reminders').filter((r) => r.listId === listId && !r.doneAt).length

export function listReminderLists(b: Blob): Row {
  const lists = effLists(b).map((l) => ({
    id: l.id, name: l.name, color: l.color,
    open: openCount(b, l.id), completed: arr(b, 'reminders').filter((r) => r.listId === l.id && r.doneAt).length,
  }))
  return { count: lists.length, lists, colors: REMINDER_COLORS }
}

/** src/store/reminders.ts addReminderList. The page does not add a nameless list. */
export function addReminderList(b: Blob, name: string, color?: string): Out {
  const n = (name ?? '').trim()
  if (!n) throw new McError('A list needs a name.')
  const c = checkColor(color ?? NEW_LIST_COLOR)
  const lists = ensureLists(b)
  const now = Date.now(), id = newId('rl')
  lists.push({ id, name: n, color: c, createdAt: now, updatedAt: now })
  return { id, text: `Added reminder list "${n}" (${c}).` }
}

/** src/store/reminders.ts updateReminderList (name, color); the page leaves a name alone if blanked, so blank is refused. */
export function editReminderList(b: Blob, ref: string | Ref, p: { name?: string; color?: string }): Out {
  if (p.name === undefined && p.color === undefined) throw new McError('Nothing to change: pass new_name or color.')
  ensureLists(b)
  const l = findList(b, ref)
  const did: string[] = []
  if (p.name !== undefined) {
    const n = p.name.trim()
    if (!n) throw new McError('A list name cannot be empty.')
    l.name = n; did.push(`name "${n}"`)
  }
  if (p.color !== undefined) { l.color = checkColor(p.color); did.push(`colour ${l.color}`) }
  l.updatedAt = Date.now()
  return { id: l.id, text: `List "${l.name}": ${did.join(', ')}.` }
}

/** src/store/reminders.ts deleteReminderList: the list goes WITH its reminders, and the last list stays. */
export function deleteReminderList(b: Blob, ref: string | Ref): Out {
  ensureLists(b)
  const l = findList(b, ref)
  const lists = arr(b, 'reminderLists')
  if (lists.length <= 1) throw new McError(`"${l.name}" is the last list and the app always keeps one. Add another list first.`)
  const gone = arr(b, 'reminders').filter((r) => r.listId === l.id)
  b.reminderLists = lists.filter((x) => x.id !== l.id)
  b.reminders = arr(b, 'reminders').filter((r) => r.listId !== l.id)
  allowShrink(b, 'reminders', gone.length - 1)
  bury(b, rowKey('reminderLists', l), ...gone.map((r) => rowKey('reminders', r)))
  return { id: l.id, text: `Deleted list "${l.name}"${gone.length ? ` and its ${gone.length} reminder${gone.length === 1 ? '' : 's'}` : ''}.` }
}

/* ============================ reminders ============================ */

const checkStamp = (s: string): string => {
  if (!isStamp(s)) throw new McError(`remind_at "${s}" must be a real local time like 2026-11-07T09:00 (Prague wall time, 00:00 to 23:59, no zone).`)
  return s
}
const checkRepeat = (r: string) => {
  if (!REPEATS.includes(r)) throw new McError(`repeat must be one of ${REPEATS.join(', ')}.`)
}
const cleanTitle = (t: string | undefined): string => {
  const s = (t ?? '').trim()
  if (!s) throw new McError('A reminder needs a title.')
  return s
}

const findReminder = (b: Blob, ref: Ref, want: 'open' | 'done' | 'any'): Row => {
  const all = arr(b, 'reminders')
  if (ref.id || want === 'any') return pick(all, ref, 'reminder', (r) => String(r.title ?? ''))
  return pick(all.filter((r) => (want === 'done' ? !!r.doneAt : !r.doneAt)), ref, want === 'done' ? 'completed reminder' : 'open reminder', (r) => String(r.title ?? ''))
}

export interface AddReminderInput { title: string; notes?: string; list?: string; remind_at?: string; repeat?: string; flagged?: boolean }

/** src/store/reminders.ts addReminder. List: the one named, else the app's default (the fixed first list, or the first one). */
export function addReminder(b: Blob, i: AddReminderInput): Out {
  const title = cleanTitle(i.title)
  const lists = ensureLists(b)
  const l = i.list ? findList(b, i.list) : (lists.find((x) => x.id === DEFAULT_LIST_ID) ?? lists[0])
  if (i.remind_at !== undefined) checkStamp(i.remind_at)
  if (i.repeat !== undefined) {
    checkRepeat(i.repeat)
    if (i.remind_at === undefined) throw new McError('A repeat needs a time: the app only offers Repeat once a time is set. Pass remind_at too.')
  }
  const now = Date.now(), id = newId('rem')
  const row: Row = { id, title, notes: (i.notes ?? '').trim(), listId: l.id, flagged: !!i.flagged, createdAt: now, updatedAt: now }
  if (i.remind_at !== undefined) row.remindAt = i.remind_at
  if (i.repeat !== undefined) row.repeat = i.repeat
  ensure(b, 'reminders').push(row)
  return { id, text: `Added reminder "${title}" to ${l.name}${row.remindAt ? ` for ${row.remindAt}${row.repeat ? `, ${row.repeat}` : ''}` : ''}${row.flagged ? ', flagged' : ''}.` }
}

export function addReminders(b: Blob, items: AddReminderInput[]): { ids: string[]; text: string } {
  if (!items.length) throw new McError('Pass at least one reminder.')
  if (items.length > MAX_BULK) throw new McError(`At most ${MAX_BULK} reminders at a time (got ${items.length}). Nothing was added.`)
  const made = items.map((it, n) => {
    try { return addReminder(b, it) } catch (e) { throw e instanceof McError ? new McError(`Item ${n + 1} ("${it?.title ?? ''}"): ${e.message} Nothing was added.`) : e }
  })
  return { ids: made.map((m) => m.id), text: `Added ${made.length} reminder${made.length === 1 ? '' : 's'}: ${items.map((x) => `"${x.title.trim()}"`).join(', ')}.` }
}

export interface EditReminderInput { new_title?: string; notes?: string; list?: string; remind_at?: string | null; repeat?: string; flagged?: boolean }

/** src/store/reminders.ts updateReminder. As the page does it: clearing the time clears the repeat too. */
export function editReminder(b: Blob, ref: Ref, p: EditReminderInput): Out {
  if (Object.values(p).every((v) => v === undefined)) throw new McError('Nothing to change: pass new_title, notes, list, remind_at, repeat or flagged.')
  const r = findReminder(b, ref, 'any')
  const did: string[] = []
  let listId = r.listId
  if (p.list !== undefined) { ensureLists(b); listId = findList(b, p.list).id }
  let remindAt: string | undefined = r.remindAt, repeat: string | undefined = r.repeat
  if (p.remind_at === null) {
    if (p.repeat && p.repeat !== 'none') throw new McError('Clearing the time and setting a repeat contradict each other.')
    remindAt = undefined; repeat = undefined
  } else if (p.remind_at !== undefined) remindAt = checkStamp(p.remind_at)
  if (p.repeat !== undefined) {
    if (p.repeat === 'none') repeat = undefined
    else {
      checkRepeat(p.repeat)
      if (!remindAt) throw new McError('A repeat needs a time: set remind_at too (the app only offers Repeat once a time is set).')
      repeat = p.repeat
    }
  }
  const title = p.new_title !== undefined ? cleanTitle(p.new_title) : undefined
  if (title !== undefined) { r.title = title; did.push(`title "${title}"`) }
  if (p.notes !== undefined) { r.notes = p.notes.trim(); did.push('notes') }
  if (p.list !== undefined) { r.listId = listId; did.push(`list ${findList(b, listId).name}`) }
  if (p.remind_at !== undefined) { if (remindAt) r.remindAt = remindAt; else delete r.remindAt; did.push(remindAt ? `time ${remindAt}` : 'no time') }
  if (p.repeat !== undefined || (p.remind_at === null && r.repeat)) { if (repeat) r.repeat = repeat; else delete r.repeat; did.push(repeat ? `repeat ${repeat}` : 'no repeat') }
  if (p.flagged !== undefined) { r.flagged = p.flagged; did.push(p.flagged ? 'flagged' : 'unflagged') }
  r.updatedAt = Date.now()
  return { id: r.id, text: `Reminder "${r.title}": ${did.join(', ')}.` }
}

/** src/store/reminders.ts toggleReminder, the "tick" half. A repeating one with a time: this one is
 *  done and the next appears at the next time (a copy with a new id, same title/notes/list/flag/repeat). */
function tick(b: Blob, r: Row): { next?: Row } {
  const now = Date.now()
  const copy = { ...r }
  r.doneAt = now; r.updatedAt = now
  if (!copy.repeat || !copy.remindAt) return {}
  delete copy.doneAt
  const next: Row = { ...copy, id: newId('rem'), remindAt: nextRepeat(copy.remindAt, copy.repeat), createdAt: now, updatedAt: now }
  ensure(b, 'reminders').push(next)
  return { next }
}

/** Complete several (one is a list of one). Targets are resolved BEFORE anything changes so the
 *  new occurrences cannot make a later title ambiguous. Already-done ones are skipped, not toggled back. */
export function completeReminders(b: Blob, refs: Ref[]): { ids: string[]; text: string } {
  if (!refs.length) throw new McError('Pass at least one reminder.')
  if (refs.length > MAX_BULK) throw new McError(`At most ${MAX_BULK} reminders at a time (got ${refs.length}). Nothing was changed.`)
  const rows = refs.map((ref, n) => {
    try { return findReminder(b, ref, 'open') } catch (e) { throw e instanceof McError && refs.length > 1 ? new McError(`Item ${n + 1}: ${e.message} Nothing was changed.`) : e }
  })
  const ids = new Set<string>()
  for (const r of rows) { if (ids.has(r.id)) throw new McError(`"${r.title}" is listed twice. Nothing was changed.`); ids.add(r.id) }
  const lines: string[] = [], done: string[] = []
  for (const r of rows) {
    if (r.doneAt) { lines.push(`"${r.title}" was already completed.`); continue }
    const { next } = tick(b, r)
    done.push(r.id)
    lines.push(next ? `Completed "${r.title}"; the next one is set for ${next.remindAt} (${next.repeat}) as ${next.id}.` : `Completed "${r.title}".`)
  }
  return { ids: done, text: lines.join(' ') }
}

/** src/store/reminders.ts toggleReminder, the untick half: only doneAt is cleared. A repeat's next occurrence
 *  that ticking created stays (the app does not remove it either). */
export function reopenReminder(b: Blob, ref: Ref): Out {
  const r = findReminder(b, ref, 'done')
  if (!r.doneAt) return { id: r.id, text: `"${r.title}" is not completed.` }
  delete r.doneAt; r.updatedAt = Date.now()
  return { id: r.id, text: `Reopened "${r.title}".${r.repeat ? ' The next occurrence created when it was ticked is left as it is, as in the app.' : ''}` }
}

/** src/store/reminders.ts deleteReminder: removed and buried. */
export function deleteReminder(b: Blob, ref: Ref): Out {
  const r = findReminder(b, ref, 'any')
  b.reminders = arr(b, 'reminders').filter((x) => x.id !== r.id)
  bury(b, rowKey('reminders', r))
  return { id: r.id, text: `Deleted reminder "${r.title}".` }
}

/* ============================ reading ============================ */

/** src/remindersPage.tsx inSmart, on stamps. `now` is the Prague wall time. */
function inSmart(view: string, r: Row, now: string): boolean {
  if (view === 'completed') return !!r.doneAt
  if (r.doneAt) return false
  if (view === 'today') return !!r.remindAt && String(r.remindAt).slice(0, 10) <= now.slice(0, 10)
  if (view === 'scheduled') return !!r.remindAt
  if (view === 'flagged') return !!r.flagged
  return true
}
/** page byTime */
const byTime = (a: Row, b: Row) => String(a.remindAt ?? '9').localeCompare(String(b.remindAt ?? '9')) || a.createdAt - b.createdAt

export function reminderLine(b: Blob, r: Row, now: string): Row {
  const l = effLists(b).find((x) => x.id === r.listId)
  const o: Row = { id: r.id, title: r.title, list: l?.name ?? '(missing list)', listId: r.listId }
  if (r.notes) o.notes = r.notes
  if (r.remindAt) { o.remindAt = r.remindAt; if (!r.doneAt && r.remindAt < now) o.overdue = true }
  if (r.repeat) o.repeat = r.repeat
  if (r.flagged) o.flagged = true
  if (r.doneAt) o.completedAt = new Date(r.doneAt).toISOString()
  return o
}

export interface ListRemindersInput { list?: string; view?: string; query?: string; limit?: number; include_completed?: boolean }

/** The page's views. No view: open reminders (plus completed ones if include_completed). */
export function listReminders(b: Blob, i: ListRemindersInput, at = new Date()): Row {
  const now = nowStamp(at)
  if (i.view !== undefined && !SMART_VIEWS.includes(i.view)) throw new McError(`view must be one of ${SMART_VIEWS.join(', ')}.`)
  const all = arr(b, 'reminders')
  const counts = Object.fromEntries(SMART_VIEWS.map((v) => [v, all.filter((r) => inSmart(v, r, now)).length]))
  let rows = all.filter((r) => (i.view ? inSmart(i.view, r, now) || (i.view === 'all' && i.include_completed && !!r.doneAt) : (!r.doneAt || !!i.include_completed)))
  if (i.list) { const l = findList(b, i.list); rows = rows.filter((r) => r.listId === l.id) }
  const q = fold(i.query ?? '')
  if (q) rows = rows.filter((r) => fold(`${r.title} ${r.notes ?? ''}`).includes(q))
  rows = [...rows].sort(i.view === 'completed' ? (a, c) => (c.doneAt ?? 0) - (a.doneAt ?? 0) : byTime)
  const limit = i.limit ?? 100
  return { now, counts, count: rows.length, shown: Math.min(rows.length, limit), reminders: rows.slice(0, limit).map((r) => reminderLine(b, r, now)) }
}
