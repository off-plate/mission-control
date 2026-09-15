/* ONE NAV FOR THE COOKIE JAR'S WHOLE WORLD. His ask (2026-09-15): the ladder,
   the flywheel, Health and Why are one place, so they share one set of doors,
   top right, on every one of them. Health used to be a separate page with no
   way back and Why had a lone Close button; both carry this instead now.

   The toggle takes you to the other view on the Cookie Jar itself. Anywhere
   else it takes you back to the Cookie Jar in whichever view you last had.
   "I want to give up" opens the give-up screen from anywhere: off the Cookie
   Jar it asks for it and goes there, since that screen lives on that page. */
import { useStore } from './store'

export type JarView = 'ladder' | 'wheel'
const VIEW_KEY = 'mc-cookiejar-view'

export function readJarView(): JarView {
  try { return localStorage.getItem(VIEW_KEY) === 'wheel' ? 'wheel' : 'ladder' } catch { return 'ladder' }
}
export function writeJarView(v: JarView): void {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
}

let giveUpAsked = false
/** Read once by the Cookie Jar when it opens: was the give-up screen asked for
 *  from Health or Why? Clears itself so a later visit opens normally. */
export function takeGiveUpRequest(): boolean {
  const asked = giveUpAsked
  giveUpAsked = false
  return asked
}

export function CookieJarNav({ here, view, onToggleView, lives = false, onGiveUp }: {
  here: 'jar' | 'health' | 'why'
  view: JarView
  onToggleView?: () => void
  lives?: boolean
  onGiveUp?: () => void
}) {
  const { setPage } = useStore()
  const onJar = here === 'jar'
  const toggleLabel = onJar
    ? (view === 'ladder' ? 'The flywheel' : 'The ladder')
    : (view === 'ladder' ? 'The ladder' : 'The flywheel')
  const toggle = onJar && onToggleView ? onToggleView : () => setPage('timeline')
  const giveUp = onJar && onGiveUp ? onGiveUp : () => { giveUpAsked = true; setPage('timeline') }

  return (
    <div className={`cj-nav${onJar ? '' : ' is-away'}`}>
      <button className="cj-btn tl-next" onClick={toggle}>{toggleLabel}</button>
      <button
        className={`cj-btn tl-health${here === 'health' ? ' is-here' : ''}`}
        aria-current={here === 'health' ? 'page' : undefined}
        onClick={() => setPage('health')}
      >Health</button>
      {/* Dropped below 639px, as it always was: the wall is a long read built
          for a screen he sits back from, not a one-handed moment. */}
      <button
        className={`cj-btn tl-why hide-phone${here === 'why' ? ' is-here' : ''}`}
        aria-current={here === 'why' ? 'page' : undefined}
        onClick={() => setPage('board')}
      >Why</button>
      <button className={`tl-giveup${lives ? ' is-on' : ''}`} onClick={giveUp}>
        {lives ? 'Back to the Cookie Jar' : 'I want to give up'}
      </button>
    </div>
  )
}
