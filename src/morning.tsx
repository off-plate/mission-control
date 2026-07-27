import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { FALLBACK_NEWS, loadMorningNews, twistersForDay, type MorningNews } from './morning-data'
import type { Routine } from './types'

/* The Morning routine as a guided, foldable accordion. Every step starts collapsed;
   you open one to work through it and check it off yourself with the checkbox, same
   as every other routine. Checking a step collapses it and opens the next. Meditation
   runs a 10s settle countdown then a 10-minute timer with a chime at the start and
   end; pronunciation reads today's real AI-news paragraphs; mouth stretch shows three
   rotating full-sentence tongue twisters. Completing all four checks the habit. */

const PREP_SECONDS = 10
const MED_SECONDS = 600

function mmss(sec: number): string {
  const s = Math.max(0, sec)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function ytId(url?: string): string | null {
  if (!url) return null
  const m = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/embed\/([\w-]{11})/)
  return m ? m[1] : null
}

/* Soft sine chime via Web Audio. The Start button is the user gesture that unlocks it. */
function chime(times = 1) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 528
      o.connect(g)
      g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.6
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.start(t)
      o.stop(t + 0.55)
    }
  } catch { /* audio not available; the timer still works */ }
}

/* ---- Meditation ----
   The timer state lives in MorningRoutine, not here, so collapsing this panel
   (or auto-advancing to the next step) does not unmount a running countdown.
   It also runs off a wall-clock deadline, so a backgrounded tab cannot drift. */
interface MedState {
  phase: 'idle' | 'prep' | 'run' | 'ended'
  endsAt: number | null
}
const MED_IDLE: MedState = { phase: 'idle', endsAt: null }

function Meditation({ url, med, setMed, onEnd }: {
  url?: string
  med: MedState
  setMed: (s: MedState) => void
  onEnd: () => void
}) {
  const id = ytId(url)
  const [, tick] = useState(0)
  const { phase, endsAt } = med
  const left = endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : PREP_SECONDS

  useEffect(() => {
    if (phase !== 'prep' && phase !== 'run') return
    const t = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(t)
  }, [phase])

  useEffect(() => {
    if (!endsAt || left > 0) return
    if (phase === 'prep') { chime(1); setMed({ phase: 'run', endsAt: Date.now() + MED_SECONDS * 1000 }) }
    else if (phase === 'run') { chime(2); setMed({ phase: 'ended', endsAt: null }); onEnd() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, phase, endsAt])

  const start = () => setMed({ phase: 'prep', endsAt: Date.now() + PREP_SECONDS * 1000 })
  const reset = () => setMed(MED_IDLE)

  const label = phase === 'prep' ? 'Settle in' : phase === 'run' ? 'Meditation' : phase === 'ended' ? 'Done' : 'Ready'
  const clock = phase === 'ended' ? '0:00' : mmss(left)

  return (
    <div className="mr-med">
      {id && (
        <div className="med-frame">
          <iframe
            title="Meditation soundtrack"
            src={`https://www.youtube.com/embed/${id}?rel=0&hl=en`}
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        </div>
      )}
      <div className={`med-stage phase-${phase}`}>
        <span className="med-phase">{label}</span>
        <span className="med-clock mono">{clock}</span>
        <span className="med-hint">
          {phase === 'idle' && 'Press play above, then Start. A chime marks the real beginning and the end.'}
          {phase === 'prep' && 'Get comfortable. The 10 minutes begin on the chime.'}
          {phase === 'run' && 'Follow the breath. A double chime will tell you when time is up.'}
          {phase === 'ended' && 'That is ten minutes. Check it off above when you are ready.'}
        </span>
        <div className="med-controls">
          {phase === 'idle' && <button className="btn btn-primary" onClick={start}>Start</button>}
          {(phase === 'prep' || phase === 'run') && <button className="btn btn-ghost" onClick={reset}>Stop</button>}
          {phase === 'ended' && <button className="btn btn-ghost" onClick={reset}>Again</button>}
        </div>
      </div>
    </div>
  )
}

/* ---- Pronunciation: read today's real AI-news paragraphs aloud ---- */
function Pronunciation() {
  const [news, setNews] = useState<MorningNews | null>(null)
  useEffect(() => { loadMorningNews().then(setNews) }, [])
  const n = news ?? FALLBACK_NEWS
  return (
    <div className="mr-pron">
      <p className="mr-lead">Read both aloud, slowly and clearly. Real AI news, refreshed each morning.</p>
      <div className="pron-para">
        <span className="pron-lang">EN</span>
        <p>{n.en.text}</p>
        {n.en.url ? <a className="pron-src" href={n.en.url} target="_blank" rel="noreferrer">{n.en.source} ↗</a> : <span className="pron-src">{n.en.source}</span>}
      </div>
      <div className="pron-para">
        <span className="pron-lang">CZ</span>
        <p>{n.cs.text}</p>
        {n.cs.url ? <a className="pron-src" href={n.cs.url} target="_blank" rel="noreferrer">{n.cs.source} ↗</a> : <span className="pron-src">{n.cs.source}</span>}
      </div>
    </div>
  )
}

/* ---- Mouth stretch: three rotating full-sentence tongue twisters ---- */
function MouthStretch() {
  const { group, items } = twistersForDay()
  return (
    <div className="mr-stretch">
      <p className="mr-lead">Group {group} today. Say each one three times, fast and clean.</p>
      <ol className="stretch-list">
        {items.map((tw, i) => (
          <li className="stretch-item" key={i}>
            <span className={`stretch-tag lang-${tw.lang}`}>{tw.lang === 'cs' ? 'CZ' : 'EN'}</span>
            <span className="stretch-text">{tw.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---- Typing ---- */
function Typing({ url, label }: { url?: string; label?: string }) {
  return (
    <div className="mr-typing">
      <p className="mr-lead">One quick round to wake the hands up.</p>
      {url && <a className="btn btn-quiet" href={url} target="_blank" rel="noreferrer">{label ?? 'Open typing test'} ↗</a>}
    </div>
  )
}

/* ---- Goals reminder (content to be defined together) ---- */
function GoalsReminder({ note }: { note?: string }) {
  return (
    <div className="mr-typing">
      <p className="mr-lead">{note ?? 'Look at what you are working toward before the day pulls you elsewhere.'}</p>
    </div>
  )
}

export function MorningRoutine({ routine }: { routine: Routine }) {
  const { toggleRoutineStep, resetRoutine } = useStore()
  const steps = routine.steps
  const done = routine.doneStepIds
  const [open, setOpen] = useState<string>('') // everything collapsed until you open a step
  // Held here so the countdown survives collapsing the step or auto-advancing.
  const [med, setMed] = useState<MedState>(MED_IDLE)

  const onComplete = (id: string) => {
    const wasDone = done.includes(id)
    toggleRoutineStep(routine.id, id)
    if (!wasDone) {
      const idx = steps.findIndex((s) => s.id === id)
      const next = steps.slice(idx + 1).find((s) => !done.includes(s.id))
      setOpen(next ? next.id : '')
    }
  }

  const body = (stepId: string) => {
    const s = steps.find((x) => x.id === stepId)!
    if (stepId === 'mr1') return <Meditation url={s.link} med={med} setMed={setMed} onEnd={() => { if (!done.includes('mr1')) onComplete('mr1') }} />
    if (stepId === 'mr2') return <Pronunciation />
    if (stepId === 'mr3') return <MouthStretch />
    if (stepId === 'mr4') return <Typing url={s.link} label={s.linkLabel} />
    return <GoalsReminder note={s.note} />
  }

  const total = steps.length
  const doneCount = done.length
  const medRunning = med.phase === 'prep' || med.phase === 'run'
  const medLeft = med.endsAt ? Math.max(0, Math.round((med.endsAt - Date.now()) / 1000)) : 0

  return (
    <div className="panel routine-card mr-card">
      <div className="routine-tag">
        {/* A running meditation stays visible even when its panel is closed. */}
        {medRunning && open !== 'mr1' && (
          <button className="mr-running mono" onClick={() => setOpen('mr1')}>
            {med.phase === 'prep' ? 'settling' : 'meditating'} {mmss(medLeft)}
          </button>
        )}
        {doneCount === total
          ? <span className="col-tot mono val-pos">done today</span>
          : <span className="routine-progress mono">{doneCount}/{total}</span>}
      </div>
      <span className="routine-card-title">{routine.title}</span>
      {routine.blurb && <p className="routine-blurb">{routine.blurb}</p>}

      <div className="mr-accordion">
        {steps.map((s) => {
          const isDone = done.includes(s.id)
          const isOpen = open === s.id
          return (
            <div className={`mr-step${isOpen ? ' open' : ''}${isDone ? ' done' : ''}`} key={s.id}>
              <div className="mr-head">
                <button
                  className="routine-check mr-check"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`Mark ${s.title} ${isDone ? 'not done' : 'done'}`}
                  onClick={() => onComplete(s.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="mr-head-main" onClick={() => setOpen(isOpen ? '' : s.id)} aria-expanded={isOpen}>
                  <span className="mr-title">{s.title}</span>
                  <span className="mr-status">{isDone ? 'done' : isOpen ? 'now' : 'to do'}</span>
                  <svg className="mr-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
              {isOpen && <div className="mr-body">{body(s.id)}</div>}
            </div>
          )
        })}
      </div>

      <div className="routine-card-foot" style={{ marginTop: 'var(--s4)' }}>
        <span className="assist-note">Finishing all {total} checks off “Morning routine” in Habits.</span>
        {doneCount > 0 && (
          <button className="btn btn-ghost routine-reset" onClick={() => { resetRoutine(routine.id); setMed(MED_IDLE); setOpen('') }}>Reset</button>
        )}
      </div>
    </div>
  )
}
