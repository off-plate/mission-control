/* WHERE HE ACTUALLY IS, at the moment he wants to quit.

   His instruction (2026-09-12): take the horizon slider and its stops out of
   the give-up screen, keep the reel on the left, and put widgets of current
   status on the right. His list, in his words: "the debt status, the health
   status, the amount of tasks that I'm postponing, goals that are missing,
   habits that I'm not doing or keep trying to quit but not actually doing,
   routines that I keep breaking."

   Why this replaces what was there: the old right side projected two futures
   from a slider. A projection is an argument about a day that has not
   happened. This is the day that has. At the moment he is about to drop
   something, what is load-bearing is what is already true, and none of these
   numbers are encouraging by design -- they are counted, not chosen. */
import type { CompassMoney } from './compass'
import type { Goal, HabitDef, HabitSlip, HabitTick, Routine, RoutineDone, Task } from './types'
import { daysSince } from './health'
import { localDateKey } from './util'

export interface StatusRow { at: string; what: string }

export interface StatusCard {
  id: string
  label: string
  /** The number, already formatted. */
  figure: string
  unit: string
  /** One line saying what the figure means. Never a pep talk. */
  line: string
  /** 'bad' earns the alert colour. Only when it is genuinely bad, or the
   *  colour stops meaning anything. */
  tone: 'good' | 'flat' | 'bad'
  /** The worst offenders by name, when naming them is the point. */
  rows?: StatusRow[]
}

const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')

/* THE DATE HE IS COUNTING TO. His instruction (2026-09-12): a countdown to
   the fourteenth of February, in days, weeks and hours. The screen this
   replaced ran to 2027-02-28, "end of February 2027", so if the 14th was a
   slip of the tongue this one constant is the whole fix. */
export const HORIZON = '2027-02-14'

export interface Countdown { days: number; weeks: number; hours: number; label: string; past: boolean }

export function countdown(to = HORIZON, now = new Date()): Countdown {
  const end = new Date(`${to}T00:00:00`)
  const ms = end.getTime() - now.getTime()
  const hours = Math.max(0, Math.floor(ms / 3_600_000))
  const days = Math.max(0, Math.floor(ms / 86_400_000))
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return {
    days,
    weeks: Math.floor(days / 7),
    hours,
    label: `${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`,
    past: ms <= 0,
  }
}
const ago = (n: number) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`)

/** Days between an ISO day and today, never negative. */
function age(day: string | undefined): number {
  return day ? daysSince(day) : 0
}

export function debtCard(money: CompassMoney | null): StatusCard {
  if (!money) {
    return { id: 'debt', label: 'Debt', figure: '—', unit: '', line: 'Compass is not connected on this device.', tone: 'flat' }
  }
  return {
    id: 'debt',
    label: 'Debt',
    figure: kc(money.owed),
    unit: 'Kč still owed',
    line: money.owed > 0
      ? `${money.pct.toFixed(0)}% of the original paid off, ${kc(money.monthly)} Kč a month across ${money.openDebts} ${money.openDebts === 1 ? 'debt' : 'debts'}.`
      : 'Nothing owed.',
    tone: money.owed > 0 ? 'bad' : 'good',
  }
}

export function healthCard(sessionDays: string[]): StatusCard {
  if (!sessionDays.length) {
    return { id: 'health', label: 'Training', figure: 'None', unit: 'on record', line: 'No session has ever reached this app.', tone: 'bad' }
  }
  const newest = [...sessionDays].sort().pop() as string
  const since = age(newest)
  const last30 = new Set(sessionDays.filter((d) => age(d) < 30)).size
  return {
    id: 'health',
    label: 'Training',
    figure: String(last30),
    unit: 'days in the last 30',
    line: `Last session ${ago(since)}.`,
    /* Four weeks with nothing is a stopped habit, not a light week. */
    tone: since >= 14 ? 'bad' : last30 >= 8 ? 'good' : 'flat',
  }
}

/** Tasks he keeps moving rather than doing. Age is the measure, never a due
 *  date: a task carried for three weeks is the avoidance, whatever it was
 *  ever "due". */
export function postponedCard(tasks: Task[]): StatusCard {
  const open = tasks.filter((t) => !t.done)
  const stale = open
    .filter((t) => age(t.createdAt) >= 7)
    .sort((a, b) => age(b.createdAt) - age(a.createdAt))
  const oldest = stale[0]
  return {
    id: 'postponed',
    label: 'Postponed',
    figure: `${stale.length}/${open.length}`,
    unit: 'sitting a week or more',
    line: oldest ? `The oldest has been waiting ${age(oldest.createdAt)} days.` : 'Nothing has been sitting a week.',
    tone: stale.length >= 5 ? 'bad' : stale.length ? 'flat' : 'good',
    rows: stale.slice(0, 3).map((t) => ({ at: `${age(t.createdAt)}d`, what: t.title })),
  }
}

/** Goals with no movement. "Missing" in his words: open, and not being fed. */
export function goalsCard(goals: Goal[]): StatusCard {
  const open = goals.filter((g) => !g.closed)
  const stuck = open.filter((g) => g.target > 0 && g.current / g.target < 0.5)
  const overdue = open.filter((g) => g.deadline && g.deadline < localDateKey())
  return {
    id: 'goals',
    label: 'Goals',
    figure: `${stuck.length}/${open.length}`,
    unit: 'under halfway',
    line: overdue.length
      ? `${overdue.length} past ${overdue.length === 1 ? 'its date' : 'their dates'}.`
      : open.length ? 'None past their date yet.' : 'No open goals.',
    tone: overdue.length ? 'bad' : stuck.length ? 'flat' : 'good',
    rows: stuck.slice(0, 3).map((g) => ({ at: `${Math.round((g.current / Math.max(1, g.target)) * 100)}%`, what: g.name })),
  }
}

/** Build habits he is not keeping. Counted over the last 14 days, which is
 *  long enough that one bad week does not read as a collapse. */
export function habitsCard(habits: HabitDef[], log: HabitTick[]): StatusCard {
  const build = habits.filter((h) => !h.archivedAt && !h.paused && h.kind !== 'break' && h.frequency === 'daily')
  if (!build.length) return { id: 'habits', label: 'Habits', figure: '—', unit: '', line: 'No daily habits set.', tone: 'flat' }
  const recent = new Map<string, number>()
  for (const t of log) if (age(t.day) < 14) recent.set(t.habitId, (recent.get(t.habitId) ?? 0) + 1)
  const cold = build
    .map((h) => ({ h, kept: recent.get(h.id) ?? 0 }))
    .filter((x) => x.kept < 7)
    .sort((a, b) => a.kept - b.kept)
  return {
    id: 'habits',
    label: 'Habits',
    figure: `${cold.length}/${build.length}`,
    unit: 'slipping',
    line: cold.length
      ? `Kept less than half of the last 14 days.`
      : 'Every one of them held for the last two weeks.',
    tone: cold.length >= Math.ceil(build.length / 2) ? 'bad' : cold.length ? 'flat' : 'good',
    rows: cold.slice(0, 3).map((x) => ({ at: `${x.kept}/14`, what: x.h.name })),
  }
}

/** The ones he is trying to quit and has not. Slips are the measure, because
 *  a quit habit has no tick to count. */
export function quittingCard(habits: HabitDef[], slips: HabitSlip[]): StatusCard {
  const quitting = habits.filter((h) => !h.archivedAt && h.kind === 'break')
  if (!quitting.length) return { id: 'quitting', label: 'Quitting', figure: '—', unit: '', line: 'Nothing being quit.', tone: 'flat' }
  const recent = new Map<string, number>()
  for (const s of slips) if (age(s.day) < 30) recent.set(s.habitId, (recent.get(s.habitId) ?? 0) + 1)
  const ranked = quitting
    .map((h) => ({ h, slipped: recent.get(h.id) ?? 0 }))
    .sort((a, b) => b.slipped - a.slipped)
  const total = ranked.reduce((n, x) => n + x.slipped, 0)
  return {
    id: 'quitting',
    label: 'Quitting',
    figure: String(total),
    unit: `${total === 1 ? 'slip' : 'slips'} in 30 days`,
    line: total ? `Across ${ranked.filter((x) => x.slipped).length} of ${quitting.length}.` : `Clean for 30 days across all ${quitting.length}.`,
    tone: total >= 10 ? 'bad' : total ? 'flat' : 'good',
    rows: ranked.filter((x) => x.slipped).slice(0, 3).map((x) => ({ at: `${x.slipped}x`, what: x.h.name })),
  }
}

/** Routines he keeps breaking. A routine that has not run in its own recent
 *  window is broken, whatever its schedule says. */
export function routinesCard(routines: Routine[], log: RoutineDone[]): StatusCard {
  const live = routines.filter((r) => !r.archivedAt)
  if (!live.length) return { id: 'routines', label: 'Routines', figure: '—', unit: '', line: 'No routines set.', tone: 'flat' }
  const lastRun = new Map<string, string>()
  for (const r of log) {
    const prev = lastRun.get(r.routineId)
    if (!prev || r.day > prev) lastRun.set(r.routineId, r.day)
  }
  const broken = live
    .map((r) => ({ r, last: lastRun.get(r.id) }))
    .filter((x) => !x.last || age(x.last) >= 14)
    .sort((a, b) => (a.last ? age(a.last) : 9999) - (b.last ? age(b.last) : 9999))
    .reverse()
  return {
    id: 'routines',
    label: 'Routines',
    figure: `${broken.length}/${live.length}`,
    unit: 'broken',
    line: broken.length ? 'Not run in the last two weeks.' : 'All of them ran in the last two weeks.',
    tone: broken.length >= Math.ceil(live.length / 2) ? 'bad' : broken.length ? 'flat' : 'good',
    rows: broken.slice(0, 3).map((x) => ({ at: x.last ? `${age(x.last)}d` : "never", what: x.r.title })),
  }
}

/* ------------------------------------------------------------------ *
 * THE SHAPES BEHIND THE NUMBERS.
 *
 * His reference (2026-09-12) is a dashboard where every panel draws its
 * own data rather than printing it: a training heatmap, habit rings, a
 * slip chart, goal arcs, a routine track, and a central wheel scoring the
 * whole life at once. These build the series each of those needs.
 *
 * The reference also carries two rendered 3D illustrations, a pile of coins
 * and a mountain range. Those are generated pictures, not data, and a
 * picture of a mountain says nothing true about how long a task has waited.
 * Their slots get something drawn from his own numbers instead.
 * ------------------------------------------------------------------ */

/** 0..1, how well a domain is doing. The wheel needs every card on one
 *  scale, so each card carries its own. */
export interface Scored extends StatusCard { pct: number }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function score(card: StatusCard, pct: number): Scored {
  return { ...card, pct: clamp01(pct) }
}

/** Minutes trained per day, newest last, over `span` days. */
export function trainingGrid(sessionDays: string[], sessionMinutes: Map<string, number>, span = 70, now = new Date()): { day: string; minutes: number; on: boolean }[] {
  const on = new Set(sessionDays)
  const out: { day: string; minutes: number; on: boolean }[] = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ day, minutes: sessionMinutes.get(day) ?? 0, on: on.has(day) })
  }
  return out
}

/** What kind of training it was, so the card can say more than "27 days". */
export function trainingKinds(types: string[]): { label: string; n: number }[] {
  const by = new Map<string, number>()
  for (const raw of types) {
    const t = (raw || 'Workout').toLowerCase()
    const label = /weight|strength/.test(t) ? 'strength' : /ride|cycl|run|walk|swim/.test(t) ? 'cardio' : 'workout'
    by.set(label, (by.get(label) ?? 0) + 1)
  }
  return [...by.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)
}

/** Slips per day across 30 days, for the quitting chart. */
export function slipSeries(slips: HabitSlip[], span = 30, now = new Date()): { day: string; n: number }[] {
  const by = new Map<string, number>()
  for (const s of slips) by.set(s.day, (by.get(s.day) ?? 0) + 1)
  const out: { day: string; n: number }[] = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ day, n: by.get(day) ?? 0 })
  }
  return out
}

/** Each build habit and how much of the last 14 days it held. */
export function habitRings(habits: HabitDef[], log: HabitTick[]): { name: string; kept: number; of: number }[] {
  const build = habits.filter((h) => !h.archivedAt && !h.paused && h.kind !== 'break' && h.frequency === 'daily')
  const recent = new Map<string, number>()
  for (const t of log) if (age(t.day) < 14) recent.set(t.habitId, (recent.get(t.habitId) ?? 0) + 1)
  return build
    .map((h) => ({ name: h.name, kept: Math.min(14, recent.get(h.id) ?? 0), of: 14 }))
    .sort((a, b) => b.kept - a.kept)
}

/** Each routine and how many of the last 7 days it ran. */
export function routineTrack(routines: Routine[], log: RoutineDone[]): { name: string; ran: number; of: number; dormant: boolean }[] {
  return routines
    .filter((r) => !r.archivedAt)
    .map((r) => {
      const ran = new Set(log.filter((x) => x.routineId === r.id && age(x.day) < 7).map((x) => x.day)).size
      const last = log.filter((x) => x.routineId === r.id).map((x) => x.day).sort().pop()
      return { name: r.title, ran, of: 7, dormant: !last || age(last) >= 14 }
    })
    .sort((a, b) => b.ran - a.ran)
}

/** Open goals with how far along each is. */
export function goalArcs(goals: Goal[]): { name: string; pct: number }[] {
  return goals
    .filter((g) => !g.closed)
    .map((g) => ({ name: g.name, pct: g.target > 0 ? clamp01(g.current / g.target) : 0 }))
    .sort((a, b) => b.pct - a.pct)
}
