/* His work calendar, read through the proxy and parsed here.

   The feed's own secret address never reaches this file, the browser or the
   repo: it lives in Supabase secrets and only the Edge Function ever sees it.
   Signed out, or with no function deployed, this reports that plainly instead
   of showing an empty week that looks like a free one, which is the more
   dangerous of the two lies. */

import { useEffect, useState } from 'react'
import { SUPABASE_ENABLED, callFunction } from './supabase'
import { parseIcs, type CalEvent } from './ical'

export type CalState =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'not-set-up' }
  | { status: 'error'; message: string }
  | { status: 'ok'; events: CalEvent[] }

/** How far ahead to read. A week is what the widget and the day view ask for. */
const DAYS_AHEAD = 8

export async function readCalendar(): Promise<CalState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  const r = await callFunction('calendar')
  if (!r.ok) {
    if (r.reason === 'off') return { status: 'off' }
    if (r.reason === 'signed-out') return { status: 'signed-out' }
    /* The function answers 503 with this exact sentence when no feed is
       configured, which is a setup step rather than a fault. */
    if ((r.message ?? '').includes('No calendar configured')) return { status: 'not-set-up' }
    return { status: 'error', message: r.message ?? 'Calendar could not be read.' }
  }
  if (!r.text.includes('BEGIN:VCALENDAR')) return { status: 'not-set-up' }
  const from = new Date(); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(from.getDate() + DAYS_AHEAD)
  return { status: 'ok', events: parseIcs(r.text, from, to) }
}

/** Reads once on open, then every ten minutes. A work calendar does not move
 *  faster than that, and the proxy caches for five, so this costs almost
 *  nothing on the free tier. */
export function useCalendar(): { state: CalState; reload: () => void } {
  const [state, setState] = useState<CalState>(SUPABASE_ENABLED ? { status: 'loading' } : { status: 'off' })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    let alive = true
    void readCalendar().then((s) => { if (alive) setState(s) })
    const t = window.setInterval(() => { void readCalendar().then((s) => { if (alive) setState(s) }) }, 600000)
    return () => { alive = false; window.clearInterval(t) }
  }, [n])
  return { state, reload: () => setN((x) => x + 1) }
}
