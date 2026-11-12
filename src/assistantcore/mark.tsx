import { Orb, OrbChip, type OrbState } from '../orb'
import { useEffect, useRef, useState } from 'react'
import { engineName, speakingLevel, speechState, subscribe, toggle } from '../speech'
import * as Icon from '../icons'

/* The assistant's mark: a blob that changes shape as it works.

   It replaced a hexagonal reticle, which replaced a blue sphere. His brief for
   this one: "it should be sort of expanding circle like a blob or something
   that has different shapes whenever it's being interacted with".

   NOT A MORPH BETWEEN TWO POSES. The outline is generated fresh every frame
   from a radius that varies around the circle, so it never returns to the same
   shape twice and never reads as a loop. Three ripples at 2, 3 and 5 lobes,
   turning at different rates and in different directions, are what stop it
   settling into a rhythm.

   The points are joined with a closed Catmull-Rom spline converted to cubic
   Béziers, which is what keeps it liquid: joining them with straight lines, or
   with arcs, gives a cog rather than a drop of water.

   `state` drives all of it, so the animation IS the status. Idle breathes.
   Thinking swells and churns, which is the one place motion stands for work
   rather than for a measurement. Listening and speaking take their amplitude
   from the real signal, so the blob answers his voice and then its own. */
export type MarkState = 'idle' | 'thinking' | 'listening' | 'speaking'

/** A closed outline through points at varying radius, as one smooth path.

    Catmull-Rom to cubic Bézier: each control point is pulled a sixth of the way
    along the line between its neighbours, which is the standard construction
    and the reason the curve passes exactly through every point while staying
    continuous at the joins. */

/* The mark is a thinking orb now (2026-10-04, his ask): the same four moods,
   each its own animation instead of one blob changing speed. */
export const ORB_FOR: Record<MarkState, OrbState> = { idle: 'searching', thinking: 'working', listening: 'listening', speaking: 'composing' }

export function Mark({ state = 'idle', size = 96 }: { state?: MarkState; size?: number }): JSX.Element {
  const label = state === 'thinking' ? 'Thinking' : state === 'listening' ? 'Listening' : state === 'speaking' ? 'Speaking' : 'Jarvis'
  /* Small, it is a status: the reference's capsule with the word beside it. */
  if (size < 48) return <OrbChip state={ORB_FOR[state]} label={label} />
  /* Large, it is the assistant's face: a dense orb straight on the page. */
  return (
    <span className={`as-orbmark as-mark is-${state}`} style={{ width: size, height: size }}>
      <Orb state={ORB_FOR[state]} size={Math.min(64, Math.round(size * 0.8))} dots={1.6} label={label} />
    </span>
  )
}

/* The answer, drawn while it is being read.

   Voice mode had a waveform and Play did not, and Play is where he hears it
   most: he presses it on an answer and the only sign anything is happening was
   the word on the button changing to Pause. "There is no sound wave when the
   assistant is speaking" was about here.

   It runs its own frame loop rather than leaning on the speech module's
   subscribe, which only fires when the state changes and would leave the bars
   frozen through the whole answer. */
export const MINI_BARS = 18

export function MiniWave(): JSX.Element {
  const [, bump] = useState(0)
  const history = useRef<number[]>(Array.from({ length: MINI_BARS }, () => 0))
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const h = history.current
      h.push(speakingLevel())
      if (h.length > MINI_BARS) h.shift()
      bump((n) => n + 1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  /* SVG, not styled spans. As spans this drew a flat dotted line: the computed
     height stayed at its floor while the inline style said ten pixels, because
     a height transition re-targeted every frame never advances. An SVG rect
     cannot be clamped by a flex row or held back by a transition, and the
     geometry is the value rather than a request to lay something out. */
  const W = MINI_BARS * 3 - 1
  return (
    <svg className="as-mini-wave" width={W} height="14" viewBox={`0 0 ${W} 14`} aria-hidden="true">
      {history.current.map((v, i) => {
        const h = 2 + Math.min(1, v) * 11
        return <rect key={i} x={i * 3} y={(14 - h) / 2} width="2" height={h} rx="1" />
      })}
    </svg>
  )
}

/* Play and pause on an answer, the way it sits under a reply in Claude.

   It is deliberately not a row of transport controls. There is no scrubber, no
   speed, no voice picker: this is a thing he presses once on the way to making
   coffee, and every control that is not play is a control he would never touch.

   The label is the state, not a fixed word, because an icon alone cannot say
   whether a silent second means loading or finished. */
export function Speak({ id, text }: { id: string; text: string }): JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [])
  const st = speechState(id)
  const label = st === 'playing' ? 'Pause' : st === 'loading' ? 'Loading' : st === 'paused' ? 'Resume' : 'Play'
  return (
    <button
      className={`as-speak is-${st}`}
      onClick={() => void toggle(id, text)}
      disabled={st === 'loading'}
      aria-label={`${label} this answer, spoken by ${engineName()}`}
      title={`${label}. Read by ${engineName()}.`}
    >
      {st === 'playing' ? <MiniWave /> : null}
      <span className="as-speak-ico" aria-hidden="true">
        {st === 'playing' ? (
          <Icon.Pause size={12} filled />
        ) : (
          <Icon.Play size={12} filled />
        )}
      </span>
      {label}
    </button>
  )
}
