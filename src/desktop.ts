/* The macOS app's extra reach.

   Every function here is a no-op in a browser tab. That is deliberate: the
   website and the desktop app run the SAME bundle, so the difference between
   them has to be a runtime check, never a second build. If `window.mc` is not
   there, this file does nothing and the page behaves exactly as it always did. */

import { useEffect } from 'react'

interface Bridge {
  desktop: true
  platform: string
  badge: (n: number) => Promise<boolean>
  notify: (title: string, body: string) => Promise<boolean>
  openAtLogin: { get: () => Promise<boolean>; set: (v: boolean) => Promise<boolean> }
}

function bridge(): Bridge | null {
  const w = window as unknown as { mc?: Bridge }
  return w.mc?.desktop ? w.mc : null
}

/* Mark the document once, so the stylesheet can make room for the traffic lights.
   Under titleBarStyle 'hiddenInset' the window buttons float OVER the page at the
   top left, which is exactly where the wordmark sits. Without this the two
   overlap. Runs on import; no-op in a browser tab. */
if (typeof document !== 'undefined' && bridge()) {
  document.documentElement.classList.add('is-desktop')
}

/** True inside the macOS app. Use it to offer something, never to hide something
 *  the web version needs. */
export const isDesktop = (): boolean => bridge() !== null

/** The dock badge counts what is actually asking for him right now, which is the
 *  same list Today shows as alerts. A badge that counts anything else is a lie
 *  he learns to ignore. */
export function useDockBadge(count: number): void {
  useEffect(() => {
    const b = bridge()
    if (!b) return
    void b.badge(count)
  }, [count])
}

/** A real macOS notification. Unlike the web one it survives the window being
 *  closed, which is the only reason to prefer it. Falls back to nothing rather
 *  than to a browser prompt: an unasked-for permission dialog is worse than no
 *  notification. */
export async function notify(title: string, body: string): Promise<boolean> {
  const b = bridge()
  if (!b) return false
  try { return await b.notify(title, body) } catch { return false }
}

export async function getOpenAtLogin(): Promise<boolean | null> {
  const b = bridge()
  if (!b) return null
  try { return await b.openAtLogin.get() } catch { return null }
}

export async function setOpenAtLogin(on: boolean): Promise<boolean | null> {
  const b = bridge()
  if (!b) return null
  try { return await b.openAtLogin.set(on) } catch { return null }
}
