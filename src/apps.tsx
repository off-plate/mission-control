/* Apps: his other tools, embedded where the day already happens.

   Each entry is an iframe, deliberately. These apps own their own data and their
   own sync; embedding the live site means Mission Control never mirrors their
   state, so there is nothing to reconcile and nothing to drift. The price is
   that an app with a sign-in keeps its own session inside the frame, and a
   browser may partition that storage; "Open in browser" is the escape hatch.

   The list is curated, not complete. An app earns a slot by being part of
   running his life from here: money, training, time, the apartment hunt,
   health, transcripts. Toys, trip planners and client work stay out. HQ CRM
   refuses to be framed (frame-ancestors 'none', its own correct call) so it is
   not here either. */

import { useState } from 'react'

interface EmbeddedApp {
  id: string
  name: string
  url: string
}

/* Watchless first: the one he asked to land here. */
const APPS: EmbeddedApp[] = [
  { id: 'watchless', name: 'Watchless', url: 'https://watchless.netlify.app' },
  { id: 'compass', name: 'Compass', url: 'https://compass-money.netlify.app' },
  { id: 'forge', name: 'Forge', url: 'https://off-plate.github.io/forge/' },
  { id: 'hodina', name: 'Hodina', url: 'https://hodina.netlify.app' },
  { id: 'hunterpart', name: 'Hunterpart', url: 'https://hunterpart.netlify.app' },
  { id: 'zepp', name: 'Zepp Health', url: 'https://zepp-health.netlify.app' },
]

const LAST_KEY = 'mc-apps-last'

/* A view preference, like mc-view: which app was open on THIS device. Not
   synced on purpose; the phone and the desk want different tools open. */
function readLast(): string {
  try { return localStorage.getItem(LAST_KEY) ?? APPS[0].id } catch { return APPS[0].id }
}

export function AppsPage() {
  const [activeId, setActiveId] = useState(readLast)
  /* Bumped to force a clean re-mount of the frame: an SPA that has wandered
     deep inside itself comes back to its front door. */
  const [reload, setReload] = useState(0)
  const active = APPS.find((a) => a.id === activeId) ?? APPS[0]

  const pick = (id: string) => {
    if (id === activeId) { setReload((n) => n + 1); return }
    setActiveId(id)
    try { localStorage.setItem(LAST_KEY, id) } catch { /* view preference only */ }
  }

  return (
    <div className="page">
      <div className="apps-bar">
        <h1>Apps</h1>
        {APPS.map((a) => (
          <button key={a.id} className={`btn btn-ghost${a.id === active.id ? ' is-on' : ''}`} onClick={() => pick(a.id)}>
            {a.name}
          </button>
        ))}
        <a className="btn btn-quiet apps-out" href={active.url} target="_blank" rel="noreferrer">
          Open in browser
        </a>
      </div>
      {/* Only the active app is mounted. Six live iframes would be six full
          apps running behind one visible one. */}
      <iframe
        key={`${active.id}-${reload}`}
        className="apps-frame"
        src={active.url}
        title={active.name}
      />
    </div>
  )
}
