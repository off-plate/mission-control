import { useEffect, useRef, useState } from 'react'
import { MOCK_EXCEPTIONS_FOR } from './exceptions'
import { SPACE_LABELS } from './mock'
import { DecomposeSheet } from './modals'
import { GoalsPage, HabitsPage, PlanPage, RoutinesPage, TodayPage } from './pages1'
import { CoachPage, MoneyPage, ReviewPage, SettingsPage } from './pages2'
import { AssistantPage } from './pages3'
import { useStore } from './store'
import type { PageId, SpaceId } from './types'

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-label="Mission Control" role="img">
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <path d="M16 1.5v6M16 24.5v6M1.5 16h6M24.5 16h6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

const NAV: { id: PageId; label: string; personalOnly?: boolean }[] = [
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  { id: 'habits', label: 'Habits' },
  { id: 'routines', label: 'Routines' },
  { id: 'goals', label: 'Goals' },
  { id: 'money', label: 'Money', personalOnly: true },
  { id: 'review', label: 'Review' },
  { id: 'coach', label: 'Coach' },
]

function PageNav({
  tabs, page, setPage, attention,
}: {
  tabs: { id: PageId; label: string }[]
  page: PageId
  setPage: (p: PageId) => void
  attention: boolean
}) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [page])
  return (
    <nav className="nav" aria-label="Pages">
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={page === t.id ? activeRef : undefined}
          className={`nav-tab${t.id === 'today' && attention ? ' attention' : ''}`}
          aria-current={page === t.id ? 'page' : undefined}
          onClick={() => setPage(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const { space, setSpace, page, setPage, theme, toggleTheme } = useStore()
  const [decomposeOpen, setDecomposeOpen] = useState(false)
  const exceptions = MOCK_EXCEPTIONS_FOR(space)

  const tabs = NAV.filter((t) => !t.personalOnly || space === 'personal')

  return (
    <div className="shell">
      <div className="topstick">
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
              onClick={() => { setSpace(s); if (s !== 'personal' && page === 'money') setPage('today') }}
            >
              {SPACE_LABELS[s]}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            className={`btn btn-quiet${page === 'assistant' ? ' is-on' : ''}`}
            onClick={() => setPage('assistant')}
            aria-pressed={page === 'assistant'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" strokeLinejoin="round" />
            </svg>
            Assistant
          </button>
          <button className="btn btn-primary btn-breakdown" onClick={() => setDecomposeOpen(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3v6M12 9L6.5 14M12 9l5.5 5M6.5 14v0M6.5 14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 14a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 3a2.5 2.5 0 1 0 0-.01" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Break it down
          </button>
          <button
            className="btn btn-ghost"
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
          <button
            className={`btn btn-ghost${page === 'settings' ? ' is-on' : ''}`}
            onClick={() => setPage('settings')}
            aria-label="Settings"
            aria-pressed={page === 'settings'}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <PageNav tabs={tabs} page={page} setPage={setPage} attention={exceptions.length > 0} />
      </div>

      <main id="main">
        {page === 'today' && <TodayPage />}
        {page === 'plan' && <PlanPage />}
        {page === 'assistant' && <AssistantPage />}
        {page === 'habits' && <HabitsPage />}
        {page === 'routines' && <RoutinesPage />}
        {page === 'goals' && <GoalsPage />}
        {page === 'money' && <MoneyPage />}
        {(page === 'review' || page === 'stats') && <ReviewPage />}
        {page === 'coach' && <CoachPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <footer className="foot">
        <span className="mono">V1 DEMO</span>
        <span>All data is invented and lives only in this browser. The real build syncs TickTick, Trello, Jira, two Gmail accounts, Calendar, Compass and Hevy into Supabase.</span>
      </footer>

      {decomposeOpen && <DecomposeSheet onClose={() => setDecomposeOpen(false)} />}
    </div>
  )
}
