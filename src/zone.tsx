/* THE ZONE. Full screen, header still reachable above it: a dashboard for the
   one thing running right now, built out of the same widget he already
   knows from Today rather than a bespoke "calm room" look of its own. His
   words, after the first version: "I told you to create widgets. Inspire
   yourself by today's section... it's supposed to be full screen dashboard."

   Four tiles, all fed by things the app already tracks: what is running (the
   same pomodoro state Today and Focus read), the date and time (literally
   the same ClockBody widget Today renders, not a smaller copy of it), a note
   with nowhere to file it but forward, and Mundi Opus playing underneath. */

import { useEffect, useState, type ReactNode } from 'react'
import { AutoTextarea, useFirstMove } from './ui'
import { usePomodoro } from './pomodoro'
import { ZonePlayer } from './zoneplayer'
import { ClockBody } from './widgets'
import { useStore } from './store'
import { fmtDuration, isEstimated, taskMinutes } from './util'
import { SPACE_LABELS } from './mock'
import { spaceFolderId } from './types'

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

/* The same tile chrome every widget on Today wears: surface fill, hairline
   border, a title row. Reused directly, not reinvented, so the room reads as
   one system with the rest of the app instead of its own separate style. */
function ZoneTile({ title, className = '', children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`widget zw-tile ${className}`}>
      <header className="widget-head"><span className="widget-title">{title}</span></header>
      <div className="widget-body zw-body">{children}</div>
    </section>
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

  const onChange = (v: string) => {
    setBody(v)
    if (noteId) { updateNote(noteId, { body: v }); return }
    if (v.trim()) setNoteId(addNote(folderId, v))
  }
  const fresh = () => { setNoteId(null); setBody('') }

  return (
    <div className="znote">
      <div className="znote-head">
        <select
          className="textinput znote-folder"
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
        minRows={4}
        maxRows={40}
        aria-label="Zone note"
      />
    </div>
  )
}

export function ZonePage() {
  return (
    <div className="zonepage zw-grid">
      <ZoneTile title="Now" className="zw-now"><ZoneTask /></ZoneTile>
      <ZoneTile title="Clock" className="zw-clock"><ClockBody /></ZoneTile>
      <ZoneTile title="Note" className="zw-note-tile"><ZoneNote /></ZoneTile>
      <ZoneTile title="Mundi Opus" className="zw-player-tile"><ZonePlayer /></ZoneTile>
    </div>
  )
}
