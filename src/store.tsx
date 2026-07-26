import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, saveRemoteState } from './supabase'
import {
  DEFAULT_SPACES,
  MOCK_GOALS,
  MOCK_HABITS,
  MOCK_LEDGER,
  MOCK_ROUTINES,
  MOCK_SOCIAL,
  MOCK_SOURCES,
  MOCK_TASKS,
  WIDGET_DEFS,
} from './mock'
import type {
  AssistantEntry,
  CoachFacts,
  CoachSession,
  Goal,
  Routine,
  HabitDef,
  LedgerEntry,
  PageId,
  PlanState,
  ReviewState,
  SizeKey,
  SocialEntry,
  SourceState,
  SpaceId,
  Task,
  TaskCategory,
  WidgetInstance,
  WidgetType,
} from './types'

export const STORAGE_KEY = 'mission-control-demo-v9'

interface PersistedState {
  version: 2
  spaces: Record<SpaceId, WidgetInstance[]>
  tasks: Task[]
  habits: HabitDef[]
  goals: Goal[]
  ledger: LedgerEntry[]
  social: SocialEntry[]
  sources: SourceState[]
  plan: PlanState
  review: ReviewState
  assistantLog: AssistantEntry[]
  coachSessions: CoachSession[]
  routines: Routine[]
}

interface Store extends PersistedState {
  space: SpaceId
  setSpace: (s: SpaceId) => void
  page: PageId
  setPage: (p: PageId) => void
  editing: boolean
  setEditing: (v: boolean) => void
  focusTaskId: string | null
  setFocusTaskId: (id: string | null) => void
  coachOpen: string | null
  setCoachOpen: (id: string | null) => void

  reorderSpace: (space: SpaceId, order: string[]) => void
  resizeWidget: (space: SpaceId, id: string, size: SizeKey) => void
  removeWidget: (space: SpaceId, id: string) => void
  addWidget: (space: SpaceId, type: WidgetType) => void
  moveWidget: (space: SpaceId, id: string, dir: -1 | 1) => void

  toggleTask: (id: string) => void
  logActual: (id: string, actualMin: number) => void
  addTask: (t: Omit<Task, 'id' | 'done'>) => void
  addTasks: (tasks: Omit<Task, 'id' | 'done'>[]) => void
  addTaskWithSubtasks: (parent: Omit<Task, 'id' | 'done' | 'subtasks'>, subs: { title: string; estimateMin: number }[]) => void
  moveTaskList: (id: string, list: 'today' | 'backlog') => void
  moveTasksToToday: (ids: string[]) => void
  assignSlot: (id: string, slot: import('./types').TimeSlot | undefined) => void
  toggleSubtask: (taskId: string, subId: string) => void
  logSubtaskActual: (taskId: string, subId: string, actualMin: number) => void
  deleteTask: (id: string) => void

  toggleHabitDay: (id: string, day: number) => void
  markHabitDay: (id: string, day: number, value: boolean) => void
  addHabit: (name: string, daypart?: import('./types').TimeSlot) => void
  togglePauseHabit: (id: string) => void
  deleteHabit: (id: string) => void

  addGoal: (g: Omit<Goal, 'id'>) => void
  bumpGoal: (id: string, delta: number) => void
  deleteGoal: (id: string) => void

  setSocial: (entries: SocialEntry[]) => void
  toggleSource: (id: string) => void

  commitPlan: (taskIds: string[], firstMoveId: string | null) => void
  finishReview: (wins: string[], outcomes: string[]) => void

  assistantLog: AssistantEntry[]
  applyDictation: (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]) => void
  revertAssistantItem: (entryId: string, itemId: string) => void

  coachSessions: CoachSession[]
  startCoachSession: (input: { title: string; facts: CoachFacts; firstStep: string; firstStepMin: number; category: TaskCategory }) => void
  reflectCoachSession: (id: string, didIt: boolean, felt: CoachSession['felt'], reflection: string) => void
  deleteCoachSession: (id: string) => void

  routines: Routine[]
  toggleRoutineStep: (routineId: string, stepId: string) => void
  resetRoutine: (routineId: string) => void

  todayIndex: number
  savedMin: number
  accuracyPct: number
  resetDemo: () => void
}

const Ctx = createContext<Store | null>(null)

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PersistedState
    return p.version === 2 ? p : null
  } catch {
    return null
  }
}

function pageFromHash(): PageId {
  const h = location.hash.replace('#/', '')
  const pages: PageId[] = ['today', 'plan', 'assistant', 'habits', 'routines', 'goals', 'money', 'review', 'coach', 'stats', 'settings']
  return (pages as string[]).includes(h) ? (h as PageId) : 'today'
}

let uid = 100
const todayKey = () => new Date().toISOString().slice(0, 10)

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const seedTodayIdx = (new Date().getDay() + 6) % 7
  const seededHabits = useMemo(
    () => MOCK_HABITS.map((h) => ({ ...h, days: h.days.map((d, i) => (i <= seedTodayIdx ? d : false)) })),
    [seedTodayIdx],
  )
  const seededGoals = useMemo(() => {
    const sleep = seededHabits.find((h) => h.id === 'h1')
    const sleepNights = sleep ? sleep.days.filter(Boolean).length : 0
    return MOCK_GOALS.map((g) => (g.id === 'g2' ? { ...g, current: sleepNights } : g))
  }, [seededHabits])
  const [spaces, setSpaces] = useState(persisted?.spaces ?? DEFAULT_SPACES)
  const [tasks, setTasks] = useState(persisted?.tasks ?? MOCK_TASKS)
  const [habits, setHabits] = useState(persisted?.habits ?? seededHabits)
  const [goals, setGoals] = useState(persisted?.goals ?? seededGoals)
  const [ledger, setLedger] = useState(persisted?.ledger ?? MOCK_LEDGER)
  const [social, setSocialState] = useState(persisted?.social ?? MOCK_SOCIAL)
  const [sources, setSources] = useState(persisted?.sources ?? MOCK_SOURCES)
  const [plan, setPlan] = useState<PlanState>(persisted?.plan ?? { committedDate: null, firstMoveId: null })
  const [review, setReview] = useState<ReviewState>(persisted?.review ?? { lastDoneDate: null, wins: [], outcomes: [] })
  const [assistantLog, setAssistantLog] = useState<AssistantEntry[]>(persisted?.assistantLog ?? [])
  const [coachSessions, setCoachSessions] = useState<CoachSession[]>(persisted?.coachSessions ?? [])
  const [routines, setRoutines] = useState<Routine[]>(persisted?.routines ?? MOCK_ROUTINES)
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const [space, setSpace] = useState<SpaceId>('personal')
  const [page, setPageState] = useState<PageId>(pageFromHash)
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-space', space)
  }, [space])

  useEffect(() => {
    const onHash = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setPage = (p: PageId) => {
    location.hash = `/${p}`
    setPageState(p)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const state: PersistedState = {
      version: 2, spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines,
    }
    const json = JSON.stringify(state)
    try {
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      /* localStorage full or unavailable; Supabase (if configured) is the source of truth */
    }
    // Mirror to Supabase when configured, debounced so rapid edits collapse into one write.
    if (SUPABASE_ENABLED) {
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = window.setTimeout(() => { void saveRemoteState(json) }, 800)
    }
  }, [spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines])

  /* Demo pretends today is Sunday when the real weekday is irrelevant;
     habits use the real weekday so checking off feels true. */
  const todayIndex = (new Date().getDay() + 6) % 7

  /* Net, including overruns; the headline must equal the sum of the visible ledger rows. */
  const savedMin = ledger.reduce((acc, e) => acc + (e.estimateMin - e.actualMin), 0)
  const accuracyPct = Math.round(
    (ledger.filter((e) => Math.abs(e.actualMin - e.estimateMin) <= e.estimateMin * 0.25).length /
      Math.max(1, ledger.length)) * 100,
  )

  const value: Store = {
    version: 2,
    spaces, tasks, habits, goals, ledger, social, sources, plan, review, routines,
    space, setSpace,
    page, setPage,
    editing, setEditing,
    focusTaskId, setFocusTaskId,
    coachOpen, setCoachOpen,

    reorderSpace: (sp, order) =>
      setSpaces((prev) => {
        const byId = new Map(prev[sp].map((w) => [w.id, w]))
        const next = order.map((id) => byId.get(id)).filter(Boolean) as WidgetInstance[]
        for (const w of prev[sp]) if (!order.includes(w.id)) next.push(w)
        return { ...prev, [sp]: next }
      }),

    resizeWidget: (sp, id, size) =>
      setSpaces((prev) => ({ ...prev, [sp]: prev[sp].map((w) => (w.id === id ? { ...w, size } : w)) })),

    removeWidget: (sp, id) =>
      setSpaces((prev) => ({ ...prev, [sp]: prev[sp].filter((w) => w.id !== id) })),

    addWidget: (sp, type) =>
      setSpaces((prev) => ({
        ...prev,
        [sp]: [...prev[sp], { id: `${type}-${++uid}`, type, size: WIDGET_DEFS[type].defaultSize }],
      })),

    moveWidget: (sp, id, dir) =>
      setSpaces((prev) => {
        const list = [...prev[sp]]
        const i = list.findIndex((w) => w.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return prev
        ;[list[i], list[j]] = [list[j], list[i]]
        return { ...prev, [sp]: list }
      }),

    toggleTask: (id) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),

    logActual: (id, actualMin) => {
      const t = tasks.find((x) => x.id === id)
      setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, done: true, actualMin } : x)))
      if (t && t.actualMin === undefined) {
        setLedger((prev) => [
          { id: `l-${++uid}`, title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin, when: 'now' },
          ...prev,
        ])
      }
    },

    addTask: (t) => setTasks((prev) => [{ ...t, id: `t-${++uid}`, done: false }, ...prev]),
    addTasks: (ts) =>
      setTasks((prev) => [...ts.map((t) => ({ ...t, id: `t-${++uid}`, done: false })), ...prev]),
    addTaskWithSubtasks: (parent, subs) =>
      setTasks((prev) => {
        const pid = `t-${++uid}`
        const subtasks = subs.map((sub, i) => ({ id: `${pid}s${i}`, title: sub.title, estimateMin: sub.estimateMin, done: false }))
        const est = subtasks.reduce((a, s) => a + s.estimateMin, 0)
        return [{ ...parent, id: pid, done: false, estimateMin: est, subtasks }, ...prev]
      }),
    moveTaskList: (id, list) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, list } : t))),
    moveTasksToToday: (ids) =>
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, list: 'today', slot: undefined } : t))),
    assignSlot: (id, slot) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, slot } : t))),
    toggleSubtask: (taskId, subId) =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.subtasks
            ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done, actualMin: s.done ? undefined : s.actualMin } : s)) }
            : t,
        ),
      ),
    logSubtaskActual: (taskId, subId, actualMin) =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId && t.subtasks
            ? { ...t, subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: true, actualMin } : s)) }
            : t,
        ),
      ),
    deleteTask: (id) => setTasks((prev) => prev.filter((t) => t.id !== id)),

    toggleHabitDay: (id, day) =>
      setHabits((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, days: h.days.map((d, i) => (i === day ? !d : d)) } : h,
        ),
      ),
    markHabitDay: (id, day, value) =>
      setHabits((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, days: h.days.map((d, i) => (i === day ? value : d)) } : h,
        ),
      ),
    addHabit: (name, daypart) =>
      setHabits((prev) => [...prev, { id: `h-${++uid}`, name, daypart, days: [false, false, false, false, false, false, false], paused: false }]),
    togglePauseHabit: (id) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, paused: !h.paused } : h))),
    deleteHabit: (id) => setHabits((prev) => prev.filter((h) => h.id !== id)),

    addGoal: (g) => setGoals((prev) => [...prev, { ...g, id: `g-${++uid}` }]),
    bumpGoal: (id, delta) =>
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, current: Math.max(0, Math.min(g.target, g.current + delta)) } : g,
        ),
      ),
    deleteGoal: (id) => setGoals((prev) => prev.filter((g) => g.id !== id)),

    setSocial: (entries) => setSocialState(entries),
    toggleSource: (id) =>
      setSources((prev) =>
        prev.map((s) =>
          s.id === id && s.status !== 'manual'
            ? { ...s, status: s.status === 'connected' ? 'off' : 'connected' }
            : s,
        ),
      ),

    commitPlan: (taskIds, firstMoveId) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.space !== space ? t : { ...t, list: taskIds.includes(t.id) ? 'today' : t.done ? t.list : 'backlog' },
        ),
      )
      setPlan({ committedDate: todayKey(), firstMoveId })
    },

    finishReview: (wins, outcomes) => {
      setReview({ lastDoneDate: todayKey(), wins, outcomes })
      setTasks((prev) => [
        ...outcomes.filter(Boolean).map((o) => ({
          id: `t-${++uid}`,
          title: o,
          source: 'mc' as const,
          estimateMin: 30,
          done: false,
          space,
          list: 'backlog' as const,
          category: 'deep' as TaskCategory,
        })),
        ...prev,
      ])
    },

    assistantLog,
    applyDictation: (text, items) => {
      const created: AssistantEntry['items'] = []
      const newTasks: Task[] = []
      const newGoals: Goal[] = []
      items.forEach((it) => {
        const id = `a-${++uid}`
        if (it.kind === 'goal') {
          newGoals.push({ id, space, name: it.text, current: 0, target: 1, unit: 'done', note: 'added by assistant', timeframe: 'weekly', category: 'life' })
          created.push({ id, kind: 'goal', label: it.text, tab: 'goals' })
        } else {
          const done = it.kind === 'done'
          newTasks.push({ id, title: it.text, source: 'mc', estimateMin: it.estimateMin ?? 15, done, actualMin: done ? (it.estimateMin ?? 15) : undefined, space, list: 'today', category: 'quick' })
          created.push({ id, kind: it.kind, label: it.text, tab: done ? 'today' : 'plan' })
        }
      })
      if (newTasks.length) setTasks((prev) => [...newTasks, ...prev])
      if (newGoals.length) setGoals((prev) => [...prev, ...newGoals])
      setAssistantLog((prev) => [{ id: `log-${++uid}`, text, when: 'just now', items: created }, ...prev])
    },
    revertAssistantItem: (entryId, itemId) => {
      const entry = assistantLog.find((e) => e.id === entryId)
      const item = entry?.items.find((i) => i.id === itemId)
      if (item) {
        if (item.kind === 'goal') setGoals((p) => p.filter((g) => g.id !== item.id))
        else setTasks((p) => p.filter((t) => t.id !== item.id))
      }
      setAssistantLog((prev) => prev.map((e) => (e.id === entryId ? { ...e, items: e.items.filter((i) => i.id !== itemId) } : e)).filter((e) => e.items.length))
    },

    coachSessions,
    startCoachSession: (input) => {
      const taskId = `t-${++uid}`
      setTasks((prev) => [
        { id: taskId, title: input.firstStep, source: 'mc', estimateMin: input.firstStepMin, done: false, space, list: 'today', category: input.category },
        ...prev,
      ])
      setCoachSessions((prev) => [
        { id: `cs-${++uid}`, title: input.title, facts: input.facts, firstStep: input.firstStep, taskId, when: 'just now', status: 'open' },
        ...prev,
      ])
    },
    reflectCoachSession: (id, didIt, felt, reflection) => {
      setCoachSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'closed', didIt, felt, reflection } : s)))
    },
    deleteCoachSession: (id) => {
      const s = coachSessions.find((x) => x.id === id)
      if (s?.taskId) setTasks((prev) => prev.filter((t) => t.id !== s.taskId))
      setCoachSessions((prev) => prev.filter((x) => x.id !== id))
    },

    toggleRoutineStep: (routineId, stepId) => {
      setRoutines((prev) =>
        prev.map((r) => {
          if (r.id !== routineId) return r
          const has = r.doneStepIds.includes(stepId)
          const doneStepIds = has ? r.doneStepIds.filter((x) => x !== stepId) : [...r.doneStepIds, stepId]
          const allDone = r.steps.length > 0 && r.steps.every((s) => doneStepIds.includes(s.id))
          if (r.habitId) {
            const hid = r.habitId
            setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, days: h.days.map((d, i) => (i === todayIndex ? allDone : d)) } : h)))
          }
          return { ...r, doneStepIds }
        }),
      )
    },
    resetRoutine: (routineId) => {
      setRoutines((prev) =>
        prev.map((r) => {
          if (r.id !== routineId) return r
          if (r.habitId) {
            const hid = r.habitId
            setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, days: h.days.map((d, i) => (i === todayIndex ? false : d)) } : h)))
          }
          return { ...r, doneStepIds: [] }
        }),
      )
    },

    todayIndex,
    savedMin,
    accuracyPct,
    resetDemo: () => {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      const finish = () => { location.hash = ''; location.reload() }
      if (SUPABASE_ENABLED) { void deleteRemoteState().finally(finish) } else finish()
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}
