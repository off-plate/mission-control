import type { Task, TimeSlot } from './types'

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

/** A task's real planned minutes: sum of subtasks when it has them, else its own estimate. */
export function taskMinutes(t: Task): number {
  if (t.subtasks && t.subtasks.length) return t.subtasks.reduce((a, s) => a + s.estimateMin, 0)
  return t.estimateMin
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
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
