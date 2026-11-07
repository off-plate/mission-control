/* REMINDERS. Apple Reminders' shape (his ask, 2026-11-07): lists, a reminder
   time, flags, repeats, completed ones kept and hidden.

   Two synced collections like every other thing he makes, merged by id
   (sync-merge ENTITY_KEYS). The first list has a FIXED id, so two devices
   that both start empty agree on it instead of each making its own.

   Ticking a repeating reminder does what Apple does: this one is done and the
   next one appears at the next time. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { Reminder, ReminderList } from '../types'
import { newId } from './shared'

export const DEFAULT_LIST_ID = 'rl-reminders'
const DEFAULT_LISTS: ReminderList[] = [{ id: DEFAULT_LIST_ID, name: 'Reminders', color: 'blue', createdAt: 0, updatedAt: 0 }]

export type ReminderInput = { title: string; listId: string; notes?: string; remindAt?: string; flagged?: boolean; repeat?: Reminder['repeat'] }
export type ReminderPatch = Partial<Pick<Reminder, 'title' | 'notes' | 'listId' | 'remindAt' | 'repeat' | 'flagged'>>

const pad = (n: number) => String(n).padStart(2, '0')
export const toLocalStamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
export const fromLocalStamp = (s: string): Date => {
  const [day, time = '09:00'] = s.split('T')
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}
export function nextRepeat(stamp: string, repeat: NonNullable<Reminder['repeat']>): string {
  const d = fromLocalStamp(stamp)
  if (repeat === 'daily') d.setDate(d.getDate() + 1)
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return toLocalStamp(d)
}

export interface RemindersSlice {
  reminders: Reminder[]
  reminderLists: ReminderList[]
  setReminders: (next: Reminder[]) => void
  setReminderLists: (next: ReminderList[]) => void
  addReminder: (r: ReminderInput) => string
  updateReminder: (id: string, patch: ReminderPatch) => void
  toggleReminder: (id: string) => void
  deleteReminder: (id: string) => void
  addReminderList: (name: string, color: string) => string
  updateReminderList: (id: string, patch: Partial<Pick<ReminderList, 'name' | 'color'>>) => void
  deleteReminderList: (id: string) => void
}

export function useRemindersSlice(
  persisted: { reminders?: Reminder[]; reminderLists?: ReminderList[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): RemindersSlice {
  const { armUndo, bury, digUp } = deps
  const [reminders, setReminders] = useState<Reminder[]>(persisted?.reminders ?? [])
  const [reminderLists, setReminderListsRaw] = useState<ReminderList[]>(persisted?.reminderLists?.length ? persisted.reminderLists : DEFAULT_LISTS)
  /* A remote bundle with no lists yet must not leave him with nowhere to add. */
  const setReminderLists = (next: ReminderList[]) => setReminderListsRaw(next.length ? next : DEFAULT_LISTS)

  const addReminder = (r: ReminderInput): string => {
    const id = newId('rem'), now = Date.now()
    setReminders((prev) => [...prev, {
      id, title: r.title.trim(), notes: (r.notes ?? '').trim(), listId: r.listId,
      remindAt: r.remindAt, repeat: r.repeat, flagged: !!r.flagged, createdAt: now, updatedAt: now,
    }])
    return id
  }

  const updateReminder = (id: string, patch: ReminderPatch): void => setReminders((prev) => prev.map((r) => (r.id === id
    ? { ...r, ...patch, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), updatedAt: Date.now() }
    : r)))

  const toggleReminder = (id: string): void => setReminders((prev) => {
    const r = prev.find((x) => x.id === id)
    if (!r) return prev
    const now = Date.now()
    if (r.doneAt) return prev.map((x) => (x.id === id ? { ...x, doneAt: undefined, updatedAt: now } : x))
    const done = prev.map((x) => (x.id === id ? { ...x, doneAt: now, updatedAt: now } : x))
    if (!r.repeat || !r.remindAt) return done
    return [...done, { ...r, id: newId('rem'), remindAt: nextRepeat(r.remindAt, r.repeat), doneAt: undefined, createdAt: now, updatedAt: now }]
  })

  const deleteReminder = (id: string): void => {
    const before = reminders
    setReminders((prev) => prev.filter((r) => r.id !== id))
    bury(rowKey('reminders', { id }))
    armUndo('Reminder deleted', () => { setReminders(before); digUp(rowKey('reminders', { id })) })
  }

  const addReminderList = (name: string, color: string): string => {
    const id = newId('rl'), now = Date.now()
    setReminderListsRaw((prev) => [...prev, { id, name: name.trim() || 'New list', color, createdAt: now, updatedAt: now }])
    return id
  }

  const updateReminderList = (id: string, patch: Partial<Pick<ReminderList, 'name' | 'color'>>): void => setReminderListsRaw((prev) => prev.map((l) => (l.id === id
    ? { ...l, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() || l.name } : {}), updatedAt: Date.now() }
    : l)))

  /* A list goes with its reminders, and both come back on Undo. The last list stays. */
  const deleteReminderList = (id: string): void => {
    if (reminderLists.length <= 1) return
    const beforeLists = reminderLists, beforeRems = reminders
    const gone = reminders.filter((r) => r.listId === id).map((r) => rowKey('reminders', { id: r.id }))
    setReminderListsRaw((prev) => prev.filter((l) => l.id !== id))
    setReminders((prev) => prev.filter((r) => r.listId !== id))
    bury(rowKey('reminderLists', { id }), ...gone)
    armUndo('List deleted', () => { setReminderListsRaw(beforeLists); setReminders(beforeRems); digUp(rowKey('reminderLists', { id }), ...gone) })
  }

  return { reminders, reminderLists, setReminders, setReminderLists, addReminder, updateReminder, toggleReminder, deleteReminder, addReminderList, updateReminderList, deleteReminderList }
}
