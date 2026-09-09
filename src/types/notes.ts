import type { SpaceId } from './core'

/** A sticky note on the old Brain Dump board. Kept only so a state saved before
 *  Notes existed can still be read and carried across; nothing writes one now. */
export interface Idea {
  id: string
  /** Which space this note belongs to. */
  space: SpaceId
  text: string
  when: string
  color: string
}

/* ---- Notes ----------------------------------------------------------------
   Two levels, and only two. The top level is one folder per workspace and it is
   NOT stored: it is computed from the spaces that exist. That way a workspace
   added later has its folder the moment it exists, two devices cannot each
   invent their own copy of the same folder, and there is no way to delete the
   floor a note is standing on. Everything in `noteFolders` is a folder he made
   himself, and every one of them names its workspace folder as its parent. */

/** The id of a workspace's top-level folder. Derived, never stored. */
export const spaceFolderId = (s: SpaceId) => `nf-space-${s}`

/** A folder he made, always inside a workspace folder. */
export interface NoteFolder {
  id: string
  space: SpaceId
  name: string
  /** The workspace folder it sits in. Always set: nothing nests deeper. */
  parentId: string
  order?: number
}

/** A note. Tags are NOT a field: they are read out of `body` every time it
 *  renders, so the text he typed is the only place a tag lives and the two can
 *  never drift apart. */
export interface Note {
  id: string
  /** Follows the folder. The folder decides the space; the row caches it. */
  space: SpaceId
  folderId: string
  title: string
  body: string
  color: string
  /** The day it was written. */
  when: string
  updatedAt: number
  pinned?: boolean
  /** When he ticked it off, as a timestamp. A note is a thing to deal with as
   *  often as it is a thing to keep, so ticking one files it under Done and
   *  takes it out of every other list. A number, not a flag, so the merge keeps
   *  the later word when two devices disagree and Done can sort by when. */
  done?: number
  /** Short hashes of the bodies this note has already had, oldest first. This is
   *  what lets the merge tell a copy that is merely behind from one that has
   *  genuinely diverged, instead of crying conflict on every ordinary save. */
  hist?: string[]
  /** A body from another device that lost the merge. Kept on the note, shown,
   *  and dropped only when he says so. Work is never the loser. */
  conflict?: { body: string; at: number }
  /** Which install wrote this note last. A merge between two copies carrying
   *  the SAME id is one device catching up with itself, never a conflict. */
  dev?: string
}

