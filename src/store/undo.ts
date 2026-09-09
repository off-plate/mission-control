/* THE LAST DELETE, still takeable back. Split out of store.tsx (2026-09-09).
   Shared by every domain slice that deletes something: each one calls
   armUndo(label, restore) with its own restore closure, so this file never
   has to know what a task or a note or a routine actually is. */
import { useState } from 'react'
import { newId } from './shared'

export interface Undoable { id: string; label: string; restore: () => void }

export interface UndoSlice {
  /** The last delete, still takeable back. Null once it is taken back or expires. */
  undoable: Undoable | null
  armUndo: (label: string, restore: () => void) => void
  undoDelete: () => void
  dismissUndo: () => void
}

export function useUndo(): UndoSlice {
  /* Deliberately not persisted: a delete you can still undo after a reload is
     not a delete. */
  const [undoable, setUndoable] = useState<Undoable | null>(null)
  const armUndo = (label: string, restore: () => void): void => setUndoable({ id: newId('u'), label, restore })
  const undoDelete = (): void => { undoable?.restore(); setUndoable(null) }
  const dismissUndo = (): void => setUndoable(null)
  return { undoable, armUndo, undoDelete, dismissUndo }
}
