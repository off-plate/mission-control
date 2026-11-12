import * as Icon from '../icons'
import { GiveUpMode } from '../giveupmode'
import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { usePomodoro } from '../pomodoro'
import { HabitRun, habitHasRun } from '../habitrun'
import { bestCleanRun, bestStreak, currentStreak, daysClean, keptDaysIn, quitDays, quitKeptDays, slipCount, slipDays, focusNeedMin, habitTarget, countIn, countTarget, habitCountOn, habitGate, habitLocked, isCounted, COUNT_PERIODS, type PageId, type Goal, type HabitDef } from '../types'
import { goalPeriodRange, habitPeriodRange, shiftPeriodKey, fmtDuration, fmtWhen, dayOfWeekKey, localDateKey, type GoalTf } from '../util'

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function HabitTrail({ h, days }: { h: HabitDef; days: number }) {
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

export function HabitRow({ h, todayIndex, days: window = 7, actions, stateTag, drivenBy, progress, partOn, goal, sealed, footLead }: {
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
  const { toggleHabitDay, assertRoutineDay, logSlip, logCount, setPage, focusSessions, habitLog, slips, stepLog } = useStore()
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
      m.set(s.day, (m.get(s.day) ?? 0) + s.minutes)
    }
    return m
  }, [focusSessions])
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
    const need = focusNeedMin(h)
    const todayMin = (focusMinutesByDay.get(localDateKey()) ?? 0) + liveFocusMin
    const kept7 = [0, 1, 2, 3, 4, 5, 6].filter((i) => keptDaysForHabit.has(dayOfWeekKey(i))).length
    return (
      <div className="habit-row is-count">
        <div className="habit-row-top">
          {/* Every row's name starts at the same indent, caret or none, so the
              foot row under it -- padded to clear a caret's width -- lines up
              with the name instead of drifting right of it. */}
          <span className="run-caret is-blank" aria-hidden="true" />
          <span className="habit-name">{h.name}</span>
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
          <span className="habit-name">{h.name}</span>
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
          <span className="habit-name">{h.name}</span>
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
          <span className="habit-name">{h.name}</span>
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
        <span className="habit-name">{h.name}</span>
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
