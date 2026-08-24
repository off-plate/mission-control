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

import { useEffect, useState } from 'react'

interface EmbeddedApp {
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
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const APPS: EmbeddedApp[] = [
  {
    /* Moved off the header on his instruction. It opens in a TAB, not a frame,
       and that is not a preference: mymind answers with frame-ancestors 'none',
       so a panel inside this page is not something the app is allowed to build.
       That constraint used to be written above the header button; it moves here
       with the app it describes. */
    id: 'mymind', name: 'My Mind',
    url: 'https://access.mymind.com/everything',
    external: true,
    icon: <svg viewBox="0 0 24 24" {...S}><rect x="3" y="6" width="11" height="14" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v11" /></svg>,
  },
  {
    id: 'watchless', name: 'Watchless',
    url: 'https://watchless.netlify.app',
    icon: <svg viewBox="0 0 24 24" {...S}><rect x="2.5" y="4.5" width="19" height="15" rx="3.5" /><path d="M10 9.5l5 2.5-5 2.5z" /></svg>,
  },
  {
    id: 'compass', name: 'Compass',
    url: 'https://compass-money.netlify.app',
    icon: <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>,
  },
  {
    id: 'forge', name: 'Forge',
    url: 'https://off-plate.github.io/forge/',
    icon: <svg viewBox="0 0 24 24" {...S}><path d="M12 3s4.5 4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.4.6-2.7 1.3-3.7.5 1 1.2 1.7 2 2 .3-2.6-.5-4.6 1.2-6.3z" /><path d="M7 21h10" /></svg>,
  },
  {
    id: 'hodina', name: 'Hodina',
    url: 'https://hodina.netlify.app',
    icon: <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="9" /><path d="M12 6.75V12l3.5 2" /></svg>,
  },
  {
    id: 'hunterpart', name: 'Hunterpart',
    url: 'https://hunterpart.netlify.app',
    icon: <svg viewBox="0 0 24 24" {...S}><path d="M3.5 10.5L12 4l8.5 6.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></svg>,
  },
  {
    id: 'zepp', name: 'Zepp Health',
    url: 'https://zepp-health.netlify.app',
    icon: <svg viewBox="0 0 24 24" {...S}><path d="M20.5 11c0 4.5-8.5 9.5-8.5 9.5S3.5 15.5 3.5 11a4.5 4.5 0 0 1 8.5-2.1A4.5 4.5 0 0 1 20.5 11z" /><path d="M3.8 12.5h4l1.5-2.5 2 5 1.5-2.5h3.5" /></svg>,
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

  /* Escape closes the app, the way it closes everything else here. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (open) {
    return (
      <div className="page">
        <div className="apps-open">
          <button className="btn btn-quiet" onClick={() => setOpenId(null)}>Back to apps</button>
          <h1 className="apps-openname">{open.name}</h1>
          <button className="btn btn-quiet" onClick={() => setReload((n) => n + 1)}>Reload</button>
          <a className="btn btn-quiet" href={open.url} target="_blank" rel="noreferrer">Open in browser</a>
        </div>
        {/* The clip is what hides the framed app's own scrollbar: the iframe is
            made wider than the window that shows it, so the bar sits in the
            overhang. Scrolling still works, it is just not drawn. */}
        <div className="apps-clip">
          <iframe key={`${open.id}-${reload}`} className="apps-frame" src={open.url} title={open.name} />
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
