import { useEffect, useState } from 'react'

/* Looks ("skins"), his ask, 2026-10-27. Per device, the way HUD mode is: how
   THIS screen should look, not a fact about his life, so it is never synced.
   Classic is the canon and paints nothing. A skin is one CSS block in
   skins.css, scoped to `.shell.skin-<id>`, plus one entry here. */
export const SKINS = [
  { id: 'classic', label: 'Classic', dark: false, bar: '#FAF8F4' },
  { id: 'lime', label: 'Lime Cards', dark: false, bar: '#F1F1EF' },
  { id: 'night', label: 'Night Wallet', dark: true, bar: '#3A3150' },
  { id: 'nothing-light', label: 'Nothing Light', dark: false, bar: '#E8E8E8' },
  { id: 'nothing-dark', label: 'Nothing Dark', dark: true, bar: '#000000' },
] as const
export type SkinId = (typeof SKINS)[number]['id']

const KEY = 'mc:skin'
const read = (): SkinId => {
  try {
    const v = localStorage.getItem(KEY)
    return SKINS.some((s) => s.id === v) ? (v as SkinId) : 'classic'
  } catch { return 'classic' }
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

/** A number whose digits roll, for the Night hero figures. Each digit is a
 *  column of 0 to 9 moved by translateY, so the change itself is plain CSS. */
export function Roll({ text }: { text: string }) {
  return (
    <span className="roll" aria-label={text}>
      {[...text].map((c, i) => /\d/.test(c)
        ? <span className="rd" key={i} aria-hidden="true"><span style={{ transform: `translateY(${-Number(c)}em)` }}>{'0123456789'.split('').map((d) => <b key={d}>{d}</b>)}</span></span>
        : <span key={i} aria-hidden="true">{c}</span>)}
    </span>
  )
}
