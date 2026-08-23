import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { exceptionsFor, globalExceptions } from './exceptions'
import { useDockBadge } from './desktop'
import { SPACE_LABELS } from './mock'
import { GoalsPage, HabitsPage, PlanPage, TodayPage } from './pages1'
import { SettingsPage } from './pages2'
import { AchievementsPage } from './achievements'
import { NotesPage } from './notes'
import { DailyReview } from './daily'
import { BrandPage } from './brand'
import { DayPage } from './day'
import { BoardPage } from './board'
import { AppsPage } from './apps'
import { FocusPage } from './focus'
import { ZonePage, useZoneDepth } from './zone'
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
  /* Routines left the menu when it became a folder inside Habits. The address
     still resolves so a bookmark or an old link lands on Habits rather than on
     nothing: see the redirect where the pages are chosen. */
  { id: 'goals', label: 'Goals' },
  { id: 'board', label: 'Why’s' },
  { id: 'apps', label: 'Apps' },
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

/* Phone chrome, on his design: "on mobile this could be one left dropdown
   where I choose which workspace I'm in, and on the right a hamburger menu,
   again with a dropdown, where I choose today, plan, habits, goals, why's.
   And by default, not on scroll."

   So neither strip scrolls on a phone any more: the workspace is a real
   select (the OS picker, which is the one control a thumb is always good at)
   and the pages are a menu behind a hamburger. Both are hidden on a desktop,
   where the strips are better. */
function PhonePages({ tabs, page, setPage }: {
  tabs: { id: PageId; label: string }[]
  page: PageId
  setPage: (p: PageId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const here = tabs.find((t) => t.id === page)
  return (
    <span className="kebab-wrap phone-pages" ref={ref}>
      <button
        className="btn btn-ghost phone-burger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Pages, currently ${here?.label ?? 'Today'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
        <span className="btn-label">{here?.label ?? 'Pages'}</span>
      </button>
      {open && (
        <div className="kebab-menu" role="menu" onClick={() => setOpen(false)}>
          {tabs.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              aria-current={page === t.id ? 'page' : undefined}
              className={page === t.id ? 'is-on' : ''}
              onClick={() => setPage(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

export default function App() {
  const { space, view, setView, page, setPage, tasks, routines, goals, openDaily } = useStore()
  // The dot follows the alerts: money and admin count from any profile.
  const exceptions = space === 'personal'
    ? exceptionsFor(space, { tasks, routines, goals })
    : [...globalExceptions({ tasks, routines }), ...exceptionsFor(space, { tasks, routines, goals })]

  /* macOS dock badge, same list as the alerts above. No-op on the website. */
  useDockBadge(exceptions.length)

  /* File -> New Task (Cmd+N) in the macOS menu. There is no dialog to open:
     adding a task IS the input at the top of Plan's list, so the shortcut goes
     there and puts the cursor in it. Wired on the website too, where it simply
     never fires because nothing dispatches the event outside the app shell. */
  useEffect(() => {
    const onNewTask = () => {
      location.hash = '/plan'
      /* After the page mounts. Two frames, not a timeout: the second frame is
         the first one in which the new page's DOM exists. */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>('input[aria-label="New task"]')?.focus()
      }))
    }
    window.addEventListener('mc:new-task', onNewTask)
    return () => window.removeEventListener('mc:new-task', onNewTask)
  }, [])

  /* Every space now has every tab: Money left the menu for Achievements, which
     is reached from the header and is his regardless of which space he happens
     to be standing in. */
  const tabs = NAV

  /* Signed out, nothing is backed up and the phone shows a different day. That is
     worth a mark on the gear rather than a banner across the top. */
  const [needsSignIn, setNeedsSignIn] = useState(false)
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    void currentAccount().then((a) => setNeedsSignIn(!a))
    return onAccountChange((a) => setNeedsSignIn(!a))
  }, [])
  /* How far into the running block he is, for the Zone's water. Read here
     rather than inside the room because the shell is what paints it. */
  const zoneDepth = useZoneDepth()
  /* Where pressing The Zone a second time puts him: the page he was on when
     he walked in. A ref, not state, because nothing renders from it and it
     must not cause one. Today is the floor, for a reload that lands straight
     in the room with no history behind it. */
  const backFromZone = useRef<PageId>('today')
  useEffect(() => { if (page !== 'zone') backFromZone.current = page }, [page])

  return (
    /* The Zone is a room, not a dark card: the shell carries the class so the
       header goes under the water with everything else, instead of leaving a
       warm-paper bar sitting on top of it. --depth rides along here too,
       because this is the element that paints the water; set any lower down
       it could never reach this rule, and the room never deepened at all. */
    <div
      className={`shell${page === 'zone' ? ' in-zone' : ''}`}
      style={page === 'zone' ? ({ '--depth': zoneDepth } as React.CSSProperties) : undefined}
    >
      <a className="skiplink" href="#main">Skip to the page</a>
      <div className="topstick">
      <header className="topbar">
        {/* The name is the way home, on his instruction: back to All and
            Today from wherever he is. It was decoration before. */}
        <button
          className="brand"
          onClick={() => { setView('all'); setPage('today') }}
          title="All workspaces, Today"
          aria-label="Mission Control, back to Today"
        >
          <Logo />
          <span className="brand-name">Mission Control</span>
        </button>
        {/* The Zone is a room, not a tab: which workspace you were standing in
            when you walked in has nothing to do with the one thing running
            now, so the switcher goes quiet rather than sitting there unused. */}
        {page !== 'zone' && (
          <label className="phone-space">
            <span className="visually-hidden">Workspace</span>
            <select
              className="textinput"
              value={view}
              onChange={(e) => setView(e.target.value as ViewId)}
            >
              {(['all', ...Object.keys(SPACE_LABELS)] as ViewId[]).map((s2) => (
                <option key={s2} value={s2}>{s2 === 'all' ? 'All' : SPACE_LABELS[s2 as SpaceId]}</option>
              ))}
            </select>
          </label>
        )}
        {page !== 'zone' && (
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
        )}
        <div className="topbar-right">
          {/* mymind cannot be embedded: it answers with frame-ancestors 'none',
              which forbids every iframe anywhere, so a panel inside this page is
              not something the app is allowed to build. A plain link in a new
              tab then, not a sized window: that opened as a Chrome app window,
              which is not what he asked for and not where he keeps his tabs. */}
          <a
            className="btn btn-ghost hide-phone"
            href="https://access.mymind.com/everything"
            target="_blank"
            rel="noreferrer"
            title="Open My Mind in a new tab"
            aria-label="My Mind"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="6" width="11" height="14" rx="2" />
              <path d="M8 3h11a2 2 0 0 1 2 2v11" strokeLinecap="round" />
            </svg>
            <span className="btn-label">My Mind</span>
          </a>
          {/* The one thing running, full screen. Filled with the accent so it
              reads as the button that starts something, not a place he browses.
              It is a toggle: pressing it again puts him back on the page he
              walked in from, because the room has no close of its own and he
              was leaving it by pressing Note or Achievements to get out. */}
          <button
            className={`btn btn-primary${page === 'zone' ? ' is-on' : ''}`}
            onClick={() => setPage(page === 'zone' ? backFromZone.current : 'zone')}
            aria-pressed={page === 'zone'}
            title={page === 'zone' ? 'Leave the Zone' : 'The Zone'}
            aria-label={page === 'zone' ? 'Leave the Zone' : 'The Zone'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3l2.6 6.2L21 11l-6.4 1.8L12 21l-2.6-8.2L3 11l6.4-1.8z" strokeLinejoin="round" />
            </svg>
            <span className="btn-label">The Zone</span>
          </button>
          {/* Notes, one click from any screen. It left the menu because he
              reaches for it mid-thought, not by navigating to it. */}
          <button
            className={`btn btn-ghost${page === 'notes' ? ' is-on' : ''}`}
            onClick={() => setPage('notes')}
            aria-pressed={page === 'notes'}
            title="Notes"
            aria-label="Note"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 3.5h9.5L19 8v12.5H5z" strokeLinejoin="round" />
              <path d="M14 3.5V8h5M8.5 12.5h7M8.5 16h4.5" strokeLinecap="round" />
            </svg>
            <span className="btn-label">Note</span>
          </button>
          {/* Money and Reflect, merged. Both are about looking back at what
              moved, so they are one destination and it lives up here. */}
          <button
            className={`btn btn-ghost hide-phone${['achievements', 'money', 'review', 'stats'].includes(page) ? ' is-on' : ''}`}
            onClick={() => setPage('achievements')}
            aria-pressed={['achievements', 'money', 'review', 'stats'].includes(page)}
            title="Achievements, money and reflection"
            aria-label="Achievements"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 3.5h10v5a5 5 0 0 1-10 0z" strokeLinejoin="round" />
              <path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10" strokeLinecap="round" />
              <path d="M12 13.5v3.5M9 20.5h6" strokeLinecap="round" />
            </svg>
            <span className="btn-label">Achievements</span>
          </button>
          {/* Yesterday, on demand. It offers itself once a morning; after that
              it is his to open, from any page, without hunting for a pill. */}
          <button className="btn btn-ghost" onClick={openDaily} aria-label="Yesterday" title="Walk yesterday and today">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3.5 9a9 9 0 1 0 2.3-3.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 4v4h4M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="btn-label">Yesterday</span>
          </button>
          {page !== 'zone' && <PhonePages tabs={tabs} page={page} setPage={setPage} />}
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

      {/* Today, Plan, Habits… none of them apply once he has actually walked
          into the room. Keeping them lit alongside a running countdown was
          the exact "still just a dashboard page" problem the room exists to
          not be. */}
      {page !== 'zone' && <PageNav tabs={tabs} page={page} setPage={setPage} attention={exceptions.length > 0} />}
      </div>

      {isReadOnly() && (
        <div className="allclear" role="status" aria-live="polite" style={{ borderColor: 'var(--alert)', margin: 'var(--s4) var(--s5) 0' }}>
          <span className="dot" aria-hidden="true" />
          Another device has saved a newer version of your data. Nothing here is being saved until this one is updated, so that version is not overwritten.
        </div>
      )}
      {/* One mount for the whole app, so the header button reaches it from
          anywhere rather than only from Today. */}
      <DailyReview />

      <main id="main" tabIndex={-1}>
        <PageBoundary page={page}>
        {page === 'today' && <TodayPage />}
        {page === 'plan' && <PlanPage />}
        {(page === 'habits' || page === 'routines') && <HabitsPage />}
        {page === 'goals' && <GoalsPage />}
        {/* Money and Reflect are faces of Achievements now. Their old
            addresses still resolve, so a bookmark lands on the merged page
            rather than on nothing. */}
        {(page === 'achievements' || page === 'money' || page === 'review' || page === 'stats') && <AchievementsPage />}
        {page === 'focus' && <FocusPage />}
        {page === 'board' && <BoardPage />}
        {page === 'apps' && <AppsPage />}
        {page === 'notes' && <NotesPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'brand' && <BrandPage />}
        {page === 'day' && <DayPage />}
        {page === 'zone' && <ZonePage />}
        </PageBoundary>
      </main>


    </div>
  )
}
