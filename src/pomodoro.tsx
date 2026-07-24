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
  startFocus: () => void
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

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [focusMin, setFocusMin] = useState(25)
  const [breakMin, setBreakMin] = useState(5)
  const [phase, setPhase] = useState<Phase>('idle')
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [cyclesDone, setCyclesDone] = useState(0)

  const notify = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'mc-pomodoro' }) } catch { /* ignore */ }
    }
  }

  // 1-second tick while running
  useEffect(() => {
    if (!running || phase === 'idle') return
    const id = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [running, phase])

  // phase transitions at zero
  useEffect(() => {
    if (phase === 'idle' || !running || secondsLeft > 0) return
    if (phase === 'focus') {
      setCyclesDone((c) => c + 1)
      notify('Focus done', `Nice. ${breakMin} minute break.`)
      setPhase('break')
      setSecondsLeft(breakMin * 60)
    } else {
      notify('Break over', 'Back to it when you are ready.')
      setPhase('idle')
      setRunning(false)
      setSecondsLeft(0)
    }
  }, [secondsLeft, phase, running, breakMin])

  // browser-tab countdown
  useEffect(() => {
    if (phase === 'idle') { document.title = 'Mission Control'; return }
    document.title = `${mmss(secondsLeft)} ${phase === 'focus' ? '🍅' : '☕'} Mission Control`
    return () => { document.title = 'Mission Control' }
  }, [phase, secondsLeft])

  const startFocus = () => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    setPhase('focus'); setSecondsLeft(focusMin * 60); setRunning(true)
  }
  const toggle = () => { if (phase === 'idle') startFocus(); else setRunning((r) => !r) }
  const skip = () => {
    if (phase === 'focus') { setPhase('break'); setSecondsLeft(breakMin * 60); setRunning(true) }
    else { setPhase('idle'); setRunning(false); setSecondsLeft(0) }
  }
  const stop = () => { setPhase('idle'); setRunning(false); setSecondsLeft(0) }

  const value: Pomo = { phase, running, secondsLeft, focusMin, breakMin, cyclesDone, startFocus, toggle, skip, stop, setFocusMin, setBreakMin }
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
        <button className="pomo-start" onClick={p.startFocus} aria-label={`Start a ${p.focusMin} minute focus`}>
          <ClockIcon /> Focus {p.focusMin}m
        </button>
        <button className="pomo-icon" aria-label="Timer settings" aria-expanded={setupOpen} onClick={() => setSetupOpen((v) => !v)}>⚙</button>
      </div>
    )
  }

  const state = !p.running ? 'paused' : p.phase
  return (
    <div className={`pomo-badge active ${state}`}>
      <span className="pomo-phase">{p.phase === 'focus' ? (p.running ? 'Focus' : 'Paused') : 'Break'}</span>
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
