/* Reminders actually remind (his ask, 2026-11-07: "inspired by Apple reminders").
   While Mission Control is open, a reminder whose time has just come shows a
   system notification, once. Kept tiny and out of the lazy page so it runs on
   every page. The browser only shows these after he allows notifications, from
   the Reminders page's own button. */
import { useEffect } from 'react'
import type { Reminder } from './types'
import { fromLocalStamp } from './store/reminders'

const SEEN = 'mc-rem-notified'
/* A reminder that came due while the app was closed still shows if it is this fresh. */
const FRESH_MS = 15 * 60 * 1000

function seen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<string, number> } catch { return {} }
}

export function alertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function useReminderAlerts(reminders: Reminder[]): void {
  useEffect(() => {
    if (!alertsSupported()) return
    const check = () => {
      if (Notification.permission !== 'granted') return
      const now = Date.now(), done = seen()
      let changed = false
      for (const r of reminders) {
        if (r.doneAt || !r.remindAt) continue
        const key = `${r.id}|${r.remindAt}`
        if (done[key]) continue
        const at = fromLocalStamp(r.remindAt).getTime()
        if (at > now) continue
        done[key] = now; changed = true
        if (now - at > FRESH_MS) continue
        try { new Notification(r.title, { body: r.notes || 'Reminder', tag: key }) } catch { /* some browsers only allow it from a service worker */ }
      }
      if (changed) {
        /* Forget anything older than a week so the record never grows without end. */
        for (const k of Object.keys(done)) if (now - done[k] > 7 * 864e5) delete done[k]
        try { localStorage.setItem(SEEN, JSON.stringify(done)) } catch { /* storage full or blocked */ }
      }
    }
    check()
    const id = window.setInterval(check, 20000)
    return () => window.clearInterval(id)
  }, [reminders])
}
