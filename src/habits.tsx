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
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
import { useEffect, useMemo, useState } from 'react'
import { SPACE_LABELS } from './exceptions'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { Sheet } from './modals'
import { HabitRun, habitHasRun } from './habitrun'
import { Band, Dropdown, Segmented, Select, SpaceMark, WriteTo, HabitsGoalsSwitch } from './ui'
import { habitsDueToday, HABIT_FREQUENCIES, SLOTS, bestCleanRun, bestStreak, currentStreak, daysClean, keptDaysIn, quitDays, quitKeptDays, slipCount, slipDays, focusMinutesOn, habitFrequencyLabel, habitTarget, countIn, countTarget, habitCountOn, habitGate, habitLocked, isCounted, COUNT_PERIODS, requiredSteps, routineProgress, type PageId, type Goal, type HabitDef, type HabitFrequency, type CountPeriod, type HabitKind, type Routine, type TimeSlot } from './types'
import { goalPeriodRange, habitPeriodRange, shiftPeriodKey, fmtDuration, fmtWhen, dayOfWeekKey, localDateKey, type GoalTf } from './util'
import { GoalSheet } from './goals'

function HabitTrail({ h, days }: { h: HabitDef; days: number }) {
  const { habitLog, slips, openDay } = useStore()
  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - (days - 1))
  const fromKey = localDateKey(from)
  const toKey = localDateKey(today)
  const kept = h.kind === 'break'
    ? quitKeptDays(h, slips, fromKey, toKey)
    : keptDaysIn(habitLog, h.id, fromKey, toKey)
  // A slip is a fact on the record, so it is drawn as one rather than left to
  // read as an ordinary blank day.
  const slipped = h.kind === 'break' ? slipDays(slips, h.id) : new Set<string>()
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(from); d.setDate(from.getDate() + i)
    return localDateKey(d)
  })
  /* The day it began, either way round. A square before it is not a day he
     missed, it is a day the habit did not exist, so it is drawn as empty space
     and left out of the count underneath. */
  const began = h.kind === 'break' ? h.quitSince : h.startedOn
  const chances = began ? cells.filter((d) => d >= began) : cells
  /* Best run used to read the same number as the current one for a quit, because
     one overwritten date could only describe the run he is in now. */
  const run = h.kind === 'break' ? (daysClean(h, slips) ?? 0) : currentStreak(habitLog, h.id)
  const best = h.kind === 'break' ? bestCleanRun(h, slips) : bestStreak(habitLog, h.id)
  return (
    <div className="habit-trail-wrap">
      <div className={`habit-trail w${days}`}>
        {/* Every square is the day it stands for, so the answer to "what happened
            on that one" is one click away rather than nowhere. */}
        {cells.map((day) => (
          <button
            key={day}
            className={`trail-day${began && day < began ? ' before-start' : ''}${kept.has(day) ? ' kept' : ''}${slipped.has(day) ? ' slipped' : ''}${day === toKey ? ' is-today' : ''}`}
            title={`${fmtWhen(day)}${slipped.has(day) ? ', slipped' : kept.has(day) ? ', kept' : ''}`}
            aria-label={`${fmtWhen(day)}${slipped.has(day) ? ', slipped' : kept.has(day) ? ', kept' : ', not kept'}`}
            onClick={() => openDay(day)}
          />
        ))}
      </div>
      <div className="habit-foot">
        <span className="habit-weeks">{chances.filter((d) => kept.has(d)).length} of {chances.length} days</span>
        {/* Only when it lands inside the squares being drawn: there it is the
            fact that explains the empty ones. */}
        {began && began > fromKey && <span className="habit-weeks">from {fmtWhen(began)}</span>}
        <span className="habit-weeks">{run} now, {best} best</span>
      </div>
    </div>
  )
}

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


function HabitRow({ h, todayIndex, days: window = 7, actions, stateTag, drivenBy, progress, partOn, goal, qualify, sealed, footLead }: {
  h: HabitDef
  todayIndex: number
  /* Why this habit cannot be ticked by hand at all, on any day. The gym habit
     is the only one: Hevy knows which workouts happened and he does not want a
     box he could tick by mistake. Correcting a day is a re-sync, because the
     correction has to come from where the truth does. */
  sealed?: string
  /* An action that belongs to the row rather than to its menu: the Hevy pull.
     It goes in the FOOT, which spans the row and wraps, and never in `actions`,
     which is a 34px column sized for a kebab and nothing else. Put there it
     burst straight out of the panel. */
  footLead?: React.ReactNode
  /** The workspace, spelled out, when another visible habit has the same name. */
  qualify?: string
  /** "done today" / "paused". It goes in the foot column where words fit; in
   *  the menu column it shoved the kebab out of the panel. */
  stateTag?: string | null
  /** How many days back to show. Seven keeps the week of dots you can click. */
  days?: number
  actions?: React.ReactNode
  /** Name of the routine that ticks this habit, when one does. */
  drivenBy?: string
  /** Today's progress through the routine that drives this habit. */
  progress?: { done: number; total: number }
  /** How far through its routine each PAST day got, 0 to 100, keyed by date.
   *  Today's number comes from the live routine; every other day comes from the
   *  dated step record, because the routine itself no longer remembers. */
  partOn?: Map<string, number>
  /** A goal counting itself off this habit, if one exists. */
  goal?: Goal
}) {
  const { toggleHabitDay, assertRoutineDay, logSlip, logCount, setPage, focusSessions, habitLog, slips, stepLog, inView } = useStore()
  const [open, setOpen] = useState(false)
  const [giveUp, setGiveUp] = useState(false)
  /* The block on the clock counts toward today, so an hour reached while the
     timer is still running shows here rather than after it stops. */
  const pomo = usePomodoro()
  const liveFocusMin = pomo.phase === 'focus' && pomo.running ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60)) : 0
  /* usePomodoro() ticks every 500ms while a block runs, and every row reads
     it (not just the one habit actually being timed) since a habit can only
     tell it's the live one once it's already rendering. That re-renders
     every row in the list twice a second regardless of kind. The two
     memos below don't stop the re-render -- they stop it from redoing a
     full scan of habitLog/focusSessions each time. Both are pure indexes
     of the data itself (which day was kept, how many minutes landed on
     each day), never of "today", so which day IS today is still read
     fresh via dayOfWeekKey()/localDateKey() at every actual lookup below --
     memoizing that part would be the real risk, the store.tsx sync effect
     was exactly this class of bug (2026-09-04). */
  const keptDaysForHabit = useMemo(
    () => new Set(habitLog.filter((t) => t.habitId === h.id).map((t) => t.day)),
    [habitLog, h.id],
  )
  const focusMinutesByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of focusSessions) {
      if (s.space !== h.space) continue
      m.set(s.day, (m.get(s.day) ?? 0) + s.minutes)
    }
    return m
  }, [focusSessions, h.space])
  const kept = h.days.filter(Boolean).length
  const target = habitTarget(h)
  /* Once a week or once a month: a row of weekdays is the wrong instrument
     entirely, and the fraction underneath it was arithmetic between two
     different units. These rows get a strip of PERIODS instead. */
  const periodic = h.frequency === 'weekly' || h.frequency === 'monthly'
  const periodTf: GoalTf = h.frequency === 'monthly' ? 'monthly' : 'weekly'
  const periodWord = h.frequency === 'monthly' ? 'months' : 'weeks'
  const PERIOD_CELLS = 5
  /* The last five of its own periods, oldest first, this one last. */
  const periodCells = periodic
    ? Array.from({ length: PERIOD_CELLS }, (_, i) => {
      const key = shiftPeriodKey(periodTf, i - (PERIOD_CELLS - 1))
      const r = goalPeriodRange(periodTf, key)
      return { key, label: r.label, kept: keptDaysIn(habitLog, h.id, r.from, r.to).size > 0, now: i === PERIOD_CELLS - 1 }
    })
    : []
  /* Twice in a day is not the same as once. The log has held both since
     meditation started being fed by two routines; without this the card said
     the same thing either way. */
  const timesToday = habitCountOn(habitLog, h.id, localDateKey())
  // Weekdays-only habits do not expect the weekend, so those dots stay quiet.
  const expected = (i: number) => (h.frequency === 'weekdays' ? i < 5 : true)
  // How many of the last 12 weeks actually hit the target. This is the number
  // the row of bars was trying to say and never did.
  const weeks = h.history ?? []
  const hitWeeks = weeks.filter((n) => n >= target).length
  const avg = weeks.length ? weeks.reduce((a, n) => a + n, 0) / weeks.length : 0
  /* One week of history compares nothing, and "1 of the last 1 weeks" is not
     a sentence. A periodic habit's own strip already carries this. */
  const trend = weeks.length < 2 || periodic
    ? null
    : target <= 1
      ? `kept ${hitWeeks} of the last ${weeks.length} weeks`
      : `averaging ${avg.toFixed(1).replace(/\.0$/, '')} of ${target} a week`

  // Part-done shows as a partial fill on today's dot, so a routine you started
  // but did not finish is visible here instead of reading as untouched.
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const partial = !!progress && progress.done > 0 && progress.done < progress.total
  /** How far through the routine that weekday got, 0 when it was not started or
   *  was finished outright. A finished day already reads as a full dot. */
  const partOf = (i: number): number => {
    if (h.days[i]) return 0
    if (i === todayIndex) return partial ? pct : 0
    return partOn?.get(dayOfWeekKey(i)) ?? 0
  }

  /* Measured: the dot is not yes/no, it is how far through the day's target you
     got. A morning that reached 40 of 60 minutes reads as most of the way there
     rather than as a failure. */
  /* Counted: a number of times inside a stretch, logged one tap each. Minutes
     only ever fitted work he sits and times; most things he wants more of are
     things he DOES, and asking him for "20 minutes of cold showers a day" was
     the wrong question dressed as a target. */
  /* Kept by the clock, not by him. It shows how far today has got and says what
     is keeping it, so a tick he cannot press never reads as a tick that failed. */
  if (h.auto?.from === 'focus') {
    const need = h.auto.minutes
    const todayMin = (focusMinutesByDay.get(localDateKey()) ?? 0) + liveFocusMin
    const kept7 = [0, 1, 2, 3, 4, 5, 6].filter((i) => keptDaysForHabit.has(dayOfWeekKey(i))).length
    return (
      <div className="habit-row is-count">
        <div className="habit-row-top">
          {/* Every row's name starts at the same indent, caret or none, so the
              foot row under it -- padded to clear a caret's width -- lines up
              with the name instead of drifting right of it. */}
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {fmtDuration(todayMin)}<span className="habit-freq">of {fmtDuration(need)} today</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        {/* One strip, and it is the week: the bar said today, the dots said the
            week and the line under them said the week again, so the row stated
            zero four times. */}
        <div className="habit-days">
          {DAY_LABELS.map((d, i) => {
            const on = keptDaysForHabit.has(dayOfWeekKey(i))
            const isToday = i === todayIndex
            return (
              <span className={`day-cell${isToday ? ' is-today' : ''}`} key={i}>
                <span
                  className={`daydot is-measure${on ? ' full' : isToday && todayMin > 0 ? ' partial' : ''}`}
                  style={isToday && !on ? ({ ['--fill' as string]: `${Math.min(100, Math.round((todayMin / need) * 100))}%` } as React.CSSProperties) : undefined}
                  aria-label={`${d}, ${on ? 'kept' : 'not kept'}`}
                />
              </span>
            )
          })}
        </div>
        <div className="habit-foot">{footLead}{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <span className="habit-weeks">{kept7} of 7 this week</span>
          <button className="habit-auto" onClick={() => setPage('focus')}>Open Focus</button>
        </div>
      </div>
    )
  }

  if (isCounted(h)) {
    const per = h.per ?? 'day'
    const range = habitPeriodRange(per)
    const target = countTarget(h)
    const have = countIn(habitLog, h.id, range.from, range.to)
    const label = COUNT_PERIODS.find((p) => p.id === per)!.label
    return (
      <div className="habit-row is-count">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {have}<span className="habit-freq">of {target} {label}</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        <div className="count-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.round((have / target) * 100))}%` }} />
        </div>
        <div className="habit-foot">{footLead}{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <span className="count-do">
            <button className="btn btn-primary count-add" onClick={() => logCount(h.id, 1)}>
              Did it
            </button>
            {have > 0 && (
              <button className="btn btn-ghost count-undo" onClick={() => logCount(h.id, -1)}>
                Take one back
              </button>
            )}
          </span>
          <span className="habit-weeks">{countIn(habitLog, h.id, dayOfWeekKey(0), dayOfWeekKey(6))} this week</span>
        </div>
      </div>
    )
  }

  if (h.kind === 'measured') {
    const target = h.dailyTargetMin ?? 60
    const todayMin = focusMinutesByDay.get(localDateKey()) ?? 0
    const weekMin = DAY_LABELS.reduce((a, _, i) => a + (focusMinutesByDay.get(dayOfWeekKey(i)) ?? 0), 0)
    return (
      <div className="habit-row is-measured">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">
            {fmtDuration(todayMin)}<span className="habit-freq">of {fmtDuration(target)} today</span>
          </span>
        </div>
        <span className="habit-actions">{actions}</span>
        <div className="habit-days">
          {DAY_LABELS.map((d, i) => {
            const mins = focusMinutesByDay.get(dayOfWeekKey(i)) ?? 0
            const pct = Math.min(100, Math.round((mins / target) * 100))
            return (
              <span className={`day-cell${i === todayIndex ? ' is-today' : ''}`} key={i}>
                <span
                  className={`daydot is-measure${pct >= 100 ? ' full' : pct > 0 ? ' partial' : ''}`}
                  style={{ ['--fill' as string]: `${pct}%` } as React.CSSProperties}
                  title={`${d}: ${fmtDuration(mins)} of ${fmtDuration(target)}`}
                  aria-label={`${d}, ${mins} of ${target} minutes`}
                />
              </span>
            )
          })}
        </div>
        <div className="habit-foot">{footLead}{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <button className="habit-auto" onClick={() => setPage('plan')}>Fills itself from your focus blocks</button>
          <span className="habit-weeks">{fmtDuration(weekMin)} this week</span>
        </div>
      </div>
    )
  }

  /* A quit is a different scoreboard: days clean, and a single honest button
     for the day you slip. Day dots would be asking the wrong question. */
  if (h.kind === 'break') {
    const clean = daysClean(h, slips) ?? 0
    // The week fills itself from the day he stopped: a day he did not do it is a
    // day kept, so he never has to tick anything to be given credit for it.
    const quitWeek = quitDays(h, slips)
    const slipsSoFar = slipCount(h, slips)
    const best = bestCleanRun(h, slips)
    return (
      <>
      {giveUp && <GiveUpMode habitName={h.name} onClose={() => setGiveUp(false)} />}
      <div className="habit-row is-quit">
        <div className="habit-row-top">
          <span className="run-caret is-blank" aria-hidden="true" />
          <SpaceMark space={h.space} />
          <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
          <span className="habit-count mono">{clean}<span className="habit-freq">{clean === 1 ? 'day' : 'days'} clean</span></span>
        </div>
        <span className="habit-actions">{actions}</span>
        {window > 7 ? <HabitTrail h={h} days={window} /> : (
          <div className="habit-days">
            {DAY_LABELS.map((d, i) => (
              <span key={i} className={`daydot is-measure${quitWeek[i] ? ' full' : ''}`} title={quitWeek[i] ? 'A day without it' : undefined}>
                <b>{d}</b>
              </span>
            ))}
          </div>
        )}
        <div className="habit-foot">{footLead}{stateTag && <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>}
          <button className="quit-slip" onClick={() => logSlip(h.id)}>I slipped today</button>
          <button className="quit-giveup" onClick={() => setGiveUp(true)}>I wanna give up</button>
          <span className="habit-weeks">
            {h.quitSince ? `since ${fmtWhen(h.quitSince)}` : ''}
            {slipsSoFar > 0 ? `, ${slipsSoFar} slip${slipsSoFar === 1 ? '' : 's'}` : ''}
            {best > clean ? `, ${best} best run` : ''}
          </span>
        </div>
      </div>
      </>
    )
  }

  /* The step's own rules, at the habit's address. A gated habit cannot be
     ticked until the day's number clears the target, and a habit with two
     answers is ticked by picking one of them, never by a checkbox that would
     have to guess which he meant. Both were true of the steps and neither
     survived the merge, which is what he caught. */
  const gate = habitGate(h)
  const locked = !!gate && habitLocked(h, stepLog, localDateKey())
  const byAnswer = !!h.alts?.length
  const hasRun = habitHasRun(h)
  const todayHeld = !!drivenBy || locked || byAnswer

  return (
    <div className={`habit-row${drivenBy ? ' is-auto' : ''}${open ? ' is-open' : ''}`}>
      <div className="habit-row-top">
        {hasRun ? (
          <button
            className="run-caret"
            aria-expanded={open}
            aria-label={open ? `Close ${h.name}` : `Open ${h.name}`}
            onClick={() => setOpen((v) => !v)}
          ><Icon.ChevronRight size={12} /></button>
        ) : <span className="run-caret is-blank" aria-hidden="true" />}
        <SpaceMark space={h.space} />
        <span className="habit-name">{h.name}{qualify && <span className="habit-qual">{qualify}</span>}</span>
        {/* The week's count belongs to the week. Showing 1/7 above a year of
            squares says two different things about the same habit. */}
        {/* A weekly habit has a target of one, and this counted DAYS in the
            week, so a weekly review ticked four times read "4/1". A period
            habit says whether the period is kept; a daily one keeps its
            fraction. */}
        {window === 7 && (
          <span className="habit-count mono">
            {/* A monthly habit is kept in a MONTH. Reading the week's cache
                let the word say "not yet" over a filled month. "kept" on its
                own read as a stray word next to the weekday legend built for
                the daily rows; that legend is gone for these now, and "done"
                pairs with the period-cell strip's own "months"/"weeks" label
                below it instead of repeating it. */}
            {periodic
              ? (periodCells[periodCells.length - 1]?.kept ? 'done' : 'not yet')
              : `${kept}/${target}`}
            {timesToday > 1 && <span className="habit-freq">{timesToday}x today</span>}
          </span>
        )}
      </div>
      <span className="habit-actions">{actions}</span>
      {window > 7 ? <HabitTrail h={h} days={window} /> : periodic ? (
        /* Five of its own periods. A once-a-month habit has no Mondays, and
           printing it under M T W T F S S said it did. */
        <div className="habit-days is-period">
          <span className="period-unit mono">{periodWord}</span>
          {periodCells.map((c) => (
            <span
              key={c.key}
              className={`periodcell${c.kept ? ' kept' : ''}${c.now ? ' is-now' : ''}`}
              title={`${c.label}${c.kept ? ', kept' : c.now ? ', not yet' : ', not kept'}`}
              aria-label={`${c.label}${c.kept ? ', kept' : c.now ? ', not yet' : ', not kept'}`}
            />
          ))}
        </div>
      ) : (
      <div className="habit-days">
        {DAY_LABELS.map((d, i) => (
          <span className={`day-cell${i === todayIndex ? ' is-today' : ''}`} key={i}>
            <button
              /* A part-done day is part-done whenever it was. Today's fraction
                 comes off the live routine, every earlier one off the dated
                 step record; a day already fully kept is never redrawn as
                 partial. */
              className={`daydot${expected(i) ? '' : ' off-day'}${drivenBy ? ' is-auto' : ''}${partOf(i) > 0 ? ' partial' : ''}${todayHeld && i === todayIndex ? ' is-locked' : ''}`}
              style={partOf(i) > 0 ? ({ ['--fill' as string]: `${partOf(i)}%` } as React.CSSProperties) : undefined}
              role="checkbox"
              aria-checked={h.days[i]}
              /* TODAY belongs to whatever earns it: the routine that owns the
                 habit, the number a gated habit has to hit, or the answer a
                 two-way habit needs picked. A day already gone is his to
                 correct, because a lost write must never become a permanent lie
                 about what he did. */
              disabled={!!sealed || i > todayIndex || (todayHeld && i === todayIndex)}
              aria-label={
                i !== todayIndex
                  ? (drivenBy ? `${h.name}, ${d}, correct this day by hand` : `${h.name}, ${d}`)
                  : drivenBy ? `${h.name}, ${d}, set by the ${drivenBy} routine`
                    : locked ? `${h.name}, ${d}, log ${gate!.target} ${gate!.unit} or better to keep it`
                      : byAnswer ? `${h.name}, ${d}, open it and pick an answer`
                        : `${h.name}, ${d}`
              }
              title={
                sealed ? sealed
                : i !== todayIndex
                  ? (drivenBy ? `Done via ${drivenBy}? Set the record straight.` : undefined)
                  : drivenBy ? `Set by the ${drivenBy} routine`
                    : locked ? `Hit ${gate!.target} ${gate!.unit} to keep this today`
                      : byAnswer ? 'Open it and pick an answer'
                        : undefined
              }
              onClick={() => { if (drivenBy) { if (i < todayIndex) assertRoutineDay(h.id, i) } else toggleHabitDay(h.id, i) }}
            >
              <Icon.Check size={11} strokeWidth={4} />
            </button>
          </span>
        ))}
      </div>
      )}
      {/* One fact and one action, on one line. State, else the steps still
          waiting, else the trend: three of them stacked into a 200px column
          and the row read as three ragged lines. The row is already named
          after its routine, so the link is an action, not a sentence.

          The goal link lives INSIDE this row. It used to be its own element
          assigned the same `foot` grid cell, and two elements in one cell
          stack: "Feeding X" was drawn straight on top of "averaging N of 7
          a week", which is the overlapping text he reported. */}
      <div className="habit-foot">
        {footLead}
        {stateTag
          ? <span className={`col-tot mono${stateTag === 'done today' ? ' val-pos' : ''}`}>{stateTag}</span>
          : progress && progress.total > 1 && progress.done > 0 && progress.done < progress.total
            ? <span className="habit-weeks">{progress.done} of {progress.total} steps</span>
            : trend ? <span className="habit-weeks">{trend}</span> : null}
        {goal && (
          <button className="habit-goal" onClick={() => setPage('goals')}>
            Feeding “{goal.name}”
          </button>
        )}
        {/* What the step carried and a habit did not. His instruction when the
            merge was agreed: "it should still consist of short description if
            it was previously... there is links for typing tests, so there
            should be link to that still. The video doesn't have to be video,
            it has to be a link to that video." */}
        {locked
          ? <span className="habit-weeks mono">{gate!.target} {gate!.unit} to pass</span>
          : h.note && <span className="habit-note" title={h.note}>{h.note}</span>}
        {h.link && (
          <a className="habit-auto" href={h.link} target="_blank" rel="noreferrer">
            {h.linkLabel ?? 'Open'} ↗
          </a>
        )}
        {h.goto && (
          <button className="habit-auto" onClick={() => setPage(h.goto as PageId)}>
            {h.gotoLabel ?? 'Open'}
          </button>
        )}
        {h.seconds ? <span className="habit-weeks mono">{Math.round(h.seconds / 60)}m</span> : null}
      </div>
      {open && hasRun && <HabitRun h={h} />}
    </div>
  )
}

/* Habits used to be grouped by the part of the day they belong to. That axis
   described nothing: ten of sixteen landed in "Anytime", which is the group
   that means no group, and it was printed first. The axis that decides what a
   row IS, and whether he can touch it, is who keeps it. Three groups, his own
   first, because those are the only ones with a live checkbox in them. */
type Keeper = 'you' | 'routine' | 'clock'
const KEEPER_GROUPS: { id: Keeper; label: string }[] = [
  { id: 'you', label: 'You keep these' },
  { id: 'routine', label: 'Your routines keep these' },
  { id: 'clock', label: 'The clock keeps these' },
]
/* Inside a group, the day still runs in order. */
const DAYPART_RANK: Record<string, number> = { morning: 0, noon: 1, afternoon: 2, evening: 3, anytime: 4 }

/* One sheet for adding and editing. A habit a routine drives keeps its name and
   frequency in step with that routine, so those fields are read-only here. */
export function HabitSheet({ onClose, habit, drivenBy }: { onClose: () => void; habit?: HabitDef; drivenBy?: string }) {
  const { addHabit, updateHabit, inView } = useStore()
  const [name, setName] = useState(habit?.name ?? '')
  // Editing keeps whatever it had, including none. Only a new habit defaults.
  const [daypart, setDaypart] = useState<TimeSlot | ''>(habit ? (habit.daypart ?? '') : 'morning')
  const [frequency, setFrequency] = useState<HabitFrequency>(habit?.frequency ?? 'daily')
  const [perWeek, setPerWeek] = useState(habit?.targetPerWeek ?? 3)
  const [kind, setKind] = useState<HabitKind>(habit?.kind ?? 'build')
  const [targetMin, setTargetMin] = useState(habit?.dailyTargetMin ?? 60)
  const [measure, setMeasure] = useState<'minutes' | 'times'>(habit?.measure ?? 'times')
  const [per, setPer] = useState<CountPeriod>(habit?.per ?? 'day')
  const [count, setCount] = useState(habit?.targetCount ?? 1)
  const [since, setSince] = useState(habit?.quitSince ?? localDateKey())
  const [startedOn, setStartedOn] = useState(habit?.startedOn ?? localDateKey())
  const locked = !!drivenBy
  const quitting = kind === 'break'
  const measured = kind === 'measured'

  const submit = () => {
    if (!name.trim()) return
    const shape = {
      name: name.trim(),
      daypart: quitting ? undefined : (daypart || undefined),
      frequency,
      targetPerWeek: frequency === 'times-per-week' ? perWeek : undefined,
      kind,
      measure: measured ? measure : undefined,
      per: measured && measure === 'times' ? per : undefined,
      targetCount: measured && measure === 'times' ? Math.max(1, count) : undefined,
      dailyTargetMin: measured && measure === 'minutes' ? Math.max(5, targetMin) : undefined,
      // Focus blocks fill minutes. A count is his to log, so it has no source.
      source: measured && measure === 'minutes' ? ('focus' as const) : undefined,
      quitSince: quitting ? (since || localDateKey()) : undefined,
      startedOn: quitting ? undefined : (startedOn || localDateKey()),
    }
    if (habit) updateHabit(habit.id, locked ? { daypart: shape.daypart } : shape)
    else addHabit(shape)
    onClose()
  }

  return (
    <Sheet
      steady
      title={habit ? 'Edit this habit' : 'Add a habit'}
      onClose={onClose}
    >
      {/* Only when it is locked, and only because the form is about to refuse
          him: the fields are disabled and nothing else on screen says why. The
          other half of this was a definition of the word "habit". */}
      {locked && (
        <p className="sheet-warn" style={{ marginTop: 0 }}>
          The {drivenBy} routine keeps this habit, so its name and frequency follow that routine. You can still move it to a different part of the day.
        </p>
      )}
      <span className="field-label">Which kind is this?</span>
      <Segmented
        label="Which kind is this?"
        value={kind}
        options={[
          { id: 'build', label: 'Keep', hint: 'Something you want to do', disabled: locked },
          { id: 'break', label: 'Quit', hint: 'Something you want to stop', disabled: locked },
          { id: 'measured', label: 'Amount', hint: 'A number to hit, in times or minutes', disabled: locked },
        ]}
        onPick={(id) => setKind(id as HabitKind)}
      />

      <label className="field-label" style={{ marginTop: 'var(--s4)' }} htmlFor="hname">
        {quitting ? 'What are you quitting?' : measured ? 'What are you measuring?' : 'What is the habit?'}
      </label>
      <input
        id="hname" className="textinput" style={{ width: '100%' }} autoFocus={!locked} disabled={locked}
        placeholder={quitting ? 'e.g. Scrolling in bed' : 'e.g. 20 minutes of movement'}
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />

      {/* A thing you are quitting has no hour of the day; it has a day you
          stopped, and a rhythm for checking in on it. */}
      {quitting ? (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hsince">Not since</label>
            <input id="hsince" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="hfreqq">Check in</label>
            <Select id="hfreqq" style={{ width: '100%' }} value={frequency} disabled={locked}
              onChange={(v) => setFrequency(v)}
              options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
          </div>
        </div>
      ) : (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hpart">When in the day?</label>
            <Select id="hpart" style={{ width: '100%' }} value={daypart} onChange={(v) => setDaypart(v)}
              options={[...SLOTS.map((s) => ({ value: s.id as TimeSlot | '', label: `${s.label}, ${s.hint}` })), { value: '' as TimeSlot | '', label: 'Anytime' }]} />
          </div>
          <div>
            {measured ? (
              <>
                <label className="field-label" htmlFor="hmeasure">Counting what?</label>
                <Select id="hmeasure" style={{ width: '100%' }} value={measure}
                  onChange={(v) => setMeasure(v)}
                  options={[
                    { value: 'times' as const, label: 'Times you do it' },
                    { value: 'minutes' as const, label: 'Minutes of focus time' },
                  ]} />
              </>
            ) : frequency === 'times-per-week' ? (
              <>
                <label className="field-label" htmlFor="hper">Days a week</label>
                <input id="hper" className="textinput" style={{ width: '100%' }} type="number" min={1} max={7} value={perWeek}
                  onChange={(e) => setPerWeek(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} />
              </>
            ) : (
              <>
                <label className="field-label" htmlFor="hfreq">How often?</label>
                <Select id="hfreq" style={{ width: '100%' }} value={frequency} disabled={locked}
                  onChange={(v) => setFrequency(v)}
                  options={HABIT_FREQUENCIES.map((f) => ({ value: f.id, label: f.label }))} />
              </>
            )}
          </div>
        </div>
      )}

      {/* The target itself, once he has said what he is counting. */}
      {measured && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          {measure === 'times' ? (
            <>
              <div>
                <label className="field-label" htmlFor="hcount">How many times?</label>
                <input id="hcount" className="textinput" style={{ width: '100%' }} type="number" min={1} max={99} value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className="field-label" htmlFor="hcper">In what stretch?</label>
                <Select id="hcper" style={{ width: '100%' }} value={per}
                  onChange={(v) => setPer(v)}
                  options={COUNT_PERIODS.map((o) => ({ value: o.id, label: o.label }))} />
              </div>
            </>
          ) : (
            <div>
              <label className="field-label" htmlFor="htarget">Minutes a day</label>
              <input id="htarget" className="textinput" style={{ width: '100%' }} type="number" min={5} max={600} step={5} value={targetMin}
                onChange={(e) => setTargetMin(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
            </div>
          )}
        </div>
      )}

      {/* A Keep or an Amount gets the same date a Quit gets. Without it, one
          added today reads as ninety days of nothing, and a habit he has in
          fact been keeping since spring starts its count on the wrong day. */}
      {!quitting && (
        <div className="sheet-grid" style={{ marginTop: 'var(--s4)' }}>
          <div>
            <label className="field-label" htmlFor="hstart">Started on</label>
            <input id="hstart" className="textinput" style={{ width: '100%' }} type="date" max={localDateKey()}
              value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </div>
        </div>
      )}

      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>{habit ? 'Save changes' : 'Add habit'}</button>
      </div>
    </Sheet>
  )
}

/** How far back the habit page is looking. A week is the default because that is
 *  the rhythm; the longer windows are for the sixty and hundred day questions. */
const HABIT_WINDOWS = [
  { id: 7, label: 'A week' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
  { id: 365, label: 'A year' },
]

export function HabitsPage() {
  const { habits, goals, space, deleteHabit, togglePauseHabit, routines, stepTicks, habitLog, todayIndex, inView, focusRoutineId, setFocusRoutineId, toggleHabitDay, slips, logSlip, focusSessions } = useStore()
  const [days, setDays] = useState(7)
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
  /* Folders, not raw rows: the same function Today's headline uses. This page
     used to count every habit and open with "1/64" while Today said "1/14"
     about the same morning. */
  const { due: dueCount, kept: doneToday } = habitsDueToday(spaceHabits, routines, habitLog, todayIndex)

  /* Grouped by who keeps it, and inside a group what is still open comes
     first, because a habit already ticked is a record and not a thing
     still to do. */
  const keeperOf = (h: HabitDef): Keeper =>
    (h.auto?.from === 'focus' || h.kind === 'measured') ? 'clock' : drivenBy.has(h.id) ? 'routine' : 'you'
  const rank = (h: HabitDef) =>
    (h.paused ? 2 : h.days[todayIndex] ? 1 : 0) * 10 + (DAYPART_RANK[h.daypart ?? 'anytime'] ?? 4)
  /* The workspace is said on every row now, not only when two names collide.
     One list holds all four, so "Focus for 30 minutes" is three rows and the
     label is the only thing that places them; and a row he cannot place is a
     row he cannot trust. */
  const qualifyOf = (h: HabitDef) => SPACE_LABELS[h.space]
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
  const [histWin, setHistWin] = useState<'week' | 'month' | 'year'>('month')
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
  const allShut = folderGroups.length > 0 && folderGroups.every((g) => !shutFolders.has(g.id))
  const toggleAllFolders = () => setShutFolders(allShut ? new Set(folderGroups.map((g) => g.id)) : new Set())
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
    .filter((h) => isHevyHabit(h) || h.auto?.from === 'focus' || h.kind === 'measured')
    .sort((a, b) => Number(isHevyHabit(b)) - Number(isHevyHabit(a)))
  const manualRows = looseBuild.filter((h) => !autoRows.includes(h))
  const folderIsDone = (c: { list: HabitDef[] }) => { const d = folderDone(c.list); return d.total > 0 && d.done === d.total }

  /* Kept days this week over what the habit asks for. One measure for every
     automatic row, so the gym and the focus blocks read the same way. */
  const weekFrom = dayOfWeekKey(0)
  const weekTo = dayOfWeekKey(6)
  const keptThisWeek = (h: HabitDef) => keptDaysIn(habitLog, h.id, weekFrom, weekTo).size

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
          <span className="rtc-id">
            <span className="rtc-name">{c.label}</span>
            <span className="rtc-when microcap">{habitFrequencyLabel({ frequency: freq } as HabitDef)}</span>
          </span>

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
                  h={h} todayIndex={todayIndex} days={days} qualify={qualifyOf(h)}
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
        title="Habits & Goals"
        beside={<HabitsGoalsSwitch on="habits" />}
        leading={folderGroups.length > 0 && (
          <button className="btn btn-ghost band-collapseall" onClick={toggleAllFolders}>
            {allShut ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        metrics={[{ v: `${doneToday}/${dueCount}`, k: 'done today', tone: (doneToday > 0 ? 'pos' : 'info') as 'pos' | 'info' }]}
        actions={
          <>
            <Select
              className="rangepick" value={days} ariaLabel="How far back to look"
              onChange={(v) => setDays(v)}
              options={HABIT_WINDOWS.map((w) => ({ value: w.id, label: w.label }))}
            />
            <WriteTo />
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a habit</button>
          </>
        }
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
          {routineCols.length > 0 && (
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
                <span className="hg-n">{routineCols.filter(folderIsDone).length} of {routineCols.length} done today</span>
              </div>
              <div className="rtc-list">{routineCols.filter((c) => !folderIsDone(c)).map(routineCard)}</div>
              {routineCols.some(folderIsDone) && (
                <>
                  <div className="microcap hg-sub">Done today</div>
                  <div className="rtc-list">{routineCols.filter(folderIsDone).map(routineCard)}</div>
                </>
              )}
            </div>
          )}

          {manualRows.length > 0 && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Yours to tick</span>
                <span className="hg-n mono">{manualRows.filter((h) => h.days[todayIndex]).length}/{manualRows.length}</span>
              </div>
              <div className="hg-rows">
                {[...manualRows].sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex])).map((h) => (
                  <div className={`hg-row${h.days[todayIndex] ? ' is-done' : ''}`} key={h.id}>
                    <span className="hg-what">
                      <span className="hg-title">{h.name}{qualifyOf(h) && <span className="habit-qual">{qualifyOf(h)}</span>}</span>
                      {h.note && <span className="hg-note">{h.note}</span>}
                    </span>
                    <span className="hg-do">
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
        </div>

        <div className="hg-col">
          <div className="panel hg-panel">
            <div className="hg-head"><span className="microcap">Today</span></div>
            <div className="hg-tally">
              <span className="hg-fig"><b className="mono">{routineCols.filter(folderIsDone).length}/{routineCols.length}</b><i className="microcap">routines run</i></span>
              <span className="hg-fig"><b className="mono">{manualRows.filter((h) => h.days[todayIndex]).length}/{manualRows.length}</b><i className="microcap">manual ticks</i></span>
              <span className="hg-fig"><b className="mono">{looseQuit.filter((h) => !slipDays(slips, h.id).has(localDateKey())).length}/{looseQuit.length}</b><i className="microcap">quits clean</i></span>
            </div>
          </div>

          {(autoRows.length > 0 || firedRows.length > 0) && (
            <div className="panel hg-panel">
              <div className="hg-head">
                <span className="microcap">Kept without you</span>
                <span className="hg-n">no tick, on purpose</span>
              </div>
              <div className="hg-rows">
                {autoRows.map((h) => (
                  <div className="hg-row" key={h.id}>
                    <span className="hg-what">
                      <span className="hg-title">{h.name}{qualifyOf(h) && <span className="habit-qual">{qualifyOf(h)}</span>}</span>
                      <span className="hg-note">{isHevyHabit(h) ? 'Hevy' : 'from your focus blocks'}</span>
                    </span>
                    <span className="hg-do">
                      {(() => {
                        /* A minute target lives in two places: auto.minutes on a
                           habit the focus blocks keep, dailyTargetMin on one he
                           measures himself. Either way the honest reading is
                           minutes TODAY; "1 / 7" for a habit whose target is an
                           hour a day was measuring the wrong thing entirely. */
                        const mins = h.auto?.from === 'focus' ? h.auto.minutes : h.dailyTargetMin
                        return mins
                          ? meter(focusMinutesOn(focusSessions, localDateKey(), h.space), mins, 'm')
                          : meter(keptThisWeek(h), Math.max(1, habitTarget(h)), '', 'this week')
                      })()}
                      {isHevyHabit(h) && <HevySync />}
                      {kebab(h)}
                    </span>
                  </div>
                ))}
              </div>
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
