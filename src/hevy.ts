/* Hevy connection. The same shape as ai.ts's Groq key: kept in localStorage on
   this device only, never synced, never in the repo, so a public codebase
   never carries it.

   What this reaches for: which local dates had a workout logged in Hevy, full
   history on the first connect. Nothing here writes to Hevy -- Jarvis's own
   automation already owns the write side (routines, autoregulation); this is
   read-only, for one purpose, ticking the Workout / Gym / Fitness habit and,
   later, the Timeline's Health column. */

import type { HabitDef } from './types'

const KEY_STORE = 'mc-hevy-key'
/* When this device last actually called Hevy, so the once-a-day check does
   not re-fetch on every visibility change. A per-device fact like the key
   itself, not app data, so it stays out of the synced blob on purpose --
   another device syncing does no harm to re-check on its own clock. */
const LAST_SYNC_STORE = 'mc-hevy-last-sync'
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

interface HevyWorkout { start_time?: string }
interface HevyWorkoutsPage { workouts?: HevyWorkout[]; page_count?: number }

export type HevySyncResult =
  | { ok: true; days: string[] }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

/** Every local date (YYYY-MM-DD) that has at least one workout logged in
 *  Hevy. Hevy has no since-date filter on this endpoint, so every sync pages
 *  through the full history -- the same cost on day one (a real backfill)
 *  and on the thousandth day. Cheap enough at once-a-day cadence that it was
 *  not worth the bug surface of a partial, since-last-sync fetch. */
export async function fetchHevyWorkoutDays(): Promise<HevySyncResult> {
  const key = getHevyKey()
  if (!key) return { ok: false, reason: 'no-key' }
  const days = new Set<string>()
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
        const d = new Date(w.start_time)
        if (Number.isNaN(d.getTime())) continue
        days.add(localDay(d))
      }
      if (workouts.length === 0 || page >= (data.page_count ?? 1)) break
    }
    return { ok: true, days: [...days] }
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
  const res = await fetchHevyWorkoutDays()
  if (!res.ok) return res
  const targets = habits.filter((h) => h.name.trim().toLowerCase() === TARGET_HABIT_NAME)
  if (!targets.length) return { ok: false, reason: 'no-habit' }
  for (const h of targets) markHabitDaysOn(h.id, res.days, true)
  setHevyLastSync(Date.now())
  return { ok: true, days: res.days.length, habitCount: targets.length }
}
