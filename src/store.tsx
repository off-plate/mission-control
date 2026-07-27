import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, saveRemoteState } from './supabase'
import { isoWeekKey, localDateKey, periodKeyFor } from './util'
import {
  DEFAULT_SPACES,
  MOCK_GOALS,
  MOCK_HABITS,
  MOCK_IDEAS,
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
  Idea,
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

export const STORAGE_KEY = 'mission-control-demo-v12'

interface PersistedState {
  version: 3
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
  ideas: Idea[]
  /** ISO week the habit checkmarks belong to; a new week archives and clears them. */
  weekKey?: string
  /** One-time data repairs already applied to this saved state. */
  fixes?: number
  /** Personal bests, keyed by `routineId:stepId`. Survives every rollover. */
  records?: Record<string, number>
  /** Which storage schema wrote this. A row from an older one is not reused. */
  schema?: string
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
  /** Attach generated steps to an existing task; its estimate becomes their sum. */
  setSubtasks: (taskId: string, subs: { title: string; estimateMin: number }[]) => void
  /** Set a task's own estimate (used by the per-task estimate action). */
  setEstimate: (taskId: string, minutes: number) => void

  toggleHabitDay: (id: string, day: number) => void
  markHabitDay: (id: string, day: number, value: boolean) => void
  addHabit: (input: { name: string; daypart?: import('./types').TimeSlot; frequency: import('./types').HabitFrequency; targetPerWeek?: number; kind?: import('./types').HabitKind }) => void
  /** Record a slip on a habit you are trying to stop; resets the clean run. */
  logSlip: (id: string) => void
  togglePauseHabit: (id: string) => void
  updateHabit: (id: string, patch: Partial<Pick<HabitDef, 'name' | 'daypart' | 'frequency' | 'targetPerWeek' | 'kind'>>) => void
  deleteHabit: (id: string) => void

  addGoal: (g: Omit<Goal, 'id'>) => void
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'space'>>) => void
  bumpGoal: (id: string, delta: number) => void
  toggleGoalMilestone: (goalId: string, milestoneId: string) => void
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
  /** Record a number against a routine step (today's typing speed). Keeps the
   *  all-time best in `records`, which never resets with the period. */
  setStepData: (routineId: string, stepId: string, value: number) => void
  /** Personal bests, keyed by `routineId:stepId`. Never cleared by a rollover. */
  records: Record<string, number>

  ideas: Idea[]
  addIdea: (text: string, color: string) => void
  setIdeaColor: (id: string, color: string) => void
  deleteIdea: (id: string) => void

  todayIndex: number
  /** This week's ledger rows for the active profile; savedMin/accuracy derive from it. */
  weekLedger: LedgerEntry[]
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
    if (p.version !== 3 || (p.schema && p.schema !== STORAGE_KEY)) return null
    /* Week rollover: when the saved state belongs to an earlier ISO week, each
       habit's checkmarks are archived into its 12-week history and cleared, so
       Monday always starts a fresh row instead of showing last week's ticks. */
    const wk = isoWeekKey()
    if (p.weekKey && p.weekKey !== wk) {
      p.habits = p.habits.map((h) => ({
        ...h,
        history: [...(h.history ?? []).slice(-11), h.days.filter(Boolean).length],
        days: [false, false, false, false, false, false, false],
      }))
    }
    /* Forward-fill fields added after this state was saved, so an existing
       install picks up new wiring (habit frequencies, habit-linked goals)
       without losing anything he has logged. Only ever fills a blank. */
    const seedH = new Map(MOCK_HABITS.map((h) => [h.id, h]))
    p.habits = p.habits.map((h) => {
      const s = seedH.get(h.id)
      return s ? { ...h, frequency: h.frequency ?? s.frequency, targetPerWeek: h.targetPerWeek ?? s.targetPerWeek } : h
    })
    // A seeded habit added later is missing entirely; append it rather than reseed.
    for (const s of MOCK_HABITS) if (!p.habits.some((h) => h.id === s.id)) p.habits.push(s)

    /* A day that has not happened yet cannot be done. Future ticks were also
       unreachable, since those dots are disabled, so they could never be undone. */
    const todayIdx = (new Date().getDay() + 6) % 7
    p.habits = p.habits.map((h) => ({ ...h, days: h.days.map((d, i) => (i > todayIdx ? false : d)) }))

    /* A habit a routine drives is a read-out of that routine, and its dots are
       not clickable, so a wrong value there can never be corrected by hand.
       Two repairs, both self-healing on every load:
       1. Today's dot always equals whether that routine is complete right now.
       2. Earlier days seeded before the routine existed were never earned, so
          they are cleared once (the routine's own period tracking is the only
          thing that can legitimately set them). */
    const drivenNow = new Map(
      MOCK_ROUTINES.filter((r) => r.habitId).map((r) => {
        const saved = p.routines?.find((x) => x.id === r.id)
        const done = saved?.periodKey === periodKeyFor(r.cadence) ? (saved?.doneStepIds ?? []) : []
        return [r.habitId as string, r.steps.length > 0 && r.steps.every((st) => done.includes(st.id))]
      }),
    )
    const seededPastCleared = p.fixes ?? 0
    p.habits = p.habits.map((h) => {
      if (!drivenNow.has(h.id)) return h
      const complete = drivenNow.get(h.id) as boolean
      const days = h.days.map((d, i) => {
        if (i === todayIdx) return complete
        return seededPastCleared >= 1 ? d : false
      })
      return { ...h, days }
    })
    p.fixes = 1

    const seedG = new Map(MOCK_GOALS.map((g) => [g.id, g]))
    p.goals = p.goals.map((g) => {
      const s = seedG.get(g.id)
      return s?.habitId && !g.habitId ? { ...g, habitId: s.habitId, unit: s.unit } : g
    })
    return p
  } catch {
    return null
  }
}

function pageFromHash(): PageId {
  const h = location.hash.replace('#/', '')
  const pages: PageId[] = ['today', 'plan', 'assistant', 'habits', 'routines', 'goals', 'money', 'review', 'coach', 'stats', 'settings', 'brand', 'braindump']
  return (pages as string[]).includes(h) ? (h as PageId) : 'today'
}

/* Ids must survive reloads without colliding: a plain counter restarts at the
   same numbers and duplicates ids already persisted (then one delete removes
   two rows). Time-based prefix + burst counter is collision-proof. */
let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`
const todayKey = () => localDateKey()

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const seedTodayIdx = (new Date().getDay() + 6) % 7
  /* Seed: past days keep the mock pattern, future days are empty. Today starts
     UNCHECKED for any habit a routine mirrors, so the two pages never disagree
     on a fresh load: you earn today by running the routine. */
  const seededHabits = useMemo(() => {
    const mirrored = new Set(MOCK_ROUTINES.map((r) => r.habitId).filter(Boolean) as string[])
    return MOCK_HABITS.map((h) => ({
      ...h,
      days: h.days.map((d, i) => (i > seedTodayIdx ? false : i === seedTodayIdx && mirrored.has(h.id) ? false : d)),
    }))
  }, [seedTodayIdx])
  const seededGoals = MOCK_GOALS
  // Routine step definitions come from the mock (canonical); only the user's checks
  // (doneStepIds) are their state, so new/removed steps show up without a reseed.
  // Checks carry the period they were made in (day / week / month); a check from
  // an earlier period is dropped, so routines reset themselves on schedule.
  const seededRoutines = useMemo(() => {
    const prior = persisted?.routines
    if (!prior) return MOCK_ROUTINES.map((m) => ({ ...m, periodKey: periodKeyFor(m.cadence) }))
    return MOCK_ROUTINES.map((m) => {
      const p = prior.find((x) => x.id === m.id)
      const key = periodKeyFor(m.cadence)
      if (!p || p.periodKey !== key) return { ...m, doneStepIds: [], periodKey: key, stepData: {} }
      return { ...m, doneStepIds: p.doneStepIds.filter((id) => m.steps.some((s) => s.id === id)), periodKey: key, stepData: p.stepData ?? {} }
    })
  }, [persisted])
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
  const [routines, setRoutines] = useState<Routine[]>(seededRoutines)
  const [ideas, setIdeas] = useState<Idea[]>(persisted?.ideas ?? MOCK_IDEAS)
  const [records, setRecords] = useState<Record<string, number>>(persisted?.records ?? {})
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const latestJson = useRef<string>('')
  // The selected space survives a reload (kept out of the synced blob on purpose,
  // so working on the phone does not flip the desktop's space).
  const [space, setSpace] = useState<SpaceId>(() => {
    try {
      const s = localStorage.getItem('mc-space')
      return s === 'work' || s === 'offplate' || s === 'personal' ? s : 'personal'
    } catch { return 'personal' }
  })
  const [page, setPageState] = useState<PageId>(pageFromHash)
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-space', space)
    try { localStorage.setItem('mc-space', space) } catch { /* noop */ }
  }, [space])

  /* Date watcher: if the app sits open across midnight (or a laptop wakes up
     the next morning), reload once so routines, habits and "today" all roll
     over to the new day instead of showing yesterday frozen in place. */
  useEffect(() => {
    const bootDay = localDateKey()
    const check = () => { if (localDateKey() !== bootDay) location.reload() }
    const t = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [])

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
      version: 3, spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas,
      weekKey: isoWeekKey(), records, fixes: 1, schema: STORAGE_KEY,
    }
    const json = JSON.stringify(state)
    latestJson.current = json
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
  }, [spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas, records])

  /* Closing the tab inside the debounce window must not lose the last change:
     flush the pending remote write the moment the page starts hiding. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    const flush = () => {
      if (remoteSaveTimer.current !== undefined && latestJson.current) {
        window.clearTimeout(remoteSaveTimer.current)
        remoteSaveTimer.current = undefined
        void saveRemoteState(latestJson.current)
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  /* Demo pretends today is Sunday when the real weekday is irrelevant;
     habits use the real weekday so checking off feels true. */
  const todayIndex = (new Date().getDay() + 6) % 7

  /* "This week" means this week: only rows from the current ISO week count, and
     only from the profile you are looking at. Rows seeded by the demo carry no
     week/space and are treated as this week's so the demo still shows numbers.
     Net, including overruns; the headline equals the sum of the visible rows. */
  const weekLedger = ledger.filter(
    (e) => (!e.weekKey || e.weekKey === isoWeekKey()) && (!e.space || e.space === space),
  )
  const savedMin = weekLedger.reduce((acc, e) => acc + (e.estimateMin - e.actualMin), 0)
  const accuracyPct = Math.round(
    (weekLedger.filter((e) => Math.abs(e.actualMin - e.estimateMin) <= e.estimateMin * 0.25).length /
      Math.max(1, weekLedger.length)) * 100,
  )

  const value: Store = {
    version: 3,
    spaces, tasks, habits, goals, ledger, social, sources, plan, review, routines, ideas,
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
        [sp]: [...prev[sp], { id: newId(type), type, size: WIDGET_DEFS[type].defaultSize }],
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

    /* Reopening a task clears the time that was logged against it, so "skip"
       genuinely means no time recorded instead of resurfacing an old number. */
    toggleTask: (id) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done, actualMin: t.done ? undefined : t.actualMin } : t))),

    logActual: (id, actualMin) => {
      const t = tasks.find((x) => x.id === id)
      setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, done: true, actualMin } : x)))
      if (t && t.actualMin === undefined) {
        setLedger((prev) => [
          { id: newId('l'), title: t.title, category: t.category, estimateMin: t.estimateMin, actualMin, when: todayKey(), space: t.space, weekKey: isoWeekKey() },
          ...prev,
        ])
      }
    },

    addTask: (t) => setTasks((prev) => [{ ...t, id: newId('t'), done: false, createdAt: todayKey() }, ...prev]),
    addTasks: (ts) =>
      setTasks((prev) => [...ts.map((t) => ({ ...t, id: newId('t'), done: false, createdAt: todayKey() })), ...prev]),
    addTaskWithSubtasks: (parent, subs) =>
      setTasks((prev) => {
        const pid = newId('t')
        const subtasks = subs.map((sub, i) => ({ id: `${pid}s${i}`, title: sub.title, estimateMin: sub.estimateMin, done: false }))
        const est = subtasks.reduce((a, s) => a + s.estimateMin, 0)
        return [{ ...parent, id: pid, done: false, createdAt: todayKey(), estimateMin: est, estimated: true, subtasks }, ...prev]
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
    /* Logging the LAST subtask closes the parent task and writes one ledger row
       for the whole thing, so subtasked work reaches Review the same as flat work. */
    logSubtaskActual: (taskId, subId, actualMin) => {
      const parent = tasks.find((x) => x.id === taskId)
      const subs = (parent?.subtasks ?? []).map((s) => (s.id === subId ? { ...s, done: true, actualMin } : s))
      const allDone = subs.length > 0 && subs.every((s) => s.done)
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId && t.subtasks ? { ...t, subtasks: subs, done: allDone || t.done } : t)),
      )
      if (parent && allDone && !parent.done) {
        const est = subs.reduce((a, s) => a + s.estimateMin, 0)
        const act = subs.reduce((a, s) => a + (s.actualMin ?? s.estimateMin), 0)
        setLedger((prev) => [
          { id: newId('l'), title: parent.title, category: parent.category, estimateMin: est, actualMin: act, when: todayKey(), space: parent.space, weekKey: isoWeekKey() },
          ...prev,
        ])
      }
    },
    deleteTask: (id) => setTasks((prev) => prev.filter((t) => t.id !== id)),
    setSubtasks: (taskId, subs) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t
        const subtasks = subs.map((s, i) => ({ id: `${taskId}s${i}${Date.now().toString(36)}`, title: s.title, estimateMin: s.estimateMin, done: false }))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, x) => a + x.estimateMin, 0), estimated: true }
      })),
    setEstimate: (taskId, minutes) =>
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, estimateMin: Math.max(1, Math.round(minutes)), estimated: true } : t))),

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
    addHabit: (input) =>
      setHabits((prev) => [...prev, {
        id: newId('h'), space, name: input.name, daypart: input.daypart,
        frequency: input.frequency, targetPerWeek: input.targetPerWeek,
        kind: input.kind ?? 'build',
        // A quit starts its clean run today, so the number means something now.
        lastSlip: input.kind === 'break' ? todayKey() : undefined,
        days: [false, false, false, false, false, false, false], paused: false,
      }]),
    logSlip: (id) => setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, lastSlip: todayKey() } : h))),
    updateHabit: (id, patch) => setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    togglePauseHabit: (id) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, paused: !h.paused } : h))),
    deleteHabit: (id) => setHabits((prev) => prev.filter((h) => h.id !== id)),

    addGoal: (g) => setGoals((prev) => [...prev, { ...g, id: newId('g') }]),
    /* Editing a goal is how a habit gets attached to one that already exists.
       Clearing the link keeps whatever the habit had counted, so the number
       does not jump backwards when you switch to logging by hand. */
    updateGoal: (id, patch) =>
      setGoals((prev) => prev.map((g) => {
        if (g.id !== id) return g
        const next = { ...g, ...patch }
        if ('habitId' in patch && !patch.habitId && g.habitId) next.current = g.current
        return next
      })),
    bumpGoal: (id, delta) =>
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, current: Math.max(0, Math.min(g.target, g.current + delta)) } : g,
        ),
      ),
    /* Ticking a milestone advances the goal itself when the goal is measured in
       its milestones (target equals their count); other units keep their own
       counter and only the milestone list changes. Strict math, no fudging. */
    toggleGoalMilestone: (goalId, milestoneId) =>
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goalId || !g.milestones) return g
          const milestones = g.milestones.map((m) => (m.id === milestoneId ? { ...m, done: !m.done } : m))
          const doneCount = milestones.filter((m) => m.done).length
          const current = g.target === milestones.length ? doneCount : g.current
          return { ...g, milestones, current }
        }),
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

    /* Closing the week keeps the previous week's reflection, so next Sunday you
       can see what you said you would change. Stamped with the ISO week, so
       "closed" holds until the new week starts, not just until tomorrow. */
    finishReview: (wins, outcomes) => {
      setReview((prev) => ({
        lastDoneDate: todayKey(),
        lastWeekKey: isoWeekKey(),
        wins,
        outcomes,
        previous: prev.lastWeekKey && prev.lastWeekKey !== isoWeekKey()
          ? { weekKey: prev.lastWeekKey, wins: prev.wins, outcomes: prev.outcomes }
          : prev.previous,
      }))
      setTasks((prev) => [
        ...outcomes.filter(Boolean).map((o) => ({
          id: newId('t'),
          title: o,
          source: 'mc' as const,
          estimateMin: 30,
          done: false,
          createdAt: todayKey(),
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
        const id = newId('a')
        if (it.kind === 'goal') {
          newGoals.push({ id, space, name: it.text, current: 0, target: 1, unit: 'done', note: 'added by assistant', timeframe: 'weekly', category: 'life' })
          created.push({ id, kind: 'goal', label: it.text, tab: 'goals' })
        } else {
          const done = it.kind === 'done'
          /* A dictated "done" carries no measured time. Stamping actualMin with
             the default estimate would invent a perfect log and pollute the
             accuracy figure, so it stays undefined unless you said a number. */
          newTasks.push({ id, title: it.text, source: 'mc', estimateMin: it.estimateMin ?? 15, done, actualMin: done ? it.estimateMin : undefined, createdAt: todayKey(), space, list: 'today', category: 'quick' })
          created.push({ id, kind: it.kind, label: it.text, tab: done ? 'today' : 'plan' })
        }
      })
      if (newTasks.length) setTasks((prev) => [...newTasks, ...prev])
      if (newGoals.length) setGoals((prev) => [...prev, ...newGoals])
      setAssistantLog((prev) => [{ id: newId('log'), text, when: todayKey(), items: created }, ...prev])
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
      const taskId = newId('t')
      setTasks((prev) => [
        { id: taskId, title: input.firstStep, source: 'mc', estimateMin: input.firstStepMin, done: false, createdAt: todayKey(), space, list: 'today', category: input.category },
        ...prev,
      ])
      setCoachSessions((prev) => [
        { id: newId('cs'), space, title: input.title, facts: input.facts, firstStep: input.firstStep, taskId, when: todayKey(), status: 'open' },
        ...prev,
      ])
    },
    /* Saying you did it also ticks the task off Today (with its estimate logged),
       so the loop closes in one place instead of two. Saying "not yet" leaves the
       loop OPEN on purpose: an unfaced thing should keep showing up. */
    reflectCoachSession: (id, didIt, felt, reflection) => {
      const s = coachSessions.find((x) => x.id === id)
      setCoachSessions((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: didIt ? 'closed' : 'open', didIt, felt: didIt ? felt : undefined, reflection } : x)),
      )
      if (didIt && s?.taskId) {
        const t = tasks.find((x) => x.id === s.taskId)
        if (t && !t.done) value.logActual(t.id, t.estimateMin)
      }
    },
    /* Dropping an OPEN loop removes the task it queued. A closed one only clears
       the history record: the work is already done, deleting it would rewrite it. */
    deleteCoachSession: (id) => {
      const s = coachSessions.find((x) => x.id === id)
      if (s?.taskId && s.status === 'open') {
        const t = tasks.find((x) => x.id === s.taskId)
        if (t && !t.done) setTasks((prev) => prev.filter((x) => x.id !== s.taskId))
      }
      setCoachSessions((prev) => prev.filter((x) => x.id !== id))
    },

    /* The habit mirror only fires on a real transition: completing the routine
       ticks the habit, un-completing it unticks. Any other step toggle leaves
       the habit alone, so a day you ticked by hand is never silently wiped. */
    toggleRoutineStep: (routineId, stepId) => {
      const r = routines.find((x) => x.id === routineId)
      if (!r) return
      const has = r.doneStepIds.includes(stepId)
      const doneStepIds = has ? r.doneStepIds.filter((x) => x !== stepId) : [...r.doneStepIds, stepId]
      const wasComplete = r.steps.length > 0 && r.steps.every((s) => r.doneStepIds.includes(s.id))
      const isComplete = r.steps.length > 0 && r.steps.every((s) => doneStepIds.includes(s.id))
      setRoutines((prev) => prev.map((x) => (x.id === routineId ? { ...x, doneStepIds } : x)))
      if (r.habitId && wasComplete !== isComplete) {
        const hid = r.habitId
        setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, days: h.days.map((d, i) => (i === todayIndex ? isComplete : d)) } : h)))
      }
    },
    records,
    setStepData: (routineId, stepId, value) => {
      setRoutines((prev) => prev.map((r) => (r.id === routineId ? { ...r, stepData: { ...(r.stepData ?? {}), [stepId]: value } } : r)))
      const key = `${routineId}:${stepId}`
      setRecords((prev) => (value > (prev[key] ?? 0) ? { ...prev, [key]: value } : prev))
    },
    resetRoutine: (routineId) => {
      const r = routines.find((x) => x.id === routineId)
      setRoutines((prev) => prev.map((x) => (x.id === routineId ? { ...x, doneStepIds: [], stepData: {} } : x)))
      if (r?.habitId) {
        const hid = r.habitId
        setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, days: h.days.map((d, i) => (i === todayIndex ? false : d)) } : h)))
      }
    },

    addIdea: (text, color) => {
      const t = text.trim()
      if (!t) return
      setIdeas((prev) => [{ id: newId('idea'), space, text: t, when: todayKey(), color }, ...prev])
    },
    setIdeaColor: (id, color) => setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, color } : i))),
    deleteIdea: (id) => setIdeas((prev) => prev.filter((i) => i.id !== id)),

    todayIndex,
    weekLedger,
    savedMin,
    accuracyPct,
    resetDemo: () => {
      // Cancel any pending mirror first, or it would rewrite the row we just deleted.
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = undefined
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
