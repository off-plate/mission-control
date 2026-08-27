/* Reading an answer out loud. One voice at a time, for the whole app.

   WHY TWO ENGINES, AND WHY THE FREE ONE IS THE DEFAULT: this repo is public,
   so a key can no more go in the bundle here than it can in ai.ts. The device
   voice needs no key at all, costs nothing that could ever appear on a bill,
   and starts speaking in the same frame you click it, because nothing leaves
   the machine. Gemini sounds better and can be told HOW to read a line, but it
   is a network round trip and a key to paste, so it is the upgrade, not the
   floor. With no key pasted the button still works. That is the point.

   ONE VOICE AT A TIME is enforced here rather than in the page: starting
   anything stops whatever was already talking. Two answers reading over each
   other is the kind of bug that only shows up when someone clicks fast. */

const KEY_STORE = 'mc-gemini-key'
/* Named once, like MODEL in ai.ts, so the next retirement is one line.
   2.5-flash-preview-tts and 2.5-pro-preview-tts are the other two live names. */
const TTS_MODEL = 'gemini-3.1-flash-tts-preview'
const TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
/* Charon reads level and unhurried. The alternative presets are showier and a
   daily brief is not a performance. */
const TTS_VOICE = 'Charon'
/* A brief he can read in two seconds is not worth a fifteen-second wait for a
   nicer voice. Past this, the device voice takes over and whatever Gemini
   eventually returns is thrown away for this click -- it is still cached, so
   a replay right after is instant and full quality. */
const GEMINI_TIMEOUT_MS = 6000
/* How it should sound, not what it should say. The model is being asked to
   perform his own words here, never to write any. */
const DIRECTION =
  'Read this aloud as a calm, level chief of staff giving a morning brief. ' +
  'Unhurried, no cheerfulness, no rising sell. Do not add or change any words.'

export function getTtsKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? '' } catch { return '' }
}
export function setTtsKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORE, key.trim())
    else localStorage.removeItem(KEY_STORE)
  } catch { /* storage unavailable */ }
}
export function hasTtsKey(): boolean {
  return getTtsKey().startsWith('AIza')
}

/** Which engine a click would use right now. The settings page says this out loud. */
export function engineName(): 'Gemini' | 'device' {
  return hasTtsKey() ? 'Gemini' : 'device'
}

export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused'


/* Who is talking, and what about. `id` is the caller's own handle (the turn
   index), so a button can ask "is it me?" without comparing text. */
let current: string | null = null
let state: SpeechState = 'idle'
let audio: HTMLAudioElement | null = null
const listeners = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function emit(): void { listeners.forEach((f) => f()) }

export function speechState(id: string): SpeechState {
  return current === id ? state : 'idle'
}

function set(id: string | null, s: SpeechState): void {
  current = id
  state = s
  emit()
}

/* HOW LOUD IT IS TALKING, so voice mode can draw the answer as well as hear it.

   Two sources, because there are two engines. Gemini plays through an <audio>
   element, which can be run through an analyser like any other sound, so that
   reading is the real waveform of the voice. The device voice plays inside the
   browser with no node to tap, so the next best real signal is used instead:
   `onboundary` fires as each word begins, so the meter is driven by the actual
   rhythm of the speech rather than by a timer pretending to be one.

   Where a browser fires no boundaries at all this reports nothing, and the
   panel says so in words. A generator used to stand in here and it was the
   only thing he ever saw. */
let spoken = 0
let spokenAt = 0
let analyser: AnalyserNode | null = null
let audioCtx: AudioContext | null = null
let buf: Uint8Array | null = null
let boundaries = 0

/** 0..1 while it is speaking, and 0 when there is nothing real to report.

    NOTHING HERE IS GENERATED. There used to be a fallback that drew a sine
    wave when no signal was available, and because the app was choosing a remote
    voice that reports nothing, that generator was the only thing he ever saw:
    a pretty animation with no relationship to the speech. He called it what it
    was. A still bar that means "no signal" is worth more than a moving one that
    means nothing.

    Two real sources. Gemini plays through an audio element, so that is the true
    amplitude of the voice. The device voice has no node to tap, so the meter is
    driven by `onboundary`, which fires as each word begins: the real rhythm of
    what is being said, though not its loudness. */
export function speakingLevel(): number {
  if (analyser && buf) {
    analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4)
  }
  if (state !== 'playing' || boundaries === 0) return 0
  /* A word landed. Fall away from it until the next one, so the shape follows
     the pace of the sentence: quick words crowd together, a pause flattens. */
  const since = Date.now() - spokenAt
  return Math.max(0, spoken * Math.max(0, 1 - since / 320))
}

/** Whether anything real is being measured right now, so the panel can say so
 *  rather than drawing a flat line that looks like a fault. */
export function speakingMeasured(): boolean {
  return !!(analyser && buf) || (state === 'playing' && boundaries > 0)
}

/* Tap the audio element so the bars are the actual voice. Once a media element
   is routed through a graph it only plays through that graph, so it is
   connected straight back to the speakers. */
function tap(el: HTMLAudioElement): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = new AC()
    const src = audioCtx.createMediaElementSource(el)
    const an = audioCtx.createAnalyser()
    an.fftSize = 512
    src.connect(an)
    an.connect(audioCtx.destination)
    analyser = an
    buf = new Uint8Array(an.fftSize)
  } catch {
    /* No analyser is a quieter failure than no sound: leave it untapped and
       let the element play normally. */
    analyser = null
    buf = null
  }
}

function untap(): void {
  analyser = null
  buf = null
  void audioCtx?.close().catch(() => { /* already closed */ })
  audioCtx = null
  boundaries = 0
  spoken = 0
}

/** Whatever is talking, stop it. Safe to call when nothing is. */
export function stop(): void {
  untap()
  if (audio) {
    audio.pause()
    URL.revokeObjectURL(audio.src)
    audio = null
  }
  try { speechSynthesis.cancel() } catch { /* not supported */ }
  set(null, 'idle')
}

/* Rendered audio, kept by exact text. Replaying a brief he just heard should
   not cost a second call, and on the free tier it is the difference between a
   limit that is theoretical and one he can actually hit by pressing replay. */
const cache = new Map<string, Blob>()

/* Gemini answers with raw signed 16-bit PCM, which no browser will play on its
   own. This is the 44-byte RIFF header that turns it into a WAV it will. */
function toWav(pcm: ArrayBuffer, rate = 24000): Blob {
  const head = new ArrayBuffer(44)
  const v = new DataView(head)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)        // PCM header length
  v.setUint16(20, 1, true)         // format: PCM
  v.setUint16(22, 1, true)         // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)  // byte rate: rate * channels * bytes
  v.setUint16(32, 2, true)         // block align
  v.setUint16(34, 16, true)        // bits per sample
  ascii(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  return new Blob([head, pcm], { type: 'audio/wav' })
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

async function fetchGemini(text: string, key: string): Promise<Blob | null> {
  const hit = cache.get(text)
  if (hit) return hit
  try {
    const res = await fetch(`${TTS_ENDPOINT}/${TTS_MODEL}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DIRECTION }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (!part?.data) return null
    /* The mime carries the real sample rate, and it has already differed
       between the 2.5 and 3.1 models. Read it rather than assume 24k. */
    const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1]) || 24000
    const wav = toWav(b64ToBuffer(part.data), rate)
    cache.set(text, wav)
    return wav
  } catch {
    return null
  }
}

/* WHICH VOICE, AND WHY IT IS NOT WHICHEVER COMES FIRST.

   `speechSynthesis.getVoices()` returns an EMPTY ARRAY on first call. The list
   arrives asynchronously and only then fires `voiceschanged`. Speaking before
   it lands leaves `utterance.voice` null, so the browser picks its own
   fallback, and the first answer of every session was read by something that
   sounded like a dying grandfather while a replay a second later sounded fine.
   That was the bug: not the audio, the timing.

   The second half matters just as much. macOS ships 28 en-US voices and most
   are novelty: Bahh, Boing, Bubbles, Zarvox, Trinoids, Grandma, Grandpa, Fred.
   Sorted, the FIRST en-US voice is "Albert", so "just take an en-US one" is a
   coin flip on a joke voice. Only a named preference is safe, and when none of
   them is installed it is better to leave the voice unset and let the OS decide
   than to read the brief in Boing. */
/* LOCAL VOICES FIRST, and this is not a taste call.

   Chrome fires no `onboundary` events for a REMOTE voice, and "Google US
   English" is remote. It used to sit at the top of this list, which meant the
   app chose the one voice that reports nothing about its own progress, and the
   waveform had no signal to draw. A local voice tells us when each word
   starts, so the bars move with the speech instead of with a timer.

   Google US English is still here, at the bottom, for a machine with no local
   voice at all: a good voice with a still waveform beats no voice. */
const GOOD = [
  'Samantha', 'Alex', 'Ava', 'Allison', 'Susan', 'Tom',
  'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Guy',
  'Google US English',
]
/* Named, not pattern-matched: these are jokes, not accents. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Kathy|Organ|Princess|Ralph|Fred|Grandma|Grandpa|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i

let voicePromise: Promise<SpeechSynthesisVoice[]> | null = null

/** The voice list, once it actually exists. Resolved once and reused. */
function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (voicePromise) return voicePromise
  voicePromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const now = speechSynthesis.getVoices()
    if (now.length) return resolve(now)
    const done = () => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    /* Not every browser fires the event, and a brief that never speaks is
       worse than one read in the default voice. */
    setTimeout(done, 1500)
  }).then((list) => {
    /* An empty answer is a timeout, not a result. Caching it would make one
       slow start permanent: every later click would reuse the empty list and
       fall back to the browser voice forever. Drop it and ask again next time. */
    if (!list.length) voicePromise = null
    return list
  })
  return voicePromise
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  /* Two passes over the same list: anything local before anything remote, so a
     named remote voice never beats a named local one. */
  for (const localOnly of [true, false]) {
    for (const name of GOOD) {
      const hit = voices.find((v) =>
        (v.name === name || v.name.startsWith(`${name} `)) && v.localService === localOnly)
      if (hit) return hit
    }
  }
  return voices.find((v) => /^en[-_]US/i.test(v.lang) && !NOVELTY.test(v.name))
    ?? voices.find((v) => /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name))
    ?? null
}

/* Ask for the list the moment this module loads, so by the time he clicks Play
   the promise has long since resolved and the first answer sounds like the
   second. This sits BELOW voicePromise: the function is hoisted but the `let`
   is not, so calling it any earlier is a temporal-dead-zone ReferenceError. */
try { void voicesReady() } catch { /* no speech synthesis here */ }

/* The no-key path, and the fallback when the network or the key lets us down.
   Speaking is never allowed to be the thing that does not happen. */
async function speakOnDevice(id: string, text: string): Promise<void> {
  try {
    const voices = await voicesReady()
    /* He clicked something else while the list was loading. */
    if (current !== id && current !== null) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 1.0
    const pick = pickVoice(voices)
    if (pick) u.voice = pick
    u.onboundary = () => { boundaries++; spoken = 1; spokenAt = Date.now() }
    u.onend = () => { if (current === id) { untap(); set(null, 'idle') } }
    u.onerror = () => { if (current === id) { untap(); set(null, 'idle') } }
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
    set(id, 'playing')
  } catch {
    set(null, 'idle')
  }
}

/* Bullets earn their keep on screen -- a finished-tasks list reads as a list,
   not a run-on sentence -- but a "-" at the start of a line is not a word,
   and both engines will say "dash" if it is left in. Stripped here, once, on
   the way to either voice, so the visible text and the spoken text can differ
   without a second copy of the brief to keep in sync. */
function speakable(text: string): string {
  return text.split('\n').map((line) => line.replace(/^\s*-\s+/, '')).join('\n')
}

/** The button's whole behaviour: play, pause, resume, or switch to a new answer. */
export async function toggle(id: string, text: string): Promise<void> {
  // Same answer, already talking: pause it.
  if (current === id && state === 'playing') {
    if (audio) { audio.pause(); set(id, 'paused') }
    else { try { speechSynthesis.pause() } catch { /* no-op */ }; set(id, 'paused') }
    return
  }
  // Same answer, paused: pick up where it stopped.
  if (current === id && state === 'paused') {
    if (audio) { void audio.play(); set(id, 'playing') }
    else { try { speechSynthesis.resume() } catch { /* no-op */ }; set(id, 'playing') }
    return
  }

  stop()
  const clean = speakable(text.trim())
  if (!clean) return

  const key = getTtsKey()
  if (!key) { await speakOnDevice(id, clean); return }

  set(id, 'loading')
  /* Raced against a clock, not just awaited. A slow answer used to hold the
     button on "Loading" for fifteen, twenty seconds -- Gemini's real time for
     even two short sentences -- which reads as broken, not slow. Losing the
     race does not cancel the fetch: it keeps running and still populates the
     cache, so pressing Play again right after this is instant. */
  const blob = await Promise.race([
    fetchGemini(clean, key),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), GEMINI_TIMEOUT_MS)),
  ])
  /* He clicked something else while this was in flight. Whatever we just
     fetched is no longer wanted, and playing it would talk over the new one. */
  if (current !== id) return
  if (!blob) { await speakOnDevice(id, clean); return }

  const el = new Audio(URL.createObjectURL(blob))
  tap(el)
  el.onended = () => { if (current === id) stop() }
  el.onerror = () => { if (current === id) void speakOnDevice(id, clean) }
  audio = el
  await el.play().catch(() => { if (current === id) void speakOnDevice(id, clean) })
  if (current === id && audio === el) set(id, 'playing')
}

/** Speak, and resolve when it has actually finished.

    Voice mode needs this and the button does not: a conversation has to know
    the moment the answer stops, because that is when it is safe to listen
    again. Listening while it talks means transcribing its own voice and
    answering itself, which is the failure mode of every hands-free assistant.

    It resolves on the way back down to idle, and only after it has genuinely
    started, or a call that never begins would resolve instantly and hand the
    microphone back while the answer is still being fetched. */
export function say(id: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    let started = false
    const off = subscribe(() => {
      const s = speechState(id)
      if (s !== 'idle') { started = true; return }
      if (started) { off(); resolve() }
    })
    void toggle(id, text).then(() => {
      /* Nothing to wait for: no text, or the engine refused outright. */
      if (!started && speechState(id) === 'idle') { off(); resolve() }
    })
  })
}
