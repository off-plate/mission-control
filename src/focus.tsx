import { useState } from 'react'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { Band } from './pages1'
import { Linkify } from './widgets'
import { fmtDuration, fmtWhen, localDateKey } from './util'
import type { FocusSession } from './types'

/* What this page is for: the block running now, and the record of the ones
   already done. Nothing is entered here. A focus block is started from the work
   it belongs to and carries that work's name and its length with it, so a form
   asking him to type one in would be asking him to invent it. The only number he
   sets here is the break, because the break is the one no task can tell him. */

const clock = (iso?: string) => (iso
  ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  : null)

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

function Row({ f }: { f: FocusSession }) {
  const { updateFocus, deleteFocus } = useStore()
  const [editing, setEditing] = useState(false)
  const [mins, setMins] = useState(String(f.minutes))
  const [label, setLabel] = useState(f.label ?? '')

  const save = () => {
    updateFocus(f.id, { minutes: Number(mins) || f.minutes, label: label.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="focus-row is-editing">
        <input className="textinput focus-label" value={label} placeholder="What was it for?" autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
        <input className="textinput focus-min mono" type="number" min={1} max={600} value={mins}
          onChange={(e) => setMins(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        <button className="btn btn-primary focus-btn" onClick={save}>Save</button>
      </div>
    )
  }
  return (
    <div className="focus-row">
      <span className="grow"><Linkify text={f.label ?? 'Focus block'} /></span>
      {clock(f.at) && <span className="focus-at mono">{clock(f.at)}</span>}
      <span className="est-chip">{fmtDuration(f.minutes)}</span>
      <span className="sub-tools">
        <button className="sub-tool" onClick={() => setEditing(true)} aria-label={`Edit this ${f.minutes} minute block`}>Edit</button>
        <button className="sub-tool" onClick={() => deleteFocus(f.id)} aria-label={`Remove this ${f.minutes} minute block`}>Remove</button>
      </span>
    </div>
  )
}

export function FocusPage() {
  const { focusSessions, inView } = useStore()
  const pomo = usePomodoro()

  const mine = focusSessions.filter((f) => inView(f.space))
  const elapsed = pomo.phase === 'focus' && pomo.running
    ? Math.max(0, Math.floor((pomo.blockMin * 60 - pomo.secondsLeft) / 60))
    : 0
  const today = mine.filter((f) => f.day === localDateKey()).reduce((a, f) => a + f.minutes, 0) + elapsed

  /* Grouped by day, newest first: the question this page answers is "what have I
     actually done", and that is a question about days. */
  const days = [...new Set(mine.map((f) => f.day))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="page focus-page">
      <Band title="Focus" metrics={[{ v: fmtDuration(today), k: 'today', tone: 'pos' as const }]} />

      {/* Shown whenever a block exists, paused included: a paused block is still
          the one he is in the middle of. */}
      {pomo.phase !== 'idle' && (
        <div className={`panel focus-live is-${pomo.phase}${pomo.running ? '' : ' is-paused'}`}>
          <span className="focus-live-what">
            <span className="l">{pomo.phase === 'focus' ? (pomo.focusLabel ?? 'Focus') : 'Break'}</span>
            <span className="h">
              {pomo.phase === 'focus'
                ? `${fmtDuration(elapsed)} of ${fmtDuration(pomo.blockMin)}${pomo.running ? '' : ', paused'}`
                : `${fmtDuration(pomo.breakMin)} break${pomo.running ? '' : ', paused'}`}
            </span>
          </span>
          <span className="focus-live-left mono">{mmss(pomo.secondsLeft)}</span>
          <button className="btn btn-ghost focus-btn" onClick={pomo.toggle}>{pomo.running ? 'Pause' : 'Resume'}</button>
          <button className="btn btn-ghost focus-btn" onClick={pomo.skip}>
            {pomo.phase === 'focus' ? 'Skip to break' : 'End break'}
          </button>
          <button className="btn btn-ghost focus-btn" onClick={pomo.stop}>Stop</button>
        </div>
      )}

      {/* The one number no task can supply. */}
      <div className="focus-settings">
        <span className="microcap">Break after each block</span>
        <span className="focus-steps">
          {[3, 5, 10, 15, 20].map((n) => (
            <button key={n} className={`focus-step${pomo.breakMin === n ? ' on' : ''}`}
              aria-pressed={pomo.breakMin === n} onClick={() => pomo.setBreakMin(n)}>
              {n}m
            </button>
          ))}
        </span>
      </div>

      {days.length === 0 && <div className="empty">No focus blocks yet. Start one from a task and it lands here.</div>}

      <div className="focus-days">
      {days.map((d) => {
        const list = mine.filter((f) => f.day === d)
        const total = list.reduce((a, f) => a + f.minutes, 0)
        return (
          <section className="habit-section" key={d}>
            <div className="section-head">
              <span className="microcap">{fmtWhen(d)}</span>
              <span className="section-count mono">{fmtDuration(total)}</span>
            </div>
            <div className="panel">
              {list.map((f) => <Row key={f.id} f={f} />)}
            </div>
          </section>
        )
      })}
      </div>
    </div>
  )
}
