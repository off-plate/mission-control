/* His work calendar, read through the proxy and kept in one place.

   The feed's own secret address never reaches this file, the browser or the
   repo: it lives in Supabase secrets and only the Edge Function ever sees it.
   Signed out, or with no function deployed, this reports that plainly instead
   of showing an empty week that looks like a free one, which is the more
   dangerous of the two lies.

   ONE store, not one per caller. Six components read this calendar (Today's
   band, the agenda tile, the assistant twice, the meeting prompt, the page)
   and every one of them used to run its own fetch and its own ten-minute
   timer. Six cold calls to a function that pulls 4.8 MB from Google and parses
   5,462 events is the twenty seconds he waits at an empty page. Now the first
   subscriber starts one read, the rest attach to it, and they all see the same
   answer at the same moment.

   And the answer survives a reload. The last good read is kept on the device,
   so the page draws his day immediately and the network only ever adds or
   removes from what is already on screen. A calendar that is briefly a few
   minutes old is worth far more than a blank one that is perfectly correct in
   twenty seconds. */

import { useCallback, useSyncExternalStore } from 'react'
import { SUPABASE_ENABLED, callFunction } from './supabase'
import { localDateKey } from './util'
import type { CalEvent } from './ical'

export type CalState =
  | { status: 'off' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'not-set-up' }
  | { status: 'error'; message: string }
  /** `readAt` is when the feed was last read, epoch ms. `problem` is set when
   *  a later read failed and these events are what we still hold: the page
   *  keeps showing them and says the refresh did not land. */
  | { status: 'ok'; events: CalEvent[]; readAt: number; problem?: string }

const safeJson = (t: string): unknown => { try { return JSON.parse(t) } catch { return null } }

/** How far ahead to read. A month, because the grid draws a month; the
 *  function clamps at 31 and answers with a few kilobytes either way. */
const DAYS_AHEAD = 31

/** Re-read in the background at this age, on wake or on mount. */
const STALE_MS = 120_000
/** And on a timer while the app is open. A work calendar does not move faster. */
const POLL_MS = 600_000
/** Older than this and the cache is not worth drawing: too much of its window
 *  has already gone past for it to describe today. */
const CACHE_MAX_MS = 36 * 3600_000

export async function readCalendar(): Promise<CalState> {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  const r = await callFunction(`calendar?days=${DAYS_AHEAD}`)
  if (!r.ok) {
    if (r.reason === 'off') return { status: 'off' }
    if (r.reason === 'signed-out') return { status: 'signed-out' }
    /* The function answers 503 with this exact sentence when no feed is
       configured, which is a setup step rather than a fault. */
    if ((r.message ?? '').includes('No calendar configured')) return { status: 'not-set-up' }
    return { status: 'error', message: r.message ?? 'Calendar could not be read.' }
  }
  /* The function parses and trims; this only reads what it sent. Dates come
     back as plain strings and minute counts, so nothing needs reviving.
     A string is accepted too, in case the function is ever redeployed with a
     different content-type: it costs one line and saves a silent outage. */
  const raw = typeof r.data === 'string' ? safeJson(r.data) : r.data
  const body = raw as { events?: CalEvent[] } | null
  if (!body || !Array.isArray(body.events)) return { status: 'not-set-up' }
  return { status: 'ok', events: body.events, readAt: Date.now() }
}

/* ---------------- what is still worth looking at ---------------- */

/** An event stays on the list for an hour after it ends.
 *
 *  His words, and the reason this exists: at eight in the evening the page was
 *  still leading with a half past five in the morning. What is behind him is
 *  not what he opened the calendar for. An hour of grace is there because the
 *  meeting that just finished is the one he still has to write up. */
export const GRACE_MIN = 60

export function stillAhead(e: CalEvent, now = new Date(), graceMin = GRACE_MIN): boolean {
  const today = localDateKey(now)
  if (e.day !== today) return e.day > today
  /* An all-day entry is true for the whole day it names, so it stands until
     the day does. */
  if (e.allDay || e.start === null) return true
  const end = e.end ?? e.start + 60
  return end > now.getHours() * 60 + now.getMinutes() - graceMin
}

/** Everything from an hour ago onward, in the order it happens. All-day
 *  entries lead their day: they are the frame the timed ones sit inside. */
export function ahead(events: CalEvent[], now = new Date(), graceMin = GRACE_MIN): CalEvent[] {
  return events
    .filter((e) => stillAhead(e, now, graceMin))
    .sort((a, b) => (a.day === b.day ? (a.start ?? -1) - (b.start ?? -1) : a.day < b.day ? -1 : 1))
}

/* ---------------- the store ---------------- */

const CACHE_KEY = 'mc-calendar-read-v1'

function loadCache(): { events: CalEvent[]; readAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as { events?: unknown; readAt?: unknown }
    if (!Array.isArray(c.events) || typeof c.readAt !== 'number') return null
    if (Date.now() - c.readAt > CACHE_MAX_MS) return null
    return { events: c.events as CalEvent[], readAt: c.readAt }
  } catch { return null }
}

function saveCache(events: CalEvent[], readAt: number): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ events, readAt })) } catch { /* full or blocked; the app works without it */ }
}

/* Cleared, not kept, the moment the answer is that he is signed out or that
   there is no feed. A cache is a convenience, and holding meeting titles for
   an account that is no longer signed in is not one. */
function dropCache(): void {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* nothing to do */ }
}

function boot(): CalState {
  if (!SUPABASE_ENABLED) return { status: 'off' }
  const c = loadCache()
  return c ? { status: 'ok', events: c.events, readAt: c.readAt } : { status: 'loading' }
}

/* One frozen object per change, because useSyncExternalStore compares
   snapshots by identity and a fresh object every call is an infinite render. */
let view: { state: CalState; reading: boolean } = { state: boot(), reading: false }
const listeners = new Set<() => void>()

function publish(state: CalState, reading: boolean): void {
  view = { state, reading }
  for (const f of [...listeners]) f()
}

let inFlight: Promise<void> | null = null

/** Read the feed. Callers share one request: a second call while one is in the
 *  air waits on that one rather than starting another. */
export function refreshCalendar(force = false): Promise<void> {
  if (inFlight) return inFlight
  if (!SUPABASE_ENABLED) { if (view.state.status !== 'off') publish({ status: 'off' }, false); return Promise.resolve() }
  const s = view.state
  if (!force && s.status === 'ok' && Date.now() - s.readAt < STALE_MS) return Promise.resolve()
  publish(s, true)
  inFlight = readCalendar()
    .then((next) => {
      const held = view.state
      if (next.status === 'ok') {
        saveCache(next.events, next.readAt)
        publish(next, false)
        return
      }
      if (next.status === 'signed-out' || next.status === 'off' || next.status === 'not-set-up') {
        /* A real answer about access or setup replaces what we hold. */
        dropCache()
        publish(next, false)
        return
      }
      /* A failed read is a network fact, not a calendar fact. Keep his day on
         screen and say the refresh did not land. */
      if (held.status === 'ok') publish({ ...held, problem: next.status === 'error' ? next.message : undefined }, false)
      else publish(next, false)
    })
    .catch(() => {
      const held = view.state
      if (held.status === 'ok') publish({ ...held, problem: 'Calendar could not be read.' }, false)
      else publish({ status: 'error', message: 'Calendar could not be read.' }, false)
    })
    .finally(() => { inFlight = null })
  return inFlight
}

const onWake = (): void => { if (document.visibilityState === 'visible') void refreshCalendar() }

let timer = 0

function subscribe(f: () => void): () => void {
  listeners.add(f)
  if (listeners.size === 1) {
    /* Off the current task: subscribe runs inside React's commit, and a read
       that resolves from cache would otherwise publish to a listener React has
       not finished registering. */
    queueMicrotask(() => { void refreshCalendar() })
    timer = window.setInterval(() => { void refreshCalendar(true) }, POLL_MS)
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
  }
  return () => {
    listeners.delete(f)
    if (listeners.size === 0) {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }
}

const getSnapshot = () => view

/** The shared calendar. Every caller sees the same read, and after the first
 *  one it is on screen before the network is asked anything. `reading` is for
 *  saying so on a refresh button; it is never a reason to blank the page. */
export function useCalendar(): { state: CalState; reload: () => void; reading: boolean } {
  const v = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const reload = useCallback(() => { void refreshCalendar(true) }, [])
  return { state: v.state, reload, reading: v.reading }
}

