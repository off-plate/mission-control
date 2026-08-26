/* Talking into the ask box.

   TWO ENGINES, SAME REASON AS speech.ts. The browser's own SpeechRecognition
   is free, needs no key, and streams words as they are said, which is the
   whole feel of dictation: you watch the sentence build instead of waiting for
   it. That is the primary path.

   It is missing in Firefox, and present-but-broken in Chromium builds that are
   not Chrome, the desktop app included: those ship without Google's speech key,
   so start() succeeds and then errors. So the fallback records the microphone
   and posts it to Groq's whisper-large-v3-turbo with the SAME gsk_ key the
   assistant already uses. No second key to paste, and dictation still works in
   the desktop app.

   The trade is honest and worth saying out loud: the browser engine transcribes
   live, the fallback only produces text once you stop talking. */

import { getAiKey } from './ai'

const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const STT_MODEL = 'whisper-large-v3-turbo'

export type DictateState = 'idle' | 'listening' | 'transcribing'

/* A microphone left open is a microphone left open. If nothing has been heard
   for this long he has finished, or he walked off, and either way the browser
   should stop listening rather than hold the mic for the rest of the session. */
const SILENCE = 6000

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function RecognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | null
}

function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/** Whether a mic button should exist at all. */
export function dictationAvailable(): boolean {
  return dictationEngine() !== 'none'
}

/** Which engine a click would use. The button's tooltip says this out loud. */
export function dictationEngine(): 'browser' | 'whisper' | 'none' {
  if (RecognitionCtor()) return 'browser'
  if (canRecord() && getAiKey()) return 'whisper'
  return 'none'
}

let state: DictateState = 'idle'
let rec: Recognition | null = null
let recorder: MediaRecorder | null = null
let silence: ReturnType<typeof setTimeout> | null = null
/* Set when a recording is abandoned rather than finished, so onstop knows not
   to spend a Whisper call on audio nobody is waiting for. */
let discard = false
let stream: MediaStream | null = null
const listeners = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function dictateState(): DictateState { return state }
function set(s: DictateState): void { state = s; listeners.forEach((f) => f()) }

/** Called with the full text the box should show, live. */
export type OnText = (text: string) => void

/** Stop listening and KEEP what was said. This is the Stop button. */
export function stop(): void {
  disarmSilence()
  if (rec) { try { rec.stop() } catch { /* already stopped */ } rec = null }
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch { /* already stopped */ }
    return  // its onstop transcribes, and sets the state itself
  }
  releaseMic()
  set('idle')
}

/** Stop listening and THROW AWAY what was said. This is sending, or leaving.

    Stopping and discarding are different intents and stop() cannot serve both.
    SpeechRecognition delivers one last `result` AFTER stop() is called, which is
    how it flushes a half-said phrase into a final one. Sending used to call
    stop(), clear the box, and then take that trailing result straight back into
    the box it had just cleared, so every dictated question had to be deleted by
    hand before the next one.

    So the handler is detached before anything else, and abort() is used rather
    than stop() because abort is the one that does not deliver a final result. */
export function cancel(): void {
  disarmSilence()
  if (rec) {
    rec.onresult = null
    rec.onend = null
    rec.onerror = null
    try { rec.abort() } catch { /* already gone */ }
    rec = null
  }
  if (recorder && recorder.state !== 'inactive') {
    /* Same idea for the recording path: let it stop, but tell onstop there is
       nothing to send and nothing to write. */
    discard = true
    try { recorder.stop() } catch { /* already stopped */ }
    return
  }
  releaseMic()
  set('idle')
}

function armSilence(): void {
  if (silence) clearTimeout(silence)
  silence = setTimeout(() => { if (state === 'listening') stop() }, SILENCE)
}
function disarmSilence(): void {
  if (silence) { clearTimeout(silence); silence = null }
}

function releaseMic(): void {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  recorder = null
}

function startBrowser(base: string, onText: OnText): void {
  const Ctor = RecognitionCtor()
  if (!Ctor) return
  const r = new Ctor()
  r.lang = 'en-US'
  r.continuous = true
  r.interimResults = true

  /* Finals accumulate, interim is whatever is being said right now and gets
     replaced on every event. Appending interim would repeat every half-word. */
  let finals = ''
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alt = e.results[i][0]
      if (!alt) continue
      if (e.results[i].isFinal) finals += alt.transcript
      else interim += alt.transcript
    }
    armSilence()
    onText((base + finals + interim).replace(/\s+/g, ' ').trimStart())
  }
  /* `no-speech` and `aborted` are ordinary: he opened it and said nothing, or
     clicked it off. Only a real failure should look like one. */
  r.onerror = () => { rec = null; set('idle') }
  r.onend = () => { if (rec === r) { rec = null; set('idle') } }
  rec = r
  try { r.start(); set('listening'); armSilence() } catch { rec = null; set('idle') }
}

async function startWhisper(base: string, onText: OnText): Promise<void> {
  const key = getAiKey()
  if (!key) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    set('idle')  // permission refused; nothing to say about it that the browser has not
    return
  }
  discard = false
  const chunks: Blob[] = []
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  mr.onstop = () => {
    releaseMic()
    if (discard) { discard = false; set('idle'); return }
    const blob = new Blob(chunks, { type: mime || 'audio/webm' })
    if (!blob.size) { set('idle'); return }
    set('transcribing')
    const form = new FormData()
    form.append('file', blob, 'ask.webm')
    form.append('model', STT_MODEL)
    form.append('language', 'en')
    form.append('response_format', 'text')
    fetch(GROQ_STT, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => { onText(`${base}${text.trim()}`.replace(/\s+/g, ' ').trimStart()) })
      .catch(() => { /* the box keeps what he already typed */ })
      .finally(() => set('idle'))
  }
  recorder = mr
  mr.start()
  set('listening')
  armSilence()
}

/** The button's whole behaviour. `base` is what is already in the box. */
export function toggle(base: string, onText: OnText): void {
  if (state !== 'idle') { stop(); return }
  const pad = base.trim() ? `${base.trim()} ` : ''
  if (RecognitionCtor()) startBrowser(pad, onText)
  else void startWhisper(pad, onText)
}
