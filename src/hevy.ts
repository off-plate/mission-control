/* Hevy connection. The same shape as ai.ts's Groq key: kept in localStorage on
   this device only, never synced, never in the repo, so a public codebase
   never carries it.

   What this reaches for: which local dates had a workout logged in Hevy, full
   history on the first connect. Nothing here writes to Hevy -- Jarvis's own
   automation already owns the write side (routines, autoregulation); this is
   read-only, for one purpose, ticking the Workout / Gym / Fitness habit and,
   later, the Timeline's Health column. */

import { syncHealth } from './health'
import type { HabitDef } from './types'

const KEY_STORE = 'mc-hevy-key'
/* When this device last actually called Hevy, so the once-a-day check does
   not re-fetch on every visibility change. A per-device fact like the key
   itself, not app data, so it stays out of the synced blob on purpose --
   another device syncing does no harm to re-check on its own clock. */
const LAST_SYNC_STORE = 'mc-hevy-last-sync'
/* Length and volume, per day. A per-device cache, not synced app data, for
   the same reason the key and the sync stamp are not: it is fully rebuilt
   from Hevy on every sync (there is no since-filter to fetch only what
   changed), so the honest place for it is beside the other two facts that
   already live and die with this device's own connection. A day the habit
   was ticked by hand rather than by Hevy simply has no entry here -- the
   Health column already knows to fall back to the plain checkmark. */
const STATS_STORE = 'mc-hevy-stats'
const BASE_URL = 'https://api.hevyapp.com/v1'
/* Hevy caps a page at 10 workouts, per its own API. A page beyond ~40 (a
   year of near-daily training) would mean an unusually long backfill; capped
   so a bad key or an infinite loop can never hammer the API forever. */
const MAX_PAGES = 60
/** The exact habit this connects to. Matched by name, not a stored id: he
 *  named it in the request and there is no per-habit "wire this to Hevy"
 *  toggle in the UI (yet) to point at instead. Case-loose so a small rename
 *  does not silently disconnect it. */
export const TARGET_HABIT_NAME = 'workout / gym / fitness'

export function getHevyKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? '' } catch { return '' }
}
export function setHevyKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORE, key.trim())
    else localStorage.removeItem(KEY_STORE)
  } catch { /* storage unavailable */ }
}
export function hasHevyKey(): boolean {
  return getHevyKey().trim().length > 0
}

export function getHevyLastSync(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_STORE)
    return raw ? Number(raw) : null
  } catch { return null }
}
function setHevyLastSync(at: number): void {
  try { localStorage.setItem(LAST_SYNC_STORE, String(at)) } catch { /* storage unavailable */ }
}
/** Local date key, YYYY-MM-DD, matching the format habitLog and the rest of
 *  the app already key days by. */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** True once today has already had a real Hevy call, so the once-daily
 *  check and a manual "Sync now" both read the same answer. */
export function syncedToday(): boolean {
  const at = getHevyLastSync()
  return !!at && localDay(new Date(at)) === localDay(new Date())
}

export interface HevyDayStats { minutes: number; volumeKg: number }

/** What Hevy said about a day, last time this device synced. Null when the
 *  day was never a Hevy workout at all (ticked by hand, or simply nothing
 *  that day) -- the caller's cue to show the plain checkmark instead. */
export function getHevyStatsForDay(day: string): HevyDayStats | null {
  try {
    const raw = localStorage.getItem(STATS_STORE)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, HevyDayStats>
    return all[day] ?? null
  } catch { return null }
}
function setHevyStats(stats: Record<string, HevyDayStats>): void {
  try { localStorage.setItem(STATS_STORE, JSON.stringify(stats)) } catch { /* storage unavailable */ }
}
/** Every day Hevy has ever reported, for the Gym page's session ladder --
 *  that page reads training days off Hevy itself, not the Zepp/Intervals
 *  rollup Health already shows, so the two pages never repeat one session. */
export function getAllHevyDayStats(): Record<string, HevyDayStats> {
  try {
    const raw = localStorage.getItem(STATS_STORE)
    return raw ? JSON.parse(raw) as Record<string, HevyDayStats> : {}
  } catch { return {} }
}

/* The Gym page's own exercise history -- his report (2026-09-18): PROVING
   GROUND's real goals back, but this time built from what Hevy's API
   already returns per set (weight_kg, reps) rather than the coarse
   day-total volume above, which throws away which exercise a set even
   belonged to. A per-device cache, same reasoning as STATS_STORE: fully
   rebuilt every sync, never the synced blob, since it is a straight
   derivation of what Hevy itself already has. */
const EXERCISE_STORE = 'mc-hevy-exercises'
export interface ExerciseDayEntry {
  day: string
  /** Epley estimate off the day's single best set for this exercise:
     weight_kg * (1 + reps / 30). */
  e1rm: number
  weight: number
  reps: number
  /** Every set's reps summed, for exercises scored as a session total
     (a pull-up day) rather than a single best set. */
  repTotal: number
  /** True the first day this exercise's e1rm reached a new all-time high,
     computed once here in chronological order so nothing downstream has
     to re-walk the whole history to answer "was this a PR". */
  isPR: boolean
}
export type ExerciseHistory = Record<string, ExerciseDayEntry[]>

export function getHevyExerciseHistory(): ExerciseHistory {
  try {
    const raw = localStorage.getItem(EXERCISE_STORE)
    return raw ? JSON.parse(raw) as ExerciseHistory : {}
  } catch { return {} }
}
function setHevyExerciseHistory(h: ExerciseHistory): void {
  try { localStorage.setItem(EXERCISE_STORE, JSON.stringify(h)) } catch { /* storage unavailable */ }
}

/** The best e1rm this exercise has ever hit, or null if it's never been
 *  logged at all -- a Gym goal with nothing to show yet, not a zero. */
export function bestE1rmEver(h: ExerciseHistory, name: string): number | null {
  const rows = h[name]
  if (!rows?.length) return null
  return rows.reduce((m, r) => Math.max(m, r.e1rm), 0)
}
/** The best single-session rep total this exercise has ever hit (a pull-up
 *  day's four sets summed), or null if it's never been logged. */
export function bestRepTotalEver(h: ExerciseHistory, name: string): number | null {
  const rows = h[name]
  if (!rows?.length) return null
  return rows.reduce((m, r) => Math.max(m, r.repTotal), 0)
}
/** Which exercises hit a new all-time e1RM on this exact day, for the Gym
 *  page's session ladder -- "any PR was hit" read straight off the same
 *  isPR flag the goal rings use, not a second guess at what counts as one. */
export function prsOnDay(h: ExerciseHistory, day: string): string[] {
  return Object.entries(h)
    .filter(([, rows]) => rows.some((r) => r.day === day && r.isPR))
    .map(([name]) => name)
}

interface HevySet { weight_kg?: number; reps?: number }
interface HevyExercise { title?: string; sets?: HevySet[] }
interface HevyWorkout { start_time?: string; end_time?: string; exercises?: HevyExercise[] }
interface HevyWorkoutsPage { workouts?: HevyWorkout[]; page_count?: number }

export type HevySyncResult =
  | { ok: true; days: string[]; stats: Record<string, HevyDayStats> }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

/** Every local date (YYYY-MM-DD) that has at least one workout logged in
 *  Hevy, and what it was: minutes trained and kilos moved, both summed
 *  across every workout that landed on the same day. Hevy has no since-date
 *  filter on this endpoint, so every sync pages through the full history --
 *  the same cost on day one (a real backfill) and on the thousandth day.
 *  Cheap enough at once-a-day cadence that it was not worth the bug surface
 *  of a partial, since-last-sync fetch. */
/** weight_kg * (1 + reps/30), the same Epley estimate Forge's own
 *  update_forge.py used -- so a number carried over from that dashboard
 *  still means the same thing here. */
function epley1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30)
}

export async function fetchHevyWorkoutDays(): Promise<HevySyncResult> {
  const key = getHevyKey()
  if (!key) return { ok: false, reason: 'no-key' }
  const days = new Set<string>()
  const stats: Record<string, HevyDayStats> = {}
  /* Exercise -> day -> the day's best set (highest e1rm) and its rep total,
     collected raw across every page before any PR flag is decided, since
     Hevy's pages are not guaranteed to arrive in date order and a PR is
     only knowable once every day for that exercise is in hand. */
  const exerciseDayBest: Record<string, Record<string, { weight: number; reps: number; e1rm: number; repTotal: number }>> = {}
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`${BASE_URL}/workouts?pageSize=10&page=${page}`, {
        headers: { 'api-key': key },
      })
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
      if (res.status === 429) return { ok: false, reason: 'rate-limit' }
      if (!res.ok) return { ok: false, reason: 'failed' }
      const data = await res.json() as HevyWorkoutsPage
      const workouts = data.workouts ?? []
      for (const w of workouts) {
        if (!w.start_time) continue
        const start = new Date(w.start_time)
        if (Number.isNaN(start.getTime())) continue
        const day = localDay(start)
        days.add(day)

        const end = w.end_time ? new Date(w.end_time) : null
        const minutes = end && !Number.isNaN(end.getTime()) ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : 0
        /* Weight-and-reps sets only. A timed set (a plank, a stair climb) has
           no weight_kg and would silently multiply as NaN or zero into a
           volume number that means nothing for it; skipped rather than
           counted as 0kg lifted, which would be a real number in the wrong
           units mixed into a real one. */
        const volumeKg = (w.exercises ?? []).reduce((ea, ex) => ea + (ex.sets ?? []).reduce(
          (sa, s) => sa + (typeof s.weight_kg === 'number' && typeof s.reps === 'number' ? s.weight_kg * s.reps : 0), 0,
        ), 0)

        const prev = stats[day]
        stats[day] = { minutes: (prev?.minutes ?? 0) + minutes, volumeKg: (prev?.volumeKg ?? 0) + volumeKg }

        for (const ex of w.exercises ?? []) {
          if (!ex.title) continue
          /* A bodyweight set (a real Pull Up, most of the time) comes back
             with reps but no weight_kg at all -- treated as 0kg here, not
             dropped, or a repTotal goal like his pull-up day total would
             never see a single real set. Confirmed against his own Hevy
             history 2026-09-19: every "Pull Up" row but one legacy 2024
             entry was silently empty before this fix. */
          const sets = (ex.sets ?? [])
            .filter((s): s is HevySet & { reps: number } => typeof s.reps === 'number')
            .map((s) => ({ weight_kg: typeof s.weight_kg === 'number' ? s.weight_kg : 0, reps: s.reps }))
          if (!sets.length) continue
          const repTotal = sets.reduce((a, s) => a + s.reps, 0)
          let best = sets[0]
          let bestE1rm = epley1rm(best.weight_kg, best.reps)
          for (const s of sets.slice(1)) {
            const e = epley1rm(s.weight_kg, s.reps)
            if (e > bestE1rm) { best = s; bestE1rm = e }
          }
          const byDay = (exerciseDayBest[ex.title] ??= {})
          const prevDay = byDay[day]
          /* Two workouts of the same exercise on one real day (a make-up
             session): keep whichever set actually hit higher, and sum both
             sessions' reps into the day's total rather than picking one. */
          byDay[day] = {
            weight: !prevDay || bestE1rm > prevDay.e1rm ? best.weight_kg : prevDay.weight,
            reps: !prevDay || bestE1rm > prevDay.e1rm ? best.reps : prevDay.reps,
            e1rm: Math.max(prevDay?.e1rm ?? 0, bestE1rm),
            repTotal: (prevDay?.repTotal ?? 0) + repTotal,
          }
        }
      }
      if (workouts.length === 0 || page >= (data.page_count ?? 1)) break
    }

    const history: ExerciseHistory = {}
    for (const [name, byDay] of Object.entries(exerciseDayBest)) {
      const rows = Object.entries(byDay)
        .map(([day, v]) => ({ day, ...v }))
        .sort((a, b) => a.day.localeCompare(b.day))
      let runningMax = 0
      history[name] = rows.map((r) => {
        const isPR = r.e1rm > runningMax
        if (isPR) runningMax = r.e1rm
        return { day: r.day, e1rm: r.e1rm, weight: r.weight, reps: r.reps, repTotal: r.repTotal, isPR }
      })
    }
    setHevyExerciseHistory(history)

    return { ok: true, days: [...days], stats }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export type HevySyncOutcome =
  | { ok: true; days: number; habitCount: number }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' | 'no-habit' }

/** Fetch, then tick. The one function both the Settings button and the
 *  once-a-day check call, so "Sync now" and the automatic run can never
 *  drift into two different ideas of what syncing means.
 *
 *  markHabitDaysOn is the SAME write a manual click makes, one date at a
 *  time (store.tsx's markDayOn), just batched into one state update so a
 *  backfill of many days cannot lose all but the last of them to a stale
 *  closure -- there is no separate "auto" flag or locked state here, on his
 *  instruction: Hevy PROPOSES a tick, his own click always still wins, on
 *  or off, because it runs through the identical underlying write. Only
 *  ever turns a day ON; a workout he later deletes from Hevy does not
 *  reach back and untick a day he may have already confirmed by hand for
 *  other reasons. */
export async function syncHevy(
  habits: HabitDef[],
  markHabitDaysOn: (id: string, days: string[], value: boolean) => void,
): Promise<HevySyncOutcome> {
  /* His ask (2026-09-18): one sync request should cover both training
     sources, so the Cookie Jar never shows a workout from one and not the
     other. Started here, not awaited -- Intervals can take up to three
     minutes and Hevy's own answer should not wait on it. */
  syncHealth()
  const res = await fetchHevyWorkoutDays()
  if (!res.ok) return res
  const targets = habits.filter((h) => h.name.trim().toLowerCase() === TARGET_HABIT_NAME)
  if (!targets.length) return { ok: false, reason: 'no-habit' }
  for (const h of targets) markHabitDaysOn(h.id, res.days, true)
  setHevyStats(res.stats)
  setHevyLastSync(Date.now())
  return { ok: true, days: res.days.length, habitCount: targets.length }
}
