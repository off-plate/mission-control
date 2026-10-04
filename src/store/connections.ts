/* CONNECTIONS. Split out of store.tsx (2026-09-10). Now only the legacy
   braindump ideas list: no UI reads it, but it is the input to the
   fix:notes-v1 migration and still merges for older bundles. The social feed
   and linked-sources fields went with the widget grid (2026-10-04). */
import { useState } from 'react'
import { MOCK_IDEAS } from '../mock'
import type { Idea } from '../types'

export interface ConnectionsSlice {
  ideas: Idea[]
  setIdeas: (next: Idea[]) => void
}

export function useConnectionsSlice(persisted: { ideas?: Idea[] } | null): ConnectionsSlice {
  const [ideas, setIdeas] = useState<Idea[]>(persisted?.ideas ?? MOCK_IDEAS)
  return { ideas, setIdeas }
}
