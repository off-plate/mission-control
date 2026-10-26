import { useEffect, type RefObject } from 'react'

/* iOS sheet dismissal, for a sheet that sits at the bottom of a phone screen.

   The sheet follows the finger 1:1 once it is pulled down, and only from a
   place that is not mid-scroll: dragging down inside a list that is scrolled
   away from its top scrolls the list, as it does on iOS. Letting go far enough,
   or flicking, closes it; anything less springs it back. A flick is a speed
   test, not a distance one, so a short fast pull closes too. */
export const DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)'
const PHONE = '(max-width: 639px)'

export function useSwipeDown(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let y0 = 0, dy = 0, lastY = 0, lastT = 0, v = 0, live = false
    let scroller: HTMLElement | null = null
    const scrollerOf = (t: EventTarget | null) => {
      for (let n = t as HTMLElement | null; n && n !== el; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n
      }
      return null
    }
    const start = (e: TouchEvent) => {
      if (e.touches.length > 1 || !matchMedia(PHONE).matches) { live = false; return }
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      scroller = scrollerOf(t)
      if ((scroller && scroller.scrollTop > 0) || el.scrollTop > 0) return
      y0 = lastY = e.touches[0].clientY; lastT = e.timeStamp; dy = 0; v = 0; live = true
    }
    const move = (e: TouchEvent) => {
      if (!live) return
      if ((scroller && scroller.scrollTop > 0) || el.scrollTop > 0) { live = false; el.style.transform = ''; return }
      const y = e.touches[0].clientY
      dy = y - y0
      if (dy <= 0) { el.style.transform = ''; return }
      if (e.cancelable) e.preventDefault()
      v = (y - lastY) / Math.max(1, e.timeStamp - lastT)
      lastY = y; lastT = e.timeStamp
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    }
    const end = () => {
      if (!live) return
      live = false
      if (dy > 110 || (dy > 16 && v > 0.45)) { onClose(); return }
      el.style.transition = `transform 320ms ${DRAWER}`
      el.style.transform = ''
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [ref, onClose, enabled])
}

/** Slide a sheet out along the path it came in, then unmount it. On a desktop,
 *  or with reduced motion, it just closes. */
export function slideOut(el: HTMLElement | null, scrim: HTMLElement | null, done: () => void) {
  if (!el || !matchMedia(PHONE).matches || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return }
  el.style.transition = `transform 260ms ${DRAWER}`
  el.style.transform = 'translateY(105%)'
  if (scrim) { scrim.style.transition = 'background-color 260ms ease, opacity 260ms ease'; scrim.style.opacity = '0' }
  window.setTimeout(done, 240)
}
