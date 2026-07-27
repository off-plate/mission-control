import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/* A global Pomodoro that lives above the whole app: a bottom-right badge you
   see on every tab, a corner ambient glow that shows the state at a glance,
   a browser-tab countdown, and a notification when a phase ends. */

type Phase = 'idle' | 'focus' | 'break'

interface Pomo {
  phase: Phase
  running: boolean
  secondsLeft: number
  focusMin: number
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
  focusMin: number; breakMin: number; cyclesDone: number; cyclesDay: string
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
  const saved = useState(loadPomo)[0]
  const [focusMin, setFocusMin] = useState(saved.focusMin ?? 25)
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
      localStorage.setItem(PK, JSON.stringify({ focusMin, breakMin, cyclesDone, cyclesDay: today(), phase, endsAt, pausedLeft, focusLabel }))
    } catch { /* noop */ }
  }, [focusMin, breakMin, cyclesDone, phase, endsAt, pausedLeft, focusLabel])

  // Re-render twice a second while running; the clock itself comes from the deadline.
  useEffect(() => {
    if (!running || phase === 'idle') return
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    const onShow = () => tick((n) => n + 1)
    document.addEventListener('visibilitychange', onShow)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onShow) }
  }, [running, phase])

  // phase transitions at zero
  useEffect(() => {
    if (phase === 'idle' || !running || secondsLeft > 0) return
    if (phase === 'focus') {
      setCyclesDone((c) => c + 1)
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
    setFocusLabel(label ?? null)
    setPhase('focus'); setEndsAt(Date.now() + mins * 60 * 1000); setPausedLeft(null)
  }
  const toggle = () => {
    if (phase === 'idle') { startFocus(); return }
    if (running) { setPausedLeft(secondsLeft); setEndsAt(null) }        // pause: freeze what is left
    else { setEndsAt(Date.now() + (pausedLeft ?? 0) * 1000); setPausedLeft(null) } // resume from there
  }
  const skip = () => {
    if (phase === 'focus') { setPhase('break'); setEndsAt(Date.now() + breakMin * 60 * 1000); setPausedLeft(null) }
    else { setPhase('idle'); setEndsAt(null); setPausedLeft(null) }
  }
  const stop = () => { setPhase('idle'); setEndsAt(null); setPausedLeft(null); setFocusLabel(null) }

  const value: Pomo = { phase, running, secondsLeft, focusMin, breakMin, cyclesDone, focusLabel, startFocus, toggle, skip, stop, setFocusMin, setBreakMin }
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
