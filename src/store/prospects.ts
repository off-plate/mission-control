/* THE BUSINESS VIEW's data: one row per prospect, its people and touches
   inside it. Deleting buries the row like every other deletion. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { Prospect, ProspectTouch } from '../types'
import { newId } from './shared'
import { applyEvents, applySheet, normProspects, stageRank, type OutreachEvent, type SheetRow } from '../prospectcalc'

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
  applyOutreach: (events: OutreachEvent[]) => string[]
  /** The Sheet snapshot /eco-sync sent. Returns how many cards it changed or added. */
  applySheetRows: (rows: SheetRow[], buried: (id: string) => boolean) => number
}

export function useProspectsSlice(
  persisted: { prospects?: Prospect[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): ProspectsSlice {
  const { armUndo, bury, digUp } = deps
  /* Every way in goes through normProspects, so a card saved with the old five
     lanes (here or on another device) arrives with its Sheet status. */
  const [prospects, setRaw] = useState<Prospect[]>(() => normProspects(persisted?.prospects ?? []))
  const setProspects = (next: Prospect[] | ((prev: Prospect[]) => Prospect[])): void =>
    setRaw((prev) => normProspects(typeof next === 'function' ? next(prev) : next))
  const edit = (id: string, f: (p: Prospect) => Prospect) =>
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...f(p), updatedAt: Date.now() } : p)))

  const addProspect = (p: ProspectInput): string => {
    const id = newId('prospect')
    const now = Date.now()
    setProspects((prev) => [...prev, { stage: 'Email to prepare', people: [], ...p, id, name: p.name.trim(), touches: [], createdAt: now, updatedAt: now }])
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
    stage: stageRank(p.stage) < stageRank('Contacted') ? 'Contacted' : p.stage,
    touches: [...p.touches, { ...touch, id: newId('touch') }],
  }))
  const removeTouch = (id: string, touchId: string): void => edit(id, (p) => ({ ...p, touches: p.touches.filter((t) => t.id !== touchId) }))
  /* Gmail sync events become touches through the same state as everything he
     logs, so they sync and merge like his own edits. Returns the ids done with. */
  const applyOutreach = (events: OutreachEvent[]): string[] => {
    /* Applied inside the updater, against the latest rows rather than this
       render's copy: it runs right after a pull from another device. Safe to
       run twice, touch ids come from the Gmail message id. */
    const { done } = applyEvents(prospects, events)
    if (done.length) setProspects((prev) => applyEvents(prev, events).prospects)
    return done
  }

  const applySheetRows = (rows: SheetRow[], buried: (id: string) => boolean): number => {
    const { changed, added } = applySheet(prospects, rows, Date.now(), buried)
    if (changed + added) setProspects((prev) => applySheet(prev, rows, Date.now(), buried).prospects)
    return changed + added
  }

  return { prospects, setProspects, applySheetRows, addProspect, updateProspect, deleteProspect, logTouch, removeTouch, applyOutreach }
}
