/* THE BUSINESS VIEW's data: one row per prospect, its people and touches
   inside it. Deleting buries the row like every other deletion. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { Prospect, ProspectTouch } from '../types'
import { newId } from './shared'

export type ProspectInput = Pick<Prospect, 'name' | 'source'> & Partial<Pick<Prospect, 'domain' | 'stage' | 'value' | 'why' | 'notes' | 'people'>>
export type ProspectPatch = Partial<Omit<Prospect, 'id' | 'createdAt' | 'updatedAt' | 'touches'>>

export interface ProspectsSlice {
  prospects: Prospect[]
  setProspects: (next: Prospect[]) => void
  addProspect: (p: ProspectInput) => string
  updateProspect: (id: string, patch: ProspectPatch) => void
  deleteProspect: (id: string) => void
  /** Logging the first touch moves a prospect out of To reach out. */
  logTouch: (id: string, touch: Omit<ProspectTouch, 'id'>) => void
  removeTouch: (id: string, touchId: string) => void
}

export function useProspectsSlice(
  persisted: { prospects?: Prospect[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): ProspectsSlice {
  const { armUndo, bury, digUp } = deps
  const [prospects, setProspects] = useState<Prospect[]>(persisted?.prospects ?? [])
  const edit = (id: string, f: (p: Prospect) => Prospect) =>
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...f(p), updatedAt: Date.now() } : p)))

  const addProspect = (p: ProspectInput): string => {
    const id = newId('prospect')
    const now = Date.now()
    setProspects((prev) => [...prev, { stage: 'reach', people: [], ...p, id, name: p.name.trim(), touches: [], createdAt: now, updatedAt: now }])
    return id
  }
  const updateProspect = (id: string, patch: ProspectPatch): void => edit(id, (p) => ({ ...p, ...patch }))
  const deleteProspect = (id: string): void => {
    const before = prospects
    const key = rowKey('prospects', { id })
    setProspects((prev) => prev.filter((p) => p.id !== id))
    bury(key)
    armUndo('Prospect removed', () => { setProspects(before); digUp(key) })
  }
  const logTouch = (id: string, touch: Omit<ProspectTouch, 'id'>): void => edit(id, (p) => ({
    ...p,
    stage: p.stage === 'reach' ? 'contacted' : p.stage,
    touches: [...p.touches, { ...touch, id: newId('touch') }],
  }))
  const removeTouch = (id: string, touchId: string): void => edit(id, (p) => ({ ...p, touches: p.touches.filter((t) => t.id !== touchId) }))

  return { prospects, setProspects, addProspect, updateProspect, deleteProspect, logTouch, removeTouch }
}
