import { useEffect, useState } from 'react'

/* The look, his call 2026-10-28: the desktop is always Classic and has no
   choice. A phone is always Nothing and only picks Light or Dark. Per device,
   like HUD mode, so it is never synced. */
export const SKINS = [
  { id: 'nothing-light', label: 'Light', dark: false, bar: '#E8E8E8' },
  { id: 'nothing-dark', label: 'Dark', dark: true, bar: '#000000' },
] as const
/** What the browser chrome does on Classic (desktop, the Zone and Jarvis). */
export const CLASSIC_LOOK = { dark: false, bar: '#FAF8F4' }
export type SkinId = (typeof SKINS)[number]['id']

const KEY = 'mc:skin'
const read = (): SkinId => {
  try {
    const v = localStorage.getItem(KEY)
    return SKINS.some((s) => s.id === v) ? (v as SkinId) : 'nothing-light'
  } catch { return 'nothing-light' }
}

export function setSkin(id: SkinId) {
  try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('mc:skin', { detail: id }))
}

/** The look picked on this device, live. */
export function useSkin(): SkinId {
  const [skin, set] = useState<SkinId>(read)
  useEffect(() => {
    const on = () => set(read())
    window.addEventListener('mc:skin', on)
    return () => window.removeEventListener('mc:skin', on)
  }, [])
  return skin
}
