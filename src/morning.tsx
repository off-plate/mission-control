import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { FALLBACK_NEWS, PER_LANG, loadMorningNews, twistersForDay, type MorningNews } from './morning-data'
import { TYPING_TARGET_WPM, type PageId, type Routine } from './types'
import { SpaceMark } from './pages1'
import * as Icon from './icons'

/* The Morning routine as a guided, foldable accordion. Every step starts collapsed;
   you open one to work through it and check it off yourself with the checkbox, same
   as every other routine. Checking a step collapses it and opens the next. Meditation
   is the soundtrack and nothing else; pronunciation reads today's real AI-news
   paragraphs; mouth stretch shows three rotating full-sentence tongue twisters.
   Completing all four checks the habit.

   The meditation step used to run its own countdown: ten seconds to settle, then a
   ten-minute timer with a chime at each end. It is gone on his instruction of
   2026-08-03. It had drifted out of step with the five minutes he asked for, its
   own copy still said ten, and a countdown that disagrees with him about how long
   he is sitting is worse than no countdown. He plays the track and ticks the box. */

function ytId(url?: string): string | null {
  if (!url) return null
  const m = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/embed\/([\w-]{11})/)
  return m ? m[1] : null
}

/* ---- Meditation ----
   The soundtrack, and nothing else. */

function Meditation({ url }: { url?: string }) {
  const id = ytId(url)
  if (!id) return null
  return (
    <div className="mr-med">
      <div className="med-frame">
        <iframe
          title="Meditation soundtrack"
          src={`https://www.youtube.com/embed/${id}?rel=0&hl=en`}
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
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
function Typing({ url, label, stepId, onLog }: {
  url?: string
  label?: string
  stepId: string
  onLog: (v: number) => void
}) {
  const [entry, setEntry] = useState('')
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

      {/* Nothing else. You type the number and you are done: the step's own
          checkbox is what tells you it unlocked, and the score itself lives in
          Reflect under Numbers. A result card here restated the number you had
          just typed, in a box the size of the step. */}
    </div>
  )
}

/* Any step he wrote himself: his own words, and a link if he gave one. */
function PlainStep({ note, link, linkLabel, goto: page, gotoLabel }: { note?: string; link?: string; linkLabel?: string; goto?: PageId; gotoLabel?: string }) {
  const { setPage } = useStore()
  return (
    <div className="mr-typing">
      {note && <p className="mr-lead">{note}</p>}
      {/* The step's work lives on a page of this app, so the step opens it
          rather than asking him to do the same thinking twice. */}
      {page && <button className="btn btn-quiet" onClick={() => setPage(page)}>{gotoLabel ?? 'Open it'}</button>}
      {link && <a className="btn btn-quiet" href={link} target="_blank" rel="noreferrer">{linkLabel ?? 'Open'} ↗</a>}
      {!note && !link && !page && <p className="mr-lead">Mark it off when it is done.</p>}
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

export function MorningRoutine({ routine, onEdit, onShut }: { routine: Routine; onEdit?: () => void; onShut?: () => void }) {
  const { toggleRoutineStep, setStepData } = useStore()
  const steps = routine.steps
  const done = routine.doneStepIds
  const [open, setOpen] = useState<string>('') // everything collapsed until you open a step

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
    if (stepId === 'mr1') return <Meditation url={s.link} />
    if (stepId === 'mr2') return <Pronunciation />
    if (stepId === 'mr3') return <MouthStretch />
    if (stepId === 'mr5') return <GoalsReminder note={s.note} />
    if (stepId === 'mr4') return (
      <Typing
        url={s.link} label={s.linkLabel} stepId="mr4"
        onLog={(v) => {
          // Hitting the target is the completion; the store does both at once.
          setStepData(routine.id, 'mr4', v)
          if (v >= TYPING_TARGET_WPM) {
            const idx = steps.findIndex((x) => x.id === 'mr4')
            const next = steps.slice(idx + 1).find((x) => !done.includes(x.id))
            setOpen(next ? next.id : '')
          }
        }}
      />
    )
    return <PlainStep note={s.note} link={s.link} linkLabel={s.linkLabel} goto={s.goto} gotoLabel={s.gotoLabel} />
  }

  const total = steps.length
  const doneCount = done.length

  return (
    <div className="panel routine-card mr-card">
      <div className="routine-tag">
        {/* Routines now list every workspace at once, so this card carries its
            own colour and letter like the plain ones beside it. The title is
            the control that shuts it again. */}
        <button className="routine-open is-open" onClick={onShut} aria-expanded disabled={!onShut}>
          <SpaceMark space={routine.space} always />
          <span className="routine-card-title">{routine.title}</span>
        </button>
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
                  <Icon.Check size={12} strokeWidth={4.4} />
                </button>
                <button className="mr-head-main" onClick={() => setOpen(isOpen ? '' : s.id)} aria-expanded={isOpen}>
                  <span className="mr-title">{s.title}</span>
                  <span className="mr-status">
                    {isDone ? 'done'
                      : s.id === 'mr4' ? (typingWpm != null ? `${typingWpm} of ${TYPING_TARGET_WPM} WPM` : `${TYPING_TARGET_WPM} WPM to pass`)
                      : isOpen ? 'now' : 'to do'}
                  </span>
                  <Icon.ChevronDown size={14} className="mr-chev" />
                </button>
              </div>
              {isOpen && <div className="mr-body">{body(s.id)}</div>}
            </div>
          )
        })}
      </div>

      {/* No footer: no line about which habit this checks off, and no reset,
          which used to delete the record that he had done it. */}
    </div>
  )
}
