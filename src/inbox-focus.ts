/* Focus commands that arrive through the inbox (mc_inbox), from the Claude connector.

   The timer lives in each device's own localStorage, so the server cannot start it. It
   queues a row; an OPEN app claims the row (claimInbox, every 15 s while visible) and this
   file decides what the row means. Pure on purpose: store.tsx hands the result to the
   Pomodoro provider as a window event, and the tests drive these functions directly.

   A command is only good for a few minutes. A "start" that sat in the queue while no app
   was open must NOT start a timer hours later; it is dropped, and the tool told him so. */

import type { Task } from './types'
import { taskMinutes } from './util'

export const FOCUS_OP_TTL_MS = 10 * 60 * 1000
export const FOCUS_EVENT = 'mc:focus-op'
const MAX_MIN = 480

export type FocusCmd = { do: 'start'; minutes?: number; label?: string } | { do: 'stop' }

interface Item { op: string; title?: string | null; task_id?: string | null; actual_min?: number | null; created_at?: string }

/** What an inbox row asks for, or null when it is not a focus row, is malformed, or is stale. */
export function focusCmdFromItem(it: Item, tasks: Pick<Task, 'id' | 'title' | 'estimateMin' | 'subtasks' | 'done'>[], now: number): FocusCmd | null {
  if (it.op !== 'focus' && it.op !== 'focusStop') return null
  const made = it.created_at ? Date.parse(it.created_at) : NaN
  if (!Number.isFinite(made) || now - made > FOCUS_OP_TTL_MS || made - now > 60_000) return null
  if (it.op === 'focusStop') return { do: 'stop' }
  let minutes: number | undefined
  if (it.actual_min != null) {
    if (!Number.isFinite(it.actual_min) || it.actual_min < 1 || it.actual_min > MAX_MIN) return null
    minutes = Math.round(it.actual_min)
  }
  const task = it.task_id ? tasks.find((t) => t.id === it.task_id) : undefined
  if (task?.done) return null
  const label = (task?.title ?? it.title ?? '').trim().slice(0, 300) || undefined
  if (minutes === undefined && task) {
    const m = taskMinutes(task as Task)
    if (m >= 1 && m <= MAX_MIN) minutes = Math.round(m)
  }
  return { do: 'start', minutes, label }
}

/** The running timer, as the Pomodoro provider holds it. */
export interface FocusControl { phase: 'idle' | 'focus' | 'break' | 'await'; startFocus: (minutes?: number, label?: string) => void; stop: () => void }

/** Apply a command to the timer. A start never replaces a focus block already running
 *  (paused counts as running): that block's time would be lost. A stop only stops a block. */
export function runFocusCmd(cmd: FocusCmd, ctl: FocusControl): 'started' | 'stopped' | 'skipped' {
  if (cmd.do === 'start') {
    if (ctl.phase === 'focus') return 'skipped'
    ctl.startFocus(cmd.minutes, cmd.label)
    return 'started'
  }
  if (ctl.phase !== 'focus' && ctl.phase !== 'break') return 'skipped'
  ctl.stop()
  return 'stopped'
}
