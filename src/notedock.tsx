import { useState } from 'react'
import { useStore } from './store'
import { Editor, headOf, join, restOf } from './notes'
import { AutoTextarea } from './ui'
import { spaceFolderId } from './types'
import * as Icon from './icons'

/* THE FLOATING NOTE. His ask (2026-09-01): a pill at the bottom-right, the
   same corner the Focus timer already owns, that opens upward into a panel
   rather than navigating to a full page -- so jotting something down never
   costs leaving whatever he's looking at. It remembers the last note he had
   open (not just for the session: a real localStorage key, the same pattern
   PIN_KEY/SORT_KEY already use in notes.tsx) and reuses the Notes page's own
   Editor component untouched, so a note written from here reads identically
   if he later opens the full Notes page -- this is a second door into the
   same notes, not a second note-taking feature. */
const LAST_KEY = 'mc-notedock-last'

export function NoteDock() {
  const { page, space, inView, notes, addNote, updateNote, openNote, setPage } = useStore()
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_KEY) } catch { return null }
  })

  /* The Zone is a room, not a tab (see pomodoro.tsx's own PomodoroDock): a
     second floating control competing with an immersive full-bleed page is
     noise, not help. */
  if (page === 'zone') return null

  const mine = notes.filter((n) => inView(n.space)).sort((a, b) => b.updatedAt - a.updatedAt)
  const active = mine.find((n) => n.id === activeId) ?? null

  const persist = (id: string) => {
    setActiveId(id)
    try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  }

  const openDock = () => {
    setOpen(true)
    if (active) return
    /* No valid last note -- never opened one here, or it was deleted since.
       The most recently touched note in view is a better first guess than an
       empty page; only actually empty gets a fresh one. */
    if (mine.length) { persist(mine[0].id); return }
    persist(addNote(spaceFolderId(space)))
  }

  const newNote = () => persist(addNote(spaceFolderId(space)))

  return (
    <div className={`notedock${open ? ' is-open' : ''}`}>
      {open ? (
        <div className="notedock-panel" role="dialog" aria-label="Quick note">
          <div className="notedock-head">
            <select
              className="notedock-switch"
              value={active?.id ?? ''}
              onChange={(e) => persist(e.target.value)}
              aria-label="Switch note"
            >
              {mine.length === 0 && <option value="">Untitled</option>}
              {mine.map((n) => <option key={n.id} value={n.id}>{headOf(n.body) || 'Untitled'}</option>)}
            </select>
            <button className="notedock-icon" onClick={newNote} aria-label="New note" title="New note">
              <Icon.Plus size={16} />
            </button>
            <button
              className="notedock-icon"
              onClick={() => { if (active) openNote(active.id); setPage('notes') }}
              aria-label="Open in Notes"
              title="Open in Notes"
            >
              <Icon.ExternalLink size={15} />
            </button>
            <button className="notedock-icon" onClick={() => setOpen(false)} aria-label="Minimize" title="Minimize">
              <Icon.ChevronDown size={17} />
            </button>
          </div>
          <div className="notedock-body">
            {active ? (
              <Editor
                note={active}
                onChange={(md) => updateNote(active.id, { body: join(headOf(active.body), md) })}
                slashHelp
                slashTask
              >
                <AutoTextarea
                  className="notedock-title" minRows={1} maxRows={4} value={headOf(active.body)}
                  placeholder="Untitled" aria-label="Note title"
                  onChange={(e) => updateNote(active.id, { body: join(e.target.value.replace(/\n/g, ' '), restOf(active.body)) })}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                />
              </Editor>
            ) : <p className="notedock-empty">No notes yet.</p>}
          </div>
        </div>
      ) : (
        <button className="notedock-pill" onClick={openDock} aria-label="Open quick note">
          <Icon.Note size={17} />
          Note
        </button>
      )}
    </div>
  )
}
