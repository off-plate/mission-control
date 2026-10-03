/* THE FIVE-HOUR WINDOW, split from the Prompts page so the header can show its
   dot without loading the page. The time he said he hit the limit is kept on
   this device only (localStorage), and every mount of the hook reads it. */
import { useEffect, useState } from 'react'

const HIT_KEY = 'mc-prompt-hit'
const NOTIFIED_KEY = 'mc-prompt-notified'
export const WINDOW_MS = 5 * 3600e3
const EVT = 'mc-prompt-window'
const CLAUDE_KEY = 'mc-claude-window'
const CLAUDE_EVT = 'mc-claude-window'
const FRESH_MS = 15 * 60e3

const readHit = (): number | null => {
  try { const n = Number(localStorage.getItem(HIT_KEY)); return Number.isFinite(n) && n > 0 ? n : null } catch { return null }
}

/** What Tokenly (the Chrome extension) last read from Claude: how much of the
 *  five-hour window is used and when it resets. Absent when the extension is not
 *  installed, was not heard from for 15 minutes, or there is no live window. */
export interface ClaudeWindow { utilization: number; resetsAt: number | null; fetchedAt: number }
const readClaude = (): ClaudeWindow | null => {
  try {
    const raw = localStorage.getItem(CLAUDE_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as { utilization?: number; resetsAt?: string | null; fetchedAt?: number }
    if (typeof j.utilization !== 'number' || typeof j.fetchedAt !== 'number' || Date.now() - j.fetchedAt > FRESH_MS) return null
    const at = j.resetsAt ? Date.parse(j.resetsAt) : NaN
    return { utilization: j.utilization, resetsAt: Number.isFinite(at) ? at : null, fetchedAt: j.fetchedAt }
  } catch { return null }
}

export type WindowState = 'ready' | 'hit' | 'open'

/** The five-hour window, from the moment he said he hit the limit. Every mount
 *  of this hook (the page, the header dot) reads the same stored time. */
export function usePromptWindow(waiting: number) {
  const [hitAt, setHit] = useState<number | null>(readHit)
  const [now, setNow] = useState(Date.now())
  const [claude, setClaude] = useState<ClaudeWindow | null>(readClaude)
  useEffect(() => {
    const sync = () => { setHit(readHit()); setClaude(readClaude()) }
    window.addEventListener(EVT, sync)
    window.addEventListener(CLAUDE_EVT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener(CLAUDE_EVT, sync); window.removeEventListener('storage', sync) }
  }, [])
  useEffect(() => {
    if (!hitAt) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [hitAt])
  const leftMs = hitAt ? hitAt + WINDOW_MS - now : null
  const state: WindowState = leftMs === null ? 'ready' : leftMs > 0 ? 'hit' : 'open'

  /* Once per window, and only if something is waiting. The check-and-set is
     synchronous, so two mounts cannot both fire it. */
  useEffect(() => {
    if (state !== 'open' || !hitAt || waiting === 0) return
    try {
      if (localStorage.getItem(NOTIFIED_KEY) === String(hitAt)) return
      localStorage.setItem(NOTIFIED_KEY, String(hitAt))
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Claude is open again', { body: `${waiting} prompt${waiting === 1 ? '' : 's'} waiting in Mission Control.` })
      }
    } catch { /* a notification is a nicety */ }
  }, [state, hitAt, waiting])

  const set = (v: number | null) => {
    try { if (v === null) localStorage.removeItem(HIT_KEY); else localStorage.setItem(HIT_KEY, String(v)) } catch { /* private mode */ }
    setHit(v)
    window.dispatchEvent(new Event(EVT))
  }
  /* Tapping is still his confirmation that he is out. What changes is the end
     of the timer: with Tokenly's reading it is the real reset time, not five
     hours from the tap. */
  const hit = () => {
    const exact = claude?.resetsAt && claude.resetsAt > Date.now() ? claude.resetsAt : null
    set(exact ? exact - WINDOW_MS : Date.now())
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
  }
  return { state, leftMs, hitAt, claude, hit, clear: () => set(null) }
}

