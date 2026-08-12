import { useEffect, useState } from 'react'
import { useStore } from './store'
import { FALLBACK_NEWS, PER_LANG, loadMorningNews, twistersForDay, type MorningNews } from './morning-data'
import { habitGate, habitNumberOn, habitStepKey, type HabitDef, type PageId } from './types'
import { localDateKey } from './util'

/* What a routine STEP could do, on the habit it became.

   The merge turned fifty steps into fifty habits and kept what they said: the
   note, the link, the page they opened. It did not keep what they DID. The
   typing test was not "did you open it", it was "did you hit 75", and it came
   back as a box he could tick. "Move or caffeine" was one question with two
   answers and came back as a box. Two steps had no text at all, because their
   whole body was content this app builds fresh every morning.

   So this file is the step's body, living on the habit. Nothing here is new
   behaviour: it is the behaviour the step had, at its new address. */

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

/* ---- A habit judged by a number ----
   You log what you actually got; it only counts at the target. His copy from
   the routine, unchanged, because it was already right. */
function NumberGate({ h }: { h: HabitDef }) {
  const { stepLog, records, logHabitNumber } = useStore()
  const gate = habitGate(h)
  const key = habitStepKey(h)
  const [entry, setEntry] = useState('')
  if (!gate) return null
  const today = habitNumberOn(stepLog, h, localDateKey())
  const best = key ? records[`${key.routineId}:${key.stepId}`] ?? 0 : 0
  const submit = () => {
    const v = Math.round(Number(entry))
    if (!Number.isFinite(v) || v <= 0) return
    logHabitNumber(h.id, v)
    setEntry('')
  }
  return (
    <div className="mr-typing">
      <p className="mr-lead">
        One round, and you are chasing a number: <strong>{gate.target} {gate.unit} or better</strong>.
        Anything under that is a warm-up, not a pass.
      </p>
      <div className="wpm-row">
        <label className="wpm-label" htmlFor={`wpm-${h.id}`}>Speed you hit</label>
        <input
          id={`wpm-${h.id}`} className="numinput" type="number" min={1} max={300}
          placeholder={gate.unit} value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button className="btn btn-primary" disabled={!entry.trim()} onClick={submit}>Log it</button>
      </div>
      {/* The one line that is not in the title: what today's attempt actually
          got, and how far off it is. A run that missed says go again, because
          the whole point of the gate is that missing means missing. */}
      {today != null && (
        <p className={`run-verdict${today >= gate.target ? ' pass' : ''}`}>
          {today >= gate.target
            ? `${today} ${gate.unit} today. Passed.`
            : `${today} ${gate.unit} today, ${gate.target - today} short. Go again.`}
          {best > 0 && <span className="run-best mono">best {best}</span>}
        </p>
      )}
    </div>
  )
}

/* ---- A habit with two answers ----
   One question, so one row and one streak. Which way he went is worth keeping:
   a month of "caffeine" every morning is the habit telling him something. */
function AltPick({ h }: { h: HabitDef }) {
  const { habitLog, pickHabitAlt } = useStore()
  const day = localDateKey()
  const picked = habitLog
    .find((t) => t.habitId === h.id && t.day === day && !!t.src && t.src.startsWith('alt:'))
    ?.src?.slice(4)
  return (
    <div className="run-alts">
      {(h.alts ?? []).map((a) => (
        <button
          key={a.id}
          className={`run-alt${picked === a.id ? ' picked' : ''}`}
          aria-pressed={picked === a.id}
          onClick={() => pickHabitAlt(h.id, a.id)}
        >
          <span className="run-alt-title">{a.title}</span>
          {a.note && <span className="run-alt-note">{a.note}</span>}
        </button>
      ))}
    </div>
  )
}

/** Does this habit carry something to DO, beyond the tick it already has? The
 *  note stays on the row, its own short description, for every habit; a caret
 *  only for the ones a note cannot cover: a body the app builds fresh, a
 *  number to clear, an either-or to answer. A caret on all fifty rows for a
 *  drawer that just repeated the row's own note would be an affordance that
 *  does nothing on forty of them. */
export function habitHasRun(h: HabitDef): boolean {
  return !!(h.runner || h.alts?.length || habitGate(h))
}

/** The step's own work, at the habit's new address. The note and the link stay
 *  on the row; this is what a note could never carry. */
export function HabitRun({ h }: { h: HabitDef }) {
  return (
    <div className="habit-run">
      {h.example && <p className="run-example">{h.example}</p>}
      {h.runner === 'pronunciation' && <Pronunciation />}
      {h.runner === 'stretch' && <MouthStretch />}
      {h.alts?.length ? <AltPick h={h} /> : null}
      <NumberGate h={h} />
    </div>
  )
}
