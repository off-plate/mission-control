import { useState } from 'react'
import { useStore } from './store'
import { useMundiOpus } from './mundiplayer'
import { MediaBadge, MediaChip, PomodoroBadge, PomodoroChip, usePomodoro } from './pomodoro'
import { NoteChip, NotePanel } from './notedock'
import * as Icon from './icons'

/* THE DOCK: a Material speed-dial FAB (his reference, 2026-09-01). Closed,
   one round button. Tapping it fans a labelled item out per tool, stacked
   upward -- Note on top, Focus closest to the corner, his order -- and the
   FAB itself becomes the X at the bottom of that stack; only the X closes
   it back down.

   Focus is not a third door into a big sheet the way Note is. His catch:
   opening it that way showed one real, working line -- "Focus 25m" -- sunk
   in a fixed 560x220 sheet built for a note, which read as broken rather
   than just small. And the whole point of the menu item, his words, is that
   tapping it "should be able to quickly turn on the 25 minute countdown" --
   one tap, not a second screen to then tap Start on again. So the Focus
   item acts immediately when nothing is running (starts it, closes the
   dial, done) and only opens something when there is a live block to
   manage -- and what it opens is sized to what PomodoroBadge actually is,
   not stretched to the Note sheet's shape.

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
  const p = usePomodoro()
  const [mode, setMode] = useState<Mode>('closed')

  /* The Zone already shows the timer, the player and a place to write at
     full size. A second, smaller copy of the same facts in the corner is
     not a safety net, it is noise competing with the one thing the room
     exists to make dominant. */
  if (page === 'zone') return null

  /* Note on top, Focus at the bottom, his order -- closest to the corner is
     the one he reaches for most. The player, when it exists at all, sits
     above both: rarest to need, so furthest from the thumb. */
  const tools: { id: Face; label: string; chip: React.ReactNode; switchIcon: React.ReactNode }[] = [
    ...(mo.started ? [{ id: 'media' as const, label: 'Player', chip: <MediaChip />, switchIcon: <Icon.Waveform size={15} /> }] : []),
    { id: 'note' as const, label: 'Note', chip: <NoteChip />, switchIcon: <Icon.Note size={15} /> },
    { id: 'focus' as const, label: 'Focus', chip: <PomodoroChip />, switchIcon: <Icon.Focus size={15} /> },
  ]

  const openTool = (id: Face) => {
    if (id === 'focus' && p.phase === 'idle') { p.startFocus(); setMode('closed'); return }
    setMode(id)
  }

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
            <button key={t.id} className="dock-item" onClick={() => openTool(t.id)}>
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

  /* Focus, once there IS a live block to show, still doesn't borrow Note's
     sheet -- it's content-sized (is-compact drops the fixed width/height),
     the same shape PomodoroBadge has always been. */
  return (
    <div className="dock">
      <div className={`dock-face${mode === 'focus' ? ' is-compact' : ''}`}>
        <div className="dock-facebar">
          {/* Jumping straight from one tool to another, not just back to the
              menu: the menu is one tap away, this is the one he'll reach
              for more. */}
          {tools.filter((t) => t.id !== mode).map((t) => (
            <button key={t.id} className="dock-icon" onClick={() => openTool(t.id)} aria-label={`Switch to ${t.label}`} title={t.label}>
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
