import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { FALLBACK_NEWS, loadMorningNews, twistersForDay, type MorningNews } from './morning-data'
import type { Routine } from './types'

/* The Morning routine as a guided, foldable accordion. Finishing a step collapses
   it with a check and opens the next. Meditation runs a 10s settle countdown then
   a 10-minute timer with a chime at the start and end; pronunciation reads today's
   real AI-news paragraphs; mouth stretch shows three rotating full-sentence tongue
   twisters. Completing every step checks the Morning routine habit for the day. */

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

function DoneButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button className={`btn ${done ? 'btn-ghost' : 'btn-primary'} mr-done`} onClick={onClick}>
      {done ? 'Done ✓  ·  redo' : 'Mark done'}
    </button>
  )
}

/* ---- Meditation ---- */
function Meditation({ url, done, onComplete }: { url?: string; done: boolean; onComplete: () => void }) {
  const id = ytId(url)
  const [phase, setPhase] = useState<'idle' | 'prep' | 'run' | 'ended'>('idle')
  const [left, setLeft] = useState(PREP_SECONDS)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (phase !== 'prep' && phase !== 'run') return
    timer.current = window.setInterval(() => setLeft((l) => l - 1), 1000)
    return () => window.clearInterval(timer.current)
  }, [phase])

  useEffect(() => {
    if (phase === 'prep' && left <= 0) { chime(1); setPhase('run'); setLeft(MED_SECONDS) }
    else if (phase === 'run' && left <= 0) { chime(2); setPhase('ended'); if (!done) onComplete() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, phase])

  const start = () => { setPhase('prep'); setLeft(PREP_SECONDS) }
  const reset = () => { window.clearInterval(timer.current); setPhase('idle'); setLeft(PREP_SECONDS) }

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
          {phase === 'ended' && 'That is ten minutes. Checked off for today.'}
        </span>
        <div className="med-controls">
          {phase === 'idle' && <button className="btn btn-primary" onClick={start}>Start</button>}
          {(phase === 'prep' || phase === 'run') && <button className="btn btn-ghost" onClick={reset}>Stop</button>}
          {phase === 'ended' && <button className="btn btn-ghost" onClick={reset}>Again</button>}
        </div>
      </div>
      <DoneButton done={done} onClick={onComplete} />
    </div>
  )
}

/* ---- Pronunciation: read today's real AI-news paragraphs aloud ---- */
function Pronunciation({ done, onComplete }: { done: boolean; onComplete: () => void }) {
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
      <DoneButton done={done} onClick={onComplete} />
    </div>
  )
}

/* ---- Mouth stretch: three rotating full-sentence tongue twisters ---- */
function MouthStretch({ done, onComplete }: { done: boolean; onComplete: () => void }) {
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
      <DoneButton done={done} onClick={onComplete} />
    </div>
  )
}

/* ---- Typing ---- */
function Typing({ url, label, done, onComplete }: { url?: string; label?: string; done: boolean; onComplete: () => void }) {
  return (
    <div className="mr-typing">
      <p className="mr-lead">One quick round to wake the hands up.</p>
      {url && <a className="btn btn-quiet" href={url} target="_blank" rel="noreferrer">{label ?? 'Open typing test'} ↗</a>}
      <DoneButton done={done} onClick={onComplete} />
    </div>
  )
}

export function MorningRoutine({ routine }: { routine: Routine }) {
  const { toggleRoutineStep } = useStore()
  const steps = routine.steps
  const done = routine.doneStepIds
  const firstUndone = steps.findIndex((s) => !done.includes(s.id))
  const [open, setOpen] = useState<string>(steps[firstUndone === -1 ? 0 : firstUndone]?.id ?? '')

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
    const isDone = done.includes(stepId)
    const complete = () => onComplete(stepId)
    if (stepId === 'mr1') return <Meditation url={s.link} done={isDone} onComplete={complete} />
    if (stepId === 'mr2') return <Pronunciation done={isDone} onComplete={complete} />
    if (stepId === 'mr3') return <MouthStretch done={isDone} onComplete={complete} />
    return <Typing url={s.link} label={s.linkLabel} done={isDone} onComplete={complete} />
  }

  const total = steps.length
  const doneCount = done.length

  return (
    <div className="panel routine-card mr-card">
      <div className="routine-tag">
        <span className="microcap">Daily</span>
        {doneCount === total
          ? <span className="col-tot mono val-pos">done today</span>
          : <span className="routine-progress mono">{doneCount}/{total}</span>}
      </div>
      <span className="routine-card-title">{routine.title}</span>
      {routine.blurb && <p className="routine-blurb">{routine.blurb}</p>}

      <div className="mr-accordion">
        {steps.map((s, i) => {
          const isDone = done.includes(s.id)
          const isOpen = open === s.id
          return (
            <div className={`mr-step${isOpen ? ' open' : ''}${isDone ? ' done' : ''}`} key={s.id}>
              <button className="mr-head" onClick={() => setOpen(isOpen ? '' : s.id)} aria-expanded={isOpen}>
                <span className="mr-num" aria-hidden="true">{isDone ? '✓' : i + 1}</span>
                <span className="mr-title">{s.title}</span>
                <span className="mr-status">{isDone ? 'done' : isOpen ? 'now' : 'to do'}</span>
                <svg className="mr-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {isOpen && <div className="mr-body">{body(s.id)}</div>}
            </div>
          )
        })}
      </div>

      <div className="routine-card-foot" style={{ marginTop: 'var(--s4)' }}>
        <span className="assist-note">Finishing all {total} checks off “Morning routine” in Habits.</span>
      </div>
    </div>
  )
}
