/* iOS rubber-band at the top and bottom of a page (his ask, 2026-10-26).

   The browser's own bounce dragged the whole app, header and tab bar
   included, and showed empty paper above it, so it is switched off
   (overscroll-behavior: none). This puts back the part he wanted: past the
   top or the bottom, the page's content follows the finger with growing
   resistance and springs home on release. The header and tab bar hold still,
   as they do in an iOS app.

   Only the page's own content moves. Anything fixed (a dock) is left alone,
   since a transform on its parent would pin it to the page instead of the
   screen. Off while a sheet is open, inside anything that scrolls by itself,
   and with reduced motion. */
const PHONE = '(max-width: 639px) and (pointer: coarse)'
const SPRING = 'transform 420ms cubic-bezier(0.32, 0.72, 0, 1)'
const band = (x: number, dim: number) => (x * dim * 0.55) / (dim + 0.55 * Math.abs(x))

export function installRubberBand() {
  if (typeof window === 'undefined' || !window.matchMedia) return
  let y0 = 0, edge: 'top' | 'bottom' | null = null, targets: HTMLElement[] = [], pulled = false, down = 0

  const pick = (): HTMLElement[] => {
    const main = document.getElementById('main')
    if (!main) return []
    const page = main.querySelector<HTMLElement>(':scope > .page, :scope > * > .page') ?? main
    return [...page.children].filter((el): el is HTMLElement => {
      const p = getComputedStyle(el).position
      return el instanceof HTMLElement && p !== 'fixed'
    })
  }
  const blocked = (t: EventTarget | null) => {
    const el = t as HTMLElement | null
    if (!el?.closest || !el.closest('#main')) return true
    if (document.querySelector('.overlay, .hk-sheet, .tabsheet.is-open')) return true
    for (let n: HTMLElement | null = el; n && n.id !== 'main'; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if ((n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(cs.overflowY)) || (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(cs.overflowX))) return true
    }
    return false
  }
  const set = (y: number, anim: boolean) => {
    for (const el of targets) {
      el.style.transition = anim ? SPRING : 'none'
      el.style.transform = y ? `translateY(${y}px)` : ''
    }
  }

  window.addEventListener('touchstart', (e) => {
    edge = null; pulled = false
    if (e.touches.length !== 1 || !matchMedia(PHONE).matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (blocked(e.target)) return
    y0 = e.touches[0].clientY
    targets = pick()
    edge = 'top' // decided on the first move, by direction and position
  }, { passive: true })

  window.addEventListener('touchmove', (e) => {
    if (!edge) return
    const dy = e.touches[0].clientY - y0
    const atTop = window.scrollY <= 0
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1
    if (dy > 0 && atTop) { pulled = true; down = band(dy, window.innerHeight); set(down, false) }
    else if (dy < 0 && atBottom) { pulled = true; down = 0; set(band(dy, window.innerHeight), false) }
    else if (pulled) { pulled = false; down = 0; set(0, false); y0 = e.touches[0].clientY }
    else y0 = e.touches[0].clientY
  }, { passive: true })

  /* Pull to refresh, on Today only: far enough down and let go runs the same
     pull the app does when it comes back to the front (store.tsx). */
  const end = () => {
    if (pulled) set(0, true)
    if (pulled && down > 64 && document.querySelector('#main .page.is-today')) window.dispatchEvent(new Event('mc:refresh'))
    edge = null; pulled = false; down = 0
    window.setTimeout(() => { for (const el of targets) { if (!el.style.transform) el.style.transition = '' } }, 450)
  }
  window.addEventListener('touchend', end, { passive: true })
  window.addEventListener('touchcancel', end, { passive: true })
}
