import { useEffect, useRef, useState } from 'react'
import { speakingMeasured, stop as stopSpeaking } from '../speech'
import {
    enter as enterVoice, exit as exitVoice, subscribe as subscribeVoice,
    voiceHeard, voiceLevel, voiceModeAvailable, voicePhase,
} from '../voicemode'

/* Voice mode, in the place the ask box was.

   Not a takeover screen. The thread behind it does not move and every question
   and answer lands in it as an ordinary turn, so what he said is still there to
   read afterwards. Only the box changes shape.

   The bars are a real reading. `voiceLevel()` is the RMS of the microphone
   right now, kept as a short history so the wave travels left as he talks. When
   the microphone is shut, during thinking and speaking, the bars go flat and
   dim, because inventing motion there would be drawing a signal that does not
   exist. */

/* Three layers, deliberately not harmonics of each other: 1.6, 2.7 and 4.3 do
   not divide evenly, so the curves drift out of step and the shape never
   visibly repeats. Two of them run backwards, which is what stops it reading
   as one wave with copies behind it. */
export const RIBBONS = [
  { freq: 1.6, speed: 1, offset: 0, scale: 1, opacity: 1 },
  { freq: 2.7, speed: -0.62, offset: 1.7, scale: 0.68, opacity: 0.5 },
  { freq: 4.3, speed: 0.41, offset: 3.4, scale: 0.4, opacity: 0.28 },
]

/* One curve across the box. The envelope tapers it to nothing at both ends, so
   it reads as a ribbon of light rather than a signal cut off by the edges,
   which is the difference between the reference and a line chart. */
export function ribbon(amp: number, phase: number, freq: number): string {
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const env = Math.sin(Math.PI * t) ** 1.5
    const y = 24 + Math.sin(t * freq * Math.PI * 2 + phase) * amp * env
    pts.push(`${(t * 300).toFixed(1)},${y.toFixed(2)}`)
  }
  return `M${pts.join(' L')}`
}

export function VoicePanel({ onExit }: { onExit: () => void }): JSX.Element {
  const [, bump] = useState(0)
  /* Smoothed, because a meter that jumps frame to frame reads as noise rather
     than as a voice. It rises fast and falls slowly, which is the shape speech
     actually has: a syllable arrives at once and decays. */
  const amp = useRef(0)
  const drift = useRef(0)
  /* Held in a ref so the subscription is made once. Re-subscribing on every
     frame of the waveform would be a new listener sixty times a second. */
  const exitRef = useRef(onExit)
  exitRef.current = onExit
  /* Once, and only once. onExit calls exit() again, exit() emits, and this
     subscriber runs from inside that emit: without the latch it called itself
     until the stack gave out, and the setVoice(false) that removes this panel
     sat AFTER the exit() call and so never ran. The panel stayed on screen with
     a dead microphone behind it. */
  const hungUp = useRef(false)
  useEffect(() => subscribeVoice(() => {
    const want = voiceLevel() * 18
    amp.current += (want - amp.current) * (want > amp.current ? 0.35 : 0.08)
    /* The phase only moves while there is something to show, so silence is
       still rather than a ribbon idling along on its own. */
    if (amp.current > 0.3) drift.current += 0.09
    /* IT CAN HANG UP BY ITSELF, after six seconds with nothing said. The module
       knows it has stopped; React does not, and without this the panel stayed
       on screen with a dead microphone behind it, looking like it was still
       listening. */
    if (voicePhase() === 'off' && !hungUp.current) { hungUp.current = true; exitRef.current() }
    bump((n) => n + 1)
  }), [])

  const phase = voicePhase()
  const heard = voiceHeard()
  /* The bars are live while it listens AND while it talks: one is his voice,
     the other is the answer. Only the wait in between is still. */
  const live = phase === 'listening' || phase === 'speaking'
  /* When it is talking and nothing can be measured, the bars are flat and the
     label says why. A still meter that looks like a fault, with no explanation,
     is how a generated wave got written in the first place. */
  const mute = phase === 'speaking' && !speakingMeasured()
  /* His ask (2026-09-08): a long answer read out loud with no way to cut it
     short except a voice he cannot use while it is already talking over him
     -- "I should be able to interrupt... not with voice, just a click."
     stopSpeaking() (speech.ts) ends the playback outright; voicemode.ts's
     own send() is still sitting on `await say(...)` at that exact moment
     (it resolves the instant playback state returns to idle) and falls
     straight through to listen() itself, phase never having left
     'speaking' along the way -- so a tap here needs nothing from
     voicemode.ts at all, only to end the audio it is already watching for. */
  const interrupt = phase === 'speaking' ? () => stopSpeaking() : undefined
  const said = phase === 'thinking' ? 'Thinking'
    : phase === 'speaking' ? (mute ? 'Reading it out, no level from this voice' : 'Reading it out')
      : 'Listening'

  const wave = (
    <svg
      className="as-wave" viewBox="0 0 300 48" preserveAspectRatio="none"
      aria-hidden="true"
    >
      {RIBBONS.map((r, i) => (
        <path
          key={i}
          d={ribbon(amp.current * r.scale, drift.current * r.speed + r.offset, r.freq)}
          opacity={r.opacity}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )

  return (
    <div className={`as-voice is-${phase}`}>
      <div className="as-voice-head">
        <span className="as-voice-state">{said}{interrupt ? ' — tap to skip' : ''}</span>
        <button type="button" className="as-voice-exit" onClick={onExit}>Done</button>
      </div>
      {/* FLUID, NOT AN EQUALISER. He showed me the reference: a light ribbon
          that moves as one thing, the way Siri does, rather than a row of
          separate bars. Three curves at different frequencies and phases,
          drifting past each other, so the shape never quite repeats.

          Drawn as SVG because as styled divs the bars rendered at their floor
          no matter what their height said: a percentage height carrying a
          transition that is re-targeted every frame never resolves. A path's
          geometry IS the value.

          THE AMPLITUDE IS THE REAL SIGNAL AND NOTHING ELSE. When there is
          nothing to measure the curves settle into a straight line, which is
          the honest picture of silence. Nothing here generates a shape.

          A real button only while speaking, wrapping the exact same wave --
          listening and thinking have nothing here worth interrupting, so
          the picture stays a picture (aria-hidden, named in words beside it)
          the rest of the time rather than a control that does nothing. */}
      {interrupt ? (
        <button
          type="button" className="as-wave-btn" onClick={interrupt}
          aria-label="Stop reading and listen again" title="Tap to stop reading and listen again"
        >
          {wave}
        </button>
      ) : wave}
      <p className="as-voice-heard" aria-live="polite">
        {heard || (live ? 'Say something.' : ' ')}
      </p>
    </div>
  )
}

/** The glue between a conversation (`send`, from useAssistantThread) and voice
 *  mode's own module-level state machine (voicemode.ts): whether the voice
 *  panel is on screen, starting it, falling back to a typed send when the
 *  browser cannot do voice, and hanging up. Shared by the full page and the
 *  dock's compact panel (2026-09-08, his ask that the quick-tap widget be
 *  "primarily voice") so a fix to one is a fix to both, not a fork.
 *
 *  `onBeforeSend` is for whatever the caller needs cleared before a voice
 *  session opens or a skill falls back to typing -- the full page cancels an
 *  in-progress dictation and clears its box; the dock panel has no dictation,
 *  only the box. `refocus` runs once voice hangs up, same reason each caller
 *  already refocuses its own box after an ordinary send. */
export function useVoiceGlue(
  send: (text: string, shown?: string) => Promise<string>,
  onBeforeSend: () => void,
  refocus: () => void,
  /* Passed straight through to voicemode's own enter(). Omitted, the full
     page keeps its exact existing behaviour (a silent hang-up after enough
     dead air) -- the dock passes 0 (his ask, 2026-09-08): the quick panel's
     session runs until HE ends it, closing the panel, holding a long press
     to the full page, or the voice panel's own Done button, never on
     silence alone. */
  idleHangupMs?: number,
) {
  const [voice, setVoice] = useState(false)
  /* Voice mode drives the SAME send as the button, so a spoken question is an
     ordinary turn in the thread and the answer it reads out is the answer he
     can also see. */
  const startVoice = async (opening?: string, openingLabel?: string) => {
    onBeforeSend()
    setVoice(true)
    const ok = await enterVoice(
      (text) => send(text, text === opening ? openingLabel : undefined),
      opening,
      idleHangupMs,
    )
    if (!ok) setVoice(false)
  }
  /* One path for every skill, including the brief. It opens voice mode when
     the browser can do it, because these are things he asks on the way
     somewhere, and falls back to a typed send when it cannot. Either way the
     thread shows the skill's NAME, never the paragraph behind it. */
  const runSkill = async (k: { label: string; ask: string }) => {
    if (voiceModeAvailable()) { await startVoice(k.ask, k.label); return }
    onBeforeSend()
    await send(k.ask, k.label)
  }
  const endVoice = () => { exitVoice(); setVoice(false); refocus() }
  /* Leaving the page (or closing the dock panel) hangs up. A microphone left
     open on something he has walked away from is the worst bug this feature
     could have. */
  useEffect(() => exitVoice, [])

  return { voice, startVoice, runSkill, endVoice }
}
