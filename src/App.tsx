import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { exceptionsFor, globalExceptions } from './exceptions'
import { useDockBadge } from './desktop'
import { SPACE_LABELS } from './mock'
import { GoalsPage, HabitsPage, PlanPage, TodayPage } from './pages1'
import { SettingsPage } from './pages2'
import { NotesPage } from './notes'
import { BillsPage } from './billspage'
import { DailyReview } from './daily'
import { BrandPage } from './brand'
import { DayPage } from './day'
import { BoardPage } from './board'
import { AppsPage, APPS } from './apps'
import { Dropdown } from './ui'
import { CalendarPage } from './calendarpage'
import { AssistantPage } from './assistantpage'
import { Helmet } from './helmet'
import { TimelinePage } from './timeline'
import * as Icon from './icons'
import { FocusPage } from './focus'
import { ZonePage, useZoneDepth } from './zone'
import { useStore } from './store'
import { ago, describe, useSyncStatus } from './sync'
import { SUPABASE_ENABLED, currentAccount, onAccountChange } from './supabase'
import { isReadOnly } from './store'
import type { PageId, SpaceId, ViewId } from './types'

/* Is this thing up to date, and where did the last change come from.

   He asked for it after working on the laptop, editing on the phone, and having
   no way to tell whether the two had met. The answer was already in the app, on
   the Settings page, which is exactly where nobody looks to find out whether
   something that should be automatic is working.

   Two facts, one line. Ordinarily it says when the state last reached the
   server. When a change arrived from somewhere else it says so instead, and
   keeps saying so until he writes something here, because "your phone's edit
   landed" is the news and "synced" is the assumption.

   Alert by exception on the phone: at that width the ordinary case is a dot
   with no words, and the words come back the moment there is something to say. */
function SyncPip() {
  const sync = useSyncStatus()
  const { syncOrigin } = useStore()

  const settled = sync.phase === 'synced' || sync.phase === 'off'
  /* A pending or failed push is about THIS device and outranks the news from
     another one: telling him his phone's edit arrived while his own is stuck in
     an outbox would be true and useless. */
  const fromElsewhere = Boolean(syncOrigin) && settled
  const text = fromElsewhere && syncOrigin
    ? `Updated from ${syncOrigin.name} ${ago(syncOrigin.at)}`
    : describe(sync)

  /* The dot answers one question only: is sync healthy. A change arriving from
     his phone is not a warning and not a problem, so it is the same green as an
     ordinary sync and the WORDS carry the difference. The alternative was a
     fifth colour for "news", and `.status-dot.manual` is already redefined
     further down the stylesheet to the same amber as `warn`, so reusing it
     would have made "your phone's edit landed" look exactly like "still
     saving". */
  const tone = sync.phase === 'off' ? 'off'
    : sync.phase === 'error' || sync.phase === 'offline' ? 'alert'
    : sync.phase === 'saving' || sync.phase === 'waiting' ? 'warn'
    : 'connected'

  /* Quiet on a phone means the dot alone. News from another device is exactly
     the case that has earned its words, so it is never quiet. */
  const quiet = tone === 'connected' && !fromElsewhere

  return (
    <span className="syncpip" data-quiet={quiet || undefined} title={sync.detail || text}>
      <span className={`status-dot ${tone}`} />
      <span className="syncpip-text">{text}</span>
    </span>
  )
}

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

/* The menu was identical everywhere, and mostly still is: what changes between
   spaces is the CONTENT of each page, not which pages exist.

   Calendar is the first and so far only exception, and it earns it. It is not
   a view of his data with a filter on it, it is a read of somebody else's
   system that exists for exactly one workspace, and showing an empty Calendar
   in Personal would be the app advertising a feature that cannot work there. */
const NAV: { id: PageId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'plan', label: 'Plan' },
  /* One tab for both, on his instruction 2026-08-26. Goals here are mostly a
     reflection over habits, so they switch inside the page on a pill pair
     rather than sitting in the menu as a second destination. Routines left the
     menu earlier for the same kind of reason. Every address still resolves, so
     a bookmark and every existing setPage('goals') still land somewhere real:
     see the redirect where the pages are chosen. */
  { id: 'habits', label: 'Habits & Goals' },
  { id: 'board', label: 'Why’s' },
  /* Timeline sits LAST of the real pages, immediately before Calendar, on his
     instruction (2026-08-27). It is where he goes to look back, so it belongs
     at the end of the row rather than in the middle of the working tabs. */
  { id: 'timeline', label: 'Timeline' },
  /* Apps left the menu on his instruction (2026-08-27): seven icons and an
     otherwise empty page did not earn a tab next to Habits and Goals. It is
     a header dropdown now, next to Note and Yesterday -- see AppsShelf
     below. The address still resolves so a bookmark still lands somewhere
     real, same as Routines above. */
  /* Assistant left the menu the same day, for the same reason a page he
     starts something from belongs to the header, not a tab he has to
     switch into -- it is its own primary button now, next to the Zone. */
]

/* Calendar used to be Big Time only, on the argument that it reads somebody
   else's system and an empty Calendar in Personal would advertise something
   that could not work there. He overruled that on 2026-08-27: one calendar,
   reachable from every workspace, because the day does not change when he
   switches which part of his life he is looking at.

   There is still exactly ONE feed and ONE page. This is not a calendar per
   workspace; it is the same calendar, no longer hidden behind a workspace.

   It stays LAST in the row deliberately. Every other tab keeps the position it
   has had, so nothing he already reaches for by muscle memory moves. */
function navFor(_view: ViewId): { id: PageId; label: string }[] {
  return [...NAV, { id: 'calendar' as PageId, label: 'Calendar' }]
}


/* THE PAGE ROW REVEALS ON HOVER, on his instruction (2026-08-26): the second
   row is hidden, the WHOLE header is the trigger, and leaving both waits a beat
   before it goes.

   Why the whole header and not a control: an earlier draft put a 30px arrow
   next to the workspace pills. Reaching Plan then cost two pointer moves and a
   wait, where a visible row costs one move to a large target. Making the header
   itself the trigger means no aiming at all, and the row returns to the exact
   place it already lives, so nothing he knows changes.

   The grace period is what stops it flickering when he crosses the header on
   the way somewhere else. He asked for a second; two felt slow to him.

   Focus opens it too, or the row is unreachable from the keyboard. */
const NAV_HIDE_MS = 1000

function useNavReveal() {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const clear = () => { if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined } }
  useEffect(() => clear, [])
  return {
    open,
    show: () => { clear(); setOpen(true) },
    hideSoon: () => { clear(); timer.current = window.setTimeout(() => setOpen(false), NAV_HIDE_MS) },
  }
}

function PageNav({
  tabs, page, setPage, onMouseEnter,
}: {
  tabs: { id: PageId; label: string }[]
  page: PageId
  setPage: (p: PageId) => void
  onMouseEnter?: () => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [page])
  return (
    <nav className="nav" aria-label="Pages" onMouseEnter={onMouseEnter}>
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={page === t.id ? activeRef : undefined}
          className="nav-tab"
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
        <Icon.Menu size={18} />
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
  const { space, view, setView, page, setPage, tasks, routines, goals, habits, markHabitDaysOn, setFocusAppId } = useStore()
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

  const tabs = navFor(view)

  /* Signed out, nothing is backed up and the phone shows a different day. That is
     worth a mark on the gear rather than a banner across the top. */
  const [needsSignIn, setNeedsSignIn] = useState(false)
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    void currentAccount().then((a) => setNeedsSignIn(!a))
    return onAccountChange((a) => setNeedsSignIn(!a))
  }, [])
  /* The once-a-day Hevy sync is GONE, on his instruction, 2026-08-26: "the
     23:00 sync doesn't work, so I would kill that automatic sync and put there
     a button". It only ever fired if the app happened to be open and focused
     inside that one hour, which on most days it was not, so the habit was
     filled by him going to Settings and pressing Sync now. A scheduled job
     that runs on a coin flip is worse than no job: it makes the data look
     automatic while quietly leaving days out.

     The pull now lives on the gym habit's own row (src/hevysync.tsx) and in
     Settings, and both call the same syncHevy. */
  /* How far into the running block he is, for the Zone's water. Read here
     rather than inside the room because the shell is what paints it. */
  const zoneDepth = useZoneDepth()
  /* Where pressing The Zone a second time puts him: the page he was on when
     he walked in. A ref, not state, because nothing renders from it and it
     must not cause one. Today is the floor, for a reload that lands straight
     in the room with no history behind it. */
  /* HUD mode. Per device rather than synced: it is how he wants THIS screen to
     look right now, not a fact about his life, and the laptop and the phone can
     reasonably disagree about it. Read on the first render so the mode is
     already right when the shell paints, with no flash of paper first. */
  const [hud, setHud] = useState<boolean>(() => {
    try { return localStorage.getItem('mc:hud') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('mc:hud', hud ? '1' : '0') } catch { /* private mode */ }
  }, [hud])

  const nav = useNavReveal()
  const backFromZone = useRef<PageId>('today')
  useEffect(() => { if (page !== 'zone') backFromZone.current = page }, [page])

  return (
    /* The Zone is a room, not a dark card: the shell carries the class so the
       header goes under the water with everything else, instead of leaving a
       warm-paper bar sitting on top of it. --depth rides along here too,
       because this is the element that paints the water; set any lower down
       it could never reach this rule, and the room never deepened at all. */
    <div
      className={`shell${page === 'zone' ? ' in-zone' : ''}${hud ? ' is-hud' : ''}`}
      style={page === 'zone' ? ({ '--depth': zoneDepth } as React.CSSProperties) : undefined}
    >
      <a className="skiplink" href="#main">Skip to the page</a>
      {/* Hover anywhere in here, header or row, and the row stays. Leaving both
          starts the grace period. Touch never fires these, which is correct: a
          phone has no nav row at all, it has the hamburger. */}
      <div
        className={`topstick${nav.open ? ' is-navopen' : ''}`}
        onMouseLeave={nav.hideSoon}
        onFocus={nav.show}
        onBlur={nav.hideSoon}
      >
      <header className="topbar">
        {/* Only this cluster (name, workspace) triggers the reveal on hover,
            on his instruction: the right side (sync, Assistant, Zone, the
            helmet, Note, Yesterday, the page menu, Settings) is stuff he
            reaches for directly, not a place a passing cursor should open a
            second row underneath. Leaving here still bubbles up to the
            topstick's onMouseLeave same as before, so once open, moving the
            cursor anywhere else in the header -- this cluster, the right
            side, the row itself -- keeps it open; only this cluster can
            start it. Keyboard focus is untouched: tabbing to any control up
            here still reveals the row, since a keyboard user has no hover
            preview to rely on for orientation. */}
        <div className="topbar-left" onMouseEnter={nav.show}>
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
        </div>
        <div className="topbar-right">
          {/* Status before actions, and not in the Zone: that room is one thing
              at a time and a sync line is not the thing. */}
          {page !== 'zone' && <SyncPip />}
          {/* First in the group and next to the Zone, on his instruction: these
              two are where he actually starts something, so they carry the
              same vibrant weight and stand apart from the plain ghost buttons
              beside them. */}
          <button
            className={`btn btn-primary${page === 'assistant' ? ' is-on' : ''}`}
            onClick={() => setPage('assistant')}
            aria-pressed={page === 'assistant'}
            title="Assistant"
            aria-label="Assistant"
          >
            <Icon.Waveform size={18} />
            <span className="btn-label">Assistant</span>
          </button>
          {/* The one thing running, full screen. Filled with the accent so it
              reads as the button that starts something, not a place he browses.
              It is a toggle: pressing it again puts him back on the page he
              walked in from, because the room has no close of its own and he
              was leaving it by pressing Note to get out. */}
          <button
            className={`btn btn-primary${page === 'zone' ? ' is-on' : ''}`}
            onClick={() => setPage(page === 'zone' ? backFromZone.current : 'zone')}
            aria-pressed={page === 'zone'}
            title={page === 'zone' ? 'Leave the Zone' : 'The Zone'}
            aria-label={page === 'zone' ? 'Leave the Zone' : 'The Zone'}
          >
            <Icon.Focus size={18} />
            <span className="btn-label">The Zone</span>
          </button>
          {/* The helmet. Its eyes light when the mode is on, so the icon IS the
              state and the button needs no second indicator. */}
          <button
            className={`btn btn-ghost btn-helmet${hud ? ' is-on' : ''}`}
            onClick={() => setHud((v) => !v)}
            aria-pressed={hud}
            title={hud ? 'Back to paper' : 'HUD mode'}
            aria-label={hud ? 'Turn HUD mode off' : 'Turn HUD mode on'}
          >
            <Helmet lit={hud} />
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
            <Icon.Note size={18} />
            <span className="btn-label">Note</span>
          </button>
          {/* Bills, ported from Compass (2026-09-01): the same shape as Note
              beside it, on his instruction -- not a workspace page, not
              filtered by the space switcher, reached from the header only. */}
          <button
            className={`btn btn-ghost${page === 'bills' ? ' is-on' : ''}`}
            onClick={() => setPage('bills')}
            aria-pressed={page === 'bills'}
            title="Bills"
            aria-label="Bills"
          >
            <Icon.Wallet size={18} />
            <span className="btn-label">Bills</span>
          </button>
          {/* Apps, a shelf now rather than a page: seven icons never filled a
              tab's worth of room, and this is the same one-click-from-anywhere
              shape as Note and Yesterday beside it. Opening a framed app still
              lands on the Apps page -- it needs the room -- so the item hands
              the choice over via focusAppId rather than doing it inline. */}
          <Dropdown
            label="Apps"
            className="apps-shelf-menu"
            trigger={({ onClick, open }) => (
              <button className={`btn btn-ghost${page === 'apps' ? ' is-on' : ''}`} onClick={onClick} aria-expanded={open} aria-label="Apps" title="Apps">
                <Icon.AppsGrid size={18} />
                <span className="btn-label">Apps</span>
              </button>
            )}
          >
            {APPS.map((a) => (
              a.external ? (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" role="menuitem">
                  <span aria-hidden="true">{a.icon}</span>
                  {a.name}
                </a>
              ) : (
                <button key={a.id} role="menuitem" onClick={() => { setFocusAppId(a.id); setPage('apps') }}>
                  <span aria-hidden="true">{a.icon}</span>
                  {a.name}
                </button>
              )
            ))}
          </Dropdown>
          {/* Assistant left this list the same way the Zone did: it is its own
              button now, not a tab, so the picker has nothing to say about it. */}
          {page !== 'zone' && page !== 'assistant' && <PhonePages tabs={tabs} page={page} setPage={setPage} />}
          <button
            className={`btn btn-ghost${page === 'settings' ? ' is-on' : ''}${needsSignIn ? ' has-dot' : ''}`}
            onClick={() => setPage('settings')}
            aria-label={needsSignIn ? 'Settings, sync is off' : 'Settings'}
            aria-pressed={page === 'settings'}
          >
            <Icon.Settings size={18} />
          </button>
        </div>
      </header>

      {/* Today, Plan, Habits… none of them apply once he has actually walked
          into the room. Keeping them lit alongside a running countdown was
          the exact "still just a dashboard page" problem the room exists to
          not be. */}
      {/* The row sits 8px below the header (the drawer travel distance), and
          that gap is not part of topstick's own box -- an absolutely
          positioned child doesn't extend its parent's layout rect. Crossing
          it on the way down from the header genuinely leaves topstick for a
          moment, which starts the hide timer, and nothing was cancelling it
          again once the pointer landed on the row itself: it closed a second
          later out from under a cursor that never actually left it. */}
      {page !== 'zone' && <PageNav tabs={tabs} page={page} setPage={setPage} onMouseEnter={nav.show} />}
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
        {page === 'timeline' && <TimelinePage />}
        {page === 'focus' && <FocusPage />}
        {page === 'board' && <BoardPage />}
        {page === 'apps' && <AppsPage />}
        {page === 'calendar' && <CalendarPage />}
        {page === 'assistant' && <AssistantPage />}
        {page === 'notes' && <NotesPage />}
        {page === 'bills' && <BillsPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'brand' && <BrandPage />}
        {page === 'day' && <DayPage />}
        {page === 'zone' && <ZonePage />}
        </PageBoundary>
      </main>

    </div>
  )
}
