import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, saveRemoteState } from './supabase'
import { dayIndexOf, dayOfWeekKey, isoWeekKey, localDateKey, periodKeyFor, slotForTime } from './util'
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
import { goalCurrent, routineComplete, stepLocked } from './types'
import { isSpace } from './types'
import type {
  ViewId,
  FocusSession,
  HabitTick,
  RoutineDone,
  RoutineCadence,
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
  /** Seeded habits and routines he deleted on purpose; never re-seeded. */
  removedSeeds?: string[]
  /** Every finished focus block, so a measured habit has something to count. */
  focusSessions?: FocusSession[]
  /** Every day a habit was kept, dated. The durable record behind days[]. */
  habitLog?: HabitTick[]
  /** Every day a routine was finished, dated. */
  routineLog?: RoutineDone[]
}

/** A delete you can still take back: what it was, and how to put it back. */
export interface Undoable { id: string; label: string; restore: () => void }

interface Store extends PersistedState {
  /** What he is looking at. 'all' shows every space at once. */
  view: ViewId
  setView: (v: ViewId) => void
  /** Where a newly created thing lands. In a single space that is the space he is
   *  in; in All it is whichever space he last worked in, and he can change it. */
  space: SpaceId
  setSpace: (s: SpaceId) => void
  /** Does this record belong in what he is looking at? One predicate, so a page
   *  never has to know whether it is in a single space or in All. */
  inView: (s?: SpaceId) => boolean
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
  /** Pin a task to a clock time ('HH:MM'), or undefined to unpin it. The slot
   *  follows the hour, so the two never disagree. */
  setTaskAt: (id: string, at: string | undefined) => void
  toggleSubtask: (taskId: string, subId: string) => void
  logSubtaskActual: (taskId: string, subId: string, actualMin: number) => void
  deleteTask: (id: string) => void
  /** Attach generated steps to an existing task; its estimate becomes their sum. */
  setSubtasks: (taskId: string, subs: { title: string; estimateMin: number }[]) => void
  /** Set a task's own estimate (used by the per-task estimate action). */
  setEstimate: (taskId: string, minutes: number) => void

  toggleHabitDay: (id: string, day: number) => void
  markHabitDay: (id: string, day: number, value: boolean) => void
  addHabit: (input: { name: string; daypart?: import('./types').TimeSlot; frequency: import('./types').HabitFrequency; targetPerWeek?: number; kind?: import('./types').HabitKind; dailyTargetMin?: number; source?: import('./types').HabitSource; quitSince?: string }) => void
  /** Record a slip on a habit you are trying to stop; resets the clean run. */
  logSlip: (id: string) => void
  togglePauseHabit: (id: string) => void
  updateHabit: (id: string, patch: Partial<Pick<HabitDef, 'name' | 'daypart' | 'frequency' | 'targetPerWeek' | 'kind' | 'dailyTargetMin' | 'source' | 'quitSince'>>) => void
  deleteHabit: (id: string) => void

  addGoal: (g: Omit<Goal, 'id'>) => void
  updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'space'>>) => void
  bumpGoal: (id: string, delta: number) => void
  toggleGoalMilestone: (goalId: string, milestoneId: string) => void
  deleteGoal: (id: string) => void

  setSocial: (entries: SocialEntry[]) => void
  toggleSource: (id: string) => void

  commitPlan: (taskIds: string[], firstMoveId: string | null) => void
  /** Close a window: any range, one act. Its outcomes land in the backlog. */
  closeReview: (window: { id: string; label: string; from: string; to: string }, wins: string[], outcomes: string[]) => void

  assistantLog: AssistantEntry[]
  applyDictation: (text: string, items: { kind: 'task' | 'goal' | 'done'; text: string; estimateMin?: number }[]) => void
  revertAssistantItem: (entryId: string, itemId: string) => void

  coachSessions: CoachSession[]
  startCoachSession: (input: { title: string; facts: CoachFacts; firstStep: string; firstStepMin: number; category: TaskCategory }) => void
  reflectCoachSession: (id: string, didIt: boolean, felt: CoachSession['felt'], reflection: string) => void
  deleteCoachSession: (id: string) => void

  routines: Routine[]
  toggleRoutineStep: (routineId: string, stepId: string) => void
  /** Finish or reopen a whole routine at once, the way ticking a task with
   *  subtasks finishes all of them. */
  setRoutineDone: (routineId: string, done: boolean) => void
  resetRoutine: (routineId: string) => void
  /** A routine and the habit that mirrors it are created together, so finishing
   *  it always has somewhere to land. */
  addRoutine: (input: { title: string; cadence: RoutineCadence; blurb?: string; daypart?: import('./types').TimeSlot }) => void
  updateRoutine: (id: string, patch: Partial<Pick<Routine, 'title' | 'cadence' | 'blurb'>>) => void
  deleteRoutine: (id: string) => void
  addRoutineStep: (routineId: string, step: { title: string; note?: string; link?: string; linkLabel?: string }) => void
  updateRoutineStep: (routineId: string, stepId: string, patch: Partial<Pick<import('./types').RoutineStep, 'title' | 'note' | 'link' | 'linkLabel'>>) => void
  deleteRoutineStep: (routineId: string, stepId: string) => void
  moveRoutineStep: (routineId: string, stepId: string, dir: -1 | 1) => void
  /** Record a number against a routine step (today's typing speed). Keeps the
   *  all-time best in `records`, which never resets with the period. */
  setStepData: (routineId: string, stepId: string, value: number) => void
  /** Personal bests, keyed by `routineId:stepId`. Never cleared by a rollover. */
  records: Record<string, number>

  /** Finished focus blocks, newest first. Trimmed to a year. */
  focusSessions: FocusSession[]
  /** Called when a focus block finishes; feeds measured habits and the ledger. */
  logFocus: (minutes: number, label?: string) => void

  /** Every dated habit tick and routine completion. The record days[] caches. */
  habitLog: HabitTick[]
  routineLog: RoutineDone[]

  ideas: Idea[]
  addIdea: (text: string, color: string) => void
  setIdeaColor: (id: string, color: string) => void
  deleteIdea: (id: string) => void

  /** The last delete, still takeable back. Null once it is taken back or expires. */
  undoable: Undoable | null
  undoDelete: () => void
  dismissUndo: () => void

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

    /* One-time migration to the dated habit log. Whatever is ticked in the week
       array right now becomes dated entries, so nothing he has logged is lost by
       moving to the durable record. history[] holds twelve undated weekly counts
       and stays exactly as it is: inventing dates for it would be fabrication,
       and the new log simply starts here and grows. */
    if (!p.habitLog) {
      const ticks: HabitTick[] = []
      // Ticks belong to the week the saved state was written in, not to this one.
      const base = p.weekKey === wk ? new Date() : null
      if (base) {
        for (const h of p.habits ?? []) {
          h.days.forEach((on, i) => { if (on) ticks.push({ habitId: h.id, day: dayOfWeekKey(i, base) }) })
        }
      }
      p.habitLog = ticks
    }
    if (!p.routineLog) {
      // A routine that is currently complete carries the day it was completed.
      p.routineLog = (p.routines ?? [])
        .filter((r) => r.completedOn && routineComplete(r, periodKeyFor(r.cadence)))
        .map((r) => ({ routineId: r.id, day: r.completedOn as string, periodKey: r.periodKey ?? periodKeyFor(r.cadence) }))
    }

    if (p.weekKey && p.weekKey !== wk) {
      p.habits = p.habits.map((h) => ({
        ...h,
        history: [...(h.history ?? []).slice(-11), h.days.filter(Boolean).length],
        days: [false, false, false, false, false, false, false],
      }))
    }
    /* A day that has not happened yet cannot have been kept. The week array has
       always been cleaned of future ticks; the log has to be cleaned the same way
       or the two disagree the moment a migration or a clock change writes one. */
    p.habitLog = (p.habitLog ?? []).filter((t) => t.day <= localDateKey())
    p.routineLog = (p.routineLog ?? []).filter((r) => r.day <= localDateKey())

    /* The week array is a cache. Rebuilding it from the log on every load means
       the log is the one truth and the two can never drift apart. */
    {
      const thisWeek = new Set(
        (p.habitLog ?? [])
          .filter((t) => isoWeekKey(new Date(t.day)) === wk)
          .map((t) => `${t.habitId}|${t.day}`),
      )
      p.habits = p.habits.map((h) => ({
        ...h,
        days: Array.from({ length: 7 }, (_, i) => thisWeek.has(`${h.id}|${dayOfWeekKey(i)}`)),
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
    const removed = new Set(p.removedSeeds ?? [])
    for (const s of MOCK_HABITS) if (!removed.has(s.id) && !p.habits.some((h) => h.id === s.id)) p.habits.push(s)

    /* A day that has not happened yet cannot be done. Future ticks were also
       unreachable, since those dots are disabled, so they could never be undone. */
    const todayIdx = (new Date().getDay() + 6) % 7
    p.habits = p.habits.map((h) => ({ ...h, days: h.days.map((d, i) => (i > todayIdx ? false : d)) }))

    /* A habit a routine drives is a read-out of that routine, and its dots are
       not clickable, so a wrong value there can never be corrected by hand. It
       is therefore re-derived on every load, from HIS routines. It used to read
       MOCK_ROUTINES, which meant the moment he wrote his own steps the mock's
       list (empty, for four of them) decided the answer: the tick was wiped on
       the next reload, or asserted for a routine he had not finished. */
    const savedRoutines = p.routines ?? []
    const drivenNow = new Map(
      savedRoutines.filter((r) => r.habitId).map((r) => {
        const complete = routineComplete(r, periodKeyFor(r.cadence))
        return [r.habitId as string, { complete, on: complete ? (r.completedOn ?? localDateKey()) : null }]
      }),
    )
    const seededPastCleared = p.fixes ?? 0
    const thisWeek = isoWeekKey()
    p.habits = p.habits.map((h) => {
      const d = drivenNow.get(h.id)
      if (!d) return h
      /* The tick belongs to the day it was earned, not to today. A weekly
         routine finished on Tuesday keeps Tuesday's dot for the rest of the
         week, and loses THAT dot when it is undone on Friday. */
      const idx = d.on && isoWeekKey(new Date(d.on)) === thisWeek ? dayIndexOf(d.on) : null
      const days = h.days.map((day, i) => {
        if (!d.complete) return seededPastCleared >= 1 && i !== todayIdx ? day : false
        if (idx !== null) return i === idx
        return i === todayIdx
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
  /* Routines are his once they exist: the mock only seeds an empty install. This
     used to be the other way round, rebuilding every routine from the mock on
     each load, which threw away any step he wrote the moment he reloaded.
     Checks carry the period they were made in; one from an earlier period is
     dropped, so a routine resets itself on schedule. */
  const seededRoutines = useMemo(() => {
    const prior = persisted?.routines
    const base = prior && prior.length ? prior : MOCK_ROUTINES
    return base.map((r) => {
      const key = periodKeyFor(r.cadence)
      if (r.periodKey !== key) return { ...r, doneStepIds: [], stepData: {}, periodKey: key }
      return {
        ...r,
        doneStepIds: r.doneStepIds.filter((id) => r.steps.some((st) => st.id === id)),
        stepData: r.stepData ?? {},
        periodKey: key,
      }
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
  // Seeded ids he has deleted, so the forward-fill never resurrects them.
  const [removedSeeds, setRemovedSeeds] = useState<string[]>(persisted?.removedSeeds ?? [])
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>(persisted?.focusSessions ?? [])
  const [habitLog, setHabitLog] = useState<HabitTick[]>(persisted?.habitLog ?? [])
  const [routineLog, setRoutineLog] = useState<RoutineDone[]>(persisted?.routineLog ?? [])
  /* The last thing you deleted, held long enough to take it back. Deliberately
     not persisted: a delete you can still undo after a reload is not a delete. */
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const latestJson = useRef<string>('')
  /* The view and the write-space survive a reload, kept out of the synced blob on
     purpose so working on the phone does not flip the desktop. All is the default:
     the whole point is that nothing hides in a profile he did not open. */
  const [view, setViewState] = useState<ViewId>(() => {
    try {
      const v = localStorage.getItem('mc-view')
      return v === 'work' || v === 'offplate' || v === 'personal' || v === 'all' ? v : 'all'
    } catch { return 'all' }
  })
  const [writeSpace, setWriteSpace] = useState<SpaceId>(() => {
    try {
      const s = localStorage.getItem('mc-space')
      return s === 'work' || s === 'offplate' || s === 'personal' ? s : 'personal'
    } catch { return 'personal' }
  })
  // In a single space, new things land there. In All he picks, and the pick sticks.
  const space: SpaceId = isSpace(view) ? view : writeSpace
  const setSpace = (s: SpaceId) => setWriteSpace(s)
  const setView = (v: ViewId) => { setViewState(v); if (isSpace(v)) setWriteSpace(v) }
  const inView = (s?: SpaceId) => view === 'all' || !s || s === view
  const [page, setPageState] = useState<PageId>(pageFromHash)
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [coachOpen, setCoachOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-space', view)
    try {
      localStorage.setItem('mc-view', view)
      localStorage.setItem('mc-space', writeSpace)
    } catch { /* noop */ }
  }, [view, writeSpace])

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
      weekKey: isoWeekKey(), records, fixes: 1, schema: STORAGE_KEY, removedSeeds, focusSessions,
      habitLog, routineLog,
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
  }, [spaces, tasks, habits, goals, ledger, social, sources, plan, review, assistantLog, coachSessions, routines, ideas, records, removedSeeds, focusSessions, habitLog, routineLog])

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

  /** Tick or untick one day of one habit, in the log and in the week cache. */
  const markDay = (habitId: string, dayIndex: number, value: boolean) => {
    const day = dayOfWeekKey(dayIndex)
    setHabitLog((prev) => {
      const without = prev.filter((t) => !(t.habitId === habitId && t.day === day))
      return value ? [...without, { habitId, day }] : without
    })
    setHabits((prev) => prev.map((h) => (h.id === habitId
      ? { ...h, days: h.days.map((d, i) => (i === dayIndex ? value : d)) }
      : h)))
  }

  /* Apply a change to a routine and re-derive its habit from the result. The
     tick is written to the day it was earned and cleared from that same day, so
     a weekly routine undone three days later does not clear the wrong dot. */
  const applyRoutine = (routineId: string, change: (r: Routine) => Routine) => {
    const before = routines.find((x) => x.id === routineId)
    if (!before) return
    const after = change(before)
    const key = periodKeyFor(after.cadence)
    const wasComplete = routineComplete(before, periodKeyFor(before.cadence))
    const isComplete = routineComplete(after, key)
    const completedOn = isComplete ? (wasComplete ? before.completedOn ?? todayKey() : todayKey()) : null
    setRoutines((prev) => prev.map((x) => (x.id === routineId ? { ...after, periodKey: key, completedOn } : x)))
    if (wasComplete === isComplete) return

    /* Which day this routine was finished, kept for good. completedOn holds only
       the most recent one, so on its own it could never answer "which day did I
       do it" for any day but the last. */
    setRoutineLog((prev) => {
      const without = prev.filter((r) => !(r.routineId === routineId && r.periodKey === key))
      return isComplete ? [...without, { routineId, day: todayKey(), periodKey: key }] : without
    })

    if (!before.habitId) return
    const hid = before.habitId
    const clearIdx = before.completedOn && isoWeekKey(new Date(before.completedOn)) === isoWeekKey()
      ? dayIndexOf(before.completedOn)
      : todayIndex
    // Through markDay, so a routine-driven tick lands in the durable log too.
    markDay(hid, isComplete ? todayIndex : clearIdx, isComplete)
  }

  /* Arming an undo replaces whatever was armed before: one step back, not a
     history. The window is generous because a delete you notice a beat late is
     exactly the one worth taking back. */
  const armUndo = (label: string, restore: () => void) => setUndoable({ id: newId('u'), label, restore })

  const value: Store = {
    version: 3,
    spaces, tasks, habits, goals, ledger, social, sources, plan, review, routines, ideas,
    focusSessions, habitLog, routineLog,
    view, setView, inView,
    /* A finished block is recorded once, and everything that cares reads from
       here: measured habits fill from it, and the ledger gets it so focus time
       counts toward estimate accuracy instead of vanishing. */
    logFocus: (minutes, label) => {
      if (minutes <= 0) return
      const day = todayKey()
      const mins = Math.round(minutes)
      setFocusSessions((prev) => [{ id: newId('f'), day, minutes: mins, label, space }, ...prev].slice(0, 2000))
      setLedger((prev) => [
        { id: newId('l'), title: label ? `Focus: ${label}` : 'Focus block', category: 'deep' as TaskCategory,
          estimateMin: mins, actualMin: mins, when: day, space, weekKey: isoWeekKey() },
        ...prev,
      ])
    },
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
    /* A task with steps is done when you say it is done, so its steps go with it.
       Leaving them unticked underneath a finished parent was the app disagreeing
       with itself. Reopening puts them all back. */
    toggleTask: (id) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t
        const done = !t.done
        return {
          ...t,
          done,
          actualMin: t.done ? undefined : t.actualMin,
          subtasks: t.subtasks?.map((sub) => ({ ...sub, done, actualMin: done ? sub.actualMin : undefined })),
        }
      })),

    logActual: (id, actualMin) => {
      const t = tasks.find((x) => x.id === id)
      setTasks((prev) => prev.map((x) => (x.id === id
        ? { ...x, done: true, actualMin, subtasks: x.subtasks?.map((sub) => ({ ...sub, done: true })) }
        : x)))
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
      setTasks((prev) => prev.map((t) => (t.id === id
        ? { ...t, list, plannedOn: list === 'today' ? todayKey() : undefined }
        : t))),
    moveTasksToToday: (ids) =>
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, list: 'today', slot: undefined, plannedOn: todayKey() } : t))),
    assignSlot: (id, slot) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, slot } : t))),
    /* A clock time implies a part of the day, so setting one moves the task into
       the matching bucket. Leaving them free to disagree meant a task could read
       9 AM on the schedule and sit under Evening in the list. */
    setTaskAt: (id, at) =>
      setTasks((prev) => prev.map((t) => (t.id === id
        ? { ...t, at, list: 'today' as const, plannedOn: t.plannedOn ?? todayKey(), slot: at ? slotForTime(at) : t.slot }
        : t))),
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
    deleteTask: (id) => {
      const before = tasks
      const gone = tasks.find((t) => t.id === id)
      setTasks((prev) => prev.filter((t) => t.id !== id))
      armUndo(gone ? `Deleted "${gone.title}"` : 'Task deleted', () => setTasks(before))
    },
    setSubtasks: (taskId, subs) =>
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t
        const subtasks = subs.map((s, i) => ({ id: `${taskId}s${i}${Date.now().toString(36)}`, title: s.title, estimateMin: s.estimateMin, done: false }))
        return { ...t, subtasks, estimateMin: subtasks.reduce((a, x) => a + x.estimateMin, 0), estimated: true }
      })),
    setEstimate: (taskId, minutes) =>
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, estimateMin: Math.max(1, Math.round(minutes)), estimated: true } : t))),

    /* Both of these write the dated log first: that is the record that survives
       the week rolling over. days[] is a cache of the current week and is kept in
       step here, and rebuilt from the log on every load. */
    toggleHabitDay: (id, day) => {
      const h = habits.find((x) => x.id === id)
      if (!h) return
      markDay(id, day, !h.days[day])
    },
    markHabitDay: (id, day, value) => markDay(id, day, value),
    addHabit: (input) =>
      setHabits((prev) => [...prev, {
        id: newId('h'), space, name: input.name, daypart: input.daypart,
        frequency: input.frequency, targetPerWeek: input.targetPerWeek,
        kind: input.kind ?? 'build',
        dailyTargetMin: input.dailyTargetMin,
        source: input.source,
        // A quit runs from the day he says he stopped, not from the day he got
        // round to typing it in.
        quitSince: input.kind === 'break' ? (input.quitSince ?? todayKey()) : undefined,
        days: [false, false, false, false, false, false, false], paused: false,
      }]),
    logSlip: (id) => setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, lastSlip: todayKey() } : h))),
    updateHabit: (id, patch) => setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    togglePauseHabit: (id) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, paused: !h.paused } : h))),
    deleteHabit: (id) => {
      const beforeH = habits, beforeSeeds = removedSeeds
      const gone = habits.find((h) => h.id === id)
      setHabits((prev) => prev.filter((h) => h.id !== id))
      setRemovedSeeds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Habit deleted', () => {
        setHabits(beforeH); setRemovedSeeds(beforeSeeds)
      })
    },

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
    deleteGoal: (id) => {
      const before = goals
      const gone = goals.find((g) => g.id === id)
      setGoals((prev) => prev.filter((g) => g.id !== id))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Goal deleted', () => setGoals(before))
    },

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
          t.space !== space ? t : {
            ...t,
            list: taskIds.includes(t.id) ? 'today' : t.done ? t.list : 'backlog',
            plannedOn: taskIds.includes(t.id) ? todayKey() : t.done ? t.plannedOn : undefined,
          },
        ),
      )
      setPlan({ committedDate: todayKey(), firstMoveId })
    },

    /* One close for any window. A window that ends today and started this week
       also marks the weekly ritual done, so the Sunday nudge keeps working. */
    closeReview: (w, wins, outcomes) => {
      setReview((prev) => {
        const kept = (prev.reflections ?? []).filter((r) => !(r.from === w.from && r.to === w.to))
        const entry = { id: newId('rf'), label: w.label, from: w.from, to: w.to, when: todayKey(), wins, outcomes }
        const isThisWeek = w.from === dayOfWeekKey(0) && w.to === todayKey()
        return {
          ...prev,
          lastDoneDate: isThisWeek ? todayKey() : prev.lastDoneDate,
          lastWeekKey: isThisWeek ? isoWeekKey() : prev.lastWeekKey,
          wins: isThisWeek ? wins : prev.wins,
          outcomes: isThisWeek ? outcomes : prev.outcomes,
          reflections: [entry, ...kept].slice(0, 60),
        }
      })
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
          category: 'admin' as const,
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
          newTasks.push({ id, title: it.text, source: 'mc', estimateMin: it.estimateMin ?? 15, done, actualMin: done ? it.estimateMin : undefined, createdAt: todayKey(), plannedOn: todayKey(), space, list: 'today', category: 'quick' })
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
        { id: taskId, title: input.firstStep, source: 'mc', estimateMin: input.firstStepMin, done: false, createdAt: todayKey(), plannedOn: todayKey(), space, list: 'today', category: input.category },
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

    /* Every path that can change whether a routine is complete goes through
       this, so the habit can never disagree with the routine. Adding, deleting
       or reordering a step changes completeness just as ticking one does, and
       those used to skip the mirror entirely. */
    toggleRoutineStep: (routineId, stepId) => {
      const r = routines.find((x) => x.id === routineId)
      if (!r) return
      // A gated step (the typing test) obeys the same rule on every surface.
      if (!r.doneStepIds.includes(stepId) && stepLocked(r, stepId)) return
      const has = r.doneStepIds.includes(stepId)
      const doneStepIds = has ? r.doneStepIds.filter((x) => x !== stepId) : [...r.doneStepIds, stepId]
      applyRoutine(routineId, (x) => ({ ...x, doneStepIds }))
    },
    records,
    /* Logging the number IS completing the step, in one action. Keeping them
       apart meant the gate read the old score and refused the very result that
       had just satisfied it. */
    setStepData: (routineId, stepId, value) => {
      applyRoutine(routineId, (r) => {
        const stepData = { ...(r.stepData ?? {}), [stepId]: value }
        const passes = !stepLocked({ ...r, stepData }, stepId)
        const doneStepIds = passes && !r.doneStepIds.includes(stepId)
          ? [...r.doneStepIds, stepId]
          : !passes ? r.doneStepIds.filter((x) => x !== stepId) : r.doneStepIds
        return { ...r, stepData, doneStepIds }
      })
      const key = `${routineId}:${stepId}`
      setRecords((prev) => (value > (prev[key] ?? 0) ? { ...prev, [key]: value } : prev))
    },
    addRoutine: (input) => {
      const hid = newId('h')
      const rid = newId('r')
      setHabits((prev) => [...prev, {
        id: hid, space, name: input.title, daypart: input.daypart, kind: 'build',
        frequency: input.cadence === 'weekly' ? 'weekly' : input.cadence === 'monthly' ? 'monthly' : input.cadence === 'prework' ? 'weekdays' : 'daily',
        days: [false, false, false, false, false, false, false], paused: false, history: [],
      }])
      setRoutines((prev) => [...prev, {
        id: rid, space, title: input.title, cadence: input.cadence, blurb: input.blurb,
        steps: [], doneStepIds: [], habitId: hid, periodKey: periodKeyFor(input.cadence), stepData: {},
      }])
    },
    updateRoutine: (id, patch) => {
      setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      // The mirrored habit carries the routine's name, so keep them in step.
      const r = routines.find((x) => x.id === id)
      if (r?.habitId && patch.title) setHabits((hs) => hs.map((h) => (h.id === r.habitId ? { ...h, name: patch.title as string } : h)))
    },
    /* Deleting a routine takes its habit with it: a habit only a routine could
       tick would otherwise sit there permanently unfinishable. */
    deleteRoutine: (id) => {
      const r = routines.find((x) => x.id === id)
      // A routine takes its habit and its goal's link with it, so undo has to
      // put all three back, not just the routine.
      const beforeR = routines, beforeH = habits, beforeG = goals, beforeSeeds = removedSeeds
      armUndo(r ? `Deleted "${r.title}"` : 'Routine deleted', () => {
        setRoutines(beforeR); setHabits(beforeH); setGoals(beforeG); setRemovedSeeds(beforeSeeds)
      })
      setRoutines((prev) => prev.filter((x) => x.id !== id))
      if (r?.habitId) {
        const hid = r.habitId
        setHabits((hs) => hs.filter((h) => h.id !== hid))
        /* A goal counting off that habit keeps the progress it earned and goes
           back to being logged by hand, rather than pointing at nothing and
           freezing forever. */
        setGoals((gs) => gs.map((g) => (g.habitId === hid
          ? { ...g, habitId: undefined, current: goalCurrent(g, habits), unit: g.unit === 'checkoffs' ? 'done' : g.unit }
          : g)))
        setRemovedSeeds((prev) => (prev.includes(hid) ? prev : [...prev, hid]))
      }
      setRemovedSeeds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    },
    addRoutineStep: (routineId, step) =>
      applyRoutine(routineId, (r) => ({ ...r, steps: [...r.steps, { id: newId('st'), kind: 'do' as const, ...step }] })),
    updateRoutineStep: (routineId, stepId, patch) =>
      setRoutines((prev) => prev.map((r) => (r.id === routineId
        ? { ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
        : r))),
    deleteRoutineStep: (routineId, stepId) =>
      applyRoutine(routineId, (r) => ({
        ...r,
        steps: r.steps.filter((s) => s.id !== stepId),
        doneStepIds: r.doneStepIds.filter((x) => x !== stepId),
      })),
    moveRoutineStep: (routineId, stepId, dir) =>
      setRoutines((prev) => prev.map((r) => {
        if (r.id !== routineId) return r
        const steps = [...r.steps]
        const i = steps.findIndex((s) => s.id === stepId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= steps.length) return r
        ;[steps[i], steps[j]] = [steps[j], steps[i]]
        return { ...r, steps }
      })),
    resetRoutine: (routineId) => applyRoutine(routineId, (r) => ({ ...r, doneStepIds: [], stepData: {} })),
    /* Ticking the routine itself ticks everything inside it, minus any step that
       has to be earned elsewhere (the typing gate), which stays his to pass. */
    setRoutineDone: (routineId, done) => applyRoutine(routineId, (r) => ({
      ...r,
      doneStepIds: done ? r.steps.filter((st) => !stepLocked(r, st.id)).map((st) => st.id) : [],
    })),

    addIdea: (text, color) => {
      const t = text.trim()
      if (!t) return
      setIdeas((prev) => [{ id: newId('idea'), space, text: t, when: todayKey(), color }, ...prev])
    },
    setIdeaColor: (id, color) => setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, color } : i))),
    deleteIdea: (id) => {
      const before = ideas
      setIdeas((prev) => prev.filter((i) => i.id !== id))
      armUndo('Note deleted', () => setIdeas(before))
    },

    undoable,
    undoDelete: () => { undoable?.restore(); setUndoable(null) },
    dismissUndo: () => setUndoable(null),

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

  return <Ctx.Provider value={value}>{children}<UndoToast /></Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}

/* The bar that lets a delete be taken back. It sits above the tab bar on the
   phone and clear of the Pomodoro badge on the desktop, and it goes away by
   itself after ten seconds, which is long enough to notice and act. */
function UndoToast() {
  const { undoable, undoDelete, dismissUndo } = useStore()
  useEffect(() => {
    if (!undoable) return
    const t = window.setTimeout(dismissUndo, 10000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoable?.id])
  if (!undoable) return null
  return (
    <div className="undo-bar" role="status">
      <span className="undo-what">{undoable.label}</span>
      <button className="undo-do" onClick={undoDelete}>Undo</button>
      <button className="undo-x" onClick={dismissUndo} aria-label="Dismiss">✕</button>
    </div>
  )
}
