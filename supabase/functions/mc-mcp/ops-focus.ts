/* Focus timer commands, as rows for the app's inbox (mc_inbox). Pure.

   The timer's state lives in each device's own localStorage, so nothing here can start
   it. A row is queued; an OPEN Mission Control claims it within ~15 s and starts the real
   timer (src/inbox-focus.ts). If no app is open the row waits, and is dropped after
   FOCUS_TTL_MIN minutes so a timer never starts hours later. */

import { McError, findTask, type Blob } from './ops.ts'

export const FOCUS_TTL_MIN = 10
export const MAX_FOCUS_MIN = 480

export interface InboxRow { id: string; owner: string; op: 'focus' | 'focusStop'; task_id: string | null; title: string | null; actual_min: number | null }

const taskMin = (t: Record<string, any>): number => {
  const st = Array.isArray(t.subtasks) ? t.subtasks : []
  return st.length ? st.reduce((a: number, s: any) => a + (Number(s.estimateMin) || 0), 0) : Number(t.estimateMin) || 0
}

const WAIT = `It is queued for your open Mission Control and starts there within about 15 seconds. This connector cannot see whether it started. If no device has Mission Control open within ${FOCUS_TTL_MIN} minutes, the request is dropped and nothing starts.`

export function startRow(b: Blob | null, uid: string, newId: string, i: { id?: string; title?: string; minutes?: number; label?: string }): { row: InboxRow; text: string } {
  if (i.minutes !== undefined && (!Number.isInteger(i.minutes) || i.minutes < 1 || i.minutes > MAX_FOCUS_MIN)) throw new McError(`minutes must be a whole number from 1 to ${MAX_FOCUS_MIN}.`)
  let task_id: string | null = null
  let title: string | null = i.label?.trim().slice(0, 300) || null
  let minutes = i.minutes ?? null
  if (i.id || i.title) {
    if (!b) throw new McError('No Mission Control data is saved for this account yet, so the task cannot be looked up.')
    const t = findTask(b, { id: i.id, title: i.title })
    if (t.done) throw new McError(`"${t.title}" is already done. Reopen it first, or start a focus without a task.`)
    task_id = String(t.id)
    title = String(t.title)
    const est = taskMin(t)
    if (minutes === null && est >= 1 && est <= MAX_FOCUS_MIN) minutes = Math.round(est)
  }
  const what = title ? ` on "${title}"` : ''
  const len = minutes ? `${minutes} minutes` : 'the length set in the app'
  return { row: { id: newId, owner: uid, op: 'focus', task_id, title, actual_min: minutes }, text: `Queued a focus${what} for ${len}. ${WAIT}` }
}

export function stopRow(uid: string, newId: string): { row: InboxRow; text: string } {
  return { row: { id: newId, owner: uid, op: 'focusStop', task_id: null, title: null, actual_min: null }, text: `Queued a stop. ${WAIT.replace('starts there', 'stops the running focus there').replace('nothing starts', 'nothing stops')} The time worked so far is kept.` }
}
