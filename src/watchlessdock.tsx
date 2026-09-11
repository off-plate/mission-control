/* THE FLOATING WATCHLESS GLANCE. Every dock panel answers one question, and
   this one's is "read this instead of watching it" -- so the panel is the paste
   box, and nothing else. The reading itself belongs on the full page, where
   there is room for an hour of talk.

   Pasting here opens the page with the read already running, rather than
   answering inside a panel the size of a postcard. */
import { type ReactNode, useState } from 'react'
import { useStore } from './store'
import { recents, useWatchless, videoId } from './watchless'
import * as Icon from './icons'

export function WatchlessChip() {
  return <Icon.DockTranscript size={22} />
}

export function WatchlessPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage } = useStore()
  const { state, read } = useWatchless()
  const [input, setInput] = useState('')
  const seen = recents().slice(0, 3)
  const ready = !!videoId(input)

  const open = () => { setPage('watchless'); onOpenFull?.() }
  const go = (url: string) => { void read(url); open() }

  return (
    <div className="billsdock-panel">
      <div className="billsdock-head">
        <span className="billsdock-title">Watchless</span>
        <button className="btn btn-primary dock-open-btn" onClick={open} title="Open Watchless">
          <Icon.ExternalLink size={13} />
          Watchless
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        <form
          className="wldock-ask"
          onSubmit={(e) => { e.preventDefault(); if (ready) go(input) }}
        >
          <input
            className="wldock-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
            spellCheck={false}
          />
          <button className="wldock-go" type="submit" disabled={!ready || state.status === 'reading'}>
            {state.status === 'reading' ? 'Reading' : 'Read'}
          </button>
        </form>
        {input && !ready && <p className="wldock-note">That is not a YouTube link yet.</p>}

        {seen.length > 0 && (
          <div className="wldock-recent">
            {seen.map((r) => (
              <button key={r.videoId} className="wldock-row" onClick={() => go(r.url)} title={r.title}>
                <Icon.DockTranscript size={14} />
                <span>{r.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
