/* Apps: his other tools, opened straight from the dock's More grid.

   There is no shelf page any more (his call, 2026-09-16): a second "Apps"
   destination one tap before the tool you actually wanted was a step nobody
   asked for once the tools themselves live as entries in More. This page is
   now purely the iframe host focusAppId lands you in, and closing one sends
   you back to Today rather than to a grid that no longer exists anywhere in
   the nav.

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
    id: 'challengers', name: 'Challengers',
    url: 'https://challenger-392-service.netlify.app',
    icon: <Icon.Flag size={20} />,
  },
  {
    id: 'nexus', name: 'Nexus',
    url: 'https://nexus-offplate.netlify.app/',
    icon: <Icon.BarChart size={20} />,
  },
]

export function AppsPage() {
  const [openId, setOpenId] = useState<string | null>(null)
  /* Bumped to force a clean re-mount: an SPA that has wandered deep inside
     itself comes back to its front door. */
  const [reload, setReload] = useState(0)
  const open = APPS.find((a) => a.id === openId) ?? null

  /* The dock's More grid hands over which app to open the same way Today
     hands a routine to Habits: a one-shot signal, read once and cleared, so
     landing here from More opens straight into the frame. */
  const { focusAppId, setFocusAppId, setPage } = useStore()
  useEffect(() => {
    if (!focusAppId) return
    setOpenId(focusAppId)
    setFocusAppId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAppId])

  /* There is no shelf to fall back to any more -- an app opened without one
     (a stale reload, a direct hash) has nowhere honest to sit, so it leaves
     for Today instead of showing a grid that isn't reachable from anywhere
     in the nav. */
  useEffect(() => {
    if (!focusAppId && !open) setPage('today')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => setPage('today')

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (open) {
    return (
      <div className="page">
        <div className="apps-open">
          <button ref={wayOut} className="btn btn-quiet" onClick={close}>Back to Today</button>
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

  /* Nothing to show: the effect above is already sending this back to
     Today. */
  return null
}
