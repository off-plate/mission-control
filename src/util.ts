import type { RoutineCadence, Task, TimeSlot } from './types'

/* ---------- dates & periods ---------- */

/** Local (Prague) calendar date as 'YYYY-MM-DD'. Never UTC — the day must flip at his midnight. */
export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** ISO-8601 week key, e.g. '2026-W31'. Drives the weekly rollover. */
export function isoWeekKey(date = new Date()): string {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** The period a routine's checks belong to. When the key changes, the checks reset. */
export function periodKeyFor(cadence: RoutineCadence, d = new Date()): string {
  if (cadence === 'weekly') return isoWeekKey(d)
  if (cadence === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return localDateKey(d) // daily and prework reset every day
}

/** Render a stored ISO date (or legacy label) as a short human string. */
export function fmtWhen(when: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) return when
  const today = localDateKey()
  if (when === today) return 'today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (when === localDateKey(y)) return 'yesterday'
  const [yy, mm, dd] = when.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Next occurrence of a weekday (1=Mon..7=Sun), always in the future. */
export function nextDow(dow: number, from = new Date()): Date {
  const d = new Date(from)
  const cur = ((d.getDay() + 6) % 7) + 1
  const add = ((dow - cur) + 7) % 7 || 7
  d.setDate(d.getDate() + add)
  return d
}

/** 'Fri 31 Jul' style label used across Money and the exception rows. */
export function fmtDayShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Last business day of the current month (tax transfers must beat the deadline). */
export function lastBusinessDayOfMonth(from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth() + 1, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d
}

/** 24h 'HH:MM' -> '5:30 PM' (Michael wants AM/PM, never 24h). */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

/** Same, but drops ':00' so full hours read '5 PM'. */
export function fmtTimeShort(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function slotForTime(hhmm: string): TimeSlot {
  const h = toMin(hhmm) / 60
  if (h < 12) return 'morning'
  if (h < 14) return 'noon'
  if (h < 18) return 'afternoon'
  return 'evening'
}

/** A task's real planned minutes: sum of subtasks when it has them, else its own
 *  estimate. Zero means "not estimated yet", never a guess standing in for one. */
export function taskMinutes(t: Task): number {
  if (t.subtasks && t.subtasks.length) return t.subtasks.reduce((a, s) => a + s.estimateMin, 0)
  return t.estimateMin
}

/** Has this task actually been estimated, or is a number just sitting on it?
 *  Steps count as an estimate; a bare minute value from an old default does not. */
export function isEstimated(t: Task): boolean {
  if (t.subtasks?.length) return true
  return t.estimated === true && t.estimateMin > 0
}

export function fmtDuration(min: number): string {
  const sign = min < 0 ? '-' : ''
  const a = Math.abs(min)
  const h = Math.floor(a / 60)
  const m = a % 60
  if (h && m) return `${sign}${h}h ${m}m`
  if (h) return `${sign}${h}h`
  return `${sign}${m}m`
}

/**
 * Is a goal keeping pace, judged against how much of its window has elapsed
 * rather than a flat percentage. A weekly goal at 0 of 3 on Monday morning is
 * not "behind", it has barely started; calling that failure is the guilt
 * mechanic this app is supposed to avoid. Only fall behind when the pace you
 * would now need is meaningfully worse than the pace you signed up for.
 */
export function goalPace(
  current: number,
  target: number,
  timeframe: 'weekly' | 'monthly' | 'quarter' | 'half' = 'quarter',
  now = new Date(),
): 'done' | 'ontrack' | 'behind' {
  if (target <= 0 || current >= target) return current >= target ? 'done' : 'ontrack'
  const elapsed = (() => {
    if (timeframe === 'weekly') return (((now.getDay() + 6) % 7) + 1) / 7
    if (timeframe === 'monthly') {
      const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      return now.getDate() / days
    }
    if (timeframe === 'quarter') {
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
      const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0)
      return (now.getTime() - qStart.getTime()) / (qEnd.getTime() - qStart.getTime())
    }
    const hStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1)
    const hEnd = new Date(hStart.getFullYear(), hStart.getMonth() + 6, 0)
    return (now.getTime() - hStart.getTime()) / (hEnd.getTime() - hStart.getTime())
  })()
  const done = current / target
  // A quarter of the window of slack before anything is called behind.
  return done + 0.25 >= Math.min(1, elapsed) ? 'ontrack' : 'behind'
}

/** Czech thousands spacing, so 60000 reads 60 000 everywhere it appears. */
export function fmtNum(n: number): string {
  return n.toLocaleString('cs-CZ').replace(/ /g, ' ')
}

/** Signed h/m for "time saved", where a negative total means you ran over. */
export function fmtSigned(min: number): string {
  const a = Math.abs(min)
  return `${min < 0 ? '-' : ''}${Math.floor(a / 60)}h ${a % 60}m`
}

/**
 * Deep-link into Google Calendar. With a start time it opens the event-create
 * template pre-filled with the title and today's time block (so "schedule this
 * task" genuinely lands in Calendar). Without one it opens the day view.
 */
export function gcalUrl(title: string, start?: string, end?: string): string {
  const base = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}`
  if (!start) return 'https://calendar.google.com/calendar/u/0/r/day'
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const clock = (t: string) => t.replace(':', '') + '00'
  const s = `${ymd}T${clock(start)}`
  const e = `${ymd}T${clock(end ?? start)}`
  return `${base}&dates=${s}/${e}`
}
