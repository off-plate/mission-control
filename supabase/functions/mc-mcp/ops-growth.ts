/* GROWTH: habits, quitting habits, routines, slips, amount and times habits.
   Pure logic on the state blob. NO Deno, NO network (the Node tests import this file).

   Every operation is a port of the app's own store function, named beside it:
     src/store/growth.ts  (markDayOn, syncRoutineFromHabits, applyRoutine, logCount, logAmount,
                           logSlipOn, addHabit, updateHabit, deleteHabit, the routine functions)
     src/types/habits.ts  (the rules: routineComplete, requiredSteps, dueOn, streaks, quit maths)
     src/util.ts          (period keys, week arithmetic)
   tools/mcp-growth-test.mjs runs the REAL useGrowthSlice hook on the same starting state and
   compares the result row for row, so "faithful" is checked, not claimed.

   Two things differ from the app on purpose:
   - the app's functions read React state captured at the start of an event. Here every step reads
     the live blob, so a routine tick that touches the habit log twice cannot overwrite itself.
   - dates are Prague's (ops.dateKey), not the browser's.

   What is REFUSED instead of half-done: quit habits ticked as if they were builds, habits kept by
   focus minutes, gated habits (the typing test), alternatives without a choice, goals attached to a
   routine being deleted, and any call that would remove more than one row of a collection at once
   (commit.ts' safety stop; the refusal says what to do instead). */

import { McError, arr, bury, dateKey, ensure, fold, isDate, newId, pick, weekdayIndex, type Blob, type Ref, type Row } from './ops.ts'

/* ============================ dates and periods ============================= */

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const mondayOf = (day: string): string => addDays(day, -weekdayIndex(day))
const inThisWeek = (day: string): boolean => mondayOf(day) === mondayOf(dateKey())
/** src/util.ts dayOfWeekKey: the date of weekday i (Mon=0) in the current week. */
export const dayOfWeekKey = (i: number): string => addDays(mondayOf(dateKey()), i)

/** src/util.ts isoWeekKey, on a date string instead of a local Date. */
export function isoWeekKeyOf(day: string): string {
  const t = new Date(`${day}T00:00:00Z`)
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
/** src/util.ts periodKeyFor. */
export function periodKeyFor(cadence: string, day = dateKey()): string {
  if (cadence === 'weekly') return isoWeekKeyOf(day)
  if (cadence === 'monthly') return day.slice(0, 7)
  return day
}
/** src/util.ts habitPeriodRange. */
export function periodRange(per: 'day' | 'week' | 'month', day = dateKey()): { from: string; to: string } {
  if (per === 'day') return { from: day, to: day }
  if (per === 'week') { const m = mondayOf(day); return { from: m, to: addDays(m, 6) } }
  const [y, mo] = day.split('-').map(Number)
  return { from: `${day.slice(0, 7)}-01`, to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }
}

const nowIso = (): string => new Date().toISOString()
let uniq = 0
/** A suffix that differs between two rows made in the same millisecond (the app uses performance.now()). */
const tag = (): string => `${Date.now()}${(uniq++).toString(36)}`
const clean = <T extends Row>(o: T): T => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o }

/* ============================ log rows and graveyard ========================= */

/** src/sync-merge.ts LOG_KEYS / ENTITY_KEYS. ops.rowKey only knows the entity form. */
export function logKey(field: string, r: Row): string {
  switch (field) {
    case 'habitLog': return `habitLog:${r.habitId}|${r.day}|${r.src ?? ''}`
    case 'routineLog': return `routineLog:${r.routineId}|${r.periodKey}|${r.run ?? 0}|${r.day}`
    case 'stepLog': return `stepLog:${r.routineId}|${r.stepId}|${r.at ?? r.day}`
    case 'stepTicks': return `stepTicks:${r.routineId}|${r.stepId}|${r.day}`
    case 'slips': return `slips:${r.habitId}|${r.day}`
    default: return `${field}:${String(r.id)}`
  }
}

/** src/store/graveyard.ts digUp: a dated opposite of a tombstone, not a removal. */
export function digUp(b: Blob, ...keys: string[]): void {
  if (!keys.length) return
  const now = Date.now()
  const g: Row[] = Array.isArray(b.graveyard) ? b.graveyard : []
  const drop = new Set(keys)
  b.graveyard = [...g.filter((t) => !drop.has(t.k)), ...keys.map((k) => ({ k, at: now, undone: true }))].slice(-900)
}

/** growth.ts `tracked`: replace a log with `next`, bury what left it and dig up what entered it. */
function setLog(b: Blob, field: string, next: Row[]): void {
  const prev = arr(b, field)
  if (!Array.isArray(b[field]) && !next.length) return
  const was = new Set(prev.map((r) => logKey(field, r)))
  const now = new Set(next.map((r) => logKey(field, r)))
  const gone = [...was].filter((k) => !now.has(k))
  const added = [...now].filter((k) => !was.has(k))
  b[field] = next
  if (gone.length) bury(b, ...gone)
  if (added.length) digUp(b, ...added)
}

/** commit.ts allows a call to remove at most one row per collection. Check it here so the refusal can
 *  say what to do, instead of a bare "safety stop". Throws before anything is written. */
function lengths(b: Blob): Record<string, number> {
  const o: Record<string, number> = {}
  for (const [k, v] of Object.entries(b)) if (Array.isArray(v)) o[k] = v.length
  return o
}
function guarded<T>(b: Blob, what: string, fn: () => T): T {
  const before = lengths(b)
  const out = fn()
  for (const [k, n] of Object.entries(before)) {
    const now = arr(b, k).length
    if (now < n - 1) {
      throw new McError(`${what} would remove ${n - now} rows from "${k}" at once. This connector removes at most one record per list in a single change, so nothing was changed. Undo it in smaller steps (one habit or one routine step at a time), or do it in the app.`)
    }
  }
  return out
}

/* ============================ the rules (src/types/habits.ts) ================= */

export const TYPING_TARGET_WPM = 75
const live = (b: Blob) => arr(b, 'habits').filter((h) => !h.archivedAt)
const liveRoutines = (b: Blob) => arr(b, 'routines').filter((r) => !r.archivedAt)
const isQuit = (h: Row) => h.kind === 'break'
/** isCounted */
export const isCounted = (h: Row): boolean => h.kind === 'measured' && h.measure === 'times'
export const countTarget = (h: Row): number => Math.max(1, h.targetCount ?? 1)
/** kept by the clock: a focus rule, or a measured habit that counts minutes (hkroom 'auto'). */
export const isAuto = (h: Row): boolean => h.auto?.from === 'focus' || h.source === 'focus' || (h.kind === 'measured' && h.measure !== 'times')
/** hkroom.tsx's order: quit, amount, auto, count, otherwise a plain tick. */
export const trackOf = (h: Row): 'quit' | 'amount' | 'auto' | 'count' | 'check' =>
  isQuit(h) ? 'quit' : h.measure === 'amount' ? 'amount' : isAuto(h) ? 'auto' : isCounted(h) ? 'count' : 'check'
/** requiredSteps / routineComplete / routineProgress */
export const requiredSteps = (r: Row): Row[] => { const need = (r.steps ?? []).filter((s: Row) => !s.optional); return need.length ? need : (r.steps ?? []) }
export const routineComplete = (r: Row, key: string): boolean =>
  r.periodKey === key && (r.steps ?? []).length > 0 && requiredSteps(r).every((s) => (r.doneStepIds ?? []).includes(s.id))
export const routineProgress = (r: Row) => { const need = requiredSteps(r); return { done: need.filter((s) => (r.doneStepIds ?? []).includes(s.id)).length, total: need.length } }
/** stepLocked: the typing step of the morning routine is earned at 75 WPM. */
export const stepLocked = (r: Row, stepId: string): boolean => stepId === 'mr4' && (r.stepData?.mr4 ?? 0) < TYPING_TARGET_WPM
export const habitGate = (h: Row) => (h.gatedBy === 'typing-wpm' ? { unit: 'WPM', target: TYPING_TARGET_WPM } : null)
export const habitStepKey = (h: Row) => (h.srcStepId ? { routineId: h.folderId ?? h.id, stepId: h.srcStepId } : null)
export function habitNumberOn(stepLog: Row[], h: Row, day: string): number | null {
  const key = habitStepKey(h); if (!key) return null
  const runs = stepLog.filter((e) => e.routineId === key.routineId && e.stepId === key.stepId && e.day === day)
  return runs.length ? Math.max(...runs.map((e) => e.value)) : null
}
export const habitLocked = (h: Row, stepLog: Row[], day: string): boolean => {
  const g = habitGate(h); return !!g && (habitNumberOn(stepLog, h, day) ?? 0) < g.target
}
export const habitTarget = (h: Row): number =>
  h.frequency === 'weekdays' ? 5 : h.frequency === 'weekly' || h.frequency === 'monthly' ? 1
    : h.frequency === 'times-per-week' ? Math.max(1, Math.min(7, h.targetPerWeek ?? 3)) : 7
const keptDaysIn = (log: Row[], id: string, from: string, to: string) => new Set(log.filter((t) => t.habitId === id && t.day >= from && t.day <= to).map((t) => t.day))
export const countIn = (log: Row[], id: string, from: string, to: string): number => log.filter((t) => t.habitId === id && t.day >= from && t.day <= to).length
export function keptThisPeriod(h: Row, log: Row[], day = dateKey()): boolean {
  if (h.frequency !== 'weekly' && h.frequency !== 'monthly') return false
  const r = periodRange(h.frequency === 'monthly' ? 'month' : 'week', day)
  return keptDaysIn(log, h.id, r.from, r.to).size > 0
}
export function dueOn(h: Row, weekdayIdx: number, log: Row[], day = dateKey()): boolean {
  if (h.paused || h.kind === 'break') return false
  if (h.frequency === 'weekdays' && weekdayIdx >= 5) return false
  if ((h.frequency === 'weekly' || h.frequency === 'monthly') && keptThisPeriod(h, log, day)) return false
  return true
}
export function currentStreak(log: Row[], id: string, today = dateKey()): number {
  const kept = new Set(log.filter((t) => t.habitId === id).map((t) => t.day))
  let d = kept.has(today) ? today : addDays(today, -1)
  let n = 0
  while (kept.has(d)) { n++; d = addDays(d, -1) }
  return n
}
export function bestStreak(log: Row[], id: string): number {
  const days = [...new Set(log.filter((t) => t.habitId === id).map((t) => t.day))].sort()
  let best = 0, run = 0, prev = ''
  for (const day of days) {
    run = prev && day === addDays(prev, 1) ? run + 1 : 1
    prev = day
    if (run > best) best = run
  }
  return best
}
const slipDays = (slips: Row[], id: string) => new Set(slips.filter((s) => s.habitId === id).map((s) => s.day))
export function daysClean(h: Row, slips: Row[], today = dateKey()): number | null {
  if (!isQuit(h)) return null
  const last = [...slipDays(slips, h.id)].sort().pop()
  const from = last && h.quitSince && last > h.quitSince ? last : h.quitSince
  if (!from) return null
  return Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000))
}
export function bestCleanRun(h: Row, slips: Row[], today = dateKey()): number {
  if (!isQuit(h) || !h.quitSince) return 0
  const slipped = slipDays(slips, h.id)
  let best = 0, run = 0
  for (let cur = h.quitSince; cur <= today; cur = addDays(cur, 1)) {
    if (slipped.has(cur)) run = 0
    else if (++run > best) best = run
  }
  return best
}
export const slipCount = (h: Row, slips: Row[]): number => [...slipDays(slips, h.id)].filter((d) => !h.quitSince || d >= h.quitSince).length

/* ============================ routines: roll, steps, sync ===================== */

/** What the app's loader does to a routine row when its period has changed (store/growth.ts seededRoutines):
 *  a new period starts nothing. Done on the stored row only when the period really differs. */
export function rollRoutine(r: Row, day = dateKey()): Row {
  const key = periodKeyFor(r.cadence, day)
  if (r.periodKey !== key) {
    Object.assign(r, { doneStepIds: [], stepData: {}, stepChoice: {}, run: 0, periodKey: key })
    delete r.startedAt
  }
  return r
}
/** The same view without writing (for reads). */
const rolled = (r: Row): Row => { const o = JSON.parse(JSON.stringify(r)); return rollRoutine(o) }

const replaceRoutine = (b: Blob, next: Row): void => {
  const cur = arr(b, 'routines').find((x) => x.id === next.id)
  if (!cur) return
  for (const k of Object.keys(cur)) delete cur[k] // in place: callers holding the row keep a live one
  Object.assign(cur, clean(next))
}
const stamped = (r: Row): Row => ({ ...r, startedAt: (r.doneStepIds ?? []).length === 0 ? undefined : (r.startedAt ?? nowIso()) })

/** growth.ts markSteps: one dated row per ticked step, today only. */
function markSteps(b: Blob, routineId: string, stepIds: string[], on: boolean): void {
  if (!stepIds.length) return
  const day = dateKey()
  const rest = arr(b, 'stepTicks').filter((t) => !(t.routineId === routineId && t.day === day && stepIds.includes(t.stepId)))
  setLog(b, 'stepTicks', on ? [...rest, ...stepIds.map((stepId) => ({ routineId, stepId, day }))] : rest)
}

/** growth.ts syncStepHabits */
function syncStepHabits(b: Blob, changes: { habitId: string; src: string; on: boolean; exclusive?: boolean }[]): void {
  if (!changes.length) return
  const day = dateKey()
  let next = arr(b, 'habitLog')
  for (const c of changes) {
    next = c.exclusive
      ? next.filter((t) => !(t.habitId === c.habitId && t.day === day))
      : next.filter((t) => !(t.habitId === c.habitId && t.day === day && t.src === c.src))
    if (c.on) next = [...next, { habitId: c.habitId, day, src: c.src, at: nowIso() }]
  }
  setLog(b, 'habitLog', next)
  const idx = weekdayIndex(day)
  const held = new Map(changes.map((c) => [c.habitId, next.some((t) => t.habitId === c.habitId && t.day === day)]))
  for (const h of arr(b, 'habits')) if (held.has(h.id) && Array.isArray(h.days)) h.days = h.days.map((d: boolean, i: number) => (i === idx ? held.get(h.id)! : d))
}

/** growth.ts applyRoutine: change a routine and re-derive its habits and its record from the result. */
function applyRoutine(b: Blob, routineId: string, change: (r: Row) => Row): void {
  const cur = arr(b, 'routines').find((x) => x.id === routineId)
  if (!cur) return
  rollRoutine(cur)
  const before = JSON.parse(JSON.stringify(cur)) as Row
  const after = change(JSON.parse(JSON.stringify(before)))
  const key = periodKeyFor(after.cadence)
  const wasComplete = routineComplete(before, periodKeyFor(before.cadence))
  const isComplete = routineComplete(after, key)
  const today = dateKey()
  const completedOn = isComplete ? (wasComplete ? before.completedOn ?? today : today) : null
  replaceRoutine(b, { ...after, periodKey: key, completedOn })
  const habits = arr(b, 'habits')
  syncStepHabits(b, (after.steps ?? []).flatMap((st: Row) => {
    const hid = st.habitId ?? `h-${routineId}-${st.id}`
    if (!habits.some((h) => h.id === hid)) return []
    const was = (before.doneStepIds ?? []).includes(st.id)
    const is = (after.doneStepIds ?? []).includes(st.id)
    return was === is ? [] : [{ habitId: hid, src: `${routineId}:${st.id}#${after.run ?? 0}`, on: is, exclusive: !st.habitId }]
  }))
  if (wasComplete === isComplete) return
  const run = after.run ?? 0
  const earlier = arr(b, 'routineLog').some((r) => r.routineId === routineId && r.periodKey === key && (r.run ?? 0) !== run)
  const without = arr(b, 'routineLog').filter((r) => !(r.routineId === routineId && r.periodKey === key && (r.run ?? 0) === run))
  setLog(b, 'routineLog', isComplete ? [...without, { routineId, day: today, periodKey: key, run, at: nowIso() }] : without)
  if (!before.habitId) return
  const clearDay = before.completedOn && mondayOf(before.completedOn) === mondayOf(today) ? before.completedOn : today
  markDayOn(b, before.habitId, isComplete ? today : clearDay, isComplete || earlier)
}

/** growth.ts routineOfHabit */
function routineOfHabit(b: Blob, h: Row | undefined): string | undefined {
  if (!h) return undefined
  if (h.folderId && h.srcStepId) return h.folderId
  return liveRoutines(b).find((r) => (r.steps ?? []).some((st: Row) => st.habitId === h.id))?.id
}

/** growth.ts syncRoutineFromHabits: a tick on a habit settles the routine card that owns it. */
function syncRoutineFromHabits(b: Blob, routineId: string): void {
  const r = arr(b, 'routines').find((x) => x.id === routineId)
  if (!r) return
  rollRoutine(r)
  const day = dateKey()
  const habits = arr(b, 'habits')
  const kept = (hid: string) => arr(b, 'habitLog').some((t) => t.habitId === hid && t.day === day)
  const doneStepIds = (r.steps ?? []).filter((st: Row) => {
    const hid = st.habitId ?? `h-${routineId}-${st.id}`
    return habits.some((x) => x.id === hid) ? kept(hid) : (r.doneStepIds ?? []).includes(st.id)
  }).map((st: Row) => st.id)
  markSteps(b, routineId, (r.steps ?? []).map((s: Row) => s.id).filter((id: string) => !doneStepIds.includes(id)), false)
  markSteps(b, routineId, doneStepIds, true)
  const key = periodKeyFor(r.cadence)
  const after = { ...r, doneStepIds, startedAt: doneStepIds.length === 0 ? undefined : (r.startedAt ?? nowIso()) }
  const wasComplete = routineComplete(r, periodKeyFor(r.cadence))
  const isComplete = routineComplete(after, key)
  replaceRoutine(b, { ...after, periodKey: key, completedOn: isComplete ? (wasComplete ? r.completedOn ?? day : day) : null })
  if (wasComplete === isComplete) return
  const run = r.run ?? 0
  const without = arr(b, 'routineLog').filter((x) => !(x.routineId === routineId && x.periodKey === key && (x.run ?? 0) === run))
  setLog(b, 'routineLog', isComplete ? [...without, { routineId, day, periodKey: key, run, at: nowIso() }] : without)
  if (!r.habitId) return
  const hid = r.habitId
  const rest = arr(b, 'habitLog').filter((t) => !(t.habitId === hid && t.day === day))
  setLog(b, 'habitLog', isComplete ? [...rest, { habitId: hid, day, at: nowIso() }] : rest)
  const i = weekdayIndex(day)
  for (const x of habits) if (x.id === hid && Array.isArray(x.days)) x.days = x.days.map((d: boolean, k: number) => (k === i ? isComplete : d))
}

/* ============================ habits: ticking ================================= */

/** growth.ts markDayOn: tick or untick ONE DATE of one habit, in the durable log and the week cache. */
function markDayOn(b: Blob, habitId: string, day: string, value: boolean): void {
  const log = arr(b, 'habitLog')
  const gone = log.filter((t) => t.habitId === habitId && t.day === day)
  const without = log.filter((t) => !(t.habitId === habitId && t.day === day))
  const next = value ? [...without, clean({ habitId, day, at: day === dateKey() ? nowIso() : undefined })] : without
  setLog(b, 'habitLog', next)
  if (value) digUp(b, logKey('habitLog', { habitId, day }))
  else if (gone.length) bury(b, ...gone.map((t) => logKey('habitLog', { habitId, day: t.day, src: t.src })))
  if (inThisWeek(day)) {
    const i = weekdayIndex(day)
    const h = arr(b, 'habits').find((x) => x.id === habitId)
    if (h && Array.isArray(h.days)) h.days = h.days.map((d: boolean, k: number) => (k === i ? value : d))
  }
  const h = arr(b, 'habits').find((x) => x.id === habitId)
  const rid = routineOfHabit(b, h)
  if (rid && day === dateKey()) syncRoutineFromHabits(b, rid)
}

const habitName = (h: Row) => String(h.name ?? '')
export const findHabit = (b: Blob, ref: Ref): Row => pick(live(b), ref, 'habit', habitName)
export const findRoutine = (b: Blob, ref: Ref): Row => pick(liveRoutines(b), ref, 'routine', (r) => String(r.title ?? ''))
/** The routine whose OWN habit this is, when that routine has steps (the app locks such a habit to the routine). */
const drivenBy = (b: Blob, h: Row): Row | undefined => liveRoutines(b).find((r) => r.habitId === h.id && (r.steps ?? []).length > 0)

function checkDay(day: string): void {
  if (!isDate(day)) throw new McError(`day must be YYYY-MM-DD, got "${day}".`)
  if (day > dateKey()) throw new McError('A habit cannot be ticked for a day that has not happened yet.')
}
const keptOn = (b: Blob, id: string, day: string) => arr(b, 'habitLog').some((t) => t.habitId === id && t.day === day)

export interface TickOpts { day?: string; done?: boolean; alt?: string }

/** assistant `habit` -> markHabitDay / markHabitOn; with `alt`: pickHabitAlt. */
export function tickHabit(b: Blob, ref: Ref, opts: TickOpts = {}): { id: string; text: string } {
  const h = findHabit(b, ref)
  const today = dateKey()
  const day = opts.day ?? today
  checkDay(day)
  const on = opts.done !== false
  const name = h.name
  const track = trackOf(h)
  if (track === 'quit') throw new McError(`"${name}" is a quit habit. Every day since it started counts as kept on its own; the only thing to record is a slip (log_slip), and a slip taken back is undo_slip.`)
  if (track === 'amount') throw new McError(`"${name}" is an amount habit (${h.unit ?? 'units'}). Add what he did with log_habit_amount, take the last entry back with remove_habit_amount.`)
  if (track === 'auto') throw new McError(`"${name}" is kept by the clock (it fills itself from focus minutes), so there is nothing to tick. list_habits shows today's progress.`)
  if (track === 'count') throw new McError(`"${name}" is a counted habit (${countTarget(h)} per ${h.per ?? 'day'}). Log one with habit_count (value 1), take one back with value -1.`)
  if (h.paused) throw new McError(`"${name}" is paused. Resume it with pause_habit first.`)
  const owner = drivenBy(b, h)

  if (opts.alt !== undefined) {
    if (!h.alts?.length) throw new McError(`"${name}" has no alternatives to pick from.`)
    if (day !== today) throw new McError('An alternative can only be picked for today.')
    const alt = pick(h.alts, { id: h.alts.some((a: Row) => a.id === opts.alt) ? opts.alt : undefined, title: opts.alt }, 'alternative', (a) => String(a.title ?? ''))
    return pickHabitAlt(b, h, alt, opts.done)
  }
  if (owner) {
    if (day >= today) throw new McError(`"${name}" is the streak of the routine "${owner.title}", set by its steps. Tick the steps (routine_step) or finish the routine (routine_done). A past day can still be corrected here.`)
    return assertRoutineOn(b, h, owner, day, opts.done)
  }
  if (day === today && habitGate(h) && habitLocked(h, arr(b, 'stepLog'), day)) {
    const g = habitGate(h)!
    throw new McError(`"${name}" is locked until today's number reaches ${g.target} ${g.unit}. Log his real result with habit_count; it keeps the day itself when it passes.`)
  }
  if (day === today && h.alts?.length) {
    throw new McError(`"${name}" is answered by picking one of its alternatives, not by a tick. Call again with alt set to one of: ${h.alts.map((a: Row) => `${a.id} (${a.title})`).join(', ')}. A past day can be ticked directly.`)
  }
  const has = keptOn(b, h.id, day)
  if (on && has) return { id: h.id, text: `"${name}" was already kept on ${day}.` }
  if (!on && !has) return { id: h.id, text: `"${name}" was not kept on ${day}.` }
  guarded(b, `Unticking "${name}" on ${day}`, () => markDayOn(b, h.id, day, on))
  const rid = routineOfHabit(b, h)
  const r = rid ? arr(b, 'routines').find((x) => x.id === rid) : undefined
  return { id: h.id, text: `${on ? 'Kept' : 'Unticked'} "${name}" on ${day}.${r && day === today ? ` It is a step of "${r.title}", so that routine now reads ${routineProgress(rolled(r)).done} of ${routineProgress(rolled(r)).total}.` : ''}` }
}

/** growth.ts pickHabitAlt: doing either answer keeps the habit; picking the same one again clears it. */
function pickHabitAlt(b: Blob, h: Row, alt: Row, done?: boolean): { id: string; text: string } {
  const day = dateKey()
  const src = `alt:${alt.id}`
  const log = arr(b, 'habitLog')
  const isOn = log.some((t) => t.habitId === h.id && t.day === day && t.src === src)
  if (done === true && isOn) return { id: h.id, text: `"${h.name}" was already kept today with "${alt.title}".` }
  if (done === false && !isOn) return { id: h.id, text: `"${h.name}" was not kept today with "${alt.title}".` }
  const mine = new Set(h.alts.map((a: Row) => `alt:${a.id}`))
  const rest = log.filter((t) => !(t.habitId === h.id && t.day === day && !!t.src && mine.has(t.src)))
  const next = isOn ? rest : [...rest, { habitId: h.id, day, src, at: nowIso() }]
  guarded(b, `Taking back "${alt.title}"`, () => {
    setLog(b, 'habitLog', next)
    const i = weekdayIndex(day)
    const held = next.some((t) => t.habitId === h.id && t.day === day)
    h.days = (h.days ?? [false, false, false, false, false, false, false]).map((d: boolean, k: number) => (k === i ? held : d))
    if (h.folderId && h.srcStepId) syncRoutineFromHabits(b, h.folderId)
  })
  return { id: h.id, text: isOn ? `Took back "${alt.title}" on "${h.name}".` : `Kept "${h.name}" today with "${alt.title}".` }
}

/** growth.ts assertRoutineOn (hand-correcting a PAST day of a routine's own habit): writes the habit row and the routine's finish. */
function assertRoutineOn(b: Blob, h: Row, r: Row, day: string, done?: boolean): { id: string; text: string } {
  const has = keptOn(b, h.id, day)
  if (done === true && has) return { id: h.id, text: `"${h.name}" was already kept on ${day}.` }
  if (done === false && !has) return { id: h.id, text: `"${h.name}" was not kept on ${day}.` }
  guarded(b, `Correcting "${h.name}" on ${day}`, () => {
    markDayOn(b, h.id, day, !has)
    const pk = r.cadence === 'weekly' ? isoWeekKeyOf(day) : r.cadence === 'monthly' ? day.slice(0, 7) : day
    setLog(b, 'routineLog', has
      ? arr(b, 'routineLog').filter((x) => !(x.routineId === r.id && x.day === day))
      : [...arr(b, 'routineLog'), { routineId: r.id, day, periodKey: pk, run: 0 }])
  })
  return { id: h.id, text: `${has ? 'Unticked' : 'Kept'} "${h.name}" on ${day} (and the "${r.title}" routine's record for that day).` }
}

/* ============================ counts, amounts, numbers ======================== */

/** assistant `habitCount`: a counted habit (one tap each), or the number a step habit records. */
export function habitCount(b: Blob, ref: Ref, value: number): { id: string; text: string } {
  const h = findHabit(b, ref)
  if (!Number.isFinite(value)) throw new McError('value must be a number.')
  if (habitStepKey(h)) return logHabitNumber(b, h, value)
  if (trackOf(h) !== 'count') throw new McError(`"${h.name}" is not counted: it is ${isQuit(h) ? 'a quit habit (log_slip)' : h.measure === 'amount' ? 'an amount habit (log_habit_amount)' : isAuto(h) ? 'fed by focus time' : 'ticked (tick_habit)'}.`)
  if (h.paused) throw new McError(`"${h.name}" is paused. Resume it first.`)
  const n = Math.round(value)
  if (n === 0) throw new McError('value must be a whole number other than 0 (1 = did it once, -1 = take one back).')
  if (n > 50) throw new McError('More than 50 in one go is almost certainly a typo. Log it in smaller pieces if it is real.')
  if (n < -1) throw new McError('Take back one at a time (value -1): this connector removes at most one record per change.')
  const day = dateKey()
  const idx = weekdayIndex(day)
  if (n < 0) {
    const mine = arr(b, 'habitLog').filter((t) => t.habitId === h.id && t.day === day)
    const last = mine[mine.length - 1]
    if (!last) return { id: h.id, text: `"${h.name}" has nothing logged today to take back.` }
    const log = arr(b, 'habitLog'); const at = log.lastIndexOf(last)
    const next = [...log.slice(0, at), ...log.slice(at + 1)]
    setLog(b, 'habitLog', next)
    h.days = (h.days ?? []).map((d: boolean, i: number) => (i === idx ? next.some((t) => t.habitId === h.id && t.day === day) : d))
    return { id: h.id, text: `Took one off "${h.name}" (${counted(b, h)}).` }
  }
  let next = arr(b, 'habitLog')
  for (let k = 0; k < n; k++) next = [...next, { habitId: h.id, day, src: `count#${tag()}`, at: nowIso() }]
  setLog(b, 'habitLog', next)
  h.days = (h.days ?? []).map((d: boolean, i: number) => (i === idx ? true : d))
  return { id: h.id, text: `Counted ${n} on "${h.name}" (${counted(b, h)}).` }
}
function counted(b: Blob, h: Row): string {
  const per = (h.per ?? 'day') as 'day' | 'week' | 'month'
  const r = periodRange(per)
  return `${countIn(arr(b, 'habitLog'), h.id, r.from, r.to)} of ${countTarget(h)} per ${per}`
}

/** growth.ts logHabitNumber: the number a routine-step habit records (e.g. typing WPM). */
function logHabitNumber(b: Blob, h: Row, value: number): { id: string; text: string } {
  const key = habitStepKey(h)!
  if (!(value > 0)) throw new McError('A recorded number has to be above 0.')
  if (h.paused) throw new McError(`"${h.name}" is paused. Resume it first.`)
  const day = dateKey()
  // setStepLog is the raw setter in the app: a number is appended, never tracked or buried.
  ensure(b, 'stepLog').push({ routineId: key.routineId, stepId: key.stepId, day, at: nowIso(), value })
  const rk = `${key.routineId}:${key.stepId}`
  const rec: Row = (b.records && typeof b.records === 'object') ? b.records : (b.records = {})
  if (value > (rec[rk] ?? 0)) rec[rk] = value
  const gate = habitGate(h)
  let kept = false
  if (!gate || value >= gate.target) {
    guarded(b, `Keeping "${h.name}"`, () => markDayOn(b, h.id, day, true))
    kept = true
  }
  return { id: h.id, text: `Logged ${value}${gate ? ` ${gate.unit}` : ''} on "${h.name}".${gate ? (kept ? ' That passes the gate, so today is kept.' : ` That is under the ${gate.target} ${gate.unit} needed, so today is not kept.`) : ' Today is kept.'}` }
}

const amountOn = (log: Row[], id: string, day: string) => log.filter((t) => t.habitId === id && t.day === day).reduce((a, t) => a + (t.v ?? 0), 0)

/** growth.ts logAmount */
export function logAmount(b: Blob, ref: Ref, amount: number): { id: string; text: string } {
  const h = findHabit(b, ref)
  if (h.measure !== 'amount') throw new McError(`"${h.name}" does not count an amount${isCounted(h) ? ' (it counts times: habit_count)' : ' (tick_habit)'}.`)
  if (!(amount > 0) || !Number.isFinite(amount)) throw new McError('The amount has to be above 0.')
  if (h.paused) throw new McError(`"${h.name}" is paused. Resume it first.`)
  const day = dateKey()
  const before = amountOn(arr(b, 'habitLog'), h.id, day)
  setLog(b, 'habitLog', [...arr(b, 'habitLog'), { habitId: h.id, day, src: `amt#${tag()}`, at: nowIso(), v: amount }])
  const idx = weekdayIndex(day)
  const total = before + amount
  h.days = (h.days ?? []).map((d: boolean, i: number) => (i === idx ? total >= (h.targetAmount ?? 1) : d))
  return { id: h.id, text: `Logged ${amount} ${h.unit ?? ''} on "${h.name}": ${total} of ${h.targetAmount ?? 1} today.` }
}

/** growth.ts removeAmount. Without `src`: the newest amount entry made today. */
export function removeAmount(b: Blob, ref: Ref, src?: string): { id: string; text: string } {
  const h = findHabit(b, ref)
  if (h.measure !== 'amount') throw new McError(`"${h.name}" does not count an amount.`)
  const log = arr(b, 'habitLog')
  const day = dateKey()
  const row = src ? log.find((t) => t.habitId === h.id && t.src === src) : [...log].reverse().find((t) => t.habitId === h.id && t.day === day && t.v != null)
  if (!row) throw new McError(src ? `"${h.name}" has no entry "${src}".` : `"${h.name}" has no amount logged today to take back.`)
  if (row.v == null) throw new McError('That row is not an amount entry. Nothing was removed.')
  const total = amountOn(log, h.id, day)
  setLog(b, 'habitLog', log.filter((t) => !(t.habitId === h.id && t.src === row.src)))
  if (row.day === day) {
    const idx = weekdayIndex(day)
    h.days = (h.days ?? []).map((d: boolean, i: number) => (i === idx ? total - (row.v ?? 0) >= (h.targetAmount ?? 1) : d))
  }
  return { id: h.id, text: `Took back ${row.v} ${h.unit ?? ''} (${row.day}) from "${h.name}".` }
}

/* ============================ quitting: slips ================================= */

/** growth.ts logSlipOn / logSlip: one row per day, appended. */
export function logSlip(b: Blob, ref: Ref, dayIn?: string): { id: string; text: string } {
  const h = pick(live(b).filter(isQuit), ref, 'quit habit', habitName)
  const day = dayIn ?? dateKey()
  checkDaySlip(day)
  if (h.quitSince && day < h.quitSince) throw new McError(`"${h.name}" started on ${h.quitSince}; he cannot have slipped before that.`)
  const slips = arr(b, 'slips')
  if (slips.some((s) => s.habitId === h.id && s.day === day)) return { id: h.id, text: `A slip on ${day} is already logged for "${h.name}".` }
  setLog(b, 'slips', [...slips, { habitId: h.id, day }])
  return { id: h.id, text: `Logged a slip on ${day} for "${h.name}". Clean days now: ${daysClean(h, arr(b, 'slips'))}; best run ${bestCleanRun(h, arr(b, 'slips'))}.` }
}
function checkDaySlip(day: string): void {
  if (!isDate(day)) throw new McError(`day must be YYYY-MM-DD, got "${day}".`)
  if (day > dateKey()) throw new McError('A slip cannot be logged for a day that has not happened yet.')
}
/** What the app's undo toast does for a slip (setSlips(before), tracked: the row is buried). */
export function undoSlip(b: Blob, ref: Ref, dayIn?: string): { id: string; text: string } {
  const h = pick(live(b).filter(isQuit), ref, 'quit habit', habitName)
  const day = dayIn ?? dateKey()
  checkDaySlip(day)
  const slips = arr(b, 'slips')
  if (!slips.some((s) => s.habitId === h.id && s.day === day)) return { id: h.id, text: `There is no slip on ${day} for "${h.name}".` }
  setLog(b, 'slips', slips.filter((s) => !(s.habitId === h.id && s.day === day)))
  return { id: h.id, text: `Took back the slip on ${day} for "${h.name}".` }
}

/* ============================ habits: add, edit, pause, archive =============== */

export interface AddHabitInput {
  name: string; space?: 'personal' | 'work'; daypart?: string; frequency?: string; perWeek?: number
  breaking?: boolean; quitSince?: string; startedOn?: string; dailyCost?: number
  track?: 'check' | 'count' | 'amount'; countTarget?: number; countPer?: 'day' | 'week' | 'month'
  unit?: string; targetAmount?: number; presets?: number[]
}
const FREQS = ['daily', 'weekdays', 'times-per-week', 'weekly', 'monthly']
const DAYPARTS = ['morning', 'noon', 'afternoon', 'evening']
const BACKFILL_MAX_DAYS = 366

function checkStart(day: string, label: string): void {
  if (!isDate(day)) throw new McError(`${label} must be YYYY-MM-DD, got "${day}".`)
  if (day > dateKey()) throw new McError(`${label} cannot be in the future.`)
  if (day < addDays(dateKey(), -BACKFILL_MAX_DAYS)) throw new McError(`${label} is more than ${BACKFILL_MAX_DAYS} days back. This connector will not write that many past days at once; use the latest date you are sure about, or do it in the app.`)
}

/** growth.ts backfillKept: "I have been keeping this since June" is written as days, up to yesterday. */
function backfillKept(b: Blob, habitId: string, from?: string, until?: string): void {
  const today = dateKey()
  const stop = until && until < today ? until : today
  if (!from || from >= stop) return
  const have = new Set(arr(b, 'habitLog').filter((t) => t.habitId === habitId).map((t) => t.day))
  const rows: Row[] = []
  for (let d = from; d < stop; d = addDays(d, 1)) if (!have.has(d)) rows.push({ habitId, day: d, src: 'since' })
  const filled = new Set(rows.map((r) => r.day))
  if (rows.length) setLog(b, 'habitLog', [...arr(b, 'habitLog'), ...rows])
  const h = arr(b, 'habits').find((x) => x.id === habitId)
  if (h) {
    h.filledSince = from
    if (Array.isArray(h.days)) h.days = h.days.map((v: boolean, i: number) => v || filled.has(dayOfWeekKey(i)))
  }
}

/** assistant `addHabit` -> growth.ts addHabit (+ the HabitKit sheet's count and amount shapes). */
export function addHabit(b: Blob, i: AddHabitInput): { id: string; text: string } {
  const name = (i.name ?? '').trim()
  if (!name) throw new McError('A habit needs a name.')
  if (name.length > 120) throw new McError('That name is over 120 characters.')
  if (live(b).some((h) => fold(habitName(h)) === fold(name))) throw new McError(`There is already a habit called "${name}". Edit that one, or pick a different name.`)
  const space = i.space ?? 'personal'
  const today = dateKey()
  const id = newId('h')
  let row: Row
  if (i.breaking) {
    for (const [k, v] of Object.entries({ frequency: i.frequency, per_week: i.perWeek, started_on: i.startedOn, track: i.track, daypart: i.daypart })) {
      if (v !== undefined) throw new McError(`A quit habit takes only a name, the day he stopped (quit_since) and a daily cost. "${k}" does not apply.`)
    }
    if (i.quitSince !== undefined) checkStart(i.quitSince, 'quit_since')
    row = clean({ id, space, name, frequency: 'daily', kind: 'break', dailyCost: i.dailyCost, quitSince: i.quitSince ?? today, days: [false, false, false, false, false, false, false], paused: false })
  } else {
    if (i.quitSince !== undefined || i.dailyCost !== undefined) throw new McError('quit_since and daily_cost are for a quit habit (breaking: true).')
    const track = i.track ?? 'check'
    if (i.frequency !== undefined && !FREQS.includes(i.frequency)) throw new McError(`frequency must be one of ${FREQS.join(', ')}.`)
    const frequency = i.frequency ?? (i.perWeek ? 'times-per-week' : 'daily')
    if (i.perWeek !== undefined) {
      if (frequency !== 'times-per-week') throw new McError('per_week only applies to frequency "times-per-week".')
      if (!Number.isInteger(i.perWeek) || i.perWeek < 1 || i.perWeek > 7) throw new McError('per_week must be a whole number from 1 to 7.')
    }
    if (i.daypart !== undefined && !DAYPARTS.includes(i.daypart)) throw new McError(`daypart must be one of ${DAYPARTS.join(', ')}.`)
    if (i.startedOn !== undefined) checkStart(i.startedOn, 'started_on')
    const x: Row = { id, space, name, daypart: i.daypart, frequency, targetPerWeek: frequency === 'times-per-week' ? i.perWeek : undefined }
    if (track === 'check') {
      for (const [k, v] of Object.entries({ count_target: i.countTarget, count_per: i.countPer, unit: i.unit, target_amount: i.targetAmount, presets: i.presets })) if (v !== undefined) throw new McError(`"${k}" does not apply to a plain tick habit. Set track to "count" or "amount".`)
      x.kind = 'build'
    } else if (track === 'count') {
      for (const [k, v] of Object.entries({ unit: i.unit, target_amount: i.targetAmount, presets: i.presets })) if (v !== undefined) throw new McError(`"${k}" does not apply to a counted habit.`)
      x.kind = 'measured'; x.measure = 'times'; x.per = i.countPer ?? 'day'
      x.targetCount = Math.max(1, Math.round(i.countTarget ?? 1))
    } else {
      if (i.countTarget !== undefined || i.countPer !== undefined) throw new McError('count_target and count_per do not apply to an amount habit.')
      if (!i.unit?.trim()) throw new McError('An amount habit needs a unit (ml, pages, minutes ...): say what one log is measured in.')
      if (!(i.targetAmount! > 0)) throw new McError('An amount habit needs a target_amount above 0: how much a day asks for.')
      x.kind = 'build'; x.measure = 'amount'; x.unit = i.unit.trim(); x.targetAmount = i.targetAmount
      if (i.presets?.length) x.presets = i.presets.filter((p) => p > 0)
    }
    x.startedOn = i.startedOn ?? today
    x.filledSince = i.startedOn ?? today
    x.days = [false, false, false, false, false, false, false]
    x.paused = false
    row = clean(x)
  }
  ensure(b, 'habits').push(row)
  if (!i.breaking) backfillKept(b, id, i.startedOn)
  const filled = arr(b, 'habitLog').filter((t) => t.habitId === id && t.src === 'since').length
  return { id, text: i.breaking
    ? `Now tracking: quitting "${name}" since ${row.quitSince}.`
    : `Added a habit: "${name}" (${row.kind === 'measured' ? `${countTarget(row)} per ${row.per}` : row.measure === 'amount' ? `${row.targetAmount} ${row.unit} a day` : row.frequency}).${filled ? ` ${filled} earlier days since ${i.startedOn} were marked kept.` : ''}` }
}

export interface EditHabitInput { newName?: string; frequency?: string; perWeek?: number; daypart?: string | null; quitSince?: string; startedOn?: string; countTarget?: number; countPer?: 'day' | 'week' | 'month'; dailyCost?: number }

/** assistant `editHabit` -> updateHabit (name, frequency, targetPerWeek, quitSince, startedOn, per, targetCount) and setLook (daypart, dailyCost). */
export function editHabit(b: Blob, ref: Ref, p: EditHabitInput): { id: string; text: string } {
  const h = findHabit(b, ref)
  const owner = drivenBy(b, h)
  const did: string[] = []
  const patch: Row = {}
  if (p.newName !== undefined) {
    const n = p.newName.trim()
    if (!n) throw new McError('A habit name cannot be empty.')
    if (owner) throw new McError(`"${h.name}" is the streak of the routine "${owner.title}", so its name follows the routine. Rename the routine (edit_routine).`)
    if (live(b).some((x) => x.id !== h.id && fold(habitName(x)) === fold(n))) throw new McError(`Another habit is already called "${n}".`)
    patch.name = n; did.push(`name "${n}"`)
  }
  if (p.frequency !== undefined || p.perWeek !== undefined) {
    if (owner) throw new McError(`The "${owner.title}" routine keeps this habit, so its frequency follows the routine.`)
    if (p.frequency !== undefined && !FREQS.includes(p.frequency)) throw new McError(`frequency must be one of ${FREQS.join(', ')}.`)
    const f = p.frequency ?? h.frequency
    if (p.perWeek !== undefined) {
      if (f !== 'times-per-week') throw new McError('per_week only applies to frequency "times-per-week".')
      if (!Number.isInteger(p.perWeek) || p.perWeek < 1 || p.perWeek > 7) throw new McError('per_week must be a whole number from 1 to 7.')
      patch.targetPerWeek = p.perWeek; did.push(`${p.perWeek} a week`)
    }
    if (p.frequency !== undefined) { patch.frequency = p.frequency; did.push(p.frequency) }
  }
  if (p.countTarget !== undefined || p.countPer !== undefined) {
    if (!isCounted(h)) throw new McError(`"${h.name}" is not a counted habit, so it has no count target.`)
    if (p.countTarget !== undefined) { patch.targetCount = Math.max(1, Math.round(p.countTarget)); did.push(`${patch.targetCount} per period`) }
    if (p.countPer !== undefined) { patch.per = p.countPer; did.push(`per ${p.countPer}`) }
  }
  if (p.quitSince !== undefined) {
    if (!isQuit(h)) throw new McError(`"${h.name}" is not a quit habit.`)
    checkStart(p.quitSince, 'quit_since'); patch.quitSince = p.quitSince; did.push(`stopped on ${p.quitSince}`)
  }
  if (p.dailyCost !== undefined) {
    if (!isQuit(h)) throw new McError('daily_cost is for a quit habit.')
    if (!(p.dailyCost >= 0)) throw new McError('daily_cost must be 0 or more.')
    patch.dailyCost = p.dailyCost; did.push(`${p.dailyCost} a day`)
  }
  if (p.startedOn !== undefined) {
    if (isQuit(h)) throw new McError('A quit habit runs from quit_since, not started_on.')
    checkStart(p.startedOn, 'started_on'); patch.startedOn = p.startedOn; did.push(`started ${p.startedOn}`)
  }
  if (p.daypart !== undefined) {
    if (p.daypart !== null && !DAYPARTS.includes(p.daypart)) throw new McError(`daypart must be one of ${DAYPARTS.join(', ')}, or null for any time.`)
    did.push(p.daypart ?? 'any time of day')
  }
  if (!did.length) throw new McError('Nothing to change: pass at least one field.')
  const had = h.filledSince
  Object.assign(h, patch)
  if (p.daypart !== undefined) { if (p.daypart === null) delete h.daypart; else h.daypart = p.daypart; h.partSet = true } // setLook
  // Moving the start EARLIER claims only the days it reached back over; later never deletes a logged day.
  if (p.startedOn && p.startedOn !== had) backfillKept(b, h.id, p.startedOn, had)
  return { id: h.id, text: `Updated "${h.name}": ${did.join(', ')}.` }
}

/** growth.ts togglePauseHabit */
export function pauseHabit(b: Blob, ref: Ref, paused?: boolean): { id: string; text: string } {
  const h = findHabit(b, ref)
  const next = paused ?? !h.paused
  if (next === !!h.paused) return { id: h.id, text: `"${h.name}" was already ${next ? 'paused' : 'running'}.` }
  h.paused = next
  return { id: h.id, text: `${next ? 'Paused' : 'Resumed'}: "${h.name}".` }
}

/** growth.ts deleteHabit: retired, not erased. */
export function archiveHabit(b: Blob, ref: Ref): { id: string; text: string } {
  const h = findHabit(b, ref)
  const own = liveRoutines(b).find((r) => r.habitId === h.id)
  if (own) throw new McError(`"${h.name}" is the streak of the routine "${own.title}" and goes with it. Delete the routine instead (delete_routine).`)
  h.archivedAt = dateKey()
  const seeds = ensure(b, 'removedSeeds') as unknown as string[]
  if (!seeds.includes(h.id)) seeds.push(h.id)
  return { id: h.id, text: `Archived "${h.name}". It is off his lists; its history stays. (Restoring is done in the app.)` }
}

/* ============================ routines ======================================== */

const freqForCadence = (c: string) => (c === 'weekly' ? 'weekly' : c === 'monthly' ? 'monthly' : c === 'prework' ? 'weekdays' : 'daily')
const CADENCES = ['daily', 'prework', 'weekly', 'monthly']

/** growth.ts addRoutine (+ addRoutineStep for each given step, as the assistant does). */
export function addRoutine(b: Blob, i: { title: string; cadence?: string; blurb?: string; daypart?: string; space?: 'personal' | 'work'; steps?: string[] }): { id: string; text: string } {
  const title = (i.title ?? '').trim()
  if (!title) throw new McError('A routine needs a title.')
  const cadence = i.cadence ?? 'daily'
  if (!CADENCES.includes(cadence)) throw new McError(`cadence must be one of ${CADENCES.join(', ')}.`)
  if (i.daypart !== undefined && !DAYPARTS.includes(i.daypart)) throw new McError(`daypart must be one of ${DAYPARTS.join(', ')}.`)
  if (liveRoutines(b).some((r) => fold(String(r.title)) === fold(title))) throw new McError(`There is already a routine called "${title}".`)
  const steps = (i.steps ?? []).map((s) => String(s).trim()).filter(Boolean)
  if (steps.length > 40) throw new McError('A routine takes at most 40 steps here.')
  const space = i.space ?? 'personal'
  const hid = newId('h'), rid = newId('r')
  ensure(b, 'habits').push(clean({
    id: hid, space, name: title, daypart: i.daypart, kind: 'build', frequency: freqForCadence(cadence),
    days: [false, false, false, false, false, false, false], paused: false, history: [],
  }))
  ensure(b, 'routines').push(clean({
    id: rid, space, title, cadence, blurb: i.blurb, steps: [], doneStepIds: [], habitId: hid, periodKey: periodKeyFor(cadence), stepData: {},
  }))
  for (const s of steps) addStep(b, rid, s)
  return { id: rid, text: `Made a new routine "${title}" (${cadence}${steps.length ? `, ${steps.length} steps` : ''}).` }
}

/** growth.ts updateRoutine */
export function editRoutine(b: Blob, ref: Ref, p: { title?: string; cadence?: string; blurb?: string }): { id: string; text: string } {
  const r = findRoutine(b, ref)
  const did: string[] = []
  const patch: Row = {}
  if (p.title !== undefined) {
    const t = p.title.trim(); if (!t) throw new McError('A routine title cannot be empty.')
    if (liveRoutines(b).some((x) => x.id !== r.id && fold(String(x.title)) === fold(t))) throw new McError(`Another routine is already called "${t}".`)
    patch.title = t; did.push(`title "${t}"`)
  }
  if (p.cadence !== undefined) {
    if (!CADENCES.includes(p.cadence)) throw new McError(`cadence must be one of ${CADENCES.join(', ')}.`)
    patch.cadence = p.cadence; did.push(p.cadence)
  }
  if (p.blurb !== undefined) { patch.blurb = p.blurb; did.push('blurb') }
  if (!did.length) throw new McError('Nothing to change: pass at least one field.')
  Object.assign(r, patch)
  // The mirrored habit carries the routine's name, so keep them in step.
  if (r.habitId && patch.title) for (const h of arr(b, 'habits')) if (h.id === r.habitId) h.name = patch.title
  return { id: r.id, text: `Updated routine "${r.title}": ${did.join(', ')}.` }
}

/** growth.ts deleteRoutine: archived with its own habit, never erased. */
export function deleteRoutine(b: Blob, ref: Ref): { id: string; text: string } {
  const r = findRoutine(b, ref)
  const goal = r.habitId ? arr(b, 'goals').find((g) => g.habitId === r.habitId && !g.closed) : undefined
  if (goal) throw new McError(`The goal "${goal.name}" counts off this routine's habit. The app re-works that goal when a routine goes; this connector cannot, so unlink the goal first (or delete the routine in the app).`)
  const today = dateKey()
  r.archivedAt = today
  if (r.habitId) for (const h of arr(b, 'habits')) if (h.id === r.habitId) h.archivedAt = today
  const seeds = ensure(b, 'removedSeeds') as unknown as string[]
  if (r.habitId && !seeds.includes(r.habitId)) seeds.push(r.habitId)
  if (!seeds.includes(r.id)) seeds.push(r.id)
  const kids = arr(b, 'habits').filter((h) => h.folderId === r.id && !h.archivedAt).length
  return { id: r.id, text: `Deleted routine "${r.title}" (kept in its history).${kids ? ` Its ${kids} step habits are still there as habits; archive them with archive_habit if he wants them gone.` : ''}` }
}

function addStep(b: Blob, routineId: string, title: string): string {
  const stepId = newId('st')
  applyRoutine(b, routineId, (r) => ({ ...r, steps: [...(r.steps ?? []), { id: stepId, kind: 'do', title }] }))
  return stepId
}

/** growth.ts addRoutineStep. Adding a required step to a finished routine reopens it, as in the app. */
export function addRoutineStep(b: Blob, ref: Ref, title: string): { id: string; text: string } {
  const r = findRoutine(b, ref)
  const t = (title ?? '').trim()
  if (!t) throw new McError('A step needs a title.')
  if ((r.steps ?? []).length >= 40) throw new McError('A routine takes at most 40 steps here.')
  if ((r.steps ?? []).some((s: Row) => fold(String(s.title)) === fold(t))) throw new McError(`"${r.title}" already has a step "${t}".`)
  const wasDone = routineComplete(rolled(r), periodKeyFor(r.cadence))
  guarded(b, 'Adding a step', () => addStep(b, r.id, t))
  return { id: r.id, text: `Added a step to "${r.title}": ${t}.${wasDone ? ' The routine had been finished for this period; the new step reopens it.' : ''}` }
}

const findStep = (r: Row, ref: { stepId?: string; step?: string }): Row =>
  pick(r.steps ?? [], { id: ref.stepId, title: ref.step }, 'step', (s) => String(s.title ?? ''))

/** growth.ts deleteRoutineStep (the step's own habit, if it has one, stays: the app leaves it too). */
export function removeRoutineStep(b: Blob, ref: Ref, stepRef: { stepId?: string; step?: string }): { id: string; text: string } {
  const r = findRoutine(b, ref)
  const st = findStep(r, stepRef)
  guarded(b, 'Removing a step', () => applyRoutine(b, r.id, (x) => ({ ...x, steps: x.steps.filter((s: Row) => s.id !== st.id), doneStepIds: (x.doneStepIds ?? []).filter((id: string) => id !== st.id) })))
  const hid = st.habitId ?? `h-${r.id}-${st.id}`
  const kept = arr(b, 'habits').some((h) => h.id === hid && !h.archivedAt)
  return { id: r.id, text: `Removed from "${r.title}": ${st.title}.${kept ? ` Its habit "${arr(b, 'habits').find((h) => h.id === hid)!.name}" is still there; archive_habit removes it.` : ''}` }
}

/** growth.ts toggleRoutineStep / toggleRoutineAlt */
export function routineStep(b: Blob, ref: Ref, stepRef: { stepId?: string; step?: string }, opts: { done?: boolean; alt?: string } = {}): { id: string; text: string } {
  const r0 = findRoutine(b, ref)
  const r = rollRoutine(r0)
  const st = findStep(r, stepRef)
  const has = (r.doneStepIds ?? []).includes(st.id)
  const hid = st.habitId ?? `h-${r.id}-${st.id}`
  const habit = arr(b, 'habits').find((h) => h.id === hid)
  if (opts.alt !== undefined) {
    if (!st.alts?.length) throw new McError(`The step "${st.title}" has no alternatives.`)
    const alt = pick(st.alts, { id: st.alts.some((a: Row) => a.id === opts.alt) ? opts.alt : undefined, title: opts.alt }, 'alternative', (a) => String(a.title ?? ''))
    const off = r.stepChoice?.[st.id] === alt.id
    if (opts.done === true && off) return { id: r.id, text: `"${st.title}" was already ticked with "${alt.title}".` }
    if (opts.done === false && !off) return { id: r.id, text: `"${st.title}" was not ticked with "${alt.title}".` }
    if (!off && stepLocked(r, st.id)) throw new McError(`"${st.title}" is locked until its own test is passed.`)
    guarded(b, `"${st.title}"`, () => applyRoutine(b, r.id, (x) => {
      const stepChoice = { ...(x.stepChoice ?? {}) }
      if (off) delete stepChoice[st.id]; else stepChoice[st.id] = alt.id
      const doneStepIds = off ? x.doneStepIds.filter((id: string) => id !== st.id) : x.doneStepIds.includes(st.id) ? x.doneStepIds : [...x.doneStepIds, st.id]
      markSteps(b, r.id, [st.id], !off)
      return stamped({ ...x, stepChoice, doneStepIds })
    }))
    return { id: r.id, text: `${off ? 'Unticked' : 'Ticked'} in "${r.title}": ${st.title} (${alt.title}). ${progressText(b, r.id)}` }
  }
  const want = opts.done ?? !has
  if (want === has) return { id: r.id, text: `"${st.title}" was already ${has ? 'ticked' : 'open'} in "${r.title}".` }
  if (want) {
    if (stepLocked(r, st.id)) throw new McError(`"${st.title}" is locked until its own test is passed (75 WPM).`)
    if (habit && habitGate(habit)) throw new McError(`"${st.title}" is gated by a number (${habitGate(habit)!.target} ${habitGate(habit)!.unit}). Log his real result with habit_count on the habit "${habit.name}".`)
    if (st.alts?.length) throw new McError(`"${st.title}" is answered by picking one alternative. Call again with alt set to one of: ${st.alts.map((a: Row) => `${a.id} (${a.title})`).join(', ')}.`)
  }
  const doneStepIds = has ? r.doneStepIds.filter((x: string) => x !== st.id) : [...r.doneStepIds, st.id]
  guarded(b, `Unticking "${st.title}"`, () => {
    applyRoutine(b, r.id, (x) => stamped({ ...x, doneStepIds }))
    markSteps(b, r.id, [st.id], !has)
  })
  return { id: r.id, text: `${has ? 'Unticked' : 'Ticked'} in "${r.title}": ${st.title}. ${progressText(b, r.id)}` }
}
function progressText(b: Blob, id: string): string {
  const r = arr(b, 'routines').find((x) => x.id === id)!
  const p = routineProgress(r)
  return `${p.done} of ${p.total} required steps${routineComplete(r, periodKeyFor(r.cadence)) ? ', routine finished' : ''}.`
}

/** growth.ts setRoutineDone: finishing finishes what is REQUIRED (never an optional step he did not tick,
 *  never a step that has to be earned elsewhere: the typing test, or a habit gated by a number). */
export function routineDone(b: Blob, ref: Ref, done: boolean): { id: string; text: string } {
  const r0 = findRoutine(b, ref)
  const r = rollRoutine(r0)
  if (!(r.steps ?? []).length) throw new McError(`"${r.title}" has no steps yet, so there is nothing to finish. Add steps first (add_routine_step).`)
  const locked = (x: Row, st: Row): boolean => {
    if (stepLocked(x, st.id)) return true
    const hb = arr(b, 'habits').find((h) => h.id === (st.habitId ?? `h-${x.id}-${st.id}`))
    return !!hb && habitLocked(hb, arr(b, 'stepLog'), dateKey())
  }
  guarded(b, done ? `Finishing "${r.title}"` : `Reopening "${r.title}"`, () => applyRoutine(b, r.id, (x) => {
    markSteps(b, r.id, requiredSteps(x).filter((st) => !locked(x, st)).map((st) => st.id), done)
    return stamped({
      ...x,
      doneStepIds: done
        ? [...new Set([
          ...x.doneStepIds.filter((id: string) => x.steps.some((st: Row) => st.id === id && st.optional)),
          ...requiredSteps(x).filter((st) => !locked(x, st)).map((st) => st.id),
        ])]
        : [],
      stepChoice: done ? x.stepChoice : {},
    })
  }))
  const held = (r.steps ?? []).filter((st: Row) => locked(r, st))
  return { id: r.id, text: done
    ? `Ticked what "${r.title}" needs. ${progressText(b, r.id)}${held.length ? ` ("${held[0].title}" has to be earned with its own result, so the routine is not finished.)` : ''}`
    : `Reopened "${r.title}": every step is open again.` }
}

/** growth.ts planRoutine. slot absent = clear the plan (the app's own meaning). */
export function planRoutine(b: Blob, ref: Ref, o: { slot?: string; date?: string; clear?: boolean }): { id: string; text: string } {
  const r = findRoutine(b, ref)
  if (o.clear) {
    if (o.slot !== undefined || o.date !== undefined) throw new McError('clear takes neither slot nor date.')
    guarded(b, 'Clearing the plan', () => applyRoutine(b, r.id, (x) => ({ ...x, planned: undefined })))
    return { id: r.id, text: `"${r.title}" is no longer planned on a day.` }
  }
  if (!o.slot) throw new McError('Say where on the day: slot is morning, noon, afternoon or evening. (clear: true removes a plan.)')
  if (!DAYPARTS.includes(o.slot)) throw new McError(`slot must be one of ${DAYPARTS.join(', ')}.`)
  const day = o.date ?? dateKey()
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  if (day < dateKey()) throw new McError('A routine cannot be planned on a day that has passed.')
  guarded(b, 'Planning', () => applyRoutine(b, r.id, (x) => ({ ...x, planned: { day, slot: o.slot } })))
  return { id: r.id, text: `Planned "${r.title}" for ${day === dateKey() ? 'today' : day}, ${o.slot}.` }
}

/* ============================ reads =========================================== */

function howToKeep(b: Blob, h: Row): { track: string; how: string } {
  const t = trackOf(h)
  if (t === 'quit') return { track: 'quit', how: 'log_slip (only if he slipped); every other day is kept on its own' }
  if (t === 'amount') return { track: 'amount', how: 'log_habit_amount / remove_habit_amount' }
  if (t === 'auto') return { track: 'auto', how: 'none: it fills itself from focus minutes' }
  if (t === 'count') return { track: 'count', how: 'habit_count (1 = did it once, -1 = take one back)' }
  const own = drivenBy(b, h)
  if (own) return { track: 'routine', how: `none by hand today: set by the steps of "${own.title}" (routine_step / routine_done)` }
  if (habitGate(h)) return { track: 'gated', how: `habit_count with his real result (needs ${habitGate(h)!.target} ${habitGate(h)!.unit})` }
  if (h.alts?.length) return { track: 'alts', how: 'tick_habit with alt set to one of the alternatives' }
  if (h.paused) return { track: 'check', how: 'paused: resume it first (pause_habit)' }
  return { track: 'check', how: 'tick_habit' }
}

export function listHabits(b: Blob, i: { query?: string; space?: 'personal' | 'work' } = {}): { count: number; habits: Row[] } {
  const today = dateKey(); const idx = weekdayIndex(today)
  const log = arr(b, 'habitLog'); const slips = arr(b, 'slips')
  const q = i.query ? fold(i.query) : ''
  const week = Array.from({ length: 7 }, (_, k) => dayOfWeekKey(k))
  const rows = live(b).filter((h) => (!i.space || h.space === i.space) && (!q || fold(habitName(h)).includes(q))).map((h) => {
    const { track, how } = howToKeep(b, h)
    const base: Row = { id: h.id, name: h.name, space: h.space, track, paused: !!h.paused, how }
    if (h.daypart) base.daypart = h.daypart
    const rid = h.folderId ?? arr(b, 'routines').find((r) => !r.archivedAt && (r.steps ?? []).some((s: Row) => s.habitId === h.id))?.id
    const rt = rid ? arr(b, 'routines').find((r) => r.id === rid) : undefined
    if (rt) base.routine = rt.title
    if (track === 'quit') {
      return { ...base, since: h.quitSince, daysClean: daysClean(h, slips, today), bestRun: bestCleanRun(h, slips, today), slips: slipCount(h, slips), slippedToday: slips.some((s) => s.habitId === h.id && s.day === today), ...(h.dailyCost ? { dailyCost: h.dailyCost } : {}) }
    }
    const kept = keptOn(b, h.id, today)
    const common: Row = { ...base, frequency: h.frequency ?? 'daily', target: habitTarget(h), dueToday: dueOn(h, idx, log, today), keptToday: kept, keptThisPeriod: keptThisPeriod(h, log, today) || undefined }
    if (track === 'count') {
      const per = (h.per ?? 'day') as 'day' | 'week' | 'month'; const r = periodRange(per, today)
      return { ...common, keptToday: countIn(log, h.id, today, today) >= (per === 'day' ? countTarget(h) : 1), count: { have: countIn(log, h.id, r.from, r.to), target: countTarget(h), per } }
    }
    if (track === 'amount') {
      const total = amountOn(log, h.id, today)
      return { ...common, keptToday: total >= (h.targetAmount ?? 1), amount: { today: total, target: h.targetAmount ?? 1, unit: h.unit } }
    }
    if (track === 'auto') return { ...common, keptToday: kept, fills: `${h.auto?.minutes ?? h.dailyTargetMin ?? 60} min of focus a day` }
    return {
      ...common, streak: currentStreak(log, h.id, today), bestStreak: bestStreak(log, h.id),
      week: week.map((d) => keptOn(b, h.id, d)),
      ...(h.alts?.length ? { alts: h.alts.map((a: Row) => ({ id: a.id, title: a.title })) } : {}),
      ...(habitGate(h) ? { gate: habitGate(h), numberToday: habitNumberOn(arr(b, 'stepLog'), h, today) } : {}),
    }
  })
  return { count: rows.length, habits: rows }
}

export function listRoutines(b: Blob, i: { query?: string } = {}): { count: number; routines: Row[] } {
  const today = dateKey()
  const q = i.query ? fold(i.query) : ''
  const rows = liveRoutines(b).filter((r) => !q || fold(String(r.title)).includes(q)).map((raw) => {
    const r = rolled(raw)
    const key = periodKeyFor(r.cadence)
    const habits = arr(b, 'habits')
    return clean({
      id: r.id, title: r.title, space: r.space, cadence: r.cadence, blurb: r.blurb,
      complete: routineComplete(r, key), progress: routineProgress(r), startedAt: r.startedAt,
      planned: r.planned && r.planned.day >= today ? r.planned : undefined,
      repeatable: r.repeatable || undefined, runsThisPeriod: r.run || undefined,
      streakHabit: r.habitId,
      steps: (r.steps ?? []).map((s: Row) => {
        const hid = s.habitId ?? `h-${r.id}-${s.id}`
        const hb = habits.find((h) => h.id === hid)
        return clean({
          id: s.id, title: s.title, done: (r.doneStepIds ?? []).includes(s.id), optional: s.optional || undefined, note: s.note,
          alts: s.alts?.length ? s.alts.map((a: Row) => ({ id: a.id, title: a.title })) : undefined, choice: r.stepChoice?.[s.id],
          locked: stepLocked(r, s.id) || (hb && habitGate(hb) && habitLocked(hb, arr(b, 'stepLog'), today)) || undefined,
          habit: hb ? hb.id : undefined,
        })
      }),
    })
  })
  return { count: rows.length, routines: rows }
}
