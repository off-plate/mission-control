/* THE ZONE. Full screen, header still reachable above it: a dashboard for the
   one thing running right now, built out of the same widget he already
   knows from Today rather than a bespoke "calm room" look of its own. His
   words, after the first version: "I told you to create widgets. Inspire
   yourself by today's section... it's supposed to be full screen dashboard."

   Fourth pass: he sent four reference screenshots (a ring pomodoro app, a
   notes card, a prayer-times clock, a glass media player) and asked each
   tile to look like its reference, adapted to what this app actually does.
   Nothing here is decoration borrowed wholesale: the ring reads real
   progress, the dots read real cycle count, the settings panel edits real
   minutes, the daypart arc reads the real clock, repeat and shuffle are
   real toggles. What has no real data behind it in this app (a "publish"
   step notes already autosave past, a "liked" badge with nothing backing
   it) was left out rather than faked. */

import { useEffect, useState, type ReactNode } from 'react'
import { AutoTextarea, useClockStamp, useFirstMove, useOpenToday } from './ui'
import { usePomodoro } from './pomodoro'
import { ZonePlayer } from './zoneplayer'
import { useStore } from './store'
import { isEstimated, taskMinutes } from './util'
import { SPACE_LABELS } from './mock'
import { spaceFolderId } from './types'

const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

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
      <span className="znow-title">{title}</span>
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
            <PhaseIcon state={phaseState} />
            <span className="znow-clock mono">{clockText}</span>
            <div className="znow-dots" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < filledDots ? 'is-on' : ''} />)}
            </div>
            <span className="znow-label">{label}</span>
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
  return (
    <div className={`zclock zclock-${part}`}>
      <div className="zclock-arc" aria-hidden="true">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none"><path d="M4 36 Q100 -12 196 36" /></svg>
        <div className="zclock-marks">
          {(['morning', 'day', 'evening', 'night'] as const).map((p) => <span key={p} className={p === part ? 'is-now' : ''} />)}
        </div>
      </div>
      <span className="zclock-part">{DAYPART_LABEL[part]}</span>
      <span className="zclock-time mono">{now.time}</span>
      <span className="zclock-date">{now.day}, {now.date}</span>
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
  const folderName = options.find((o) => o.id === folderId)?.name ?? 'Notes'

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
      <AutoTextarea
        className="textinput znote-area"
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Whatever is worth keeping from this block…"
        minRows={4}
        maxRows={40}
        aria-label={`Zone note, saved to ${folderName}`}
      />
      <div className="znote-foot">
        <span className={`znote-status${body.trim() ? ' is-saved' : ''}`}>{body.trim() ? 'Saved' : 'Empty'}</span>
        <button className="znote-add" onClick={fresh} aria-label="New note" title="New note"><PlusIcon /></button>
      </div>
    </div>
  )
}

export function ZonePage() {
  return (
    <div className="zonepage zw-grid">
      <ZoneTile title="Now" className="zw-now"><ZoneTask /></ZoneTile>
      <ZoneTile title="Clock" className="zw-clock"><ZoneClock /></ZoneTile>
      <ZoneTile title="Note" className="zw-note-tile"><ZoneNote /></ZoneTile>
      <ZoneTile title="Mundi Opus" className="zw-player-tile"><ZonePlayer /></ZoneTile>
    </div>
  )
}
