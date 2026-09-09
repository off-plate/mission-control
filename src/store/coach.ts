/* COACH. Split out of store.tsx (2026-09-10). Avoidance, the page, is gone,
   but its dated session records are not: they still load, still sync, and
   still show on a day page. Nothing new writes to this collection -- the
   only write left is the sync-merge stamp in applyExternal, which lives in
   store.tsx itself since it touches every domain's rows, not just this one. */
import { useState } from 'react'
import type { CoachSession } from '../types'

export interface CoachSlice {
  coachSessions: CoachSession[]
  setCoachSessions: (next: CoachSession[]) => void
}

export function useCoachSlice(
  persisted: { coachSessions?: CoachSession[] } | null,
): CoachSlice {
  const [coachSessions, setCoachSessions] = useState<CoachSession[]>(persisted?.coachSessions ?? [])
  return { coachSessions, setCoachSessions }
}
