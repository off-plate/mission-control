/* THE ZONE, fifth pass: deep water.

   The four bordered tiles are gone. His words: "it's sort of very plain...
   I want this page to be completely different... it really has to be THE
   ZONE." The four-card grid was the plain part, because a dashboard is what
   you look AT and this is a room you are meant to be IN. So: one field, no
   card chrome, the countdown as the only object with real presence, and the
   note and the player as quiet surfaces sitting directly on the water.

   The colour is not decoration either. `--depth` (below) is the real
   elapsed share of the running block, and the room's ground is mixed from
   it, so twenty minutes in is visibly deeper water than the moment he sat
   down. Nothing fades that he has to read: bone on darker water gains
   contrast as it deepens, it never loses it.

   Type is Array for the countdown alone, a dot-matrix face that turns the
   number into an instrument rather than a label, over Technor for
   everything around it. Both checked against design-log.md first: the
   near-black-plus-orange this replaces was simultaneously one of the three
   named 2026 AI defaults and next door to a row already spent on a client
   site, which is exactly why it read like every other focus timer. */

import { useEffect, useRef, useState } from 'react'
import { useClockStamp, useFirstMove, useOpenToday } from './ui'
import { usePomodoro } from './pomodoro'
import { ZonePlayer } from './zoneplayer'
import { useStore } from './store'
import { isEstimated, taskMinutes } from './util'
import { SPACE_LABELS } from './mock'
import { spaceFolderId } from './types'
import { Editor } from './notes'

/* Minutes padded to two digits, unlike everywhere else in the app: this one
   is a read-out on a dial, and a departure board never drops a digit. Without
   the pad the instrument physically shrank from five glyphs to four as the
   block passed ten minutes left. */
const mmss = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`

function EyeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function CupIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 9h11v6a5 5 0 0 1-5 5H9a4 4 0 0 1-4-4V9z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 3v2M11 3v2M14 3v2" strokeLinecap="round" />
    </svg>
  )
}
function CheckRing() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.6 2.6L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function FlagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 3v18" strokeLinecap="round" />
      <path d="M6 4h11l-2.5 4L17 12H6" strokeLinejoin="round" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" strokeLinecap="round" />
    </svg>
  )
}
function StopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
  )
}
function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
  )
}
function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14.5 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
}
function ListIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 6h12M9 12h12M9 18h12" strokeLinecap="round" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" strokeWidth="2.6" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
}

type PhaseState = 'running' | 'paused' | 'break' | 'done' | 'idle'

function PhaseIcon({ state }: { state: PhaseState }) {
  if (state === 'break') return <CupIcon />
  if (state === 'done') return <CheckRing />
  if (state === 'idle') return <FlagIcon />
  return <EyeIcon />
}

function ZoneTask() {
  const pomo = usePomodoro()
  const { setFocusTaskId } = useStore()
  const firstMove = useFirstMove()
  const openToday = useOpenToday()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<'focus' | 'break' | null>(null)
  // A hand pick overrides the auto first-move; it clears itself the moment
  // that task leaves today's open list (finished, or dropped from today),
  // rather than pointing at something that no longer exists.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosenTask = chosenId ? openToday.find((t) => t.id === chosenId) : undefined
  const activeTask = chosenTask ?? firstMove

  const phaseState: PhaseState =
    pomo.phase === 'await' ? 'done' :
    pomo.phase === 'break' ? 'break' :
    pomo.phase === 'focus' ? (pomo.running ? 'running' : 'paused') :
    'idle'

  const pct =
    pomo.phase === 'focus' ? 1 - pomo.secondsLeft / Math.max(1, pomo.blockMin * 60) :
    pomo.phase === 'break' ? 1 - pomo.secondsLeft / Math.max(1, pomo.breakMin * 60) :
    pomo.phase === 'await' ? 1 : 0

  const label = { running: 'Focus', paused: 'Paused', break: 'Break', done: 'Done', idle: activeTask ? 'Ready' : 'Nothing lined up' }[phaseState]

  const title =
    pomo.phase === 'focus' || pomo.phase === 'await' ? (pomo.focusLabel ?? 'Focus block') :
    pomo.phase === 'break' ? 'Short break' :
    activeTask ? activeTask.title : 'Plan has nothing on today’s list yet.'

  // The about-to-start duration shown while idle has to match what pressing
  // Start actually does: the task's own estimate when it has one, the
  // default setting when it doesn't. Never a number Start then contradicts.
  const idleMin = activeTask && isEstimated(activeTask) && activeTask.estimateMin > 0 ? taskMinutes(activeTask) : pomo.focusMin
  const clockText = phaseState === 'done' ? 'done' : phaseState === 'idle' ? mmss(idleMin * 60) : mmss(pomo.secondsLeft)

  const filledDots = pomo.cyclesDone % 4 === 0 && pomo.cyclesDone > 0 ? 4 : pomo.cyclesDone % 4
  const r = 44
  const c = 2 * Math.PI * r

  const start = () => {
    if (activeTask) {
      pomo.startFocus(isEstimated(activeTask) && activeTask.estimateMin > 0 ? taskMinutes(activeTask) : undefined, activeTask.title)
      setFocusTaskId(activeTask.id)
    } else {
      pomo.startFocus()
    }
  }

  return (
    <div className={`znow zn-${phaseState}`}>
      {/* The band: what he is on, and the real hour, set as type on the field
          rather than boxed. The hour earns its place here because the whole
          point of this room is losing track of it. */}
      <header className="znow-band">
        <div className="znow-what">
          {/* The phase glyph sits INSIDE the title line, not as an all-caps
              tracked word above it. That eyebrow was the one shape the house
              rules forbid outright, and it carried nothing: the ring's colour
              and the button's verb already say the state, and in the empty
              case it read "Nothing lined up" directly above a title saying
              the same sentence again. */}
          <h1 className="znow-title">
            <PhaseIcon state={phaseState} />
            <span>{title}</span>
          </h1>
        </div>
        <ZoneClock />
      </header>

      <div className="znow-face-wrap">
        <div className="znow-face">
          <svg className="zring" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="zring-track" cx="50" cy="50" r={r} />
            {phaseState !== 'idle' && (
              <circle
                className="zring-fill" cx="50" cy="50" r={r}
                style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(1, Math.max(0, pct))) }}
              />
            )}
          </svg>
          <div className="znow-center">
            <span className="znow-clock">{clockText}</span>
            <div className="znow-dots" title={`${filledDots} of 4 blocks done today`} aria-label={`${filledDots} of 4 blocks done today`}>
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < filledDots ? 'is-on' : ''} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="znow-actions">
        {(phaseState === 'running' || phaseState === 'paused' || phaseState === 'break') && (
          <button className="znow-icon" onClick={pomo.stop} aria-label="Stop this block"><StopIcon /></button>
        )}
        {/* Choosing only makes sense before a block starts, and only when
           there is more than the one task the auto pick would offer
           anyway: nothing to choose between otherwise. */}
        {phaseState === 'idle' && openToday.length > 1 && (
          <button
            className="znow-icon" aria-expanded={pickerOpen} aria-label="Choose what to focus on"
            onClick={() => { setPickerOpen((v) => !v); setSettingsOpen(false) }}
          >
            <ListIcon />
          </button>
        )}
        {phaseState === 'idle' && (
          <button className="znow-pill" onClick={start}>Start</button>
        )}
        {(phaseState === 'running' || phaseState === 'paused' || phaseState === 'break') && (
          <button className="znow-pill" onClick={pomo.toggle}>{phaseState === 'paused' ? 'Resume' : 'Pause'}</button>
        )}
        {phaseState === 'done' && <span className="znow-pill is-done">Banked</span>}
        <button
          className="znow-icon" aria-expanded={settingsOpen} aria-label="Timer settings"
          onClick={() => { setSettingsOpen((v) => !v); setEditing(null); setPickerOpen(false) }}
        >
          <GearIcon />
        </button>
      </div>
      {pickerOpen && (
        <div className="znow-settings" role="dialog" aria-label="Choose what to focus on">
          <div className="znow-settings-head">
            <span>Choose a task</span>
            <button className="znow-icon" onClick={() => setPickerOpen(false)} aria-label="Close"><CloseIcon /></button>
          </div>
          <div className="znow-picker-list">
            <button className="znow-settings-row" onClick={() => { setChosenId(null); setPickerOpen(false) }}>
              <span>Auto pick (first move)</span>
              {!chosenTask && <CheckIcon />}
            </button>
            {openToday.map((t) => (
              <button key={t.id} className="znow-settings-row" onClick={() => { setChosenId(t.id); setPickerOpen(false) }}>
                <span>{t.title}</span>
                {chosenTask?.id === t.id ? <CheckIcon /> : isEstimated(t) && t.estimateMin > 0 ? <span className="mono">{taskMinutes(t)}m</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="znow-settings" role="dialog" aria-label="Timer settings">
          {editing === null ? (
            <>
              <div className="znow-settings-head">
                <span>Settings</span>
                <button className="znow-icon" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><CloseIcon /></button>
              </div>
              <button className="znow-settings-row" onClick={() => setEditing('focus')}>
                <span>Focus session</span>
                <span className="mono">{pomo.focusMin}m ›</span>
              </button>
              <button className="znow-settings-row" onClick={() => setEditing('break')}>
                <span>Short break</span>
                <span className="mono">{pomo.breakMin}m ›</span>
              </button>
            </>
          ) : (
            <>
              <div className="znow-settings-head">
                <button className="znow-icon" onClick={() => setEditing(null)} aria-label="Back to settings"><BackIcon /></button>
                <span>{editing === 'focus' ? 'Focus session' : 'Short break'}</span>
              </div>
              <div className="znow-stepper">
                <button
                  aria-label="Less minutes"
                  onClick={() => (editing === 'focus' ? pomo.setFocusMin(Math.max(5, pomo.focusMin - 5)) : pomo.setBreakMin(Math.max(5, pomo.breakMin - 5)))}
                >
                  −
                </button>
                <span className="mono">
                  {editing === 'focus' ? pomo.focusMin : pomo.breakMin}<small>min</small>
                </span>
                <button
                  aria-label="More minutes"
                  onClick={() => (editing === 'focus' ? pomo.setFocusMin(Math.min(90, pomo.focusMin + 5)) : pomo.setBreakMin(Math.min(30, pomo.breakMin + 5)))}
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const DAYPART_LABEL: Record<'morning' | 'day' | 'evening' | 'night', string> = {
  morning: 'Morning', day: 'Afternoon', evening: 'Evening', night: 'Night',
}
function daypart(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'day'
  if (hour < 22) return 'evening'
  return 'night'
}

function ZoneClock() {
  const now = useClockStamp()
  const [part, setPart] = useState(() => daypart(new Date().getHours()))
  useEffect(() => {
    const t = window.setInterval(() => setPart(daypart(new Date().getHours())), 60000)
    return () => window.clearInterval(t)
  }, [])
  /* Type on the field, no card. The gradient card this replaces was one of
     the four tiles that made the room read as a dashboard; the daypart it
     was drawing is kept as a word, which says the same thing in less. */
  return (
    <div className="zclock">
      <span className="zclock-time">{now.time}</span>
      <span className="zclock-date">{now.day} {now.date}<i>{DAYPART_LABEL[part]}</i></span>
    </div>
  )
}

const FOLDER_KEY = 'mc:zone-folder'

function NoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
      <path d="M9 10h6M9 14h6M9 18h3" strokeLinecap="round" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
  )
}

function ZoneNote() {
  const { space, noteFolders, notes, addNote, updateNote } = useStore()
  const options = [
    ...(['personal', 'work', 'offplate', 'corner'] as const).map((s) => ({ id: spaceFolderId(s), name: SPACE_LABELS[s] })),
    ...noteFolders.map((f) => ({ id: f.id, name: f.name })),
  ]
  const [folderId, setFolderId] = useState(() => {
    try { return localStorage.getItem(FOLDER_KEY) ?? spaceFolderId(space) } catch { return spaceFolderId(space) }
  })
  useEffect(() => { try { localStorage.setItem(FOLDER_KEY, folderId) } catch { /* quota */ } }, [folderId])

  const [noteId, setNoteId] = useState<string | null>(null)
  // Before the first character, there is no note to hold the draft yet: it
  // lives in a ref so a keystroke does not fight the store for who owns it.
  const draft = useRef('')
  /* Typing fast enough (a real fast typist, or any programmatic input) can
     fire several keystrokes before React commits the state update from the
     one that just created the note. Reading noteId itself for that decision
     raced: two or three keystrokes in a row each still saw it as null and
     each created their OWN note, splitting one note into several. The ref
     is written the instant the note exists, no render required to see it. */
  const noteIdRef = useRef<string | null>(null)
  const active = noteId ? notes.find((n) => n.id === noteId) : undefined
  // A note this pointed at was deleted out from under it (folder removed,
  // a sync merge). Fall back to a fresh draft rather than a dead id.
  useEffect(() => { if (noteId && !active) { noteIdRef.current = null; setNoteId(null) } }, [noteId, active])
  const note = active ?? { id: 'draft', body: draft.current }

  const onChange = (md: string) => {
    if (noteIdRef.current) { updateNote(noteIdRef.current, { body: md }); return }
    draft.current = md
    if (md.trim()) {
      const id = addNote(folderId, md)
      noteIdRef.current = id
      setNoteId(id)
    }
  }
  const fresh = () => { noteIdRef.current = null; setNoteId(null); draft.current = '' }
  const folderName = options.find((o) => o.id === folderId)?.name ?? 'Notes'
  const hasBody = (active?.body ?? draft.current).trim().length > 0

  return (
    <div className="znote">
      <div className="znote-head">
        <span className="znote-heading"><NoteIcon /> Note</span>
        <select
          className="znote-folder" value={folderId}
          onChange={(e) => { setFolderId(e.target.value); fresh() }}
          aria-label="Folder this note is saved to"
        >
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      <div className="znote-rich" aria-label={`Zone note, saved to ${folderName}`}>
        <Editor note={note} onChange={onChange} tools={['bold', 'italic', 'bullet']} plain />
      </div>
      <div className="znote-foot">
        <span className={`znote-status${hasBody ? ' is-saved' : ''}`}>{hasBody ? 'Saved' : 'Empty'}</span>
        <button className="znote-add" onClick={fresh} aria-label="New note" title="New note"><PlusIcon /></button>
      </div>
    </div>
  )
}

/* How deep into the block he is, 0 to 1. The room's ground colour is mixed
   from this, so twenty minutes in is visibly deeper water than the moment he
   sat down. Real elapsed minutes, nothing decorative: idle and break leave
   the room at the surface, because neither is being deep in anything.

   App.tsx reads this and puts it on the shell, not on the room: the shell is
   the element that paints the water AND holds the header, and a custom
   property set on the room could never have reached it, since they only
   inherit downward. Set here first, it did nothing at all. */
export function useZoneDepth(): number {
  const pomo = usePomodoro()
  if (pomo.phase !== 'focus') return 0
  const elapsed = pomo.blockMin * 60 - pomo.secondsLeft
  return Math.min(1, Math.max(0, elapsed / Math.max(1, pomo.blockMin * 60)))
}

export function ZonePage() {
  return (
    <div className="zroom">
      <ZoneTask />
      <div className="zroom-rail">
        <section className="zpanel zpanel-note" aria-label="Note"><ZoneNote /></section>
        <section className="zpanel zpanel-player" aria-label="Mundi Opus"><ZonePlayer /></section>
      </div>
    </div>
  )
}
