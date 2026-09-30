/* ONE NAV FOR THE COOKIE JAR'S WHOLE WORLD. His ask (2026-09-15): the ladder,
   the flywheel, Health and Why are one place, so they share one set of doors,
   top right, on every one of them. Health used to be a separate page with no
   way back and Why had a lone Close button; both carry this instead now.

   The toggle takes you to the other view on the Cookie Jar itself. Anywhere
   else it takes you back to the Cookie Jar in whichever view you last had.
   "I want to give up" opens the give-up screen from anywhere: off the Cookie
   Jar it asks for it and goes there, since that screen lives on that page. */
import { useSyncExternalStore } from 'react'
import { useStore } from './store'

export type JarView = 'ladder' | 'wheel'
const VIEW_KEY = 'mc-cookiejar-view'

export function readJarView(): JarView {
  try { return localStorage.getItem(VIEW_KEY) === 'wheel' ? 'wheel' : 'ladder' } catch { return 'ladder' }
}
export function writeJarView(v: JarView): void {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
}

/* View and give-up live here, not in the Jar page, because the bar that
   switches between the four sections is mounted once above all of them (his
   ask, 2026-09-28: switching must not reload or move the buttons). */
/* The give-up screen is a real address, `#/give-up` (his ask, 2026-09-29:
   a link he can bookmark). The hash is the truth: opening writes it, closing
   replaces it with the Jar's own, and loading or going Back reads it. */
const GIVE_UP_HASH = '#/give-up'
let state = { view: readJarView(), lives: location.hash === GIVE_UP_HASH }
const subs = new Set<() => void>()
function set(next: Partial<typeof state>) {
  if (next.lives !== undefined && next.lives !== (location.hash === GIVE_UP_HASH)) {
    if (next.lives) location.hash = '/give-up'
    else location.replace('#/timeline')
  }
  state = { ...state, ...next }
  writeJarView(state.view)
  subs.forEach((f) => f())
}
window.addEventListener('hashchange', () => {
  const lives = location.hash === GIVE_UP_HASH
  if (lives !== state.lives) set({ lives })
})
export const jarState = { set }
export function useJarState() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)
}

export type JarHere = 'jar' | 'health' | 'gym' | 'longevity' | 'why'
export const JAR_PAGES: Record<string, JarHere> = { timeline: 'jar', health: 'health', gym: 'gym', longevity: 'longevity', board: 'why' }
const TITLE: Record<JarHere, string> = { jar: 'Jar', health: 'Health', gym: 'Gym', longevity: 'Longevity', why: 'The wall' }

/** The one header for the Jar's four sections. Same place, same size, every time. */
export function JarBar({ here }: { here: JarHere }) {
  const { setPage } = useStore()
  const { view, lives } = useJarState()
  const onJar = here === 'jar'
  const toggleLabel = onJar
    ? (view === 'ladder' ? 'Momentum' : 'The ladder')
    : (view === 'ladder' ? 'The ladder' : 'Momentum')
  const toggle = () => { if (onJar) set({ view: view === 'ladder' ? 'wheel' : 'ladder', lives: false }); else setPage('timeline') }
  const giveUp = () => set({ lives: !(onJar && lives) })
  const go = (page: 'health' | 'gym' | 'longevity' | 'board') => () => setPage(page)
  // The give-up screen covers the window; the bar under it would only make the page scroll.
  if (onJar && lives) return null

  return (
    <header className="jar-bar">
      <h1 className="jar-title">{TITLE[here]}</h1>
      <div className="cj-nav is-away">
        <button className="cj-btn tl-next jar-toggle" onClick={toggle}>{toggleLabel}</button>
        <button
          className={`cj-btn tl-health${here === 'health' ? ' is-here' : ''}`}
          aria-current={here === 'health' ? 'page' : undefined}
          onClick={go('health')}
        >Health</button>
        <button
          className={`cj-btn tl-health${here === 'gym' ? ' is-here' : ''}`}
          aria-current={here === 'gym' ? 'page' : undefined}
          onClick={go('gym')}
        >Gym</button>
        <button
          className={`cj-btn tl-health${here === 'longevity' ? ' is-here' : ''}`}
          aria-current={here === 'longevity' ? 'page' : undefined}
          onClick={go('longevity')}
        >Longevity</button>
        {/* Dropped below 639px, as it always was: the wall is a long read built
            for a screen he sits back from, not a one-handed moment. */}
        <button
          className={`cj-btn tl-why hide-phone${here === 'why' ? ' is-here' : ''}`}
          aria-current={here === 'why' ? 'page' : undefined}
          onClick={go('board')}
        >Why</button>
        <button className={`tl-giveup${onJar && lives ? ' is-on' : ''}`} onClick={giveUp}>
          {onJar && lives ? 'Back to the Cookie Jar' : 'I want to give up'}
        </button>
      </div>
    </header>
  )
}
