/* THE TODAY PAGE. Split out of pages1.tsx (2026-09-09), which had grown to
   3,430 lines holding six unrelated pages -- this is the one that renders
   TodayRoom.

   Carries dead code, moved verbatim rather than deleted: AddWidgetInline,
   TaskName, timeAtOffset, Schedule, nextDay and dateLine are defined here
   but rendered nowhere -- TodayPage itself is just Band + TodayRoom. Left
   in place for him to decide whether to delete; this split is structure
   only. */
import { useEffect, useState } from 'react'
import { MOCK_AGENDA } from './exceptions'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { Sheet } from './modals'
import { Linkify } from './widgets'
import { dayPlus } from './weekgrid'
import { estimateFor } from './estimate'
import { estimateTask } from './ai'
import { useOpenToday, Band } from './ui'
import { SLOTS, type AgendaEvent, type SubTask, type Task, type TimeSlot } from './types'
import { fmtDuration, fmtTime, fmtTimeShort, gcalUrl, isEstimated, localDateKey, taskMinutes, toMin } from './util'

/* The line at the top of Today. It reads the SAME feed the calendar widget
   reads, so the header and the tile can never disagree about what is next.
   It used to read MOCK_AGENDA, which is empty for every workspace, so it has
   said "none today" every day since it was written. */
function useNextEvent(): { v: string; k: string } {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const { state } = useCalendar()
  if (state.status !== 'ok') return { v: 'none today', k: 'next event' }
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const todays = state.events.filter((e) => e.day === localDateKey() && e.start !== null)
  const ongoing = todays.find((e) => (e.start as number) <= nowMin && nowMin < (e.end ?? e.start as number))
  if (ongoing) return { v: `${ongoing.title.split(':')[0]} until ${hm(ongoing.end ?? ongoing.start as number)}`, k: 'now' }
  const next = todays.find((e) => (e.start as number) > nowMin)
  if (!next) return { v: 'none today', k: 'next event' }
  return { v: `${hm(next.start as number)} ${next.title.split(':')[0]}`, k: 'next event' }
}

/** Yesterday's date. Stepping the calendar day, not subtracting 24 hours, so
 *  the clocks changing does not land it on the wrong day twice a year. */
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
    <div className="page">
      <Band
        title="Today"
        metrics={[
          { v: nextEvent.v, k: nextEvent.k, tone: 'info' as const },
          { v: String(open.length), k: 'tasks open' },
        ]}
      />
      <TodayRoom />
    </div>
  )
}

/* Uses the shared Sheet so it inherits Escape-to-close, the way every other
   dialog in the app behaves. */
function AddWidgetInline({ onClose }: { onClose: () => void }) {
  const { spaces, space, addWidget, inView } = useStore()
  const present = new Set(spaces[space].map((w) => w.type))
  return (
    <Sheet
      title="Add a widget"
      onClose={onClose}
    >
      <div className="addw-grid">
        {Object.values(WIDGET_DEFS_LIST).map((d) => (
          <button
            key={d.type}
            className="addw-item"
            disabled={present.has(d.type)}
            onClick={() => { addWidget(space, d.type); onClose() }}
          >
            {d.title}
            <span className="d">{d.description}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

import { WIDGET_DEFS } from './mock'
import * as Icon from './icons'
import { TodayRoom } from './todayroom'
const WIDGET_DEFS_LIST = WIDGET_DEFS

/* ---------------- PLAN ---------------- */

const HOUR_PX = 42             // tall enough that a 30-minute block fits its own label
/* The whole day, midnight to midnight. He wants to see the full day, not a
   window I decided was the interesting part of it. */
const START_H = 0
const END_H = 24

/** The task/event name IS the link; clicking opens (or schedules) it in Google Calendar. */
function TaskName({ title, start, end, className }: { title: string; start?: string; end?: string; className?: string }) {
  return (
    <a className={`task-link${className ? ' ' + className : ''}`} href={gcalUrl(title, start, end)} target="_blank" rel="noreferrer" title="Open in Google Calendar">
      {title}
    </a>
  )
}

/** 'HH:MM' for a pixel offset down the day, snapped to the nearest quarter hour. */
function timeAtOffset(px: number): string {
  const mins = Math.round(((px / HOUR_PX) * 60) / 15) * 15 + START_H * 60
  const clamped = Math.max(START_H * 60, Math.min(END_H * 60 - 15, mins))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/** Vertical day timeline: calendar events plus any task pinned to a clock time. Full height, no inner scroll. */
export function Schedule({ events, tasks, onDropAt }: { events: AgendaEvent[]; tasks: Task[]; onDropAt: (id: string, at: string) => void }) {
  const { setTaskAt, inView } = useStore()
  const pinned = tasks.filter((t) => t.at && !t.done)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const startH = START_H
  const endH = END_H
  const DAY_START = startH * 60
  const hours = endH - startH
  const height = hours * HOUR_PX
  const y = (hhmm: string) => ((toMin(hhmm) - DAY_START) / 60) * HOUR_PX
  // Where the drop would land, shown as a line while you drag over the day.
  const [hoverAt, setHoverAt] = useState<string | null>(null)
  const offsetIn = (e: React.DragEvent<HTMLDivElement>) =>
    e.clientY - e.currentTarget.getBoundingClientRect().top
  return (
    <div className="vsched">
      <div
        className="vsched-inner"
        style={{ height }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverAt(timeAtOffset(offsetIn(e))) }}
        onDragLeave={() => setHoverAt(null)}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          if (id) onDropAt(id, timeAtOffset(offsetIn(e)))
          setHoverAt(null)
        }}
      >
        {hoverAt && (
          <div className="vdrop" style={{ top: y(hoverAt) }} aria-hidden="true">
            <span className="vdrop-label mono">{fmtTime(hoverAt)}</span>
          </div>
        )}
        {Array.from({ length: hours + 1 }, (_, i) => {
          const h = startH + i
          return (
            <div key={h} className="hline" style={{ top: i * HOUR_PX }}>
              {h % 2 === 0 && h < 24 && <span className="hlabel">{fmtTimeShort(`${h}:00`)}</span>}
            </div>
          )
        })}
        {nowMin >= DAY_START && nowMin <= endH * 60 && (
          <div className="vnow" style={{ top: ((nowMin - DAY_START) / 60) * HOUR_PX }} aria-hidden="true">
            <span className="vnow-dot" /><span className="vnow-label mono">now</span>
          </div>
        )}
        {events.map((e) => (
          <div className="vev vev-cal" key={e.id} style={{ top: y(e.start) + 1, height: Math.max(((toMin(e.end) - toMin(e.start)) / 60) * HOUR_PX - 2, 42) }}>
            <TaskName title={e.title} start={e.start} end={e.end} className="t" />
            <span className="rng">{fmtTime(e.start)} – {fmtTime(e.end)}</span>
          </div>
        ))}
        {pinned.map((t) => (
          <div
            className="vev vev-task" key={t.id} draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
            style={{ top: y(t.at!) + 1, height: Math.max((taskMinutes(t) / 60) * HOUR_PX - 2, 42) }}
          >
            <TaskName title={t.title} start={t.at} className="t" />
            <span className="rng">{fmtTime(t.at!)} · task</span>
            <button className="vev-x" aria-label={`Take ${t.title} off the clock`} onClick={() => setTaskAt(t.id, undefined)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* A generated breakdown is a draft. The wording is the model's, the minutes are
   a guess, and sometimes a step is simply not his, so every one of them can be
   rewritten, re-estimated or thrown away. */
/* Edit or drop one step, from wherever it is shown. The list had this and the
   day did not, which is backwards: the day is where he finds out the number was
   wrong. Opens in place, saves on Enter or on Save, Escape puts it back. */





