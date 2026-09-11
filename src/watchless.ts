/* WATCHLESS, inside Mission Control.

   Paste a YouTube link, read the thing instead of scrubbing it. The transcript
   is fetched from the Watchless endpoint, which is the only place with keys and
   the only place that can spend: Supabase cache first, then YouTube's own free
   APIs, then a paid provider for whatever is left, under a monthly cap. None of
   that moves here. This file only asks, and remembers what came back.

   The one thing worth knowing while reading this: a request can cost money. So
   nothing here fetches on its own -- no prefetch, no refresh on mount, no
   retry loop. A request happens when he pastes a link and asks for it, and the
   answer says what it cost, including the zero that a cache hit costs. */
import { useCallback, useSyncExternalStore } from 'react'
import { createLiveStore } from './livestore'

export interface Cue { start: number; end: number; text: string }
export interface Chapter { start: number; title: string }

export interface Transcript {
  videoId: string
  url: string
  title: string
  channel: string
  duration: number
  thumbnail: string
  captionLang: string
  captionSource: string
  words: number
  chapters: Chapter[]
  segments: Cue[]
  /** What this copy cost to make, in provider credits. Zero for a cache hit. */
  cost: number
  cached: boolean
  /** Groq's brief. Optional in the strict sense: no key, no panel. */
  summary?: string
}

export type ReadState =
  | { status: 'idle' }
  | { status: 'reading'; url: string }
  | { status: 'ok'; doc: Transcript }
  | { status: 'error'; message: string; hint?: string }

const ENDPOINT = 'https://watchless.netlify.app/api/transcript'

const store = createLiveStore<ReadState>({ status: 'idle' })

/** The last few videos read, so reopening one is a click and not a paste. Kept
 *  here rather than in the app's synced state: it is a convenience on this
 *  device, and a watch history is not something to push to every other one. */
const RECENT_KEY = 'mc-watchless-recent'
export interface Recent { videoId: string; title: string; channel: string; url: string; at: number }

export function recents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as Recent[]) : []
  } catch { return [] }
}

function remember(doc: Transcript): void {
  try {
    const next = [
      { videoId: doc.videoId, title: doc.title, channel: doc.channel, url: doc.url, at: Date.now() },
      ...recents().filter((r) => r.videoId !== doc.videoId),
    ].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* a private window is not a reason to fail a read */ }
}

/** The id out of any of the shapes he might paste, so a link with a playlist or
 *  a timestamp on it is not rejected for having one. Mirrors the endpoint's own
 *  parser; doing it here too means an obviously wrong paste never spends a
 *  round trip. */
export function videoId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12) || null
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null
    const v = u.searchParams.get('v')
    if (v) return v.slice(0, 11)
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/)
    return m ? m[2] : null
  } catch { return null }
}

export async function read(input: string, opts?: { refresh?: boolean }): Promise<void> {
  const id = videoId(input)
  if (!id) {
    store.publish({ status: 'error', message: 'That is not a YouTube link', hint: 'Paste a youtube.com/watch, youtu.be or /shorts URL.' })
    return
  }
  store.publish({ status: 'reading', url: input })
  try {
    const qs = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}` })
    if (opts?.refresh) qs.set('refresh', '1')
    const res = await fetch(`${ENDPOINT}?${qs}`)
    const body = await res.json().catch(() => null)
    if (!res.ok || !body || body.error) {
      store.publish({
        status: 'error',
        message: body?.error || `The reader answered ${res.status}.`,
        hint: body?.hint,
      })
      return
    }
    const doc = body as Transcript
    remember(doc)
    store.publish({ status: 'ok', doc })
  } catch {
    store.publish({ status: 'error', message: 'Could not reach the reader.', hint: 'It is a separate service; if it is down, nothing here can be read.' })
  }
}

export function clear(): void { store.publish({ status: 'idle' }) }

export function useWatchless(): { state: ReadState; read: typeof read; clear: () => void } {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { state, read: useCallback(read, []), clear: useCallback(clear, []) }
}

/* ---------------------------------------------------------------- shaping */

/** mm:ss, or h:mm:ss once it earns the hour. A transcript is read against the
 *  video, so these have to match what YouTube shows on its own scrubber. */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

/** A deep link back to the video at that moment. The transcript is for reading;
 *  this is for the one line he wants to hear said out loud. */
export function atUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`
}

export interface Block { start: number; title: string | null; cues: Cue[]; text: string }

/** Cues are a few words each, which is unreadable as prose. They are grouped
 *  into paragraphs of roughly a minute, broken on a cue boundary so a sentence
 *  is never cut in half by the grouping itself.
 *
 *  Chapters set the titles and the hard breaks, they do NOT set the paragraphs:
 *  a six-minute chapter grouped whole came out as one unbroken wall of text,
 *  which is the thing this page exists to save him from. So a chapter starts a
 *  new block and names it, and then keeps breaking inside itself. */
const PARA_SECONDS = 55

export function blocks(doc: Transcript): Block[] {
  const cues = doc.segments ?? []
  if (!cues.length) return []
  const join = (list: Cue[]) => list.map((c) => c.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')

  const marks = [...(doc.chapters ?? [])].sort((a, b) => a.start - b.start)
  /** The chapter a moment belongs to, or -1 before the first one starts. */
  const chapterAt = (t: number) => {
    let found = -1
    for (let i = 0; i < marks.length; i++) if (marks[i].start <= t) found = i
    return found
  }

  const out: Block[] = []
  let bucket: Cue[] = []
  let open = cues[0].start
  let chapter = chapterAt(cues[0].start)
  let titled = new Set<number>()

  const flush = () => {
    if (!bucket.length) return
    /* Only the first block of a chapter carries its name, so the title reads as
       a heading over the section rather than repeating down the page. */
    const title = chapter >= 0 && !titled.has(chapter) ? marks[chapter].title : null
    if (title) titled.add(chapter)
    out.push({ start: open, title, cues: bucket, text: join(bucket) })
    bucket = []
  }

  for (const c of cues) {
    const here = chapterAt(c.start)
    const crossed = here !== chapter
    if (bucket.length && (crossed || c.start - open >= PARA_SECONDS)) {
      flush()
      open = c.start
    }
    chapter = here
    bucket.push(c)
  }
  flush()
  return out.filter((b) => b.text)
}

/** Which blocks say the thing he is looking for, and how many times in total.
 *  Case-insensitive, plain substring: a transcript search that needed a syntax
 *  would be a worse tool than the video's own scrubber. */
export function search(list: Block[], term: string): { hits: Set<number>; count: number } {
  const q = term.trim().toLowerCase()
  const hits = new Set<number>()
  if (!q) return { hits, count: 0 }
  let count = 0
  list.forEach((b, i) => {
    const text = b.text.toLowerCase()
    let from = 0
    let found = 0
    for (;;) {
      const at = text.indexOf(q, from)
      if (at < 0) break
      found++
      from = at + q.length
    }
    if (found) { hits.add(i); count += found }
  })
  return { hits, count }
}

/** The whole thing as plain text, stamps included, for pasting somewhere else.
 *  Built here rather than in the page so the copy and the download agree. */
export function asText(doc: Transcript): string {
  const head = [doc.title, doc.channel, doc.url].filter(Boolean).join('\n')
  const body = blocks(doc)
    .map((b) => `[${stamp(b.start)}] ${b.title ? `${b.title}\n` : ''}${b.text}`)
    .join('\n\n')
  return `${head}\n\n${doc.summary ? `${doc.summary}\n\n` : ''}${body}\n`
}
