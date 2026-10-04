/* TWO LIVES / REELS. Split out of store.tsx (2026-09-09). The smallest slice
   in the split: independent, uncoupled fields kept in the synced blob only
   because a library he pastes in bulk (reels), a set of per-tile links
   (twoLives), and the downloaded stand-ins for the Instagram links in that
   library (reelFiles) all need to survive a reload and a second device --
   none reads or is read by any other domain.

   REELFILES is the one-time download cache: an Instagram link the reel
   library plays isn't itself playable (it's a page, not a video), so the
   first time it's paged to, reel-fetch downloads the real file once and this
   remembers where it landed. Synced, so a Reel fetched on the laptop doesn't
   fetch a second time on the phone at midnight -- it's a lookup there.

   REELS AND TUNES UNION across devices (sync-merge.ts), so a link removed here
   is buried and a link added is dug up; without that a removal never stuck. */
import { useState } from 'react'

export interface TwoLivesSlice {
  twoLives: Record<string, string>
  setTwoLivesRaw: (next: Record<string, string>) => void
  setTwoLives: (key: string, url: string) => void
  reels: string[]
  /** His own focus-music links for the Zone's player (2026-09-12). */
  tunes: string[]
  setReelsRaw: (next: string[]) => void
  setReels: (list: string[]) => void
  setTunesRaw: (next: string[]) => void
  setTunes: (list: string[]) => void
  reelFiles: Record<string, string>
  setReelFilesRaw: (next: Record<string, string>) => void
  setReelFile: (originalUrl: string, fileUrl: string) => void
}

export function useTwoLivesSlice(
  persisted: { twoLives?: Record<string, string>; reels?: string[]; reelFiles?: Record<string, string>; tunes?: string[] } | null,
  deps: { bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): TwoLivesSlice {
  const [twoLives, setTwoLivesRaw] = useState<Record<string, string>>(persisted?.twoLives ?? {})
  const [reels, setReelsRaw] = useState<string[]>(persisted?.reels ?? [])
  const [tunes, setTunesRaw] = useState<string[]>(persisted?.tunes ?? [])
  const [reelFiles, setReelFilesRaw] = useState<Record<string, string>>(persisted?.reelFiles ?? {})

  const tomb = (field: 'reels' | 'tunes', before: string[], after: string[]): void => {
    const gone = before.filter((u) => !after.includes(u))
    const added = after.filter((u) => !before.includes(u))
    if (gone.length) deps.bury(...gone.map((u) => `${field}:${u}`))
    if (added.length) deps.digUp(...added.map((u) => `${field}:${u}`))
  }
  const setReels = (list: string[]): void => { tomb('reels', reels, list); setReelsRaw(list) }
  const setTunes = (list: string[]): void => { tomb('tunes', tunes, list); setTunesRaw(list) }
  const setTwoLives = (key: string, url: string): void =>
    setTwoLivesRaw((m) => { const n = { ...m }; if (url.trim()) n[key] = url.trim(); else delete n[key]; return n })
  const setReelFile = (originalUrl: string, fileUrl: string): void =>
    setReelFilesRaw((m) => ({ ...m, [originalUrl]: fileUrl }))

  return { twoLives, setTwoLivesRaw, setTwoLives, reels, setReelsRaw, setReels, tunes, setTunesRaw, setTunes, reelFiles, setReelFilesRaw, setReelFile }
}
