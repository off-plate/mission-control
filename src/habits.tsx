/* THE HABITS PAGE (tab: "Habits & Goals"). Split out of pages1.tsx
   (2026-09-09). Exports HabitSheet (add/edit sheet), imported by
   quitting.tsx for the same sheet on a quit -- a quit is a HabitDef with
   kind:'break', not a separate concept, so it shares this rather than
   duplicating it. Imports GoalSheet from goals.tsx, for "set a goal on this
   habit" -- the one cross-import this split needed in this direction, kept
   one-way on purpose (goals.tsx never imports from here) so the two files
   can't form a cycle. */
import * as Icon from './icons'
import { GiveUpMode } from './giveupmode'
import { RoutineRunner } from './runner'
import { HevySync, isHevyHabit } from './hevysync'
import { cardioDays, isCardioHabit } from './cardio'
import { getHevyStairDays } from './hevy'
import { useHealth } from './health'
import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Band, Dropdown, HabitsGoalsSwitch } from './ui'
import { keptDaysIn, slipDays, focusNeedMin, habitFrequencyLabel, requiredSteps, routineProgress, type HabitDef, type HabitFrequency, type Routine } from './types'
import { localDateKey } from './util'
import { GoalSheet } from './goals'
import { HabitRow } from './habits/row'
import { HabitSheet } from './habits/sheet'
export { HabitSheet } from './habits/sheet'

/* Habits and Goals are one page with two faces.

   His idea, 2026-08-26: "make habits and goals one page, with pill shaped
   things that I can change between the goals and the habits, but they would
   live under one page in Mission Control." He is right that they belong
   together: a goal here is mostly a reflection over a habit ("14 night
   routines this month"), and having to leave the page to see whether the
   habit is feeding it made the two read as unrelated systems.

   Implemented as one switcher in both bands rather than one page swallowing
   the other, because each page keeps its own band metrics, its own add button
   and its own state. The menu shows one tab; the address of each half still
   resolves, so bookmarks and every existing setPage('goals') keep working. */
/* ---- a routine's own record, at the grain its cadence deserves ----

   The window is shared across the panel; the GRAIN follows the routine. A
   monthly routine drawn in days is thirteen empty cells and one full one for a
   perfect score, which reads as near-total failure. Drawn in months it reads
   as what it is. So Year means fifty-two weeks for a daily routine and twelve
   months for a monthly one: different lengths, same meaning.

   Everything here reads the folder's own habit, which the store already ticks
   when the last step of a routine is kept. */
type HistWin = 'week' | 'month' | 'year'
const GRAIN: Record<HistWin, Record<'day' | 'week' | 'month', { n: number; unit: string }>> = {
  week: { day: { n: 7, unit: 'days' }, week: { n: 1, unit: 'week' }, month: { n: 1, unit: 'month' } },
  month: { day: { n: 30, unit: 'days' }, week: { n: 4, unit: 'weeks' }, month: { n: 1, unit: 'month' } },
  year: { day: { n: 52, unit: 'weeks' }, week: { n: 52, unit: 'weeks' }, month: { n: 12, unit: 'months' } },
}
/** Which unit a routine is counted in, from the cadence of the habits in it. */
function grainOf(freq: HabitFrequency | undefined, win: HistWin): { step: 'day' | 'week' | 'month'; n: number; unit: string } {
  const base: 'day' | 'week' | 'month' = freq === 'monthly' ? 'month' : freq === 'weekly' ? 'week' : 'day'
  /* A daily routine over a year is counted in weeks, or it is 365 numbers
     nobody reads and a bar that means the same either way. */
  const step: 'day' | 'week' | 'month' = base === 'day' && win === 'year' ? 'week' : base
  const g = GRAIN[win][base]
  return { step, n: g.n, unit: g.unit }
}
const startOfDay = (back: number, step: 'day' | 'week' | 'month'): Date => {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (step === 'day') d.setDate(d.getDate() - back)
  else if (step === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - back * 7) }
  else { d.setDate(1); d.setMonth(d.getMonth() - back) }
  return d
}
/** Kept and due across the window. Weekends never count against a Mon-to-Fri
 *  routine, or a perfect week reads as five out of seven. */
function routineRecord(kept: Set<string>, freq: HabitFrequency | undefined, win: HistWin): { hit: number; due: number; unit: string } {
  const { step, n, unit } = grainOf(freq, win)
  let hit = 0, due = 0
  for (let i = 0; i < n; i++) {
    const from = startOfDay(i, step)
    const to = new Date(from)
    if (step === 'day') { /* one day */ }
    else if (step === 'week') to.setDate(to.getDate() + 6)
    else { to.setMonth(to.getMonth() + 1); to.setDate(0) }
    if (step === 'day' && freq === 'weekdays' && (from.getDay() === 0 || from.getDay() === 6)) continue
    due++
    const a = localDateKey(from), b = localDateKey(to)
    for (const k of kept) { if (k >= a && k <= b) { hit++; break } }
  }
  return { hit, due, unit }
}

/* Habits used to be grouped by the part of the day they belong to. That axis
   described nothing: ten of sixteen landed in "Anytime", which is the group
   that means no group, and it was printed first. The axis that decides what a
   row IS, and whether he can touch it, is who keeps it. Three groups, his own
   first, because those are the only ones with a live checkbox in them. */
type Keeper = 'you' | 'routine' | 'clock'
/* Inside a group, the day still runs in order. */
const DAYPART_RANK: Record<string, number> = { morning: 0, noon: 1, afternoon: 2, evening: 3, anytime: 4 }

export function HabitsPage() {
  const { habits, goals, space, deleteHabit, togglePauseHabit, routines, stepTicks, habitLog, markHabitDaysOn, todayIndex, inView, focusRoutineId, setFocusRoutineId, toggleHabitDay, slips, logSlip, focusSessions } = useStore()
  const days = 7
  const [adding, setAdding] = useState(false)
  // Opening the goal sheet from a habit is the "set a goal on this" path.
  const [goalFor, setGoalFor] = useState<string | null>(null)
  const [editHabit, setEditHabit] = useState<HabitDef | null>(null)
  const [giveUp, setGiveUp] = useState<HabitDef | null>(null)
  const goalOn = new Map(goals.filter((g) => g.habitId).map((g) => [g.habitId as string, g]))
/* Habits, Goals and Quitting ignore the workspace switcher, on his instruction
   2026-08-26: "all of them should have all of the habits, goals and quitting.
   No separation. It's not needed." A habit is a thing he does with his own
   body and hours; which company it was filed under was a distinction the rest
   of the app needs and these three pages never did. The workspace is still
   STORED on every one of them and still said on the row, so nothing is lost
   and nothing has to be moved. */
  const spaceHabits = habits.filter((h) => !h.archivedAt)
  // A habit a routine drives cannot be deleted from here, or the routine would
  // mirror into nothing. Pausing stays available.
  /* Ownership needs something to own: a routine with no steps cannot be
     finished, so until steps exist its habit stays hand-tickable instead of
     sitting locked behind a checklist that is not written yet. */
  const drivenBy = new Map(routines.filter((r) => r.habitId && !r.archivedAt && r.steps.length > 0).map((r) => [r.habitId as string, r.title]))
  // Today's step progress for each routine-driven habit.
  const progressFor = new Map(routines.filter((r) => r.habitId && !r.archivedAt).map((r) => [
    r.habitId as string, routineProgress(r),
  ]))
  /* And every earlier day's, off the dated step record. The routine only ever
     remembers today, so a Monday he got two steps into used to read on Tuesday
     exactly like a Monday he never opened. Capped at 99 because a day that
     reached every step is a day that was KEPT, and that is a full dot. */
  const partFor = new Map<string, Map<string, number>>()
  for (const r of routines) {
    if (!r.habitId || r.archivedAt) continue
    const total = requiredSteps(r).length
    if (!total) continue
    const byDay = new Map<string, Set<string>>()
    for (const t of stepTicks) {
      if (t.routineId !== r.id) continue
      const seen = byDay.get(t.day) ?? new Set<string>()
      seen.add(t.stepId)
      byDay.set(t.day, seen)
    }
    const pcts = partFor.get(r.habitId) ?? new Map<string, number>()
    for (const [day, ids] of byDay) {
      const pc = Math.min(99, Math.round((ids.size / total) * 100))
      /* Two routines can feed one habit. The one that got furthest that day is
         the honest answer, not whichever happened to be read last. */
      if (pc > (pcts.get(day) ?? 0)) pcts.set(day, pc)
    }
    partFor.set(r.habitId, pcts)
  }
  /* What the page opens with used to be kept-this-week over the sum of every
     habit's weekly target: 49 of 90, a number mixing dailies, weekdays and
     monthlies across four workspaces that he could not reconstruct from
     anything on screen. What he wants on a Sunday morning is what is still
     open TODAY. */

  /* Grouped by who keeps it, and inside a group what is still open comes
     first, because a habit already ticked is a record and not a thing
     still to do. */
  const keeperOf = (h: HabitDef): Keeper =>
    (h.auto?.from === 'focus' || h.kind === 'measured') ? 'clock' : drivenBy.has(h.id) ? 'routine' : 'you'
  const rank = (h: HabitDef) =>
    (h.paused ? 2 : h.days[todayIndex] ? 1 : 0) * 10 + (DAYPART_RANK[h.daypart ?? 'anytime'] ?? 4)
  /* Folders first, then whatever is loose. His model: a routine IS a folder of
     habits, and "if a habit doesn't have a folder it is basically just the
     habit". Inside a folder the sequence he wrote is the order, because a
     morning routine is a running order, not a ranked list; loose habits keep
     the old open-first ranking, which is what a flat list wants. */
  const folderGroups = routines
    .filter((r) => !r.archivedAt)
    .map((r) => ({
      id: r.id,
      label: r.title,
      folder: r,
      list: spaceHabits
        .filter((h) => h.folderId === r.id)
        .sort((a, b) => (a.folderOrder ?? 0) - (b.folderOrder ?? 0)),
    }))
    .filter((g) => g.list.length > 0)
    /* The day ends with Night work, then Before bed. Everything else keeps the
       order it was made in (the sort is stable). */
    .sort((a, b) => Number(a.id === 'r-nightwork') + 2 * Number(a.id === 'r-evening') - Number(b.id === 'r-nightwork') - 2 * Number(b.id === 'r-evening'))
  /* The habit a routine already kept ("did I finish Morning Preparation
     today") is the FOLDER's own streak, not a habit sitting beside it. Left in
     the loose list every routine appeared twice, once as its folder and once
     as a row of the same name. It keeps its history and its id, it just is not
     a second row. */
  const folderHabitIds = new Set(routines.map((r) => r.habitId).filter(Boolean) as string[])
  const looseList = spaceHabits
    .filter((h) => !h.folderId && !folderHabitIds.has(h.id))
    .sort((a, b) => rank(a) - rank(b))
  /* A thing you are quitting reads nothing like a thing you are building --
     no target, no streak, a slip button instead of a week of dots. Mixed
     into one list they broke its rhythm; split, each list is one shape. */
  const looseBuild = looseList.filter((h) => h.kind !== 'break')
  const looseQuit = looseList.filter((h) => h.kind === 'break')
  /* Routines on the left, loose habits on the right, and neither side moves
     when the other changes height. A single CSS multi-column flow balanced
     both by total height, so opening one routine could shift every section
     after it into the other column -- "Monthly review" jumping sides just
     from opening "Morning Preparation" above it. Two real, independent
     columns fix that: each one is its own block flow, so a routine's open
     state can only ever move things within its own column. */
  const routineCols: { id: string; label: string; folder?: Routine; list: HabitDef[] }[] = folderGroups
  const looseCols: { id: string; label: string; folder?: Routine; list: HabitDef[] }[] = [
    ...(looseBuild.length ? [{ id: 'loose', label: 'On their own', list: looseBuild }] : []),
    ...(looseQuit.length ? [{ id: 'quitting', label: 'Quitting', list: looseQuit }] : []),
  ]
  /* How far through a folder today is. Optional habits never hold it open, so
     a folder of five with one optional reads 4/4 when the four that matter are
     done, not 4/5 forever. */
  const folderDone = (list: HabitDef[]) => {
    const need = list.filter((h) => !h.optional)
    return { done: need.filter((h) => h.days[todayIndex]).length, total: need.length }
  }
  /* Which routine is being RUN, as opposed to read. Only ever one: he told me
     he would never run two at once, and a second surface would be a second
     answer to "where am I". */
  const [running, setRunning] = useState<string | null>(null)
  /* One window for the whole panel, never one per card: two rows disagreeing
     about what "this month" means is how a page quietly stops being trusted.
     Not remembered between visits, for the same reason the cards are always
     shut when he arrives: a setting he did not choose today should not be
     shaping what he reads today. */
  const [histWin, setHistWin] = useState<'week' | 'month' | 'year'>('week')
  /* Which routine cards are open, for this visit only.
     His instruction, 2026-08-26: "either everything closed or everything
     opened, I would prefer it closed." It used to be remembered, so the page
     came back however he had left it days ago: three open, five shut, for a
     reason he could not reconstruct and did not choose. Every visit now starts
     with all of them shut, which is a rule he can hold in his head. Opening one
     is a thing he does now, not a setting he has to maintain. */
  const [shutFolders, setShutFolders] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    /* The remembered state is gone; take its leftovers with it rather than
       stranding a key on every device that ever loaded the old build. */
    try { localStorage.removeItem('mc:open-routines'); localStorage.removeItem('mc:shut-folders') } catch { /* private mode */ }
  }, [])
  const toggleFolder = (id: string) => setShutFolders((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  /* One click to shut every routine and see only the ones he reopens by hand,
     for a workspace with enough of them that scrolling past open ones to find
     the one he wants is the actual problem. Any open -> shut them all first;
     only once they are all already shut does the same control open them. */
  /* Today's routine strip hands a routine over here the same way it hands a
     task to Plan: open its folder if he had shut it, scroll to it, flash it,
     then forget it -- clicking "Before work routine" on Today should not
     just land on this page, it should land ON that folder. */
  const [flashFolderId, setFlashFolderId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusRoutineId) return
    setShutFolders((prev) => { const next = new Set(prev); next.delete(focusRoutineId); return next })
    setFlashFolderId(focusRoutineId)
    setFocusRoutineId(null)
    const el = document.querySelector(`[data-routine-id="${focusRoutineId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = window.setTimeout(() => setFlashFolderId(null), 2600)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRoutineId])

  /* ---------- the page he approved, built ----------
     Proposal C, "Run and watch". Left column is everything that needs his
     hands: the routines he opens and runs, then the handful he ticks. Right
     column is everything the app keeps for him, and the only thing clickable
     over there is the Hevy pull. The split is the point: it answers "what do I
     owe" and "what is already true" without mixing them into one list of fifty
     rows that all look the same.

     Four groups, derived from what is already stored rather than from a new
     field: a habit a routine's completion feeds, a habit the app measures, a
     habit he is quitting, and everything else. */
  const firedRows = routines
    .filter((r) => r.habitId && !r.archivedAt && r.steps.length > 0)
    .map((r) => ({ r, h: spaceHabits.find((x) => x.id === r.habitId) }))
    .filter((x): x is { r: Routine; h: HabitDef } => !!x.h)
  /* The gym leads: it is the one with a button, and a control belongs at the
     top of the list it acts on rather than under three rows that have none. */
  const autoRows = looseBuild
    .filter((h) => isHevyHabit(h) || isCardioHabit(h) || h.auto?.from === 'focus' || h.kind === 'measured')
    .sort((a, b) => Number(isHevyHabit(b)) - Number(isHevyHabit(a)))
  const manualRows = looseBuild.filter((h) => !autoRows.includes(h))
  /* Bike / Run / Stairs keeps itself: bike and run days from Intervals, stair
     days from the last Hevy sync. Only ever turns days on, and only the ones
     not already kept, so this settles after one pass. */
  const { state: health } = useHealth()
  useEffect(() => {
    if (health.status !== 'ok') return
    const days = cardioDays(health.sessions, getHevyStairDays())
    for (const h of spaceHabits.filter(isCardioHabit)) {
      const kept = new Set(habitLog.filter((t) => t.habitId === h.id).map((t) => t.day))
      const missing = days.filter((d) => !kept.has(d))
      if (missing.length) markHabitDaysOn(h.id, missing, true)
    }
  }, [health, habitLog, spaceHabits, markHabitDaysOn])
  /* A repeatable daily routine (Out Brain Rot) is run when the need comes up,
     not on a schedule, so it carries no cadence label and sits with the ones
     that have no set day. */
  const onDemand = (c: { folder?: Routine }) => !!c.folder?.repeatable && c.folder.cadence === 'daily'
  const schedCols = routineCols.filter((c) => !onDemand(c) && ['daily', 'weekdays'].includes(c.list[0]?.frequency ?? ''))
  const rareCols = routineCols.filter((c) => !onDemand(c) && !['daily', 'weekdays'].includes(c.list[0]?.frequency ?? ''))
  const demandCols = routineCols.filter(onDemand)
  const folderIsDone = (c: { list: HabitDef[] }) => { const d = folderDone(c.list); return d.total > 0 && d.done === d.total }

  /* Kept days this week over what the habit asks for. One measure for every
     automatic row, so the gym and the focus blocks read the same way. */
  /* The Week/Month/Year switch above the routines governs the habit panels
     too: one window for everything on the page. */
  const recOf = (h: HabitDef) => routineRecord(keptDaysIn(habitLog, h.id, '0000-01-01', '9999-12-31'), h.frequency, histWin)
  const tally = (h: HabitDef) => {
    const r = recOf(h)
    return r.due > 0 ? <span className="hg-read"><span className="hg-read-n mono">{r.hit}/{r.due} {r.unit}</span></span> : null
  }

  const kebab = (h: HabitDef) => (
    <Dropdown label={`Options for ${h.name}`} className="habit-kebab">
      <button role="menuitem" onClick={() => setEditHabit(h)}>Edit this habit</button>
      <button role="menuitem" onClick={() => togglePauseHabit(h.id)}>{h.paused ? 'Resume it' : 'Pause it'}</button>
      {goalOn.has(h.id)
        ? <span className="kebab-note">Goal: {goalOn.get(h.id)!.name}</span>
        : <button role="menuitem" onClick={() => setGoalFor(h.id)}>Set a goal on this</button>}
      <span className="kebab-sep" />
      {drivenBy.has(h.id)
        ? <span className="kebab-note">Deleted with the routine</span>
        : <button role="menuitem" className="danger" onClick={() => deleteHabit(h.id)}>Delete this habit</button>}
    </Dropdown>
  )

  /* A routine is a card you open and run. Finished ones sink, because he will
     not run one twice in a day and a done routine in the way is one he has to
     read past. */
  const routineCard = (c: { id: string; label: string; folder?: Routine; list: HabitDef[] }) => {
    const { done, total } = folderDone(c.list)
    const finished = folderIsDone(c)
    const isRunning = running === c.id
    const open = shutFolders.has(c.id)
    const freq = c.list[0]?.frequency
    const period = freq === 'monthly' ? 'this month' : freq === 'weekly' ? 'this week' : 'today'
    /* The folder's own habit is the record of having finished it, and the store
       already writes it. Without one there is no history to draw, so the bar
       stays out rather than drawing a convincing empty one. */
    const ownId = c.folder?.habitId
    const rec = ownId ? routineRecord(new Set(habitLog.filter((t) => t.habitId === ownId).map((t) => t.day)), freq, histWin) : null
    return (
      <div className={`rtc${finished ? ' done' : ''}${isRunning ? ' is-running' : ''}${open ? ' is-open' : ''}`} key={c.id}>
        <div className="rtc-top">
          <button
            className="rtc-open"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the steps of ${c.label}`}
            onClick={() => toggleFolder(c.id)}
          ><Icon.ChevronRight size={12} className="folder-caret" /></button>
          <button
            className="rtc-id rtc-title" aria-expanded={open} tabIndex={-1}
            onClick={() => toggleFolder(c.id)}
          >
            <span className="rtc-name">{c.label}</span>
            {!onDemand(c) && <span className="rtc-when microcap">{habitFrequencyLabel({ frequency: freq } as HabitDef)}</span>}
          </button>

          {/* The six hundred pixels that were doing nothing. The bar is the
              record of a window that has already happened; TODAY is the ring
              beside it, deliberately not part of the bar. Folding today in
              would let a day he has not started tick the bar forward, and an
              unfinished day would read at a glance as a finished one. */}
          {rec && rec.due > 0 && (
            <span className="rtc-run">
              <span className="rtc-meter"><i style={{ width: `${Math.round((rec.hit / rec.due) * 100)}%` }} /></span>
              <span
                className={`rtc-today${finished ? ' is-on' : done > 0 ? ' is-part' : ''}`}
                title={finished ? `finished ${period}` : done > 0 ? 'started, not finished' : `not yet ${period}`}
                aria-label={finished ? `finished ${period}` : done > 0 ? 'started, not finished' : `not yet ${period}`}
              />
              <span className="rtc-tally"><b className="mono">{rec.hit}/{rec.due}</b> {rec.unit}</span>
            </span>
          )}

          {finished
            ? <span className="microcap rtc-donetag">done {period}</span>
            : <span className="rtc-count mono">{done} of {total}</span>}
          <button
            className={`btn btn-sm rtc-start${finished ? ' btn-quiet' : ' btn-primary'}`}
            onClick={() => setRunning(isRunning ? null : c.id)}
            aria-pressed={isRunning}
          >{isRunning ? 'Running' : finished ? 'Run again' : 'Start'}</button>
        </div>
        {open && (
          <div className="rtc-steps habit-list w7">
            {c.list.map((h) => (
              <div className={`habit-line is-${h.kind ?? 'build'}${h.paused ? ' is-paused' : ''}`} key={h.id}>
                <HabitRow
                  h={h} todayIndex={todayIndex} days={days}
                  drivenBy={drivenBy.get(h.id)} progress={progressFor.get(h.id)}
                  partOn={partFor.get(h.id)} goal={goalOn.get(h.id)}
                  stateTag={h.paused ? 'paused' : h.days[todayIndex] ? 'done today' : null}
                  actions={kebab(h)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const meter = (now: number, target: number, unit = '', suffix = '') => {
    const met = target > 0 && now >= target
    return (
      <span className={`hg-read${met ? ' is-met' : ''}`}>
        <span className="hg-read-n mono">{now}{unit} / {target}{unit}{suffix ? ` ${suffix}` : ''}</span>
        <span className="hg-meter"><i style={{ width: `${target > 0 ? Math.min(100, Math.round((now / target) * 100)) : 0}%` }} /></span>
      </span>
    )
  }

  return (
    <div className="page">
      <Band
        title="Habits"
        beside={<HabitsGoalsSwitch />}
        /* One Add for the whole page (his ask, 2026-09-28): the range, the
           count, expand-all and the per-section buttons are gone. Goal and
           Quitting open their own sections' sheets. */
        actions={<>
          {/* Today's three figures live beside Add, where the page's state is
              read at a glance (his ask, 2026-09-30), not in a panel of their own. */}
          <div className="hg-tally hg-tally-band">
            <span className="hg-fig"><b className="mono">{schedCols.filter(folderIsDone).length}/{schedCols.length}</b><i className="microcap">routines run</i></span>
            <span className="hg-fig"><b className="mono">{manualRows.filter((h) => h.days[todayIndex]).length}/{manualRows.length}</b><i className="microcap">manual ticks</i></span>
            <span className="hg-fig"><b className="mono">{looseQuit.filter((h) => !slipDays(slips, h.id).has(localDateKey())).length}/{looseQuit.length}</b><i className="microcap">quits clean</i></span>
          </div>
          <Dropdown label="Add" trigger={({ onClick, open }) => (
            <button className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={onClick}>Add</button>
          )}>
            <button role="menuitem" onClick={() => setAdding(true)}>Habit</button>
            <button role="menuitem" onClick={() => window.dispatchEvent(new CustomEvent('hg:add', { detail: 'goals' }))}>Goal</button>
            <button role="menuitem" onClick={() => window.dispatchEvent(new CustomEvent('hg:add', { detail: 'quitting' }))}>Quitting</button>
          </Dropdown>
        </>}
      />

      {/* One panel per group, hairline separated rows inside it, the same shape
          the rest of the app uses for a list. Sixteen identical bordered cards
          in a grid left two thirds of every card empty, stranded the last card
          of each group in a row of its own, and gave nothing on the page a rank.
          The weekday letters are printed once at the top of the list instead of
          once per row, which is where 112 of them came from. */}
      {(() => {
        if (!running) return null
        const col = routineCols.find((c) => c.id === running)
        if (!col?.folder || col.list.length === 0) return null
        return (
          <RoutineRunner
            folder={col.folder}
            list={col.list}
            todayIndex={todayIndex}
            onClose={() => setRunning(null)}
          />
        )
      })()}
      <div className="hg-two">
        <div className="hg-col">
          {schedCols.length > 0 && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Routines</span>
                <span className="hist-win" role="group" aria-label="How far back the bars look">
                  {(['week', 'month', 'year'] as const).map((w) => (
                    <button
                      key={w} className={`hist-btn${histWin === w ? ' is-on' : ''}`}
                      aria-pressed={histWin === w} onClick={() => setHistWin(w)}
                    >{w}</button>
                  ))}
                </span>
                <span className="hg-n">{schedCols.filter(folderIsDone).length} of {schedCols.length} done today</span>
              </div>
              {(() => {
                const groups = [
                  { key: 'daily', label: 'Daily', cols: schedCols },
                ].filter((g) => g.cols.length > 0)
                return groups.map((g) => (
                  <div key={g.key} className="rtc-group">
                    {groups.length > 1 && <div className="microcap hg-sub">{g.label}</div>}
                    <div className="rtc-list">{g.cols.filter((c) => !folderIsDone(c)).map(routineCard)}</div>
                    {g.cols.some(folderIsDone) && (
                      <>
                        <div className="microcap hg-sub">Done</div>
                        <div className="rtc-list">{g.cols.filter(folderIsDone).map(routineCard)}</div>
                      </>
                    )}
                  </div>
                ))
              })()}
            </div>
          )}
        </div>

        <div className="hg-col">
          {manualRows.length > 0 && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Manual Habits</span>
                <span className="hg-n mono">{manualRows.filter((h) => h.days[todayIndex]).length}/{manualRows.length}</span>
              </div>
              <div className="hg-rows">
                {[...manualRows].sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex])).map((h) => (
                  <div className={`hg-row${h.days[todayIndex] ? ' is-done' : ''}`} key={h.id}>
                    <span className="hg-what">
                      <span className="hg-title">{h.name}</span>
                      {h.note && <span className="hg-note">{h.note}</span>}
                    </span>
                    <span className="hg-do">
                      {tally(h)}
                      {kebab(h)}
                      <button
                        className="daydot" role="checkbox" aria-checked={h.days[todayIndex]} aria-label={h.name}
                        onClick={() => toggleHabitDay(h.id, todayIndex)}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(autoRows.length > 0 || firedRows.length > 0) && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Automatic Habits</span>
              </div>
              <div className="hg-rows">
                {autoRows.map((h) => (
                  <div className="hg-row" key={h.id}>
                    <span className="hg-what">
                      <span className="hg-title">{h.name}</span>
                      <span className="hg-note">{isHevyHabit(h) ? 'Hevy' : isCardioHabit(h) ? 'Bike and run from Intervals, stairs from Hevy' : 'from your focus blocks'}</span>
                    </span>
                    <span className="hg-do">
                      {(() => {
                        /* A minute target lives in two places: auto.minutes on a
                           habit the focus blocks keep, dailyTargetMin on one he
                           measures himself. Either way the honest reading is
                           minutes TODAY; "1 / 7" for a habit whose target is an
                           hour a day was measuring the wrong thing entirely. */
                        const mins = h.auto?.from === 'focus' ? focusNeedMin(h) : h.dailyTargetMin
                        return mins
                          ? meter(focusSessions.filter((s) => s.day === localDateKey()).reduce((a, s) => a + s.minutes, 0), mins, 'm')
                          : (() => { const r = recOf(h); return meter(r.hit, Math.max(1, r.due), '', r.unit) })()
                      })()}
                      {isHevyHabit(h) && <HevySync />}
                      {kebab(h)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rareCols.length > 0 && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Once in a while</span>
              </div>
              <div className="rtc-list">{rareCols.filter((c) => !folderIsDone(c)).map(routineCard)}</div>
              {rareCols.some(folderIsDone) && (
                <>
                  <div className="microcap hg-sub">Done</div>
                  <div className="rtc-list">{rareCols.filter(folderIsDone).map(routineCard)}</div>
                </>
              )}
            </div>
          )}

          {demandCols.length > 0 && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">No set day</span>
              </div>
              <div className="rtc-list">{demandCols.map(routineCard)}</div>
            </div>
          )}
        </div>
      </div>
      {routineCols.length === 0 && looseCols.length === 0 && <div className="empty">No habits in this space yet. Add one from the button above.</div>}

      {adding && <HabitSheet onClose={() => setAdding(false)} />}
      {editHabit && <HabitSheet habit={editHabit} drivenBy={drivenBy.get(editHabit.id)} onClose={() => setEditHabit(null)} />}
      {goalFor && <GoalSheet presetHabitId={goalFor} thenGoToGoals onClose={() => setGoalFor(null)} />}
      {giveUp && <GiveUpMode habitName={giveUp.name} onClose={() => setGiveUp(null)} />}
    </div>
  )

  /* One render for either side of the split: a routine's folder card and a
     loose list's plain header differ only in what c.folder holds. Declared a
     function (not const), so its hoisting lets the JSX above call it before
     this point in the file reads as its definition. */
  /* renderCol is gone with the old page. It rendered a folder panel with a
     week of dots on every row, which the routine card and its disclosure
     replaced; leaving it behind would have been a second, unreachable idea
     of what a habit list looks like. */
}

/* ---------------- GOALS ---------------- */


/* One sheet for creating and editing. `goal` edits an existing one; `presetHabitId`
   opens it prefilled from a habit, which is how "set a goal on this habit" works. */
