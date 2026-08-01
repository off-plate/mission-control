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

/** Calendar month key, e.g. '2026-07'. Drives the monthly review window. */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Is an ISO date inside the given month key? */
export function inMonth(iso: string, key = monthKey()): boolean {
  return iso.slice(0, 7) === key
}

/** 'July 2026', for naming the window a monthly review covers. */
export function monthName(key = monthKey()): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/* ---------- goal periods ---------- */

export type GoalTf = 'weekly' | 'monthly' | 'quarter' | 'half'

/** The period a goal set today belongs to. A goal for this week is for THIS
 *  week, not for a rolling seven days that never ends. */
export function goalPeriodKey(tf: GoalTf, now = new Date()): string {
  if (tf === 'weekly') return isoWeekKey(now)
  if (tf === 'monthly') return monthKey(now)
  if (tf === 'quarter') return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
  return `${now.getFullYear()}-H${now.getMonth() < 6 ? 1 : 2}`
}

/** The dates a goal period covers, so its progress can be counted inside it. */
export function goalPeriodRange(tf: GoalTf, key: string): DateRange {
  const iso2 = (d: Date) => localDateKey(d)
  if (tf === 'weekly') {
    const [y, w] = key.split('-W').map(Number)
    // Monday of ISO week w: the Monday on or before 4 January, plus w-1 weeks.
    const jan4 = new Date(y, 0, 4)
    const mon = new Date(jan4)
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { id: key, label: `week of ${fmtDayShort(mon)}`, from: iso2(mon), to: iso2(sun) }
  }
  if (tf === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    return { id: key, label: monthName(key), from: iso2(new Date(y, m - 1, 1)), to: iso2(new Date(y, m, 0)) }
  }
  if (tf === 'quarter') {
    const [y, q] = key.split('-Q').map(Number)
    const start = new Date(y, (q - 1) * 3, 1)
    return { id: key, label: `Q${q} ${y}`, from: iso2(start), to: iso2(new Date(y, q * 3, 0)) }
  }
  const [y, h] = key.split('-H').map(Number)
  const start = new Date(y, h === 1 ? 0 : 6, 1)
  return { id: key, label: `${h === 1 ? 'first' : 'second'} half of ${y}`, from: iso2(start), to: iso2(new Date(y, h === 1 ? 6 : 12, 0)) }
}

/**
 * WHICH week, month, quarter or half this is, with dates. "This week" and "This
 * quarter" name a position relative to now and nothing else: three weeks later
 * the same words describe a different period, and a goal you set in July read
 * identically to one set in September. The label was also hardcoded ("Q3 2026",
 * "by year end"), so it would have been wrong from October onwards.
 */
export function periodLabel(tf: GoalTf, key = goalPeriodKey(tf)): string {
  const r = goalPeriodRange(tf, key)
  const d = (iso: string) => {
    const [y, m, day] = iso.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  if (tf === 'weekly') return `${d(r.from)} to ${d(r.to)}`
  if (tf === 'monthly') return monthName(key)
  if (tf === 'quarter') {
    const [qy, q] = key.split('-Q')
    return `Q${q} ${qy}, ${d(r.from)} to ${d(r.to)}`
  }
  const [y, h] = key.split('-H')
  return `${h === '1' ? 'first' : 'second'} half of ${y}, ${d(r.from)} to ${d(r.to)}`
}

/** Has this goal's period already ended? */
export function periodIsPast(tf: GoalTf, key: string, now = new Date()): boolean {
  return goalPeriodRange(tf, key).to < localDateKey(now)
}

/* ---------- review windows ---------- */

export type RangeId = 'this-week' | 'last-week' | 'last-7' | 'last-14' | 'last-30' | 'this-month' | 'last-month' | 'last-90'

export interface DateRange { id: string; label: string; from: string; to: string }

const iso = (d: Date) => localDateKey(d)
const shift = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x }

/** The Monday of the week a date falls in. */
function mondayOf(d: Date): Date {
  return shift(d, -((d.getDay() + 6) % 7))
}

/**
 * Every window is a pair of dates, so one set of sections can report on any of
 * them. Nothing is computed per-window: the window is only ever an input.
 */
export function rangeFor(id: RangeId, now = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (id) {
    case 'this-week': {
      const mon = mondayOf(today)
      return { id, label: `This week, from ${fmtDayShort(mon)}`, from: iso(mon), to: iso(today) }
    }
    case 'last-week': {
      const mon = shift(mondayOf(today), -7)
      const sun = shift(mon, 6)
      return { id, label: `Last week, ${fmtDayShort(mon)} to ${fmtDayShort(sun)}`, from: iso(mon), to: iso(sun) }
    }
    case 'last-7': return { id, label: 'The last 7 days', from: iso(shift(today, -6)), to: iso(today) }
    case 'last-14': return { id, label: 'The last 14 days', from: iso(shift(today, -13)), to: iso(today) }
    case 'last-30': return { id, label: 'The last 30 days', from: iso(shift(today, -29)), to: iso(today) }
    case 'last-90': return { id, label: 'The last 90 days', from: iso(shift(today, -89)), to: iso(today) }
    case 'this-month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      return { id, label: monthName(monthKey(today)), from: iso(first), to: iso(today) }
    }
    case 'last-month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return { id, label: monthName(monthKey(first)), from: iso(first), to: iso(last) }
    }
  }
}

export const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'last-7', label: 'Last 7 days' },
  { id: 'last-14', label: 'Last 14 days' },
  { id: 'last-30', label: 'Last 30 days' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-90', label: 'Last 90 days' },
]

/** A specific calendar month, for the month list in the picker. */
export function monthRange(key: string): DateRange {
  const [y, m] = key.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0)
  const today = new Date()
  const end = last > today ? today : last
  return { id: key, label: monthName(key), from: iso(first), to: iso(end) }
}

/**
 * The months that actually hold something, newest first. Offering a fixed twelve
 * months lists empty ones he can only find out are empty by opening them, and
 * puts anything older than a year out of reach entirely.
 */
export function monthsWithData(days: string[], now = new Date()): string[] {
  const seen = new Set(days.filter(Boolean).map((d) => d.slice(0, 7)))
  seen.add(monthKey(now))
  return [...seen].sort().reverse()
}

/** Everything, from the first thing he logged to today. */
export function allTimeRange(days: string[], now = new Date()): DateRange {
  const first = days.filter(Boolean).sort()[0]
  const to = localDateKey(now)
  return { id: 'all-time', label: first ? `Everything, since ${fmtWhen(first)}` : 'Everything', from: first ?? to, to }
}

/** A hand-picked pair of dates. Either end may be missing while he is typing. */
export function customRange(from: string, to: string): DateRange {
  const [a, b] = from && to && from > to ? [to, from] : [from, to]
  return { id: 'custom', label: `${fmtWhen(a)} to ${fmtWhen(b)}`, from: a, to: b }
}

export function inRange(isoDate: string, r: DateRange): boolean {
  return isoDate >= r.from && isoDate <= r.to
}

/** How many days the window covers, so a total can be read against its length. */
export function rangeDays(r: DateRange): number {
  const [y1, m1, d1] = r.from.split('-').map(Number)
  const [y2, m2, d2] = r.to.split('-').map(Number)
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000) + 1
}

/** ISO date of day `i` (Mon=0..Sun=6) in the current week. */
export function dayOfWeekKey(i: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i)
  return localDateKey(d)
}

/** Mon=0..Sun=6 for an ISO date, matching the habit day array. */
export function dayIndexOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

/** The period a routine's checks belong to. When the key changes, the checks reset. */
export function periodKeyFor(cadence: RoutineCadence, d = new Date()): string {
  if (cadence === 'weekly') return isoWeekKey(d)
  if (cadence === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return localDateKey(d) // daily and prework reset every day
}

/**
 * The chances a routine had to be finished inside a window, one entry per period
 * it actually runs on. Drawing one square a day for a WEEKLY routine reported six
 * misses out of every seven, which is not a miss at all: those days were never
 * asked for. A weekly routine gets one square a week, a monthly one a month.
 */
export function routinePeriods(cadence: RoutineCadence, days: number, now = new Date()): { key: string; from: string; to: string; label: string }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = shift(today, -(days - 1))
  const out: { key: string; from: string; to: string; label: string }[] = []
  if (cadence === 'weekly') {
    for (const cur = mondayOf(start); cur <= today; cur.setDate(cur.getDate() + 7)) {
      const sun = shift(cur, 6)
      out.push({ key: isoWeekKey(cur), from: iso(cur), to: iso(sun), label: `week of ${fmtDayShort(cur)}` })
    }
    return out
  }
  if (cadence === 'monthly') {
    for (const cur = new Date(start.getFullYear(), start.getMonth(), 1); cur <= today; cur.setMonth(cur.getMonth() + 1)) {
      const key = monthKey(cur)
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
      out.push({ key, from: iso(cur), to: iso(last), label: monthName(key) })
    }
    return out
  }
  // Daily and prework both reset every day, so every day is its own chance.
  for (let i = 0; i < days; i++) {
    const d = shift(start, i)
    out.push({ key: iso(d), from: iso(d), to: iso(d), label: fmtWhen(iso(d)) })
  }
  return out
}

/** What one period of a routine is called, for reading a count against it. */
export function periodNoun(cadence: RoutineCadence, n: number): string {
  if (cadence === 'weekly') return n === 1 ? 'week' : 'weeks'
  if (cadence === 'monthly') return n === 1 ? 'month' : 'months'
  return n === 1 ? 'day' : 'days'
}

/** Render a stored ISO date (or legacy label) as a short human string. */
export function fmtWhen(when: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) return when
  const today = localDateKey()
  if (when === today) return 'today'
  const y = new Date(); y.setDate(y.getDate() - 1)
  if (when === localDateKey(y)) return 'yesterday'
  const [yy, mm, dd] = when.split('-').map(Number)
  // A date from another year has to say so. "14 Mar" for something in 2024 reads
  // as this March, which is worse than no date at all.
  const opts: Intl.DateTimeFormatOptions = yy === new Date().getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-GB', opts)
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

/** The window a counted habit's target is measured over. Weeks and months defer
 *  to the goal ranges so one definition of "this week" serves the whole app. */
export function habitPeriodRange(per: 'day' | 'week' | 'month', now = new Date()): { from: string; to: string } {
  if (per === 'day') { const d = localDateKey(now); return { from: d, to: d } }
  const tf = per === 'week' ? 'weekly' : 'monthly'
  return goalPeriodRange(tf, goalPeriodKey(tf, now))
}

/* ---------- routines on the day ---------- */

/** Where a routine sits in the day, taken from the habit it mirrors. */
export function slotForDaypart(daypart?: TimeSlot): TimeSlot | 'unsorted' {
  return daypart ?? 'unsorted'
}

/** Which part of the day a stored moment belongs to. A routine is filed under
 *  the time he actually started it, not the time it was meant to happen: the
 *  day should record what he did. It defers to slotForTime rather than
 *  repeating the boundaries, so a routine and a task can never disagree about
 *  where 2 PM lands. */
export function slotForMoment(iso: string): TimeSlot {
  const d = new Date(iso)
  return slotForTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
}
