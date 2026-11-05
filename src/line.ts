/* THE LINE (2026-11-05). Plan's second view: the day hour by hour, the way the
   Structured app draws it, which he picked over a separate page or a widget.
   This file is the arithmetic both shells share, so the desktop and the Nothing
   phone can never disagree about where a task sits.

   A task with a clock time (`at`) sits at that time. A task without one is
   flexible: it flows into the first free stretch of its part of the day, and on
   today never earlier than now, so the Line always reads as what is left.
   Dragging a task gives it a time. Pinned tasks it then overlaps slide later,
   in a chain; flexible ones simply flow around it on the next layout. */
import { SLOTS } from './types'

export interface LineIn {
  id: string
  at?: string | null
  slot?: string | null
  done: boolean
  /** Minutes, 0 when there is no estimate yet. */
  min: number
}
export interface LineItem<T> {
  id: string
  /** Start, minutes after midnight. */
  s: number
  /** Length drawn, minutes. A task with no estimate is drawn as NO_EST_MIN. */
  d: number
  pinned: boolean
  /** True when the length is the stand-in, not his estimate. */
  guess: boolean
  t: T
}

export const NO_EST_MIN = 30
export const DAY_END = 24 * 60
const ANYTIME_FROM = 8 * 60

export const toHM = (m: number): string => {
  const c = Math.max(0, Math.min(DAY_END - 1, Math.round(m)))
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`
}
const fromHM = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Lay one day out. `now` is minutes after midnight on today, null on any other day. */
export function layoutDay<T extends LineIn>(list: T[], now: number | null): LineItem<T>[] {
  const busy: [number, number][] = []
  const out: LineItem<T>[] = []
  const take = (t: T, s: number, pinned: boolean) => {
    const guess = !(t.min > 0)
    const d = guess ? NO_EST_MIN : t.min
    out.push({ id: t.id, s, d, pinned, guess, t })
    busy.push([s, s + d])
  }
  list.filter((t) => t.at).forEach((t) => take(t, fromHM(t.at!), true))
  const fits = (s: number, d: number) => busy.every(([a, b]) => s + d <= a || s >= b)
  const firstFree = (from: number, d: number) => {
    let s = from
    for (let i = 0; i < 200; i++) {
      if (fits(s, d)) return s
      s = Math.max(s + 5, ...busy.filter(([a, b]) => s < b && s + d > a).map(([, b]) => b))
    }
    return s
  }
  const rank = (t: T) => { const i = SLOTS.findIndex((x) => x.id === t.slot); return i < 0 ? SLOTS.length : i }
  const nowFrom = now == null ? 0 : Math.ceil(now / 5) * 5
  list.filter((t) => !t.at)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.done) - Number(a.t.done) || rank(a.t) - rank(b.t) || a.i - b.i)
    .forEach(({ t }) => {
      const sl = SLOTS.find((x) => x.id === t.slot)
      let from = sl ? sl.from * 60 : ANYTIME_FROM
      if (!t.done && now != null) from = Math.max(from, nowFrom)
      take(t, firstFree(from, t.min > 0 ? t.min : NO_EST_MIN), false)
    })
  return out.sort((a, b) => a.s - b.s || Number(b.pinned) - Number(a.pinned))
}

/** Where a drop lands and what it pushes. Returns the clock times to write:
 *  the moved task first, then every pinned task that had to slide later. */
export function placeAt<T>(items: LineItem<T>[], id: string, start: number, d: number): { id: string; at: string }[] {
  const s0 = Math.max(0, Math.min(DAY_END - 15, Math.round(start / 5) * 5))
  const writes = [{ id, at: toHM(s0) }]
  let end = s0 + d
  /* Only tasks with a set time take part: a flexible one flows around whatever
     lands, on the next layout, so it must not push anything itself. */
  items.filter((x) => x.id !== id && x.pinned && x.s >= s0).sort((a, b) => a.s - b.s).forEach((x) => {
    if (x.s < end) {
      const ns = Math.min(DAY_END - 15, end)
      writes.push({ id: x.id, at: toHM(ns) })
      end = ns + x.d
    } else end = Math.max(end, x.s + x.d)
  })
  return writes
}

/** The free stretches between items, for drawing gaps and offering slots. */
export function gapsOf<T>(items: LineItem<T>[], min = 15): { s: number; e: number }[] {
  const g: { s: number; e: number }[] = []
  for (let i = 0; i < items.length - 1; i++) {
    const e = items[i].s + items[i].d
    const n = Math.max(...items.slice(0, i + 1).map((x) => x.s + x.d))
    if (items[i + 1].s - n >= min) g.push({ s: Math.max(e, n), e: items[i + 1].s })
  }
  return g
}

/** The first free start at or after `from` that holds `d` minutes, or null. */
export function nextFree<T>(items: LineItem<T>[], d: number, from: number): number | null {
  let s = Math.ceil(from / 5) * 5
  const sorted = [...items].sort((a, b) => a.s - b.s)
  for (const x of sorted) {
    if (x.s + x.d <= s) continue
    if (x.s - s >= d) return s
    s = Math.max(s, x.s + x.d)
  }
  return s + d <= DAY_END ? s : null
}
