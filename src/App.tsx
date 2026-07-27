import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { exceptionsFor, globalExceptions } from './exceptions'
import { SPACE_LABELS } from './mock'
import { GoalsPage, HabitsPage, PlanPage, RoutinesPage, TodayPage } from './pages1'
import { CoachPage, MoneyPage, ReviewPage, SettingsPage } from './pages2'
import { AssistantPage, BrainDumpPage } from './pages3'
import { BrandPage } from './brand'
import { useStore } from './store'
import { SUPABASE_ENABLED, currentAccount, onAccountChange } from './supabase'
import { isReadOnly } from './store'
import type { PageId, SpaceId, ViewId } from './types'

/* One failing page must not take the whole shell with it: the header, the nav
   and every other tab keep working while the broken view shows a card. */
class PageBoundary extends Component<{ children: ReactNode; page: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prev: { page: string }) {
    if (prev.page !== this.props.page && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="page">
          <div className="panel" style={{ maxWidth: 620 }}>
            <span className="microcap">This view hit an error</span>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)', marginTop: 8 }}>
              Nothing was lost. Every other tab still works; open one from the menu above, or reload to try this one again.
            </p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-label="Mission Control" role="img">
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <path d="M16 1.5v6M16 24.5v6M1.5 16h6M24.5 16h6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/* Every space shows the same menu. What changes between spaces is the content of
   each page, never which pages exist. */
const NAV: { id: PageId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  { id: 'habits', label: 'Habits' },
  { id: 'routines', label: 'Routines' },
  { id: 'goals', label: 'Goals' },
  { id: 'money', label: 'Money' },
  { id: 'review', label: 'Review' },
  { id: 'braindump', label: 'Brain Dump' },
  { id: 'coach', label: 'Avoidance' },
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
  const { space, view, setView, page, setPage, tasks, routines } = useStore()
  // The dot follows the alerts: money and admin count from any profile.
  const exceptions = space === 'personal'
    ? exceptionsFor(space, { tasks, routines })
    : [...globalExceptions({ tasks, routines }), ...exceptionsFor(space, { tasks, routines })]

  const tabs = NAV

  /* Signed out, nothing is backed up and the phone shows a different day. That is
     worth a mark on the gear rather than a banner across the top. */
  const [needsSignIn, setNeedsSignIn] = useState(false)
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    void currentAccount().then((a) => setNeedsSignIn(!a))
    return onAccountChange((a) => setNeedsSignIn(!a))
  }, [])

  return (
    <div className="shell">
      <div className="topstick">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Mission Control</span>
        </div>
        <nav className="spaces" aria-label="Spaces">
          {(['all', ...Object.keys(SPACE_LABELS)] as ViewId[]).map((s) => (
            <button
              key={s}
              className="space-btn"
              aria-pressed={view === s}
              onClick={() => setView(s)}
            >
              {s === 'all' ? 'All' : SPACE_LABELS[s as SpaceId]}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <button
            className={`btn btn-accent${page === 'assistant' ? ' is-on' : ''}`}
            onClick={() => setPage('assistant')}
            aria-pressed={page === 'assistant'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" strokeLinejoin="round" />
            </svg>
            Assistant
          </button>
          <button
            className={`btn btn-ghost${page === 'settings' ? ' is-on' : ''}${needsSignIn ? ' has-dot' : ''}`}
            onClick={() => setPage('settings')}
            aria-label={needsSignIn ? 'Settings, sync is off' : 'Settings'}
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

      {isReadOnly() && (
        <div className="allclear" style={{ borderColor: 'var(--alert)', margin: 'var(--s4) var(--s5) 0' }}>
          <span className="dot" aria-hidden="true" />
          Another device has saved a newer version of your data. Nothing here is being saved until this one is updated, so that version is not overwritten.
        </div>
      )}
      <main id="main">
        <PageBoundary page={page}>
        {page === 'today' && <TodayPage />}
        {page === 'plan' && <PlanPage />}
        {page === 'assistant' && <AssistantPage />}
        {page === 'habits' && <HabitsPage />}
        {page === 'routines' && <RoutinesPage />}
        {page === 'goals' && <GoalsPage />}
        {page === 'money' && <MoneyPage />}
        {(page === 'review' || page === 'stats') && <ReviewPage />}
        {page === 'coach' && <CoachPage />}
        {page === 'braindump' && <BrainDumpPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'brand' && <BrandPage />}
        </PageBoundary>
      </main>


    </div>
  )
}
