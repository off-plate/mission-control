import { useMemo } from 'react'
import { dayOf, useHealth } from '../health'
import { getHevyStatsForDay } from '../hevy'

export const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`

export const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')

/** A workout is usually under an hour; hm()'s "0h 52m" is the wrong shape
 *  for it. Drops the hour entirely when there is none. */
export const wm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)}m`)

/** Length and volume for a stretch of days.
 *
 *  TWO SOURCES, and they carry different things. Hevy's own cache is
 *  device-local (see STATS_STORE in hevy.ts) and is the only one that knows
 *  VOLUME, because Intervals never sees the weight on the bar. Intervals
 *  knows the minutes for every session, on every device, which Hevy only
 *  knows on the machine it synced to.
 *
 *  So: Hevy wins where it has the day, because it says more. Where it does
 *  not, the real session minutes still show. Fixed 2026-09-12, immediately
 *  after his report -- the pass before this one made Intervals sessions count
 *  as workout days but left the read-out on Hevy alone, so every day that came
 *  from Intervals collapsed to a bare "worked out" with the time and the
 *  weight he was used to seeing gone. */
export function hevyDetail(days: string[], sessionMinutes?: Map<string, number>): { minutes: number; volumeKg: number } | null {
  let minutes = 0, volumeKg = 0, hit = false
  for (const day of days) {
    const s = getHevyStatsForDay(day)
    if (s) {
      hit = true
      minutes += s.minutes
      volumeKg += s.volumeKg
      continue
    }
    const mins = sessionMinutes?.get(day)
    if (mins != null && mins > 0) { hit = true; minutes += mins }
  }
  return hit ? { minutes, volumeKg } : null
}

/** Minutes per day from real sessions, for the two places that draw the
 *  health read-out. A hook rather than a prop drilled through Ladder and
 *  Flywheel to reach two leaves. */
export function useSessionMinutes(): Map<string, number> {
  const health = useHealth().state
  return useMemo(() => {
    const by = new Map<string, number>()
    if (health.status !== 'ok') return by
    for (const s of health.sessions) {
      const day = dayOf(s)
      if (!day || !s.moving_time) continue
      by.set(day, (by.get(day) ?? 0) + s.moving_time / 60)
    }
    return by
  }, [health])
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i
