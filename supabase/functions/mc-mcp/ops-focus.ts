/* The focus timer, written the way the app writes it. Pure.

   The running timer is NOT device-local: src/pomodoro.tsx mirrors it into the synced state as
   `activeFocus` (src/store.tsx ActiveFocus) and every other device ADOPTS it: endsAt is an
   absolute moment, so a device that opens an hour later still shows the true time left. These
   operations write that same field, so a timer started from Claude shows up in Mission Control
   on the next sync of any device, with no open app needed.

   Rules lifted from pomodoro.tsx:
   - 'idle' and the finished-waiting state ('await') are stored as null: "nothing running".
   - a device that RUNS a block banks its minutes itself when it reaches zero (logFocus), so
     starting a block here never logs anything.
   - stopping a block early banks what was worked (bankPartial: floor(elapsed minutes), at
     least 1). Another device adopting a stop (null) does NOT bank, so the stop here must,
     or the time would be lost. The row is written by ops-planning logFocus, the same code
     path as the log_focus tool (focusSessions row + ledger row).
   - a start never replaces a focus block that is running, paused or finished-but-unbanked: its
     time would be lost. The caller must stop it first. A running BREAK is simply replaced. */

import { McError, findTask, type Blob, type Row } from './ops.ts'
import { logFocus } from './ops-planning.ts'

export const MAX_FOCUS_MIN = 480

const mins = (v: unknown, what = 'minutes'): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > MAX_FOCUS_MIN) throw new McError(`${what} must be a whole number from 1 to ${MAX_FOCUS_MIN}.`)
  return n
}
const taskMin = (t: Row): number => {
  const st = Array.isArray(t.subtasks) ? t.subtasks : []
  return st.length ? st.reduce((a: number, s: Row) => a + (Number(s.estimateMin) || 0), 0) : Number(t.estimateMin) || 0
}

/** The running focus or break block as stored, or null. */
export const running = (b: Blob): Row | null => {
  const a = b.activeFocus
  return a && typeof a === 'object' && (a.phase === 'focus' || a.phase === 'break') ? a : null
}
/** Seconds left: the frozen number while paused, else the distance to endsAt (never negative). */
export const secondsLeft = (a: Row, now: number): number =>
  a.pausedLeft != null ? Math.max(0, Number(a.pausedLeft)) : Math.max(0, Math.ceil((Number(a.endsAt) - now) / 1000))
const fmt = (s: number): string => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
const label = (a: Row): string => (a.focusLabel ? `"${a.focusLabel}"` : 'a focus block')

function write(b: Blob, a: Omit<Row, 'dev' | 'updatedAt'>, now: number): void {
  b.activeFocus = { ...a, dev: 'claude-mcp', updatedAt: now } // pomodoro.tsx: `dev` is not this device's, so every device adopts it
}

/** pomodoro.tsx startFocus. */
export function startFocus(b: Blob, i: { id?: string; title?: string; minutes?: number; label?: string; space?: 'personal' | 'work' }, now = Date.now()): { text: string } {
  const cur = running(b)
  if (cur && cur.phase === 'focus') {
    const left = secondsLeft(cur, now)
    throw new McError(left === 0
      ? `The focus block ${label(cur)} has run out its time but has not been logged yet. Call stop_focus first (it logs the block), then start the new one.`
      : `A focus block ${label(cur)} is already ${cur.pausedLeft != null ? 'paused' : 'running'} with ${fmt(left)} left. Starting another would lose its time: call stop_focus first (it logs what was worked), or extend_focus to add time.`)
  }
  let task: Row | undefined
  if (i.id || i.title) {
    task = findTask(b, { id: i.id, title: i.title })
    if (task.done) throw new McError(`"${task.title}" is already done. Reopen it first, or start a focus without a task.`)
  }
  const space = task?.space ?? i.space
  if (!space) throw new McError('Which space is this focus in, personal or work? Pass a task (it knows) or pass space.')
  let m: number
  if (i.minutes !== undefined) m = mins(i.minutes)
  else {
    const est = task ? taskMin(task) : 0
    if (!(est >= 1 && est <= MAX_FOCUS_MIN)) throw new McError(task
      ? `"${task.title}" has no estimate, so there is no default length. Pass minutes.`
      : 'How many minutes? Pass minutes (the app uses a setting kept on each device, which the connector cannot read).')
    m = Math.round(est)
  }
  const focusLabel = task ? String(task.title) : i.label?.trim().slice(0, 300) || null
  write(b, { phase: 'focus', endsAt: now + m * 60_000, pausedLeft: null, startedAt: now, blockMin: m, focusLabel, ...(task ? { taskId: task.id } : {}), space }, now)
  return { text: `Focus started${focusLabel ? ` on "${focusLabel}"` : ''}: ${m} minutes, ends ${new Date(now + m * 60_000).toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' })}. Mission Control shows it as running on the next sync of any device; the block is logged when it ends.` }
}

/** pomodoro.tsx stop + bankPartial. */
export function stopFocus(b: Blob, now = Date.now()): { text: string } {
  const a = running(b)
  if (!a) return { text: 'No focus or break timer is running.' }
  let banked = ''
  if (a.phase === 'focus') {
    const total = Number(a.blockMin) * 60
    const left = secondsLeft(a, now)
    const done = Math.floor((total - left) / 60) // pomodoro.tsx bankPartial: whole minutes worked
    if (done >= 1) {
      logFocus(b, { minutes: Math.min(done, Number(a.blockMin)), label: a.focusLabel ?? undefined, space: a.space }, new Date(now))
      banked = ` ${Math.min(done, Number(a.blockMin))} minutes were logged as focus${a.focusLabel ? ` on "${a.focusLabel}"` : ''}.`
    } else banked = ' Under a minute was worked, so nothing was logged.'
  }
  b.activeFocus = null
  return { text: `Stopped the ${a.phase} timer.${banked}` }
}

/** pomodoro.tsx toggle: pause freezes what is left, resume sets a new deadline from it. */
export function pauseFocus(b: Blob, now = Date.now()): { text: string } {
  const a = running(b)
  if (!a) throw new McError('No timer is running.')
  if (a.pausedLeft != null) return { text: `The ${a.phase} timer is already paused with ${fmt(secondsLeft(a, now))} left.` }
  const left = secondsLeft(a, now)
  if (left === 0) throw new McError('That block has already run out. Use stop_focus to log it.')
  write(b, { ...a, endsAt: null, pausedLeft: left, startedAt: a.startedAt }, now)
  return { text: `Paused the ${a.phase} timer with ${fmt(left)} left.` }
}
export function resumeFocus(b: Blob, now = Date.now()): { text: string } {
  const a = running(b)
  if (!a) throw new McError('No timer is running.')
  if (a.pausedLeft == null) return { text: `The ${a.phase} timer is already running.` }
  write(b, { ...a, endsAt: now + Number(a.pausedLeft) * 1000, pausedLeft: null }, now)
  return { text: `Resumed the ${a.phase} timer with ${fmt(Number(a.pausedLeft))} left.` }
}

/** pomodoro.tsx extend: "more focus instead", a fresh block under the same name, logged on its own when it ends.
 *  The block that was running is banked first (its minutes are real work and the new block replaces it). */
export function extendFocus(b: Blob, minutes: number, now = Date.now()): { text: string } {
  const m = mins(minutes)
  const a = running(b)
  if (!a || a.phase !== 'focus') throw new McError('No focus block is running to extend. Use start_focus.')
  const left = secondsLeft(a, now)
  const done = Math.floor((Number(a.blockMin) * 60 - left) / 60)
  if (done >= 1) logFocus(b, { minutes: Math.min(done, Number(a.blockMin)), label: a.focusLabel ?? undefined, space: a.space }, new Date(now))
  write(b, { phase: 'focus', endsAt: now + m * 60_000, pausedLeft: null, startedAt: now, blockMin: m, focusLabel: a.focusLabel ?? null, ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.space ? { space: a.space } : {}) }, now)
  return { text: `Extended: a new ${m} minute block${a.focusLabel ? ` on "${a.focusLabel}"` : ''} is running${done >= 1 ? `; the ${Math.min(done, Number(a.blockMin))} minutes already worked were logged` : ''}.` }
}

/** pomodoro.tsx startBreak. A running focus block must be stopped first (its minutes would be lost). */
export function startBreak(b: Blob, minutes: number, now = Date.now()): { text: string } {
  const m = mins(minutes, 'minutes')
  const a = running(b)
  if (a && a.phase === 'focus') throw new McError(`A focus block ${label(a)} is still ${a.pausedLeft != null ? 'paused' : 'running'}. Call stop_focus first (it logs what was worked), then start the break.`)
  write(b, { phase: 'break', endsAt: now + m * 60_000, pausedLeft: null, startedAt: now, blockMin: m, focusLabel: null }, now)
  return { text: `Break started: ${m} minutes.` }
}

/** What is running, for a read. */
export function focusStatus(b: Blob, now = Date.now()): Row {
  const a = running(b)
  if (!a) return { running: false, note: 'No focus or break timer is running (a block that just finished and awaits his decision also reads as nothing running).' }
  const left = secondsLeft(a, now)
  return {
    running: true, phase: a.phase, paused: a.pausedLeft != null, secondsLeft: left, left: fmt(left), blockMinutes: a.blockMin,
    label: a.focusLabel ?? null, taskId: a.taskId ?? null, space: a.space ?? null, started: new Date(a.startedAt).toISOString(),
    ...(a.phase === 'focus' && left === 0 && a.pausedLeft == null ? { warning: 'Its time is up and it has not been logged yet. A device that opens will log it, or call stop_focus.' } : {}),
    startedBy: a.dev === 'claude-mcp' ? 'Claude' : 'a device',
  }
}

