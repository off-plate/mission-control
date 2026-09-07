/* Voice mode: a conversation, hands free.

   Listen, send what was said, show the answer in the thread like any other
   answer, read it out, then listen again. It is a loop, not a screen: the chat
   stays exactly where it was and only the ask box changes shape.

   THE ONE THING THAT MAKES OR BREAKS IT: the microphone is closed while the
   answer is being read. An assistant that listens to itself transcribes its own
   voice, sends that as the next question, answers that, and never stops. Every
   path back to listening therefore goes through `listen()`, and `listen()` is
   the only place recognition is started.

   WHEN IS A QUESTION FINISHED? Not on a final result: "what is on today" comes
   back as a final the moment he pauses for breath mid-sentence. So finals are
   collected and a quiet timer runs; the question is sent when he has stopped
   talking for HUSH, not when the engine decided a phrase ended. */

import { say, speakingLevel, stop as stopSpeech } from './speech'

export type VoicePhase = 'off' | 'listening' | 'thinking' | 'speaking'

/** How long a pause means "finished", rather than "thinking of the next word".
 *  Was 1100ms; his report (2026-09-08), twice over, of a half-said sentence
 *  getting sent on its own ("could you check the" / "could you turn on
 *  focus on the", both cut off mid-thought and both landing as their own
 *  turn) -- a beat spent choosing which task or bill name to say next is
 *  ordinary, not a finished question, and 1100ms was catching it as one.
 *  Settled on 1400ms after his very next report was the opposite direction
 *  (the whole loop reading as slow) -- a real trade-off between the two,
 *  not a number either complaint gets to fully own. */
const HUSH = 1400
/** The Play button's own patient window (speech.ts) is six full seconds,
 *  right for an answer he is already reading and pressed play on once. A
 *  live, hands-free turn pays whatever this is on EVERY single reply, so it
 *  gets a much shorter leash before falling back to the instant, free
 *  device voice -- his report, 2026-09-08: "on the assistant page you
 *  react within one or two seconds... this pop-up thing takes six to ten",
 *  and a slow or degraded Gemini call sitting in the middle of every turn
 *  was very likely the largest single piece of that. */
const VOICE_TTS_TIMEOUT_MS = 2500
/** Chrome ends recognition on its own after a stretch of silence. If we are
    still meant to be listening, start it again rather than going deaf. */
const RESTART_DELAY = 250
/* Said nothing at all for this long: he is done, or he walked away. Voice mode
   hangs up rather than holding the microphone open for the rest of the evening.
   Only ever armed when NOTHING has been heard; once he starts a sentence, HUSH
   owns the timing and this stays out of the way.

   The full page's own default -- his correction (2026-09-08) was scoped to
   the dock's quick panel specifically: "keep the conversation going until I
   close it, open the assistant page, or click stop", not a silent hang-up
   mid-conversation because he was reading the last answer rather than
   already talking. enter()'s own idleMs argument overrides this per call;
   the dock passes 0 to disable it outright, the full page passes nothing
   and keeps this exact number. */
const IDLE_HANGUP = 6000

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: ResultEvent) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}
interface ResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function Ctor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | null
}

/** Voice mode needs the live engine. The record-and-upload fallback cannot do
    this: there is nothing to react to until the recording stops. */
export function voiceModeAvailable(): boolean {
  return !!Ctor()
}

let phase: VoicePhase = 'off'
let heard = ''            // what he has said so far this turn
let interim = ''          // what he is saying right now
let level = 0             // 0..1, the live microphone amplitude
/* Below this a room is quiet, not quietly speaking. */
const NOISE = 0.012
/* How fast the loudest recent moment is forgotten, per frame at 60fps. */
const PEAK_DECAY = 0.992
let peak = NOISE * 2
let rec: Recognition | null = null
let hush: ReturnType<typeof setTimeout> | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let raf = 0
let askFn: ((text: string) => Promise<string>) | null = null
let idleMs = IDLE_HANGUP

const listeners = new Set<() => void>()
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function emit(): void { listeners.forEach((f) => f()) }

export function voicePhase(): VoicePhase { return phase }
/** What he is saying, so the panel can show the words forming. */
export function voiceHeard(): string { return (heard + interim).replace(/\s+/g, ' ').trim() }
/** Live amplitude for the waveform. Real microphone level, not an animation. */
export function voiceLevel(): number { return level }

function setPhase(p: VoicePhase): void { phase = p; emit() }

function clearHush(): void {
  if (hush) { clearTimeout(hush); hush = null }
}
function clearIdle(): void {
  if (idle) { clearTimeout(idle); idle = null }
}
function armIdle(): void {
  clearIdle()
  /* 0 (or below) turns this hangup off outright, rather than an infinite
     setTimeout -- his ask (2026-09-08) for the dock's quick panel specif-
     ically, so a session there never ends on silence alone. */
  if (idleMs <= 0) return
  idle = setTimeout(() => { if (phase === 'listening') exit() }, idleMs)
}

/* Recognition is torn down handler-first every time. A detached handler cannot
   deliver the trailing result that SpeechRecognition sends after stop(), which
   is the same trap that used to refill the ask box after sending. */
function killRecognition(): void {
  clearHush()
  clearIdle()
  if (!rec) return
  rec.onresult = null
  rec.onend = null
  rec.onerror = null
  try { rec.abort() } catch { /* already gone */ }
  rec = null
}

/** The only place recognition is ever started. */
function listen(): void {
  const C = Ctor()
  if (!C || phase === 'off') return
  killRecognition()
  heard = ''
  interim = ''
  const r = new C()
  r.lang = 'en-US'
  r.continuous = true
  r.interimResults = true
  r.onresult = (e) => {
    if (phase !== 'listening') return
    let live = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alt = e.results[i][0]
      if (!alt) continue
      if (e.results[i].isFinal) heard += `${alt.transcript} `
      else live += alt.transcript
    }
    interim = live
    emit()
    /* Every word he says pushes the send back. The question goes when he
       stops, not when the engine calls a phrase finished. */
    clearHush()
    if (heard.trim() || interim.trim()) { clearIdle(); hush = setTimeout(send, HUSH) }
  }
  r.onerror = () => { /* no-speech and aborted are ordinary; onend handles it */ }
  r.onend = () => {
    /* Either it gave up on silence, or we tore it down. Only the first case
       should come back, and only while voice mode is still on and listening. */
    if (rec === r && phase === 'listening') {
      rec = null
      setTimeout(() => { if (phase === 'listening') listen() }, RESTART_DELAY)
    }
  }
  rec = r
  try { r.start(); setPhase('listening'); armIdle() } catch { /* start twice; harmless */ }
}

async function send(): Promise<void> {
  clearHush()
  const text = (heard + interim).replace(/\s+/g, ' ').trim()
  /* enter() sets the phase to listening before handing over an opening
     question, so the morning brief passes this the same as a spoken one. */
  if (!text || phase !== 'listening') return
  /* Ears off BEFORE the answer exists. This is the line that stops it hearing
     itself, and it has to happen here rather than after the answer arrives. */
  killRecognition()
  heard = ''
  interim = ''
  setPhase('thinking')
  let answer = ''
  try {
    answer = askFn ? await askFn(text) : ''
  } catch {
    answer = ''
  }
  if (voicePhase() === 'off') return   // he left while it was thinking
  if (answer.trim()) {
    setPhase('speaking')
    try { await say('voice', answer, VOICE_TTS_TIMEOUT_MS) } catch { /* fall through and listen again */ }
  }
  if (voicePhase() === 'off') return   // he left while it was speaking
  listen()
}

/* THE METER RUNS WHETHER OR NOT THE MICROPHONE COULD BE TAPPED.

   It used to be started from inside the microphone setup and gave up at the
   first line if the analyser could not be built. That is one try/catch away
   from a panel that never redraws in ANY phase, which reads as "the waveform
   is broken" rather than as "the meter never started". The analyser is
   optional now; the loop is not. */
function watchLevel(): void {
  let an: AnalyserNode | null = null
  let buf: Uint8Array | null = null
  try {
    if (ctx && stream) {
      const src = ctx.createMediaStreamSource(stream)
      an = ctx.createAnalyser()
      an.fftSize = 1024
      src.connect(an)
      buf = new Uint8Array(an.fftSize)
    }
  } catch {
    /* No meter on his voice. The loop still runs, so the panel still lives. */
    an = null
    buf = null
  }
  const tick = (): void => {
    if (phase === 'off') return
    /* WHILE IT TALKS, THE BARS FOLLOW THE ANSWER. The mic stream is still
       open here, so leaving it on the meter would draw the assistant's own
       voice arriving back through the speakers: a reading of the room, when
       what he wants to see is the sentence being read to him. */
    if (phase === 'speaking') {
      /* IT MUST NEVER SIT STILL WHILE IT IS TALKING. speakingLevel() is the
         real thing where a real thing exists: an analyser on Gemini's audio,
         or the word boundaries the device voice fires. Both can come back with
         nothing, and they did: a remote voice like "Google US English" fires no
         boundary events at all in Chrome, and an audio element behind a
         suspended AudioContext analyses to silence. Either way the bars went
         flat and it looked broken while he could plainly hear it talking.
         So a reading of zero falls back to a generated wave. It is activity
         rather than amplitude, and the alternative is a still bar that lies
         about whether anything is happening. */
      /* Whatever is really there, and nothing when nothing is. The generated
         wave that used to stand in here was the only thing he ever saw, and it
         was not the answer: it was a sine wave. */
      level = speakingLevel()
      emit()
      raf = requestAnimationFrame(tick)
      return
    }
    if (phase !== 'listening') {
      level = 0
      emit()
      raf = requestAnimationFrame(tick)
      return
    }
    if (!an || !buf) {
      /* Listening, with nothing to measure it by. Flat is the honest answer:
         unlike speaking, there is no evidence anything is happening. */
      level = 0
      emit()
      raf = requestAnimationFrame(tick)
      return
    }
    an.getByteTimeDomainData(buf)
    /* RMS around the 128 centre line. */
    let sum = 0
    for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d }
    const rms = Math.sqrt(sum / buf.length)
    /* Normalised against a slowly decaying peak rather than a fixed gain. A
       constant was tried first and it is the wrong tool: microphones differ by
       more than an order of magnitude, so any number that suits a headset
       leaves a laptop's array mic drawing a flat line, and vice versa. This
       adapts to whatever he is actually speaking into, and decays so the bars
       stay lively after he has been loud once. */
    if (rms < NOISE) {
      level = 0
      peak = Math.max(peak * PEAK_DECAY, NOISE * 2)
    } else {
      peak = Math.max(rms, peak * PEAK_DECAY)
      level = Math.min(1, (rms - NOISE) / Math.max(peak - NOISE, NOISE))
    }
    emit()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

/** Turn it on. `ask` sends the question and resolves with the answer's words. */
export async function enter(
  ask: (text: string) => Promise<string>,
  /* Asked on his behalf the moment it opens, for the morning brief. Skips
     straight to thinking: there is nothing to listen for yet. */
  opening?: string,
  /* Overrides IDLE_HANGUP for this session only, reset to the real default
     the moment it ends (exit(), below) -- the full page never passes this
     and keeps the default exactly as it always was. */
  hangupMs = IDLE_HANGUP,
): Promise<boolean> {
  if (!voiceModeAvailable() || phase !== 'off') return false
  askFn = ask
  idleMs = hangupMs
  phase = 'listening'
  /* The waveform is a nicety; recognition is the feature. If the meter cannot
     be opened, carry on without it rather than refusing to start. */
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    watchLevel()
  } catch {
    stream = null
    ctx = null
  }
  /* Started here rather than inside the try, so a microphone that could not be
     metered does not also cost him the waveform while it speaks. */
  if (!raf) watchLevel()
  if (voicePhase() === 'off') { exit(); return false }  // he left during the permission prompt
  if (opening) { heard = opening; interim = ''; void send() } else listen()
  return true
}

/** Turn it off, from anywhere, at any point in the loop. */
export function exit(): void {
  /* Idempotent on purpose. exit() emits, and a listener that reacts to 'off' by
     calling exit() would otherwise recurse through this every time. */
  if (phase === 'off' && !rec && !stream && !ctx) return
  phase = 'off'
  clearIdle()
  killRecognition()
  stopSpeech()
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close().catch(() => { /* already closed */ })
  ctx = null
  askFn = null
  idleMs = IDLE_HANGUP
  heard = ''
  interim = ''
  level = 0
  peak = NOISE * 2
  emit()
}
