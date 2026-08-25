import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { useCalendar, ahead } from './calendar'
import { Band } from './ui'
import { meetingNote, meetingUidOf } from './meetingnote'
import { spaceFolderId } from './types'
import { isoWeekKey, localDateKey } from './util'
import type { CalEvent } from './ical'

/* A month to point at, and the days themselves to read.

   Not a month grid alone. A month grid is for choosing a date, and he already
   knows what day it is; what he needs from a calendar inside this app is the
   answer to "what is coming, and did I write it down". So the grid is the
   index and the column beside it is the calendar, and the only thing this page
   does that Google Calendar does not is the button on every row.

   It starts at now, not at midnight. At eight in the evening this page used to
   open on a half past five alarm, which is a record of a day he has already
   lived. An event stays for an hour after it ends, because the one that just
   finished is the one he still has to write up, and then it goes. When today
   has nothing left, today is not drawn at all and the column opens on tomorrow.

   Nothing here can edit the calendar. It is a read of somebody else's system
   and it says so by having no way to change anything. */

/* Minutes from midnight, wrapped: a block that runs past midnight came back
   from the feed as 1463 and printed itself as 24:23. */
const HM = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/* Somebody types a link into a meeting title and the feed hands it over as a
   hundred and twenty characters of raw URL. Shown whole it wrapped over three
   lines and was not even clickable. Shown as the host it points at, it is one
   word and it opens. The full address is on the title attribute. */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g
function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const raw = m[0].replace(/[.,;:]+$/, '')
    let label = raw
    try { label = new URL(raw).hostname.replace(/^www\./, '') } catch { /* keep the raw text */ }
    out.push(
      <a className="cal-link" key={`${m.index}-${raw}`} href={raw} title={raw} target="_blank" rel="noreferrer">{label} ↗</a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : [text]
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const keyOf = (y: number, m: number, d: number) => localDateKey(new Date(y, m, d))

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  const [y, m, d] = day.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const diff = Math.round((new Date(y, m - 1, d).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000)
  if (diff === 1) return 'Tomorrow'
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' })
}

/** Six rows of seven, Monday first, covering the month and the days either
 *  side that share its weeks, each row carrying its ISO week number. */
function monthWeeks(y: number, m: number): { week: string; days: { key: string; d: number; inMonth: boolean; weekend: boolean }[] }[] {
  const first = new Date(y, m, 1)
  /* getDay() is Sunday-first; the grid is Monday-first, which is how a Czech
     calendar is read. */
  const lead = (first.getDay() + 6) % 7
  const weeks = []
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const dt = new Date(y, m, 1 - lead + w * 7 + i)
      days.push({ key: localDateKey(dt), d: dt.getDate(), inMonth: dt.getMonth() === m, weekend: i > 4 })
    }
    weeks.push({ week: isoWeekKey(new Date(y, m, 1 - lead + w * 7 + 3)).split('-W')[1], days })
  }
  return weeks
}

export function CalendarPage() {
  const { notes, addNote, setPage, openNote, space } = useStore()
  const { state, reload, reading } = useCalendar()
  const [madeFor, setMadeFor] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const today = localDateKey()
  /* The month word is only worth printing when the day is not in the month the
     grid beside it is already showing. */
  const thisMonth = Number(today.split('-')[1])

  /* The clock moves while the page is open, so what counts as past moves with
     it. A minute is fine: nothing here turns over faster. */
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000))
  useEffect(() => {
    const t = window.setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const [month, setMonth] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const stepMonth = (by: number) => setMonth((s) => { const d = new Date(s.y, s.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  /* Which meetings already have a note. Read off the notes themselves rather
     than kept as a second list, so it cannot fall out of step with what is
     actually written. */
  const written = useMemo(() => {
    const s = new Set<string>()
    for (const n of notes) { const uid = meetingUidOf(n.body); if (uid) s.add(uid) }
    return s
  }, [notes])

  const write = (e: CalEvent) => {
    const id = addNote(spaceFolderId(space), meetingNote(e))
    setMadeFor(e.uid)
    openNote(id)
    setPage('notes')
  }

  const events = state.status === 'ok' ? state.events : []

  /* Every day the feed knows about, for the dots. Unfiltered on purpose: the
     grid is a map of the month, and a day whose meetings have all been and
     gone still had them. */
  const marked = useMemo(() => new Set(events.map((e) => e.day)), [events])

  /** From an hour ago onward, grouped by day. */
  const byDay = useMemo(() => {
    void minute
    const m = new Map<string, CalEvent[]>()
    for (const e of ahead(events)) m.set(e.day, [...(m.get(e.day) ?? []), e])
    return [...m.entries()]
  }, [events, minute])


  /** Jump the column to a day, or to the first one after it that has anything.
   *  Everything the feed returned is already on the page, so this only ever
   *  scrolls; there is no range to widen first. */
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  const goTo = (day: string) => {
    setPicked(day)
    setJumpTo(day)
  }
  useEffect(() => {
    if (!jumpTo) return
    const target = byDay.find(([d]) => d >= jumpTo)?.[0]
    const el = target ? document.getElementById(`cal-${target}`) : null
    if (el) {
      /* Smooth for a short hop, instant for a long one. A month of his days is
         26,000px, so gliding to the far end took two seconds of everything he
         owns flying past, which reads as a fault rather than a movement. */
      const far = Math.abs(el.getBoundingClientRect().top) > window.innerHeight * 2
      el.scrollIntoView({ block: 'start', behavior: far ? 'auto' : 'smooth' })
    }
    setJumpTo(null)
  }, [jumpTo, byDay])

  /* Recomputed each render, and `minute` forces one every minute, so what
     counts as running moves with the clock while the page is open. */
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()

  return (
    <div className="page cal-page">
      <Band
        title="Calendar"
        actions={<button className="btn btn-quiet" onClick={reload} disabled={reading}>{reading ? 'Reading' : 'Refresh'}</button>}
      />

      {state.status === 'loading' && <div className="empty">Reading the calendar.</div>}
      {state.status === 'off' && <div className="empty">Sync is off, so the calendar cannot be read.</div>}
      {state.status === 'signed-out' && <div className="empty">Sign in to read the calendar.</div>}
      {state.status === 'not-set-up' && <div className="empty">No calendar feed connected yet.</div>}
      {state.status === 'error' && <div className="empty">Calendar could not be read. {state.message}</div>}

      {state.status === 'ok' && (
        <div className="cal-split">
          <aside className="cal-rail">
            <div className="cal-mhead">
              <span className="cal-mname">{new Date(month.y, month.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
              <span className="cal-steps">
                <button className="cal-step" onClick={() => stepMonth(-1)} aria-label="Previous month">‹</button>
                <button className="cal-step" onClick={() => stepMonth(1)} aria-label="Next month">›</button>
              </span>
            </div>

            <div className="cal-grid">
              <span className="cal-wd" aria-hidden="true" />
              {WEEKDAYS.map((w) => <span className="cal-wd" key={w}>{w}</span>)}
              {monthWeeks(month.y, month.m).map((row) => (
                <Fragment key={row.week + row.days[0].key}>
                  <span className="cal-wk mono">{row.week}</span>
                  {row.days.map((c) => {
                    const cls = ['cal-cell']
                    if (!c.inMonth) cls.push('is-out')
                    if (c.weekend) cls.push('is-weekend')
                    if (marked.has(c.key)) cls.push('has-events')
                    if (c.key === picked) cls.push('is-picked')
                    if (c.key === today) cls.push('is-today')
                    return (
                      <button className={cls.join(' ')} key={c.key} onClick={() => goTo(c.key)} aria-label={c.key}>
                        <span className="cal-cell-n mono">{c.d}</span>
                      </button>
                    )
                  })}
                </Fragment>
              ))}
            </div>

            {state.problem && <p className="cal-problem">Last refresh did not land. {state.problem}</p>}
          </aside>

          <div className="cal-agenda">
            {byDay.length === 0 && <div className="empty">Nothing ahead in the next month.</div>}

            {byDay.map(([day, list]) => {
              const [, mm, dd] = day.split('-').map(Number)
              const isToday = day === today
              return (
                <section className="cal-day" id={`cal-${day}`} key={day}>
                  <div className="cal-day-head">
                    <span className="cal-day-num">{dd}</span>
                    <span className="cal-day-name">{dayLabel(day, today)}</span>
                    {mm !== thisMonth && <span className="cal-day-mon">{new Date(2000, mm - 1, 1).toLocaleDateString('en-GB', { month: 'long' })}</span>}
                    <span className="cal-day-count mono">{list.length}</span>
                  </div>
                  <div className="cal-rows">
                    {list.map((e) => {
                      const has = written.has(e.uid) || madeFor === e.uid
                      const end = e.start === null ? null : e.end ?? e.start + 60
                      const running = isToday && end !== null && (e.start as number) <= nowMin && nowMin < end
                      const ended = isToday && end !== null && end <= nowMin
                      return (
                        <div className={`cal-row${running ? ' is-now' : ''}${ended ? ' is-past' : ''}`} key={`${e.uid}-${e.start ?? 'all'}`}>
                          <span className="cal-when mono">
                            {e.allDay ? 'all day' : `${HM(e.start as number)}${e.end ? `–${HM(e.end)}` : ''}`}
                          </span>
                          <span className="cal-what">
                            <span className="cal-title">{linkify(e.title)}</span>
                            {e.people.length > 0 && (
                              <span className="cal-people">{e.people.slice(0, 4).join(', ')}{e.people.length > 4 ? ` +${e.people.length - 4}` : ''}</span>
                            )}
                          </span>
                          <span className="cal-do">
                            {running && <span className="cal-now mono">now</span>}
                            {ended && <span className="cal-ago mono">just ended</span>}
                            {e.link && (
                              <a className="habit-auto" href={e.link} target="_blank" rel="noreferrer">Join ↗</a>
                            )}
                            {has
                              ? <span className="cal-written mono">written up</span>
                              : <button className="btn btn-quiet" onClick={() => write(e)}>Write it up</button>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
