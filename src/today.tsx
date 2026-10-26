/* THE TODAY PAGE. Split out of pages1.tsx (2026-09-09), which had grown to
   3,430 lines holding six unrelated pages -- this is the one that renders
   TodayRoom.
   TodayPage is Band + TodayRoom. The old widget grid's leftovers were
   deleted 2026-10-04. */
import { useEffect, useState } from 'react'
import { useCalendar } from './calendar'
import { useOpenToday, Band, WorkspaceTitle } from './ui'
import { TodayRoom } from './todayroom'
import { localDateKey } from './util'

/* The line at the top of Today. It reads the SAME feed the calendar widget
   reads, so the header and the tile can never disagree about what is next.
   It used to read MOCK_AGENDA, which is empty for every workspace, so it has
   said "none today" every day since it was written. */
function useNextEvent(): { title: string; time: string; k: 'now' | 'next' } | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const { state } = useCalendar()
  if (state.status !== 'ok') return null
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const todays = state.events.filter((e) => e.day === localDateKey() && e.start !== null)
  const ongoing = todays.find((e) => (e.start as number) <= nowMin && nowMin < (e.end ?? e.start as number))
  if (ongoing) return { title: ongoing.title.split(':')[0], time: `until ${hm(ongoing.end ?? ongoing.start as number)}`, k: 'now' }
  const next = todays.find((e) => (e.start as number) > nowMin)
  if (!next) return null
  return { title: next.title.split(':')[0], time: `at ${hm(next.start as number)}`, k: 'next' }
}

/* The meeting as one aligned line, not a band number: it is a sentence (a name
   and a time), and as a big right-aligned figure it wrapped into a ragged
   two-line block beside the title. Label, name (cut with an ellipsis), time. */
function EventLine({ ev }: { ev: ReturnType<typeof useNextEvent> }) {
  if (!ev) return <div className="tnow is-none"><span className="tnow-k">Next</span><span className="tnow-t">Nothing else today</span></div>
  return (
    <div className={`tnow is-${ev.k}`}>
      <span className="tnow-k">{ev.k === 'now' ? 'Now' : 'Next'}</span>
      <span className="tnow-t">{ev.title}</span>
      <span className="tnow-h">{ev.time}</span>
    </div>
  )
}

/* ---------------- TODAY ---------------- */

export function TodayPage() {
  const nextEvent = useNextEvent()
  const open = useOpenToday()

  /* One surface. The paper widget grid that used to sit under the room is gone,
     and so are its Edit grid and Add widget buttons.

     It was not a styling problem. NOW repeated the countdown, the date and the
     week; DUE TODAY repeated On the clock; HABITS and GOALS repeated the two
     figures at the bottom of the room. Michael, seeing it: "why did you not
     redesign this". He was right, and I had already spotted it and handed the
     decision back to him instead of making it. Habits, goals and the week are
     inside the room now, in the room's language, each said once. */
  return (
    <div className="page is-today">
      <Band
        title={<WorkspaceTitle before="Today" />}
        leading={<EventLine ev={nextEvent} />}
        metrics={[{ v: String(open.length), k: 'tasks open' }]}
      />
      <TodayRoom />
    </div>
  )
}
