/* ASSISTANT LOG. Split out of store.tsx (2026-09-10). What voice dictation
   created (a task, a goal, a "done") and a way to take it back. Genuinely
   reaches into Tasks and Goals -- a dictated item literally IS a task or
   goal row -- so those two setters come in as deps rather than being
   duplicated here, the same way notes/contacts take armUndo/bury/digUp. */
import { useState } from 'react'
import type { AssistantEntry, Goal, SpaceId, Task } from '../types'
import { goalPeriodKey } from '../util'
import { newId, todayKey } from './shared'

export interface AssistantSlice {
  assistantLog: AssistantEntry[]
  setAssistantLog: (next: AssistantEntry[]) => void
  applyDictation: (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]) => void
  revertAssistantItem: (entryId: string, itemId: string) => void
}

export function useAssistantSlice(
  persisted: { assistantLog?: AssistantEntry[] } | null,
  deps: {
    space: SpaceId
    setTasks: (fn: (prev: Task[]) => Task[]) => void
    setGoals: (fn: (prev: Goal[]) => Goal[]) => void
  },
): AssistantSlice {
  const { space, setTasks, setGoals } = deps
  const [assistantLog, setAssistantLog] = useState<AssistantEntry[]>(persisted?.assistantLog ?? [])

  const applyDictation = (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]): void => {
    const created: AssistantEntry['items'] = []
    const newTasks: Task[] = []
    const newGoals: Goal[] = []
    items.forEach((it) => {
      const id = newId('a')
      if (it.kind === 'goal') {
        newGoals.push({ id, space, name: it.text, current: 0, target: 1, unit: 'done', note: 'added by assistant', timeframe: 'weekly', category: 'life', periodKey: goalPeriodKey('weekly') })
        created.push({ id, kind: 'goal', label: it.text, tab: 'goals' })
      } else {
        const done = it.kind === 'done'
        /* A dictated "done" carries no measured time. Stamping actualMin with
           the default estimate would invent a perfect log and pollute the
           accuracy figure, so it stays undefined unless you said a number. */
        newTasks.push({ id, title: it.text, source: 'mc', estimateMin: it.estimateMin ?? 15, done, actualMin: done ? it.estimateMin : undefined, createdAt: todayKey(), plannedOn: todayKey(), space, list: 'today', category: 'quick' })
        created.push({ id, kind: it.kind, label: it.text, tab: done ? 'today' : 'plan' })
      }
    })
    if (newTasks.length) setTasks((prev) => [...newTasks, ...prev])
    if (newGoals.length) setGoals((prev) => [...prev, ...newGoals])
    setAssistantLog((prev) => [{ id: newId('log'), text, when: todayKey(), items: created }, ...prev])
  }

  const revertAssistantItem = (entryId: string, itemId: string): void => {
    const entry = assistantLog.find((e) => e.id === entryId)
    const item = entry?.items.find((i) => i.id === itemId)
    if (item) {
      if (item.kind === 'goal') setGoals((p) => p.filter((g) => g.id !== item.id))
      else setTasks((p) => p.filter((t) => t.id !== item.id))
    }
    setAssistantLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, items: e.items.filter((i) => i.id !== itemId) } : e)).filter((e) => e.items.length))
  }

  return { assistantLog, setAssistantLog, applyDictation, revertAssistantItem }
}
