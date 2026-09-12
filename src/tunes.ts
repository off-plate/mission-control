/* HIS OWN FOCUS MUSIC.

   His ask (2026-09-12): paste YouTube links into the Zone's player the way the
   give-up screen takes reels, and open a list to play any of them directly
   rather than skipping through with the transport.

   The curated Mundi Opus queue stays as what plays when he has added nothing,
   so the room is never silent on a fresh install. The moment he pastes a
   library, that is the queue.

   TITLES ARE REAL AND FREE. YouTube's oEmbed endpoint returns a video's title
   with no key and no quota, and it sends access-control-allow-origin for this
   site -- measured against the live endpoint, not assumed. Each title is
   fetched once and kept, so a list of thirty tracks is thirty requests in its
   whole life rather than thirty every time the sheet opens. A title that
   cannot be fetched falls back to the video id, which is still something he
   can recognise, and nothing fails. */
import { MUNDI_OPUS_QUEUE, type Track } from './mundiopus'

/** The id out of any shape he might paste. Same reading as watchless.ts, and
 *  deliberately forgiving: a link with a playlist or a timestamp on it is
 *  still a link to a video. */
export function tuneId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12) || null
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null
    const v = u.searchParams.get('v')
    if (v) return v.slice(0, 11)
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/)
    return m ? m[2] : null
  } catch { return null }
}

/** Every YouTube link in a pasted block, in order, without repeats. */
export function parseTunes(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/[\s,]+/)) {
    const id = tuneId(line)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(`https://www.youtube.com/watch?v=${id}`)
  }
  return out
}

/** What the player actually plays: his library when he has one, the curated
 *  channel when he does not. */
export function tunePool(his: string[] | undefined): Track[] {
  const mine = (his ?? []).map(tuneId).filter((v): v is string => !!v)
  if (!mine.length) return MUNDI_OPUS_QUEUE
  /* No title of their own: these are looked up. The curated queue keeps its
     hand-written names ("You are coding a new exciting project - The Social
     Network"), which are better than what YouTube would return, so nothing
     fetches over them. */
  return mine.map((id) => ({ id, title: '' }))
}

/** The name to show, from one place, so the Zone and the corner badge can
 *  never disagree about what is playing. */
export function trackTitle(track: Track): string {
  return track.title || titleFor(track.id) || track.id
}

/** Which of these still need looking up: the ones with no name of their own. */
export function missingTitles(queue: Track[]): string[] {
  return queue.filter((t) => !t.title).map((t) => t.id)
}

/* ---------------------------------------------------------------- titles */

const TITLE_STORE = 'mc-tune-titles'
let titles: Record<string, string> = (() => {
  try { return JSON.parse(localStorage.getItem(TITLE_STORE) ?? '{}') as Record<string, string> } catch { return {} }
})()
const asked = new Set<string>()
const listeners = new Set<() => void>()
/* A CHANGING snapshot. useSyncExternalStore over a constant never re-renders,
   which is why the first version of this showed raw video ids until something
   else happened to repaint. */
let version = 0
export function titlesVersion(): number { return version }

export function titleFor(id: string): string | undefined { return titles[id] }

export function onTitles(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Fetch the titles this list needs and nothing else. Safe to call on every
 *  render: an id already known, or already in flight, costs nothing. */
export function wantTitles(ids: string[]): void {
  const todo = ids.filter((id) => !titles[id] && !asked.has(id))
  if (!todo.length) return
  for (const id of todo) asked.add(id)
  void Promise.all(todo.map(async (id) => {
    try {
      /* ENCODED. Unencoded, the video URL's own "?v=" becomes a second query
         string on the request, so YouTube reads url= as a bare /watch with no
         video and answers 400. Real ids happened to survive it and fake ones
         did not, which is exactly the kind of bug that only shows up later. */
      const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)
      const res = await fetch(`https://www.youtube.com/oembed?url=${target}&format=json`)
      if (!res.ok) return
      const body = await res.json() as { title?: string }
      if (body.title) titles[id] = body.title
    } catch { /* a title is a nicety; the track still plays without one */ }
  })).then(() => {
    try { localStorage.setItem(TITLE_STORE, JSON.stringify(titles)) } catch { /* full quota is not a failure here */ }
    version++
    for (const fn of listeners) fn()
  })
}
