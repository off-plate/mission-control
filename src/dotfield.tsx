/* Living dot fields, drawn straight onto a card (his picks, 2026-10-04, from
   the Living Dots artifact): flat, not the library's globes, and every one is
   driven by a real number.

   - tide      Momentum. The card fills with dots up to the score, the surface
               rolling like water and lifting under the pointer.
   - dissolve  Day gone. 96 dots, one per quarter hour; spent ones fade and
               sink, the current one breathes.
   - breath    Health. A flat ring that breathes at a pace set by the resting
               pulse: calm and wide when it is low, tight and quick when high.

   Colours come from the element: the dots take its CSS `color`, the live dot
   takes the `hot` custom property, so paper, Jarvis and the dark Jar pages
   each colour it without a prop. Offscreen it stops; under reduced motion it
   draws one still frame. */
import { useEffect, useRef } from 'react'

export type FieldKind = 'tide' | 'dissolve' | 'breath'

type Ctx = CanvasRenderingContext2D
interface Frame { ctx: Ctx; w: number; h: number; top: number; quiet: boolean; t: number; dt: number; v: number; ptr: { x: number; y: number }; ink: string; hot: string; mem: Record<string, unknown> }

function dot(f: Frame, x: number, y: number, r: number, color: string, a: number) {
  f.ctx.globalAlpha = Math.max(0, Math.min(1, a))
  f.ctx.fillStyle = color
  f.ctx.beginPath(); f.ctx.arc(x, y, r, 0, 6.2832); f.ctx.fill()
}

const DRAW: Record<FieldKind, (f: Frame) => void> = {
  /* v: momentum 0..100 */
  tide(f) {
    const v = Math.max(0, Math.min(1, f.v / 100))
    const g = 11, cols = Math.ceil(f.w / g) + 1, rows = Math.ceil(f.h / g) + 1
    const level = f.h * (1 - (0.06 + v * 0.88))
    const surfAt = (x: number, i: number) => {
      let s = level + Math.sin(i * 0.35 + f.t * 1.6) * (2 + v * 5) + Math.sin(i * 0.13 - f.t * 0.9) * 3
      if (f.ptr.y > -900) s -= Math.max(0, 1 - Math.abs(x - f.ptr.x) / 60) * 14
      return s
    }
    for (let i = 0; i < cols; i++) {
      const x = i * g, surf = surfAt(x, i)
      for (let j = 0; j < rows; j++) {
        const y = j * g
        if (Math.abs(y - surf) < g / 2) continue
        if (y > surf) dot(f, x, y, 1.4, f.ink, 0.14 + ((y - surf) / f.h) * 0.3)
        else dot(f, x, y, 1, f.ink, 0.05)
      }
    }
    /* The surface is one smooth line of accent dots at its exact height, at
       half the grid step, so it reads as a wave, not a stepped band. */
    if (!f.quiet) for (let x = 0; x <= f.w; x += g / 2) dot(f, x, surfAt(x, x / g), 1.5, f.hot, 0.95)
  },
  /* v: fraction of the day gone 0..1 */
  dissolve(f) {
    const now = Math.min(95, Math.floor(f.v * 96))
    const top = f.top, area = Math.max(20, f.h - top)
    const want = Math.sqrt(96 * (f.w / area))
    const cols = [8, 12, 16, 24].reduce((a, c) => (Math.abs(c - want) < Math.abs(a - want) ? c : a), 12)
    const rows = 96 / cols
    const pad = 18, gx = (f.w - pad * 2) / Math.max(1, cols - 1), gy = Math.min(gx * 1.1, (area - pad * 1.4) / Math.max(1, rows - 1))
    const y0 = f.h - pad - gy * (rows - 1)
    const off = (f.mem.off as number[] | undefined) ?? (f.mem.off = new Array(96).fill(0)) as number[]
    const r = Math.max(1.6, Math.min(3, gx * 0.22))
    for (let q = 0; q < 96; q++) {
      const x = pad + (q % cols) * gx, y = y0 + Math.floor(q / cols) * gy
      /* Spent quarters are the filled ones, so the solid share IS the number
         beside the title; each settles a few pixels as it goes. What is left
         of the day stays faint. */
      if (q < now) { off[q] = Math.min(1, off[q] + f.dt * 1.4); dot(f, x, y, r, f.ink, 0.62) }
      else if (q === now) { off[q] = 0; const b = 0.5 + 0.5 * Math.sin(f.t * 3); dot(f, x, y, r * 2 + b * 2, f.hot, 0.2); dot(f, x, y, r * 1.35, f.hot, 1) }
      else { off[q] = 0; dot(f, x, y, r * 0.8, f.ink, 0.16) }
    }
  },
  /* v: resting heart rate in bpm */
  breath(f) {
    const calm = 1 - Math.max(0, Math.min(1, (f.v - 45) / 50))
    const cx = f.w / 2, cy = f.h / 2, rate = 0.12 + (1 - calm) * 0.35
    const breath = 0.5 - 0.5 * Math.cos(f.t * 6.2832 * rate)
    const base = Math.min(f.w, f.h) * (0.2 + calm * 0.08)
    for (let ring = 0; ring < 4; ring++) {
      const rr = base * (0.55 + ring * 0.3) * (0.82 + breath * 0.3), n = 18 + ring * 8
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.2832 + f.t * 0.05 * (ring % 2 ? 1 : -1)
        if (ring === 0) dot(f, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.7, f.hot, 0.55 + breath * 0.45)
        else dot(f, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.6 - ring * 0.22, f.ink, 0.5 - ring * 0.1)
      }
    }
  },
}

/** Resolve a CSS colour (including var() and color-mix) to something canvas takes. */
function resolve(el: HTMLElement, css: string): string {
  const probe = document.createElement('span')
  probe.style.color = css
  probe.style.display = 'none'
  el.appendChild(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out
}

export function DotField({ kind, value, hot = 'var(--a-accent-text)', still, top = 0, quiet, className }: {
  kind: FieldKind
  value: number
  /** CSS colour for the live dot (the water line, the current quarter, the core ring). */
  hot?: string
  /** Hold one frame: for data that has gone stale. */
  still?: boolean
  /** Space to leave clear at the top for the card's own header (dissolve). */
  top?: number
  /** No accent line, for a field sitting under text it would crowd (tide). */
  quiet?: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const val = useRef(value); val.current = value
  const stillRef = useRef(!!still); stillRef.current = !!still
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const host = cv.parentElement as HTMLElement
    const ctx = cv.getContext('2d')!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const ptr = { x: -999, y: -999 }
    const mem: Record<string, unknown> = {}
    let w = 0, h = 0, t = 0, last = performance.now(), raf = 0, seen = true, colorsAt = -1, ink = '', hotC = '', drawnV = NaN
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1)
      if (Math.round(r.width) === w && Math.round(r.height) === h) return
      w = Math.round(r.width); h = Math.round(r.height)
      cv.width = w * d; cv.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    const frame = (dt: number) => {
      fit()
      if (!w || !h) return
      if (t - colorsAt > 0.5 || colorsAt < 0) { ink = getComputedStyle(cv).color; hotC = resolve(host, hot); colorsAt = t }
      ctx.clearRect(0, 0, w, h)
      DRAW[kind]({ ctx, w, h, top, quiet: !!quiet, t, dt, v: val.current, ptr, ink, hot: hotC, mem })
      ctx.globalAlpha = 1
    }
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      /* Still (stale data): one frame whenever the value changes, no motion. */
      if (seen && document.visibilityState === 'visible' && (!stillRef.current || drawnV !== val.current)) { if (!stillRef.current) t += dt; frame(dt); drawnV = val.current }
      raf = requestAnimationFrame(loop)
    }
    const move = (e: PointerEvent) => { const r = host.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top }
    const out = () => { ptr.x = ptr.y = -999 }
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', out)
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting })
    io.observe(cv)
    const ro = new ResizeObserver(() => { if (reduce || stillRef.current) frame(0) })
    ro.observe(cv)
    if (reduce) { t = 2; frame(1) } else { frame(0.016); raf = requestAnimationFrame(loop) }
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', out) }
  }, [kind, hot, top, quiet])
  return <canvas ref={ref} className={`dotfield${className ? ` ${className}` : ''}`} aria-hidden="true" />
}
