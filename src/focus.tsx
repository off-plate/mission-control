import { useState } from 'react'
import { useStore } from './store'
import { usePomodoro } from './pomodoro'
import { Band } from './pages1'
import { fmtDuration, fmtWhen, localDateKey } from './util'
import type { FocusSession } from './types'

/* Focus blocks were written and never shown. The timer recorded them, habits and
   the ledger read them, and there was no page where he could see what he had
   actually done, correct a block that ran long, or add one he did away from the
   app. This is that page. */

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
      <span className="grow">{f.label ?? 'Focus block'}</span>
      {f.manual && <span className="focus-tag mono">by hand</span>}
      <span className="est-chip">{fmtDuration(f.minutes)}</span>
      <span className="sub-tools">
        <button className="sub-tool" onClick={() => setEditing(true)} aria-label={`Edit this ${f.minutes} minute block`}>Edit</button>
        <button className="sub-tool" onClick={() => deleteFocus(f.id)} aria-label={`Remove this ${f.minutes} minute block`}>Remove</button>
      </span>
    </div>
  )
}

export function FocusPage() {
  const { focusSessions, addFocusManual, inView } = useStore()
  const pomo = usePomodoro()
  const [mins, setMins] = useState('30')
  const [label, setLabel] = useState('')
  const [day, setDay] = useState(localDateKey())

  const mine = focusSessions.filter((f) => inView(f.space))
  const live = pomo.phase === 'focus' && pomo.running ? Math.floor((pomo.focusMin * 60 - pomo.secondsLeft) / 60) : 0
  const today = mine.filter((f) => f.day === localDateKey()).reduce((a, f) => a + f.minutes, 0) + live

  /* Grouped by day, newest first: the question this page answers is "what have I
     actually done", and that is a question about days. */
  const days = [...new Set(mine.map((f) => f.day))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="page focus-page">
      <Band
        title="Focus"
        metrics={[{ v: fmtDuration(today), k: 'today', tone: 'pos' as const }]}
      />

      {live > 0 && (
        <div className="panel focus-live">
          <span className="grow">{pomo.focusLabel ?? 'Focus'}, running now</span>
          <span className="est-chip">{fmtDuration(live)} so far</span>
        </div>
      )}

      <div className="panel focus-add">
        <input className="textinput focus-label" value={label} placeholder="Focus done away from the app"
          onChange={(e) => setLabel(e.target.value)} />
        <input className="textinput focus-min mono" type="number" min={1} max={600} value={mins}
          onChange={(e) => setMins(e.target.value)} aria-label="Minutes" />
        <input className="textinput focus-day" type="date" max={localDateKey()} value={day}
          onChange={(e) => setDay(e.target.value)} aria-label="Which day" />
        <button className="btn btn-primary" disabled={!Number(mins)}
          onClick={() => { addFocusManual({ minutes: Number(mins), label: label.trim() || undefined, day }); setLabel('') }}>
          Add it
        </button>
      </div>

      {days.length === 0 && <div className="empty">No focus blocks yet. Start the timer and they land here.</div>}

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
  )
}
