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
import { activeModel, getAiKey, request, stripReasoning } from './ai'

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

/* ------------------------------------------------------------ tidying up

   His note (2026-09-11): use the GLM key already in Settings for this too, it
   "might recognize the script better".

   What it cannot do, and is worth writing down so nobody tries: the WORDS are
   not a model's guess. They come from YouTube's own caption track, or from the
   provider when YouTube refuses. No model hears the audio at any point, so no
   model can improve what was heard.

   What it can do is the thing auto-captions are actually bad at. They arrive
   as one flat run with no full stops, no capitals and no speakers, which is
   exhausting to read for an hour. That is punctuation, not transcription, and
   a language model is the right tool for it.

   Strictly on demand. It spends his own key, so it happens when he presses the
   button and never because a page loaded. */

const TIDY_BATCH = 8

export type TidyState =
  | { phase: 'idle' }
  | { phase: 'working'; done: number; total: number }
  | { phase: 'done'; changed: number }
  | { phase: 'failed'; message: string }

const tidyStore = createLiveStore<TidyState>({ phase: 'idle' })
/** Cleaned paragraphs, by videoId then block index. Kept beside the document
 *  rather than written into it, so the original is never lost and a second
 *  press costs nothing. */
const tidied = new Map<string, Map<number, string>>()

export function tidyFor(videoId: string): Map<number, string> | undefined { return tidied.get(videoId) }

export function useTidy(): TidyState {
  return useSyncExternalStore(tidyStore.subscribe, tidyStore.getSnapshot, tidyStore.getSnapshot)
}

export function resetTidy(): void { tidyStore.publish({ phase: 'idle' }) }

export async function tidy(doc: Transcript, list: Block[]): Promise<void> {
  const key = getAiKey()
  if (!key) { tidyStore.publish({ phase: 'failed', message: 'No AI key in Settings.' }); return }
  const already = tidied.get(doc.videoId) ?? new Map<number, string>()
  const todo = list.map((b, i) => ({ i, text: b.text })).filter((b) => !already.has(b.i))
  if (!todo.length) { tidyStore.publish({ phase: 'done', changed: already.size }); return }

  tidyStore.publish({ phase: 'working', done: 0, total: todo.length })
  let changed = already.size
  for (let at = 0; at < todo.length; at += TIDY_BATCH) {
    const batch = todo.slice(at, at + TIDY_BATCH)
    try {
      const res = await request({
        model: activeModel(),
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You repair the punctuation of automatic video captions. For each numbered paragraph, return the SAME words with sentence breaks, capitals and commas added, and filler ("um", "uh", repeated false starts) removed. Never reword, never summarise, never translate, never add anything that was not said. Reply as JSON: {"out":[{"i":<number>,"text":"<repaired>"}]}, one entry per paragraph given.',
          },
          { role: 'user', content: JSON.stringify({ paragraphs: batch.map((b) => ({ i: b.i, text: b.text })) }) },
        ],
      }, key)
      if (!res.ok) throw new Error(`the model answered ${res.status}`)
      const data = await res.json()
      const parsed = JSON.parse(stripReasoning(data.choices?.[0]?.message?.content ?? '') || '{}')
      const out = Array.isArray(parsed.out) ? parsed.out : []
      /* A batch that comes back the wrong shape keeps its originals rather than
         dropping paragraphs on the floor: a transcript missing its middle is
         worse than one that is hard to read. */
      for (const row of out) {
        const i = Number(row?.i)
        const text = typeof row?.text === 'string' ? row.text.trim() : ''
        if (Number.isFinite(i) && text && batch.some((b) => b.i === i)) { already.set(i, text); changed++ }
      }
      tidied.set(doc.videoId, already)
      tidyStore.publish({ phase: 'working', done: Math.min(todo.length, at + batch.length), total: todo.length })
    } catch (e) {
      tidied.set(doc.videoId, already)
      tidyStore.publish({ phase: 'failed', message: e instanceof Error ? e.message : 'the model could not be reached' })
      return
    }
  }
  tidyStore.publish({ phase: 'done', changed })
}
