/* Thinking orbs (Jakub Antalik, MIT, libraries.dev/orbs), done the way the
   library's own site shows them (rebuilt 2026-10-04 after he called the first
   pass faint and poorly done):
   - always drawn from the 64px preset and shown at or below it where possible,
     because scaling a preset DOWN stays crisp and scaling a small one up goes
     sparse and soft;
   - the library's own ink, not a muted app token: bright dots on dark
     surfaces, dark dots on light ones, picked from what the orb sits on;
   - status gets a dark capsule with a shimmering word beside the orb (OrbChip),
     the reference's "Thinking…" pill, with slightly rounded corners because
     fully round pills are off the table in this app. */
import { useEffect, useState } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'

export type { OrbState }

function useHud(): boolean {
  const read = () => !!document.querySelector('.shell.is-hud')
  const [hud, setHud] = useState(read)
  useEffect(() => {
    const shell = document.querySelector('.shell')
    if (!shell) return
    const mo = new MutationObserver(() => setHud(read()))
    mo.observe(shell, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return hud
}

/** 'shell' follows the app: light paper, dark in Jarvis. 'dark' and 'light'
 *  pin it for surfaces that are always one or the other (the Zone, the Jar,
 *  the capsule). */
export type OrbSurface = 'shell' | 'dark' | 'light'

export function Orb({ state, size = 24, surface = 'shell', paused, speed, dots, dotSize, label, className }: {
  state: OrbState
  size?: number
  surface?: OrbSurface
  paused?: boolean
  speed?: number
  dots?: number
  dotSize?: number
  label?: string
  className?: string
}) {
  const hud = useHud()
  const dark = surface === 'dark' || (surface === 'shell' && hud)
  const preset: 20 | 32 | 64 = size >= 30 ? 64 : size >= 22 ? 32 : 20
  const k = size / preset
  return (
    <span className={`orb${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <ThinkingOrb
        state={state} size={preset} paused={paused} speed={speed} dots={dots}
        /* Drawn smaller than its preset, a dot would shrink with it and the orb
           goes grey. Grow the dots back by the same factor so it stays bright. */
        dotSize={k < 1 ? (dotSize ?? 1) / k : dotSize}
        theme={dark ? 'dark' : 'light'} aria-label={label}
        style={k === 1 ? undefined : { transform: `scale(${k})`, transformOrigin: 'center' }}
      />
    </span>
  )
}

/** The reference's status pill: orb plus a shimmering word, on a dark capsule. */
export function OrbChip({ state, label, compact, className }: { state: OrbState; label: string; compact?: boolean; className?: string }) {
  const text = `${label}…`
  return (
    <span className={`orb-chip${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} role="status">
      <Orb state={state} surface="dark" size={compact ? 22 : 48} dots={compact ? undefined : 1.3} />
      <span className="orb-shimmer" data-text={text}>{text}</span>
    </span>
  )
}

/* Momentum's five states, slow to intense, as orb moods. */
export function momentumOrb(m: number): { state: OrbState; speed: number } {
  if (m >= 78) return { state: 'solving', speed: 1.15 }
  if (m >= 48) return { state: 'weaving', speed: 1 }
  if (m >= 22) return { state: 'working', speed: 1 }
  if (m >= 8) return { state: 'connecting', speed: 0.9 }
  return { state: 'searching', speed: 0.6 }
}
