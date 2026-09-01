import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { Editor, headOf, join, restOf } from './notes'
import { AutoTextarea, Select } from './ui'
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

export function NotePanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
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
        {/* The app's own custom dropdown, never the OS one -- the house rule
           the native <select> here was quietly breaking. Same component
           WriteTo and everything else in Notes already builds its pickers
           from. */}
        <Select
          className="notedock-switch"
          value={active?.id ?? ''}
          onChange={(id) => persist(id)}
          options={mine.length ? mine.map((n) => ({ value: n.id, label: headOf(n.body) || 'Untitled' })) : [{ value: '', label: 'Untitled' }]}
          ariaLabel="Switch note"
        />
        <button className="dock-icon" onClick={newNote} aria-label="New note" title="New note">
          <Icon.Plus size={16} />
        </button>
        {/* Bright on purpose, unlike the quiet icon buttons beside it -- his
           ask (2026-09-02): the same accent fill the Zone and Assistant
           buttons wear in the header, so the one control that leaves the
           note behind entirely is never mistaken for a quiet toggle. The
           real .btn.btn-primary classes, not a hand-rolled background --
           his first pass at this button read as dark olive instead of lime
           for the exact reason the FAB once did (see the --accent note in
           styles.css): --accent is deliberately the muted, readable-as-TEXT
           partner, and only --a-accent is the loud literal fill. .btn-primary
           already carries the fix (and the hover wipe, and HUD's own text
           colour) -- reinventing it here just reintroduced the same bug.

           onOpenFull (from dock.tsx) folds the dock back to the bare FAB the
           moment this fires -- his ask (2026-09-02): this button is a quick
           door OUT to the full Notes page, not a bookmark to leave sitting
           open behind it once he's actually there working. */}
        <button
          className="btn btn-primary dock-open-btn"
          onClick={() => { if (active) openNote(active.id); setPage('notes'); onOpenFull?.() }}
          title="Open in Notes"
        >
          <Icon.ExternalLink size={13} />
          Notes
        </button>
        {/* The dock's own switch/close controls, folded into this same row
           on his correction (2026-09-01): they used to sit in a separate
           bar above this one, nearly empty on its own. */}
        {dockControls}
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
