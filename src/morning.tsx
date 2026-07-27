import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { FALLBACK_NEWS, PER_LANG, loadMorningNews, twistersForDay, type MorningNews } from './morning-data'
import { TYPING_TARGET_WPM, type Routine } from './types'

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
  const { group, cs, en } = twistersForDay()
  return (
    <div className="mr-stretch">
      <p className="mr-lead">
        Group {group} today, {PER_LANG} Czech and {PER_LANG} English. Say each one three times, fast and clean.
      </p>
      <div className="stretch-lang">
        <span className="stretch-lang-head">Česky</span>
        <ol className="stretch-list">
          {cs.map((tw, i) => (
            <li className="stretch-item" key={`cs${i}`}>
              <span className="stretch-tag lang-cs">CZ</span>
              <span className="stretch-text">{tw.text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="stretch-lang">
        <span className="stretch-lang-head">English</span>
        <ol className="stretch-list">
          {en.map((tw, i) => (
            <li className="stretch-item" key={`en${i}`}>
              <span className="stretch-tag lang-en">EN</span>
              <span className="stretch-text">{tw.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/* ---- Typing ----
   This step is not "did you open it", it is "did you hit the number". You log
   the speed you actually got; the step only checks off at the target. */
function Typing({ url, label, routineId, stepId, wpm, best, onLog }: {
  url?: string
  label?: string
  routineId: string
  stepId: string
  wpm?: number
  best?: number
  onLog: (v: number) => void
}) {
  const [entry, setEntry] = useState('')
  const passed = (wpm ?? 0) >= TYPING_TARGET_WPM
  const submit = () => {
    const v = Math.round(Number(entry))
    if (!Number.isFinite(v) || v <= 0) return
    onLog(v)
    setEntry('')
  }
  return (
    <div className="mr-typing">
      <p className="mr-lead">
        One round, and you are chasing a number: <strong>{TYPING_TARGET_WPM} WPM or better</strong>.
        Anything under that is a warm-up, not a pass.
      </p>
      {url && <a className="btn btn-quiet" href={url} target="_blank" rel="noreferrer">{label ?? 'Open typing test'} ↗</a>}

      <div className="wpm-row">
        <label className="wpm-label" htmlFor={`wpm-${stepId}`}>Speed you hit</label>
        <input
          id={`wpm-${stepId}`} className="numinput" type="number" min={1} max={300}
          placeholder="WPM" value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button className="btn btn-primary" disabled={!entry.trim()} onClick={submit}>Log it</button>
      </div>

      {wpm != null && (
        <div className={`wpm-result${passed ? ' pass' : ' under'}`}>
          <span className="wpm-big mono">{wpm}<span className="wpm-unit">WPM</span></span>
          <span className="wpm-verdict">
            {passed
              ? `Target cleared. You can check this one off.`
              : `${TYPING_TARGET_WPM - wpm} short of ${TYPING_TARGET_WPM}. Run it again.`}
          </span>
          <div className="wpm-bar"><i style={{ width: `${Math.min(100, Math.round((wpm / TYPING_TARGET_WPM) * 100))}%` }} /></div>
        </div>
      )}
      {best != null && best > 0 && (
        <p className="wpm-best mono">best so far {best} WPM</p>
      )}
    </div>
  )
}

/* Any step he wrote himself: his own words, and a link if he gave one. */
function PlainStep({ note, link, linkLabel }: { note?: string; link?: string; linkLabel?: string }) {
  return (
    <div className="mr-typing">
      {note && <p className="mr-lead">{note}</p>}
      {link && <a className="btn btn-quiet" href={link} target="_blank" rel="noreferrer">{linkLabel ?? 'Open'} ↗</a>}
      {!note && !link && <p className="mr-lead">Mark it off when it is done.</p>}
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

export function MorningRoutine({ routine, onEdit }: { routine: Routine; onEdit?: () => void }) {
  const { toggleRoutineStep, resetRoutine, setStepData, records } = useStore()
  const steps = routine.steps
  const done = routine.doneStepIds
  const [open, setOpen] = useState<string>('') // everything collapsed until you open a step
  // Held here so the countdown survives collapsing the step or auto-advancing.
  const [med, setMed] = useState<MedState>(MED_IDLE)

  // The typing step is earned, not asserted: it cannot be ticked under target.
  const typingWpm = routine.stepData?.mr4
  const typingLocked = (typingWpm ?? 0) < TYPING_TARGET_WPM

  /* `force` is used when the step earns itself, e.g. logging a passing typing
     speed. Without it the guard would read the score from the render that is
     already stale and refuse the very result that just unlocked it. */
  const onComplete = (id: string, force = false) => {
    if (!force && id === 'mr4' && typingLocked && !done.includes(id)) return
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
    if (stepId === 'mr5') return <GoalsReminder note={s.note} />
    if (stepId === 'mr4') return (
      <Typing
        url={s.link} label={s.linkLabel} routineId={routine.id} stepId="mr4"
        wpm={typingWpm} best={records[`${routine.id}:mr4`]}
        onLog={(v) => {
          setStepData(routine.id, 'mr4', v)
          // Hitting the target is the completion, so it checks itself off.
          if (v >= TYPING_TARGET_WPM && !done.includes('mr4')) onComplete('mr4', true)
        }}
      />
    )
    return <PlainStep note={s.note} link={s.link} linkLabel={s.linkLabel} />
  }

  const total = steps.length
  const doneCount = done.length
  const medRunning = med.phase === 'prep' || med.phase === 'run'
  const medLeft = med.endsAt ? Math.max(0, Math.round((med.endsAt - Date.now()) / 1000)) : 0

  return (
    <div className="panel routine-card mr-card">
      <div className="routine-tag">
        <span className="routine-card-title">{routine.title}</span>
        {/* A running meditation stays visible even when its panel is closed. */}
        {medRunning && open !== 'mr1' && (
          <button className="mr-running mono" onClick={() => setOpen('mr1')}>
            {med.phase === 'prep' ? 'settling' : 'meditating'} {mmss(medLeft)}
          </button>
        )}
        {doneCount === total
          ? <span className="col-tot mono val-pos">done today</span>
          : <span className="routine-progress mono">{doneCount}/{total}</span>}
        {onEdit && (
          <button className="mr-edit" onClick={onEdit} aria-label="Edit the steps of this routine">Edit steps</button>
        )}
      </div>
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
                  disabled={s.id === 'mr4' && typingLocked && !isDone}
                  aria-label={
                    s.id === 'mr4' && typingLocked && !isDone
                      ? `${s.title}: log ${TYPING_TARGET_WPM} WPM or better to check this off`
                      : `Mark ${s.title} ${isDone ? 'not done' : 'done'}`
                  }
                  title={s.id === 'mr4' && typingLocked && !isDone ? `Hit ${TYPING_TARGET_WPM} WPM to check this off` : undefined}
                  onClick={() => onComplete(s.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="mr-head-main" onClick={() => setOpen(isOpen ? '' : s.id)} aria-expanded={isOpen}>
                  <span className="mr-title">{s.title}</span>
                  <span className="mr-status">
                    {isDone ? 'done'
                      : s.id === 'mr4' ? (typingWpm != null ? `${typingWpm} of ${TYPING_TARGET_WPM} WPM` : `${TYPING_TARGET_WPM} WPM to pass`)
                      : isOpen ? 'now' : 'to do'}
                  </span>
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
