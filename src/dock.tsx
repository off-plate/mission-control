import { useState } from 'react'
import { useStore } from './store'
import { useMundiOpus } from './mundiplayer'
import { MediaBadge, MediaChip, PomodoroBadge, PomodoroChip } from './pomodoro'
import { NoteChip, NotePanel } from './notedock'
import * as Icon from './icons'

/* THE DOCK, redesigned per his reference (2026-09-01) after the first pass
   (a single pill that morphed its own content) missed what he was actually
   picturing: the Material speed-dial FAB. Closed, it is one round button.
   Tapping it fans a labelled item out per tool, stacked upward, and the FAB
   itself becomes the X at the bottom of that stack -- tapping the X (not a
   tool) is the only way back to closed. Tapping a tool item opens ITS full
   surface in the same corner; from there, its own bar can jump straight to
   a different tool or close altogether.

   Each tool still owns its own state and logic in its own file (usePomodoro,
   the notes store) and only hands this file a chip (for the menu row) and a
   full view (for the open face). Rendered from inside PomodoroProvider (see
   pomodoro.tsx), which is what puts it inside both the Pomodoro context and
   the Store context it needs. */
type Face = 'media' | 'focus' | 'note'
type Mode = 'closed' | 'menu' | Face

export function Dock() {
  const { page } = useStore()
  const mo = useMundiOpus()
  const [mode, setMode] = useState<Mode>('closed')

  /* The Zone already shows the timer, the player and a place to write at
     full size. A second, smaller copy of the same facts in the corner is
     not a safety net, it is noise competing with the one thing the room
     exists to make dominant. */
  if (page === 'zone') return null

  const tools: { id: Face; label: string; chip: React.ReactNode; switchIcon: React.ReactNode }[] = [
    ...(mo.started ? [{ id: 'media' as const, label: 'Player', chip: <MediaChip />, switchIcon: <Icon.Waveform size={15} /> }] : []),
    { id: 'focus' as const, label: 'Focus', chip: <PomodoroChip />, switchIcon: <Icon.Focus size={15} /> },
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
          {tools.map((t) => (
            <button key={t.id} className="dock-item" onClick={() => setMode(t.id)}>
              <span className="dock-item-label">{t.label}</span>
              <span className={`dock-item-avatar dock-item-avatar--${t.id}`}>{t.chip}</span>
            </button>
          ))}
        </div>
        <button className="dock-fab is-close" onClick={() => setMode('closed')} aria-label="Close quick tools">
          <Icon.Close size={20} />
        </button>
      </div>
    )
  }

  return (
    <div className="dock">
      <div className="dock-face">
        <div className="dock-facebar">
          {/* Jumping straight from one tool to another, not just back to the
              menu: the menu is one tap away, this is the one he'll reach
              for more. */}
          {tools.filter((t) => t.id !== mode).map((t) => (
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
        {mode === 'focus' && <PomodoroBadge />}
        {mode === 'note' && <NotePanel />}
      </div>
    </div>
  )
}
