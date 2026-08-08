/* THE ZONE. Full screen, header still reachable above it, for the one thing
   you are doing right now and nothing else that lives in the rest of the app.

   Four pieces, all fed by things the app already tracks: what is running (the
   same pomodoro state Today and Focus read), the date and time (the same
   clock the widget shows), a note with nowhere to file it but forward, and
   Mundi Opus playing underneath. First pass, on his own words: "let's start
   with that and see what you can do." */

import { useEffect, useRef, useState } from 'react'
import { AutoTextarea, useClockStamp, useFirstMove } from './ui'
import { usePomodoro } from './pomodoro'
import { ZonePlayer } from './zoneplayer'
import { useStore } from './store'
import { fmtDuration, isEstimated, taskMinutes } from './util'
import { SPACE_LABELS } from './mock'
import { spaceFolderId } from './types'

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

function ZoneClock() {
  const now = useClockStamp()
  return (
    <div className="zclock">
      <span className="zclock-time">{now.time}</span>
      <span className="zclock-date">{now.day}, {now.date}</span>
    </div>
  )
}

function ZoneTask() {
  const pomo = usePomodoro()
  const { setFocusTaskId } = useStore()
  const firstMove = useFirstMove()

  if (pomo.phase === 'focus' || pomo.phase === 'await') {
    const state = pomo.phase === 'await' ? 'await' : !pomo.running ? 'paused' : 'running'
    return (
      <div className={`znow is-${state}`}>
        <span className="znow-label">{pomo.phase === 'await' ? 'Finished' : pomo.running ? 'In the zone' : 'Paused'}</span>
        <span className="znow-title">{pomo.focusLabel ?? 'Focus block'}</span>
        <span className="znow-clock mono">{pomo.phase === 'await' ? 'done' : mmss(pomo.secondsLeft)}</span>
        {pomo.phase === 'focus' && (
          <div className="znow-controls">
            <button className="btn btn-ghost" onClick={pomo.toggle}>{pomo.running ? 'Pause' : 'Resume'}</button>
            <button className="btn btn-ghost" onClick={pomo.stop}>Stop</button>
          </div>
        )}
      </div>
    )
  }

  if (pomo.phase === 'break') {
    return (
      <div className="znow is-break">
        <span className="znow-label">Break</span>
        <span className="znow-title">{fmtDuration(pomo.breakMin)}, then back in</span>
        <span className="znow-clock mono">{mmss(pomo.secondsLeft)}</span>
      </div>
    )
  }

  if (!firstMove) {
    return (
      <div className="znow is-empty">
        <span className="znow-label">Nothing lined up</span>
        <span className="znow-title">Plan has nothing on today's list yet.</span>
      </div>
    )
  }

  return (
    <div className="znow is-idle">
      <span className="znow-label">First move</span>
      <span className="znow-title">{firstMove.title}</span>
      {isEstimated(firstMove) && firstMove.estimateMin > 0 && (
        <span className="znow-est mono">{fmtDuration(firstMove.estimateMin)}</span>
      )}
      <button
        className="btn btn-primary znow-start"
        onClick={() => {
          pomo.startFocus(isEstimated(firstMove) && firstMove.estimateMin > 0 ? taskMinutes(firstMove) : undefined, firstMove.title)
          setFocusTaskId(firstMove.id)
        }}
      >
        Start
      </button>
    </div>
  )
}

const FOLDER_KEY = 'mc:zone-folder'

function ZoneNote() {
  const { space, noteFolders, addNote, updateNote } = useStore()
  const options = [
    ...(['personal', 'work', 'offplate', 'corner'] as const).map((s) => ({ id: spaceFolderId(s), name: SPACE_LABELS[s] })),
    ...noteFolders.map((f) => ({ id: f.id, name: f.name })),
  ]
  const [folderId, setFolderId] = useState(() => {
    try { return localStorage.getItem(FOLDER_KEY) ?? spaceFolderId(space) } catch { return spaceFolderId(space) }
  })
  useEffect(() => { try { localStorage.setItem(FOLDER_KEY, folderId) } catch { /* quota */ } }, [folderId])

  const [noteId, setNoteId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const onChange = (v: string) => {
    setBody(v)
    if (noteId) { updateNote(noteId, { body: v }); return }
    if (v.trim()) setNoteId(addNote(folderId, v))
  }
  const fresh = () => { setNoteId(null); setBody(''); taRef.current?.focus() }

  return (
    <div className="znote">
      <div className="znote-head">
        <span className="microcap">Note</span>
        <select
          className="znote-folder"
          value={folderId}
          onChange={(e) => { setFolderId(e.target.value); fresh() }}
          aria-label="Folder this note is saved to"
        >
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="btn btn-ghost znote-new" onClick={fresh}>New note</button>
      </div>
      <AutoTextarea
        className="textinput znote-area"
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Whatever is worth keeping from this block…"
        minRows={6}
        maxRows={40}
        aria-label="Zone note"
      />
    </div>
  )
}

export function ZonePage() {
  return (
    <div className="zonepage">
      {/* The one dominant object in the room, actually centered in whatever
          screen it is given rather than stranded in a corner of it. The clock
          sits apart from it on purpose: ambient context, not a second number
          competing with the countdown for the same glance. */}
      <div className="zone-hero">
        <ZoneTask />
      </div>
      <ZoneClock />
      {/* A bare dock along the bottom edge, not a pair of cards: nothing here
          is trying to look like a panel from the rest of the app. */}
      <div className="zone-dock">
        <ZoneNote />
        <ZonePlayer />
      </div>
    </div>
  )
}
