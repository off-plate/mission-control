import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { HabitRun, habitHasRun } from './habitrun'
import * as Icon from './icons'
import type { HabitDef, Routine } from './types'

/* Running a routine instead of reading it.

   His words, and the whole brief: "I need to be able to open it up, find the
   relevant routine, start it up, go through it, close it. Usually that's it."
   The page could only ever show him a routine. Fifty rows of checkbox is a
   reference card; it is not a thing you run at six in the morning with one
   hand.

   So this is the routine as a single moving surface: one step at a time, its
   own body underneath it when it has one, and three ways out. It writes
   nothing new. Every step it finishes is the ordinary habit tick the row would
   have made, which matters more than it sounds: the folder's own habit is
   already wired to those ticks in the store, so finishing here closes the
   routine and advances its streak through the path that already existed.

   Deliberately NOT a full-screen takeover. The Zone is the app's one room you
   disappear into, and a morning routine is not that: he wants to see the rest
   of the day behind it, and closing has to cost one click and no ceremony. */

export function RoutineRunner({
  folder, list, todayIndex, onClose,
}: {
  folder: Routine
  list: HabitDef[]
  todayIndex: number
  onClose: () => void
}) {
  const { markHabitDay } = useStore()
  const box = useRef<HTMLDivElement>(null)

  /* Where to pick up. Opening a routine he is half through and starting it at
     step one would make him tick four things he already did. */
  const firstOpen = useMemo(() => {
    const i = list.findIndex((h) => !h.days[todayIndex])
    return i < 0 ? 0 : i
  }, [list, todayIndex])
  const [i, setI] = useState(firstOpen)

  /* The surface arrives below the fold on a long page, so it says where it is.
     Once, on open: doing it on every step would drag the page under him each
     time he ticked something. */
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = list[i]
  if (!step) return null

  const total = list.length
  const kept = list.filter((h) => h.days[todayIndex]).length
  const last = i >= total - 1

  const go = (to: number) => { if (to >= total) onClose(); else setI(to) }
  const keepIt = () => {
    if (!step.days[todayIndex]) markHabitDay(step.id, todayIndex, true)
    go(i + 1)
  }

  /* Escape closes, the way every other overlay in this app does. It does not
     undo anything: the steps he ticked on the way are his. */
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const link = step.link
  const linkLabel = step.linkLabel ?? (link ? new URL(link).hostname.replace(/^www\./, '') : '')

  return (
    <div className="runner" ref={box} role="group" aria-label={`Running ${folder.title}`}>
      <div className="runner-top">
        <span className="microcap">{folder.title}</span>
        <span className="runner-count mono">step {i + 1} of {total}</span>
      </div>

      <div className="runner-bar" aria-hidden="true">
        <i style={{ width: `${Math.round((i / total) * 100)}%` }} />
      </div>

      <div className="runner-step">
        <h3 className="runner-title">{step.name}</h3>
        {step.note && <p className="runner-note">{step.note}</p>}
        {step.days[todayIndex] && <p className="runner-already">Already kept today. Next takes you past it.</p>}

        {link && (
          <a className="runner-link" href={link} target="_blank" rel="noreferrer">
            {linkLabel} <Icon.ExternalLink size={13} />
          </a>
        )}

        {/* The step's real body: today's news to read aloud, the twisters, the
            typing gate, the either-or. Without this the runner would turn the
            five steps that actually carry work back into checkboxes, which is
            the exact regression habitrun.tsx was written to undo. */}
        {habitHasRun(step) && <div className="runner-body"><HabitRun h={step} /></div>}
      </div>

      <div className="runner-foot">
        <button className="btn btn-primary" onClick={keepIt}>
          {last ? 'Finish' : 'Done, next'}
        </button>
        <button className="btn btn-quiet" onClick={() => go(i + 1)}>Skip</button>
        {i > 0 && <button className="btn btn-quiet" onClick={() => setI(i - 1)}>Back</button>}
        <span className="runner-kept mono">{kept} of {total} kept today</span>
        <button className="btn btn-quiet runner-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
