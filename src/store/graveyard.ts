/* TOMBSTONES for the sync merge. Split out of store.tsx (2026-09-09). A key
   buried here tells a merge from another device that this row was deleted
   on purpose, not merely absent; dug up again if he undoes the delete, so a
   device that still holds the old tombstone does not re-bury it on its next
   save. Persisted (part of PersistedState in store.tsx), because a device
   that was offline when something was deleted still has to hear about it
   the next time it syncs. */
import { useState } from 'react'
import type { Tomb } from '../sync-merge'

export interface GraveyardSlice {
  graveyard: Tomb[]
  /** Exposed for applyExternal in store.tsx: a graveyard that arrives from
   *  another device replaces this one outright, the same as every other
   *  incoming array. */
  setGraveyard: (next: Tomb[]) => void
  bury: (...keys: string[]) => void
  digUp: (...keys: string[]) => void
}

export function useGraveyard(persistedGraveyard: Tomb[] | undefined): GraveyardSlice {
  const [graveyard, setGraveyard] = useState<Tomb[]>(persistedGraveyard ?? [])
  const bury = (...keys: string[]): void =>
    setGraveyard((g) => [...g.filter((t) => !keys.includes(t.k)), ...keys.map((k) => ({ k, at: Date.now() }))].slice(-900))
  /* Not a removal: a dated opposite. Another device that still holds the
     tombstone would otherwise re-bury this the next time it saved anything. */
  const digUp = (...keys: string[]): void =>
    setGraveyard((g) => [...g.filter((t) => !keys.includes(t.k)), ...keys.map((k) => ({ k, at: Date.now(), undone: true }))].slice(-900))
  return { graveyard, setGraveyard, bury, digUp }
}
