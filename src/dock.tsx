import { useState } from 'react'
import { useStore } from './store'
import { useMundiOpus } from './mundiplayer'
import { MediaBadge, MediaChip, PomodoroBadge, PomodoroChip } from './pomodoro'
import { NoteChip, NotePanel } from './notedock'
import * as Icon from './icons'

/* THE ISLAND. Focus, the player and the note used to each mount their own
   fixed pill in the corner -- three stacked, separately-shaped boxes. His
   word (2026-09-01): one dynamic, fluid dock instead, that morphs between a
   compact row of glanceable chips and one tool's full surface, the way it
   would for any tool added here later. This file owns the fixed corner
   position and the open/closed shape; each tool still owns its own state
   and logic in its own file (usePomodoro, the notes store) and only hands
   this file a chip (collapsed) and a full view (expanded).

   Rendered from inside PomodoroProvider (see pomodoro.tsx), which is what
   puts it inside both the Pomodoro context and the Store context it needs. */
type Face = 'media' | 'focus' | 'note'

export function Dock() {
  const { page } = useStore()
  const mo = useMundiOpus()
  const [active, setActive] = useState<Face | null>(null)

  /* The Zone already shows the timer, the player and a place to write at
     full size. A second, smaller copy of the same facts in the corner is
     not a safety net, it is noise competing with the one thing the room
     exists to make dominant. */
  if (page === 'zone') return null

  if (active) {
    return (
      <div className="dock is-open">
        <div className="dock-face">
          <div className="dock-facebar">
            {/* Jumping straight from one tool to another, not just back to
                the row: the row is one more tap away, this is the one he'll
                reach for more. */}
            {mo.started && active !== 'media' && (
              <button className="dock-icon" onClick={() => setActive('media')} aria-label="Switch to the player" title="Player">
                <Icon.Waveform size={15} />
              </button>
            )}
            {active !== 'focus' && (
              <button className="dock-icon" onClick={() => setActive('focus')} aria-label="Switch to Focus" title="Focus">
                <Icon.Focus size={15} />
              </button>
            )}
            {active !== 'note' && (
              <button className="dock-icon" onClick={() => setActive('note')} aria-label="Switch to the note" title="Note">
                <Icon.Note size={15} />
              </button>
            )}
            <span className="dock-facebar-grow" />
            <button className="dock-icon" onClick={() => setActive(null)} aria-label="Collapse" title="Collapse">
              <Icon.ChevronDown size={17} />
            </button>
          </div>
          {active === 'media' && <MediaBadge />}
          {active === 'focus' && <PomodoroBadge />}
          {active === 'note' && <NotePanel />}
        </div>
      </div>
    )
  }

  return (
    <div className="dock">
      <div className="dock-row">
        {mo.started && (
          <button className="dock-chip" onClick={() => setActive('media')} aria-label="Open the player">
            <MediaChip />
          </button>
        )}
        <button className="dock-chip" onClick={() => setActive('focus')} aria-label="Open Focus">
          <PomodoroChip />
        </button>
        <button className="dock-chip" onClick={() => setActive('note')} aria-label="Open the quick note">
          <NoteChip />
        </button>
      </div>
    </div>
  )
}
