/* Reading an iCalendar feed, so the app can draw the day itself.

   Google will not let a browser fetch this: its ICS endpoints answer 200 with
   no access-control-allow-origin, so a page on github.io is blocked before it
   sees a byte. Measured, not assumed. The feed is therefore fetched by a
   Supabase function and this file parses what comes back, which also keeps the
   calendar's secret address off a public repo.

   Deliberately a SUBSET of RFC 5545, and it says so rather than pretending:
   enough for a work calendar (all-day and timed events, folded lines, escaped
   text, and the recurrence rules a standup or a sprint review actually uses).
   Anything it cannot read it drops rather than guesses at, because a wrong
   meeting time is worse than a missing one. */

export interface CalEvent {
  /** The event's own id from the feed, stable across refetches. It is what
   *  lets a meeting note be tied to its meeting, so the app can tell a meeting
   *  he has already written up from one he has not. */
  uid: string
  /** Local date key, YYYY-MM-DD. */
  day: string
  /** Minutes from midnight, or null for an all-day event. */
  start: number | null
  end: number | null
  title: string
  where?: string
  allDay: boolean
  /** Everyone invited, organiser first, by the name the calendar shows. A
   *  bare mailbox is used only when there is no CN to use instead. */
  people: string[]
  /** The call. Google puts it in X-GOOGLE-CONFERENCE, and older invitations
   *  bury it in the description, so both are read. */
  link?: string
}

/** RFC 5545 line folding: a continuation line starts with a space or tab. */
function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1)
    else out.push(raw)
  }
  return out
}

const unescape = (v: string) =>
  v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\')

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A DTSTART/DTEND value. Dates are floating; datetimes may be UTC (trailing Z)
 *  or carry a TZID. Without a full timezone database the only honest options
 *  are UTC and the viewer's own clock, so a TZID is read as local: the app runs
 *  in Prague on a calendar kept in Prague, and pretending to more precision
 *  than that would be a lie with a clock on it. */
function parseWhen(value: string, params: Record<string, string>): { at: Date; allDay: boolean } | null {
  const v = value.trim()
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (dateOnly || params.VALUE === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v)
    if (!m) return null
    return { at: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true }
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v)
  if (!dt) return null
  const [, y, mo, d, h, mi, s, z] = dt
  const at = z
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return { at, allDay: false }
}

interface Raw {
  uid: string
  start: Date
  end: Date | null
  allDay: boolean
  title: string
  where?: string
  rrule?: string
  exdates: Set<string>
  people: string[]
  link?: string
  description?: string
}

/** Every VEVENT in the feed, before recurrence is expanded. */
function readEvents(ics: string): Raw[] {
  const out: Raw[] = []
  let cur: Partial<Raw> | null = null
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set(), people: [] }; continue }
    if (line === 'END:VEVENT') {
      if (cur?.start && cur.title) out.push(cur as Raw)
      cur = null
      continue
    }
    if (!cur) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const [name, ...rest] = left.split(';')
    const params: Record<string, string> = {}
    for (const r of rest) {
      const eq = r.indexOf('=')
      if (eq > 0) params[r.slice(0, eq).toUpperCase()] = r.slice(eq + 1).replace(/"/g, '')
    }
    switch (name.toUpperCase()) {
      case 'DTSTART': { const w = parseWhen(value, params); if (w) { cur.start = w.at; cur.allDay = w.allDay } break }
      case 'DTEND': { const w = parseWhen(value, params); if (w) cur.end = w.at; break }
      case 'SUMMARY': cur.title = unescape(value).trim(); break
      case 'LOCATION': cur.where = unescape(value).trim() || undefined; break
      case 'RRULE': cur.rrule = value.trim(); break
      case 'UID': cur.uid = value.trim(); break
      case 'DESCRIPTION': cur.description = unescape(value); break
      case 'X-GOOGLE-CONFERENCE': cur.link = value.trim(); break
      /* The organiser leads the list, because "who called this" is the first
         thing worth knowing when the note is opened again in a month. */
      case 'ORGANIZER': { const who = person(params, value); if (who) cur.people!.unshift(who); break }
      case 'ATTENDEE': {
        const who = person(params, value)
        /* Rooms and equipment are resources, not people, and a note that lists
           "Meeting room 2" among the attendees is a note nobody trusts. */
        if (who && (params.CUTYPE ?? 'INDIVIDUAL').toUpperCase() === 'INDIVIDUAL' && !cur.people!.includes(who)) {
          cur.people!.push(who)
        }
        break
      }
      case 'EXDATE': {
        for (const one of value.split(',')) {
          const w = parseWhen(one, params)
          if (w) cur.exdates!.add(dayKey(w.at))
        }
        break
      }
      /* A cancelled instance of a recurring event. Kept simple: the whole day
         is excluded, which is right for the case that actually happens (a
         standup called off) and wrong only for two copies of one event on one
         day, which a work calendar does not do. */
      case 'STATUS': if (value.trim().toUpperCase() === 'CANCELLED') cur.title = ''; break
      default: break
    }
  }
  return out
}

/** A display name for one ATTENDEE or ORGANIZER line. The CN parameter when
 *  there is one, otherwise the mailbox with the scheme stripped. */
function person(params: Record<string, string>, value: string): string | null {
  const cn = (params.CN ?? '').trim()
  if (cn) return cn
  const mail = value.trim().replace(/^mailto:/i, '')
  return mail && mail.includes('@') ? mail : null
}

/** The first call link in a block of text. Google buries it in the description
 *  on older invitations, so this is the fallback when there is no
 *  X-GOOGLE-CONFERENCE property. */
function linkIn(text?: string): string | undefined {
  if (!text) return undefined
  const m = text.match(/https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|[\w.-]*whereby\.com)\/[^\s>"']+/i)
  return m ? m[0] : undefined
}

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** Instances of one event that fall inside [from, to]. Supports the rules a
 *  working calendar uses: DAILY, WEEKLY (with BYDAY), MONTHLY on the same date,
 *  and YEARLY, each with INTERVAL, COUNT and UNTIL. Anything else yields the
 *  single original occurrence rather than a guess. */
function occurrences(e: Raw, from: Date, to: Date): Date[] {
  const within = (d: Date) => d >= from && d <= to
  if (!e.rrule) return within(e.start) ? [e.start] : []
  const p: Record<string, string> = {}
  for (const part of e.rrule.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) p[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
  }
  const freq = (p.FREQ ?? '').toUpperCase()
  const interval = Math.max(1, Number(p.INTERVAL ?? 1))
  const count = p.COUNT ? Number(p.COUNT) : Infinity
  const until = p.UNTIL ? parseWhen(p.UNTIL, {})?.at ?? null : null
  const byDay = p.BYDAY ? p.BYDAY.split(',').map((d) => d.slice(-2).toUpperCase()) : null
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return within(e.start) ? [e.start] : []

  const out: Date[] = []
  const cur = new Date(e.start)
  let made = 0
  /* Bounded hard. A feed with a broken UNTIL must not spin: two years of daily
     instances is far more than any view asks for, and stopping is better than
     hanging on his dashboard. */
  for (let guard = 0; guard < 800 && made < count; guard++) {
    if (until && cur > until) break
    if (cur > to) break
    if (freq === 'WEEKLY' && byDay) {
      /* Every named weekday in this week, then jump INTERVAL weeks. */
      const monday = new Date(cur)
      monday.setDate(cur.getDate() - ((cur.getDay() + 6) % 7))
      for (const code of byDay) {
        const idx = DAYS.indexOf(code)
        if (idx < 0) continue
        const d = new Date(monday)
        d.setDate(monday.getDate() + idx)
        d.setHours(e.start.getHours(), e.start.getMinutes(), 0, 0)
        if (d < e.start) continue
        if (until && d > until) continue
        if (within(d) && !e.exdates.has(dayKey(d))) out.push(new Date(d))
        made++
        if (made >= count) break
      }
      cur.setDate(cur.getDate() + 7 * interval)
      continue
    }
    if (within(cur) && !e.exdates.has(dayKey(cur))) out.push(new Date(cur))
    made++
    if (freq === 'DAILY') cur.setDate(cur.getDate() + interval)
    else if (freq === 'WEEKLY') cur.setDate(cur.getDate() + 7 * interval)
    else if (freq === 'MONTHLY') cur.setMonth(cur.getMonth() + interval)
    else cur.setFullYear(cur.getFullYear() + interval)
  }
  return out
}

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

/**
 * Every event between two dates, flattened to one row per day, sorted.
 * All-day events come first within a day, then by start time.
 */
export function parseIcs(ics: string, from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = []
  for (const e of readEvents(ics)) {
    if (!e.title) continue
    const len = e.end ? e.end.getTime() - e.start.getTime() : 0
    for (const at of occurrences(e, from, to)) {
      const end = len > 0 ? new Date(at.getTime() + len) : null
      out.push({
        uid: e.uid || `${e.title}|${dayKey(at)}`,
        day: dayKey(at),
        start: e.allDay ? null : minutesOf(at),
        /* An all-day event's DTEND is exclusive, and a timed one that runs past
           midnight is clamped to the day it started, because this renders one
           day at a time and a bar that leaves the bottom of the strip says
           nothing useful. */
        end: e.allDay || !end ? null : Math.min(24 * 60, minutesOf(end) || 24 * 60),
        title: e.title,
        where: e.where,
        allDay: e.allDay,
        people: e.people,
        link: e.link ?? linkIn(e.description) ?? linkIn(e.where),
      })
    }
  }
  return out.sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : (a.start ?? -1) - (b.start ?? -1))
}
