/* PLANNER. Split out of store.tsx (2026-09-10), the second of the two
   cohesive slices in the store.tsx split. Tasks and Projects only -- the
   places a task-completion genuinely reaches into Ledger, Focus or the
   auto-habit-tick (logActual, logSubtaskActual) stay as glue in store.tsx
   itself, the same role applyExternal already plays, since they need
   autoFrom/setLedger/setFocusSessions from the Growth side. Nothing here
   needs anything back from Growth except setPlan, for the one place a task
   move touches the weekly plan's returnedIds bookkeeping. */
import { useState } from 'react'
import { MOCK_TASKS } from '../mock'
import { rowKey } from '../sync-merge'
import type { GoalTimeframe, PlanState, Project, SpaceId, Task, TimeSlot } from '../types'
import { goalPeriodKey, slotForTime, type GoalTf } from '../util'
import { newId, todayKey } from './shared'

export function usePlannerSlice(
  persisted: { tasks?: Task[]; projects?: Project[] } | null,
  deps: {
    armUndo: (label: string, restore: () => void) => void
    bury: (...keys: string[]) => void
    digUp: (...keys: string[]) => void
    openProjectId: string | null
    setOpenProject: (id: string | null) => void
    setPlan: (fn: (prev: PlanState) => PlanState) => void
  },
) {
  const { armUndo, bury, digUp, openProjectId, setOpenProject, setPlan } = deps
  const [tasks, setTasks] = useState(persisted?.tasks ?? MOCK_TASKS)
  const [projects, setProjects] = useState<Project[]>(persisted?.projects ?? [])

  return {
    tasks, setTasks, projects, setProjects,

    addProject: (name: string, sp: SpaceId) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setProjects((prev) => [...prev, { id: newId('proj'), name: trimmed, space: sp, createdAt: todayKey() }])
    },
    renameProject: (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
    },
    /** 'move' keeps the project's tasks -- they just lose the projectId and
     *  stand as ordinary tasks in the Space's own Plan, exactly where they'd
     *  already have been showing up all along. 'delete' takes them with it. */
    deleteProject: (id: string, mode: 'move' | 'delete') => {
      const beforeProjects = projects
      const beforeTasks = tasks
      const gone = projects.find((p) => p.id === id)
      const theirs = tasks.filter((t) => t.projectId === id)
      const keys = [rowKey('projects', { id }), ...(mode === 'delete' ? theirs.map((t) => rowKey('tasks', { id: t.id })) : [])]

      setProjects((prev) => prev.filter((p) => p.id !== id))
      if (mode === 'delete') setTasks((prev) => prev.filter((t) => t.projectId !== id))
      else setTasks((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)))
      bury(...keys)
      if (openProjectId === id) setOpenProject(null)

      const label = gone
        ? mode === 'delete' && theirs.length
          ? `Deleted "${gone.name}" and ${theirs.length} ${theirs.length === 1 ? 'task' : 'tasks'}`
          : `Deleted project "${gone.name}"`
        : 'Project deleted'
      armUndo(label, () => { setProjects(beforeProjects); setTasks(beforeTasks); digUp(...keys) })
    },
    setTaskProject: (id: string, projectId: string | undefined) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, projectId } : t))),

    /* Reopening a task clears the time that was logged against it, so "skip"
       genuinely means no time recorded instead of resurfacing an old number. */
    /* A task with steps is done when you say it is done, so its steps go with it.
       Leaving them unticked underneath a finished parent was the app disagreeing
       with itself. Reopening puts them all back. */
    toggleTask: (id: string) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        const done = !t.done
        return {
          ...t,
          done,
          // Finishing is a moment, and the calendar wants to know which one.
          doneAt: done ? new Date().toISOString() : undefined,
          actualMin: t.done ? undefined : t.actualMin,
          subtasks: t.subtasks?.map((sub) => ({ ...sub, done, actualMin: done ? sub.actualMin : undefined })),
        }
      })),
    updateTask: (id: string, patch: { title?: string; estimateMin?: number }) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        const title = patch.title !== undefined && patch.title.trim() ? patch.title.trim() : t.title
        // A breakdown owns the estimate; a bare number only applies without one.
        const est = patch.estimateMin !== undefined && !t.subtasks?.length
          ? { estimateMin: Math.max(1, Math.round(patch.estimateMin)), estimated: true }
          : {}
        return { ...t, title, ...est }
      })),

    /** Returns the new row's id, so a caller that needs to undo its own add
     *  (the assistant's per-line revert, assistantcore.tsx) has something
     *  real to delete rather than guessing which row it just made. */
    addTask: (t: Omit<Task, 'id' | 'done'>): string => {
      const id = newId('t')
      setTasks((prev) => [{ ...t, id, done: false, createdAt: todayKey(), addedAt: Date.now() }, ...prev])
      return id
    },
    addTasks: (ts: Omit<Task, 'id' | 'done'>[]) =>
      setTasks((prev) => [...ts.map((t, i) => ({ ...t, id: newId('t'), done: false, createdAt: todayKey(), addedAt: Date.now() + i })), ...prev]),
    addTaskWithSubtasks: (parent: Omit<Task, 'id' | 'done' | 'subtasks'>, subs: { title: string; estimateMin: number }[]) =>
      setTasks((prev) => {
        const pid = newId('t')
        const subtasks = subs.map((sub, i) => ({ id: `${pid}s${i}`, title: sub.title, estimateMin: sub.estimateMin, done: false }))
        const est = subtasks.reduce((a, s) => a + s.estimateMin, 0)
        return [{ ...parent, id: pid, done: false, createdAt: todayKey(), addedAt: Date.now(), estimateMin: est, estimated: true, subtasks }, ...prev]
      }),
    commitTask: (id: string, horizon?: GoalTimeframe, key?: string) =>
      setTasks((prev) => prev.map((t) => (t.id === id
        ? {
          ...t,
          horizon,
          horizonKey: horizon ? (key ?? goalPeriodKey(horizon as GoalTf)) : undefined,
        }
        : t))),
    /* The to-do list sorts newest-added first, so a task sent back to it needs
       a fresh addedAt or it reappears wherever its ORIGINAL creation time
       ranked it -- his report: send it back after adding ten other things,
       and it lands 11th, not first. Coming back to the pool is a fresh arrival
       on the list, same as if he'd just typed it. */
    moveTaskList: (id: string, list: 'today' | 'backlog', day?: string) => {
      setTasks((prev) => prev.map((t) => (t.id === id
        ? { ...t, list, plannedOn: list === 'today' ? (day ?? todayKey()) : undefined, addedAt: list === 'backlog' ? Date.now() : t.addedAt }
        : t)))
      /* His report: replan a returned task, decide mid-day it's not
         happening, send it back to the list yourself -- and the "you did not
         finish this" banner comes right back, even though you just handled
         it. returnedIds is stamped once at the overnight rollover and never
         touched again, so a task cycling backlog -> today -> backlog the
         same day still matches that morning's stale set the moment it lands
         back in backlog. A deliberate move by him is not a fresh miss, so it
         drops out of the set for good -- the NEXT rollover is what decides
         whether it counts as carried again, same as it always did. */
      if (list === 'backlog') {
        setPlan((p) => {
          if (!p.returnedIds?.includes(id)) return p
          const returnedIds = p.returnedIds.filter((x) => x !== id)
          return { ...p, returnedIds, returnedCount: returnedIds.length }
        })
      }
    },
    moveTasksToToday: (ids: string[], day?: string) =>
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, list: 'today', slot: undefined, plannedOn: day ?? todayKey() } : t))),
    assignSlot: (id: string, slot: TimeSlot | undefined) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, slot } : t))),
    /* A clock time implies a part of the day, so setting one moves the task into
       the matching bucket. Leaving them free to disagree meant a task could read
       9 AM on the schedule and sit under Evening in the list. */
    /* Giving a task a time puts it on today. TAKING the time away must not:
       "Back to the list" clears the time as part of sending a task away, and
       this forced list back to 'today' every time, so the task never left. */
    setTaskAt: (id: string, at: string | undefined) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        if (!at) return { ...t, at: undefined }
        return { ...t, at, list: 'today' as const, plannedOn: t.plannedOn ?? todayKey(), slot: slotForTime(at) }
      })),
    /* A breakdown is generated, so it is a first draft: wrong wording, wrong
       minutes, sometimes a step that is not his at all. Both edits re-derive the
       parent's estimate, because with a breakdown present the parent's number IS
       the sum of its steps, and leaving it stale would quietly misreport the day. */
    updateSubtask: (taskId: string, subId: string, patch: { title?: string; estimateMin?: number }) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId || !t.subtasks) return t
        const subtasks = t.subtasks.map((s) => (s.id === subId
          ? { ...s, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.estimateMin !== undefined ? { estimateMin: Math.max(1, patch.estimateMin) } : {}) }
          : s))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, s) => a + s.estimateMin, 0), estimated: true }
      })),
    deleteSubtask: (taskId: string, subId: string) => {
      const before = tasks
      const t = tasks.find((x) => x.id === taskId)
      const gone = t?.subtasks?.find((s) => s.id === subId)
      armUndo(gone ? `Removed "${gone.title}"` : 'Step removed', () => setTasks(before))
      setTasks((prev) => prev.map((x) => {
        if (x.id !== taskId || !x.subtasks) return x
        const subtasks = x.subtasks.filter((s) => s.id !== subId)
        /* The last step going leaves a plain task. Its estimate came from the
           steps, so with none left the number is whatever the final step
           happened to be, which is not the size of the task: keep it as a
           starting point but stop calling it an estimate. */
        if (!subtasks.length) return { ...x, subtasks: undefined, estimated: false }
        return { ...x, subtasks, estimateMin: subtasks.reduce((a, s) => a + s.estimateMin, 0), estimated: true }
      }))
    },
    toggleSubtask: (taskId: string, subId: string) =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.subtasks
            ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done, actualMin: s.done ? undefined : s.actualMin } : s)) }
            : t,
        ),
      ),
    deleteTask: (id: string) => {
      const before = tasks
      const gone = tasks.find((t) => t.id === id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      bury(rowKey('tasks', { id }))
      armUndo(gone ? `Deleted "${gone.title}"` : 'Task deleted', () => { setTasks(before); digUp(rowKey('tasks', { id })) })
    },
    setSubtasks: (taskId: string, subs: { title: string; estimateMin: number }[]) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t
        const subtasks = subs.map((s, i) => ({ id: `${taskId}s${i}${Date.now().toString(36)}`, title: s.title, estimateMin: s.estimateMin, done: false }))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, x) => a + x.estimateMin, 0), estimated: true }
      })),
    setEstimate: (taskId: string, minutes: number) =>
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, estimateMin: Math.max(1, Math.round(minutes)), estimated: true } : t))),
  }
}
