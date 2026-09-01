import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Editor, headOf, join, restOf } from './notes'
import { AutoTextarea } from './ui'
import { spaceFolderId } from './types'
import * as Icon from './icons'

/* THE FLOATING NOTE. His ask (2026-09-01): a chip in the corner dock (see
   dock.tsx) that opens the same island up into a full note, rather than
   navigating to a full page -- so jotting something down never costs
   leaving whatever he's looking at. It remembers the last note he had open
   (not just for the session: a real localStorage key, the same pattern
   PIN_KEY/SORT_KEY already use in notes.tsx) and reuses the Notes page's own
   Editor component untouched, so a note written from here reads identically
   if he later opens the full Notes page -- this is a second door into the
   same notes, not a second note-taking feature. */
const LAST_KEY = 'mc-notedock-last'

/* The compact read: an icon, nothing else. A note has no single glanceable
   fact the way a running timer has a countdown, so the collapsed chip
   doesn't try to invent one. */
export function NoteChip() {
  return <Icon.Note size={17} />
}

export function NotePanel() {
  const { space, inView, notes, addNote, updateNote, openNote, setPage } = useStore()
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_KEY) } catch { return null }
  })

  const mine = notes.filter((n) => inView(n.space)).sort((a, b) => b.updatedAt - a.updatedAt)
  const active = mine.find((n) => n.id === activeId) ?? null

  const persist = (id: string) => {
    setActiveId(id)
    try { localStorage.setItem(LAST_KEY, id) } catch { /* private mode */ }
  }

  /* This mounts the moment the island opens onto the note face, so this is
     the one place left to make sure there is something to show: the most
     recently touched note in view is a better first guess than an empty
     page, and only actually empty gets a fresh one. */
  useEffect(() => {
    if (active) return
    if (mine.length) { persist(mine[0].id); return }
    persist(addNote(spaceFolderId(space)))
    // Runs once, on mount only -- re-firing on every list change would
    // fight him every time a different note becomes the most recent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const newNote = () => persist(addNote(spaceFolderId(space)))

  return (
    <div className="notedock-panel">
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
        <button className="dock-icon" onClick={newNote} aria-label="New note" title="New note">
          <Icon.Plus size={16} />
        </button>
        <button
          className="dock-icon"
          onClick={() => { if (active) openNote(active.id); setPage('notes') }}
          aria-label="Open in Notes"
          title="Open in Notes"
        >
          <Icon.ExternalLink size={15} />
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
  )
}
