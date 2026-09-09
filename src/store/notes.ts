/* NOTES. Split out of store.tsx (2026-09-09), the first domain pulled out of
   its 1,800-line StoreProvider into its own hook. Takes armUndo/bury/digUp
   as parameters rather than importing them: those three are genuinely
   shared across every domain that deletes something (tasks, contacts,
   routines, notes), so they live in their own slices (undo.ts,
   graveyard.ts) and are composed in from there, not owned here. */
import { useState } from 'react'
import { MOCK_IDEAS } from '../mock'
import { bodyHash, deviceId, HIST, rowKey } from '../sync-merge'
import { SPACES, spaceFolderId, type Note, type NoteFolder, type SpaceId } from '../types'
import { localDateKey } from '../util'
import { newId, todayKey } from './shared'

/* The first line of a note is its title, the way it is in every notes app worth
   using: no second field to fill in, nothing to keep in step with the text, and
   an untitled note is simply one whose first line is short. Cached on the row so
   the list and the search do not re-derive it for every note on every keystroke. */
export function noteTitle(body: string): string {
  const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return first.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+(\[[ xX]\]\s*)?/, '').slice(0, 120)
}

/** Which workspace a folder belongs to. A workspace folder says so in its id;
 *  one he made says so on the row. Either way there is one answer, and a note's
 *  workspace is read from here rather than being a second thing to keep in step. */
function spaceOfFolder(id: string, folders: NoteFolder[]): SpaceId | null {
  const m = id.match(/^nf-space-(.+)$/)
  if (m && (SPACES as string[]).includes(m[1])) return m[1] as SpaceId
  return folders.find((f) => f.id === id)?.space ?? null
}

/* What a profile that has never saved anything starts with. The seeded stickies
   become notes on exactly the terms the migration uses, so a fresh install and a
   migrated one are the same shape. */
export function seedNoteFolders(): NoteFolder[] {
  const spaces = [...new Set(MOCK_IDEAS.map((i) => i.space))]
  return spaces.map((s) => ({ id: `nf-braindump-${s}`, space: s, name: 'Brain dumps', parentId: spaceFolderId(s), order: 0 }))
}

export function seedNotes(): Note[] {
  return MOCK_IDEAS.map((i) => ({
    id: `note-${i.id}`,
    space: i.space,
    folderId: `nf-braindump-${i.space}`,
    title: noteTitle(i.text),
    body: i.text,
    color: i.color,
    when: localDateKey(),
    updatedAt: Date.now(),
  }))
}

export interface NotesSlice {
  notes: Note[]
  setNotes: (next: Note[]) => void
  noteFolders: NoteFolder[]
  setNoteFolders: (next: NoteFolder[]) => void
  addNote: (folderId: string, body?: string) => string
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>) => void
  setNoteDone: (id: string, done: boolean) => void
  moveNote: (id: string, folderId: string) => void
  deleteNote: (id: string) => void
  keepNoteConflict: (id: string) => void
  dropNoteConflict: (id: string) => void
  addNoteFolder: (space: SpaceId, name: string) => string
  renameNoteFolder: (id: string, name: string) => void
  deleteNoteFolder: (id: string) => void
  renameNoteTag: (from: string, to: string) => void
}

export function useNotesSlice(
  persisted: { notes?: Note[]; noteFolders?: NoteFolder[] } | null,
  deps: { space: SpaceId; armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): NotesSlice {
  const { space, armUndo, bury, digUp } = deps
  const [notes, setNotes] = useState<Note[]>(persisted?.notes ?? seedNotes())
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>(persisted?.noteFolders ?? seedNoteFolders())

  const addNote = (folderId: string, body = ''): string => {
    const id = newId('note')
    const sp = spaceOfFolder(folderId, noteFolders) ?? space
    setNotes((prev) => [{
      id, space: sp, folderId, title: noteTitle(body), body,
      color: 'amber', when: todayKey(), updatedAt: Date.now(), hist: [], dev: deviceId(),
    }, ...prev])
    return id
  }

  /* Every body this note has had leaves its hash behind. That trail is what
     lets a merge on another device tell "I am behind" from "we both wrote",
     so the cost of keeping it is one small string per edit. */
  const updateNote = (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'color' | 'pinned'>>): void => setNotes((prev) => prev.map((n) => {
    if (n.id !== id) return n
    const bodyChanged = patch.body !== undefined && patch.body !== n.body
    return {
      ...n, ...patch,
      title: patch.body !== undefined ? noteTitle(patch.body) : n.title,
      hist: bodyChanged ? [...(n.hist ?? []), bodyHash(n.body)].slice(-HIST) : n.hist,
      /* Who wrote it last. A merge uses this to tell this device's own
         earlier push from a genuinely different device, which is the whole
         of the "another device" question. */
      dev: deviceId(),
      updatedAt: Date.now(),
    }
  }))

  /* Filing a note keeps the note where it was written. It used to adopt the
     folder's workspace, which is how a note moved into a folder made in
     Michael's Corner quietly became a Corner note. Folders are folders now:
     they hold notes, they do not reassign them.
     Ticking a note is not an edit of its text, so it does not touch hist or
     the body. It does stamp updatedAt, because a note that just changed state
     has changed and the list should feel it. Unpinned on the way out: a done
     note holding a pinned slot at the top is exactly the clutter this removes. */
  const setNoteDone = (id: string, done: boolean): void => setNotes((prev) => prev.map((n) => (n.id === id
    ? { ...n, done: done ? Date.now() : undefined, pinned: done ? false : n.pinned, dev: deviceId(), updatedAt: Date.now() }
    : n)))
  const moveNote = (id: string, folderId: string): void => setNotes((prev) => prev.map((n) => (n.id === id
    ? { ...n, folderId, updatedAt: Date.now() }
    : n)))
  const deleteNote = (id: string): void => {
    const before = notes
    setNotes((prev) => prev.filter((n) => n.id !== id))
    bury(rowKey('notes', { id }))
    armUndo('Note deleted', () => { setNotes(before); digUp(rowKey('notes', { id })) })
  }

  /* The other device's paragraph joins this one under a rule, rather than him
     having to copy it out by hand before it can be dismissed. */
  const keepNoteConflict = (id: string): void => setNotes((prev) => prev.map((n) => (n.id === id && n.conflict
    ? {
      ...n,
      body: `${n.body}\n\n--- from another device ---\n${n.conflict.body}`,
      title: n.title,
      hist: [...(n.hist ?? []), bodyHash(n.body), bodyHash(n.conflict.body)].slice(-HIST), dev: deviceId(),
      conflict: undefined,
      updatedAt: Date.now(),
    }
    : n)))
  const dropNoteConflict = (id: string): void => setNotes((prev) => prev.map((n) => (n.id === id
    ? { ...n, conflict: undefined, hist: [...(n.hist ?? []), ...(n.conflict ? [bodyHash(n.conflict.body)] : [])].slice(-HIST), dev: deviceId(), updatedAt: Date.now() }
    : n)))

  const addNoteFolder = (sp: SpaceId, name: string): string => {
    const id = newId('nf')
    const order = noteFolders.filter((f) => f.space === sp).length
    setNoteFolders((prev) => [...prev, { id, space: sp, name: name.trim() || 'New folder', parentId: spaceFolderId(sp), order }])
    return id
  }
  const renameNoteFolder = (id: string, name: string): void => setNoteFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)))
  /* Deleting a shelf does not burn the books: its notes go up to the workspace
     folder, where he can still find every one of them. */
  const deleteNoteFolder = (id: string): void => {
    const folder = noteFolders.find((f) => f.id === id)
    if (!folder) return
    const beforeFolders = noteFolders
    const beforeNotes = notes
    setNoteFolders((prev) => prev.filter((f) => f.id !== id))
    setNotes((prev) => prev.map((n) => (n.folderId === id ? { ...n, folderId: folder.parentId, updatedAt: Date.now() } : n)))
    bury(rowKey('noteFolders', { id }))
    const moved = notes.filter((n) => n.folderId === id).length
    armUndo(moved ? `Folder deleted, ${moved} ${moved === 1 ? 'note' : 'notes'} moved up` : 'Folder deleted', () => {
      setNoteFolders(beforeFolders); setNotes(beforeNotes); digUp(rowKey('noteFolders', { id }))
    })
  }
  const renameNoteTag = (from: string, to: string): void => {
    const clean = to.replace(/^#/, '').replace(/[^\p{L}\d_/-]/gu, '')
    if (!clean) return
    /* Not \b: that boundary is spelled in ASCII, so #test would reach inside
       #testů and rename half a Czech word. The lookahead asks the real
       question, which is whether the tag actually ends there. */
    const esc = from.replace(/^#/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`#${esc}(?![\\p{L}\\d_/-])`, 'giu')
    setNotes((prev) => prev.map((n) => {
      const body = n.body.replace(re, `#${clean}`)
      if (body === n.body) return n
      return { ...n, body, title: noteTitle(body), hist: [...(n.hist ?? []), bodyHash(n.body)].slice(-HIST), dev: deviceId(), updatedAt: Date.now() }
    }))
  }

  return {
    notes, setNotes, noteFolders, setNoteFolders,
    addNote, updateNote, setNoteDone, moveNote, deleteNote,
    keepNoteConflict, dropNoteConflict,
    addNoteFolder, renameNoteFolder, deleteNoteFolder, renameNoteTag,
  }
}
