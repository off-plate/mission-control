/* THE REEL LIBRARY.

   The give-up screen plays a clip while he reads what the next six months look
   like either way. One clip was a demo; hundreds is the point, so the same
   thirty seconds never becomes wallpaper.

   TWO SOURCES, ONE POOL.

     THIS FILE is the curated list. He sends links, they get added here, and
     they ship with the app: on a new device, signed out, offline, the screen
     still has something to play. Anything in here is in the bundle, so it is
     LINKS ONLY, never files.

     THE APP holds whatever he pastes into the reel panel, which lives in his
     synced blob and needs no deploy. Paste a hundred at once; the panel takes
     one per line, or commas, or a wall of text with URLs in it.

   The two are merged and de-duplicated at read time, so a link he pastes that
   is later curated in here does not play twice as often. */

/** Curated links. Add his, one per line, newest last. */
export const REELS: string[] = [
  /* Empty on purpose: nothing here is invented. When he sends links they go in
     this array, and only then. A made-up "motivational" URL that 404s is worse
     than an honest empty pool, which the screen already explains. */
]

/* Recognised so the panel can say what it took rather than accept silently. */
const YT = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i
const FILE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i
/* instagram.com/reel/<code>, /reels/<code>, or a plain post at /p/<code> --
   all three carry a video on a public account. The trailing slash is
   optional, a query string or share suffix after the code is common. */
const INSTAGRAM = /instagram\.com\/(?:reel|reels|p)\/([\w-]+)/i

export type ReelKind = 'youtube' | 'vimeo' | 'instagram' | 'file' | 'other'

export function reelKind(url: string): ReelKind {
  if (YT.test(url)) return 'youtube'
  if (VIMEO.test(url)) return 'vimeo'
  if (INSTAGRAM.test(url)) return 'instagram'
  if (FILE.test(url)) return 'file'
  return 'other'
}

/** The shortcode out of an Instagram URL, or null. Used as the cache key and
 *  as the stored file's name, so the same Reel pasted twice never downloads
 *  twice. */
export function instagramCode(url: string): string | null {
  return url.match(INSTAGRAM)?.[1] ?? null
}

/** A YouTube link is the same video under a dozen spellings. Two links to one
 *  clip are one clip, so the pool is de-duplicated by IDENTITY, not by string:
 *  a watch URL, a youtu.be short link, a Shorts URL and one with a timestamp
 *  all collapse to the same entry. */
export function reelId(url: string): string {
  const y = url.match(YT)
  if (y) return `yt:${y[1]}`
  const v = url.match(VIMEO)
  if (v) return `vimeo:${v[1]}`
  const ig = url.match(INSTAGRAM)
  if (ig) return `ig:${ig[1]}`
  return url.trim().replace(/[?#].*$/, '').toLowerCase()
}

/**
 * Pull every link out of whatever he pasted. One per line, comma separated, or
 * a page of text with URLs in it: all three are the same problem, and asking
 * him to format a hundred links by hand is not a feature.
 */
export function parseReels(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s,"'<>)\]]+/gi) ?? []
  return dedupe(found.map((u) => u.replace(/[.,;]+$/, '')))
}

/** De-duplicate by identity, keeping the first spelling of each clip. */
export function dedupe(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const u = raw.trim()
    if (!u) continue
    const k = reelId(u)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(u)
  }
  return out
}

/** The curated list plus his own, in that order, de-duplicated. */
export function reelPool(his: string[] | undefined): string[] {
  return dedupe([...REELS, ...(his ?? [])])
}
