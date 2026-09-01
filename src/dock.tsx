import { useState } from 'react'
import { useStore } from './store'
import { useMundiOpus } from './mundiplayer'
import { MediaBadge, MediaChip, PomodoroInline } from './pomodoro'
import { NoteChip, NotePanel } from './notedock'
import * as Icon from './icons'

/* THE DOCK: a Material speed-dial FAB (his reference, 2026-09-01). Closed,
   one round button. Tapping it fans a labelled item out per tool, stacked
   upward -- Note on top, Focus closest to the corner, his order -- and the
   FAB itself becomes the X at the bottom of that stack; only the X closes
   it back down.

   Focus does not open anything, on his second correction of this same
   round: a first pass had it either auto-start a block on tap or open a
   content-sized popover, and neither was right -- "it's gonna live within
   that menu and be operated within that menu." Its row IS the control: the
   name, the live time, and a play/pause button sit right there, always,
   whenever the menu is open (see PomodoroInline in pomodoro.tsx). The
   circular icon next to it goes back to what it always did on the old pill
   -- opens the Focus history page -- since the timer itself has nothing
   left to open.

   Note and the player still open into the full-size face below (unchanged
   from earlier rounds) -- his word was only about Focus: "different story
   is for the notes... that's fine."

   Each tool still owns its own state and logic in its own file (usePomodoro,
   the notes store) and only hands this file what it needs to render.
   Rendered from inside PomodoroProvider (see pomodoro.tsx), which is what
   puts it inside both the Pomodoro context and the Store context it needs. */
type PanelFace = 'media' | 'note'
type Mode = 'closed' | 'menu' | PanelFace

export function Dock() {
  const { page, setPage } = useStore()
  const mo = useMundiOpus()
  const [mode, setMode] = useState<Mode>('closed')

  /* The Zone already shows the timer, the player and a place to write at
     full size. A second, smaller copy of the same facts in the corner is
     not a safety net, it is noise competing with the one thing the room
     exists to make dominant. */
  if (page === 'zone') return null

  /* Note on top, Focus at the bottom, his order -- closest to the corner is
     the one he reaches for most. The player, when it exists at all, sits
     above both: rarest to need, so furthest from the thumb. */
  const panels: { id: PanelFace; label: string; chip: React.ReactNode; switchIcon: React.ReactNode }[] = [
    ...(mo.started ? [{ id: 'media' as const, label: 'Player', chip: <MediaChip />, switchIcon: <Icon.Waveform size={15} /> }] : []),
    { id: 'note' as const, label: 'Note', chip: <NoteChip />, switchIcon: <Icon.Note size={15} /> },
  ]

  if (mode === 'closed') {
    return (
      <div className="dock">
        <button className="dock-fab" onClick={() => setMode('menu')} aria-label="Open quick tools">
          <Icon.Plus size={22} />
        </button>
      </div>
    )
  }

  if (mode === 'menu') {
    return (
      <div className="dock">
        <div className="dock-menu">
          {panels.map((t) => (
            <button key={t.id} className="dock-item" onClick={() => setMode(t.id)}>
              <span className="dock-item-label">{t.label}</span>
              <span className={`dock-item-avatar dock-item-avatar--${t.id}`}>{t.chip}</span>
            </button>
          ))}
          {/* Not a button: it holds two real controls of its own (play/pause,
              and the icon below), and a button can't nest inside a button --
              see the same note on weekplan-bar in styles.css from an earlier
              fix of the identical mistake. */}
          <div className="dock-item dock-item--focus">
            <span className="dock-item-label dock-item-label--focus">
              <PomodoroInline />
            </span>
            <button className="dock-item-avatar dock-item-avatar--focus" onClick={() => setPage('focus')} aria-label="Open the focus history" title="Open Focus">
              <Icon.BarChart size={18} />
            </button>
          </div>
        </div>
        <button className="dock-fab is-close" onClick={() => setMode('closed')} aria-label="Close quick tools">
          <Icon.Close size={20} />
        </button>
      </div>
    )
  }

  const other = panels.filter((t) => t.id !== mode)
  return (
    <div className="dock">
      <div className="dock-face">
        <div className="dock-facebar">
          {/* Jumping straight to the other panel, not just back to the menu:
              the menu is one tap away, this is the one he'll reach for more. */}
          {other.map((t) => (
            <button key={t.id} className="dock-icon" onClick={() => setMode(t.id)} aria-label={`Switch to ${t.label}`} title={t.label}>
              {t.switchIcon}
            </button>
          ))}
          <span className="dock-facebar-grow" />
          <button className="dock-icon" onClick={() => setMode('closed')} aria-label="Close" title="Close">
            <Icon.Close size={17} />
          </button>
        </div>
        {mode === 'media' && <MediaBadge />}
        {mode === 'note' && <NotePanel />}
      </div>
    </div>
  )
}
