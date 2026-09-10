/* HEALTH, read from the zepp_* tables that already live in this same Supabase
   project. The watch feeds Zepp, Zepp feeds Intervals.icu, a cron in
   off-plate/zepp-health writes both tables here nightly -- so Mission Control
   needs no pipeline of its own, only the session it already has. Same shared
   read as skills.ts and compass.ts: the dock's glance and the full page can be
   on screen at once and must not fetch twice.

   NOTHING IS INVENTED WHEN A STREAM GOES QUIET. His watch stopped feeding
   sleep, steps, resting heart rate and weight in June while training load kept
   arriving daily, so every reading below carries the day it was actually taken
   and the page says how old that is. A dashboard that draws June's resting
   heart rate under today's date is the one thing this app must never do. */
import { useCallback, useSyncExternalStore } from 'react'
import { SUPABASE_ENABLED, readRows } from './supabase'
import { createLiveStore } from './livestore'

/** One row per day from Intervals.icu's wellness feed. Every metric is
 *  nullable on purpose: a day the watch said nothing is a real, empty day. */
export interface WellnessDay {
  day: string
  resting_hr: number | null
  sleep_secs: number | null
  sleep_score: number | null
  steps: number | null
  weight: number | null
  ctl: number | null
  atl: number | null
  ramp_rate: number | null
}

/** One row per workout. `moving_time` is seconds. */
export interface Session {
  id: string
  start_date_local: string | null
  start_date: string
  type: string | null
  name: string | null
  moving_time: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  calories: number | null
  icu_training_load: number | null
  distance: number | null
}

export type HealthState =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; days: WellnessDay[]; sessions: Session[] }

const STALE_MS = 300_000

let readAt = 0
const store = createLiveStore<HealthState>(
  SUPABASE_ENABLED ? { status: 'loading' } : { status: 'off' },
  { onFirstSubscriber: () => { queueMicrotask(() => { void refresh() }) } },
)

function publish(next: HealthState): void {
  readAt = Date.now()
  store.publish(next)
}

const WELLNESS_COLS = 'day,resting_hr,sleep_secs,sleep_score,steps,weight,ctl,atl,ramp_rate'
const SESSION_COLS = 'id,start_date,start_date_local,type,name,moving_time,average_heartrate,max_heartrate,calories,icu_training_load,distance'

async function readHealth(): Promise<HealthState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  try {
    const [days, sessions] = await Promise.all([
      readRows<WellnessDay>('zepp_wellness', WELLNESS_COLS),
      readRows<Session>('zepp_activities', SESSION_COLS),
    ])
    if (days === null || sessions === null) return { status: 'signed-out' }
    if (days.length === 0 && sessions.length === 0) return { status: 'empty' }
    return {
      status: 'ok',
      days: [...days].sort((a, b) => a.day.localeCompare(b.day)),
      sessions: [...sessions].sort((a, b) => dayOf(b).localeCompare(dayOf(a))),
    }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Health data could not be read.' }
  }
}

let inFlight: Promise<void> | null = null

function refresh(force = false): Promise<void> {
  if (inFlight) return inFlight
  const view = store.getSnapshot()
  if (!SUPABASE_ENABLED) { if (view.status !== 'off') publish({ status: 'off' }); return Promise.resolve() }
  if (!force && view.status !== 'loading' && view.status !== 'off' && Date.now() - readAt < STALE_MS) return Promise.resolve()
  publish({ status: 'loading' })
  inFlight = readHealth()
    .then((s) => { publish(s) })
    .finally(() => { inFlight = null })
  return inFlight
}

export function useHealth(): { state: HealthState; reload: () => void } {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const reload = useCallback(() => { void refresh(true) }, [])
  return { state, reload }
}

/* ------------------------------------------------------------------ *
 * Reading the rows. Pure, so the page and the dock derive the same
 * numbers from the same functions rather than each doing its own maths.
 * ------------------------------------------------------------------ */

/** The local calendar day a session belongs to. Intervals.icu sends both a UTC
 *  instant and a local one; the local one is the day he actually trained, and
 *  a 21:00 session in Prague is not the next morning. */
export function dayOf(s: Session): string {
  return (s.start_date_local ?? s.start_date ?? '').slice(0, 10)
}

export type MetricKey = 'steps' | 'sleep_secs' | 'resting_hr' | 'weight' | 'ctl'

/** The most recent day this metric was actually reported, and its value.
 *  Null when the stream has never said anything. */
export function lastReading(days: WellnessDay[], key: MetricKey): { day: string; value: number } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key]
    if (v != null) return { day: days[i].day, value: v }
  }
  return null
}

/** Whole days between an ISO day and today. Same local-date arithmetic the
 *  rest of the app uses: parsed at noon, so a DST hour never rounds a day. */
export function daysSince(day: string, now = new Date()): number {
  const then = new Date(`${day}T12:00:00`)
  const today = new Date(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T12:00:00`)
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000))
}

/** How a reading is described once it has an age. The thresholds are his
 *  streams, not arbitrary: training load lands daily, a workout every few
 *  days when he is training, and anything a month old stopped rather than
 *  paused. */
export function freshness(age: number): 'live' | 'recent' | 'stale' {
  if (age <= 1) return 'live'
  if (age <= 30) return 'recent'
  return 'stale'
}

/** Sessions collapsed to one row per day. This is not tidying: 284 of his 395
 *  rows are three-to-eleven-minute fragments, because the watch files each
 *  block of one gym session as its own activity. A raw list reads as six
 *  workouts on a Monday he trained once, and the day totals are what he
 *  actually did. */
export interface SessionDay {
  day: string
  parts: number
  minutes: number
  calories: number
  load: number
  avgHr: number | null
  maxHr: number | null
  /** The longest part's type, which is what the day was really about. */
  type: string
  title: string
}

export function rollUpByDay(sessions: Session[]): SessionDay[] {
  const byDay = new Map<string, Session[]>()
  for (const s of sessions) {
    const d = dayOf(s)
    if (!d) continue
    const list = byDay.get(d)
    if (list) list.push(s); else byDay.set(d, [s])
  }
  const out: SessionDay[] = []
  for (const [day, parts] of byDay) {
    const seconds = parts.reduce((a, s) => a + (s.moving_time ?? 0), 0)
    const lead = [...parts].sort((a, b) => (b.moving_time ?? 0) - (a.moving_time ?? 0))[0]
    /* Averaged over TIME, not over rows: a 3 minute fragment and a 57 minute
       session are not two equal readings of the same morning. */
    const hrWeighted = parts.reduce((a, s) => a + (s.average_heartrate != null ? s.average_heartrate * (s.moving_time ?? 0) : 0), 0)
    const hrSeconds = parts.reduce((a, s) => a + (s.average_heartrate != null ? (s.moving_time ?? 0) : 0), 0)
    const maxes = parts.map((s) => s.max_heartrate).filter((v): v is number => v != null)
    out.push({
      day,
      parts: parts.length,
      minutes: Math.round(seconds / 60),
      calories: Math.round(parts.reduce((a, s) => a + (s.calories ?? 0), 0)),
      load: Math.round(parts.reduce((a, s) => a + (s.icu_training_load ?? 0), 0)),
      avgHr: hrSeconds > 0 ? Math.round(hrWeighted / hrSeconds) : null,
      maxHr: maxes.length ? Math.max(...maxes) : null,
      type: lead?.type ?? 'Workout',
      title: lead?.name ?? 'Workout',
    })
  }
  return out.sort((a, b) => b.day.localeCompare(a.day))
}

/** Only the days inside the range, counted back from today rather than from
 *  the last row: a range that quietly ends at the newest reading would hide
 *  exactly the gap he needs to see. */
export function withinDays<T extends { day: string }>(rows: T[], span: number, now = new Date()): T[] {
  if (span <= 0) return rows
  return rows.filter((r) => daysSince(r.day, now) < span)
}

/** A metric's series over the range, gaps included as nulls so a chart can
 *  break the line rather than draw straight through a month of silence. */
export function series(days: WellnessDay[], key: MetricKey): (number | null)[] {
  return days.map((d) => d[key])
}

export interface RangeTotals {
  sessions: number
  days: number
  minutes: number
  calories: number
  load: number
  avgHr: number | null
}

export function totals(sessionDays: SessionDay[]): RangeTotals {
  const hrDays = sessionDays.filter((d) => d.avgHr != null)
  return {
    sessions: sessionDays.reduce((a, d) => a + d.parts, 0),
    days: sessionDays.length,
    minutes: sessionDays.reduce((a, d) => a + d.minutes, 0),
    calories: sessionDays.reduce((a, d) => a + d.calories, 0),
    load: sessionDays.reduce((a, d) => a + d.load, 0),
    avgHr: hrDays.length ? Math.round(hrDays.reduce((a, d) => a + (d.avgHr ?? 0), 0) / hrDays.length) : null,
  }
}

/** Trend against the window before this one, which is the only comparison
 *  that means anything on a range he picked himself. Null when there is no
 *  previous window to compare against, never zero. */
export function deltaPct(now: number, before: number): number | null {
  if (!before) return null
  return Math.round(((now - before) / before) * 100)
}

export function fmtHm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
