/* THE IDEAS BOARD. The backlog of projects he has in mind and no time for
   yet, as stickies he can leave anywhere on a board.

   Its own synced collection, not the legacy `ideas` array: those were the old
   Brain Dump stickies, carried into Notes on 2026-08-03 and kept only so an old
   bundle does not render an empty board. Reading them here would put every one
   of them on a board a second time.

   Deleting buries the row like every other deletion, so a device that has not
   heard about it yet cannot merge it back. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { IdeaCard } from '../types'
import { newId } from './shared'

/** The sticky's footprint on the board at zoom 1. Height is the minimum; a
 *  long note grows, and placement only needs to avoid the obvious overlap. */
export const IDEA_W = 220
export const IDEA_H = 150

export type IdeaInput = { title: string; body?: string; color?: string; x: number; y: number }
type IdeaPatch = Partial<Pick<IdeaCard, 'title' | 'body' | 'color' | 'x' | 'y'>>

export interface IdeaBoardSlice {
  ideaBoard: IdeaCard[]
  setIdeaBoard: (next: IdeaCard[]) => void
  addIdeaCard: (card: IdeaInput) => string
  updateIdeaCard: (id: string, patch: IdeaPatch) => void
  deleteIdeaCard: (id: string) => void
}

export function useIdeaBoardSlice(
  persisted: { ideaBoard?: IdeaCard[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): IdeaBoardSlice {
  const { armUndo, bury, digUp } = deps
  const [ideaBoard, setIdeaBoard] = useState<IdeaCard[]>(persisted?.ideaBoard ?? [])

  const addIdeaCard = (c: IdeaInput): string => {
    const id = newId('idea')
    const now = Date.now()
    setIdeaBoard((prev) => [...prev, {
      id, title: c.title.trim(), body: (c.body ?? '').trim(), color: c.color ?? 'amber',
      x: Math.round(c.x), y: Math.round(c.y), createdAt: now, updatedAt: now,
    }])
    return id
  }

  const updateIdeaCard = (id: string, patch: IdeaPatch): void => setIdeaBoard((prev) => prev.map((c) => (c.id === id
    ? {
      ...c, ...patch,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.x !== undefined ? { x: Math.round(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: Math.round(patch.y) } : {}),
      updatedAt: Date.now(),
    }
    : c)))

  const deleteIdeaCard = (id: string): void => {
    const before = ideaBoard
    setIdeaBoard((prev) => prev.filter((c) => c.id !== id))
    bury(rowKey('ideaBoard', { id }))
    armUndo('Idea deleted', () => { setIdeaBoard(before); digUp(rowKey('ideaBoard', { id })) })
  }

  return { ideaBoard, setIdeaBoard, addIdeaCard, updateIdeaCard, deleteIdeaCard }
}
