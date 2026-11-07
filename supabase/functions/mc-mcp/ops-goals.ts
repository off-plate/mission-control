/* Goals, and the bridge between tasks and goals, as plain functions on the state blob.

   NO Deno, NO network. Ports of:
   - src/assistantcore.tsx   addGoal / editGoal / goal / milestone / repeatGoal / deleteGoal /
                             projectDelete (the doer: what each assistant action does)
   - src/store/growth.ts     addGoal, repeatGoal, updateGoal, bumpGoal, toggleGoalMilestone,
                             deleteGoal, logGoalAmount, removeGoalEntry
   - src/store/planner.ts    deleteProject, setProjectTag, setProjectHue, commitTask, setTaskGoal
   - src/store.tsx           creditGoal (finishing a task feeds its goal)
   - src/types/goals.ts      goalCurrent (progress is DERIVED for a goal fed by a habit)
   - src/util.ts             goalPeriodKey / goalPeriodRange / periodIsPast
   - src/tags.ts             cleanTag / freeTag

   Rules from the merge engine (src/sync-merge.ts): a deleted goal / project / task is also
   BURIED ("goals:<id>", "projects:<id>", "tasks:<id>"). None of these touch a LOG collection.

   What is deliberately NOT here (the tool refuses instead): see tools-goals.ts. */

import {
  McError, arr, bury, dateKey, ensure, findTask, fold, isDate, newId, pick, rowKey, slugTag, tagOf,
  type Blob, type Ref, type Row,
} from './ops.ts'

/* ============================== PERIODS ======================================== */
/* src/util.ts, on a 'YYYY-MM-DD' string (Prague) instead of a Date in the browser's zone. */

export type GoalTf = 'weekly' | 'monthly' | 'quarter' | 'half'
export const GOAL_TFS: GoalTf[] = ['weekly', 'monthly', 'quarter', 'half']
export const GOAL_CATEGORIES = ['money', 'health', 'life', 'work', 'offplate', 'habits'] as const

const ymd = (day: string): [number, number, number] => {
  const [y, m, d] = day.split('-').map(Number)
  return [y, m, d]
}
const iso = (t: Date): string => t.toISOString().slice(0, 10)
/** 'YYYY-MM-DD' plus n days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = ymd(day)
  return iso(new Date(Date.UTC(y, m - 1, d + n)))
}

/** util.ts isoWeekKey */
export function isoWeekKeyOf(day: string): string {
  const [y, m, d] = ymd(day)
  const t = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** util.ts goalPeriodKey: the period a goal set on `day` belongs to. */
export function goalPeriodKey(tf: GoalTf, day: string = dateKey()): string {
  const [y, m, d] = ymd(day)
  if (tf === 'weekly') return isoWeekKeyOf(day)
  if (tf === 'monthly') return `${y}-${String(m).padStart(2, '0')}`
  if (tf === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  // The half year ends on 14 February and 14 August (his call, 2026-09-30).
  const md = m * 100 + d
  if (md >= 815) return `${y}-H2`
  if (md >= 215) return `${y}-H1`
  return `${y - 1}-H2`
}

const KEY_RE: Record<GoalTf, RegExp> = {
  weekly: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
  monthly: /^\d{4}-(0[1-9]|1[0-2])$/,
  quarter: /^\d{4}-Q[1-4]$/,
  half: /^\d{4}-H[12]$/,
}
export const validPeriodKey = (tf: GoalTf, key: unknown): key is string => typeof key === 'string' && KEY_RE[tf].test(key)

/** util.ts goalPeriodRange (from / to only; the label is mine). */
export function goalPeriodRange(tf: GoalTf, key: string): { id: string; label: string; from: string; to: string } {
  const D = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m, d)))
  let from: string, to: string
  if (tf === 'weekly') {
    const [y, w] = key.split('-W').map(Number)
    const jan4 = new Date(Date.UTC(y, 0, 4))
    const mon = new Date(jan4)
    mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7)
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    from = iso(mon); to = iso(sun)
  } else if (tf === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    from = D(y, m - 1, 1); to = D(y, m, 0)
  } else if (tf === 'quarter') {
    const [y, q] = key.split('-Q').map(Number)
    from = D(y, (q - 1) * 3, 1); to = D(y, q * 3, 0)
  } else {
    const [y, h] = key.split('-H').map(Number)
    from = h === 1 ? D(y, 1, 15) : D(y, 7, 15)
    to = h === 1 ? D(y, 7, 14) : D(y + 1, 1, 14)
  }
  return { id: key, label: `${key} (${from} to ${to})`, from, to }
}

/** util.ts periodIsPast */
export const periodIsPast = (tf: GoalTf, key: string, today: string = dateKey()): boolean => goalPeriodRange(tf, key).to < today

/* ============================== HABIT-FED PROGRESS ============================== */
/* src/types/goals.ts goalCurrent and the two helpers it uses (src/types/habits.ts). */

const isTimeFed = (h: Row): boolean => h.auto?.from === 'focus' || (h.kind === 'measured' && h.source === 'focus')

function keptDaysIn(log: Row[], habitId: string, from: string, to: string): Set<string> {
  return new Set(log.filter((t) => t.habitId === habitId && t.day >= from && t.day <= to).map((t) => t.day))
}

function quitKeptDays(h: Row, slips: Row[], from: string, to: string, today: string): Set<string> {
  const out = new Set<string>()
  if (h.kind !== 'break' || !h.quitSince) return out
  const start = h.quitSince > from ? h.quitSince : from
  if (!isDate(start)) return out
  const end = to < today ? to : today // only days that have happened
  const slipped = new Set(slips.filter((s) => s.habitId === h.id).map((s) => s.day))
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) if (!slipped.has(cur)) out.add(cur)
  return out
}

const TIMEFRAME_WEEKS: Record<GoalTf, number> = { weekly: 1, monthly: 4, quarter: 13, half: 26 }

/** types/goals.ts goalCurrent: a closed goal keeps its final number; a goal tied to a habit is
 *  COUNTED from the habit over the goal's own period; anything else is the number it holds. */
export function goalCurrent(
  g: Row, habits: Row[], log?: Row[], range?: { from: string; to: string }, slips: Row[] = [], sessions: Row[] = [], today: string = dateKey(),
): number {
  if (g.closed) return g.closed.final
  if (!g.habitId) return g.current
  const h = habits.find((x) => x.id === g.habitId)
  if (!h) return g.current
  if (range && isTimeFed(h)) {
    const mins = sessions.filter((s) => s.day >= range.from && s.day <= range.to && s.space === h.space).reduce((a, s) => a + s.minutes, 0)
    return Math.min(g.target, Math.round((mins / 60) * 10) / 10)
  }
  if (log && range) {
    const kept = h.kind === 'break' ? quitKeptDays(h, slips, range.from, range.to, today).size : keptDaysIn(log, h.id, range.from, range.to).size
    return Math.min(g.target, kept)
  }
  const thisWeek = (h.days ?? []).filter(Boolean).length
  const weeks = TIMEFRAME_WEEKS[(g.timeframe ?? 'quarter') as GoalTf]
  const past = (h.history ?? []).slice(-(weeks - 1)).reduce((a: number, n: number) => a + n, 0)
  return Math.min(g.target, thisWeek + (weeks > 1 ? past : 0))
}

const tfOf = (g: Row): GoalTf => (GOAL_TFS.includes(g.timeframe) ? g.timeframe : 'quarter')
/** The key a goal is for: its stored one, else the current period of its timeframe (store.tsx load). */
const keyOf = (g: Row, today: string): string => g.periodKey ?? goalPeriodKey(tfOf(g), today)

/** The progress number the app SHOWS for a goal (goals.tsx nowOf). */
export function goalNow(b: Blob, g: Row, today: string = dateKey()): number {
  const tf = tfOf(g); const key = keyOf(g, today)
  const range = validPeriodKey(tf, key) ? goalPeriodRange(tf, key) : undefined
  return goalCurrent(g, arr(b, 'habits'), arr(b, 'habitLog'), range, arr(b, 'slips'), arr(b, 'focusSessions'), today)
}

/* ============================== GOAL WRITES ===================================== */

const need = (n: unknown, what: string, lo: number, hi: number): number => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new McError(`${what} must be a number from ${lo} to ${hi}.`)
  return Math.round(n * 100) / 100 // assistant.ts num(): two decimals
}
const text = (s: unknown, what: string, cap: number): string => {
  const t = typeof s === 'string' ? s.trim() : ''
  if (!t) throw new McError(`${what} cannot be empty.`)
  if (t.length > cap) throw new McError(`${what} is over ${cap} characters. Shorten it.`)
  return t
}

/** Is this goal measured in its milestones (target equals their count)? Then its number is
 *  the ticked count and only ticking moves it (growth.ts toggleGoalMilestone). */
export const milestoneMeasured = (g: Row): boolean => Array.isArray(g.milestones) && g.milestones.length > 0 && g.target === g.milestones.length

/** Which goal. By id (any goal) or by words. By words an OPEN goal wins over a closed one of the
 *  same name (assistantcore.tsx); a closed one is found only when `closed` is allowed. */
export function pickGoal(b: Blob, ref: Ref, opts: { closed?: 'never' | 'fallback' | 'always' } = {}): Row {
  const all = arr(b, 'goals')
  const mode = opts.closed ?? 'never'
  const name = (g: Row) => String(g.name ?? '')
  if (ref.id) {
    const g = all.find((x) => x.id === ref.id)
    if (!g) throw new McError(`No goal has the id "${ref.id}". Use list_goals to get a real id.`)
    if (g.closed && mode === 'never') throw new McError(`"${g.name}" is a finished goal (closed on ${g.closed.on} at ${g.closed.final} of ${g.target}). A finished goal is history and cannot be changed; repeat_goal runs it again for this period.`)
    return g
  }
  if (mode === 'always') return pick(all, ref, 'goal', name)
  const open = all.filter((g) => !g.closed)
  if (mode === 'fallback') {
    const q = fold(ref.title ?? '')
    if (q && open.some((g) => fold(name(g)).includes(q))) return pick(open, ref, 'goal', name)
    return pick(all, ref, 'goal', name)
  }
  if (!fold(ref.title ?? '') ) return pick(open, ref, 'goal', name)
  const q = fold(ref.title!)
  if (!open.some((g) => fold(name(g)).includes(q)) && all.some((g) => g.closed && fold(name(g)).includes(q))) {
    throw new McError(`The only goal matching "${ref.title}" is finished (history). repeat_goal runs it again for this period.`)
  }
  return pick(open, ref, 'goal', name)
}

export interface AddGoalInput {
  name: string
  target?: number
  unit?: string
  timeframe?: GoalTf
  category?: (typeof GOAL_CATEGORIES)[number]
  why?: string
  space?: 'personal' | 'work'
  milestones?: string[]
  allowDuplicate?: boolean
}

/** assistantcore addGoal + growth.ts addGoal. */
export function addGoal(b: Blob, i: AddGoalInput, today: string = dateKey()): { id: string; text: string } {
  const name = text(i.name, 'A goal name', 200)
  const tf = i.timeframe ?? 'monthly' // assistantcore: a.timeframe ?? 'monthly'
  if (!GOAL_TFS.includes(tf)) throw new McError(`timeframe must be one of ${GOAL_TFS.join(', ')}.`)
  const category = i.category ?? 'life' // assistantcore: a.category ?? 'life'
  if (!GOAL_CATEGORIES.includes(category)) throw new McError(`category must be one of ${GOAL_CATEGORIES.join(', ')}.`)
  const labels = (i.milestones ?? []).map((m) => String(m ?? '').trim()).filter(Boolean)
  if (labels.length > 30) throw new McError('A goal can have at most 30 milestones.')
  if (labels.some((l) => l.length > 200)) throw new McError('A milestone label is over 200 characters.')
  const unit = i.unit === undefined ? undefined : text(i.unit, 'unit', 40)
  const why = i.why === undefined ? undefined : text(i.why, 'why', 300)
  const target = i.target === undefined ? undefined : need(i.target, 'target', 1, 1e7)
  if (!labels.length && !target) throw new McError(`A goal needs a target number or milestones: ${name}`)
  const space = i.space ?? 'personal'
  if (space !== 'personal' && space !== 'work') throw new McError('space must be personal or work.')
  const periodKey = goalPeriodKey(tf, today)
  const goals = ensure(b, 'goals')
  const dupe = goals.find((g) => !g.closed && g.space === space && tfOf(g) === tf && g.periodKey === periodKey && fold(String(g.name)) === fold(name))
  if (dupe && !i.allowDuplicate) {
    throw new McError(`There is already an open ${tf} goal "${dupe.name}" for ${periodKey} (id ${dupe.id}). Edit that one, or pass allow_duplicate: true if this is a different goal.`)
  }
  const stamp = Date.now().toString(36)
  const row: Row = {
    id: newId('g'), space, name, current: 0, note: '',
    target: labels.length || target!, unit: labels.length ? 'milestones' : (unit ?? 'steps'),
    timeframe: tf, category,
    periodKey, createdAt: today, touchedAt: today,
    milestones: labels.map((label, k) => ({ id: `ms-${stamp}-${k}`, label, done: false })),
  }
  if (why !== undefined) row.why = why
  goals.push(row)
  return { id: row.id, text: `Made a new ${tf} goal: ${name} (${labels.length ? `${labels.length} milestones` : `${row.target} ${row.unit}`}, ${space}, ${periodKey}).` }
}

export interface EditGoalInput { name?: string; target?: number; unit?: string; timeframe?: GoalTf; why?: string }

/** assistantcore editGoal + growth.ts updateGoal. */
export function editGoal(b: Blob, ref: Ref, p: EditGoalInput, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref)
  const did: string[] = []
  const patch: Row = {}
  if (p.name !== undefined) { patch.name = text(p.name, 'name', 200); did.push('name') }
  if (p.target !== undefined) {
    const t = need(p.target, 'target', 1, 1e7)
    if (milestoneMeasured(g) && t !== g.target) throw new McError(`"${g.name}" is measured in its ${g.milestones.length} milestones, so its target is their count. Change the milestones in the app, not the target.`)
    patch.target = t; did.push(`target ${t}`)
  }
  if (p.unit !== undefined) { patch.unit = text(p.unit, 'unit', 40); did.push('unit') }
  if (p.timeframe !== undefined && p.timeframe !== tfOf(g)) {
    // The app's updateGoal leaves periodKey as it was, which would point a weekly goal at a month.
    throw new McError(`Changing "${g.name}" from ${tfOf(g)} to ${p.timeframe} is refused: the goal is bound to its period (${keyOf(g, today)}) and the app does not move it. Make a new ${p.timeframe} goal with add_goal and delete this one if he wants that.`)
  }
  if (p.why !== undefined) { patch.why = text(p.why, 'why', 300); did.push('why') }
  if (!did.length) throw new McError('Nothing to change: pass at least one of name, target, unit, why.')
  Object.assign(g, patch, { touchedAt: today })
  return { id: g.id, text: `Updated goal: ${g.name}${did.length ? ` (${did.join(', ')})` : ''}.` }
}

/** assistantcore 'goal' action. by -> growth.ts bumpGoal (clamped to 0..target); set -> updateGoal
 *  current (as typed, 0..1e7, not clamped to the target). */
export function setGoalProgress(b: Blob, ref: Ref, p: { by?: number; set?: number }, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref)
  if (p.by === undefined && p.set === undefined) throw new McError('Pass by (add to the number, negative subtracts) or set (replace it).')
  if (p.by !== undefined && p.set !== undefined) throw new McError('Pass either by or set, not both.')
  if (g.habitId) throw new McError(`"${g.name}" counts itself from its habit, so there is no number to set.`)
  if (milestoneMeasured(g)) throw new McError(`"${g.name}" is measured in its milestones; tick them with tick_milestone and the number follows.`)
  let before = g.current
  if (p.set !== undefined) g.current = need(p.set, 'set', 0, 1e7)
  else g.current = Math.max(0, Math.min(g.target, g.current + need(p.by, 'by', -1e7, 1e7)))
  g.touchedAt = today
  return { id: g.id, text: `${g.name}: ${g.current} of ${g.target} ${g.unit} (was ${before}).` }
}

/** assistantcore 'milestone' + growth.ts toggleGoalMilestone. `done` makes it idempotent. */
export function tickMilestone(b: Blob, ref: Ref, step: Ref, done: boolean | undefined, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref)
  if (!Array.isArray(g.milestones) || !g.milestones.length) throw new McError(`"${g.name}" has no milestones.`)
  const m = g.milestones.find((x: Row) => x.id === step.title) ?? pick(g.milestones, step, 'milestone', (x) => String(x.label ?? ''))
  if (done !== undefined && !!m.done === done) return { id: g.id, text: `Milestone "${m.label}" on ${g.name} was already ${done ? 'done' : 'open'}.` }
  m.done = !m.done
  const doneCount = g.milestones.filter((x: Row) => x.done).length
  if (g.target === g.milestones.length) g.current = doneCount // measured in its milestones; other units keep their counter
  g.touchedAt = today
  return { id: g.id, text: `${m.done ? 'Ticked' : 'Reopened'} on ${g.name}: ${m.label} (${g.current} of ${g.target} ${g.unit}).` }
}

/** growth.ts repeatGoal (+ assistantcore: matched among ALL goals). Idempotent per period. */
export function repeatGoal(b: Blob, ref: Ref, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref, { closed: 'always' })
  const tf = tfOf(g)
  const periodKey = goalPeriodKey(tf, today)
  const goals = ensure(b, 'goals')
  const already = goals.find((x) => !x.closed && x.space === g.space && tfOf(x) === tf && x.periodKey === periodKey && x.name === g.name)
  if (already) return { id: already.id, text: `"${g.name}" is already running for ${periodKey} (id ${already.id}). Nothing was added.` }
  const next: Row = { ...g, id: newId('g'), periodKey, current: 0, createdAt: today, touchedAt: today }
  delete next.closed
  // The app copies the old ledger onto a goal that starts at 0; a fresh period starts with none.
  delete next.entries
  next.milestones = g.milestones?.map((m: Row) => ({ ...m, done: false }))
  if (!next.milestones) delete next.milestones
  goals.push(next)
  return { id: next.id, text: `Running again: ${g.name} for ${periodKey} (new id ${next.id}), starting at 0.` }
}

/** growth.ts deleteGoal: filtered out and buried so a stale device cannot bring it back. */
export function deleteGoal(b: Blob, ref: Ref): { id: string; text: string } {
  const g = pickGoal(b, ref, { closed: 'fallback' })
  b.goals = arr(b, 'goals').filter((x) => x.id !== g.id)
  bury(b, rowKey('goals', g))
  const linked = arr(b, 'tasks').filter((t) => t.goalId === g.id).length
  return { id: g.id, text: `Deleted goal: ${g.name}.${linked ? ` ${linked} task(s) still point at it and simply stop counting.` : ''}` }
}

/** growth.ts logGoalAmount: the total moves (not capped at the target) and the entry explains it. */
export function logGoalAmount(b: Blob, ref: Ref, v: number, note: string | undefined, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref)
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0 || Math.abs(v) > 1e7) throw new McError('amount must be a non-zero number (negative takes away).')
  if (g.habitId) throw new McError(`"${g.name}" counts itself from its habit, so there is nothing to log by hand.`)
  if (milestoneMeasured(g)) throw new McError(`"${g.name}" is measured in its milestones; tick them with tick_milestone.`)
  const n = (note ?? '').trim()
  if (n.length > 200) throw new McError('The note is over 200 characters.')
  const eid = newId('ge')
  g.current = Math.max(0, g.current + v)
  g.entries = [...(Array.isArray(g.entries) ? g.entries : []), { id: eid, day: today, v, note: n || undefined }]
  g.touchedAt = today
  return { id: eid, text: `${g.name}: ${v > 0 ? '+' : ''}${v} logged on ${today}; now ${g.current} of ${g.target} ${g.unit}. (entry ${eid})` }
}

/** growth.ts removeGoalEntry: takes the amount back out of the total. */
export function removeGoalEntry(b: Blob, ref: Ref, entryId: string, today: string = dateKey()): { id: string; text: string } {
  const g = pickGoal(b, ref)
  const e = (Array.isArray(g.entries) ? g.entries : []).find((x: Row) => x.id === entryId)
  if (!e) throw new McError(`"${g.name}" has no entry with the id "${entryId}". list_goals shows its entries.`)
  g.current = Math.max(0, g.current - e.v)
  g.entries = g.entries.filter((x: Row) => x.id !== entryId)
  g.touchedAt = today
  return { id: g.id, text: `${g.name}: removed the ${e.v > 0 ? '+' : ''}${e.v} entry of ${e.day}; now ${g.current} of ${g.target} ${g.unit}.` }
}

/* ============================== TASK <-> GOAL ==================================== */

/** store.tsx creditGoal: finishing a task feeds its goal, reopening it takes the amount back.
 *  Only a goal still running and not fed by a habit. growth.ts bumpGoal clamps to 0..target.
 *  EXPORTED so the task tools (complete / reopen) can call it, as the app's toggleTask does.
 *  Returns what it did, or null when there was nothing to do. */
export function creditGoal(b: Blob, t: Row | undefined, sign: 1 | -1, today: string = dateKey()): string | null {
  if (!t?.goalId) return null
  const g = arr(b, 'goals').find((x) => x.id === t.goalId)
  if (!g || g.closed || g.habitId) return null
  g.current = Math.max(0, Math.min(g.target, g.current + sign * (t.goalAmt ?? 1)))
  g.touchedAt = today
  return `${g.name} ${sign > 0 ? '+' : '-'}${t.goalAmt ?? 1} (now ${g.current} of ${g.target} ${g.unit})`
}

/** planner.ts setTaskGoal. goal omitted/null takes the link off. The link is the ONLY record:
 *  the goal never stores which tasks fed it. */
export function setTaskGoal(b: Blob, ref: Ref, goal: Ref | null, amount?: number, today: string = dateKey()): { id: string; text: string } {
  const t = findTask(b, ref)
  if (!goal) {
    if (!t.goalId) return { id: t.id, text: `"${t.title}" was not counting toward a goal.` }
    delete t.goalId; delete t.goalAmt
    return { id: t.id, text: `"${t.title}" no longer counts toward a goal.` }
  }
  const g = pickGoal(b, goal)
  // The app offers only this week's weekly goals (weekgoals.tsx) and creditGoal skips habit-fed ones.
  if (tfOf(g) !== 'weekly') throw new McError(`"${g.name}" is a ${tfOf(g)} goal. A task can only feed a weekly goal.`)
  if (g.periodKey !== goalPeriodKey('weekly', today)) throw new McError(`"${g.name}" is for ${g.periodKey}, not this week (${goalPeriodKey('weekly', today)}). Only this week's goals can be fed.`)
  if (g.habitId) throw new McError(`"${g.name}" counts itself from a habit, so a task cannot feed it.`)
  if (milestoneMeasured(g)) throw new McError(`"${g.name}" is measured in its milestones, so a task cannot feed it.`)
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount > 1000)) throw new McError('amount must be a number from 1 to 1000.')
  t.goalId = g.id
  t.goalAmt = Math.max(1, amount ?? 1) // planner.ts: Math.max(1, goalAmt ?? 1)
  return { id: t.id, text: `Finishing "${t.title}" now adds ${t.goalAmt} to ${g.name}${t.done ? ' (it is already done, so nothing is added retroactively)' : ''}.` }
}

/** planner.ts commitTask. horizon null takes it off its period. */
export function commitTask(b: Blob, ref: Ref, horizon: GoalTf | null, key: string | undefined, today: string = dateKey()): { id: string; text: string } {
  const t = findTask(b, ref)
  if (horizon === null) {
    if (key !== undefined) throw new McError('period_key goes with a horizon, not with removing one.')
    delete t.horizon; delete t.horizonKey
    return { id: t.id, text: `"${t.title}" is no longer committed to a period.` }
  }
  if (!GOAL_TFS.includes(horizon)) throw new McError(`horizon must be one of ${GOAL_TFS.join(', ')}, or null.`)
  if (key !== undefined && !validPeriodKey(horizon, key)) throw new McError(`period_key "${key}" is not a ${horizon} key (like ${goalPeriodKey(horizon, today)}).`)
  t.horizon = horizon
  t.horizonKey = key ?? goalPeriodKey(horizon, today)
  return { id: t.id, text: `"${t.title}" is committed to ${horizon} ${t.horizonKey}.` }
}

/* ============================== PROJECTS ========================================= */

/** tags.ts cleanTag */
export const cleanTag = (want: string): string => fold(want).replace(/^#+/, '').replace(/[^a-z0-9_-]+/g, '').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40)
/** tags.ts freeTag: a tag no other project answers to: "home" then "home2". */
export function freeTag(want: string, projects: Row[], except?: string, own = false): string {
  const base = (own ? cleanTag(want) : '') || slugTag(want)
  const taken = new Set(projects.filter((p) => p.id !== except).map(tagOf))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

export const HUE_IDS = ['sky', 'teal', 'terra', 'ochre', 'rose', 'slate', 'olive', 'brown'] as const // src/hues.ts HUES

const pickProject = (b: Blob, ref: Ref): Row => pick(arr(b, 'projects'), { id: ref.id, title: ref.title }, 'project', (p) => String(p.name ?? ''))

/** planner.ts deleteProject. 'move': its tasks lose the project and stay. 'delete': they go too,
 *  each buried. The writer's safety stop allows ONE removed row per collection, so a project with
 *  more than one task cannot be deleted with its tasks in one go. */
export function deleteProject(b: Blob, ref: Ref, mode: 'move' | 'delete'): { id: string; text: string } {
  if (mode !== 'move' && mode !== 'delete') throw new McError("mode must be 'move' (keep its tasks) or 'delete' (delete them too).")
  const p = pickProject(b, ref)
  const theirs = arr(b, 'tasks').filter((t) => t.projectId === p.id)
  if (mode === 'delete' && theirs.length > 1) {
    throw new McError(`"${p.name}" holds ${theirs.length} tasks. Deleting them together is more than one row in one step, which this connector refuses. Either use mode "move" (the tasks stay, without the project), or delete the tasks one by one with delete_task and then the project. Nothing was changed.`)
  }
  const keys = [rowKey('projects', p), ...(mode === 'delete' ? theirs.map((t) => rowKey('tasks', t)) : [])]
  b.projects = arr(b, 'projects').filter((x) => x.id !== p.id)
  if (mode === 'delete') b.tasks = arr(b, 'tasks').filter((t) => t.projectId !== p.id)
  else for (const t of theirs) delete t.projectId
  bury(b, ...keys)
  return {
    id: p.id,
    text: mode === 'delete' && theirs.length ? `Deleted "${p.name}" and its task.` : `Deleted project "${p.name}"${theirs.length ? `; its ${theirs.length} task(s) stay, without a project` : ''}.`,
  }
}

/** planner.ts setProjectTag. '' puts it back to following the name. */
export function setProjectTag(b: Blob, ref: Ref, tag: string): { id: string; text: string } {
  const p = pickProject(b, ref)
  const want = String(tag ?? '').trim()
  if (!want) {
    delete p.tag
    return { id: p.id, text: `"${p.name}" follows its name again: #${tagOf(p)}.` }
  }
  if (!cleanTag(want)) throw new McError('A tag needs letters or digits (a-z, 0-9, - and _).')
  const free = freeTag(want, arr(b, 'projects'), p.id, true)
  p.tag = free
  return { id: p.id, text: `"${p.name}" now answers to #${free}${free !== cleanTag(want) ? ` (#${cleanTag(want)} was taken by another project)` : ''}.` }
}

/** planner.ts setProjectHue (the ids are src/hues.ts HUES). */
export function setProjectHue(b: Blob, ref: Ref, hue: string): { id: string; text: string } {
  const p = pickProject(b, ref)
  if (!(HUE_IDS as readonly string[]).includes(hue)) throw new McError(`colour must be one of ${HUE_IDS.join(', ')}.`)
  p.hue = hue
  return { id: p.id, text: `"${p.name}" is now ${hue}.` }
}

/* ============================== READ ============================================= */

export interface ListGoalsInput {
  where?: 'open' | 'closed' | 'all'
  timeframe?: GoalTf
  space?: 'personal' | 'work'
  query?: string
  limit?: number
}

/** The goals with progress computed the way goals.tsx does (nowOf), plus the tasks committed to
 *  their period and the tasks feeding them. */
export function listGoals(b: Blob, i: ListGoalsInput, today: string = dateKey()): Row {
  const where = i.where ?? 'open'
  const q = i.query ? fold(i.query) : ''
  const tasks = arr(b, 'tasks')
  const rows = arr(b, 'goals').filter((g) => {
    if (where === 'open' && g.closed) return false
    if (where === 'closed' && !g.closed) return false
    if (i.timeframe && tfOf(g) !== i.timeframe) return false
    if (i.space && g.space !== i.space) return false
    if (q && !fold(`${g.name} ${g.why ?? ''}`).includes(q)) return false
    return true
  })
  const limit = Math.min(Math.max(i.limit ?? 50, 1), 200)
  const habits = arr(b, 'habits')
  const out = rows.slice(0, limit).map((g) => {
    const tf = tfOf(g); const key = keyOf(g, today)
    const range = validPeriodKey(tf, key) ? goalPeriodRange(tf, key) : undefined
    const cur = goalNow(b, g, today)
    const habit = g.habitId ? habits.find((h) => h.id === g.habitId) : undefined
    const entries = Array.isArray(g.entries) ? g.entries : []
    const feeders = tasks.filter((t) => t.goalId === g.id)
    const committed = tasks.filter((t) => t.horizon === tf && t.horizonKey === key)
    return {
      id: g.id, name: g.name, space: g.space, timeframe: tf, category: g.category, ...(g.why ? { why: g.why } : {}),
      period: range ? { key, from: range.from, to: range.to, status: g.closed ? 'closed' : range.to < today ? 'ended, the app closes it when opened' : 'running' } : { key, status: 'unknown period' },
      progress: { current: cur, target: g.target, unit: g.unit, percent: g.target > 0 ? Math.round((cur / g.target) * 100) : 0, reached: cur >= g.target },
      ...(g.closed ? { closed: g.closed } : {}),
      source: habit ? `counted from habit "${habit.name}" (do not set a number)` : g.habitId ? 'tied to a habit that no longer exists, holds its own number' : milestoneMeasured(g) ? 'milestones' : 'by hand',
      ...(Array.isArray(g.milestones) && g.milestones.length ? { milestones: g.milestones.map((m: Row) => ({ id: m.id, label: m.label, done: !!m.done })) } : {}),
      ...(entries.length ? { entryCount: entries.length, lastEntries: entries.slice(-5).map((e: Row) => ({ id: e.id, day: e.day, v: e.v, ...(e.note ? { note: e.note } : {}) })) } : {}),
      ...(feeders.length ? { feedingTasks: feeders.map((t) => ({ id: t.id, title: t.title, done: !!t.done, adds: t.goalAmt ?? 1 })) } : {}),
      ...(committed.length ? { committedTasks: committed.map((t) => ({ id: t.id, title: t.title, done: !!t.done })) } : {}),
      ...(g.createdAt ? { created: g.createdAt } : {}), ...(g.touchedAt ? { lastTouched: g.touchedAt } : {}),
    }
  })
  return { today, count: rows.length, shown: out.length, goals: out }
}
