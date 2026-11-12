/* Planning the day, time tracking and the calendar, as plain functions on the state blob.

   NO Deno, NO network here (the calendar call itself lives in tools-planning.ts;
   this file only shapes its answer). Ports, with the app's file named beside each:
   - plan_day       src/store/planner.ts (moveTaskList, assignSlot, setTaskAt, setEstimate),
                    through ops.updateTask so the semantics are the same lines of code
   - day_capacity   src/types/core.ts (SLOTS, slotMinutes), src/util.ts (taskMinutes, isEstimated),
                    src/exceptions.ts (the over-planned rule: open tasks of a slot vs the slot's hours)
   - log_task_time  src/store.tsx logActual and logSubtaskActual (+ creditGoal, bumpGoal)
   - log_focus      src/store.tsx logFocusOn (+ spaceOfLabel)
   - focus_stats    src/focus.tsx (minutes per day, newest first)
   - get_calendar   src/calendar.ts readCalendar, src/calkind.ts isMeeting

   Rules that come from the merge engine (src/sync-merge.ts): focusSessions and ledger
   are LOG collections keyed by id (`focusSessions:<id>`, `ledger:<id>`), so every row
   written here gets a fresh newId and rows are only ever ADDED, never rewritten. */

import {
  McError, arr, bury, dateKey, ensure, findTask, isDate, isTime, newId, pick, rowKey, slotForTime, SLOTS, updateTask,
  type Blob, type Ref, type Row, type Slot,
} from './ops.ts'

/* ---- shared helpers --------------------------------------------------------- */

/** src/types/core.ts SLOTS: each part of the day is a real span of hours. */
export const SLOT_HOURS: Record<Slot, { from: number; to: number }> = {
  morning: { from: 6, to: 12 }, noon: { from: 12, to: 14 }, afternoon: { from: 14, to: 18 }, evening: { from: 18, to: 24 },
}
/** src/types/core.ts slotMinutes. */
export const slotMinutes = (id: Slot): number => (SLOT_HOURS[id].to - SLOT_HOURS[id].from) * 60

/** src/util.ts taskMinutes: the steps' sum when it has steps, else its own estimate. 0 = not estimated. */
export function taskMinutes(t: Row): number {
  if (Array.isArray(t.subtasks) && t.subtasks.length) return t.subtasks.reduce((a: number, s: Row) => a + (Number(s.estimateMin) || 0), 0)
  return Number(t.estimateMin) || 0
}
/** src/util.ts isEstimated: a bare minute value from an old default does not count. */
export function isEstimated(t: Row): boolean {
  if (Array.isArray(t.subtasks) && t.subtasks.length) return true
  return t.estimated === true && Number(t.estimateMin) > 0
}
/** src/util.ts fmtDuration. */
export function fmtDuration(min: number): string {
  const sign = min < 0 ? '-' : ''
  const a = Math.abs(min)
  const h = Math.floor(a / 60); const m = a % 60
  if (h && m) return `${sign}${h}h ${m}m`
  if (h) return `${sign}${h}h`
  return `${sign}${m}m`
}
/** src/util.ts isoWeekKey, from a YYYY-MM-DD (the app builds the Date from the local noon of that day). */
export function isoWeekKey(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

const pragueParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
function zoned(d: Date) {
  const o: Record<string, number> = {}
  for (const p of pragueParts.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o
}
/** A Prague wall-clock time as the instant it happened (two passes, as supabase/functions/_shared/ical.ts does). */
export function pragueInstant(day: string, time: string): Date {
  const [y, mo, d] = day.split('-').map(Number); const [h, mi] = time.split(':').map(Number)
  const want = Date.UTC(y, mo - 1, d, h, mi)
  let at = new Date(want)
  for (let i = 0; i < 2; i++) {
    const z = zoned(at)
    at = new Date(at.getTime() - (Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - want))
  }
  return at
}

/* ============================== plan_day ===================================== */

export interface Placement { id?: string; title?: string; date?: string; at?: string; slot?: Slot; minutes?: number; list?: 'today' | 'backlog' }

/** The patch ops.updateTask gets for one placement, or a refusal. Mirrors what the assistant's
 *  `move` does (assistantcore.tsx doTask 'move'): a slot on a task that is on the list puts it
 *  on today first; a date puts it on that day; a clock time implies its part of the day. */
function patchFor(t: Row, p: Placement, today: string): Parameters<typeof updateTask>[2] {
  const name = `"${t.title}"`
  if (t.done) throw new McError(`${name} is already done, so it cannot be planned. Reopen it first (reopen_task) if you mean to do it again.`)
  if (p.date !== undefined && !isDate(p.date)) throw new McError(`${name}: date must be YYYY-MM-DD, got "${p.date}".`)
  if (p.at !== undefined && !isTime(p.at)) throw new McError(`${name}: at must be HH:MM (24h), got "${p.at}".`)
  if (p.slot !== undefined && !SLOTS.includes(p.slot)) throw new McError(`${name}: slot must be one of ${SLOTS.join(', ')}.`)
  if (p.list === 'backlog') {
    if (p.date || p.at || p.slot) throw new McError(`${name}: list "backlog" (back on the list) cannot be combined with a date, time or part of the day.`)
    if (p.minutes !== undefined) return { list: 'backlog', minutes: p.minutes }
    return { list: 'backlog' }
  }
  if (p.at && p.slot && slotForTime(p.at) !== p.slot) {
    throw new McError(`${name}: ${p.at} is in the ${slotForTime(p.at)}, not the ${p.slot}. A clock time sets the part of the day, so drop slot or fix the time.`)
  }
  if (p.date === undefined && p.at === undefined && p.slot === undefined && p.minutes === undefined && p.list === undefined) {
    throw new McError(`${name}: nothing to place. Give a date, at, slot, minutes or list.`)
  }
  const patch: Parameters<typeof updateTask>[2] = {}
  // A task on the list needs a day to be planned on; one already planned keeps its day unless told otherwise.
  const date = p.date ?? (t.list === 'today' ? undefined : (p.at !== undefined || p.slot !== undefined || p.list === 'today' ? today : undefined))
  if (date !== undefined) patch.date = date
  if (p.list === 'today' && date === undefined) patch.list = 'today'
  if (p.at !== undefined) patch.at = p.at
  else if (p.slot !== undefined) patch.slot = p.slot
  if (p.minutes !== undefined) patch.minutes = p.minutes
  return patch
}

const itemName = (k: number, p: Placement): string => `item ${k + 1} (${p.id ?? `"${p.title}"`})`

/** Place many tasks at once, all or nothing. Every item is resolved and applied to a COPY first;
 *  only when all of them hold is the real blob touched. */
export function planDay(b: Blob, items: Placement[], today = dateKey()): { id?: string; text: string; days: string[] } {
  if (!Array.isArray(items) || !items.length) throw new McError('Give at least one task to place.')
  if (items.length > 40) throw new McError('At most 40 placements per call. Split the plan.')
  // 1. resolve every task, by id or words, before anything changes
  const tasks = items.map((p, k) => {
    try { return findTask(b, { id: p.id, title: p.title }) } catch (e) {
      if (e instanceof McError) throw new McError(`Nothing was changed. ${itemName(k, p)}: ${e.message}`)
      throw e
    }
  })
  const seen = new Map<string, number>()
  tasks.forEach((t, k) => {
    if (seen.has(t.id)) throw new McError(`Nothing was changed. ${itemName(k, items[k])} is the same task as item ${seen.get(t.id)! + 1} ("${t.title}"). Place each task once.`)
    seen.set(t.id, k)
  })
  // 2. dry run on a copy, one updateTask per item
  const run = (target: Blob, report: string[]) => {
    items.forEach((p, k) => {
      const t = arr(target, 'tasks').find((x) => x.id === tasks[k].id)!
      try {
        const patch = patchFor(t, p, today)
        report.push(updateTask(target, { id: t.id }, patch).text)
      } catch (e) {
        if (e instanceof McError) throw new McError(`Nothing was changed. ${itemName(k, p)}: ${e.message}`)
        throw e
      }
    })
  }
  run(structuredClone(b), [])
  // 3. every item holds: apply for real
  const lines: string[] = []
  run(b, lines)
  const days = [...new Set(tasks.map((t) => arr(b, 'tasks').find((x) => x.id === t.id)!).filter((t) => t.list === 'today').map((t) => String(t.plannedOn)))].sort()
  const notes: string[] = []
  for (const d of days) {
    if (d < today) notes.push(`${d} is in the past, so those tasks now count as overdue.`)
    const cap = dayCapacity(b, d)
    for (const part of cap.parts as Row[]) {
      if (part.overByMin > 0) notes.push(`${d} ${part.slot}: ${fmtDuration(part.plannedMin)} planned in ${fmtDuration(part.capacityMin)}, over by ${fmtDuration(part.overByMin)}.`)
      else if (part.unestimatedTasks.length) notes.push(`${d} ${part.slot}: ${part.unestimatedTasks.length} task(s) have no estimate, so the real load is more than the ${fmtDuration(part.plannedMin)} counted.`)
    }
  }
  return { text: `Placed ${items.length} task${items.length === 1 ? '' : 's'}:\n${lines.join('\n')}${notes.length ? `\nHeads up: ${notes.join(' ')}` : ''}`, days }
}

/* ============================== day_capacity ================================= */

export interface Busy { from: string; to: string }

/** One day: minutes planned in each part of the day vs the hours that part really holds, the
 *  pinned times, and the free windows between them. 0 minutes means NOT ESTIMATED, so a part
 *  with such a task is never claimed to fit; it is "unknown" until the task has a number. */
export function dayCapacity(b: Blob, date?: string, extraBusy: Busy[] = []): Row {
  const day = date ?? dateKey()
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${day}".`)
  const rows = arr(b, 'tasks').filter((t) => t.list === 'today' && (t.plannedOn ?? dateKey()) === day)
  const open = rows.filter((t) => !t.done)
  const brief = (t: Row) => ({ id: t.id, title: t.title })
  const parts = SLOTS.map((slot) => {
    const mine = open.filter((t) => t.slot === slot)
    const plannedMin = mine.reduce((a, t) => a + taskMinutes(t), 0)
    const unestimated = mine.filter((t) => taskMinutes(t) === 0)
    const unconfirmed = mine.filter((t) => taskMinutes(t) > 0 && !isEstimated(t))
    const cap = slotMinutes(slot)
    const fits = plannedMin > cap ? 'no' : unestimated.length ? 'unknown' : 'yes'
    return {
      slot, hours: `${hhmm(SLOT_HOURS[slot].from * 60)}-${hhmm(SLOT_HOURS[slot].to * 60)}`,
      capacityMin: cap, plannedMin, tasks: mine.length,
      overByMin: Math.max(0, plannedMin - cap), freeMin: Math.max(0, cap - plannedMin),
      fits,
      unestimatedTasks: unestimated.map(brief),
      ...(unconfirmed.length ? { unconfirmedEstimateTasks: unconfirmed.map(brief) } : {}),
    }
  })
  const unsorted = open.filter((t) => !t.slot)
  const pinned = open.filter((t) => t.at).sort((a, c) => a.at.localeCompare(c.at)).map((t) => {
    const m = taskMinutes(t)
    return { id: t.id, title: t.title, at: t.at, ...(m > 0 ? { minutes: m, ends: hhmm(Math.min(1440, toMin(t.at) + m)) } : { minutes: 'not estimated' as const }) }
  })
  // Busy intervals: pinned tasks whose length is known, plus whatever the caller passes (meetings).
  const busy: [number, number][] = []
  for (const x of extraBusy) {
    if (!isTime(x.from) || !isTime(x.to) || toMin(x.to) <= toMin(x.from)) throw new McError(`busy blocks need from and to as HH:MM with to after from, got ${x.from}-${x.to}.`)
    busy.push([toMin(x.from), toMin(x.to)])
  }
  for (const t of open) if (t.at && taskMinutes(t) > 0) busy.push([toMin(t.at), Math.min(1440, toMin(t.at) + taskMinutes(t))])
  busy.sort((a, c) => a[0] - c[0])
  const dayStart = SLOT_HOURS.morning.from * 60; const dayEnd = SLOT_HOURS.evening.to * 60
  const windows: { from: string; to: string; minutes: number }[] = []
  let cur = dayStart
  for (const [s, e] of busy) {
    if (s > cur) windows.push({ from: hhmm(cur), to: hhmm(Math.min(s, dayEnd)), minutes: Math.min(s, dayEnd) - cur })
    cur = Math.max(cur, e)
    if (cur >= dayEnd) break
  }
  if (cur < dayEnd) windows.push({ from: hhmm(cur), to: hhmm(dayEnd), minutes: dayEnd - cur })
  const noLength = open.filter((t) => t.at && taskMinutes(t) === 0).map(brief)
  const unest = open.filter((t) => taskMinutes(t) === 0)
  const planned = open.reduce((a, t) => a + taskMinutes(t), 0)
  const dayCap = SLOTS.reduce((a, s) => a + slotMinutes(s), 0)
  return {
    date: day, open: open.length, done: rows.length - open.length,
    dayCapacityMin: dayCap, plannedMin: planned,
    fitsWholeDay: planned > dayCap ? 'no' : unest.length ? 'unknown' : 'yes',
    unestimatedTasks: unest.map(brief),
    parts,
    unsorted: { tasks: unsorted.length, plannedMin: unsorted.reduce((a, t) => a + taskMinutes(t), 0), note: 'No part of the day yet, so they are not counted against any part above.' },
    pinned,
    freeWindows: windows,
    freeInWindowsMin: windows.reduce((a, w) => a + w.minutes, 0),
    note: `Free windows are the gaps between pinned tasks with a known length${extraBusy.length ? ' and the busy blocks you passed' : ''}, between 06:00 and 24:00. `
      + `${noLength.length ? `${noLength.length} pinned task(s) have no estimate, so their length is not cut out of the windows. ` : ''}`
      + 'Minutes of 0 mean "not estimated", never "no effort"; a part with such a task is "unknown", not "yes". The clock is not applied: for today, part of this has already passed.',
  }
}

/* ============================== log_task_time ================================ */

/** src/store.tsx creditGoal + src/store/growth.ts bumpGoal: finishing a task tied to a running weekly goal moves it. */
function creditGoal(b: Blob, t: Row, today = dateKey()): string | null {
  if (!t.goalId) return null
  const g = arr(b, 'goals').find((x) => x.id === t.goalId)
  if (!g || g.closed || g.habitId) return null
  if (typeof g.current !== 'number' || typeof g.target !== 'number') throw new McError(`"${t.title}" feeds the goal "${g.name}", which has no numeric progress this connector can move. Finish it in the app.`)
  g.current = Math.max(0, Math.min(g.target, g.current + (t.goalAmt ?? 1))); g.touchedAt = today
  return `the goal "${g.name}" moved to ${g.current}/${g.target}`
}

const MAX_MIN = 480 // the assistant's MIN: 1..480 whole minutes
function checkMinutes(n: unknown, what = 'minutes'): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > MAX_MIN) throw new McError(`${what} must be a whole number from 1 to ${MAX_MIN}.`)
  return Math.round(n)
}

/** src/store.tsx logActual (whole task) or logSubtaskActual (one step, when `step` is given). */
export function logTaskTime(b: Blob, ref: Ref, minutes: number, step?: Ref, now = new Date()): { id: string; text: string } {
  const mins = checkMinutes(minutes)
  const t = findTask(b, ref)
  const today = dateKey(now)
  const stamp = now.toISOString()
  const say: string[] = []

  if (step && (step.id || step.title)) {
    const subs: Row[] = Array.isArray(t.subtasks) ? t.subtasks : []
    if (!subs.length) throw new McError(`"${t.title}" has no steps. Log the time on the whole task (leave step out).`)
    const sub = pick(subs, step, 'step', (s) => String(s.title ?? ''))
    const wasDone = !!t.done
    sub.done = true; sub.actualMin = mins
    const allDone = subs.every((s) => s.done)
    if (allDone && !t.done) { t.done = true; t.doneAt = stamp }
    say.push(`Logged ${fmtDuration(mins)} on the step "${sub.title}"`)
    if (allDone && !wasDone) {
      const goal = creditGoal(b, t, today)
      const est = subs.reduce((a, s) => a + (Number(s.estimateMin) || 0), 0)
      const act = subs.reduce((a, s) => a + (s.actualMin ?? s.estimateMin ?? 0), 0)
      const lid = newId('l')
      ensure(b, 'ledger').unshift({ id: lid, title: t.title, category: t.category, estimateMin: est, actualMin: act, when: today, space: t.space, weekKey: isoWeekKey(today) })
      ensure(b, 'focusSessions').unshift({ id: newId('f'), day: today, minutes: act, label: t.title, space: t.space, ledgerId: lid, at: stamp })
      say.push(`that was the last step, so "${t.title}" is done with ${fmtDuration(act)} in total (ledger and focus rows written)${goal ? `, ${goal}` : ''}`)
    } else if (!allDone) say.push(`${subs.filter((s) => !s.done).length} step(s) still open`)
    return { id: t.id, text: `${say.join('; ')}.` }
  }

  if (!t.done) { const goal = creditGoal(b, t, today); if (goal) say.push(goal) }
  const first = t.actualMin === undefined
  t.done = true
  t.doneAt = t.doneAt ?? stamp
  t.actualMin = mins
  if (Array.isArray(t.subtasks)) t.subtasks = t.subtasks.map((s: Row) => ({ ...s, done: true }))
  if (first) {
    const lid = newId('l')
    ensure(b, 'ledger').unshift({ id: lid, title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin: mins, when: today, space: t.space, weekKey: isoWeekKey(today) })
    // Real time on a task is real time whether or not the timer ran: it is also a focus block (the app's own comment in logActual).
    ensure(b, 'focusSessions').unshift({ id: newId('f'), day: today, minutes: mins, label: t.title, space: t.space, ledgerId: lid, at: stamp })
    return { id: t.id, text: `"${t.title}" is done: ${fmtDuration(mins)} logged (ledger and focus rows written${t.estimateMin ? `, estimate was ${fmtDuration(t.estimateMin)}` : ', it had no estimate'})${say.length ? `; ${say.join('; ')}` : ''}.` }
  }
  return { id: t.id, text: `"${t.title}" already had its time logged, so only the number changed to ${fmtDuration(mins)} (no second ledger or focus row, as in the app).${say.length ? ` ${say.join('; ')}.` : ''}` }
}

/* ============================== log_focus ==================================== */

export interface LogFocusInput { minutes: number; label?: string; date?: string; at?: string; space?: 'personal' | 'work' }

/** src/store.tsx logFocusOn. The app files a block under the space of the task it names, else under the
 *  space he is VIEWING, which a server cannot know: then `space` must be passed. */
export function logFocus(b: Blob, i: LogFocusInput, now = new Date()): { id: string; text: string } {
  const mins = checkMinutes(i.minutes)
  const today = dateKey(now)
  const day = i.date ?? today
  if (!isDate(day)) throw new McError(`date must be YYYY-MM-DD, got "${i.date}".`)
  if (day > today) throw new McError('Focus that has not happened yet cannot be logged. Pass a date that is today or earlier.')
  if (i.at !== undefined && !isTime(i.at)) throw new McError(`at must be HH:MM (24h), got "${i.at}".`)
  const label = i.label?.trim().slice(0, 200) || undefined
  let at = stamp(now)
  if (i.at) {
    const when = pragueInstant(day, i.at)
    if (when.getTime() > now.getTime()) throw new McError(`${i.at} on ${day} has not happened yet. "at" is when the block ENDED.`)
    at = stamp(when)
  }
  // spaceOfLabel: the task a label names (exact title, case-insensitive), or the task holding a step of that name.
  let space: 'personal' | 'work' | undefined
  if (label) {
    const want = label.toLowerCase()
    const tasks = arr(b, 'tasks')
    const t = tasks.find((x) => String(x.title).trim().toLowerCase() === want)
    const holder = t ?? tasks.find((x) => Array.isArray(x.subtasks) && x.subtasks.some((st: Row) => String(st.title).trim().toLowerCase() === want))
    if (holder) space = holder.space
  }
  if (space && i.space && i.space !== space) throw new McError(`"${label}" is a ${space} task, and the app files focus under the task's space. Drop space, or change the label.`)
  space = space ?? i.space
  if (!space) throw new McError('Which space was this focus in, personal or work? The app uses the space he is viewing, which I cannot see: pass space, or use a label that is exactly a task title.')
  // Retry guard (not in the app): the same block twice within two minutes is a double send, never two sessions.
  const dupe = arr(b, 'focusSessions').find((f) => f.day === day && f.minutes === mins && (f.label ?? undefined) === label && f.at && Math.abs(Date.parse(f.at) - Date.parse(at)) < 120000)
  if (dupe) throw new McError(`That exact block is already logged (id ${dupe.id}). Nothing was added.`)
  const lid = newId('l'); const id = newId('f')
  const row: Row = { id, day, minutes: mins, ...(label ? { label } : {}), space, ledgerId: lid, at }
  ensure(b, 'focusSessions').unshift(row)
  ensure(b, 'ledger').unshift({ id: lid, title: label ? `Focus: ${label}` : 'Focus block', category: 'deep', estimateMin: mins, actualMin: mins, when: day, space, weekKey: isoWeekKey(day) })
  return { id, text: `Logged ${fmtDuration(mins)} of focus${label ? ` on ${label}` : ''}${day !== today ? ` on ${day}` : ''} (${space}). Measured habits fed by focus update the next time the app opens.` }
}
const stamp = (d: Date): string => d.toISOString()

/* ============================== focus_stats ================================== */

export interface FocusStatsInput { from?: string; to?: string; by?: 'day' | 'week'; space?: 'personal' | 'work' }

/** src/focus.tsx: minutes per day from focusSessions, newest first; plus per ISO week. Finished blocks only:
 *  a timer running right now lives in the app and is not in the data. */
export function focusStats(b: Blob, i: FocusStatsInput): Row {
  const today = dateKey()
  const to = i.to ?? today
  const fromDefault = new Date(`${to}T12:00:00Z`)
  if (!isDate(to)) throw new McError(`to must be YYYY-MM-DD, got "${i.to}".`)
  fromDefault.setUTCDate(fromDefault.getUTCDate() - 6)
  const from = i.from ?? fromDefault.toISOString().slice(0, 10)
  if (!isDate(from)) throw new McError(`from must be YYYY-MM-DD, got "${i.from}".`)
  if (from > to) throw new McError('from is after to.')
  if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 > 366) throw new McError('At most 366 days at a time.')
  const rows = arr(b, 'focusSessions').filter((f) => f.day >= from && f.day <= to && (!i.space || f.space === i.space))
  const bucket = (f: Row) => ((i.by ?? 'day') === 'week' ? isoWeekKey(f.day) : f.day)
  const map = new Map<string, { minutes: number; blocks: number }>()
  for (const f of rows) { const k = bucket(f); const v = map.get(k) ?? { minutes: 0, blocks: 0 }; v.minutes += Number(f.minutes) || 0; v.blocks++; map.set(k, v) }
  const buckets = [...map.entries()].sort((a, c) => c[0].localeCompare(a[0])).map(([k, v]) => ({ [i.by === 'week' ? 'week' : 'day']: k, minutes: v.minutes, blocks: v.blocks, text: fmtDuration(v.minutes) }))
  const labels = new Map<string, number>()
  for (const f of rows) { const k = f.label ?? '(no label)'; labels.set(k, (labels.get(k) ?? 0) + (Number(f.minutes) || 0)) }
  const total = rows.reduce((a, f) => a + (Number(f.minutes) || 0), 0)
  return {
    from, to, ...(i.space ? { space: i.space } : {}), by: i.by ?? 'day', totalMin: total, total: fmtDuration(total), blocks: rows.length,
    todayMin: arr(b, 'focusSessions').filter((f) => f.day === today && (!i.space || f.space === i.space)).reduce((a, f) => a + (Number(f.minutes) || 0), 0),
    buckets,
    topLabels: [...labels.entries()].sort((a, c) => c[1] - a[1]).slice(0, 8).map(([label, minutes]) => ({ label, minutes })),
    note: 'Finished blocks only. A focus timer that is running right now lives in the app and is not counted.',
  }
}

/* ============================== get_calendar ================================= */

/** src/calkind.ts isMeeting: other people are in it, or it has a call link. All-day is neither. */
export function isMeeting(e: { allDay: boolean; people?: string[]; link?: string }): boolean {
  if (e.allDay) return false
  if (e.link) return true
  return (e.people?.length ?? 0) > 1
}

export interface CalendarAsk { from?: string; to?: string; onlyMeetings?: boolean }

/** The window to ask the `calendar` function for, or a refusal. The function reads from the server's today
 *  (UTC midnight) forward, at most 31 days; it cannot look back. */
export function calendarWindow(i: CalendarAsk, now = new Date()): { from: string; to: string; days: number } {
  const today = dateKey(now)
  const from = i.from ?? today
  const to = i.to ?? from
  if (!isDate(from) || !isDate(to)) throw new McError('from and to must be YYYY-MM-DD.')
  if (to < from) throw new McError('to is before from.')
  if (from < today) throw new McError(`The calendar feed only answers from today (${today}) forward; it cannot look at ${from}. For past meetings use his meeting notes.`)
  const utcToday = now.toISOString().slice(0, 10)
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${utcToday}T00:00:00Z`)) / 86400000) + 1
  if (days > 31) throw new McError('The calendar feed reaches at most 31 days ahead. Ask for a nearer end date.')
  return { from, to, days: Math.max(1, days) }
}

/** The function's answer (already parsed and trimmed by supabase/functions/calendar) cut to the asked days. */
export function shapeCalendar(raw: unknown, ask: { from: string; to: string }, onlyMeetings = false): Row {
  const body = (typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw) as { events?: Row[] } | null
  if (!body || !Array.isArray(body.events)) throw new McError('The calendar answered in a shape I do not recognise, so I cannot say what is on it. Say that to Michael; do not assume the days are free.')
  const ok = body.events.filter((e) => e && typeof e.day === 'string' && typeof e.title === 'string' && e.day >= ask.from && e.day <= ask.to)
  const events = ok
    .map((e) => ({ ...e, meeting: isMeeting({ allDay: !!e.allDay, people: e.people, link: e.link }) }))
    .filter((e) => !onlyMeetings || e.meeting)
    .sort((a, c) => (a.day === c.day ? (a.start ?? -1) - (c.start ?? -1) : a.day < c.day ? -1 : 1))
    .map((e) => ({
      day: e.day, ...(e.allDay || e.start == null ? { allDay: true } : { start: hhmm(e.start), ...(e.end != null ? { end: hhmm(e.end) } : {}) }),
      title: e.title, ...(e.where ? { where: e.where } : {}), meeting: e.meeting,
      ...(Array.isArray(e.people) && e.people.length ? { people: e.people } : {}), ...(e.link ? { link: e.link } : {}), uid: e.uid,
    }))
  return {
    from: ask.from, to: ask.to, source: 'his work calendar feed (read-only)', count: events.length,
    ...(events.length ? {} : { empty: `The calendar was read and has no entries ${onlyMeetings ? 'with other people ' : ''}from ${ask.from} to ${ask.to}.` }),
    events,
    note: 'Meetings he declined are already left out by the feed. Times are Prague time.',
  }
}

/* ============================== past focus blocks ============================ */

export interface ListFocusInput { from?: string; to?: string; space?: 'personal' | 'work'; label?: string; limit?: number }

const pragueClock = (iso: unknown): string | undefined => {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return undefined
  const z = zoned(new Date(iso))
  return hhmm(z.hour * 60 + z.minute)
}

/** Every finished focus block in a range, newest first, with the id edit/delete need. src/focus.tsx lists the same rows. */
export function listFocusBlocks(b: Blob, i: ListFocusInput): Row {
  const today = dateKey()
  const to = i.to ?? today
  if (!isDate(to)) throw new McError(`to must be YYYY-MM-DD, got "${i.to}".`)
  const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 6)
  const from = i.from ?? d.toISOString().slice(0, 10)
  if (!isDate(from)) throw new McError(`from must be YYYY-MM-DD, got "${i.from}".`)
  if (from > to) throw new McError('from is after to.')
  const want = i.label?.trim().toLowerCase()
  const rows = arr(b, 'focusSessions')
    .filter((f) => f.day >= from && f.day <= to && (!i.space || f.space === i.space) && (!want || String(f.label ?? '').toLowerCase().includes(want)))
    .sort((a, c) => (a.day === c.day ? String(c.at ?? '').localeCompare(String(a.at ?? '')) : String(c.day).localeCompare(String(a.day))))
  const limit = Math.min(Math.max(1, i.limit ?? 100), 300)
  const total = rows.reduce((s, f) => s + (Number(f.minutes) || 0), 0)
  return {
    from, to, blocks: rows.length, totalMin: total, total: fmtDuration(total),
    ...(rows.length > limit ? { shown: limit, note: `Showing the newest ${limit} of ${rows.length}. Narrow the range to see the rest.` } : {}),
    items: rows.slice(0, limit).map((f) => ({
      id: f.id, day: f.day, minutes: f.minutes, label: f.label ?? null, space: f.space ?? null,
      ...(pragueClock(f.at) ? { ended: pragueClock(f.at) } : {}),
    })),
  }
}

export interface EditFocusInput { id: string; minutes?: number; label?: string }

/** src/store.tsx updateFocus: minutes and label, and the block's ledger row kept equal to it. */
export function editFocusBlock(b: Blob, i: EditFocusInput): { id: string; text: string } {
  const f = arr(b, 'focusSessions').find((x) => x.id === i.id)
  if (!f) throw new McError(`No focus block has the id "${i.id}". Use list_focus_blocks to get a real id.`)
  if (i.minutes === undefined && i.label === undefined) throw new McError('Nothing to change. Pass minutes, label, or both.')
  const was = { minutes: f.minutes, label: f.label }
  if (i.minutes !== undefined) f.minutes = Math.max(1, Math.round(checkMinutes(i.minutes)))
  if (i.label !== undefined) {
    const l = i.label.trim().slice(0, 200)
    if (l) f.label = l; else delete f.label
  }
  if (f.ledgerId) {
    const l = arr(b, 'ledger').find((x) => x.id === f.ledgerId)
    if (l) { l.estimateMin = f.minutes; l.actualMin = f.minutes; l.title = f.label ? `Focus: ${f.label}` : 'Focus block' }
  }
  const said: string[] = []
  if (was.minutes !== f.minutes) said.push(`${fmtDuration(was.minutes)} to ${fmtDuration(f.minutes)}`)
  if ((was.label ?? '') !== (f.label ?? '')) said.push(`label "${was.label ?? '(none)'}" to "${f.label ?? '(none)'}"`)
  return { id: f.id, text: said.length ? `Focus block on ${f.day} changed: ${said.join(', ')}. Habits fed by focus follow on the app's next open.` : `Focus block on ${f.day} already had those values; nothing changed.` }
}

/** src/store.tsx deleteFocus: the block and its ledger row go, both buried so another device cannot bring them back. */
export function deleteFocusBlock(b: Blob, id: string): { id: string; text: string } {
  const f = arr(b, 'focusSessions').find((x) => x.id === id)
  if (!f) throw new McError(`No focus block has the id "${id}". Use list_focus_blocks to get a real id.`)
  b.focusSessions = arr(b, 'focusSessions').filter((x) => x.id !== id)
  const keys = [rowKey('focusSessions', { id })]
  if (f.ledgerId) {
    b.ledger = arr(b, 'ledger').filter((x) => x.id !== f.ledgerId)
    keys.push(rowKey('ledger', { id: f.ledgerId }))
  }
  bury(b, ...keys)
  return { id, text: `Removed the ${fmtDuration(f.minutes)} focus block${f.label ? ` "${f.label}"` : ''} from ${f.day}. A habit it had earned is taken back on the app's next open.` }
}
