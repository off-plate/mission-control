/* THE FIVE-HOUR WINDOW, split from the Prompts page so the header can show its
   dot without loading the page. The time he said he hit the limit is kept on
   this device only (localStorage), and every mount of the hook reads it. */
import { useEffect, useState } from 'react'

const HIT_KEY = 'mc-prompt-hit'
const NOTIFIED_KEY = 'mc-prompt-notified'
export const WINDOW_MS = 5 * 3600e3
const EVT = 'mc-prompt-window'

const readHit = (): number | null => {
  try { const n = Number(localStorage.getItem(HIT_KEY)); return Number.isFinite(n) && n > 0 ? n : null } catch { return null }
}

export type WindowState = 'ready' | 'hit' | 'open'

/** The five-hour window, from the moment he said he hit the limit. Every mount
 *  of this hook (the page, the header dot) reads the same stored time. */
export function usePromptWindow(waiting: number) {
  const [hitAt, setHit] = useState<number | null>(readHit)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const sync = () => setHit(readHit())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync) }
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
  const hit = () => {
    set(Date.now())
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission() } catch { /* ignore */ }
  }
  return { state, leftMs, hitAt, hit, clear: () => set(null) }
}

