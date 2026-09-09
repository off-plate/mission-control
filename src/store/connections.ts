/* CONNECTIONS. Split out of store.tsx (2026-09-10). Social feed entries,
   linked sources, and the legacy braindump ideas list -- three fields with
   no mutator that reaches into any other domain, and (unlike most of the
   store) no other domain reaches into them either. toggleSource is a no-op
   on purpose: connecting a source is a real OAuth flow that does not exist
   yet, so nothing may flip a status to "connected" until it does. */
import { useState } from 'react'
import { MOCK_IDEAS, MOCK_SOCIAL, MOCK_SOURCES } from '../mock'
import type { Idea, SocialEntry, SourceState } from '../types'

export interface ConnectionsSlice {
  social: SocialEntry[]
  setSocial: (entries: SocialEntry[]) => void
  sources: SourceState[]
  setSources: (next: SourceState[]) => void
  toggleSource: (id: string) => void
  ideas: Idea[]
  setIdeas: (next: Idea[]) => void
}

export function useConnectionsSlice(
  persisted: { social?: SocialEntry[]; sources?: SourceState[]; ideas?: Idea[] } | null,
): ConnectionsSlice {
  const [social, setSocialState] = useState(persisted?.social ?? MOCK_SOCIAL)
  const [sources, setSources] = useState(persisted?.sources ?? MOCK_SOURCES)
  const [ideas, setIdeas] = useState<Idea[]>(persisted?.ideas ?? MOCK_IDEAS)

  return {
    social, setSocial: (entries) => setSocialState(entries),
    sources, setSources,
    toggleSource: () => {},
    ideas, setIdeas,
  }
}
