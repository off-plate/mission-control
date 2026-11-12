import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { isMeeting, useCalendar } from '../calendar'
import { SPACE_LABELS } from '../mock'
import { type Brief } from '../assistant'
import { getWeather, weatherLine } from '../weather'
import { useAssistantBills } from '../assistantbills'
import {
    SLOTS, dueOn, habitsDueToday, goalCurrent, habitStepKey, routineComplete, requiredSteps,
    daysClean, type HabitDef, type SpaceId, type Task
} from '../types'
import { localDateKey, goalPeriodKey, goalPeriodRange, periodKeyFor, type GoalTf } from '../util'
import { useFirstMove } from '../ui'
import { dropUrl } from './shared'

export const dayLabel = () => new Date().toLocaleDateString('en-GB', { weekday: 'long' })

/** Which workspace a thing came from, in words the model can repeat back. */
/** Where a task lives, for the briefing: its project's name when it has one
 *  (Off-Plate and Michael's Corner are projects now), otherwise its workspace. */
export const labelOf = (t: { space?: SpaceId; projectId?: string }, projects: { id: string; name: string }[]) =>
  projects.find((p) => p.id === t.projectId)?.name ?? (t.space ? SPACE_LABELS[t.space] : 'Unfiled')

export function useBrief(): Brief {
  const { tasks, projects, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, plan } = useStore()
  const { state: cal } = useCalendar()
  /* Fetched once when the page opens. It is a garnish on the brief, so it never
     blocks anything and a failure just means no weather line. */
  const [sky, setSky] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void getWeather().then((w) => { if (live && w) setSky(weatherLine(w)) })
    return () => { live = false }
  }, [])
  /* Real Bills data, the same account/cycle read the Bills page itself does
     (2026-09-08 report: the assistant had nothing to say when asked whether
     a bill was paid). Also a garnish, same treatment as weather: null when
     signed out or not yet loaded, never something this briefing waits on. */
  const { brief: billsBrief } = useAssistantBills()
  /* "What am I having next" -- the exact same derivation Today and the Zone
     already point at (useFirstMove, ui.tsx), so the model's answer can
     never disagree with the one thing the app itself would put in front of
     him next. */
  const firstMove = useFirstMove()
  return useMemo(() => {
    const day = localDateKey()
    const tm = new Date(); tm.setDate(tm.getDate() + 1)
    const tomorrowKey = localDateKey(tm)
    const yd = new Date(); yd.setDate(yd.getDate() - 1)
    const yesterdayKey = localDateKey(yd)
    /* No inView. The briefing is his whole life, because he asked the whole
       life, and a filtered briefing makes the model confident about a day it
       has only seen a third of. */
    const onDay = tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
    const planned = SLOTS.map((s) => ({
      slot: s.label,
      items: onDay.filter((t) => t.slot === s.id).map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: labelOf(t, projects) })),
    }))
    const unsorted = onDay.filter((t) => !t.slot)
    if (unsorted.length) planned.unshift({ slot: 'Unsorted', items: unsorted.map((t) => ({ title: dropUrl(t.title) || t.title, done: !!t.done, min: t.estimateMin ?? 0, space: labelOf(t, projects) })) })
    const backlog = tasks.filter((t) => t.list === 'backlog' && !t.done)
    const age = (t: Task) => {
      if (!t.createdAt) return 0
      const [y, m, d] = t.createdAt.split('-').map(Number)
      return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000))
    }
    const visible = habits.filter((h) => !h.archivedAt)
    const { due, kept } = habitsDueToday(visible, routines, habitLog, todayIndex)
    /* A routine's own auto-ticking habit was landing in this list by name
       (2026-09-07 report: "Morning Preparation" and "Invoicing routine"
       showing up as habits to keep) even though habitsDueToday above already
       excludes it from the due/kept COUNT for the same reason -- it belongs
       to the routine's own streak, not a row of its own. Same exclusion,
       applied to the names too, so the count and the list agree. */
    /* srcStepId catches the much larger set routineHabitIds alone missed: a
       habit auto-materialized FROM one routine step (its typing test, its
       "clean the desk", forty-odd of them in a real routine set) rather than
       the routine's own single streak. Both are "run the routine", not "tick
       a habit", so both are excluded the same way. */
    const routineHabitIds = new Set(routines.filter((r) => !r.archivedAt && r.habitId).map((r) => r.habitId as string))
    const isRoutineLinked = (h: HabitDef) => routineHabitIds.has(h.id) || habitStepKey(h) !== null
    const open = visible.filter((h) => dueOn(h, todayIndex, habitLog) && !h.days[todayIndex] && !h.folderId && !isRoutineLinked(h)).map((h) => h.name)
    /* His report, 2026-09-08: a real, existing habit (a weekly one, not due
       on that specific day) came back "I can't find a habit called X"
       because "open" above is deliberately today-only. Break-kind (quitting)
       excluded -- those already have their own list below and their own
       action ("slip"), never "habit". */
    const allHabits = visible.filter((h) => h.kind !== 'break' && !isRoutineLinked(h)).map((h) => h.name)

    /* Routines, as their own thing the assistant can name and point him at --
       never as a "habit" to offer to tick, which was the whole complaint.
       Same due/kept/open shape as habits on purpose, so the model reads them
       the same way and briefText needs no new format. A routine with no
       required steps yet cannot be "run", so it never counts as due. */
    const activeRoutines = routines.filter((r) => !r.archivedAt && requiredSteps(r).length > 0)
    const routineOpen = activeRoutines.filter((r) => !routineComplete(r, periodKeyFor(r.cadence)))
    const routinesBrief = { due: activeRoutines.length, kept: activeRoutines.length - routineOpen.length, open: routineOpen.slice(0, 6).map((r) => r.title) }
    /* Split, not lumped. isMeeting() reads the guest list rather than the
       title, so an hour he blocked for himself stops being reported as a
       meeting he has to attend. */
    const timed = cal.status === 'ok' ? cal.events.filter((e) => e.day === day && e.start !== null) : []
    const at = (e: { start: number | null }) =>
      `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`
    const meetings = timed.filter(isMeeting).map((e) => ({ at: at(e), title: e.title }))
    const blocks = timed.filter((e) => !isMeeting(e)).map((e) => ({ at: at(e), title: e.title }))
    return {
      now: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      weekday: dayLabel(),
      planned,
      backlogCount: backlog.length,
      backlog: backlog.slice(0, 25).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      oldest: [...backlog].sort((a, b) => age(b) - age(a)).slice(0, 3).map((t) => ({ title: dropUrl(t.title), days: age(t), space: labelOf(t, projects) })).filter((t) => t.title),
      habits: { due, kept, open: open.slice(0, 6) },
      allHabits: allHabits.slice(0, 40),
      routines: routinesBrief,
      meetings,
      blocks,
      focusToday: focusSessions.filter((f) => f.day === day).reduce((a, f) => a + f.minutes, 0),
      /* NOT `plannedOn === yesterday`. The rollover has already swept these
         into the backlog and cleared plannedOn by the time this runs, so that
         filter finds an empty set every single time and the leftovers never
         reach the model. daily.tsx carries the same warning, having been caught
         by it first. plan.returnedIds is where they went. */
      tomorrow: tasks
        .filter((t) => t.list === 'today' && t.plannedOn === tomorrowKey && !t.done)
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      tomorrowMeetings: (cal.status === 'ok'
        ? cal.events.filter((e) => e.day === tomorrowKey && e.start !== null && isMeeting(e))
        : []).map((e) => ({ at: at(e), title: e.title })),
      unfinishedYesterday: (plan.returnedOn === day
        ? tasks.filter((t) => new Set(plan.returnedIds ?? []).has(t.id) && !t.done && t.list !== 'today')
        : []
      ).slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      /* By doneAt, not plannedOn: the rollover clears plannedOn off finished
         work on its way to the ledger (see roll.ts), so that field is already
         gone by the time this runs. doneAt is a real timestamp and survives.
         Titles pass through dropUrl and the blank-after-stripping filter, same
         as every other list here: a task named only a pasted link should not
         hand the model a bullet with nothing left to say. */
      completedYesterday: tasks
        .filter((t) => t.done && t.doneAt && localDateKey(new Date(t.doneAt)) === yesterdayKey)
        .slice(0, 12).map((t) => ({ title: dropUrl(t.title), space: labelOf(t, projects) })).filter((t) => t.title),
      weather: sky,
      goals: goals.filter((g) => !g.closed).slice(0, 4).map((g) => {
        const tf = (g.timeframe ?? 'quarter') as GoalTf
        const range = goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf))
        const cur = goalCurrent(g, habits, habitLog, range, slips, focusSessions)
        return { name: g.name, pct: g.target > 0 ? Math.round((cur / g.target) * 100) : 0 }
      }),
      bills: billsBrief,
      quitting: habits
        .filter((h) => h.kind === 'break' && !h.archivedAt)
        .map((h) => ({ name: h.name, days: daysClean(h, slips) ?? 0 })),
      nextTask: firstMove ? dropUrl(firstMove.title) || firstMove.title : null,
    }
  }, [tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, slips, cal, sky, plan, billsBrief, firstMove, projects])
}
