import { useMemo, useState } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { Band } from './ui'
import { meetingNote, meetingTitle, meetingUidOf } from './meetingnote'
import { spaceFolderId } from './types'
import { localDateKey } from './util'
import type { CalEvent } from './ical'

/* The week, as a column of days.

   Not a month grid. A month grid is for choosing a date, and he already knows
   what day it is; what he needs from a calendar inside this app is the answer
   to "what is coming, and did I write it down". So the only thing this page
   does that Google Calendar does not is the button on every row.

   Nothing here can edit the calendar. It is a read of somebody else's system
   and it says so by having no way to change anything. */

const HM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today'
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const t = new Date(`${today}T12:00:00`)
  const diff = Math.round((dt.getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000)
  if (diff === 1) return 'Tomorrow'
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function CalendarPage() {
  const { notes, addNote, setPage, openNote, space } = useStore()
  const { state, reload } = useCalendar()
  const [madeFor, setMadeFor] = useState<string | null>(null)
  const today = localDateKey()

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

  const byDay = useMemo(() => {
    if (state.status !== 'ok') return []
    const m = new Map<string, CalEvent[]>()
    for (const e of state.events) m.set(e.day, [...(m.get(e.day) ?? []), e])
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [state])

  return (
    <div className="page">
      <Band
        title="Calendar"
        actions={<button className="btn btn-quiet" onClick={reload}>Refresh</button>}
      />

      {state.status === 'loading' && <div className="empty">Reading the calendar.</div>}
      {state.status === 'off' && <div className="empty">Sync is off, so the calendar cannot be read.</div>}
      {state.status === 'signed-out' && <div className="empty">Sign in to read the calendar.</div>}
      {state.status === 'not-set-up' && <div className="empty">No calendar feed connected yet.</div>}
      {state.status === 'error' && <div className="empty">Calendar could not be read. {state.message}</div>}
      {state.status === 'ok' && byDay.length === 0 && <div className="empty">Nothing in the next week.</div>}

      {state.status === 'ok' && byDay.map(([day, events]) => (
        <section className="cal-day" key={day}>
          <div className="cal-day-head">
            <span className="cal-day-name">{dayLabel(day, today)}</span>
            <span className="cal-day-count mono">{events.length}</span>
          </div>
          <div className="cal-rows">
            {events.map((e) => {
              const has = written.has(e.uid) || madeFor === e.uid
              return (
                <div className="cal-row" key={`${e.uid}-${e.start ?? 'all'}`}>
                  <span className="cal-when mono">
                    {e.allDay ? 'all day' : `${HM(e.start as number)}${e.end ? `–${HM(e.end)}` : ''}`}
                  </span>
                  <span className="cal-what">
                    <span className="cal-title">{e.title}</span>
                    {e.people.length > 0 && (
                      <span className="cal-people">{e.people.slice(0, 4).join(', ')}{e.people.length > 4 ? ` +${e.people.length - 4}` : ''}</span>
                    )}
                  </span>
                  <span className="cal-do">
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
      ))}
    </div>
  )
}
