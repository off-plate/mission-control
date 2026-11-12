/* FINISHED WORK. The ledger (estimate against actual, one row per finished
   thing) and the focus blocks (every finished stretch of focus), plus the
   completions that write both at once: finishing a task, finishing the last
   step of one, a Pomodoro block ending. They live together because each of
   those actions writes a ledger row AND a focus block that share an id, and
   then lets the measured habits re-read the total. Moved out of store.tsx
   unchanged (2026-11-12). */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import { isoWeekKey } from '../util'
import { MOCK_LEDGER } from '../mock'
import { focusNeedMin } from '../types'
import type { FocusSession, Goal, HabitDef, HabitTick, LedgerEntry, SpaceId, Task, TaskCategory } from '../types'
import { newId, todayKey } from './shared'
import type { useGrowthSlice } from './growth'
import type { usePlannerSlice } from './planner'

type Growth = ReturnType<typeof useGrowthSlice>
type Planner = ReturnType<typeof usePlannerSlice>

export function useLedgerSlice(
  persisted: { ledger?: LedgerEntry[]; focusSessions?: FocusSession[] } | null,
  deps: {
    space: SpaceId
    inView: (s?: SpaceId) => boolean
    tasks: Task[]
    setTasks: Planner['setTasks']
    habits: HabitDef[]
    setHabits: Growth['setHabits']
    habitLog: HabitTick[]
    setHabitLog: Growth['setHabitLog']
    editHabitLog: Growth['editHabitLog']
    goals: Goal[]
    bumpGoal: Growth['bumpGoal']
    armUndo: (label: string, restore: () => void) => void
    bury: (...keys: string[]) => void
    digUp: (...keys: string[]) => void
  },
) {
  const { space, inView, tasks, setTasks, habits, setHabits, habitLog, setHabitLog, editHabitLog, goals, bumpGoal, armUndo, bury, digUp } = deps
  const [ledger, setLedger] = useState(persisted?.ledger ?? MOCK_LEDGER)
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(persisted?.focusSessions ?? [])

  /* "This week" means this week: only rows from the current ISO week count, and
     only from the profile you are looking at. Rows seeded by the demo carry no
     week/space and are treated as this week's so the demo still shows numbers.
     Net, including overruns; the headline equals the sum of the visible rows. */
  const weekLedger = ledger.filter(
    (e) => (!e.weekKey || e.weekKey === isoWeekKey()) && inView(e.space),
  )
  const savedMin = weekLedger.reduce((acc, e) => acc + (e.estimateMin - e.actualMin), 0)
  const accuracyPct = Math.round(
    (weekLedger.filter((e) => Math.abs(e.actualMin - e.estimateMin) <= e.estimateMin * 0.25).length /
      Math.max(1, weekLedger.length)) * 100,
  )

  /* A habit the app keeps for him. Focus minutes are already measured, so a
     habit that only says "did you focus for an hour" should never need a tick:
     it reads the total and answers itself. `extra` is the block currently on the
     clock, because an hour that is still running is still an hour. The rule runs
     over every day in the record, so correcting or deleting a block takes back a
     day it no longer earns. */
  const autoFrom = (sessions: FocusSession[], extra: number, extraLabel?: string) => {
    const today = todayKey()
    const rules = habits.filter((h) => h.auto?.from === 'focus' && !h.archivedAt)
    if (!rules.length) return
    const days = new Set(sessions.map((s) => s.day))
    days.add(today)
    let next = habitLog
    for (const h of rules) {
      const src = `auto:focus:${h.id}`
      for (const day of days) {
        const mins = sessions.filter((s) => s.day === day).reduce((a, s) => a + s.minutes, 0)
          + (day === today ? extra : 0)
        const has = next.some((t) => t.habitId === h.id && t.day === day && t.src === src)
        const earns = mins >= focusNeedMin(h)
        if (earns && !has) next = [...next, { habitId: h.id, day, src, at: day === today ? new Date().toISOString() : undefined }]
        if (!earns && has) next = next.filter((t) => !(t.habitId === h.id && t.day === day && t.src === src))
      }
    }
    if (next === habitLog) return
    editHabitLog(next)
    const idx = (new Date().getDay() + 6) % 7
    setHabits((prev) => prev.map((h) => (rules.some((r) => r.id === h.id)
      ? { ...h, days: h.days.map((d, i) => (i === idx ? next.some((t) => t.habitId === h.id && t.day === today) : d)) }
      : h)))
  }

  /* One writer for finished focus, whatever day it belongs to. A block that
     crosses midnight banks its first half onto yesterday through this exact
     path, so both halves look identical to everything downstream. */
  /* Which workspace a block's WORK belongs to: the task it names, wherever he
     happened to be standing when the timer rang. Big Time work done while the
     app showed Personal is still Big Time work. */
  const spaceOfLabel = (label?: string): SpaceId => {
    if (label) {
      const want = label.trim().toLowerCase()
      const t = tasks.find((x) => x.title.trim().toLowerCase() === want)
      if (t) return t.space
      const holder = tasks.find((x) => x.subtasks?.some((st) => st.title.trim().toLowerCase() === want))
      if (holder) return holder.space
    }
    return space
  }

  const logFocusOn = (day: string, minutes: number, label?: string, at?: string) => {
    if (minutes <= 0) return
    const mins = Math.round(minutes)
    const lid = newId('l')
    const next = [{ id: newId('f'), day, minutes: mins, label, space: spaceOfLabel(label), ledgerId: lid, at: at ?? new Date().toISOString() }, ...focusSessions]
    setFocusSessions(next)
    setLedger((prev) => [
      { id: lid, title: label ? `Focus: ${label}` : 'Focus block', category: 'deep' as TaskCategory,
        estimateMin: mins, actualMin: mins, when: day, space, weekKey: isoWeekKey(new Date(`${day}T12:00:00`)) },
      ...prev,
    ])
    autoFrom(next, 0)
  }

  /* A task tied to a weekly goal moves that goal when it is finished, and moves
     it back when it is reopened. Only a goal still running: last week's result
     is history and a late tick must not rewrite it. */
  const creditGoal = (t: Task | undefined, sign: 1 | -1) => {
    if (!t?.goalId) return
    const g = goals.find((x) => x.id === t.goalId)
    if (!g || g.closed || g.habitId) return
    bumpGoal(g.id, sign * (t.goalAmt ?? 1))
  }

  /* A finished block is recorded once, and everything that cares reads from
     here: measured habits fill from it, and the ledger gets it so focus time
     counts toward estimate accuracy instead of vanishing. */
  const logFocus = (minutes: number, label?: string) => logFocusOn(todayKey(), minutes, label, new Date().toISOString())
  const updateFocus = (id: string, patch: { minutes?: number; label?: string }) => {
    const next = focusSessions.map((f) => (f.id === id
      ? { ...f, ...(patch.minutes !== undefined ? { minutes: Math.max(1, Math.round(patch.minutes)) } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) }
      : f))
    setFocusSessions(next)
    const f = next.find((x) => x.id === id)
    // The ledger row is the same block seen from the other side; keep them equal.
    if (f?.ledgerId) {
      setLedger((prev) => prev.map((l) => (l.id === f.ledgerId
        ? { ...l, estimateMin: f.minutes, actualMin: f.minutes, title: f.label ? `Focus: ${f.label}` : 'Focus block' }
        : l)))
    }
    autoFrom(next, 0)
  }
  const deleteFocus = (id: string) => {
    const gone = focusSessions.find((f) => f.id === id)
    const beforeF = focusSessions, beforeL = ledger, beforeH = habitLog
    const keys = [rowKey('focusSessions', { id }), ...(gone?.ledgerId ? [rowKey('ledger', { id: gone.ledgerId })] : [])]
    armUndo(gone ? `Removed a ${gone.minutes}m focus block` : 'Focus block removed', () => {
      setFocusSessions(beforeF); setLedger(beforeL); setHabitLog(beforeH); digUp(...keys)
    })
    const next = focusSessions.filter((f) => f.id !== id)
    setFocusSessions(next)
    bury(...keys)
    if (gone?.ledgerId) setLedger((prev) => prev.filter((l) => l.id !== gone.ledgerId))
    autoFrom(next, 0)
  }
  const syncAutoHabits = (extraMin = 0, label?: string) => autoFrom(focusSessions, extraMin, label)

  const logActual = (id: string, actualMin: number) => {
    const t = tasks.find((x) => x.id === id)
    if (t && !t.done) creditGoal(t, 1)
    setTasks((prev) => prev.map((x) => (x.id === id
      ? { ...x, done: true, doneAt: x.doneAt ?? new Date().toISOString(), actualMin, subtasks: x.subtasks?.map((sub) => ({ ...sub, done: true })) }
      : x)))
    if (t && t.actualMin === undefined) {
      const lid = newId('l')
      setLedger((prev) => [
        { id: lid, title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin, when: todayKey(), space: t.space, weekKey: isoWeekKey() },
        ...prev,
      ])
      /* Real time on a task is real time whether or not the Pomodoro timer
         ran for it. His report: he often works a task with Focus never
         started, then logs the true minutes when he ticks it off, and
         every counter that reads focusSessions -- Today, the measured
         habits, Goals fed by one -- was blind to that time because this
         path never wrote one. Sharing lid keeps the block attached to the
         same ledger row logActual already writes, rather than a second,
         orphaned one. */
      const next = [{ id: newId('f'), day: todayKey(), minutes: actualMin, label: t.title, space: t.space, ledgerId: lid, at: new Date().toISOString() }, ...focusSessions]
      setFocusSessions(next)
      autoFrom(next, 0)
    }
  }

  /* Logging the LAST subtask closes the parent task and writes one ledger row
     for the whole thing, so subtasked work reaches Review the same as flat work. */
  const logSubtaskActual = (taskId: string, subId: string, actualMin: number) => {
    const parent = tasks.find((x) => x.id === taskId)
    const subs = (parent?.subtasks ?? []).map((s) => (s.id === subId ? { ...s, done: true, actualMin } : s))
    const allDone = subs.length > 0 && subs.every((s) => s.done)
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId && t.subtasks
        ? { ...t, subtasks: subs, done: allDone || t.done, doneAt: allDone && !t.done ? new Date().toISOString() : t.doneAt }
        : t)),
    )
    if (parent && allDone && !parent.done) {
      creditGoal(parent, 1)
      const est = subs.reduce((a, s) => a + s.estimateMin, 0)
      const act = subs.reduce((a, s) => a + (s.actualMin ?? s.estimateMin), 0)
      const lid = newId('l')
      setLedger((prev) => [
        { id: lid, title: parent.title, category: parent.category, estimateMin: est, actualMin: act, when: todayKey(), space: parent.space, weekKey: isoWeekKey() },
        ...prev,
      ])
      /* Same as the flat-task path in logActual: the steps' real minutes
         count as focus even when Focus was never started for them. */
      const next = [{ id: newId('f'), day: todayKey(), minutes: act, label: parent.title, space: parent.space, ledgerId: lid, at: new Date().toISOString() }, ...focusSessions]
      setFocusSessions(next)
      autoFrom(next, 0)
    }
  }

  return {
    ledger, setLedger, focusSessions, setFocusSessions,
    weekLedger, savedMin, accuracyPct,
    autoFrom, creditGoal,
    logFocus, logFocusOn, updateFocus, deleteFocus, syncAutoHabits,
    logActual, logSubtaskActual,
  }
}
