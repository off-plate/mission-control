import { haptic } from './haptic'
import { flushSync } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUPABASE_ENABLED, deleteRemoteState, claimInbox, onAccountChange, loadRemoteState, readOutreachEvents, readProspectSheet, stampOutreachEvents, stampProspectSheet } from './supabase'
import { outbox } from './sync'
import { estimateTask } from './ai'
import { estimateFor } from './estimate'
import { deviceId, deviceName, mergeStates } from './sync-merge'
import { todayKey } from './store/shared'
import { type Undoable, useUndo } from './store/undo'
import { useGraveyard } from './store/graveyard'
import { useNotesSlice } from './store/notes'
import { useTwoLivesSlice } from './store/twolives'
import { useIdeaBoardSlice } from './store/ideaboard'
import { useRemindersSlice } from './store/reminders'
import { usePromptsSlice } from './store/prompts'
import { usePeopleSlice } from './store/people'
import { useProspectsSlice } from './store/prospects'
import { useInvoicesSlice } from './store/invoices'
import { useInvoiceCloud } from './invoicecloud'
import type { OutreachEvent, SheetRow } from './prospectcalc'
import { useGymSlice } from './store/gym'
import { useConnectionsSlice } from './store/connections'
import { useCoachSlice } from './store/coach'
import { useAssistantSlice } from './store/assistant'
import { useGrowthSlice } from './store/growth'
import { usePlannerSlice } from './store/planner'
import { useLedgerSlice } from './store/ledger'
import { isoWeekKey, localDateKey } from './util'
import { isSpace } from './types'
import { foldSpaces } from './foldspaces'
import type { Invoice, InvoiceClient, InvoiceProfile, PageId, SpaceId, Task, ViewId } from './types'
import { BACKUP_KEY, STORAGE_KEY, type ActiveFocus, type PersistedState, type Store } from './store/state'
import { isReadOnly, loadPersisted } from './store/load'
import { routeFromHash } from './store/route'
import { Ctx, useStore } from './store/context'
import { UndoToast } from './store/undotoast'

/* store.tsx is the provider: it composes one hook per domain (src/store/),
   saves the result, and merges in whatever arrives from another tab or
   device. The shape of the store is in store/state.ts, the loader and its
   migrations in store/load.ts. These re-exports keep every existing
   `from './store'` import working. */
export { STORAGE_KEY, BACKUP_KEY, isReadOnly, useStore }
export type { ActiveFocus, Undoable }

/* Two blobs are the same work if they differ only in when they were saved.
   Used both to stop two tabs answering each other's saves forever, and to decide
   whether this device is holding anything the server has not got. */
function stripDates(j: string): string {
  try {
    const o = JSON.parse(j) as Record<string, unknown>
    delete o.savedAt
    /* Who wrote it is not part of the work either. Leaving it in would make
       every save differ from the last one by a fresh timestamp, and the two
       things this comparison protects, two tabs answering each other forever
       and a device pushing what the server already has, would both come back. */
    delete o.lastWrite
    return JSON.stringify(o)
  } catch { return j }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const [storageFull, setStorageFull] = useState(false)
  const connectionsSlice = useConnectionsSlice(persisted)
  const { ideas, setIdeas } = connectionsSlice
  const coachSlice = useCoachSlice(persisted)
  const { coachSessions, setCoachSessions } = coachSlice
  /* The one Pomodoro block running right now, if any -- separate from
     focusSessions, which only ever holds FINISHED blocks. PomodoroProvider
     owns the countdown itself (still its own localStorage clock, see
     pomodoro.tsx) and mirrors it here so a block started on one device shows
     up, live, on every other: the phone that started it, the Mac it syncs to. Whichever side
     saved most recently wins outright (see mergeStates -- this field isn't in
     ALL_KEYS, so it follows the newer blob's savedAt like `plan`/`review`
     used to before those needed their own union rules); a single running
     timer has exactly one truth at a time, so last-write-wins is correct
     here, not a compromise. */
  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(persisted?.activeFocus ?? null)
  /* What he deliberately deleted. Every collection is united across devices
     now, so a row missing here is only "not seen yet" unless something says
     otherwise: this is that something. Without it, deleting a task on the
     laptop lets any phone that still holds the row put it back. */
  /* An empty link is a removal, not a blank entry, so the key does not linger
     and win a merge against a device that still holds the real one. */
  const [spaceGuessed] = useState<number>(persisted?.spaceGuessed ?? 0)
  const [lastRollDay] = useState<string | undefined>(persisted?.lastRollDay)
  const remoteSaveTimer = useRef<number | undefined>(undefined)
  const latestJson = useRef<string>('')
  const localSaveTimer = useRef<number | undefined>(undefined)
  const pendingSave = useRef<(() => void) | null>(null)
  const firstSave = useRef(true)
  /** Runs the save the last state change scheduled, now, if it has not run. */
  const flushLocal = () => {
    window.clearTimeout(localSaveTimer.current)
    const run = pendingSave.current
    pendingSave.current = null
    run?.()
  }
  /* Where the copy on screen last came from, when that was somewhere else.
     Deliberately NOT persisted: it answers "did my phone's edit land here yet",
     which is a question about this device right now, and a stored answer would
     survive into a session where it is no longer true.

     It is set when a change actually arrives from another device and cleared
     the moment he edits anything here, so the topbar reads "updated from your
     iPhone" until he writes something himself, then goes back to plain. */
  const [syncOrigin, setSyncOrigin] = useState<{ name: string; at: number } | null>(null)
  /* Set by applyExternal so the save effect it triggers can tell "this arrived
     from elsewhere" from "he typed something", which look identical from inside
     a state update. */
  const fromExternal = useRef(false)
  /* The view and the write-space survive a reload, kept out of the synced blob on
     purpose so working on the phone does not flip the desktop. All is the default:
     the whole point is that nothing hides in a profile he did not open. */
  const [view, setViewState] = useState<ViewId>(() => {
    try {
      const v = localStorage.getItem('mc-view')
      return v === 'work' || v === 'personal' || v === 'all' ? v : 'all'
    } catch { return 'all' }
  })
  const [writeSpace, setWriteSpace] = useState<SpaceId>(() => {
    try {
      const s = localStorage.getItem('mc-space')
      return s === 'work' || s === 'personal' ? s : 'personal'
    } catch { return 'personal' }
  })
  // In a single space, new things land there. In All he picks, and the pick sticks.
  const space: SpaceId = isSpace(view) ? view : writeSpace
  const [route, setRoute] = useState(routeFromHash)
  const { page, day: dayKey } = route
  const setPageState = (p: PageId) => setRoute({ page: p, day: null })
  /* Undo and the graveyard are genuinely cross-domain -- every slice that
     deletes something calls armUndo/bury/digUp -- so they are composed in
     here, ahead of the domains that need them, rather than owned by any
     one of those domains. */
  const { undoable, armUndo, undoDelete, dismissUndo } = useUndo()
  const { graveyard, setGraveyard, bury, digUp } = useGraveyard(persisted?.graveyard)
  const twoLivesSlice = useTwoLivesSlice(persisted, { bury, digUp })
  const { twoLives, setTwoLivesRaw, setTwoLives, reels, setReelsRaw, setReels, tunes, setTunesRaw, setTunes, reelFiles, setReelFilesRaw, setReelFile } = twoLivesSlice
  const notesSlice = useNotesSlice(persisted, { space, armUndo, bury, digUp })
  const { notes, setNotes, noteFolders, setNoteFolders } = notesSlice
  const ideaBoardSlice = useIdeaBoardSlice(persisted, { armUndo, bury, digUp })
  const { ideaBoard, setIdeaBoard } = ideaBoardSlice
  const remindersSlice = useRemindersSlice(persisted, { armUndo, bury, digUp })
  const { reminders, reminderLists, setReminders, setReminderLists } = remindersSlice
  const promptsSlice = usePromptsSlice(persisted, { armUndo, bury, digUp })
  const { prompts, setPrompts } = promptsSlice
  const peopleSlice = usePeopleSlice(persisted, { armUndo, bury, digUp })
  const { people, setPeople, personBonds, setPersonBonds, personContacts, setPersonContacts } = peopleSlice
  const prospectsSlice = useProspectsSlice(persisted, { armUndo, bury, digUp })
  const { prospects, setProspects } = prospectsSlice
  /* Emails to and from prospects, found in his Gmail by /eco-sync (Jarvis).
     Runs with every pull, so they land on fresh rows. A missing table or a
     dropped connection just means the next pull tries again. */
  const applyOutreachRef = useRef(prospectsSlice.applyOutreach)
  applyOutreachRef.current = prospectsSlice.applyOutreach
  /* The iPhone shortcuts' inbox (2026-10-17): tasks he added and tasks he
     finished without opening the app. Applied with the app's own addTask and
     logActual, so a finished task gets its time, its ledger row and its focus
     block exactly as if he had ticked it here. A task already done or gone is
     stamped and skipped. Read through a ref: the actions are built further down. */
  const inboxRef = useRef<{ add: Store['addTask']; done: Store['logActual']; tasks: Task[] } | null>(null)
  const inboxBusy = useRef(false)
  const pullInbox = async () => {
    // One pull at a time on this device; claimInbox keeps other devices out.
    if (inboxBusy.current || !inboxRef.current) return
    inboxBusy.current = true
    try {
      const items = await claimInbox()
      const io = inboxRef.current
      for (const it of items ?? []) {
        if (it.op === 'add' && it.title?.trim()) {
          io.add({ title: it.title.trim(), source: 'mc', estimateMin: 0, space: it.space === 'work' ? 'work' : 'personal', list: 'backlog', category: 'quick' })
        } else if (it.op === 'done' && it.task_id) {
          const t = io.tasks.find((x) => x.id === it.task_id)
          if (t && !t.done) io.done(t.id, Math.max(1, Math.round(it.actual_min ?? t.estimateMin ?? 0)))
        }
      }
    } catch { /* next pull */ } finally { inboxBusy.current = false }
  }
  const pullOutreach = async () => {
    try {
      const events = await readOutreachEvents<OutreachEvent>()
      if (events?.length) await stampOutreachEvents(applyOutreachRef.current(events))
    } catch { /* next pull */ }
    /* Then the Sheet itself (his ask, 2026-10-13): every row, every tab. A card
       he deleted here stays deleted. */
    try {
      const sheet = await readProspectSheet<SheetRow>()
      if (!sheet) return
      const dead = new Set(graveyardRef.current.filter((t) => !t.undone).map((t) => t.k))
      applySheetRef.current(sheet.rows ?? [], (id) => dead.has(`prospects:${id}`))
      await stampProspectSheet(sheet.synced_at)
    } catch { /* next pull */ }
  }
  const applySheetRef = useRef(prospectsSlice.applySheetRows)
  applySheetRef.current = prospectsSlice.applySheetRows
  const graveyardRef = useRef(graveyard)
  graveyardRef.current = graveyard
  const gymSlice = useGymSlice(persisted, { armUndo, bury, digUp })
  const { gymGoals, setGymGoals } = gymSlice
  const invoicesSlice = useInvoicesSlice(persisted, { armUndo, bury, digUp })
  const { invoices, setInvoices, invoiceClients, setInvoiceClients, invoiceProfile, setInvoiceProfile } = invoicesSlice
  /* Every invoice row is mirrored into its own Supabase table (invoicecloud.ts). */
  type Upd<T> = (f: (prev: T[]) => T[]) => void
  useInvoiceCloud({
    invoices, setInvoices: setInvoices as unknown as Upd<Invoice>, invoiceClients, setInvoiceClients: setInvoiceClients as unknown as Upd<InvoiceClient>,
    invoiceProfile, setInvoiceProfile: setInvoiceProfile as unknown as Upd<InvoiceProfile>,
    isBuried: (k) => graveyardRef.current.some((t) => t.k === k && !t.undone),
  })
  const growthSlice = useGrowthSlice(persisted, { space, armUndo, bury, digUp, setPageState })
  const {
    habits, setHabits, goals, setGoals, routines, setRoutines,
    records, setRecords, removedSeeds, setRemovedSeeds,
    habitLog, setHabitLog, editHabitLog, routineLog, setRoutineLog, slips, setSlips,
    stepLog, setStepLog, dayLog, setDayLog, stepTicks, setStepTicks,
    dailyOpen, dailyDone, setDailyDone, dailySkipped, setDailySkipped, plan, setPlan, review, setReview,
  } = growthSlice
  const [openProjectId, setOpenProject] = useState<string | null>(null)
  const plannerSlice = usePlannerSlice(persisted, { armUndo, bury, digUp, openProjectId, setOpenProject, setPlan })
  const { tasks, setTasks, projects, setProjects } = plannerSlice
  /* Every task without an estimate gets one, as it appears. The model reads
     the title; the local rule of thumb only catches a failed call. One at a
     time, so a pasted list never bursts the provider; each id is tried once a
     session, so a failure cannot loop. */
  const autoEstimated = useRef(new Set<string>())
  const estimating = useRef(false)
  useEffect(() => {
    if (estimating.current) return
    const next = tasks.find((t) => !t.done && !t.subtasks?.length && !t.estimated && !autoEstimated.current.has(t.id))
    if (!next) return
    estimating.current = true
    autoEstimated.current.add(next.id)
    void (async () => {
      let min: number
      try { min = (await estimateTask(next.title, next.category)) ?? estimateFor(next.title, next.category).minutes }
      catch { min = estimateFor(next.title, next.category).minutes }
      plannerSlice.setEstimate(next.id, min)
      estimating.current = false
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])
  const { assistantLog, setAssistantLog } = useAssistantSlice(persisted)
  const setSpace = (s: SpaceId) => setWriteSpace(s)
  const setView = (v: ViewId) => { setViewState(v); if (isSpace(v)) setWriteSpace(v); setOpenProject(null) }
  /* A record belongs to exactly one space. The old form treated a space-less row
     as belonging to all three at once, so the same ledger row was counted in
     Personal AND Work and every time-saved figure was wrong. Rows
     written before spaces existed are stamped on load instead. */
  const inView = (s?: SpaceId) => view === 'all' || s === view
  const [editing, setEditing] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [focusRoutineId, setFocusRoutineId] = useState<string | null>(null)
  const [focusAppId, setFocusAppId] = useState<string | null>(null)
  const [noteToOpen, setNoteToOpen] = useState<string | null>(null)
  /* Finished work: the ledger, the focus blocks, and the completions that
     write both (store/ledger.ts). After the planner and growth slices, since
     it reads tasks, habits and goals from them. */
  const ledgerSlice = useLedgerSlice(persisted, {
    space, inView, tasks, setTasks, habits, setHabits, habitLog, setHabitLog, editHabitLog,
    goals, bumpGoal: growthSlice.bumpGoal, armUndo, bury, digUp,
  })
  const { ledger, setLedger, focusSessions, setFocusSessions, weekLedger, savedMin, accuracyPct, autoFrom, creditGoal, logFocusOn } = ledgerSlice

  useEffect(() => {
    /* Business mode owns the accent while it is on (App.tsx). */
    if (document.documentElement.getAttribute('data-mode') !== 'business') document.documentElement.setAttribute('data-space', view)
    try {
      localStorage.setItem('mc-view', view)
      localStorage.setItem('mc-space', writeSpace)
    } catch { /* noop */ }
  }, [view, writeSpace])

  /* Date watcher: if the app sits open across midnight (or a laptop wakes up
     the next morning), reload once so routines, habits and "today" all roll
     over to the new day instead of showing yesterday frozen in place.

     Only while the tab is actually VISIBLE. His report (2026-09-06): away
     since Friday, opened Sunday, no "3 things came back" banner. The interval
     used to fire unconditionally, so the desktop build sitting open and
     backgrounded over the weekend reloaded itself at Saturday's midnight with
     nobody looking, ran roll() right then, and stamped plan.returnedOn to
     Saturday. By Sunday that record no longer matched today and the banner
     (gated on returnedOn === today, on his instruction: said once, on the day
     it happened) stayed silent -- correctly silent about a day he never saw.
     Gating the reload on visibility means a backgrounded app does nothing at
     midnight; roll() only runs once, when he actually looks, spanning the
     whole gap in one pass and landing the banner on the day he is there for
     it. An app that is genuinely open and visible across midnight is
     unaffected -- the interval still catches it within the minute. */
  useEffect(() => {
    const bootDay = localDateKey()
    const check = () => { if (document.visibilityState === 'visible' && localDateKey() !== bootDay) location.reload() }
    const t = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setPage = (p: PageId) => {
    /* Every tab in the nav is a top-level destination, Plan included: the ONLY
       way into a project's Plan is enterProject, below. Without this, clicking
       Plan while standing inside a project did nothing (already on 'plan'),
       which read as the nav lying about where he was and left no fast way out. */
    const swap = () => {
      setOpenProject(null)
      location.hash = `/${p}`
      setRoute({ page: p, day: null })
      window.scrollTo({ top: 0 })
    }
    /* A short crossfade between pages, as an iOS tab bar does (2026-10-26),
       instead of the page snapping. Skipped for the page he is already on,
       for reduced motion, and where the browser has no view transitions. */
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
    if (p !== route.page && doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(() => flushSync(swap))
    } else swap()
  }
  /** The one door into a project's Plan. Order matters: setPage clears
   *  openProjectId as part of leaving wherever he was, so the id has to be set
   *  AFTER, not before, or it would be wiped by its own navigation. */
  const enterProject = (id: string) => {
    setPage('plan')
    setOpenProject(id)
  }
  /** Open one day of the record. Today goes to Today, which is the live one. */
  const openDay = (iso: string) => {
    if (iso === todayKey()) { setPage('today'); return }
    location.hash = `/day/${iso}`
    setRoute({ page: 'day', day: iso })
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    // Refuse to write over state a newer build saved.
    if (isReadOnly()) return

    const state: PersistedState = {
      version: 3, tasks, habits, goals, projects, ledger, plan, review, assistantLog, coachSessions, routines, ideas,
      notes, noteFolders, ideaBoard, reminders, reminderLists, prompts, people, personBonds, personContacts, prospects, gymGoals, invoices, invoiceClients, invoiceProfile,
      savedAt: Date.now(), lastWrite: { dev: deviceId(), name: deviceName(), at: Date.now() },
      weekKey: isoWeekKey(), records, fixes: 1, schema: STORAGE_KEY, removedSeeds, focusSessions,
      habitLog, routineLog, slips, stepLog, stepTicks, dayLog, dailyDone, dailySkipped, spaceGuessed, graveyard, twoLives, reels, tunes, reelFiles, lastRollDay: lastRollDay ?? localDateKey(),
      activeFocus,
    }
    /* His own writing is the one thing that makes "updated from your iPhone"
       stale, so it is what takes the line down. The save that applyExternal
       itself triggers is not his writing, and says so through the flag. */
    if (fromExternal.current) fromExternal.current = false
    else setSyncOrigin(null)
    /* The write itself waits for a pause. Stringifying and storing the whole
       blob is several milliseconds once his data is in it, and typing in a note
       ran it on every keystroke, which is where the lag in Notes came from.
       Anything that reads latestJson calls flushLocal() first, and so does the
       page hiding, so no reader ever sees an older blob than memory holds. */
    pendingSave.current = () => {
      const json = JSON.stringify(state)
      latestJson.current = json
      try {
        localStorage.setItem(STORAGE_KEY, json)
        if (storageFull) setStorageFull(false)
      } catch {
        /* This used to be swallowed. With Supabase off, a full quota means every edit from here on
           is lost on reload and nothing on screen says so. Measured after importing one city of
           leads: the state and its backup mirror together reach 3.8 MB of a ~5.2 MB quota, so this
           is a reachable state rather than a theoretical one. */
        if (!storageFull) setStorageFull(true)
      }
      /* Mirror to Supabase when configured, debounced so rapid edits collapse into
         one write. The outbox owns the write from here: a failure is retried on a
         backoff and on reconnect rather than dropped, and the intent to sync is
         persisted so quitting while offline does not lose it. */
      if (SUPABASE_ENABLED) {
        window.clearTimeout(remoteSaveTimer.current)
        remoteSaveTimer.current = window.setTimeout(() => { outbox.push(json) }, 800)
      }
    }
    /* The save on load goes at once: it carries migrations and the unsent
       marker, and nothing is being typed yet to make it expensive. */
    if (firstSave.current) { firstSave.current = false; flushLocal(); return }
    window.clearTimeout(localSaveTimer.current)
    localSaveTimer.current = window.setTimeout(flushLocal, 300)
  }, [tasks, habits, goals, projects, ledger, plan, review, assistantLog, coachSessions, routines, ideas, notes, noteFolders, records, removedSeeds, focusSessions, habitLog, routineLog, slips, stepLog, stepTicks, dayLog, dailyDone, dailySkipped, graveyard, twoLives, reels, tunes, reelFiles, ideaBoard, reminders, reminderLists, prompts, people, personBonds, personContacts, prospects, gymGoals, invoices, invoiceClients, invoiceProfile, activeFocus])

  /* ---- state that arrived from somewhere else ----
     Another tab of this browser, or this account on another device. Merged in,
     never pasted over: what is in memory here is one side of the merge and his
     work on this device survives it. Applying it makes the save effect fire,
     which is how the merged truth goes back out to everyone. */
  const applyExternal = (incoming: string) => {
    flushLocal()
    const mine = latestJson.current || localStorage.getItem(STORAGE_KEY) || ''
    if (!incoming || incoming === mine) return
    const merged = mine ? mergeStates(mine, incoming) : incoming
    let p: PersistedState
    try { p = JSON.parse(merged) as PersistedState } catch { return }
    if (p.schema !== STORAGE_KEY) return
    foldSpaces(p as unknown as Record<string, unknown>, localDateKey())
    /* Nothing new once the dates are set aside: stop, or two tabs would answer
       each other's saves forever. */
    if (mine && stripDates(merged) === stripDates(mine)) return
    /* Something genuinely arrived. Read the stamp off the INCOMING blob rather
       than the merged one: the merge keeps the newer side's stamp, which on a
       pull that this device wins is this device, and "updated from the Mac" is
       not news to the Mac. */
    try {
      const inc = JSON.parse(incoming) as PersistedState
      const w = inc.lastWrite
      if (w && w.dev && w.dev !== deviceId()) setSyncOrigin({ name: w.name, at: w.at })
    } catch { /* a stamp is a nicety; never let it stop the merge */ }
    fromExternal.current = true
    if (p.tasks) setTasks(p.tasks)
    if (p.habits) setHabits(p.habits)
    if (p.goals) setGoals(p.goals)
    if (p.projects) setProjects(p.projects)
    if (p.routines) setRoutines(p.routines)
    if (p.ideas) setIdeas(p.ideas)
    /* Arrays, not truthiness: deleting the last note on the other device has to
       arrive here too, and an empty array is a real answer. */
    if (Array.isArray(p.notes)) setNotes(p.notes)
    if (Array.isArray(p.noteFolders)) setNoteFolders(p.noteFolders)
    if (Array.isArray(p.ideaBoard)) setIdeaBoard(p.ideaBoard)
    if (Array.isArray(p.reminders)) setReminders(p.reminders)
    if (Array.isArray(p.reminderLists)) setReminderLists(p.reminderLists)
    if (Array.isArray(p.prompts)) setPrompts(p.prompts)
    if (Array.isArray(p.people)) setPeople(p.people)
    if (Array.isArray(p.personBonds)) setPersonBonds(p.personBonds)
    if (Array.isArray(p.personContacts)) setPersonContacts(p.personContacts)
    if (Array.isArray(p.prospects)) setProspects(p.prospects)
    if (Array.isArray(p.gymGoals)) setGymGoals(p.gymGoals)
    if (Array.isArray(p.invoices)) setInvoices(p.invoices)
    if (Array.isArray(p.invoiceClients)) setInvoiceClients(p.invoiceClients)
    if (Array.isArray(p.invoiceProfile)) setInvoiceProfile(p.invoiceProfile)
    if (p.ledger) setLedger(p.ledger)
    if (p.focusSessions) setFocusSessions(p.focusSessions)
    if (p.habitLog) setHabitLog(p.habitLog)
    if (p.routineLog) setRoutineLog(p.routineLog)
    if (p.slips) setSlips(p.slips)
    if (p.stepLog) setStepLog(p.stepLog)
    if (p.dayLog) setDayLog(p.dayLog)
    if (Array.isArray(p.stepTicks)) setStepTicks(p.stepTicks)
    /* The latest day either way: a review walked on the phone must not be
       re-offered on the laptop, and a skip must not undo a walk. */
    if (p.dailyDone && (!dailyDone || p.dailyDone > dailyDone)) setDailyDone(p.dailyDone)
    if (p.dailySkipped && (!dailySkipped || p.dailySkipped > dailySkipped)) setDailySkipped(p.dailySkipped)
    if (p.coachSessions) setCoachSessions(p.coachSessions)
    if (p.assistantLog) setAssistantLog(p.assistantLog)
    if (p.plan) setPlan(p.plan)
    if (p.review) setReview(p.review)
    if (p.records) setRecords(p.records)
    if (p.removedSeeds) setRemovedSeeds(p.removedSeeds)
    if (p.graveyard) setGraveyard(p.graveyard)
    if (p.twoLives) setTwoLivesRaw(p.twoLives)
    /* An array, not truthiness: clearing the library on one device has to
       arrive here too, and an empty list is a real answer. */
    if (Array.isArray(p.reels)) setReelsRaw(p.reels)
    if (Array.isArray(p.tunes)) setTunesRaw(p.tunes)
    if (p.reelFiles) setReelFilesRaw(p.reelFiles)
    /* `!== undefined`, not truthiness: a remote stop (null) has to arrive here
       too, same reasoning as reels/tunes above -- "nothing running" is a real
       answer, not "no opinion". */
    if (p.activeFocus !== undefined) setActiveFocus(p.activeFocus ?? null)
  }
  /* applyExternal itself is a plain closure rebuilt every render (it reads
     dailyDone/dailySkipped by value, not by ref) but the two effects below
     now mount once and never rebuild. Route them through a ref that's kept
     current every render, so they always call this render's applyExternal
     instead of freezing the one from mount. */
  const applyExternalRef = useRef(applyExternal)
  applyExternalRef.current = applyExternal

  /* Another tab of the same browser. It writes localStorage; this fires there
     and nowhere else, which is exactly the signal needed.

     Empty deps on purpose: this listener is registered once, for the life of
     the provider. It used to have no deps array at all, which meant React
     tore it down and re-added it on every render -- harmless here since
     addEventListener is idempotent per-instance, but see the pull effect
     below for why that pattern is not always free. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || isReadOnly()) return
      applyExternalRef.current(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /* Another device. A tab left open all afternoon held a copy of the morning
     and would eventually push it; now it catches up whenever he looks at it,
     and once a minute while he is looking.

     Found 2026-09-04: this had no deps array, so StoreProvider re-rendering
     for ANY reason (every keystroke in a note, every habit tick) tore the
     interval down and started a fresh one -- the 60s pull almost never
     survived long enough to fire, and the in-flight pull's result was
     discarded by the `if (stop) return` on teardown. Empty deps now, so this
     sets up exactly once. isReadOnly() can flip true after mount (loading a
     blob from a newer app version), so it's checked fresh inside pull()
     itself rather than only once here at setup. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    let stop = false
    const pull = async () => {
      if (isReadOnly() || document.visibilityState !== 'visible') return
      const remote = await loadRemoteState()
      if (stop) return
      if (remote) applyExternalRef.current(remote)
      void pullOutreach()
      /* And the other direction. Without this, work done offline never leaves the
         device: applyExternal finds local is already a superset of the stale
         remote, changes no state, and so never fires the save effect. The device
         stayed correct and the server stayed behind, silently, until he happened
         to edit something else while connected. */
      flushLocal()
      const mine = latestJson.current
      if (!mine) return
      const united = remote ? mergeStates(mine, remote) : mine
      if (!remote || stripDates(united) !== stripDates(remote)) outbox.push(mine)
    }
    const onWake = () => { void pull() }
    /* Pull to refresh on Today: the same pull, with the orb saving meanwhile. */
    const onRefresh = () => { void outbox.during(pull()) }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    window.addEventListener('mc:refresh', onRefresh)
    const id = window.setInterval(onWake, 60000)
    return () => {
      stop = true
      window.removeEventListener('mc:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
      window.clearInterval(id)
    }
  }, [])

  /* The shortcuts' inbox has its own quick loop (2026-10-18). It used to ride
     the full pull, which never runs on page load and only every 60 s, so a
     refresh restarted the wait and a shortcut task took minutes to show. Now:
     on load as soon as the session is there, on every return to the tab, and
     every 15 s while the app is on screen. An empty claim is one tiny update. */
  useEffect(() => {
    if (!SUPABASE_ENABLED) return
    const tick = () => { if (document.visibilityState === 'visible') void pullInbox() }
    const first = window.setTimeout(tick, 1500)
    const off = onAccountChange((a) => { if (a) tick() })
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    const id = window.setInterval(tick, 15000)
    return () => {
      window.clearTimeout(first); off()
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
      window.clearInterval(id)
    }
  }, [])

  /* The auto pass follows the sessions: history that predates the rule, blocks
     edited elsewhere, or a merge that brought rows back all resolve on the next
     change, not only on the next visit. Idempotent, so re-running is free. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { autoFrom(focusSessions, 0) }, [focusSessions])

  /* Closing the tab inside the debounce window must not lose the last change:
     flush the pending remote write the moment the page starts hiding. */
  useEffect(() => {
    const flush = () => {
      flushLocal()
      if (!SUPABASE_ENABLED) return
      if (remoteSaveTimer.current !== undefined && latestJson.current) {
        window.clearTimeout(remoteSaveTimer.current)
        remoteSaveTimer.current = undefined
        outbox.push(latestJson.current)
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  /* Demo pretends today is Sunday when the real weekday is irrelevant;
     habits use the real weekday so checking off feels true. */
  const todayIndex = (new Date().getDay() + 6) % 7

  const value: Store = {
    version: 3,
    tasks, habits, goals, projects, storageFull, ledger, plan, review, routines, ideas,
    openProjectId, setOpenProject, enterProject,
    addProject: plannerSlice.addProject,
    renameProject: plannerSlice.renameProject,
    setProjectHue: plannerSlice.setProjectHue,
    setProjectTag: plannerSlice.setProjectTag,
    deleteProject: plannerSlice.deleteProject,
    setTaskProject: plannerSlice.setTaskProject,
    setTaskGoal: plannerSlice.setTaskGoal,
    setTaskSpace: plannerSlice.setTaskSpace,
    focusSessions, habitLog, routineLog, slips, stepLog, stepTicks, dayLog,
    view, setView, inView,
    twoLives, setTwoLives, reels, setReels, tunes, setTunes, reelFiles, setReelFile,
    logFocus: ledgerSlice.logFocus,
    logFocusOn,
    updateFocus: ledgerSlice.updateFocus,
    deleteFocus: ledgerSlice.deleteFocus,
    syncAutoHabits: ledgerSlice.syncAutoHabits,
    space, setSpace,
    page, setPage, dayKey, openDay,
    editing, setEditing,
    focusTaskId, setFocusTaskId,
    focusRoutineId, setFocusRoutineId,
    focusAppId, setFocusAppId,
    noteToOpen, openNote: setNoteToOpen,


    toggleTask: (...a: Parameters<typeof plannerSlice.toggleTask>) => {
      haptic()
      const t = tasks.find((x) => x.id === a[0])
      creditGoal(t, t?.done ? -1 : 1)
      return plannerSlice.toggleTask(...a)
    },
    updateTask: plannerSlice.updateTask,

    logActual: ledgerSlice.logActual,

    addTask: plannerSlice.addTask,
    addTaskWithSubtasks: plannerSlice.addTaskWithSubtasks,
    commitTask: plannerSlice.commitTask,
    moveTaskList: plannerSlice.moveTaskList,
    moveTasksToToday: plannerSlice.moveTasksToToday,
    assignSlot: plannerSlice.assignSlot,
    setTaskAt: plannerSlice.setTaskAt,
    addSubtask: plannerSlice.addSubtask,
    updateSubtask: plannerSlice.updateSubtask,
    deleteSubtask: plannerSlice.deleteSubtask,
    toggleSubtask: plannerSlice.toggleSubtask,
    logSubtaskActual: ledgerSlice.logSubtaskActual,
    deleteTask: plannerSlice.deleteTask,
    setSubtasks: plannerSlice.setSubtasks,
    estimateNow: async (taskId) => {
      const t = tasks.find((x) => x.id === taskId)
      if (!t || t.subtasks?.length) return
      let min: number
      try { min = (await estimateTask(t.title, t.category)) ?? estimateFor(t.title, t.category).minutes }
      catch { min = estimateFor(t.title, t.category).minutes }
      plannerSlice.setEstimate(taskId, min)
    },
    setEstimate: plannerSlice.setEstimate,
    activeFocus,
    setActiveFocus,

    /* Both of these write the dated log first: that is the record that survives
       the week rolling over. days[] is a cache of the current week and is kept in
       step here, and rebuilt from the log on every load. */
    assertRoutineDay: growthSlice.assertRoutineDay,
    toggleHabitDay: (...a: Parameters<typeof growthSlice.toggleHabitDay>) => { haptic(); return growthSlice.toggleHabitDay(...a) },
    markHabitDay: growthSlice.markHabitDay,
    markHabitDaysOn: growthSlice.markHabitDaysOn,
    logHabitNumber: growthSlice.logHabitNumber,
    pickHabitAlt: growthSlice.pickHabitAlt,
    dailyDone,
    dailySkipped,
    dailyOpen,
    openDaily: growthSlice.openDaily,
    closeDaily: growthSlice.closeDaily,
    markHabitOn: growthSlice.markHabitOn,
    assertRoutineOn: growthSlice.assertRoutineOn,
    logSlipOn: growthSlice.logSlipOn,
    addHabit: growthSlice.addHabit,
    logSlip: (...a: Parameters<typeof growthSlice.logSlip>) => { haptic(); return growthSlice.logSlip(...a) },
    updateHabit: growthSlice.updateHabit,
    togglePauseHabit: growthSlice.togglePauseHabit,
    deleteHabit: growthSlice.deleteHabit,

    addGoal: growthSlice.addGoal,
    repeatGoal: growthSlice.repeatGoal,
    updateGoal: growthSlice.updateGoal,
    bumpGoal: growthSlice.bumpGoal,
    toggleGoalMilestone: growthSlice.toggleGoalMilestone,
    deleteGoal: growthSlice.deleteGoal,




    assistantLog,

    coachSessions,
    toggleRoutineStep: growthSlice.toggleRoutineStep,
    toggleRoutineAlt: growthSlice.toggleRoutineAlt,
    records,
    addRoutine: growthSlice.addRoutine,
    updateRoutine: growthSlice.updateRoutine,
    deleteRoutine: growthSlice.deleteRoutine,
    addRoutineStep: growthSlice.addRoutineStep,
    deleteRoutineStep: growthSlice.deleteRoutineStep,
    logCount: (...a: Parameters<typeof growthSlice.logCount>) => { haptic(); return growthSlice.logCount(...a) },
    logAmount: (...a: Parameters<typeof growthSlice.logAmount>) => { haptic(); return growthSlice.logAmount(...a) },
    removeAmount: growthSlice.removeAmount,
    logGoalAmount: growthSlice.logGoalAmount,
    removeGoalEntry: growthSlice.removeGoalEntry,
    addRoutineWithSteps: growthSlice.addRoutineWithSteps,
    setLook: growthSlice.setLook,
    planRoutine: growthSlice.planRoutine,
    setRoutineDone: growthSlice.setRoutineDone,

    syncOrigin,
    notes, noteFolders,
    addNote: notesSlice.addNote, updateNote: notesSlice.updateNote, setNoteDone: notesSlice.setNoteDone,
    moveNote: notesSlice.moveNote, deleteNote: notesSlice.deleteNote,
    keepNoteConflict: notesSlice.keepNoteConflict, dropNoteConflict: notesSlice.dropNoteConflict,
    addNoteFolder: notesSlice.addNoteFolder, renameNoteFolder: notesSlice.renameNoteFolder,
    deleteNoteFolder: notesSlice.deleteNoteFolder, renameNoteTag: notesSlice.renameNoteTag,
    prompts, addPrompt: promptsSlice.addPrompt, updatePrompt: promptsSlice.updatePrompt, setPromptSent: promptsSlice.setPromptSent, deletePrompt: promptsSlice.deletePrompt,
    ideaBoard, addIdeaCard: ideaBoardSlice.addIdeaCard, updateIdeaCard: ideaBoardSlice.updateIdeaCard, deleteIdeaCard: ideaBoardSlice.deleteIdeaCard,
    reminders, reminderLists, addReminder: remindersSlice.addReminder, updateReminder: remindersSlice.updateReminder, toggleReminder: remindersSlice.toggleReminder,
    deleteReminder: remindersSlice.deleteReminder, addReminderList: remindersSlice.addReminderList, updateReminderList: remindersSlice.updateReminderList, deleteReminderList: remindersSlice.deleteReminderList,
    people, personBonds, personContacts,
    addPerson: peopleSlice.addPerson, updatePerson: peopleSlice.updatePerson, deletePerson: peopleSlice.deletePerson,
    addPersonBond: peopleSlice.addPersonBond, setBondLabel: peopleSlice.setBondLabel, removePersonBond: peopleSlice.removePersonBond,
    logContact: peopleSlice.logContact, removeContact: peopleSlice.removeContact,
    prospects, addProspect: prospectsSlice.addProspect, updateProspect: prospectsSlice.updateProspect, deleteProspect: prospectsSlice.deleteProspect,
    logTouch: prospectsSlice.logTouch, removeTouch: prospectsSlice.removeTouch, applyOutreach: prospectsSlice.applyOutreach,
    gymGoals, addGymGoal: gymSlice.addGymGoal, updateGymGoal: gymSlice.updateGymGoal, deleteGymGoal: gymSlice.deleteGymGoal,
    invoices, invoiceClients, invoiceSupplier: invoiceProfile[0],
    saveInvoice: invoicesSlice.saveInvoice, patchInvoice: invoicesSlice.patchInvoice, deleteInvoice: invoicesSlice.deleteInvoice,
    saveInvoiceClient: invoicesSlice.saveInvoiceClient, deleteInvoiceClient: invoicesSlice.deleteInvoiceClient, saveInvoiceProfile: invoicesSlice.saveInvoiceProfile,

    undoable, undoDelete, dismissUndo,

    todayIndex,
    weekLedger,
    savedMin,
    accuracyPct,
    resetDemo: () => {
      // Cancel any pending mirror first, or it would rewrite the row we just deleted.
      window.clearTimeout(localSaveTimer.current)
      pendingSave.current = null
      window.clearTimeout(remoteSaveTimer.current)
      remoteSaveTimer.current = undefined
      // The backup copy too: "wipe everything" must not leave his data on the device.
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(BACKUP_KEY) } catch { /* noop */ }
      const finish = () => { location.hash = ''; location.reload() }
      if (SUPABASE_ENABLED) { void deleteRemoteState().finally(finish) } else finish()
    },
  }

  inboxRef.current = { add: value.addTask, done: value.logActual, tasks }
  return <Ctx.Provider value={value}>{children}<UndoToast /></Ctx.Provider>
}
