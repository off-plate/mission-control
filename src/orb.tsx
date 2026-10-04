/* Thinking orbs (Jakub Antalik, MIT, libraries.dev/orbs), wrapped once so every
   place in the app gets the same three things for free:
   - any size: the library draws three tuned presets (20, 32, 64), so a larger
     mark scales the 64 preset up, which it renders at up to 3x density;
   - the right ink: its colour is read from a CSS token on the spot it sits in,
     so paper, Jarvis and the Zone each get their own without a prop per page;
   - Jarvis: the shell's HUD class is watched, and the token is re-read when it
     flips. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

export function Orb({ state, size = 20, tone = '--a-ink', paused, label, className }: {
  state: OrbState
  size?: number
  /** A CSS custom property to colour the dots with, read where the orb sits. */
  tone?: string
  paused?: boolean
  label?: string
  className?: string
}) {
  const hud = useHud()
  const box = useRef<HTMLSpanElement>(null)
  const [color, setColor] = useState<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (!box.current) return
    const v = getComputedStyle(box.current).getPropertyValue(tone).trim()
    setColor(v || undefined)
  }, [tone, hud])
  const preset: 20 | 32 | 64 = size >= 48 ? 64 : size >= 26 ? 32 : 20
  const k = size / preset
  return (
    <span ref={box} className={`orb${className ? ` ${className}` : ''}`} style={{ width: size, height: size }}>
      <ThinkingOrb
        state={state} size={preset} paused={paused} color={color} theme={hud ? 'dark' : 'light'}
        aria-label={label}
        style={k === 1 ? undefined : { transform: `scale(${k})`, transformOrigin: 'center' }}
      />
    </span>
  )
}
