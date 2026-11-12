import { Orb } from '../orb'
import { useEffect, useRef, useState } from 'react'
import {
    cancel as cancelDictation, dictateState, dictationAvailable, dictationEngine,
    subscribe as subscribeDictation, toggle as toggleDictation,
} from '../dictation'
import { ActualLog } from '../plan'
import * as Icon from '../icons'
import { type Done } from '../assistantcore'

/** What the last answer changed, on the right, where the day it changed is.
 *  A summary line first (collapsed), because seven rows of "Moved to 16:00"
 *  ate the chat's height; a change that did NOT apply is never hidden behind
 *  the fold, since the failure has to be as visible as the success. */
export function Activity({ done, onUndo, onUndoAll, onLog }: {
  done: Done[]
  onUndo: (k: number) => void
  onUndoAll: () => void
  onLog: (k: number, taskId: string, minutes: number) => void
}) {
  /* A few changes are just shown; a batch folds to its summary line. Folding one
     change behind a click hid the very thing he had just asked for. */
  const [open, setOpen] = useState(done.length <= 3)
  const failed = done.filter((d) => !d.ok).length
  const live = done.filter((d) => d.undo && !d.undone).length
  const rows = done.map((d, k) => ({ d, k })).filter(({ d }) => open || !d.ok || d.needsActual)
  return (
    <section className="as-act" aria-label="What changed">
      <div className="as-act-bar">
        <button className="as-act-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon.ChevronDown size={14} className={open ? 'is-open' : ''} />
          <span>{done.length} {done.length === 1 ? 'change' : 'changes'}{failed ? `, ${failed} did not apply` : ' applied'}</span>
        </button>
        {live > 1 ? <button className="btn btn-quiet as-did-undoall" onClick={onUndoAll}>Undo all</button> : null}
      </div>
      {rows.length ? (
        <ul className="as-did as-act-list">
          {rows.map(({ d, k }) => (
            <li className={`${d.ok ? 'is-ok' : 'is-no'}${d.undone ? ' is-undone' : ''}`} key={k}>
              {d.ok ? null : <span className="as-did-head">Nothing changed, </span>}
              {d.text}
              {d.undone ? <span className="as-did-undone">, reverted</span> : null}
              {d.undo && !d.undone ? (
                <button className="as-did-undo" onClick={() => onUndo(k)} title="Undo this one"><Icon.Rewind size={13} /> Undo</button>
              ) : null}
              {d.needsActual ? (
                <ActualLog est={d.needsActual.est}
                  onLog={(m) => onLog(k, d.needsActual!.taskId, m)}
                  onSkip={() => onLog(k, d.needsActual!.taskId, d.needsActual!.est)} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/* Dictation, beside Ask. One button, three states, no settings.

   It is hidden rather than disabled where no engine exists, because a mic that
   cannot ever listen is furniture, and a disabled control invites a click that
   teaches nothing. */
export function Dictate({ base, onText, busy }: { base: string; onText: (t: string) => void; busy: boolean }): JSX.Element | null {
  const [, bump] = useState(0)
  useEffect(() => subscribeDictation(() => bump((n) => n + 1)), [])
  useEffect(() => cancelDictation, [])
  if (!dictationAvailable()) return null
  const st = dictateState()
  const label = st === 'listening' ? 'Stop' : st === 'transcribing' ? 'Writing it down' : 'Dictate'
  const how = dictationEngine() === 'browser'
    ? 'Speak and the words appear as you go.'
    : 'Speak, then stop, and Whisper writes it down.'
  return (
    <button
      type="button"
      className={`as-mic is-${st}`}
      onClick={() => toggleDictation(base, onText)}
      disabled={busy || st === 'transcribing'}
      aria-label={label}
      aria-pressed={st === 'listening'}
      title={st === 'idle' ? how : label}
    >
      {st === 'listening' ? <Orb state="listening" size={22} label="Listening" /> : st === 'transcribing' ? <Orb state="composing" size={22} label="Writing it down" /> : <Icon.Mic size={15} />}
      <span className="as-mic-text">{label}</span>
    </button>
  )
}

/** The frame: helmet brackets in the corners and a straight gauge down each
 *  edge (his ask, 2026-10-04: straight, so the content gets the width the
 *  curves took). Left, how much of today is still left; right, his focus
 *  time today on a scale marked in hours. Drawn to the room's own size. */
export interface Gauge { fill: number; ticks: number; longEvery: number; label: string }

export function JvFrame({ left, right }: { left: Gauge; right: Gauge }) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return undefined
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w, h } = size
  if (!w || !h) return <svg ref={ref} className="jv-frame" aria-hidden="true" />
  /* A vertical scale at x, ticks pointing inward (dir), filling from the
     bottom up. */
  const y0 = h * 0.16, y1 = h * 0.84
  const scale = (x: number, dir: 1 | -1, g: Gauge) => {
    let t = ''
    for (let i = 0; i <= g.ticks; i++) {
      const y = y1 - ((y1 - y0) * i) / g.ticks, k = i % g.longEvery ? 7 : 14
      t += `M${x} ${y}H${x + dir * k}`
    }
    const f = Math.max(0, Math.min(1, g.fill))
    return { track: `M${x} ${y0}V${y1}`, fill: f > 0 ? `M${x} ${y1}V${y1 - (y1 - y0) * f}` : '', ticks: t }
  }
  const L = scale(40, 1, left), R = scale(w - 40, -1, right)
  const b = 'M2 44V2H44'
  return (
    <svg ref={ref} className="jv-frame" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="jv-bracket" d={`${b}M${w - 44} 2H${w - 2}V44M${w - 2} ${h - 44}V${h - 2}H${w - 44}M44 ${h - 2}H2V${h - 44}`} />
      {w >= 1000 ? (
        <>
          <path className="jv-g-track" d={L.track} /><path className="jv-g-fill" d={L.fill} /><path className="jv-g-ticks" d={L.ticks} />
          <path className="jv-g-track is-amber" d={R.track} /><path className="jv-g-fill is-amber" d={R.fill} /><path className="jv-g-ticks is-amber" d={R.ticks} />
          {/* The labels run along their scales, so they take no width. */}
          <text className="jv-g-label" x={22} y={h / 2} textAnchor="middle" transform={`rotate(-90 22 ${h / 2})`}>{left.label}</text>
          <text className="jv-g-label is-amber" x={w - 22} y={h / 2} textAnchor="middle" transform={`rotate(90 ${w - 22} ${h / 2})`}>{right.label}</text>
        </>
      ) : null}
    </svg>
  )
}
