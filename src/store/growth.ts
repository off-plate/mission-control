/* GROWTH. Split out of store.tsx (2026-09-10), the larger of the two
   remaining cohesive slices: habits, goals, routines, the daily review, and
   the weekly plan. These are genuinely one interlocking system -- a routine
   step IS a habit, a goal can be measured by one, a routine's own streak
   depends on its steps -- so unlike Notes/Contacts this could not be split
   any finer without threading deps through half a dozen tiny files for no
   real benefit. It owns nothing about Tasks/Projects/Ledger/Focus: the
   handful of places those genuinely cross (auto-ticking a habit from a
   finished focus block, commitPlan writing both `plan` and `tasks`, a
   dictated goal from the assistant) stay as glue in store.tsx itself, the
   same role applyExternal already plays for every domain. */
import { useMemo, useState } from 'react'
import { MOCK_GOALS, MOCK_HABITS, MOCK_ROUTINES } from '../mock'
import { rowKey } from '../sync-merge'
import {
  goalCurrent, habitGate, habitStepKey, requiredSteps, routineComplete, stepLocked,
} from '../types'
import type {
  CountPeriod,
  DayTaskLog,
  Goal,
  HabitDef,
  HabitFrequency,
  HabitKind,
  HabitSlip,
  HabitSource,
  HabitTick,
  PageId,
  PlanState,
  ReviewState,
  Routine,
  RoutineCadence,
  RoutineDone,
  RoutineStep,
  SpaceId,
  StepEntry,
  StepTick,
  TimeSlot,
} from '../types'
import { dayIndexOf, dayOfWeekKey, goalPeriodKey, isoWeekKey, localDateKey, periodKeyFor, type GoalTf } from '../util'
import { newId, todayKey } from './shared'

/* Routines become folders and their steps become habits. Pure, and used by
   BOTH paths on purpose: a saved state migrates through it once, and a fresh
   install seeds through it, so a new install is not left with the old shape
   that a migrated one no longer has. That gap was real: folders rendered for
   his data and not for a clean boot, which is also what the gate runs on. */
export function foldersFromRoutines(
  routines: Routine[],
  habits: HabitDef[],
  stepTicks: StepTick[],
): { habits: HabitDef[]; ticks: HabitTick[] } {
  const out = habits.map((h) => ({ ...h }))
  const byId = new Map(out.map((h) => [h.id, h]))
  const freqFor = (c: string): HabitFrequency =>
    (c === 'prework' ? 'weekdays' : c === 'weekly' ? 'weekly' : c === 'monthly' ? 'monthly' : 'daily')
  /* Mon..Sun of the current week, so a habit born here shows the days it was
     already kept instead of an empty strip he would read as a broken streak. */
  const now = new Date()
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const made: HabitDef[] = []
  const ticks: HabitTick[] = []

  for (const r of routines) {
    const folderHabit = r.habitId ? byId.get(r.habitId) : undefined
    let order = 0
    for (const st of r.steps ?? []) {
      order += 1
      const carried = {
        note: st.note, example: st.example, link: st.link, linkLabel: st.linkLabel,
        goto: st.goto, gotoLabel: st.gotoLabel, optional: st.optional,
        alts: st.alts, seconds: st.seconds, srcStepId: st.id,
        ...(st.id === 'mr4' ? { gatedBy: 'typing-wpm' as const } : {}),
        /* The two steps whose whole body was content the app made fresh every
           morning. A note cannot stand in for today's news paragraphs or
           today's tongue twisters, so the habit brings the body with it. */
        ...(st.id === 'mr2' ? { runner: 'pronunciation' as const } : {}),
        ...(st.id === 'mr3' ? { runner: 'stretch' as const } : {}),
      }
      /* A step that already fed a habit does not get a second one: that habit
         joins the folder, keeping every day it has already been kept. */
      const existing = st.habitId ? byId.get(st.habitId) : undefined
      if (existing) {
        existing.folderId = existing.folderId ?? r.id
        existing.folderOrder = existing.folderOrder ?? order
        const target = existing as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(carried)) {
          if (v !== undefined && target[k] === undefined) target[k] = v
        }
        continue
      }
      const id = `h-${r.id}-${st.id}`
      /* Already made by an earlier run of this same function. It still gets
         anything the step carries that it does not have yet, because the list
         of what a step carries has grown since: running this twice must be the
         way a habit CATCHES UP, not the way it is left behind. Only undefined
         fields are filled, so nothing he has edited is overwritten. */
      const already = byId.get(id)
      if (already) {
        const target = already as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(carried)) {
          if (v !== undefined && target[k] === undefined) target[k] = v
        }
        continue
      }
      const mine = stepTicks.filter((t) => t.routineId === r.id && t.stepId === st.id)
      /* Deliberately NOT kind:'measured' for a timer step. A measured habit in
         this app fills itself from focus SESSIONS, and a three minute
         meditation is not a focus session; it would have started auto-keeping
         itself off unrelated work. The length rides along as `seconds`. */
      const h: HabitDef = {
        id, space: r.space, name: st.title,
        days: weekDays.map((d) => mine.some((t) => t.day === d)),
        paused: false, history: [],
        folderId: r.id, folderOrder: order,
        frequency: freqFor(r.cadence),
        daypart: folderHabit?.daypart,
        startedOn: mine.length ? mine.map((t) => t.day).sort()[0] : undefined,
        ...carried,
      }
      made.push(h); byId.set(id, h)
      for (const t of mine) ticks.push({ habitId: id, day: t.day, src: 'routine-merge' })
    }
  }
  return { habits: [...out, ...made], ticks }
}

export function useGrowthSlice(
  persisted: {
    habits?: HabitDef[]
    goals?: Goal[]
    routines?: Routine[]
    records?: Record<string, number>
    removedSeeds?: string[]
    habitLog?: HabitTick[]
    routineLog?: RoutineDone[]
    slips?: HabitSlip[]
    stepLog?: StepEntry[]
    dayLog?: DayTaskLog[]
    stepTicks?: StepTick[]
    dailyDone?: string
    dailySkipped?: string
    plan?: PlanState
    review?: ReviewState
  } | null,
  deps: {
    space: SpaceId
    armUndo: (label: string, restore: () => void) => void
    bury: (...keys: string[]) => void
    digUp: (...keys: string[]) => void
    setPageState: (p: PageId) => void
  },
) {
  const { space, armUndo, bury, digUp, setPageState } = deps
  const seedTodayIdx = (new Date().getDay() + 6) % 7
  /* Seed: past days keep the mock pattern, future days are empty. Today starts
     UNCHECKED for any habit a routine mirrors, so the two pages never disagree
     on a fresh load: you earn today by running the routine. */
  const seededHabits = useMemo(() => {
    const mirrored = new Set(MOCK_ROUTINES.map((r) => r.habitId).filter(Boolean) as string[])
    const base = MOCK_HABITS.map((h) => ({
      ...h,
      days: h.days.map((d, i) => (i > seedTodayIdx ? false : i === seedTodayIdx && mirrored.has(h.id) ? false : d)),
    }))
    /* A fresh install seeds through the same conversion a saved one migrates
       through, so the two never disagree about the shape of the app. Without
       this a clean boot had routines and no folders, which is also what every
       gate run starts from. */
    return foldersFromRoutines(MOCK_ROUTINES, base, []).habits
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
      // A new period starts nothing: the checks, the choices and the moment it
      // was started all belong to the period they were made in.
      if (r.periodKey !== key) return { ...r, doneStepIds: [], stepData: {}, stepChoice: {}, startedAt: undefined, run: 0, periodKey: key }
      const doneStepIds = r.doneStepIds.filter((id) => r.steps.some((st) => st.id === id))
      return {
        ...r,
        doneStepIds,
        stepData: r.stepData ?? {},
        stepChoice: r.stepChoice ?? {},
        // A routine whose every tick was deleted with its steps is not underway.
        startedAt: doneStepIds.length ? r.startedAt : undefined,
        periodKey: key,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted])

  const [habits, setHabits] = useState(persisted?.habits ?? seededHabits)
  const [goals, setGoals] = useState(persisted?.goals ?? seededGoals)
  const [routines, setRoutines] = useState<Routine[]>(seededRoutines)
  const [records, setRecords] = useState<Record<string, number>>(persisted?.records ?? {})
  // Seeded ids he has deleted, so the forward-fill never resurrects them.
  const [removedSeeds, setRemovedSeeds] = useState<string[]>(persisted?.removedSeeds ?? [])
  const [habitLog, setHabitLog] = useState<HabitTick[]>(persisted?.habitLog ?? [])
  const [routineLog, setRoutineLog] = useState<RoutineDone[]>(persisted?.routineLog ?? [])
  const [slips, setSlips] = useState<HabitSlip[]>(persisted?.slips ?? [])
  const [stepLog, setStepLog] = useState<StepEntry[]>(persisted?.stepLog ?? [])
  const [dayLog, setDayLog] = useState<DayTaskLog[]>(persisted?.dayLog ?? [])
  const [stepTicks, setStepTicks] = useState<StepTick[]>(persisted?.stepTicks ?? [])
  const [dailyOpen, setDailyOpen] = useState(false)
  const [dailyDone, setDailyDone] = useState<string | undefined>(persisted?.dailyDone)
  const [dailySkipped, setDailySkipped] = useState<string | undefined>(persisted?.dailySkipped)
  const [plan, setPlan] = useState<PlanState>(persisted?.plan ?? { committedDate: null, firstMoveId: null })
  const [review, setReview] = useState<ReviewState>(persisted?.review ?? { lastDoneDate: null, wins: [], outcomes: [] })

  /* A counted habit is logged one tap at a time: three walks on Tuesday are
     three rows, not one day ticked. Taking one back removes the most recent row
     rather than the day, because the day may still hold two more. */
  const logCount = (habitId: string, delta: 1 | -1) => {
    const day = todayKey()
    const idx = (new Date().getDay() + 6) % 7
    let next = habitLog
    if (delta === 1) {
      next = [...habitLog, { habitId, day, src: `count#${Date.now()}${Math.round(performance.now())}`, at: new Date().toISOString() }]
    } else {
      const mine = habitLog.filter((t) => t.habitId === habitId && t.day === day)
      const last = mine[mine.length - 1]
      if (!last) return
      const at = habitLog.lastIndexOf(last)
      next = [...habitLog.slice(0, at), ...habitLog.slice(at + 1)]
    }
    setHabitLog(next)
    const held = next.some((t) => t.habitId === habitId && t.day === day)
    setHabits((prev) => prev.map((h) => (h.id === habitId
      ? { ...h, days: h.days.map((d, i) => (i === idx ? held : d)) }
      : h)))
  }

  /* The hand-correction path for a routine-kept day. Writes BOTH records, the
     habit row and the routine's own finish, so the calendar, the goals and the
     day page agree with the dot. */
  /* `force` asserts rather than toggles. The habit strip WANTS a toggle: a dot
     he ticked by mistake has to be untickable. A screen whose button says "I
     did it" must never be able to unmark anything, in any state, and the daily
     review found exactly that: a routine part-done but already ticked by hand
     had one button, and it deleted the day off his streak. */
  const assertRoutineOn = (habitId: string, day: string, force = false) => {
    if (day >= todayKey()) return
    const r = routines.find((x) => x.habitId === habitId && !x.archivedAt)
    const has = habitLog.some((t) => t.habitId === habitId && t.day === day)
    if (has && force) return
    markDayOn(habitId, day, !has)
    if (!r) return
    const pk = r.cadence === 'weekly' ? isoWeekKey(new Date(`${day}T12:00:00`))
      : r.cadence === 'monthly' ? day.slice(0, 7) : day
    setRoutineLog((prev) => (has
      ? prev.filter((x) => !(x.routineId === r.id && x.day === day))
      : [...prev, { routineId: r.id, day, periodKey: pk, run: 0 }]))
  }

  const assertRoutineDay = (habitId: string, dayIndex: number) => assertRoutineOn(habitId, dayOfWeekKey(dayIndex))

  /* "I have been keeping this since June" is a claim about days, so it is
     written as days: every day from the start to YESTERDAY is marked kept, in
     the log and in this week's cache. Today is deliberately left alone, because
     a habit added this morning has not been done yet and a green dot for it
     would be a lie. A day he already has a row for is never touched, so this
     cannot double-tick, cannot overwrite a day he corrected by hand, and running
     it twice changes nothing. */
  const backfillKept = (habitId: string, from?: string, until?: string) => {
    const today = todayKey()
    const stop = until && until < today ? until : today
    if (!from || from >= stop) return
    const have = new Set(habitLog.filter((t) => t.habitId === habitId).map((t) => t.day))
    const rows: HabitTick[] = []
    const cursor = new Date(`${from}T12:00:00`)
    const end = new Date(`${stop}T12:00:00`)
    if (Number.isNaN(cursor.getTime())) return
    while (cursor < end) {
      const key = localDateKey(cursor)
      if (!have.has(key)) rows.push({ habitId, day: key, src: 'since' })
      cursor.setDate(cursor.getDate() + 1)
    }
    const filled = new Set(rows.map((r) => r.day))
    if (rows.length) setHabitLog((prev) => [...prev, ...rows])
    setHabits((prev) => prev.map((h) => (h.id !== habitId ? h : {
      ...h,
      // The date is now accounted for, whether or not it needed any new rows.
      filledSince: from,
      days: h.days.map((v, i) => v || filled.has(dayOfWeekKey(i))),
    })))
  }

  /** Tick or untick one day of one habit, in the log and in the week cache. */
  /* By DATE, not by weekday index. The index is a position in THIS week, so on
     a Monday "yesterday" is index 6 and marking it wrote the Sunday that has
     not happened yet. Anything that talks about a specific day goes through
     here; the index version below is a thin wrapper for the week strip. */
  const markDayOn = (habitId: string, day: string, value: boolean) => {
    const gone = habitLog.filter((t) => t.habitId === habitId && t.day === day)
    const without = habitLog.filter((t) => !(t.habitId === habitId && t.day === day))
    const next = value ? [...without, { habitId, day, at: day === todayKey() ? new Date().toISOString() : undefined }] : without
    setHabitLog(next)
    /* UNTICKING HAS TO SURVIVE A SYNC.

       His report: untick a habit, reload, and it is ticked again. Removing the
       row from habitLog was never enough, because the merge unites the two
       sides' logs by row identity: the other device still holds the row, so the
       union hands it straight back. Every other removal in this file buries its
       key for exactly this reason, and this one did not.

       A tick digs the key back up, because a tombstone the other device still
       holds would otherwise re-bury a habit he has just done again. */
    if (value) {
      digUp(rowKey('habitLog', { habitId, day }))
    } else if (gone.length) {
      bury(...gone.map((t) => rowKey('habitLog', { habitId, day: t.day, src: t.src })))
    }
    /* days[] is a cache of THIS week only. A day outside it has no cell, and
       writing one would put the mark on the wrong square. */
    if (dayOfWeekKey(dayIndexOf(day)) === day) {
      const i = dayIndexOf(day)
      setHabits((prev) => prev.map((h) => (h.id === habitId
        ? { ...h, days: h.days.map((d, k) => (k === i ? value : d)) }
        : h)))
    }
    /* A habit that came out of a routine step IS that step. Ticking it here has
       to reach the routine card on Plan, or one morning reads as done in one
       place and untouched in the other. */
    const h = habits.find((x) => x.id === habitId)
    if (h?.folderId && h.srcStepId && day === todayKey()) syncRoutineFromHabits(h.folderId, next)
  }

  /** The same write as markDayOn, for many dates on one habit in a single
   *  state update. markDayOn calls setHabitLog(next) off the CLOSED-OVER
   *  habitLog, which is exactly right for one call and wrong for several in
   *  a row: each iteration would read the same pre-loop snapshot, so only
   *  the last of a batch would actually stick. Found live doing a Hevy
   *  backfill -- four workout days in, only the oldest survived. This is
   *  the one-pass version a backfill needs; markDayOn is untouched because
   *  every other call site really is one date at a time. */
  const markDaysOn = (habitId: string, days: string[], value: boolean) => {
    if (!days.length) return
    const set = new Set(days)
    const gone = habitLog.filter((t) => t.habitId === habitId && set.has(t.day))
    const without = habitLog.filter((t) => !(t.habitId === habitId && set.has(t.day)))
    const next = value
      ? [...without, ...days.map((day) => ({ habitId, day, at: day === todayKey() ? new Date().toISOString() : undefined }))]
      : without
    setHabitLog(next)
    if (value) digUp(...days.map((day) => rowKey('habitLog', { habitId, day })))
    else if (gone.length) bury(...gone.map((t) => rowKey('habitLog', { habitId, day: t.day, src: t.src })))
    const thisWeek = new Map(days.filter((day) => dayOfWeekKey(dayIndexOf(day)) === day).map((day) => [dayIndexOf(day), value]))
    if (thisWeek.size) {
      setHabits((prev) => prev.map((h) => (h.id === habitId
        ? { ...h, days: h.days.map((d, k) => (thisWeek.has(k) ? thisWeek.get(k)! : d)) }
        : h)))
    }
    const h2 = habits.find((x) => x.id === habitId)
    if (h2?.folderId && h2.srcStepId && set.has(todayKey())) syncRoutineFromHabits(h2.folderId, next)
  }

  /* The routine card and the habit folder are two views of one morning, so a
     tick on either side settles both. Written out here rather than routed
     through applyRoutine on purpose: that path writes the habit log back from
     the routine, and would undo the very tick that called it. */
  const syncRoutineFromHabits = (routineId: string, log: HabitTick[]) => {
    const r = routines.find((x) => x.id === routineId)
    if (!r) return
    const day = todayKey()
    const kept = (hid: string) => log.some((t) => t.habitId === hid && t.day === day)
    /* A step with no habit of its own keeps whatever the routine already said
       about it, so this can never quietly untick something it does not own. */
    const doneStepIds = r.steps
      .filter((st) => {
        const hid = st.habitId ?? `h-${routineId}-${st.id}`
        return habits.some((x) => x.id === hid) ? kept(hid) : r.doneStepIds.includes(st.id)
      })
      .map((st) => st.id)
    markSteps(routineId, r.steps.map((s) => s.id).filter((id) => !doneStepIds.includes(id)), false)
    markSteps(routineId, doneStepIds, true)

    const key = periodKeyFor(r.cadence)
    const after = {
      ...r,
      doneStepIds,
      startedAt: doneStepIds.length === 0 ? undefined : (r.startedAt ?? new Date().toISOString()),
    }
    const wasComplete = routineComplete(r, periodKeyFor(r.cadence))
    const isComplete = routineComplete(after, key)
    setRoutines((prev) => prev.map((x) => (x.id === routineId
      ? { ...after, periodKey: key, completedOn: isComplete ? (wasComplete ? r.completedOn ?? day : day) : null }
      : x)))
    if (wasComplete === isComplete) return

    const run = r.run ?? 0
    setRoutineLog((prev) => {
      const without = prev.filter((x) => !(x.routineId === routineId && x.periodKey === key && (x.run ?? 0) === run))
      return isComplete ? [...without, { routineId, day, periodKey: key, run, at: new Date().toISOString() }] : without
    })
    /* The folder's own streak. It is the routine's record of having been
       finished, and it has to advance from this side too: keeping all five
       habits IS keeping the morning routine. Written from the log this call was
       given, so the tick that started it survives. */
    if (!r.habitId) return
    const hid = r.habitId
    const rest = log.filter((t) => !(t.habitId === hid && t.day === day))
    setHabitLog(isComplete ? [...rest, { habitId: hid, day, at: new Date().toISOString() }] : rest)
    const i = dayIndexOf(day)
    setHabits((prev) => prev.map((x) => (x.id === hid
      ? { ...x, days: x.days.map((d, k) => (k === i ? isComplete : d)) }
      : x)))
  }

  const markDay = (habitId: string, dayIndex: number, value: boolean) =>
    markDayOn(habitId, dayOfWeekKey(dayIndex), value)

  /* A habit kept by a routine STEP rather than by a whole routine. Each step
     writes its own row for the day, so meditating in the morning routine and
     again inside Out Brain Rot leaves two rows: the day stays kept while either
     is ticked, undoing one does not undo the other, and the number of rows is
     how often he actually did it. */
  const syncStepHabits = (changes: { habitId: string; src: string; on: boolean; exclusive?: boolean }[]) => {
    if (!changes.length) return
    const day = todayKey()
    /* Applied as one batch rather than one call per step: ticking a whole
       routine changes several steps in a single event, and one-at-a-time each
       would compute its result from the same stale log and undo the last. */
    let next = habitLog
    for (const c of changes) {
      /* `exclusive` is a habit that came out of THIS step and no other: one
         row for the day, replaced, exactly as ticking it on the Habits page
         writes it. The src-scoped rule below belongs to a habit two routines
         share (meditation), where undoing one must not undo the other. Using
         the shared rule for a private habit left the two surfaces able to hold
         one row each, and the day stayed kept after he had untidied it. */
      next = c.exclusive
        ? next.filter((t) => !(t.habitId === c.habitId && t.day === day))
        : next.filter((t) => !(t.habitId === c.habitId && t.day === day && t.src === c.src))
      if (c.on) next = [...next, { habitId: c.habitId, day, src: c.src, at: new Date().toISOString() }]
    }
    setHabitLog(next)
    const idx = (new Date().getDay() + 6) % 7
    const held = new Map(changes.map((c) => [c.habitId, next.some((t) => t.habitId === c.habitId && t.day === day)]))
    setHabits((prev) => prev.map((h) => (held.has(h.id)
      ? { ...h, days: h.days.map((d, i) => (i === idx ? held.get(h.id)! : d)) }
      : h)))
  }

  /* A routine reaches his day by being started, not by existing. The first tick
     stamps the moment, and that moment decides which part of the day it files
     itself under. Ticking a second step must not move it, so the stamp is only
     ever written when there is none. Undoing back to nothing ticked takes the
     stamp away again: a routine he opened and closed was not started. */
  const stamped = (r: Routine): Routine => ({
    ...r,
    startedAt: r.doneStepIds.length === 0 ? undefined : (r.startedAt ?? new Date().toISOString()),
  })

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

    /* A step that keeps a habit reports itself on every toggle, not only when
       the routine as a whole flips: meditation counts the moment he meditates,
       whatever the other four steps are doing. */
    /* Every step is a habit now, not only the four that were wired to one by
       hand. Without the derived id, ticking a step on the Plan card left the
       habit it became untouched, so the same morning read done on one page and
       untouched on the other. */
    syncStepHabits(after.steps.flatMap((st) => {
      const hid = st.habitId ?? `h-${routineId}-${st.id}`
      if (!habits.some((h) => h.id === hid)) return []
      const was = before.doneStepIds.includes(st.id)
      const is = after.doneStepIds.includes(st.id)
      return was === is ? [] : [{ habitId: hid, src: `${routineId}:${st.id}#${after.run ?? 0}`, on: is, exclusive: !st.habitId }]
    }))

    if (wasComplete === isComplete) return

    /* Which day this routine was finished, kept for good. completedOn holds only
       the most recent one, so on its own it could never answer "which day did I
       do it" for any day but the last.

       Rows are keyed by the RUN they belong to, not by the period. Finishing a
       repeatable routine a second time therefore adds a second row instead of
       replacing the first, and undoing the run he is in cannot reach the runs he
       already finished. */
    const run = after.run ?? 0
    setRoutineLog((prev) => {
      const without = prev.filter((r) => !(r.routineId === routineId && r.periodKey === key && (r.run ?? 0) === run))
      return isComplete
        ? [...without, { routineId, day: todayKey(), periodKey: key, run, at: new Date().toISOString() }]
        : without
    })

    if (!before.habitId) return
    const hid = before.habitId
    const clearIdx = before.completedOn && isoWeekKey(new Date(before.completedOn)) === isoWeekKey()
      ? dayIndexOf(before.completedOn)
      : (new Date().getDay() + 6) % 7
    /* An earlier run of this period still counts. Undoing the run in progress
       must not take back a routine he genuinely finished this morning. */
    const earlier = routineLog.some((r) => r.routineId === routineId && r.periodKey === key && (r.run ?? 0) !== run)
    // Through markDay, so a routine-driven tick lands in the durable log too.
    markDay(hid, isComplete ? (new Date().getDay() + 6) % 7 : clearIdx, isComplete || earlier)
  }

  /* Every step he ticks leaves a dated row behind. The routine's own doneStepIds
     is wiped at each rollover, so without this a routine he got halfway through
     on Monday is indistinguishable on Tuesday from one he never opened, which is
     exactly what he saw on Habits. Only TODAY is ever written or unwritten: a
     past day is history, and history does not change because he opened the app.
     Untick removes the row rather than writing a false one, so a mis-tap does
     not leave a permanent half-day on the record. */
  const markSteps = (routineId: string, stepIds: string[], on: boolean) => {
    if (!stepIds.length) return
    const day = todayKey()
    setStepTicks((prev) => {
      const rest = prev.filter((t) => !(t.routineId === routineId && t.day === day && stepIds.includes(t.stepId)))
      return on ? [...rest, ...stepIds.map((stepId) => ({ routineId, stepId, day }))] : rest
    })
  }

  return {
    habits, setHabits, goals, setGoals, routines, setRoutines,
    records, setRecords, removedSeeds, setRemovedSeeds,
    habitLog, setHabitLog, routineLog, setRoutineLog, slips, setSlips,
    stepLog, setStepLog, dayLog, setDayLog, stepTicks, setStepTicks,
    dailyOpen, dailyDone, setDailyDone, dailySkipped, setDailySkipped, plan, setPlan, review, setReview,

    assertRoutineDay,
    toggleHabitDay: (id: string, day: number) => {
      const h = habits.find((x) => x.id === id)
      if (!h) return
      markDay(id, day, !h.days[day])
    },
    markHabitDay: (id: string, day: number, value: boolean) => markDay(id, day, value),
    markHabitDayOn: (id: string, day: string, value: boolean) => markDayOn(id, day, value),
    markHabitDaysOn: (id: string, days: string[], value: boolean) => markDaysOn(id, days, value),
    logHabitNumber: (habitId: string, value: number) => {
      const h = habits.find((x) => x.id === habitId)
      const key = h && habitStepKey(h)
      if (!h || !key) return
      const day = todayKey()
      /* Every run is kept, with the moment it happened, in the same series the
         step wrote before the merge, keyed by routine and step, so the scores
         from before and after are one line about one test. */
      setStepLog((prev) => [...prev, { routineId: key.routineId, stepId: key.stepId, day, at: new Date().toISOString(), value }])
      const rk = `${key.routineId}:${key.stepId}`
      setRecords((prev) => (value > (prev[rk] ?? 0) ? { ...prev, [rk]: value } : prev))
      const gate = habitGate(h)
      /* Judged on the number in hand, not on the log: the write above has not
         reached this render's state, so reading it back would refuse the very
         result that just passed. A failing run never takes the day away either,
         because the day is his BEST run, and doing another one after you have
         already passed is not a way to lose it. */
      if (!gate || value >= gate.target) markDayOn(habitId, day, true)
    },
    pickHabitAlt: (habitId: string, altId: string) => {
      const h = habits.find((x) => x.id === habitId)
      if (!h?.alts?.length) return
      const day = todayKey()
      const src = `alt:${altId}`
      const on = habitLog.some((t) => t.habitId === habitId && t.day === day && t.src === src)
      const mine = new Set(h.alts.map((a) => `alt:${a.id}`))
      const rest = habitLog.filter((t) => !(t.habitId === habitId && t.day === day && !!t.src && mine.has(t.src)))
      const next = on ? rest : [...rest, { habitId, day, src, at: new Date().toISOString() }]
      setHabitLog(next)
      const i = dayIndexOf(day)
      const held = next.some((t) => t.habitId === habitId && t.day === day)
      setHabits((prev) => prev.map((x) => (x.id === habitId
        ? { ...x, days: x.days.map((d, k) => (k === i ? held : d)) }
        : x)))
      if (h.folderId && h.srcStepId) syncRoutineFromHabits(h.folderId, next)
    },
    openDaily: () => setDailyOpen(true),
    closeDaily: (walked: boolean) => {
      setDailyOpen(false)
      if (walked) setDailyDone(todayKey()); else setDailySkipped(todayKey())
    },
    markHabitOn: (id: string, day: string, value: boolean) => markDayOn(id, day, value),
    assertRoutineOn,
    /* A slip on a day he is only now admitting to. Same rules as today's: one
       row per day, and takeable back, because saying it out loud is hard enough
       without it also being irreversible. */
    logSlipOn: (id: string, day: string) => {
      if (slips.some((s) => s.habitId === id && s.day === day)) return
      const before = slips
      setSlips((prev) => [...prev, { habitId: id, day }])
      armUndo('Slip logged', () => setSlips(before))
    },
    addHabit: (input: {
      name: string; daypart?: TimeSlot; frequency: HabitFrequency; targetPerWeek?: number
      kind?: HabitKind; dailyTargetMin?: number; measure?: 'minutes' | 'times'; per?: CountPeriod
      targetCount?: number; source?: HabitSource; quitSince?: string; startedOn?: string
    }) => {
      const id = newId('h')
      setHabits((prev) => [...prev, {
        id, space, name: input.name, daypart: input.daypart,
        frequency: input.frequency, targetPerWeek: input.targetPerWeek,
        kind: input.kind ?? 'build',
        dailyTargetMin: input.dailyTargetMin,
        /* Copied across explicitly, like every other field here. A row built
           field by field drops anything the shape gains later, silently. */
        measure: input.measure,
        per: input.per,
        targetCount: input.targetCount,
        source: input.source,
        // A quit runs from the day he says he stopped, not from the day he got
        // round to typing it in.
        quitSince: input.kind === 'break' ? (input.quitSince ?? todayKey()) : undefined,
        // And the same courtesy the other way round: a habit he has been keeping
        // since June starts in June, not on the day he typed it in here.
        startedOn: input.kind === 'break' ? undefined : (input.startedOn ?? todayKey()),
        filledSince: input.kind === 'break' ? undefined : (input.startedOn ?? todayKey()),
        days: [false, false, false, false, false, false, false], paused: false,
      }])
      // Started before today means those days were kept. Say so in the record.
      if (input.kind !== 'break') backfillKept(id, input.startedOn)
    },
    /* A slip is a dated record, appended. It used to overwrite one field, so the
       second slip erased the first and the clean run before it went with it.
       Saying it out loud is hard enough without it also being irreversible, so
       it can be taken back like any other change. */
    logSlip: (id: string) => {
      const day = todayKey()
      if (slips.some((s) => s.habitId === id && s.day === day)) return
      const before = slips
      setSlips((prev) => [...prev, { habitId: id, day }])
      armUndo('Slip logged for today', () => setSlips(before))
    },
    updateHabit: (id: string, patch: Partial<Pick<HabitDef, 'name' | 'daypart' | 'frequency' | 'targetPerWeek' | 'kind' | 'dailyTargetMin' | 'measure' | 'per' | 'targetCount' | 'source' | 'quitSince' | 'startedOn'>>) => {
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)))
      /* Moving the start date EARLIER claims the days it just reached back
         over, and only those. Saving the sheet again with the same date must
         not re-tick a day he has since unticked, and moving the date later
         never deletes a day already logged: a day recorded as kept is his, and
         no edit here is allowed to take one back. */
      if (patch.startedOn && patch.kind !== 'break') {
        const had = habits.find((h) => h.id === id)?.filledSince
        if (patch.startedOn !== had) backfillKept(id, patch.startedOn, had)
      }
    },
    togglePauseHabit: (id: string) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, paused: !h.paused } : h))),
    /* Retired, not erased. Removing the row removed the only thing that could
       name its ticks, so a hundred days of a habit he stopped became a hundred
       orphan records: still on disk, unreadable, and gone from every day he
       looked back at. It comes off the page; its history stays legible. */
    deleteHabit: (id: string) => {
      const beforeH = habits, beforeSeeds = removedSeeds
      const gone = habits.find((h) => h.id === id)
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, archivedAt: todayKey() } : h)))
      setRemovedSeeds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Habit deleted', () => {
        setHabits(beforeH); setRemovedSeeds(beforeSeeds)
      })
    },

    /* A goal is set for a period. Without one it was a rolling window that never
       ended, so "this week's goals" quietly became "goals, forever". */
    addGoal: (g: Omit<Goal, 'id'>) => setGoals((prev) => [...prev, {
      ...g,
      id: newId('g'),
      periodKey: g.periodKey ?? goalPeriodKey((g.timeframe ?? 'quarter') as GoalTf),
      /* Age, so the avoidance rule can reach a goal the way it reaches a task. */
      createdAt: todayKey(),
      touchedAt: todayKey(),
    }]),
    /** Set the same goal again for the period we are in now. */
    repeatGoal: (id: string): string | null => {
      const g = goals.find((x) => x.id === id)
      if (!g) return null
      const tf = (g.timeframe ?? 'quarter') as GoalTf
      const periodKey = goalPeriodKey(tf)
      /* A second click must not multiply the goal. The button gave no sign a
         first click had landed -- same page, same list, nothing visibly
         changed -- so a dozen clicks made a dozen "Tracking my calories"
         goals before he noticed. If this period already has one repeated
         from the same finished goal, hand back its id instead of making
         another; the caller flashes it either way, so a repeat click still
         reads as "yes, it's here." */
      const already = goals.find((x) => !x.closed && x.space === g.space
        && (x.timeframe ?? 'quarter') === tf && x.periodKey === periodKey && x.name === g.name)
      if (already) return already.id
      const next = {
        ...g,
        id: newId('g'),
        periodKey,
        current: 0,
        closed: undefined,
        createdAt: todayKey(),
        touchedAt: todayKey(),
        milestones: g.milestones?.map((m) => ({ ...m, done: false })),
      }
      setGoals((prev) => [...prev, next])
      setPageState('goals')
      return next.id
    },
    /* Editing a goal is how a habit gets attached to one that already exists.
       Clearing the link keeps whatever the habit had counted, so the number
       does not jump backwards when you switch to logging by hand. */
    updateGoal: (id: string, patch: Partial<Omit<Goal, 'id' | 'space'>>) =>
      setGoals((prev) => prev.map((g) => {
        if (g.id !== id) return g
        const next = { ...g, ...patch, touchedAt: todayKey() }
        if ('habitId' in patch && !patch.habitId && g.habitId) next.current = g.current
        return next
      })),
    bumpGoal: (id: string, delta: number) =>
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id ? { ...g, current: Math.max(0, Math.min(g.target, g.current + delta)), touchedAt: todayKey() } : g,
        ),
      ),
    /* Ticking a milestone advances the goal itself when the goal is measured in
       its milestones (target equals their count); other units keep their own
       counter and only the milestone list changes. Strict math, no fudging. */
    toggleGoalMilestone: (goalId: string, milestoneId: string) =>
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goalId || !g.milestones) return g
          const milestones = g.milestones.map((m) => (m.id === milestoneId ? { ...m, done: !m.done } : m))
          const doneCount = milestones.filter((m) => m.done).length
          const current = g.target === milestones.length ? doneCount : g.current
          return { ...g, milestones, current, touchedAt: todayKey() }
        }),
      ),
    deleteGoal: (id: string) => {
      const before = goals
      const gone = goals.find((g) => g.id === id)
      setGoals((prev) => prev.filter((g) => g.id !== id))
      bury(rowKey('goals', { id }))
      armUndo(gone ? `Deleted "${gone.name}"` : 'Goal deleted', () => { setGoals(before); digUp(rowKey('goals', { id })) })
    },

    toggleRoutineStep: (routineId: string, stepId: string) => {
      const r = routines.find((x) => x.id === routineId)
      if (!r) return
      // A gated step (the typing test) obeys the same rule on every surface.
      if (!r.doneStepIds.includes(stepId) && stepLocked(r, stepId)) return
      const has = r.doneStepIds.includes(stepId)
      const doneStepIds = has ? r.doneStepIds.filter((x) => x !== stepId) : [...r.doneStepIds, stepId]
      applyRoutine(routineId, (x) => stamped({ ...x, doneStepIds }))
      markSteps(routineId, [stepId], !has)
    },
    /* Picking one of a step's alternatives IS ticking that step. The choice is
       kept so the day record can say which way he went, and picking the same one
       again clears it, which is the only way to undo a step that has no checkbox
       of its own. */
    toggleRoutineAlt: (routineId: string, stepId: string, altId: string) => {
      applyRoutine(routineId, (r) => {
        const off = r.stepChoice?.[stepId] === altId
        const stepChoice = { ...(r.stepChoice ?? {}) }
        if (off) delete stepChoice[stepId]
        else stepChoice[stepId] = altId
        const doneStepIds = off
          ? r.doneStepIds.filter((x) => x !== stepId)
          : r.doneStepIds.includes(stepId) ? r.doneStepIds : [...r.doneStepIds, stepId]
        markSteps(routineId, [stepId], !off)
        return stamped({ ...r, stepChoice, doneStepIds })
      })
    },
    /* Logging the number IS completing the step, in one action. Keeping them
       apart meant the gate read the old score and refused the very result that
       had just satisfied it. */
    setStepData: (routineId: string, stepId: string, value: number) => {
      applyRoutine(routineId, (r) => {
        const stepData = { ...(r.stepData ?? {}), [stepId]: value }
        const passes = !stepLocked({ ...r, stepData }, stepId)
        const doneStepIds = passes && !r.doneStepIds.includes(stepId)
          ? [...r.doneStepIds, stepId]
          : !passes ? r.doneStepIds.filter((x) => x !== stepId) : r.doneStepIds
        return stamped({ ...r, stepData, doneStepIds })
      })
      /* Every run is kept, with the moment it happened. Keying by day and
         replacing meant a second attempt erased the first: run 76 in the
         morning and 83 in the evening and the 76 was gone, which is the same
         thing `records` was already doing wrong at a slower rate. */
      setStepLog((prev) => [...prev, { routineId, stepId, day: todayKey(), at: new Date().toISOString(), value }])
      const key = `${routineId}:${stepId}`
      setRecords((prev) => (value > (prev[key] ?? 0) ? { ...prev, [key]: value } : prev))
    },
    addRoutine: (input: { title: string; cadence: RoutineCadence; blurb?: string; daypart?: TimeSlot }) => {
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
    updateRoutine: (id: string, patch: Partial<Pick<Routine, 'title' | 'cadence' | 'blurb'>>) => {
      setRoutines((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      // The mirrored habit carries the routine's name, so keep them in step.
      const r = routines.find((x) => x.id === id)
      if (r?.habitId && patch.title) setHabits((hs) => hs.map((h) => (h.id === r.habitId ? { ...h, name: patch.title as string } : h)))
    },
    /* Deleting a routine takes its habit with it: a habit only a routine could
       tick would otherwise sit there permanently unfinishable. */
    deleteRoutine: (id: string) => {
      const r = routines.find((x) => x.id === id)
      // A routine takes its habit and its goal's link with it, so undo has to
      // put all three back, not just the routine.
      const beforeR = routines, beforeH = habits, beforeG = goals, beforeSeeds = removedSeeds
      armUndo(r ? `Deleted "${r.title}"` : 'Routine deleted', () => {
        setRoutines(beforeR); setHabits(beforeH); setGoals(beforeG); setRemovedSeeds(beforeSeeds)
      })
      setRoutines((prev) => prev.map((x) => (x.id === id ? { ...x, archivedAt: todayKey() } : x)))
      if (r?.habitId) {
        const hid = r.habitId
        setHabits((hs) => hs.map((h) => (h.id === hid ? { ...h, archivedAt: todayKey() } : h)))
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
    addRoutineStep: (routineId: string, step: { title: string; note?: string; link?: string; linkLabel?: string }) =>
      applyRoutine(routineId, (r) => ({ ...r, steps: [...r.steps, { id: newId('st'), kind: 'do' as const, ...step }] })),
    updateRoutineStep: (routineId: string, stepId: string, patch: Partial<Pick<RoutineStep, 'title' | 'note' | 'link' | 'linkLabel'>>) =>
      setRoutines((prev) => prev.map((r) => (r.id === routineId
        ? { ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
        : r))),
    deleteRoutineStep: (routineId: string, stepId: string) =>
      applyRoutine(routineId, (r) => ({
        ...r,
        steps: r.steps.filter((s) => s.id !== stepId),
        doneStepIds: r.doneStepIds.filter((x) => x !== stepId),
      })),
    moveRoutineStep: (routineId: string, stepId: string, dir: -1 | 1) =>
      setRoutines((prev) => prev.map((r) => {
        if (r.id !== routineId) return r
        const steps = [...r.steps]
        const i = steps.findIndex((s) => s.id === stepId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= steps.length) return r
        ;[steps[i], steps[j]] = [steps[j], steps[i]]
        return { ...r, steps }
      })),
    /* Not a reset. The run he just finished stays in the log, keeps its habit
       tick and keeps whatever its steps recorded; this only opens a fresh run on
       top of it. Nothing he has done can be taken back by starting again. */
    logCount,
    startAgain: (routineId: string) => applyRoutine(routineId, (r) => ({
      ...r, run: (r.run ?? 0) + 1, doneStepIds: [], stepData: {}, stepChoice: {}, startedAt: undefined,
    })),
    /* Planning is the other direction from starting: starting files a routine
       under the clock that has already run, planning says where he intends it to
       go. Nothing is copied, so the row on the day IS the routine and ticking a
       step in either place is one act. */
    planRoutine: (routineId: string, slot?: TimeSlot, day?: string) => applyRoutine(routineId, (r) => ({
      ...r, planned: slot ? { day: day ?? todayKey(), slot } : undefined,
    })),
    /* Ticking the routine itself ticks everything inside it, minus any step that
       has to be earned elsewhere (the typing gate), which stays his to pass. */
    /* Finishing the routine finishes what it needs. An optional step is not
       claimed on his behalf, because ticking "wash your face" for him would be
       the app putting words in his mouth, but one he has already ticked stays. */
    setRoutineDone: (routineId: string, done: boolean) => applyRoutine(routineId, (r) => {
      markSteps(routineId, requiredSteps(r).filter((st) => !stepLocked(r, st.id)).map((st) => st.id), done)
      return stamped({
        ...r,
        doneStepIds: done
          ? [...new Set([
            ...r.doneStepIds.filter((id) => r.steps.some((st) => st.id === id && st.optional)),
            ...requiredSteps(r).filter((st) => !stepLocked(r, st.id)).map((st) => st.id),
          ])]
          : [],
        stepChoice: done ? r.stepChoice : {},
      })
    }),
  }
}
