import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { SpaceMark } from './ui'
import { MORNING, SKILLS, type CardKind } from './assistant'
import { stop as stopSpeech } from './speech'
import {
  cancel as cancelDictation, dictateState, dictationAvailable, dictationEngine,
  subscribe as subscribeDictation, toggle as toggleDictation,
} from './dictation'
import { voiceModeAvailable } from './voicemode'
import { getWeather, type Weather } from './weather'
import { SLOTS, dueOn, habitStepKey, routineComplete, requiredSteps, type HabitDef, type PageId } from './types'
import { localDateKey, fmtDuration, periodKeyFor } from './util'
import { ActualLog } from './plan'
import * as Icon from './icons'
import { Mark, Speak, useAssistantThread, useVoiceGlue, VoicePanel } from './assistantcore'

/* The assistant, as a room of its own.

   TWO HALVES, once he has asked something. On the left it talks; on the right
   it SHOWS. The talking half never carries the data, and the showing half never
   carries an opinion. Ask for the day and the left says it pulled the day, the
   right becomes the day; ask about habits next and the left says so, the right
   turns into habits. One canvas, swapped, not a transcript that grows cards.

   Two reasons it is built this way rather than as cards inside the thread.
   Scrolling back four questions to see a list you are working from is not
   reading, it is hunting. And a list you are working from should not move while
   you type the next question.

   IT NEVER SCOPES TO A WORKSPACE. Every other page in this app is filtered to
   the space he is standing in; this one is deliberately not. Asking "what is on
   today" and getting only the Big Time half of today is a wrong answer told
   confidently. So every row carries its workspace mark instead, and the answer
   is the whole day.

   The model never writes a number: it names a card and the app fills it. So a
   wrong sentence is a wrong sentence, and can never become a wrong figure. */


/** Wide enough for the split. Below this the canvas would be a column of
 *  nothing, so the cards go back into the thread where there is room for them. */
function useSplit(): boolean {
  const [wide, setWide] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(min-width: 1000px)').matches : true)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(min-width: 1000px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}


/* ---- the cards ----
   Every one reads the store directly. None of them is handed anything by the
   model beyond its own name. Every row carries its workspace, always, because
   this page mixes all three on purpose. */


/* Rows land one after another instead of all at once, capped at ten so a long
   list never turns into a loading screen. 18ms apart is under the threshold
   where it reads as waiting; it reads as the list being dealt. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 10) * 18}ms` })

function Tick() {
  return (
    <Icon.Check size={12} strokeWidth={4} />
  )
}

/* Where the whole of a card lives, for when only the head of it is shown.
   Partial: the weather card has no page behind it and never truncates, so
   there is nowhere for it to send him and nothing to send him for. */
const MORE_IN: Partial<Record<CardKind, [PageId, string]>> = {
  today: ['today', 'Today'], backlog: ['plan', 'Plan'], habits: ['habits', 'Habits'],
  calendar: ['calendar', 'Calendar'], goals: ['goals', 'Goals'], focus: ['focus', 'Focus'],
  stale: ['plan', 'Plan'],
}

/** The canvas shows everything; a card inside the thread on a phone shows the
 *  head of it and says where the rest is. Forty habits in a chat bubble pushed
 *  the sentence that introduced them off the top of the screen. */
function More({ n, kind }: { n: number; kind: CardKind }) {
  const { setPage } = useStore()
  const where = MORE_IN[kind]
  if (n <= 0 || !where) return null
  const [page, name] = where
  return <button className="as-more" onClick={() => setPage(page)}>{n} more in {name}</button>
}

/* Prague, drawn rather than described.

   The brief used to read the figures out in a sentence, which is the one thing
   a screen is better at than a voice. So the sky gets a card and the sentence
   gets to be a remark: "take a coat" is worth saying, "16 degrees and overcast"
   is already on the wall behind it.

   Every number here is the app's own fetch. The model never touches this. */
function glyphFor(code: number): (p: Icon.IconProps) => JSX.Element {
  if (code === 0) return Icon.Sun
  if (code <= 2) return Icon.CloudSun
  if (code === 3) return Icon.Cloud
  if (code <= 48) return Icon.Fog
  if (code <= 67) return Icon.Rain
  if (code <= 77) return Icon.Snow
  if (code <= 86) return Icon.Rain
  return Icon.Storm
}

function WeatherCard(): JSX.Element {
  const [w, setW] = useState<Weather | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void getWeather().then((got) => { if (!live) return; if (got) setW(got); else setFailed(true) })
    return () => { live = false }
  }, [])
  if (failed) return <p className="as-empty">Could not reach the forecast.</p>
  if (!w) return <p className="as-empty">Looking outside…</p>
  const Now = glyphFor(w.code)
  return (
    <div className="wx">
      <div className="wx-now">
        <Now size={44} strokeWidth={1.5} />
        <span className="wx-temp mono">{w.nowC}<span className="wx-deg">°C</span></span>
        <span className="wx-meta">
          <span className="wx-sky">{w.sky[0].toUpperCase() + w.sky.slice(1)}</span>
          <span className="wx-hilo mono">{w.highC}° / {w.lowC}°{w.rainPct > 0 ? ` · ${w.rainPct}% rain` : ''}</span>
        </span>
      </div>
      {w.hours.length ? (
        /* Scrolls on its own rather than squeezing: eight hours at a readable
           size beats twelve at an unreadable one. */
        <div className="wx-hours">
          {w.hours.map((h) => {
            const G = glyphFor(h.code)
            return (
              <div className="wx-hour" key={h.at}>
                <span className="wx-at mono">{h.at}</span>
                <G size={20} strokeWidth={1.6} />
                <span className={`wx-rain mono${h.rainPct >= 30 ? ' is-wet' : ''}`}>{h.rainPct}%</span>
                <span className="wx-h-temp mono">{h.tempC}°</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function CardBody({ kind, limit }: { kind: CardKind; limit?: number }) {
  const { tasks, habits, habitLog, routines, focusSessions, goals, todayIndex, setPage, toggleTask, toggleHabitDay } = useStore()
  const { state: cal } = useCalendar()
  const day = localDateKey()

  if (kind === 'weather') return <WeatherCard />

  if (kind === 'today' || kind === 'stale') {
    const all = kind === 'today'
      ? tasks.filter((t) => t.list === 'today' && (t.plannedOn ?? day) === day)
      : tasks.filter((t) => t.list === 'backlog' && !t.done)
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).slice(0, 12)
    if (!all.length) return <p className="as-empty">{kind === 'today' ? 'Nothing on the day yet.' : 'Nothing has been sitting long.'}</p>
    const rows = limit ? all.slice(0, limit) : all
    const groups = kind === 'today'
      ? SLOTS.map((s) => ({ label: s.label, items: rows.filter((t) => t.slot === s.id) }))
        .concat([{ label: 'Unsorted', items: rows.filter((t) => !t.slot) }]).filter((g) => g.items.length)
      : [{ label: 'Oldest first', items: rows }]
    return (
      <div className="as-list">
        {groups.map((g) => (
          <div className="as-group" key={g.label}>
            <span className="microcap">{g.label}</span>
            {g.items.map((t, i) => (
              <div className={`as-row${t.done ? ' is-done' : ''}`} key={t.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={!!t.done}
                  aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
                <SpaceMark space={t.space} always />
                <span className="as-row-title">{t.title}</span>
                {t.estimateMin > 0 && <span className="as-row-min mono">{fmtDuration(t.estimateMin)}</span>}
              </div>
            ))}
          </div>
        ))}
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'backlog') {
    const all = tasks.filter((t) => t.list === 'backlog' && !t.done).slice(0, 30)
    if (!all.length) return <p className="as-empty">The list is empty.</p>
    const rows = all.slice(0, limit ?? 20)
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((t, i) => (
            <div className="as-row" key={t.id} style={stagger(i)}>
              <button className="checkbox" role="checkbox" aria-checked={false}
                aria-label={t.title} onClick={() => toggleTask(t.id)}><Tick /></button>
              <SpaceMark space={t.space} always />
              <span className="as-row-title">{t.title}</span>
              {t.carried ? <span className="as-row-min mono">back {t.carried}x</span> : null}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'habits') {
    /* Routines used to ride in this same list under their own auto-ticking
       habit, so "Morning Preparation" and "Invoicing routine" showed up as
       plain checkboxes -- tapping one looked like it worked and reverted on
       the next load, because a routine is finished by running its steps, not
       by a tick (his report, 2026-09-07). Same exclusion useBrief() applies
       to the text brief, applied here to the card so the two never disagree
       about what counts as a habit. */
    const routineHabitIds = new Set(routines.filter((r) => !r.archivedAt && r.habitId).map((r) => r.habitId as string))
    const allHabits = [...habits.filter((h) => !h.archivedAt && dueOn(h, todayIndex, habitLog) && !routineHabitIds.has(h.id) && !habitStepKey(h))]
      .sort((a, b) => Number(a.days[todayIndex]) - Number(b.days[todayIndex]))
    const openRoutines = routines
      .filter((r) => !r.archivedAt && requiredSteps(r).length > 0 && !routineComplete(r, periodKeyFor(r.cadence)))
    if (!allHabits.length && !openRoutines.length) return <p className="as-empty">Nothing is due today.</p>
    const habitRows = limit ? allHabits.slice(0, limit) : allHabits
    return (
      <div className="as-list">
        {openRoutines.length > 0 && (
          <div className="as-group">
            <span className="microcap">Routines still open</span>
            {openRoutines.map((r, i) => (
              <button className="as-row as-row-link" key={r.id} style={stagger(i)} onClick={() => setPage('routines')}>
                <SpaceMark space={r.space} always />
                <span className="as-row-title">{r.title}</span>
                <span className="as-row-min mono">Run it →</span>
              </button>
            ))}
          </div>
        )}
        {habitRows.length > 0 && (
          <div className="as-group">
            {openRoutines.length > 0 && <span className="microcap">Habits</span>}
            {habitRows.map((h: HabitDef, i) => (
              <div className={`as-row${h.days[todayIndex] ? ' is-done' : ''}`} key={h.id} style={stagger(i)}>
                <button className="checkbox" role="checkbox" aria-checked={h.days[todayIndex]}
                  aria-label={h.name} onClick={() => toggleHabitDay(h.id, todayIndex)}><Tick /></button>
                <SpaceMark space={h.space} always />
                <span className="as-row-title">{h.name}</span>
              </div>
            ))}
          </div>
        )}
        <More n={allHabits.length - habitRows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'calendar') {
    if (cal.status !== 'ok') return <p className="as-empty">The calendar is not connected.</p>
    const all = cal.events.filter((e) => e.day >= day).slice(0, 25)
    if (!all.length) return <p className="as-empty">Nothing in the calendar.</p>
    const rows = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        <div className="as-group">
          {rows.map((e, i) => (
            <div className="as-row" key={e.uid + e.day} style={stagger(i)}>
              <span className="as-row-when mono">{e.allDay ? 'all day' : `${String(Math.floor((e.start as number) / 60)).padStart(2, '0')}:${String((e.start as number) % 60).padStart(2, '0')}`}</span>
              <span className="as-row-title">{e.title}</span>
              {e.day !== day && <span className="as-row-min mono">{e.day.slice(5)}</span>}
            </div>
          ))}
        </div>
        <More n={all.length - rows.length} kind={kind} />
      </div>
    )
  }

  if (kind === 'focus') {
    const all = focusSessions.slice(-10).reverse()
    if (!all.length) return <p className="as-empty">No blocks logged yet.</p>
    const week = limit ? all.slice(0, limit) : all
    return (
      <div className="as-list">
        <div className="as-group">
          {week.map((f, i) => (
            <div className="as-row" key={i} style={stagger(i)}>
              <span className="as-row-when mono">{f.day.slice(5)}</span>
              <SpaceMark space={f.space} always />
              <span className="as-row-title">{f.label ?? 'Focus block'}</span>
              <span className="as-row-min mono">{fmtDuration(f.minutes)}</span>
            </div>
          ))}
        </div>
        <More n={all.length - week.length} kind={kind} />
      </div>
    )
  }

  const allGoals = goals.filter((g) => !g.closed)
  if (!allGoals.length) return <p className="as-empty">No goals set.</p>
  const gs = limit ? allGoals.slice(0, limit) : allGoals
  return (
    <div className="as-list">
      <div className="as-group">
        {gs.map((g, i) => (
          <button className="as-row as-link" key={g.id} style={stagger(i)} onClick={() => setPage('goals')}>
            <SpaceMark space={g.space} always />
            <span className="as-row-title">{g.name}</span>
            <span className="as-row-min mono">{g.current} / {g.target}</span>
          </button>
        ))}
      </div>
      <More n={allGoals.length - gs.length} kind="goals" />
    </div>
  )
}

const TITLES: Record<CardKind, string> = {
  today: 'On the day', backlog: 'The list', habits: 'Habits today',
  calendar: 'Calendar', goals: 'Goals', focus: 'Focus', stale: 'Sitting longest',
  weather: 'Prague',
}

/** The canvas. One place, swapped, animated on the swap so the change is
 *  visible rather than a silent substitution while he is looking elsewhere. */
function Canvas({ kinds }: { kinds: CardKind[] }) {
  const sig = kinds.join('+')
  return (
    <aside className="as-canvas" aria-live="polite">
      <header className="as-canvas-head">
        <h2 key={sig}>{kinds.map((k) => TITLES[k]).join(' · ')}</h2>
      </header>
      <div className="as-canvas-body" key={sig}>
        {kinds.map((k) => (
          <section className="as-pane" key={k}>
            {kinds.length > 1 && <h3 className="microcap as-pane-head">{TITLES[k]}</h3>}
            <CardBody kind={k} />
          </section>
        ))}
      </div>
    </aside>
  )
}

/* Dictation, beside Ask. One button, three states, no settings.

   It is hidden rather than disabled where no engine exists, because a mic that
   cannot ever listen is furniture, and a disabled control invites a click that
   teaches nothing. */
function Dictate({ base, onText, busy }: { base: string; onText: (t: string) => void; busy: boolean }): JSX.Element | null {
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
      <Icon.Mic size={15} />
      <span className="as-mic-text">{label}</span>
    </button>
  )
}



export function AssistantPage() {
  const split = useSplit()
  const { logActual } = useStore()
  const { brief, turns, setTurns, busy, err, errHint, canvas, setCanvas, live, send: sendRaw } = useAssistantThread()
  const [q, setQ] = useState('')
  const foot = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  /* The hook's own send() knows nothing about this page's textarea -- moving
     focus back to it is this component's business, not the thread's, so it
     wraps every call site here instead of living inside the shared hook. */
  const send = (text: string, shown?: string) => sendRaw(text, shown).then((r) => { box.current?.focus(); return r })

  /* Answers the "how long did it take?" prompt under a 'done' line. "Skip"
   *  here is HIS word for it, from asking for this feature: it means the same
   *  time as the estimate, not the task-list page's own "skip", which leaves
   *  no time logged at all and asks again later. Two different buttons in two
   *  different places are allowed to mean two different things; this one
   *  means what he asked it to mean. */
  const logTaskActual = (turnIndex: number, doneIndex: number, taskId: string, minutes: number) => {
    logActual(taskId, minutes)
    setTurns((prev) => prev.map((t, ti) => (ti !== turnIndex
      ? t
      : { ...t, done: t.done?.map((d, di) => (di !== doneIndex ? d : { ...d, text: `${d.text} — ${fmtDuration(minutes)}`, needsActual: undefined })) }
    )))
  }

  /* Send one applied change straight back. Only the full page renders the
   *  button this answers -- the dock popup shows the same line with nothing
   *  to press, on purpose (his instruction, 2026-09-10). */
  const undoOne = (turnIndex: number, doneIndex: number) => {
    setTurns((prev) => prev.map((t, ti) => {
      if (ti !== turnIndex) return t
      const d = t.done?.[doneIndex]
      if (!d?.undo || d.undone) return t
      d.undo()
      return { ...t, done: t.done?.map((x, di) => (di !== doneIndex ? x : { ...x, undone: true })) }
    }))
  }
  const undoAll = (turnIndex: number) => {
    setTurns((prev) => prev.map((t, ti) => {
      if (ti !== turnIndex) return t
      t.done?.forEach((d) => { if (d.undo && !d.undone) d.undo() })
      return { ...t, done: t.done?.map((x) => (x.undo && !x.undone ? { ...x, undone: true } : x)) }
    }))
  }

  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])
  /* Instant while it writes. Smooth-scrolling on every token makes each new
     word fight the last one's animation and the column shivers. */
  useEffect(() => { if (live) foot.current?.scrollIntoView({ block: 'end' }) }, [live])
  /* The caret is in the box when the page opens. Every other page here is a
     thing to read; this one is a thing to type into. */
  useEffect(() => { box.current?.focus() }, [])
  /* Walking off the page stops the voice. Otherwise it keeps reading an answer
     that is no longer on screen, from a page he has already left. */
  useEffect(() => stopSpeech, [])

  const empty = turns.length === 0 && !busy && !err
  /* cancel, not stop: the question has been asked, so the tail of it is not
     wanted back in the box that is about to be cleared. */
  const submit = () => { const t = q.trim(); if (t) { cancelDictation(); setQ(''); void send(t) } }

  const { voice, startVoice, runSkill, endVoice } = useVoiceGlue(
    send,
    () => { cancelDictation(); setQ('') },
    () => box.current?.focus(),
  )

  const askBox = voice ? <VoicePanel onExit={endVoice} /> : (
    <form className="as-ask" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <textarea
        ref={box}
        className="as-input"
        value={q}
        rows={1}
        placeholder="Ask anything about your week"
        aria-label="Ask the assistant"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
      />
      <div className="as-ask-foot">
        <span className="as-hint">Enter sends. Shift and Enter for a new line.</span>
        {voiceModeAvailable() ? (
          <button
            type="button" className="as-voice-btn" onClick={() => void startVoice()} disabled={busy}
            title="Talk to it, and it talks back. It keeps listening until you are done."
          >
            <Icon.Waveform size={15} />
            <span className="as-mic-text">Voice</span>
          </button>
        ) : null}
        <Dictate base={q} onText={setQ} busy={busy} />
        <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Ask</button>
      </div>
    </form>
  )

  return (
    <div className={`page as-page${empty ? ' is-empty' : ' is-split'}`}>
      {/* Before he has asked anything the page is a doorway, not a workspace:
          one mark, one question, one box. The split arrives with the answer. */}
      {empty && (
        <div className="as-open">
          <div className="as-hero">
            <Mark state={voice ? 'listening' : 'idle'} />
            <h1 className="as-hero-q">What can I help with?</h1>

          </div>
          {/* Six things he does rather than types, in one row, one design.
              The chip row that used to sit below the ask box is gone: this was
              two different weights for buttons that all do the same kind of
              thing, one filled and central, five outlined and stranded under
              the box. Not gated on voiceModeAvailable() the way the single
              button used to be, because runSkill() already falls back to a
              typed send where voice mode does not exist, and a browser
              without SpeechRecognition should not lose every one-tap skill on
              the doorway, only the live listening. Not attach, search, reason,
              create an image. Those are a general chatbot's furniture and none
              of them is a thing this app does. These are questions about his
              own week, each answerable from his own log. */}
          <div className="as-skills">
            <button className="as-brief" onClick={() => void runSkill(MORNING)}>
              <Icon.Waveform size={18} />
              {MORNING.label}
            </button>
            {SKILLS.map((k) => (
              <button className="as-brief" key={k.label} onClick={() => void runSkill(k)}>
                <Icon.Waveform size={18} />
                {k.label}
              </button>
            ))}
          </div>
          {askBox}
        </div>
      )}

      {!empty && (
        <>
          <div className="as-chat">
            <div className="as-thread">
              {turns.map((t, i) => (
                <div className={`as-turn is-${t.who}`} key={i}>
                  <p className="as-said">{t.text}</p>
                  {/* The app's own account of what changed, not the model's.
                      It sits under the sentence because the sentence is an
                      intention and this is the fact. */}
                  {t.done?.length ? (
                    <>
                      <ul className="as-did">
                        {t.done.map((d, k) => (
                          <li className={`${d.ok ? 'is-ok' : 'is-no'}${d.undone ? ' is-undone' : ''}`} key={k}>
                            {d.ok ? null : <span className="as-did-head">Nothing changed, </span>}
                            {d.text}
                            {d.undone ? <span className="as-did-undone"> — reverted</span> : null}
                            {d.undo && !d.undone ? (
                              <button className="as-did-undo" onClick={() => undoOne(i, k)} title="Undo this one">
                                <Icon.Rewind size={13} /> Undo
                              </button>
                            ) : null}
                            {d.needsActual ? (
                              <ActualLog
                                est={d.needsActual.est}
                                onLog={(m) => logTaskActual(i, k, d.needsActual!.taskId, m)}
                                onSkip={() => logTaskActual(i, k, d.needsActual!.taskId, d.needsActual!.est)}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {/* A batch worth reviewing as one, not one row at a time --
                          his ask, verbatim: "are you approving these edits or you
                          want them revert back". Only past one real change: a
                          single add already has its own row-level Undo right
                          there, and a second button next to it would just be
                          the same choice asked twice. */}
                      {t.done.filter((d) => d.undo && !d.undone).length > 1 ? (
                        <div className="as-did-batch">
                          <span>{t.done.filter((d) => d.undo && !d.undone).length} changes applied</span>
                          <button className="btn btn-quiet as-did-undoall" onClick={() => undoAll(i)}>Undo all</button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {/* One row of things you can do with the answer: hear it, and
                      go to what it pulled. Play used to sit on its own line above
                      these and read as a fourth stacked pill, which made a
                      two-line sentence carry three rows of furniture.
                      On a wide screen the cards live on the right, so the thread
                      keeps only a way back to them. On a phone there is no right,
                      so they render below, full size. */}
                  {t.who === 'it' && (t.text.trim() || (split && t.reply?.show.length)) ? (
                    <div className="as-pulled">
                      {t.text.trim() ? <Speak id={`t${i}`} text={t.text} /> : null}
                      {split && t.reply?.show.length
                        ? t.reply.show.map((c, k) => (
                            <button className="as-pulled-btn" key={k} onClick={() => setCanvas([c.kind])}>
                              {TITLES[c.kind]}
                            </button>
                          ))
                        : null}
                    </div>
                  ) : null}
                  {t.reply?.show.length ? (
                    split ? null : (
                      t.reply.show.map((c, k) => (
                        <section className="as-card" key={k}>
                          <h3 className="microcap">{TITLES[c.kind]}</h3>
                          <CardBody kind={c.kind} limit={6} />
                        </section>
                      ))
                    )
                  ) : null}
                  {t.reply?.next && t.reply.next.length > 0 && (
                    <div className="as-next">
                      {t.reply.next.map((n, k) => (
                        <button className="as-chip" key={k} onClick={() => void send(n)}>{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div className="as-turn is-it">
                  {live
                    ? (
                      <p className="as-said is-live" role="status">
                        {live}<span className="as-caret" aria-hidden="true" />
                      </p>
                    )
                    : (
                      <p className="as-thinking" role="status">
                        {/* ONE indicator, not two. A 22px mark beside three dots
                            was two things saying "working" and neither saying it
                            well: at that size the blob read as a speck while the
                            dots did the actual work. The blob is the whole
                            indicator now, at a size where its churn is legible. */}
                        <Mark state="thinking" size={34} />
                        <span className="visually-hidden">Reading your day</span>
                      </p>
                    )}
                </div>
              )}
              {err && (
                <div className="as-error">
                  <p>{err}</p>
                  {errHint && <p className="as-error-hint">{errHint}</p>}
                </div>
              )}
              <div ref={foot} />
            </div>
            {askBox}
          </div>
          {split && <Canvas kinds={canvas} />}
        </>
      )}
    </div>
  )
}
