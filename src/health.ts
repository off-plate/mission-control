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

/** One row of zepp_sync_log: when the worker last ran, and what it wrote. */
export interface SyncRun {
  ran_at: string
  ok: boolean
  wellness_rows: number | null
  activity_rows: number | null
  error: string | null
}

export type HealthState =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ok'; days: WellnessDay[]; sessions: Session[]; lastRun: SyncRun | null }

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
const RUN_COLS = 'ran_at,ok,wellness_rows,activity_rows,error'

/** The newest row of the worker's own log. Read separately from the data so a
 *  log that is empty, or a policy that hides it, never costs him the page. */
async function readLastRun(): Promise<SyncRun | null> {
  try {
    const rows = await readRows<SyncRun>('zepp_sync_log', RUN_COLS)
    if (!rows?.length) return null
    return [...rows].sort((a, b) => b.ran_at.localeCompare(a.ran_at))[0]
  } catch { return null }
}

async function readHealth(): Promise<HealthState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  try {
    const [days, sessions, lastRun] = await Promise.all([
      readRows<WellnessDay>('zepp_wellness', WELLNESS_COLS),
      readRows<Session>('zepp_activities', SESSION_COLS),
      readLastRun(),
    ])
    if (days === null || sessions === null) return { status: 'signed-out' }
    if (days.length === 0 && sessions.length === 0) return { status: 'empty' }
    return {
      status: 'ok',
      days: [...days].sort((a, b) => a.day.localeCompare(b.day)),
      sessions: [...sessions].sort((a, b) => dayOf(b).localeCompare(dayOf(a))),
      lastRun,
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
 * SYNCING ON DEMAND.
 *
 * His ask: a button that actually goes and fetches. The worker that
 * talks to Intervals.icu is a GitHub Action in off-plate/zepp-health --
 * it holds the API key, and it must, because a key in this bundle is a
 * key on a public site. So this presses the button that repo already
 * exposes for it: a Netlify function that dispatches the workflow.
 *
 * Then it WAITS FOR THE REAL ANSWER rather than flashing "synced" the
 * moment the dispatch is accepted. The dispatch only means GitHub took
 * the request; the sync itself lands about a minute later, and the
 * worker writes its own row to zepp_sync_log when it is done. That row
 * appearing is the only honest evidence anything synced, so that is
 * what this watches for, and what it reports back -- including the
 * worker's own error when it failed.
 * ------------------------------------------------------------------ */
const SYNC_ENDPOINT = 'https://zepp-health.netlify.app/.netlify/functions/sync'
/** The worker is dispatched, queued, installs and runs. Measured at roughly a
 *  minute end to end; three is the point at which something is wrong. */
const SYNC_TIMEOUT_MS = 180_000
const SYNC_POLL_MS = 4_000

export type SyncPhase =
  | { phase: 'idle' }
  | { phase: 'asking' }
  | { phase: 'running' }
  | { phase: 'done'; run: SyncRun }
  | { phase: 'failed'; message: string }

const syncStore = createLiveStore<SyncPhase>({ phase: 'idle' })

const wait = (ms: number) => new Promise((r) => { setTimeout(r, ms) })

async function runSync(): Promise<void> {
  const now = syncStore.getSnapshot()
  if (now.phase === 'asking' || now.phase === 'running') return
  if (!SUPABASE_ENABLED) { syncStore.publish({ phase: 'failed', message: 'Sync is off on this device.' }); return }

  syncStore.publish({ phase: 'asking' })
  const before = (await readLastRun())?.ran_at ?? ''

  try {
    const res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookback_days: '60' }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      syncStore.publish({ phase: 'failed', message: detail.trim() || `The sync worker answered ${res.status}.` })
      return
    }
  } catch {
    /* A blocked request and an unreachable one look identical from here, and
       both mean the same thing to him: it did not start. */
    syncStore.publish({ phase: 'failed', message: 'Could not reach the sync worker.' })
    return
  }

  syncStore.publish({ phase: 'running' })
  const until = Date.now() + SYNC_TIMEOUT_MS
  while (Date.now() < until) {
    await wait(SYNC_POLL_MS)
    const run = await readLastRun()
    if (run && run.ran_at > before) {
      await refresh(true)
      syncStore.publish(run.ok
        ? { phase: 'done', run }
        : { phase: 'failed', message: run.error?.trim() || 'The worker ran and reported a failure.' })
      return
    }
  }
  syncStore.publish({ phase: 'failed', message: 'It started, but nothing had landed after three minutes.' })
}

export function useHealthSync(): { sync: SyncPhase; start: () => void; clear: () => void } {
  const sync = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot, syncStore.getSnapshot)
  const start = useCallback(() => { void runSync() }, [])
  const clear = useCallback(() => { syncStore.publish({ phase: 'idle' }) }, [])
  return { sync, start, clear }
}

/** "2 hours ago", from a timestamp rather than a day. */
export function agoFrom(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
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
  /** The real rows behind the roll-up, newest first. The page opens a day to
   *  show these: "+4 more" that cannot be opened is a promise, not a summary. */
  items: Session[]
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
      items: [...parts].sort((a, b) => (b.start_date_local ?? b.start_date ?? '').localeCompare(a.start_date_local ?? a.start_date ?? '')),
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

/** Every day in the range, present whether or not anything happened on it.
 *  A chart that only plots the days with data is not a day-by-day chart: it
 *  silently closes the gaps, and the gaps are the story here. */
export function dayRange(span: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** One day, everything about it, whether it holds anything or not. */
export interface DayFrame {
  day: string
  ctl: number | null
  load: number
  minutes: number
  calories: number
  avgHr: number | null
  maxHr: number | null
  parts: number
  title: string | null
  type: string | null
}

export function frames(days: WellnessDay[], sessionDays: SessionDay[], span: number, now = new Date()): DayFrame[] {
  const wellness = new Map(days.map((d) => [d.day, d]))
  const sessions = new Map(sessionDays.map((d) => [d.day, d]))
  return dayRange(span, now).map((day) => {
    const s = sessions.get(day)
    return {
      day,
      ctl: wellness.get(day)?.ctl ?? null,
      load: s?.load ?? 0,
      minutes: s?.minutes ?? 0,
      calories: s?.calories ?? 0,
      avgHr: s?.avgHr ?? null,
      maxHr: s?.maxHr ?? null,
      parts: s?.parts ?? 0,
      title: s?.title ?? null,
      type: s?.type ?? null,
    }
  })
}

/** What a body metric says INSIDE the chosen range, and -- separately -- the
 *  last thing it ever said. His report: a number on the page with no way to
 *  tell whether it was today, an average, or June. Both are stated now, and
 *  they are stated as different things. */
export interface BodyStat {
  inRange: number[]
  avg: number | null
  lo: number | null
  hi: number | null
  last: { day: string; value: number } | null
}

export function bodyStat(days: WellnessDay[], key: MetricKey, span: number, now = new Date()): BodyStat {
  const from = dayRange(span, now)[0]
  const inRange = days.filter((d) => d.day >= from).map((d) => d[key]).filter((v): v is number => v != null)
  return {
    inRange,
    avg: inRange.length ? inRange.reduce((a, v) => a + v, 0) / inRange.length : null,
    lo: inRange.length ? Math.min(...inRange) : null,
    hi: inRange.length ? Math.max(...inRange) : null,
    last: lastReading(days, key),
  }
}

/** "Mon 8", for an axis that has to name real days. */
export function fmtWeekday(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'short' })
}

export function fmtDayFull(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
