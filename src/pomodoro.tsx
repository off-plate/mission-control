import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { taskMinutes } from './util'

/* A global Pomodoro that lives above the whole app: a bottom-right badge you
   see on every tab, a corner ambient glow that shows the state at a glance,
   a browser-tab countdown, and a notification when a phase ends. */

type Phase = 'idle' | 'focus' | 'break'

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
  setFocusMin: (n: number) => void
  setBreakMin: (n: number) => void
}

const Ctx = createContext<Pomo | null>(null)
export function usePomodoro(): Pomo {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePomodoro outside provider')
  return c
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

/* State that must survive a reload: your timer settings, today's cycle count,
   and any running phase (kept as a wall-clock deadline, not a countdown). */
const PK = 'mc-pomodoro'
interface Saved {
  focusMin: number; blockMin: number; breakMin: number; cyclesDone: number; cyclesDay: string
  phase: Phase; endsAt: number | null; pausedLeft: number | null; focusLabel: string | null
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
  const { logFocus, syncAutoHabits, tasks } = useStore()
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
      const t = tasks.find((x) => x.title === saved.focusLabel)
      if (t) return taskMinutes(t)
      const st = tasks.flatMap((x) => x.subtasks ?? []).find((x) => x.title === saved.focusLabel)
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
  const [, tick] = useState(0)

  const running = endsAt !== null
  const secondsLeft = endsAt !== null
    ? Math.max(0, Math.round((endsAt - Date.now()) / 1000))
    : pausedLeft ?? 0

  const notify = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'mc-pomodoro' }) } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(PK, JSON.stringify({ focusMin, blockMin, breakMin, cyclesDone, cyclesDay: today(), phase, endsAt, pausedLeft, focusLabel }))
    } catch { /* noop */ }
  }, [focusMin, blockMin, breakMin, cyclesDone, phase, endsAt, pausedLeft, focusLabel])

  // Re-render twice a second while running; the clock itself comes from the deadline.
  useEffect(() => {
    if (!running || phase === 'idle') return
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    const onShow = () => tick((n) => n + 1)
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [running, phase])

  /* An hour that is still running is still an hour. A habit kept by focus time
     would otherwise wait for the block to finish before admitting it, so the
     minutes on the clock are offered up as they accumulate. */
  const elapsedMin = phase === 'focus' && running ? Math.max(0, Math.floor((blockMin * 60 - secondsLeft) / 60)) : 0
  useEffect(() => {
    if (elapsedMin > 0) syncAutoHabits(elapsedMin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedMin])

  // phase transitions at zero
  useEffect(() => {
    if (phase === 'idle' || !running || secondsLeft > 0) return
    if (phase === 'focus') {
      setCyclesDone((c) => c + 1)
      // The block is only counted once it is actually finished.
      logFocus(blockMin, focusLabel ?? undefined)
      notify('Focus done', `Nice. ${breakMin} minute break.`)
      setPhase('break')
      setEndsAt(Date.now() + breakMin * 60 * 1000)
    } else {
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
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    const mins = Math.max(1, Math.round(minutes ?? focusMin))
    setBlockMin(mins)
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

  const value: Pomo = { phase, running, secondsLeft, focusMin, blockMin, breakMin, cyclesDone, focusLabel, startFocus, toggle, skip, stop, setFocusMin, setBreakMin }
  return (
    <Ctx.Provider value={value}>
      {children}
      <PomodoroAmbient />
      <PomodoroBadge />
    </Ctx.Provider>
  )
}

function PomodoroAmbient() {
  const { phase, running } = usePomodoro()
  if (phase === 'idle') return null
  const state = !running ? 'paused' : phase
  return <div className={`pomo-ambient ${state}`} aria-hidden="true" />
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

function PomodoroBadge() {
  const p = usePomodoro()
  const [setupOpen, setSetupOpen] = useState(false)

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
        {p.cyclesDone > 0 && <span className="pomo-cycles mono" title="Focus blocks finished today">{p.cyclesDone} today</span>}
        <button className="pomo-icon" aria-label="Timer settings" aria-expanded={setupOpen} onClick={() => setSetupOpen((v) => !v)}>⚙</button>
      </div>
    )
  }

  const state = !p.running ? 'paused' : p.phase
  return (
    <div className={`pomo-badge active ${state}`}>
      <span className="pomo-phase" title={p.focusLabel ?? undefined}>
        {p.phase === 'focus' ? (p.focusLabel ?? (p.running ? 'Focus' : 'Paused')) : 'Break'}
      </span>
      <span className="pomo-clock mono">{mmss(p.secondsLeft)}</span>
      <button className="pomo-icon" onClick={p.toggle} aria-label={p.running ? 'Pause' : 'Resume'}>{p.running ? '❚❚' : '▸'}</button>
      <button className="pomo-icon" onClick={p.skip} aria-label={p.phase === 'focus' ? 'Skip to break' : 'End break'}>⤼</button>
      <button className="pomo-icon" onClick={p.stop} aria-label="Stop">✕</button>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  )
}
