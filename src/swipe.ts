/* Swipe a row on a phone (his ask, 2026-10-27, proved in the skin prototypes).
   Right finishes it, left opens its actions. Neither is a new path: right
   presses the row's own checkbox (so a task still asks "How long?"), left
   presses its own menu button (so Delete still leaves the undo bar). A row
   without one of the two only gives in that direction and springs back.

   One listener for the whole app, like the rubber band. The axis is decided
   after 8px; a vertical start belongs to the page and is never touched. */
const PHONE = '(max-width: 639px)'
const ROWS = '.today-task, .todo-row, .tr-r, .hk-card, .hk-row'
const DONE = '[role="checkbox"][aria-checked="false"]:not(:disabled)'
const MORE = '.kebab, .hk-name'
const LIMIT = 90
const FLICK = 0.11 // px per ms
const SPRING = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1), background-color 200ms ease-out'

export function installSwipe() {
  if (typeof window === 'undefined' || !window.matchMedia) return
  let row: HTMLElement | null = null, done: HTMLElement | null = null, more: HTMLElement | null = null
  let x0 = 0, y0 = 0, dx = 0, lastX = 0, lastT = 0, v = 0, axis: '' | 'x' | 'y' = ''

  const own = (r: HTMLElement, sel: string) =>
    [...r.querySelectorAll<HTMLElement>(sel)].find((el) => el.closest(ROWS) === r) ?? null
  const reset = () => {
    if (!row) return
    const r = row
    r.style.transition = SPRING
    r.style.transform = ''
    r.classList.remove('is-swipe-done', 'is-swipe-more')
    window.setTimeout(() => { if (!r.style.transform) r.style.transition = '' }, 320)
    row = null
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary || !matchMedia(PHONE).matches) return
    const t = e.target as HTMLElement
    const r = t.closest?.<HTMLElement>(ROWS)
    if (!r || t.closest('input, textarea, select, [contenteditable="true"], .kebab-menu')) return
    done = own(r, DONE); more = own(r, MORE)
    if (!done && !more) return
    row = r; x0 = lastX = e.clientX; y0 = e.clientY; lastT = e.timeStamp; dx = 0; v = 0; axis = ''
  }, { passive: true })

  document.addEventListener('pointermove', (e) => {
    if (!row || e.pointerType !== 'touch') return
    const mx = e.clientX - x0, my = e.clientY - y0
    if (!axis) {
      if (Math.hypot(mx, my) < 8) return
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
      if (axis === 'y') { row = null; return }
    }
    v = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT)
    lastX = e.clientX; lastT = e.timeStamp
    dx = mx
    /* No action that way: it gives a little and no more. Past the limit it
       keeps following, but with growing resistance. */
    const a = Math.abs(dx), live = dx > 0 ? !!done : !!more
    const shown = Math.sign(dx) * (!live ? a / 6 : a > LIMIT ? LIMIT + (a - LIMIT) * 0.3 : a)
    row.style.transition = 'background-color 200ms ease-out'
    row.style.transform = `translateX(${shown}px)`
    row.classList.toggle('is-swipe-done', live && dx > 0)
    row.classList.toggle('is-swipe-more', live && dx < 0)
  }, { passive: true })

  const up = (e: PointerEvent) => {
    if (!row || e.pointerType !== 'touch') return
    if (axis !== 'x') { row = null; return }
    const go = Math.abs(dx) > LIMIT || (Math.abs(dx) > 24 && Math.abs(v) > FLICK && Math.sign(v) === Math.sign(dx))
    const act = e.type === 'pointerup' && go ? (dx > 0 ? done : more) : null
    reset()
    act?.click()
    /* A swipe is not a tap: swallow the click the lift may still produce. */
    const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
    window.addEventListener('click', eat, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 350)
  }
  document.addEventListener('pointerup', up, { passive: true })
  document.addEventListener('pointercancel', up, { passive: true })
}
