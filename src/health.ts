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
import { SUPABASE_ENABLED, callFunction, readRows } from './supabase'
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

/* A way to render this page against known rows without signing in. It exists
   because the last two passes at this page were judged by reading the code
   instead of looking at it, and both shipped broken: a chart cannot be
   reviewed as source. QA and my own screenshots put real-shaped rows in
   `mc-health-fixture` and get the real page, drawn by the real code. Nothing
   writes this key in normal use, so a signed-in read is untouched. */
function fixture(): HealthState | null {
  try {
    const raw = localStorage.getItem('mc-health-fixture')
    if (!raw) return null
    const f = JSON.parse(raw) as { days?: WellnessDay[]; sessions?: Session[]; lastRun?: SyncRun | null }
    return {
      status: 'ok',
      days: [...(f.days ?? [])].sort((a, b) => a.day.localeCompare(b.day)),
      sessions: [...(f.sessions ?? [])].sort((a, b) => dayOf(b).localeCompare(dayOf(a))),
      lastRun: f.lastRun ?? null,
    }
  } catch { return null }
}

async function readHealth(): Promise<HealthState> {
  const fake = fixture()
  if (fake) return fake
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
  /* The fixture outranks the remote switch, so the page can be reviewed with
     ?noremote on -- which is the only mode a gate is ever allowed to run in. */
  const fake = fixture()
  if (fake) { publish(fake); return Promise.resolve() }
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
 * His ask: a button that actually goes and fetches. It calls the
 * `zepp-sync` Edge Function, which holds the Intervals key and does the
 * whole pull itself. The key has to live there rather than here,
 * because a key in this bundle is a key on a public site.
 *
 * Moved off off-plate/zepp-health on 2026-09-11, on his instruction to
 * ditch that repo. It used to take three services to press this button:
 * a Netlify function existed only to hold a GitHub token so it could
 * dispatch a GitHub Action which ran the real worker. One function now,
 * which the cron calls too, so there is a single implementation.
 *
 * It still WAITS FOR THE REAL ANSWER rather than flashing "synced" the
 * moment the request is accepted, and it still reads that answer out of
 * zepp_sync_log rather than trusting the reply: the row landing is the
 * only honest evidence that rows landed. The function is synchronous
 * now, so the row is usually there by the time the call returns, but the
 * poll stays -- it is what reports the worker's own error, and it costs
 * one read when the row is already waiting.
 * ------------------------------------------------------------------ */
const SYNC_FUNCTION = 'zepp-sync'
/** The pull itself, against Intervals, for two months of history. Measured in
 *  seconds; three minutes is the point at which something is wrong. */
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

  const called = await callFunction(SYNC_FUNCTION, { method: 'POST', body: { lookback_days: 60 } })
  if (!called.ok) {
    /* A blocked request and an unreachable one look identical from here, and
       both mean the same thing to him: it did not start. Being signed out is
       the one case worth naming separately, because it is the one he can fix. */
    const message =
      called.reason === 'signed-out' ? 'Sign in on this device to sync.' :
      called.reason === 'off' ? 'Sync is off on this device.' :
      called.message?.trim() || 'Could not reach the sync worker.'
    syncStore.publish({ phase: 'failed', message })
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
/** One metric, one point per day across the whole range, gaps kept as null.
 *  Every card on the page draws its own chart from this: a number with no
 *  shape next to it is the thing he could not read. */
export function series(days: WellnessDay[], key: MetricKey, span: number, now = new Date()): { day: string; value: number | null }[] {
  const by = new Map(days.map((d) => [d.day, d]))
  return dayRange(span, now).map((day) => ({ day, value: by.get(day)?.[key] ?? null }))
}

/** The same shape for anything measured per training day rather than per
 *  calendar reading. A day he did not train is a real zero, not a gap. */
export function sessionSeries(frames: DayFrame[], key: 'load' | 'minutes' | 'calories' | 'parts'): { day: string; value: number | null }[] {
  return frames.map((f) => ({ day: f.day, value: f[key] }))
}

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
