/* TWO LIVES / REELS. Split out of store.tsx (2026-09-09). The smallest slice
   in the split: two independent, uncoupled fields kept in the synced blob
   only because a library he pastes in bulk (reels) and a set of per-tile
   links (twoLives) both need to survive a reload and a second device --
   neither reads or is read by any other domain. */
import { useState } from 'react'

export interface TwoLivesSlice {
  twoLives: Record<string, string>
  setTwoLivesRaw: (next: Record<string, string>) => void
  setTwoLives: (key: string, url: string) => void
  reels: string[]
  setReelsRaw: (next: string[]) => void
  setReels: (list: string[]) => void
}

export function useTwoLivesSlice(
  persisted: { twoLives?: Record<string, string>; reels?: string[] } | null,
): TwoLivesSlice {
  const [twoLives, setTwoLivesRaw] = useState<Record<string, string>>(persisted?.twoLives ?? {})
  const [reels, setReelsRaw] = useState<string[]>(persisted?.reels ?? [])

  const setReels = (list: string[]): void => setReelsRaw(list)
  const setTwoLives = (key: string, url: string): void =>
    setTwoLivesRaw((m) => { const n = { ...m }; if (url.trim()) n[key] = url.trim(); else delete n[key]; return n })

  return { twoLives, setTwoLivesRaw, setTwoLives, reels, setReelsRaw, setReels }
}
