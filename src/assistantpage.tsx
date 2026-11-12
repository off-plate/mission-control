import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { MORNING, SKILLS, type CardKind } from './assistant'
import {
    cancel as cancelDictation
} from './dictation'
import { voiceModeAvailable } from './voicemode'
import { fmtDuration } from './util'
import { ActualLog } from './plan'
import * as Icon from './icons'
import { Speak, dayRank, useAssistantThread, useVoiceGlue, VoicePanel, type Done } from './assistantcore'
import type { JarvisCore, Job, Shape } from './jarviscore'
import { speakingLevel, stop as stopSpeech } from './speech'
import { voiceLevel } from './voicemode'
import { TITLES } from './assistantpage/shared'
import { Canvas, CardBody } from './assistantpage/cards'
import { Activity, Dictate, JvFrame } from './assistantpage/frame'

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

/** The follow-ups he might ask: one row, however long they are. They scroll
 *  sideways, the edge fades while there is more to reach, and the mouse wheel
 *  scrolls the row (a plain wheel only moves a page up and down, so a chip off
 *  the edge was out of reach with a mouse). */
function Chips({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = row.current
    if (!el) return
    const more = () => el.setAttribute('data-more', String(el.scrollLeft + el.clientWidth < el.scrollWidth - 2))
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    more()
    el.addEventListener('scroll', more, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(more)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', more); el.removeEventListener('wheel', wheel); ro.disconnect() }
  }, [items])
  return (
    <div className="as-next" ref={row} data-more="false">
      {items.map((n, k) => <button className="as-chip" key={k} onClick={() => onPick(n)}>{n}</button>)}
    </div>
  )
}


/* ---------- the Jarvis room (his ask, 2026-10-04) ----------
   Direction D of the board he picked: the helmet HUD frame, a strip of real
   readouts, the day on the left, the cards of what changed on the right, and
   JARVIS's core centre stage over the conversation. The page wears the
   Jarvis-mode theme whether or not the mode is on (App.tsx), the same way the
   Zone is a room of its own. */

/** Which shape the core takes for each card a change landed on. */
const SHAPE_OF: Partial<Record<CardKind, Shape>> = {
  today: 'tasks', backlog: 'tasks', stale: 'tasks', planned: 'calendar', calendar: 'calendar',
  bills: 'bills', gym: 'gym', ideas: 'idea', people: 'person', projects: 'building',
  notes: 'note', prompts: 'note', habits: 'habit', routines: 'habit', goals: 'focus', focus: 'focus', business: 'prospect',
}
/** One shape per run of changes that landed in the same place, in the order
 *  they happened, each carrying its own callouts: the card's name, then each
 *  row he can recognise ("ADDED  Call Petr"). Only what really changed. */
function jobsFor(done: Done[]): Job[] {
  const jobs: Job[] = []
  for (const d of done) {
    const card = d.ok && !d.undone ? d.at?.card : undefined
    const shape = card ? (d.at?.shape ?? SHAPE_OF[card]) : undefined
    if (!card || !shape) continue
    const colon = d.text.indexOf(': ')
    const verb = (colon > 0 ? d.text.slice(0, colon) : d.text).split(' ')[0]
    const value = colon > 0 ? d.text.slice(colon + 2) : undefined
    const last = jobs[jobs.length - 1]
    if (last?.shape === shape) { last.callouts.push({ label: verb, value }); continue }
    jobs.push({ shape, callouts: [{ label: d.at?.shape === 'prospect' ? 'Business' : TITLES[card] }, { label: verb, value }] })
  }
  return jobs
}
/* The film's line, answered by the app itself: no model, no network. */
const LOVE_YOU_3000 = /love\s*you\s*3\s*0\s*0\s*0/i
/** Minutes since midnight, refreshed every minute: the left gauge counts
 *  down the day as it goes. */
function useMinuteOfDay(): number {
  const read = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
  const [m, setM] = useState(read)
  useEffect(() => { const id = setInterval(() => setM(read()), 60000); return () => clearInterval(id) }, [])
  return m
}
const FOCUS_SCALE_H = 8

export function AssistantPage() {
  const split = useSplit()
  const { logActual } = useStore()
  const { brief, turns, setTurns, busy, err, errHint, canvas, setCanvas, touched, setTouched, live, send: sendRaw } = useAssistantThread()
  const [q, setQ] = useState('')
  const foot = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  /* The hook's own send() knows nothing about this page's textarea -- moving
     focus back to it is this component's business, not the thread's, so it
     wraps every call site here instead of living inside the shared hook. */
  const send = (text: string, shown?: string) => sendRaw(text, shown).then((r) => { box.current?.focus(); return r })
  /* Which answer's changes the right panel shows: the latest one that changed
     anything, unless he pointed at an older one from the thread. */
  const [actTurn, setActTurn] = useState<number | null>(null)
  const lastDone = (() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].done?.length) return i; return -1 })()
  const lastIt = (() => { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].who === 'it') return i; return -1 })()
  useEffect(() => { setActTurn(null) }, [turns.length])
  /* Only while that answer is the current one: a focus card opened two answers
     later must not carry "10 changes applied" from the day before it. He can
     still bring an older answer's changes back from its line in the chat. */
  const actIdx = actTurn ?? (lastDone === lastIt ? lastDone : -1)

  /* ---- the core ---- */
  const gl = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const core = useRef<JarvisCore | null>(null)
  useEffect(() => {
    let dead = false
    /* Dynamic, so three.js is its own chunk: the words and the cards are on
       screen before the core has even downloaded. */
    void import('./jarviscore').then(({ JarvisCore: Core }) => {
      if (dead || !gl.current || !overlay.current || !stage.current) return
      try {
        core.current = new Core(gl.current, overlay.current, stage.current, { speak: speakingLevel, listen: voiceLevel })
      } catch { /* no WebGL here: the room works without its core */ }
    })
    return () => { dead = true; core.current?.dispose(); core.current = null }
  }, [])
  useEffect(() => { core.current?.setThinking(busy) }, [busy])
  /* The left column already shows the day, so the right opens on the list. */
  useEffect(() => { if (!turns.length) setCanvas(['backlog']) }, [])
  /* Each new answer plays what it actually did. */
  const played = useRef(0)
  useEffect(() => {
    if (turns.length <= played.current) { played.current = turns.length; return }
    const fresh = turns.slice(played.current)
    played.current = turns.length
    const last = [...fresh].reverse().find((t) => t.who === 'it')
    if (last && !last.egg) core.current?.play(jobsFor(last.done ?? []))
  }, [turns])

  /* Answers the "how long did it take?" prompt under a 'done' line. "Skip"
   *  here is HIS word for it, from asking for this feature: it means the same
   *  time as the estimate, not the task-list page's own "skip", which leaves
   *  no time logged at all and asks again later. */
  const logTaskActual = (turnIndex: number, doneIndex: number, taskId: string, minutes: number) => {
    logActual(taskId, minutes)
    setTurns((prev) => prev.map((t, ti) => (ti !== turnIndex
      ? t
      : { ...t, done: t.done?.map((d, di) => (di !== doneIndex ? d : { ...d, text: `${d.text}, ${fmtDuration(minutes)}`, needsActual: undefined })) }
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

  /* Only once there is a conversation to follow: on an empty page this
     scrolled a phone straight past the core to the box. */
  useEffect(() => { if (turns.length || busy) foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])
  /* Instant while it writes. Smooth-scrolling on every token makes each new
     word fight the last one's animation and the column shivers. */
  useEffect(() => { if (live) foot.current?.scrollIntoView({ block: 'end' }) }, [live])
  /* The caret is in the box when the page opens, where there is a keyboard
     to type with. On a phone, focusing would raise the keyboard and scroll
     the core away before he has seen it. */
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) box.current?.focus({ preventScroll: true }) }, [])
  /* Walking off the page stops the voice. */
  useEffect(() => stopSpeech, [])

  const empty = turns.length === 0 && !busy && !err
  /* cancel, not stop: the question has been asked, so the tail of it is not
     wanted back in the box that is about to be cleared. */
  const submit = () => {
    const t = q.trim()
    if (!t) return
    cancelDictation(); setQ('')
    if (LOVE_YOU_3000.test(t)) {
      setTurns((prev) => [...prev, { who: 'you', text: t }, { who: 'it', text: 'Love you 3000, sir.', egg: true }])
      core.current?.easterEgg()
      return
    }
    void send(t)
  }
  const type = (v: string) => { setQ(v); core.current?.type(v) }

  const { voice, startVoice, runSkill, endVoice } = useVoiceGlue(
    send,
    () => { cancelDictation(); setQ('') },
    () => box.current?.focus(),
  )

  /* ---- the readouts: every number is his own, read from the brief ---- */
  const dayItems = brief.planned.flatMap((s) => s.items)
  const dayDone = dayItems.filter((i) => i.done).length
  const nextMeeting = brief.meetings.find((m) => m.at >= brief.now)
  const bills = brief.bills
  const unpaid = bills && bills !== 'loading' ? bills.due - bills.paid : null
  /* The bottom corners sit as far off the screen's edge as the top corners
     sit under the header's buttons. Measured, because the header's height
     moves with the window width; written to the shell, which pads main. */
  const room = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.shell')
    const fit = () => {
      const page = room.current, btns = document.querySelectorAll('.topstick .btn-sq')
      if (!page || !shell || !btns.length) return
      const under = Math.max(...[...btns].map((b) => b.getBoundingClientRect().bottom))
      const r = page.getBoundingClientRect()
      const want = r.top - under, have = innerHeight - r.bottom
      const pad = parseFloat(getComputedStyle(page.parentElement as HTMLElement).paddingBottom) || 0
      /* Correct against what is actually there, not what padding alone would
         predict: the shell adds a few pixels of its own under main. */
      const next = Math.max(0, Math.round(pad + want - have))
      if (Math.abs(next - pad) >= 1) shell.style.setProperty('--jv-gap', `${next}px`)
    }
    fit()
    /* Again while the header settles: its buttons move a few pixels as the
       fonts and the theme land, without the header changing size, so no
       observer would notice. */
    const timers = [300, 1000, 2500].map((t) => setTimeout(fit, t))
    const ro = new ResizeObserver(fit)
    const top = document.querySelector('.topstick')
    if (top) ro.observe(top)
    if (room.current) ro.observe(room.current)
    addEventListener('resize', fit)
    return () => { timers.forEach(clearTimeout); ro.disconnect(); removeEventListener('resize', fit); shell?.style.removeProperty('--jv-gap') }
  }, [])
  /* Left gauge: the share of today, midnight to midnight, still to come. */
  const dayLeft = 1 - useMinuteOfDay() / 1440
  const state = busy ? 'THINKING' : voice ? 'LISTENING' : q ? 'LISTENING' : 'STANDING BY'

  const askBox = voice ? <VoicePanel onExit={endVoice} /> : (
    <form className="as-ask jv-ask" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <textarea
        ref={box}
        className="as-input"
        value={q}
        rows={1}
        placeholder="Speak or type to JARVIS"
        aria-label="Ask JARVIS"
        onChange={(e) => type(e.target.value)}
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
        <Dictate base={q} onText={type} busy={busy} />
        <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Send</button>
      </div>
    </form>
  )

  return (
    <div className="page as-page jv" ref={room}>
      <canvas ref={gl} className="jv-gl" aria-hidden="true" />
      {/* The brackets and gauges are drawn to THIS wrapper's own size, not the
         full-bleed page (his report, 2026-10-05: a wide monitor stretched the
         page full width while the grid stayed capped, so the frame sat far
         out past the actual content). Matching the grid's own max-width here
         keeps the corners and the gauge tracks on the content's real edge. */}
      <div className="jv-body">
        <JvFrame
          left={{ fill: dayLeft, ticks: 24, longEvery: 6, label: `DAY LEFT ${Math.round(dayLeft * 100)}%` }}
          right={{ fill: brief.focusToday / (FOCUS_SCALE_H * 60), ticks: FOCUS_SCALE_H * 4, longEvery: 4, label: `FOCUS ${brief.focusToday ? fmtDuration(brief.focusToday).toUpperCase() : '0M'}` }}
        />
        <div className="jv-strip" role="group" aria-label="Today at a glance">
          <div><span className="k">ON THE DAY</span><span className="v">{dayDone} / {dayItems.length}</span></div>
          <div><span className="k">NEXT MEETING</span><span className="v">{nextMeeting ? nextMeeting.at : 'None'}</span></div>
          <div><span className="k">HABITS</span><span className="v">{brief.habits.kept} / {brief.habits.due}</span></div>
          <div>
            <span className="k">BILLS</span>
            <span className={`v${unpaid ? ' is-alert' : ''}`}>{bills === 'loading' ? 'Loading' : unpaid === null ? 'Signed out' : unpaid ? `${unpaid} unpaid` : 'All paid'}</span>
          </div>
          <div><span className="k">FOCUS TODAY</span><span className="v">{brief.focusToday ? fmtDuration(brief.focusToday) : '0m'}</span></div>
        </div>

        <div className="jv-grid">
        {split && (
          <aside className="jv-left" aria-label="On the day">
            <h2>ON THE DAY</h2>
            {dayItems.length ? brief.planned.filter((s) => s.items.length).map((s) => (
              <div className="jv-slot" key={s.slot}>
                <span className="jv-slot-name">{s.slot.toUpperCase()}</span>
                {s.items.map((it, k) => <span className={`jv-slot-item${it.done ? ' is-done' : ''}`} key={k}>{it.title}</span>)}
              </div>
            )) : <p className="jv-quiet">Nothing on the day yet.</p>}
          </aside>
        )}

        <section className="as-chat jv-center">
          {/* The core is the room's first thing and, once he is talking, its
              smallest: it steps aside to the head of the column next to the name,
              so the conversation gets the height (his report, 2026-11-07: "not even
              a sentence from him"). */}
          <div className={`jv-head${empty ? '' : ' is-talking'}`}>
            <div className={`jv-stage${empty ? '' : ' is-talking'}`} ref={stage} aria-label="JARVIS. Drag to look around." />
            <div className="jv-presence"><span className="jv-name">JARVIS</span><span className="jv-state" role="status">{state}</span></div>
          </div>
          <div className="as-thread jv-thread">
            {empty && (
              <div className="as-skills jv-skills">
                <button className="as-brief" onClick={() => void runSkill(MORNING)}>
                  <Icon.Waveform size={16} />
                  {MORNING.label}
                </button>
                {SKILLS.map((k) => (
                  <button className="as-brief" key={k.label} onClick={() => void runSkill(k)}>
                    <Icon.Waveform size={16} />
                    {k.label}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div className={`as-turn is-${t.who}`} key={i}>
                <p className="as-said">{t.text}</p>
                {/* The app's own account of what changed, not the model's. */}
                {t.done?.length && split ? (
                  <button className={`as-act-ref${actIdx === i ? ' is-here' : ''}`} onClick={() => setActTurn(i)}>
                    {t.done.length} {t.done.length === 1 ? 'change' : 'changes'}{t.done.some((d) => !d.ok) ? `, ${t.done.filter((d) => !d.ok).length} did not apply` : ''}, shown on the right
                  </button>
                ) : null}
                {t.done?.length && !split ? (
                  <>
                    <ul className="as-did">
                      {t.done.map((d, k) => (
                        <li className={`${d.ok ? 'is-ok' : 'is-no'}${d.undone ? ' is-undone' : ''}`} key={k}>
                          {d.ok ? null : <span className="as-did-head">Nothing changed, </span>}
                          {d.text}
                          {d.undone ? <span className="as-did-undone">, reverted</span> : null}
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
                    {t.done.filter((d) => d.undo && !d.undone).length > 1 ? (
                      <div className="as-did-batch">
                        <span>{t.done.filter((d) => d.undo && !d.undone).length} changes applied</span>
                        <button className="btn btn-quiet as-did-undoall" onClick={() => undoAll(i)}>Undo all</button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {t.who === 'it' && (t.text.trim() || (split && t.reply?.show.length)) ? (
                  <div className="as-pulled">
                    {t.text.trim() ? <Speak id={`t${i}`} text={t.text} /> : null}
                    {split && t.reply?.show.length
                      ? t.reply.show.map((c, k) => (
                          <button className="as-pulled-btn" key={k} onClick={() => { setCanvas([c.kind]); setTouched(t.touched ?? []) }}>
                            {TITLES[c.kind]}
                          </button>
                        ))
                      : null}
                  </div>
                ) : null}
                {t.reply?.show.length && !split ? (
                  [...t.reply.show].sort((a, b) => dayRank(a.kind) - dayRank(b.kind)).map((c, k) => (
                    <section className="as-card" key={k}>
                      <h3 className="microcap">{TITLES[c.kind]}</h3>
                      <CardBody kind={c.kind} limit={6} touched={t.touched} />
                    </section>
                  ))
                ) : null}
                {t.reply?.next && t.reply.next.length > 0 && i === turns.length - 1 && (
                  <Chips items={t.reply.next} onPick={(n) => void send(n)} />
                )}
              </div>
            ))}
            {busy && live ? (
              <div className="as-turn is-it">
                <p className="as-said is-live" role="status">{live}<span className="as-caret" aria-hidden="true" /></p>
              </div>
            ) : null}
            {err && (
              <div className="as-error">
                <p>{err}</p>
                {errHint && <p className="as-error-hint">{errHint}</p>}
              </div>
            )}
            <div ref={foot} />
          </div>
          {askBox}
        </section>

        {split && (
          <Canvas
            kinds={canvas}
            touched={touched}
            onAsk={(text) => void send(text)}
            top={actIdx >= 0 && turns[actIdx]?.done?.length ? (
              <Activity
                key={actIdx}
                done={turns[actIdx].done!}
                onUndo={(k) => undoOne(actIdx, k)}
                onUndoAll={() => undoAll(actIdx)}
                onLog={(k, taskId, m) => logTaskActual(actIdx, k, taskId, m)}
              />
            ) : null}
          />
        )}
        </div>
      </div>
      <div ref={overlay} className="jv-overlay" aria-hidden="true" />
    </div>
  )
}
