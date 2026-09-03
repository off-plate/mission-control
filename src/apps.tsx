/* Apps: his other tools, as a shelf of icons.

   The shelf is the page. Nothing loads until he picks something, because six
   live iframes is six whole apps running behind the one he is looking at, and
   he asked for icons rather than a permanent embed.

   Each app is an iframe when opened, deliberately. These apps own their own data
   and their own sync; embedding the live site means Mission Control never
   mirrors their state, so there is nothing to reconcile and nothing to drift.
   The price is that an app with a sign-in keeps its own session inside the
   frame, which some browsers partition; "Open in browser" is the way out.

   The list is curated, not complete. An app earns a slot by being part of
   running his life from here: money, training, time, the apartment hunt,
   health, transcripts. Toys, trip planners and client work stay out. HQ CRM
   refuses to be framed (frame-ancestors 'none', its own correct call) so it is
   not here either. */

import { useEffect, useRef, useState } from 'react'
import * as Icon from './icons'
import { useStore } from './store'

export interface EmbeddedApp {
  id: string
  name: string
  url: string
  icon: JSX.Element
  /** Opens in a new tab instead of a frame. For the ones that refuse to be
   *  framed: a blank panel is worse than an honest hand-off, and an app the
   *  shelf cannot show is still an app that belongs on the shelf. */
  external?: boolean
}

/* House glyphs rather than an icon library: one stroke weight, one geometry,
   drawn for these six. See DESIGN.md on Lucide-at-default-weight. */

export const APPS: EmbeddedApp[] = [
  {
    id: 'watchless', name: 'Watchless',
    url: 'https://watchless.netlify.app',
    icon: <Icon.Video size={20} />,
  },
  {
    id: 'forge', name: 'Forge',
    url: 'https://off-plate.github.io/forge/',
    icon: <Icon.Bolt size={20} />,
  },
  {
    id: 'challengers', name: 'Challengers',
    url: 'https://challenger-392-service.netlify.app',
    icon: <Icon.Flag size={20} />,
  },
]

export function AppsPage() {
  /* null is the shelf. Opening an app is a state, not a route: it should not
     put a second thing in his back button between Apps and the rest of MC. */
  const [openId, setOpenId] = useState<string | null>(null)
  /* Bumped to force a clean re-mount: an SPA that has wandered deep inside
     itself comes back to its front door. */
  const [reload, setReload] = useState(0)
  const open = APPS.find((a) => a.id === openId) ?? null

  /* The header shelf hands over which app to open the same way Today hands a
     routine to Habits: a one-shot signal, read once and cleared, so landing
     here from the shelf opens straight into the frame instead of the grid. */
  const { focusAppId, setFocusAppId } = useStore()
  useEffect(() => {
    if (!focusAppId) return
    setOpenId(focusAppId)
    setFocusAppId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAppId])

  /* Escape closes the app, the way it closes everything else here.

     The way out has to be given focus for that to be true. A keydown listener
     on this window never hears a key pressed inside the frame, and the frame
     takes focus as soon as it loads, so Escape was landing in somebody else's
     app and doing nothing. The test caught it intermittently for a day and I
     kept filing it as flaky; it was not flaky, it was a race with the frame
     loading. Focusing the way out fixes the keyboard for real and makes the
     test deterministic at the same time. */
  const wayOut = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    wayOut.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (open) {
    return (
      <div className="page">
        <div className="apps-open">
          <button ref={wayOut} className="btn btn-quiet" onClick={() => setOpenId(null)}>Back to apps</button>
          <h1 className="apps-openname">{open.name}</h1>
          <button className="btn btn-quiet" onClick={() => setReload((n) => n + 1)}>Reload</button>
          <a className="btn btn-quiet" href={open.url} target="_blank" rel="noreferrer">Open in browser</a>
        </div>
        {/* The clip is what hides the framed app's own scrollbar: the iframe is
            made wider than the window that shows it, so the bar sits in the
            overhang. Scrolling still works, it is just not drawn. */}
        <div className="apps-clip">
          <iframe
            key={`${open.id}-${reload}`}
            className="apps-frame"
            src={open.url}
            title={open.name}
            /* The frame takes focus when it finishes loading, and a key pressed
               inside a cross-origin frame is invisible to this page: no listener
               here can ever see it. So the way out is given focus back once the
               frame is ready, which is the only moment this page can win the
               race. After he clicks into the app, Escape belongs to that app,
               and that is correct. */
            onLoad={() => wayOut.current?.focus()}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1 className="apps-h">Apps</h1>
      <ul className="apps-shelf">
        {APPS.map((a) => (
          <li key={a.id}>
            {a.external ? (
              <a className="apps-tile" href={a.url} target="_blank" rel="noreferrer">
                <span className="apps-ico" aria-hidden="true">{a.icon}</span>
                <span className="apps-name">{a.name}</span>
              </a>
            ) : (
              <button className="apps-tile" onClick={() => setOpenId(a.id)}>
                <span className="apps-ico" aria-hidden="true">{a.icon}</span>
                <span className="apps-name">{a.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
