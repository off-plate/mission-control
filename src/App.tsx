import { useState } from 'react'
import { SpaceGrid } from './Grid'
import { MOCK_EXCEPTIONS, SPACE_LABELS } from './mock'
import { AddWidgetSheet, CoachSheet, DecomposeSheet, LedgerSheet } from './modals'
import { useStore } from './store'
import type { SpaceId } from './types'

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-label="Mission Control" role="img">
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <path d="M16 1.5v6M16 24.5v6M1.5 16h6M24.5 16h6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

type Modal = 'decompose' | 'coach' | 'ledger' | 'add' | null

export default function App() {
  const { space, setSpace, theme, toggleTheme, editing, setEditing, savedMin, resetDemo } = useStore()
  const [modal, setModal] = useState<Modal>(null)

  const now = new Date()
  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const exceptions = space === 'personal' ? MOCK_EXCEPTIONS : []

  return (
    <div className="shell">
      <a className="sr-only" href="#main" style={{ position: 'absolute', left: -9999 }}>Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Mission Control</span>
        </div>
        <nav className="spaces" aria-label="Spaces">
          {(Object.keys(SPACE_LABELS) as SpaceId[]).map((s) => (
            <button
              key={s}
              className="space-btn"
              aria-pressed={space === s}
              onClick={() => setSpace(s)}
            >
              {SPACE_LABELS[s]}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button className="chip" onClick={() => setModal('ledger')} aria-label="Time saved this week">
            <span className="chip-label">saved</span>
            <span className="mono">{Math.floor(savedMin / 60)}h {savedMin % 60}m</span>
          </button>
          <button className="btn btn-quiet" onClick={() => setModal('coach')}>Coach</button>
          <button
            className="btn btn-quiet"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          {editing && (
            <button className="btn btn-quiet" onClick={() => setModal('add')}>Add widget</button>
          )}
          <button className="btn btn-primary" onClick={() => setModal('decompose')}>Break it down</button>
          <button
            className="btn btn-quiet"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main id="main">
        <div className="dayline">
          <h1>{SPACE_LABELS[space]}</h1>
          <span className="mono">{dateLine} · Prague</span>
        </div>

        {exceptions.length > 0 ? (
          <div className="exceptions" role="alert" aria-label="Needs attention">
            {exceptions.map((x) => (
              <div className="exception-row" key={x.id}>
                <span className="dot" aria-hidden="true" />
                <span>{x.text}</span>
                {x.action === 'coach' && (
                  <button onClick={() => setModal('coach')}>Walk me through it</button>
                )}
                <span className="when">{x.when}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="allclear">
            <span className="dot" aria-hidden="true" />
            Nothing is on fire in this space. The grid below is the detail.
          </div>
        )}

        <SpaceGrid onOpenLedger={() => setModal('ledger')} />
      </main>

      <footer className="foot">
        <span className="mono">DEMO BUILD</span>
        <span>All data on this page is invented. The real build syncs TickTick, Trello, Jira, two Gmail accounts, Calendar, Compass, Hevy and more into Supabase.</span>
        <button className="btn-quiet" style={{ marginLeft: 'auto', fontSize: 'inherit', color: 'var(--muted)' }} onClick={resetDemo}>
          Reset demo
        </button>
      </footer>

      {modal === 'decompose' && <DecomposeSheet onClose={() => setModal(null)} />}
      {modal === 'coach' && <CoachSheet onClose={() => setModal(null)} />}
      {modal === 'ledger' && <LedgerSheet onClose={() => setModal(null)} />}
      {modal === 'add' && <AddWidgetSheet onClose={() => setModal(null)} />}
    </div>
  )
}
