import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { fmtDuration, taskMinutes } from './util'
import { thumbUrl, useMundiOpus } from './mundiplayer'
import { MUNDI_OPUS_QUEUE } from './mundiopus'
import { isDesktop, notify as nativeNotify } from './desktop'
import * as Icon from './icons'

/* A global Pomodoro that lives above the whole app: a bottom-right badge you
   see on every tab, a corner ambient glow that shows the state at a glance,
   a browser-tab countdown, and a notification when a phase ends. */

/* 'await' sits between focus and break: the block is finished and logged, and
   nothing further happens until he says so. A break that starts itself decides
   for him that the next thing is rest, and he asked it to stop deciding. */
type Phase = 'idle' | 'focus' | 'break' | 'await'

interface Pomo {
  phase: Phase
  running: boolean
  secondsLeft: number
  focusMin: number
  /** How long the block currently running was started for. NOT the setting: a
   *  block started from a task runs for that task's estimate, and reading the
   *  setting instead reported the wrong length and a negative elapsed time. */
  blockMin: number
  breakMin: number
  cyclesDone: number
  startFocus: (minutes?: number, label?: string) => void
  /** What this focus block is for, when it was started from a task. */
  focusLabel: string | null
  toggle: () => void
  skip: () => void
  stop: () => void
  /** Approve the break the finished block earned. */
  startBreak: () => void
  /** Keep going instead: a fresh block under the same name. */
  extend: (min: number) => void
  /** Neither: close the popup and stand down. */
  dismiss: () => void
  setFocusMin: (n: number) => void
  setBreakMin: (n: number) => void
}

const Ctx = createContext<Pomo | null>(null)
export function usePomodoro(): Pomo {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePomodoro outside provider')
  return c
}

/* An audible end, generated on the spot: no file, nothing fetched, works under
   the strictest CSP. Browsers only allow audio after a user gesture, and a
   session always starts with one (starting the timer), so by the time a block
   ends the context is unlockable. */
let audioCtx: AudioContext | null = null
function chime() {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime
    for (const [freq, at, dur] of [[660, 0, 0.18], [880, 0.22, 0.34]] as const) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      o.connect(g).connect(ctx.destination)
      o.start(t0 + at); o.stop(t0 + at + dur + 0.05)
    }
  } catch { /* no audio device; the popup still says it */ }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

/* State that must survive a reload: your timer settings, today's cycle count,
   and any running phase (kept as a wall-clock deadline, not a countdown). */
const PK = 'mc-pomodoro'
interface Saved {
  focusMin: number; blockMin: number; breakMin: number; cyclesDone: number; cyclesDay: string
  phase: Phase; endsAt: number | null; pausedLeft: number | null; focusLabel: string | null
  /** When the running block began, so a block crossing midnight can hand each
   *  day the minutes that were actually worked on it. */
  startedAt: number | null
}
const today = () => new Date().toDateString()
function loadPomo(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(PK)
    if (!raw) return {}
    const s = JSON.parse(raw) as Saved
    // The cycle count is a "today" number; a new day starts at zero.
    return s.cyclesDay === today() ? s : { ...s, cyclesDone: 0 }
  } catch { return {} }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { logFocus, logFocusOn, syncAutoHabits, tasks } = useStore()
  const saved = useState(loadPomo)[0]
  const [focusMin, setFocusMin] = useState(saved.focusMin ?? 25)
  /* A block saved by an older version has no blockMin. Falling back to the
     SETTING declared his running 45 minute block to be 25 and elapsed went
     negative. The truth is recoverable: a block started from a task carries the
     task's title, and the task still knows its own estimate. Only when nothing
     matches does the remaining time set the floor, which can undercount the
     elapsed part but can never call it negative. */
  const [blockMin, setBlockMin] = useState(() => {
    if (saved.blockMin) return saved.blockMin
    if (saved.phase === 'focus' && saved.focusLabel) {
      const want = saved.focusLabel.trim().toLowerCase()
      /* Case-blind, and DONE tasks count too: by the time this runs he may have
         finished or renamed the thing the block was started from. */
      const t = tasks.find((x) => x.title.trim().toLowerCase() === want)
      if (t) return taskMinutes(t)
      const st = tasks.flatMap((x) => x.subtasks ?? []).find((x) => x.title.trim().toLowerCase() === want)
      if (st) return st.estimateMin
    }
    if (saved.phase === 'focus' && saved.endsAt) {
      return Math.max(saved.focusMin ?? 25, Math.ceil((saved.endsAt - Date.now()) / 60000))
    }
    return saved.focusMin ?? 25
  })
  const [breakMin, setBreakMin] = useState(saved.breakMin ?? 5)
  const [phase, setPhase] = useState<Phase>(saved.phase ?? 'idle')
  // A phase is stored as the moment it ends, so a backgrounded or reloaded tab
  // still shows the true remaining time instead of drifting behind.
  const [endsAt, setEndsAt] = useState<number | null>(saved.endsAt ?? null)
  const [pausedLeft, setPausedLeft] = useState<number | null>(saved.pausedLeft ?? null)
  const [cyclesDone, setCyclesDone] = useState(saved.cyclesDone ?? 0)
  const [focusLabel, setFocusLabel] = useState<string | null>(saved.focusLabel ?? null)
  /* A block saved without a start recovers it from its own arithmetic. */
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    if (saved.startedAt) return saved.startedAt
    if (saved.phase === 'focus' && saved.endsAt) return saved.endsAt - (saved.blockMin ?? saved.focusMin ?? 25) * 60000
    return null
  })
  const [, tick] = useState(0)

  const running = endsAt !== null
  const secondsLeft = endsAt !== null
    ? Math.max(0, Math.round((endsAt - Date.now()) / 1000))
    : pausedLeft ?? 0

  /* On the desktop this goes through macOS, which means the end of a block still
     announces itself when the window is closed or behind something. In a browser
     tab it stays the web notification, which only fires while the tab lives. */
  const notify = (title: string, body: string) => {
    if (isDesktop()) { void nativeNotify(title, body); return }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'mc-pomodoro' }) } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(PK, JSON.stringify({ focusMin, blockMin, breakMin, cyclesDone, cyclesDay: today(), phase, endsAt, pausedLeft, focusLabel, startedAt }))
    } catch { /* noop */ }
  }, [focusMin, blockMin, breakMin, cyclesDone, phase, endsAt, pausedLeft, focusLabel, startedAt])

  // Re-render twice a second while running; the clock itself comes from the deadline.
  useEffect(() => {
    if (!running || phase === 'idle') return
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    const onShow = () => tick((n) => n + 1)
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [running, phase])

  /* A block that crosses midnight hands yesterday its share the moment the day
     flips: the pre-midnight minutes are logged onto yesterday as their own
     finished block, and what remains keeps running as today's. Every counter
     downstream then reads the right day without knowing this ever happened. */
  useEffect(() => {
    if (phase !== 'focus' || startedAt === null) return
    const startDay = new Date(startedAt)
    const now = new Date()
    if (startDay.getFullYear() === now.getFullYear() && startDay.getMonth() === now.getMonth() && startDay.getDate() === now.getDate()) return
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const before = Math.min(blockMin - 1, Math.max(1, Math.round((midnight.getTime() - startedAt) / 60000)))
    const day = `${startDay.getFullYear()}-${String(startDay.getMonth() + 1).padStart(2, '0')}-${String(startDay.getDate()).padStart(2, '0')}`
    logFocusOn(day, before, focusLabel ?? undefined, new Date(midnight.getTime() - 1000).toISOString())
    setBlockMin((b) => Math.max(1, b - before))
    setStartedAt(midnight.getTime())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, startedAt, secondsLeft])

  /* An hour that is still running is still an hour. A habit kept by focus time
     would otherwise wait for the block to finish before admitting it, so the
     minutes on the clock are offered up as they accumulate. */
  const elapsedMin = phase === 'focus' && running ? Math.max(0, Math.floor((blockMin * 60 - secondsLeft) / 60)) : 0
  useEffect(() => {
    if (elapsedMin > 0) syncAutoHabits(elapsedMin, focusLabel ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMin])

  // phase transitions at zero
  useEffect(() => {
    if (phase === 'idle' || !running || secondsLeft > 0) return
    if (phase === 'focus') {
      setCyclesDone((c) => c + 1)
      // The block is only counted once it is actually finished.
      logFocus(blockMin, focusLabel ?? undefined)
      chime()
      notify('Focus done', 'Your call: break, or keep going.')
      /* The block is banked; what happens next is his. */
      setPhase('await')
      setEndsAt(null)
      setPausedLeft(null)
    } else if (phase === 'break') {
      chime()
      notify('Break over', 'Back to it when you are ready.')
      setPhase('idle')
      setEndsAt(null)
      setPausedLeft(null)
      setFocusLabel(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, phase, running, breakMin])

  // browser-tab countdown
  useEffect(() => {
    if (phase === 'idle') { document.title = 'Mission Control'; return }
    document.title = `${mmss(secondsLeft)} ${phase === 'focus' ? '🍅' : '☕'} Mission Control`
    return () => { document.title = 'Mission Control' }
  }, [phase, secondsLeft])

  /* Started from a task, the block runs for that task's own estimate and carries
     its name, so the badge says what you are actually doing. */
  const startFocus = (minutes?: number, label?: string) => {
    /* The desktop app needs no permission prompt: macOS asks once, itself, the
       first time it actually posts one. */
    if (!isDesktop() && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    const mins = Math.max(1, Math.round(minutes ?? focusMin))
    setBlockMin(mins)
    setStartedAt(Date.now())
    setFocusLabel(label ?? null)
    setPhase('focus'); setEndsAt(Date.now() + mins * 60 * 1000); setPausedLeft(null)
  }
  const toggle = () => {
    if (phase === 'idle') { startFocus(); return }
    if (running) { setPausedLeft(secondsLeft); setEndsAt(null) }        // pause: freeze what is left
    else { setEndsAt(Date.now() + (pausedLeft ?? 0) * 1000); setPausedLeft(null) } // resume from there
  }
  /* Ending a focus block early still happened. The minutes were already counted
     live toward any focus-kept habit, so discarding them here would take back an
     hour he genuinely did; what was actually worked is logged as the block. */
  const bankPartial = () => {
    if (phase !== 'focus') return
    const done = Math.floor((blockMin * 60 - secondsLeft) / 60)
    if (done >= 1) logFocus(done, focusLabel ?? undefined)
  }
  const skip = () => {
    if (phase === 'focus') { bankPartial(); setPhase('break'); setEndsAt(Date.now() + breakMin * 60 * 1000); setPausedLeft(null) }
    else { setPhase('idle'); setEndsAt(null); setPausedLeft(null) }
  }
  const stop = () => { bankPartial(); setPhase('idle'); setEndsAt(null); setPausedLeft(null); setFocusLabel(null) }
  /* From the finished-focus popup: the break he approved. */
  const startBreak = () => { setPhase('break'); setEndsAt(Date.now() + breakMin * 60 * 1000); setPausedLeft(null) }
  /* Or more focus instead. A fresh block under the same name, logged on its own
     when IT finishes, so the extension is recorded as the extra work it is. */
  const extend = (min: number) => { setPhase('focus'); setBlockMin(min); setStartedAt(Date.now()); setEndsAt(Date.now() + min * 60 * 1000); setPausedLeft(null) }
  const dismiss = () => { setPhase('idle'); setEndsAt(null); setPausedLeft(null); setFocusLabel(null) }

  const value: Pomo = { phase, running, secondsLeft, focusMin, blockMin, breakMin, cyclesDone, focusLabel, startFocus, toggle, skip, stop, startBreak, extend, dismiss, setFocusMin, setBreakMin }
  return (
    <Ctx.Provider value={value}>
      {children}
      <PomodoroAmbient />
      {phase === 'await' && <FocusDoneModal />}
      <PomodoroDock />
    </Ctx.Provider>
  )
}

function PomodoroAmbient() {
  const { phase, running } = usePomodoro()
  if (phase === 'idle') return null
  const state = phase === 'await' ? 'await' : !running ? 'paused' : phase
  return <div className={`pomo-ambient ${state}`} aria-hidden="true" />
}

/* The end of a block is an event, not a transition: it stops, says so out loud,
   and waits. Nothing counts down while this is open. */
function FocusDoneModal() {
  const p = usePomodoro()
  return (
    <div className="pomo-done-veil" role="dialog" aria-modal="true" aria-label="Focus finished">
      <div className="pomo-done">
        {/* The event is the heading. It used to be an eyebrow over the task
            name, which is the one shape the house rules forbid outright. */}
        <h2>Focus finished</h2>
        <p>{p.focusLabel ? `${p.focusLabel}, ` : ''}{p.blockMin} minutes, banked. What now?</p>
        <div className="pomo-done-actions">
          <button className="btn btn-primary" onClick={p.startBreak}>Take the {p.breakMin}m break</button>
          <button className="btn btn-ghost" onClick={() => p.extend(10)}>10 more minutes</button>
          <button className="btn btn-ghost" onClick={p.dismiss}>Done for now</button>
        </div>
      </div>
    </div>
  )
}

function Stepper({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <div className="pomo-step">
      <span className="pomo-step-label">{label}</span>
      <button aria-label={`Less ${label}`} onClick={() => set(Math.max(min, value - 5))}>−</button>
      <span className="mono pomo-step-val">{value}m</span>
      <button aria-label={`More ${label}`} onClick={() => set(Math.min(max, value + 5))}>+</button>
    </div>
  )
}

/* The corner as a whole: the timer badge, and above it, Mundi Opus if he has
   actually touched it this session. "It should keep going and be an
   extension of the floating focus badge with media controls," his words
   after the music stopped dead the moment he left the Zone tile that used
   to own the only iframe. The player itself lives in mundiplayer.tsx now,
   so leaving the Zone no longer touches it; this is just where it surfaces
   when he is not looking at the big version. */
function PomodoroDock() {
  const { page } = useStore()
  /* The room already shows the timer and the player at full size. A second,
     smaller copy of the same facts in the corner is not a safety net, it is
     noise competing with the one thing the room exists to make dominant. */
  if (page === 'zone') return null
  return (
    <div className="pomo-dock">
      <MediaBadge />
      <PomodoroBadge />
    </div>
  )
}

function MediaBadge() {
  const mo = useMundiOpus()
  /* Nothing shows until he has actually pressed play once: a player he has
     never touched has nothing to say in a corner he looks at constantly. */
  if (!mo.started) return null
  const current = MUNDI_OPUS_QUEUE[mo.track]
  return (
    <div className="pomo-media">
      <img className="pomo-media-art" src={thumbUrl(current.id)} alt="" />
      <span className="pomo-media-title" title={current.title}>{current.title}</span>
      <button className="pomo-icon" onClick={() => mo.go(-1)} aria-label="Previous track">
        <Icon.SkipBack size={17} filled />
      </button>
      <button className="pomo-icon" onClick={mo.toggle} aria-label={mo.playing ? 'Pause' : 'Play'}>
        {mo.playing ? (
          <Icon.Pause size={17} filled />
        ) : (
          <Icon.Play size={17} filled />
        )}
      </button>
      <button className="pomo-icon" onClick={() => mo.go(1)} aria-label="Next track">
        <Icon.SkipNext size={17} filled />
      </button>
    </div>
  )
}

/* Focus left the menu, so this badge is now the only door to its page as well
   as the timer's controls. Everything it does is one press: start, pause, take
   the break, stop, and open the history. The glyph buttons it used to carry
   (❚❚ ▸ ⤼ ✕) were characters at whatever size the font felt like; these are
   drawn, and they hit a 30px target. */
function PomodoroBadge() {
  const p = usePomodoro()
  const { setPage, page, focusSessions } = useStore()
  const [setupOpen, setSetupOpen] = useState(false)

  const today = focusSessions
    .filter((f) => f.day === new Date().toLocaleDateString('en-CA'))
    .reduce((a, f) => a + f.minutes, 0)

  const open = (
    <button
      className={`pomo-icon${page === 'focus' ? ' is-on' : ''}`}
      onClick={() => setPage('focus')}
      aria-label="Open the focus history"
      title="Open Focus"
    >
      <Icon.BarChart size={17} />
    </button>
  )

  if (p.phase === 'idle') {
    return (
      <div className="pomo-badge idle">
        {setupOpen && (
          <div className="pomo-setup">
            <Stepper label="Focus" value={p.focusMin} set={p.setFocusMin} min={5} max={90} />
            <Stepper label="Break" value={p.breakMin} set={p.setBreakMin} min={5} max={30} />
          </div>
        )}
        <button className="pomo-start" onClick={() => p.startFocus()} aria-label={`Start a ${p.focusMin} minute focus`}>
          <ClockIcon /> Focus {p.focusMin}m
        </button>
        {/* Minutes, not blocks: he asked what today amounts to, and three
            blocks says nothing about whether they were ten minutes or fifty. */}
        {today > 0 && <span className="pomo-cycles mono" title="Focused today">{fmtDuration(today)} today</span>}
        <button className="pomo-icon" aria-label="Timer settings" aria-expanded={setupOpen} onClick={() => setSetupOpen((v) => !v)}>
          <Icon.Sliders size={17} />
        </button>
        {open}
      </div>
    )
  }

  const state = p.phase === 'await' ? 'await' : !p.running ? 'paused' : p.phase
  return (
    <div className={`pomo-badge active ${state}`}>
      <span className="pomo-phase" title={p.focusLabel ?? undefined}>
        {p.phase === 'focus' ? (p.focusLabel ?? (p.running ? 'Focus' : 'Paused')) : p.phase === 'await' ? 'Focus finished' : 'Break'}
      </span>
      <span className="pomo-clock mono">{p.phase === 'await' ? 'done' : mmss(p.secondsLeft)}</span>
      <button className="pomo-icon" onClick={p.toggle} aria-label={p.running ? 'Pause' : 'Resume'}>
        {p.running ? (
          <Icon.Pause size={17} filled />
        ) : (
          <Icon.Play size={17} filled />
        )}
      </button>
      <button className="pomo-icon" onClick={p.skip} aria-label={p.phase === 'focus' ? 'Skip to the break' : 'End the break'}>
        <Icon.SkipNext size={17} filled />
      </button>
      <button className="pomo-icon" onClick={p.stop} aria-label="Stop this block">
        <Icon.Close size={17} />
      </button>
      {open}
    </div>
  )
}

function ClockIcon() {
  return (
    <Icon.Clock size={17} />
  )
}
