/* The one adapter between the real store and the phone prototypes (Nothing
   now, Lime and Night later: all three read the same `MC` shape as their
   prototype data.js did). toMC is pure: it only reads what it is handed.
   Nothing here invents a number. Data the app does not have yet comes out
   empty, and the prototype shows its own empty state for it. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { usePomodoro } from '../pomodoro'
import { useCalendar, refreshCalendar, type CalState } from '../calendar'
import { useHealth, dayOf, type HealthState } from '../health'
import { useCompass, type CompassState } from '../compass'
import { getWeather, type Weather } from '../weather'
import { describe, useSyncStatus, type SyncStatus } from '../sync'
import { deviceName } from '../sync-merge'
import { exceptionsFor, globalExceptions } from '../exceptions'
import { momentumRun, chainOf, stateFor, daysBetween } from '../momentum'
import { inAllSpaces, WINDOW } from '../timeline'
import { WALL } from '../board'
import { SHEET_STATUSES, STEPS, label as stepLabel, nextStep, replyOdds } from '../prospectcalc'
import { nextPersonSlot } from '../peoplelayout'
import { breakdownTask, hasAiKey } from '../ai'
import { useAssistantThread, type Turn } from '../assistantcore'
import { MORNING, SKILLS } from '../assistant'
import * as dict from '../dictation'
import { getAllHevyDayStats, getHevyExerciseHistory, getHevyLastSync, hasHevyKey, syncHevy, TARGET_HABIT_NAME } from '../hevy'
import { FORGE_SEED, buildGymDays, currentFor, pctFor } from '../gymcalc'
import { SKINS, setSkin, type SkinId } from '../skins'
import { SPACE_LABELS } from '../mock'
import {
  SLOTS, bestCleanRun, bestStreak, countTarget, currentStreak, daysClean, dueOn, focusMinutesOn, focusNeedMin, goalCurrent,
  habitGate, habitTarget, isTimeFed, slipCount, slipDays, spaceFolderId,
  type ContactChannel, type PageId, type PersonTier, type SpaceId, type TaskCategory, type TouchStep, type ViewId,
} from '../types'
import { goalPace, goalPeriodKey, goalPeriodRange, isEstimated, localDateKey, taskMinutes, type GoalTf } from '../util'

type Store = ReturnType<typeof useStore>
type Pomo = ReturnType<typeof usePomodoro>

export interface ShellInput {
  s: Store
  pomo: { focusMin: number; breakMin: number; cyclesDone: number }
  cal: CalState
  health: HealthState
  compass: CompassState
  weather: Weather | null
  sync: SyncStatus
  skin: SkinId
  /** Today's date key: the derivation is redone when the day turns. */
  day: string
  /** Bumped when a Hevy sync finishes: its numbers live in localStorage, so a counter is what makes the shell read them again. */
  gymReads?: number
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const DAYL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDateKey(d) }
const wIdx = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7
const shortDay = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return `${d.getDate()} ${MONL[d.getMonth()].slice(0, 3)}` }
const agoOf = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (m < 60) return 'now'
  const h = Math.round(m / 60); if (h < 24) return `${h}h`
  const d = Math.round(h / 24); return d < 7 ? `${d}d` : `${Math.round(d / 7)}w`
}
const isoWeekNo = (d: Date) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((+t - +new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7)
}
const skyIcon = (code: number) => (code <= 2 ? 'sun' : code === 3 || code <= 48 ? 'cloud' : 'rain')

export function toMC(inp: ShellInput) {
  const { s, cal, health, compass, weather, sync } = inp
  const today = inp.day
  const TI = wIdx(today)
  const yday = addDays(today, -1)
  /* All three spaces' alerts, so the shell picks the page's own and a page swipe never rebuilds this. */
  const ex = { tasks: s.tasks, routines: s.routines, goals: s.goals }
  const excP = exceptionsFor('personal', ex)
  const excW = [...globalExceptions({ tasks: s.tasks, routines: s.routines }), ...exceptionsFor('work', ex)]
  const exc = [...excP, ...exceptionsFor('work', ex)]
  const mapExc = (x: (typeof exc)[number]) => ({
    id: x.id, text: x.text, action: x.actionLabel ?? (x.action === 'do-today' ? 'Do it today' : 'Open'), kind: x.action, taskId: x.taskId, task: x.task,
    tone: x.id.startsWith('x-money') || x.id === 'x-datovka' ? 'alert' : 'warn',
  })

  /* ---- tasks ---- */
  const alertTitles = new Set(exc.map((x) => x.task?.title).filter(Boolean) as string[])
  const alertIds = new Set(exc.map((x) => x.taskId).filter(Boolean) as string[])
  const doneOn = (t: { doneAt?: string }) => (t.doneAt ? localDateKey(new Date(t.doneAt)) : null)
  const tasks = s.tasks
    .filter((t) => !t.done || doneOn(t) === today)
    .map((t) => {
      const doneToday = t.done && doneOn(t) === today
      const list = doneToday ? 'today' : t.list
      const day = list !== 'today' ? null : doneToday ? 0 : Math.max(0, daysBetween(today, t.plannedOn ?? today))
      const age = t.addedAt ? Math.floor((Date.now() - t.addedAt) / 86400000) : t.createdAt ? Math.max(0, daysBetween(t.createdAt, today)) : 0
      return {
        id: t.id, title: t.title, space: t.space, projectId: t.projectId ?? null, list, day, slot: t.slot ?? null,
        category: t.category, est: isEstimated(t) ? taskMinutes(t) : 0, done: t.done, actualMin: t.actualMin ?? null,
        ageDays: Math.max(0, age), carried: t.carried, at: t.at, alert: alertTitles.has(t.title) || alertIds.has(t.id),
        first: s.plan.firstMoveId === t.id,
        subtasks: t.subtasks?.length ? t.subtasks.map((x) => ({ id: x.id, title: x.title, est: x.estimateMin, done: x.done, actualMin: x.actualMin ?? null })) : null,
      }
    })

  const projects = s.projects.map((p) => ({ id: p.id, name: p.name, space: p.space, open: s.tasks.filter((t) => !t.done && t.projectId === p.id).length }))

  /* ---- habits, routines ---- */
  const live = s.habits.filter((h) => !h.archivedAt)
  const ownOf = new Map(s.routines.filter((r) => r.habitId && !r.archivedAt).map((r) => [r.habitId as string, r]))
  const stepsOf = (rid: string) => live.filter((h) => h.folderId === rid).sort((a, b) => (a.folderOrder ?? 0) - (b.folderOrder ?? 0))
  const logToday = s.habitLog.filter((t) => t.day === today)
  const weekFrom = addDays(today, -TI)
  const habits = live.filter((h) => !h.folderId && h.kind !== 'break').map((h) => {
    const r = ownOf.get(h.id)
    const base = {
      id: h.id, name: h.name, space: h.space, routine: r?.id, daypart: h.daypart, frequency: h.frequency,
      streak: currentStreak(s.habitLog, h.id), best: bestStreak(s.habitLog, h.id), due: dueOn(h, TI, s.habitLog),
      week: h.days.map((d, i) => (i > TI ? null : d ? 1 : 0)),
    }
    if (r) {
      const need = stepsOf(r.id).filter((x) => !x.optional)
      return { ...base, kind: 'build', doneToday: !!h.days[TI] || (need.length > 0 && need.every((x) => x.days[TI])) }
    }
    if (h.measure === 'amount') {
      const v = logToday.filter((t) => t.habitId === h.id).reduce((a, t) => a + (t.v ?? 0), 0)
      return { ...base, kind: 'measured', measure: 'amount', unit: h.unit, target: h.targetAmount ?? 1, today: v, presets: h.presets?.length ? h.presets : [1], doneToday: v >= (h.targetAmount ?? 1) }
    }
    if (h.kind === 'measured' && h.measure === 'times') {
      const per = h.per ?? 'day'
      const from = per === 'week' ? weekFrom : per === 'month' ? `${today.slice(0, 8)}01` : today
      const n = s.habitLog.filter((t) => t.habitId === h.id && t.day >= from && t.day <= today).length
      return { ...base, kind: 'measured', measure: 'times', per, target: countTarget(h), today: n, current: n, presets: [1], doneToday: n >= countTarget(h) }
    }
    if (h.kind === 'measured' || h.auto) {
      const m = focusMinutesOn(s.focusSessions, today, h.space)
      return { ...base, kind: 'measured', measure: 'minutes', auto: 'focus', target: focusNeedMin(h), today: m, doneToday: m >= focusNeedMin(h) }
    }
    return { ...base, kind: 'build', doneToday: !!h.days[TI] }
  })
  const keptSet = new Set(s.habitLog.map((t) => `${t.habitId}|${t.day}`))
  const gridFrom = addDays(weekFrom, -77)
  const habitGrid = (id: string) => Array.from({ length: 84 }, (_, i) => {
    const d = addDays(gridFrom, i)
    return d > today ? null : keptSet.has(`${id}|${d}`) ? 1 : 0
  })

  const routines = s.routines.filter((r) => !r.archivedAt).map((r) => {
    const steps = stepsOf(r.id).map((h) => {
      const gate = habitGate(h)
      return {
        id: h.id, title: h.name, kind: h.seconds ? 'timer' : 'do', seconds: h.seconds, note: h.note, example: h.example,
        optional: !!h.optional, link: h.link ? (h.linkLabel || 'Open the link') : undefined, href: h.link,
        alts: h.alts?.length ? h.alts.map((a) => ({ id: a.id, title: a.title, note: a.note ?? '' })) : undefined,
        gate: gate ? `${gate.target} ${gate.unit} to pass` : undefined, gateTarget: gate?.target, done: !!h.days[TI],
        alt: ((k) => (k >= 0 ? k : undefined))(h.alts?.length ? h.alts.findIndex((a) => logToday.some((t) => t.habitId === h.id && t.src === `alt:${a.id}`)) : -1),
      }
    })
    const own = r.habitId ? live.find((h) => h.id === r.habitId) : undefined
    return { id: r.id, title: r.title, space: r.space, cadence: r.cadence, daypart: own?.daypart ?? stepsOf(r.id)[0]?.daypart, repeatable: !!r.repeatable, habitId: r.habitId, steps }
  }).filter((r) => r.steps.length > 0)

  /* ---- goals, quitting ---- */
  const goals = s.goals.filter((g) => {
    if (g.closed) return false
    const tf = (g.timeframe ?? 'quarter') as GoalTf
    return !g.periodKey || g.periodKey === goalPeriodKey(tf)
  }).map((g) => {
    const tf = (g.timeframe ?? 'quarter') as GoalTf
    const cur = goalCurrent(g, s.habits, s.habitLog, goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf)), s.slips, s.focusSessions)
    const fed = g.habitId ? s.habits.find((h) => h.id === g.habitId) : undefined
    const behind = goalPace(cur, g.target, tf, new Date(), !!fed && !isTimeFed(fed)) === 'behind'
    return {
      id: g.id, name: g.name, space: g.space, category: g.category, timeframe: tf, current: Math.round(cur * 10) / 10, target: g.target, unit: g.unit,
      status: g.target > 0 && cur >= g.target ? 'reached' : behind ? 'push' : 'on', habitLinked: !!g.habitId, habitName: fed?.name, entries: (g.entries ?? []).slice(-3).map((e) => ({ id: e.id, v: e.v })),
      milestones: g.milestones?.length ? g.milestones.map((m) => ({ id: m.id, title: m.label, done: m.done })) : undefined,
    }
  })
  const quitting = live.filter((h) => h.kind === 'break').map((h) => {
    const since = h.quitSince ?? today
    const slipsOf = [...slipDays(s.slips, h.id)]
    return {
      id: h.id, name: h.name, since, daysClean: daysClean(h, s.slips) ?? 0, best: bestCleanRun(h, s.slips), slips: slipCount(h, s.slips),
      today: slipsOf.includes(today) ? 'slip' : null, sinceAgo: Math.max(0, daysBetween(since, today)), slipAgo: slipsOf.map((d) => daysBetween(d, today)),
    }
  })

  /* ---- notes ---- */
  const folders = [
    ...(['personal', 'work'] as SpaceId[]).map((sp) => ({ id: spaceFolderId(sp), name: SPACE_LABELS[sp], space: sp })),
    ...s.noteFolders.map((f) => ({ id: f.id, name: f.name, space: f.space })),
  ].map((f) => ({ ...f, count: s.notes.filter((n) => n.folderId === f.id && !n.done).length }))
  const notes = [...s.notes].sort((a, b) => b.updatedAt - a.updatedAt).map((n) => {
    const d = new Date(n.updatedAt)
    return {
      id: n.id, folder: n.folderId, space: n.space, title: n.title, body: n.body, snippet: n.body, pinned: !!n.pinned, done: !!n.done,
      ago: agoOf(n.updatedAt), whenLabel: `${d.getDate()} ${MONL[d.getMonth()]} ${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    }
  })
  const dumpFolder = (sp: SpaceId) => s.noteFolders.find((f) => f.space === sp && /brain dump/i.test(f.name))?.id ?? spaceFolderId(sp)

  /* ---- people, prospects ---- */
  const people = s.people.map((p) => {
    const mine = s.personContacts.filter((c) => c.personId === p.id).sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt)
    const last = mine[0]?.day ?? localDateKey(new Date(p.createdAt))
    return {
      id: p.id, name: p.name, rel: p.rel || '', tier: p.tier, cadenceDays: p.cadenceDays, lastDays: Math.max(0, daysBetween(last, today)),
      log: mine.slice(0, 12).map((c) => ({ channel: c.channel, day: c.day === today ? 'Today' : shortDay(c.day) })),
    }
  })
  const prospects = s.prospects.map((p) => {
    const ns = nextStep(p)
    return {
      id: p.id, name: p.name, domain: p.domain ?? '', stage: p.stage, value: p.value ?? 0, source: p.source,
      next: ns === 'callOrVisit' ? 'Call or visit' : ns ? `Next: ${stepLabel(STEPS, ns)}` : p.stage,
      odds: replyOdds(p), touches: p.touches.map((t) => ({ step: stepLabel(STEPS, t.step), day: shortDay(t.day) })),
    }
  })

  /* ---- money: Compass, only when it actually loaded ---- */
  const bills = compass.status === 'ok' ? (() => {
    const m = compass.money, dnow = new Date().getDate()
    return {
      debtPaidPct: m.pct, openDebts: m.openDebts, monthly: m.monthly, owed: m.owed, baseline: m.baseline,
      items: m.due.map((d) => ({ name: 'Debt payment', amount: d.amount, day: d.day, state: d.sent ? 'paid' : d.day < dnow ? 'overdue' : 'due' })),
    }
  })() : null

  /* ---- focus, pomodoro, momentum ---- */
  const fToday = s.focusSessions.filter((f) => f.day === today)
  const focusToday = {
    minutes: fToday.reduce((a, f) => a + f.minutes, 0),
    sessions: [...fToday].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).map((f) => ({ label: f.label || 'Focus block', min: f.minutes, at: f.at ? `${pad(new Date(f.at).getHours())}:${pad(new Date(f.at).getMinutes())}` : '' })),
  }
  const focusWeek = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6)
    return { d: DAYS[wIdx(d)], h: s.focusSessions.filter((f) => f.day === d).reduce((a, f) => a + f.minutes, 0) / 60 }
  })
  const af = s.activeFocus
  const pomo = {
    phase: !af ? 'idle' : af.pausedLeft != null ? 'paused' : af.phase,
    endsAt: af?.endsAt ?? 0, left: af?.pausedLeft ?? 0,
    total: af ? (af.phase === 'break' ? inp.pomo.breakMin : af.blockMin) * 60 : inp.pomo.focusMin * 60,
    label: af?.focusLabel ?? 'Focus block', taskId: af?.taskId ?? null,
    cycles: inp.pomo.cyclesDone, focusMin: inp.pomo.focusMin, breakMin: inp.pomo.breakMin,
  }
  const trained = new Set(health.status === 'ok' ? health.sessions.map(dayOf).filter(Boolean) : [])
  const run = momentumRun({ habits: s.habits, habitLog: s.habitLog, tasks: s.tasks, focusSessions: s.focusSessions, inView: inAllSpaces, workoutDays: trained, outreach: s.prospects.flatMap((p) => p.touches) }, WINDOW)
  const chain = chainOf(run)
  const mNow = run.length ? Math.round(run[run.length - 1].momentum) : 0
  const momentum = {
    value: mNow, state: stateFor(mNow), chain: chain.current, longest: chain.longest,
    last7: run.slice(-7).map((d) => (d.kept ? 1 : 0)),
    promise: chain.todayPending ? `Keep today and the chain reaches ${chain.current + 1}.` : `Today is kept. The chain is at ${chain.current}.`,
  }
  const ledgerToday = s.ledger.filter((l) => l.when === today && l.actualMin != null)

  /* ---- calendar, weather, health ---- */
  const calendar = cal.status === 'ok' ? cal.events.map((e) => ({
    day: e.day, title: e.title, where: e.where ?? '', allDay: e.allDay || e.start == null,
    start: e.start == null ? '00:00' : hhmm(e.start), end: e.start == null ? '23:59' : hhmm(e.end ?? e.start + 60),
  })) : []
  const wx = weather ? {
    now: Math.round(weather.nowC), feels: Math.round(weather.feelsC), high: Math.round(weather.highC), low: Math.round(weather.lowC),
    rain: Math.round(weather.rainPct), sky: weather.sky,
    hourly: weather.hours.slice(0, 8).map((h) => ({ at: h.at.slice(0, 2), t: Math.round(h.tempC), icon: skyIcon(h.code) })),
  } : null
  const healthMC = health.status === 'ok' ? (() => {
    const by = new Map(health.days.map((d) => [d.day, d]))
    const back = (n: number) => Array.from({ length: n }, (_, i) => addDays(today, i - n + 1))
    const sleep7 = back(7).map((d) => (by.get(d)?.sleep_secs ?? 0) / 3600)
    const latest = (k: 'steps' | 'resting_hr' | 'weight') => [...health.days].sort((a, b) => b.day.localeCompare(a.day)).find((d) => d[k] != null)?.[k] ?? null
    const slept = sleep7.filter((v) => v > 0)
    const weekS = health.sessions.filter((x) => dayOf(x) >= weekFrom).length
    return {
      sleep7, sleepDays: back(7).map((d) => DAYS[wIdx(d)]), sleepAvg: slept.length ? slept.reduce((a, v) => a + v, 0) / slept.length : 0,
      steps: by.get(today)?.steps ?? 0, stepsYesterday: by.get(yday)?.steps ?? 0, restingHR: latest('resting_hr'), weight: latest('weight'),
      rings: { move: Math.min(1, (by.get(today)?.steps ?? 0) / 10000), train: Math.min(1, weekS / 4), sleep: Math.min(1, (sleep7[6] || 0) / 8) },
      lastRead: health.lastRun ? health.lastRun.ran_at.slice(11, 16) : null,
    }
  })() : null
  /* The Gym, read with the same functions the classic Gym page uses (gymcalc.ts), so a target here and there is the same number. */
  const gymHabit = live.find((h) => h.name.trim().toLowerCase() === TARGET_HABIT_NAME)
  const hevyAt = getHevyLastSync(), hevyHistory = getHevyExerciseHistory(), hevyStats = getAllHevyDayStats(), hevyDays = Object.keys(hevyStats).length
  const gymDays = buildGymDays(hevyHistory, hevyStats)
  const gym = {
    week: gymHabit ? gymHabit.days.filter(Boolean).length : Object.keys(hevyStats).filter((d) => d >= weekFrom).length,
    target: gymHabit ? habitTarget(gymHabit) : 0,
    hasKey: hasHevyKey(), synced: hevyAt != null, sessionsOnRecord: hevyDays,
    lastSync: hevyAt ? `Synced from Hevy ${new Date(hevyAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not synced from Hevy on this device',
    workouts: gymDays.map((d) => ({
      name: d.exercises.length === 1 ? d.exercises[0].name : `${d.exercises.length || 'No'} exercises`, day: d.day, dow: DAYS[wIdx(d.day)].slice(0, 3),
      min: hevyStats[d.day]?.minutes ?? 0, volumeKg: Math.round(d.volumeKg), prs: d.prCount, exercises: d.exercises.map((e) => ({ name: e.name, weight: e.weight, reps: e.reps, e1rm: Math.round(e.e1rm), isPR: e.isPR })),
    })),
    targets: s.gymGoals.map((g) => {
      const cur = currentFor(g, hevyHistory, hevyDays)
      return { id: g.id, name: g.name, metric: g.metric, exerciseName: g.exerciseName ?? '', current: cur, goal: g.goal, unit: g.unit, lowerIsBetter: !!g.lowerIsBetter, pct: pctFor(g, cur), manual: g.current ?? null, note: g.note ?? '' }
    }),
    exercises: Object.entries(hevyHistory).map(([name, rows]) => ({ name, best: Math.round(Math.max(0, ...rows.map((r) => r.e1rm))), last: rows[rows.length - 1]?.day ?? '' })).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name)),
  }

  /* ---- the day field: busy quarters from the calendar, focus from blocks ---- */
  const busyQ = new Set<number>(), focusQ = new Set<number>()
  for (const e of calendar) if (e.day === today && !e.allDay) { const a = +e.start.slice(0, 2) * 60 + +e.start.slice(3), b = +e.end.slice(0, 2) * 60 + +e.end.slice(3); for (let q = Math.floor(a / 15); q < Math.ceil(b / 15); q++) busyQ.add(q) }
  for (const f of fToday) { if (!f.at) continue; const end = new Date(f.at), em = end.getHours() * 60 + end.getMinutes(); for (let q = Math.floor((em - f.minutes) / 15); q < Math.ceil(em / 15); q++) if (q >= 0) focusQ.add(q) }
  const dayDots = () => Array.from({ length: 96 }, (_, q) => (focusQ.has(q) ? 'focus' : busyQ.has(q) ? 'busy' : 'free'))

  /* ---- yesterday, for the review (the same questions daily.tsx asks) ---- */
  const keptY = new Set(s.habitLog.filter((t) => t.day === yday).map((t) => t.habitId))
  const half = s.routines.filter((r) => !r.archivedAt && (r.cadence === 'daily' || r.cadence === 'prework') && !(r.habitId && keptY.has(r.habitId))
    && !s.routineLog.some((x) => x.routineId === r.id && x.day === yday)).map((r) => {
    const mine = live.filter((h) => h.folderId === r.id && !h.optional && !h.paused)
    return { r, total: mine.length, done: mine.filter((h) => keptY.has(h.id)).length }
  }).filter((x) => x.total && x.done < x.total)
  const forgotHabits = live.filter((h) => !h.folderId && !ownOf.has(h.id) && h.kind !== 'break' && !h.auto && h.kind !== 'measured' && h.measure !== 'amount' && !keptY.has(h.id) && dueOn(h, wIdx(yday), s.habitLog))
  const dueY = live.filter((h) => !h.folderId && h.kind !== 'break' && dueOn(h, wIdx(yday), s.habitLog))
  const ydate = new Date(`${yday}T12:00:00`)
  const dailyReview = {
    day: yday, yesterday: `${DAYL[wIdx(yday)]} ${ydate.getDate()} ${MONL[ydate.getMonth()]}`,
    habitsPct: dueY.length ? Math.round(dueY.filter((h) => keptY.has(h.id)).length / dueY.length * 100) : 0,
    habits: `${dueY.filter((h) => keptY.has(h.id)).length}/${dueY.length}`,
    finished: s.tasks.filter((t) => t.done && t.doneAt && localDateKey(new Date(t.doneAt)) === yday).length,
    focusedMin: s.focusSessions.filter((f) => f.day === yday).reduce((a, f) => a + f.minutes, 0),
    routines: s.routineLog.filter((r) => r.day === yday).length,
    forgot: [
      ...half.map((x) => ({ id: x.r.habitId ?? x.r.id, routine: true, name: `${x.r.title} (${x.done}/${x.total})` })),
      ...forgotHabits.map((h) => ({ id: h.id, routine: false, name: h.name })),
    ],
    notDone: s.plan.returnedOn === today ? s.tasks.filter((t) => (s.plan.returnedIds ?? []).includes(t.id) && !t.done && t.list !== 'today').map((t) => ({ id: t.id, title: t.title })) : [],
    goals: goals.filter((g) => g.target > 0 || g.milestones).slice(0, 12).map((g) => ({ id: g.id, name: g.name })),
  }
  const everLogged = s.habitLog.length + s.routineLog.length + s.focusSessions.length > 0

  const fromElsewhere = Boolean(s.syncOrigin) && (sync.phase === 'synced' || sync.phase === 'off')
  return {
    today, todayIndex: TI, isoWeek: isoWeekNo(new Date(`${today}T12:00:00`)),
    writeSpace: s.space, projects, tasks, backlogTotal: tasks.filter((t) => t.list === 'backlog' && !t.done).length,
    categories: { call: '#B5714F', admin: '#6C82A6', deep: '#8A6A4E', quick: '#5E9A96' },
    slots: SLOTS.map((sl) => ({ id: sl.id, label: sl.label, hours: sl.hint, capMin: (sl.to - sl.from) * 60 })),
    habits, habitGrid, routines, goals, quitting,
    notes: { items: notes, folders, defaultFolder: { personal: dumpFolder('personal'), work: dumpFolder('work') }, aiActions: [] as string[] },
    people, prospectStages: [...SHEET_STATUSES] as string[], prospects,
    bills, ideas: s.ideaBoard.map((c) => ({ id: c.id, title: c.title, body: c.body ?? '', color: c.color, kind: 'Idea', done: !!c.doneAt, createdAt: c.createdAt, updatedAt: c.updatedAt })),
    prompts: [...s.prompts].sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ id: p.id, text: p.text, project: p.project, kind: p.kind, age: agoOf(p.createdAt), sent: !!p.sentAt, createdAt: p.createdAt, updatedAt: p.updatedAt })),
    focusToday, focusWeek, pomo, momentum,
    timeSaved: { weekMin: s.savedMin, todaySavedMin: ledgerToday.reduce((a, l) => a + (l.estimateMin - (l.actualMin ?? l.estimateMin)), 0) },
    exceptions: { all: exc.map(mapExc), personal: excP.map(mapExc), work: excW.map(mapExc) },
    calendar, calStatus: cal.status, calRange: { from: today, to: addDays(today, 30) }, calNote: cal.status === 'ok' ? '' : cal.status === 'loading' ? 'Reading the calendar.' : 'The calendar is not connected on this device.', weather: wx, health: healthMC, gym, dayDots,
    why: WALL.filter((c) => c.kind !== 'image'),
    dailyReview, dailyDone: !(everLogged && s.dailyDone !== today && s.dailySkipped !== today),
    returned: s.plan.returnedOn === today ? (s.plan.returnedIds ?? []) : [],
    sync: { state: sync.phase === 'saving' || sync.phase === 'waiting' ? 'saving' : sync.phase === 'error' || sync.phase === 'offline' ? 'error' : 'connected', label: fromElsewhere && s.syncOrigin ? `Updated from ${s.syncOrigin.name}` : describe(sync) },
    theme: inp.skin === 'nothing-dark' ? 'dark' : 'light', skin: inp.skin, skins: SKINS.map((k) => ({ id: k.id, label: k.label })),
    device: deviceName(), keys: { ai: hasAiKey(), hevy: hasHevyKey() }, build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev',
    apps: [] as string[],
  }
}
export type MC = ReturnType<typeof toMC>

/* What a shell is handed to act with. Every write is an existing store or
   pomodoro function, read through a ref so a call always reaches the current
   one (the store's functions close over the state of the render that made them). */
/* The real assistant, as the shell sees it. Not part of `mc`: a streaming reply
   changes many times a second and must not rebuild the whole shell. */
export interface AssistantState { turns: Turn[]; busy: boolean; err: string | null; errHint: string | null; live: string }
export interface ShellAssistant {
  send: (text: string, shown?: string) => Promise<string>
  state: () => AssistantState
  subscribe: (cb: () => void) => () => void
  undo: (turn: number, done: number) => void
  skills: { label: string; ask: string }[]
  /** The same dictation the Notes page uses. */
  mic: { available: () => boolean; toggle: (base: string, on: (t: string) => void) => void; state: () => string; subscribe: (cb: () => void) => () => void }
}
/* The conversation outlives the shell: leaving for a classic page (Settings,
   to add a key) unmounts it, and coming back must not forget what was said. */
let keptTurns: Turn[] = []

export interface ShellApi {
  assistant: ShellAssistant
  store: () => Store
  pomo: () => Pomo
  setSkin: (id: SkinId) => void
  setView: (v: ViewId) => void
  /** Leave the shell for a classic page (Jarvis, Settings, Bills...). */
  openClassic: (page: PageId, arg?: string) => void
  refresh: () => void
  breakdown: (title: string, category: TaskCategory) => ReturnType<typeof breakdownTask>
  syncHevy: () => Promise<string>
  /** The classic Gym page's starter targets, for a Gym with none yet. */
  seedGym: () => void
  addNote: (space: SpaceId, body?: string) => string
  addPerson: (name: string, rel: string, tier: PersonTier) => string
  logTouch: (id: string, stepLabel: string) => void
  logContact: (id: string, channel: ContactChannel) => void
}

/** Everything a phone shell needs, live. */
export function useShellBridge(skin: SkinId): { mc: MC; api: ShellApi } {
  const s = useStore()
  const pomo = usePomodoro()
  const { state: realCal, reload: reloadCal } = useCalendar()
  /* ?noremote is the app's own test mode (it can never reach live data), and there the calendar is always "off". The shell's test
     puts a fixed set of events here so the month grid has something to draw; it is ignored everywhere else. */
  const cal = useMemo<CalState>(() => {
    try { const raw = /[?&]noremote/.test(location.search) ? localStorage.getItem('mc-shell-test-calendar') : null; if (raw) return { status: 'ok', events: JSON.parse(raw), readAt: Date.now() } } catch { /* fall through */ }
    return realCal
  }, [realCal])
  const { state: health } = useHealth()
  const { state: compass } = useCompass()
  const sync = useSyncStatus()
  const [weather, setWeather] = useState<Weather | null>(null)
  const [day, setDay] = useState(localDateKey)
  const [gymReads, setGymReads] = useState(0)
  useEffect(() => {
    let on = true
    const load = () => { void getWeather().then((w) => { if (on && w) setWeather(w) }).catch(() => {}) }
    load()
    const t = window.setInterval(() => { load(); setDay(localDateKey()) }, 60_000 * 10)
    const dayT = window.setInterval(() => setDay(localDateKey()), 60_000)
    return () => { on = false; window.clearInterval(t); window.clearInterval(dayT) }
  }, [])

  const sRef = useRef(s); sRef.current = s
  const pRef = useRef(pomo); pRef.current = pomo
  const thread = useAssistantThread()
  const tRef = useRef(thread); tRef.current = thread
  const subs = useRef(new Set<() => void>())
  const restored = useRef(false)
  useEffect(() => { if (keptTurns.length) thread.setTurns(keptTurns); restored.current = true }, [])
  useEffect(() => {
    if (restored.current && thread.turns.length) keptTurns = thread.turns
    subs.current.forEach((f) => f())
  }, [thread.turns, thread.busy, thread.err, thread.errHint, thread.live])
  const mc = useMemo(
    () => toMC({ s, pomo: { focusMin: pomo.focusMin, breakMin: pomo.breakMin, cyclesDone: pomo.cyclesDone }, cal, health, compass, weather, sync, skin, day, gymReads }),
    // The store object is new on every render; the pomodoro's secondsLeft ticks
    // every second and is deliberately not a dependency (the shell counts down itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.tasks, s.habits, s.habitLog, s.routines, s.routineLog, s.goals, s.slips, s.focusSessions, s.notes, s.noteFolders, s.people, s.personContacts,
      s.prospects, s.projects, s.ideaBoard, s.prompts, s.plan, s.ledger, s.gymGoals, s.activeFocus, s.dailyDone, s.dailySkipped, s.space, s.syncOrigin,
      pomo.focusMin, pomo.breakMin, pomo.cyclesDone, cal, health, compass, weather, sync.phase, sync.lastSyncedAt, skin, day, gymReads],
  )

  const api = useMemo<ShellApi>(() => ({
    assistant: {
      send: (text, shown) => tRef.current.send(text, shown),
      state: () => { const t = tRef.current; return { turns: t.turns, busy: t.busy, err: t.err, errHint: t.errHint, live: t.live } },
      subscribe: (cb) => { subs.current.add(cb); return () => { subs.current.delete(cb) } },
      undo: (ti, di) => {
        const d = tRef.current.turns[ti]?.done?.[di]
        if (!d?.undo || d.undone) return
        d.undo()
        tRef.current.setTurns((ts) => ts.map((t, i) => (i !== ti ? t : { ...t, done: t.done?.map((x, k) => (k !== di ? x : { ...x, undone: true })) })))
      },
      skills: [MORNING, ...SKILLS],
      mic: { available: dict.dictationAvailable, toggle: dict.toggle, state: dict.dictateState, subscribe: dict.subscribe },
    },
    store: () => sRef.current,
    pomo: () => pRef.current,
    setSkin,
    setView: (v) => { if (sRef.current.view !== v) sRef.current.setView(v) },
    openClassic: (page, arg) => {
      if (page === 'day' && arg) sRef.current.openDay(arg)
      else sRef.current.setPage(page)
    },
    refresh: () => { reloadCal(); void refreshCalendar(true); void getWeather().then((w) => w && setWeather(w)).catch(() => {}) },
    breakdown: (title, category) => breakdownTask(title, category),
    syncHevy: async () => {
      if (!hasHevyKey()) return 'No Hevy key on this device. Add it in Settings.'
      const res = await syncHevy(sRef.current.habits, sRef.current.markHabitDaysOn)
      setGymReads((n) => n + 1)
      return res.ok ? `Synced Hevy: ${res.days} day${res.days === 1 ? '' : 's'} of workouts`
        : res.reason === 'bad-key' ? 'That Hevy key was rejected' : res.reason === 'rate-limit' ? 'Hevy is rate limiting right now'
          : res.reason === 'no-habit' ? 'No habit named Workout / Gym / Fitness to tick' : 'Hevy could not be reached'
    },
    seedGym: () => { for (const g of FORGE_SEED) sRef.current.addGymGoal(g) },
    addNote: (space, body) => {
      const st = sRef.current
      const f = st.noteFolders.find((x) => x.space === space && /brain dump/i.test(x.name))?.id ?? spaceFolderId(space)
      return st.addNote(f, body)
    },
    addPerson: (name, rel, tier) => {
      const cad: Record<PersonTier, number> = { core: 7, close: 14, friends: 30, business: 30, wider: 90, distant: 365 }
      return sRef.current.addPerson({ name, rel, tier, cadenceDays: cad[tier], ...nextPersonSlot(sRef.current.people, tier) })
    },
    logTouch: (id, lab) => {
      const step = (STEPS.find((x) => x.label === lab)?.id ?? 'work') as TouchStep
      sRef.current.logTouch(id, { step, day: localDateKey() })
    },
    logContact: (id, channel) => sRef.current.logContact(id, localDateKey(), channel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  return { mc, api }
}
