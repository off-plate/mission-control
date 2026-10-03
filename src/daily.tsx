/* The daily review.

   The first time Mission Control is opened on a new day it offers to walk the
   handover: what yesterday actually was, what of it is still unrecorded and can
   be put right in one tap, what did not get done, and what today looks like.
   Then it gets out of the way.

   Rules it is built on, most of them written after the first version was taken
   apart line by line.

   1. IT ASKS. It never starts walking him through anything.
   2. IT ONLY SAYS TRUE THINGS. Every number is counted from the logs, and the
      closing line is computed, not written. The first version ended on
      "Nothing was left hanging" as a constant, over a day that had left two
      debt tasks hanging. One sentence like that and the numbers above it are
      worth nothing either.
   3. NO BUTTON HERE CAN TAKE SOMETHING AWAY. "I did it" asserts; it never
      toggles. The first version could delete a day off a streak and then print
      "marked" beside it.
   4. NOTHING MOVES UNDER HIS FINGER. The rows are frozen when the stage opens,
      so a row he marks stays where it is, turns green and says so. Live lists
      resorted themselves on every tap, and a fast second tap in the same place
      marked a different habit into his record.
   5. THE WHOLE DAY, NOT ONE WORKSPACE. A handover filtered to Big Time closes
      the day for Personal too, and his morning is not a workspace.
   6. STAGES WITH NOTHING IN THEM DO NOT EXIST.

   The motion vocabulary is short on purpose: one entry curve, one stagger for
   the scoreboard, one count-up that starts only once its tile is actually
   visible, and one green settle when a row is put right. All of it stops under
   prefers-reduced-motion. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { MOCK_AGENDA } from './exceptions'
import { dayIndexOf, fmtDuration, goalPeriodKey, goalPeriodRange, localDateKey, type GoalTf } from './util'
import { SPACES, currentStreak, focusMinutesOn, goalCurrent, isCounted, type AgendaEvent, type Goal, type HabitDef, type Routine, type Task } from './types'
import * as Icon from './icons'

const yesterdayKey = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return localDateKey(d)
}

/** Was this habit owed on that day at all? A weekday habit owes nothing on a
 *  Sunday, and a weekly one owes a WEEK, so neither can have missed yesterday.
 *  Asking about them would be inventing a failure. */
function dueOn(h: HabitDef, day: string): boolean {
  if (h.paused) return false
  if (h.startedOn && day < h.startedOn) return false
  switch (h.frequency) {
    case 'daily': return true
    case 'weekdays': return dayIndexOf(day) < 5
    default: return false
  }
}

/** A number that counts up to itself, once, and only after its tile is on
 *  screen. Counting under the stagger fade meant three of the four never
 *  visibly moved at all. */
function Tally({ n, at = 0, fmt }: { n: number; at?: number; fmt?: (v: number) => string }) {
  const [shown, setShown] = useState(n)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current || n <= 0) return
    ran.current = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setShown(0)
    let raf = 0
    const start = window.setTimeout(() => {
      const from = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - from) / 700)
        setShown(Math.round(n * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, at)
    return () => { window.clearTimeout(start); cancelAnimationFrame(raf) }
  }, [n, at])
  return <>{fmt ? fmt(shown) : shown}</>
}

type Stage = 'ask' | 'replay' | 'unmarked' | 'goals' | 'left' | 'today' | 'close'

/* THE REPLAY (his ask, 2026-10-04): yesterday in the order it happened, then
   the steps that put it right. Anything with a clock time goes in its part of
   the day; a routine run or a habit ticked later has no honest time and sits
   under Anytime rather than being given one. */
type Moment = { key: string; at: number | null; title: string; kind: 'habit' | 'routine' | 'task' | 'focus'; sub?: string }
const PARTS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late', 'Anytime'] as const
const partOf = (at: number | null): typeof PARTS[number] => {
  if (at === null) return 'Anytime'
  const h = new Date(at).getHours()
  return h < 5 ? 'Late' : h < 12 ? 'Morning' : h < 14 ? 'Midday' : h < 18 ? 'Afternoon' : 'Evening'
}
const hm = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const KIND_WORD: Record<Moment['kind'], string> = { habit: 'Habit', routine: 'Routine', task: 'Task', focus: 'Focus' }
interface Half { r: Routine; done: number; total: number }

const SHOW_AT_ONCE = 8

export function DailyReview() {
  const {
    tasks, projects, habits, habitLog, routines, routineLog, stepTicks, slips, focusSessions,
    goals, plan, dailyDone, dailySkipped, dailyOpen, openDaily, closeDaily, markHabitOn, assertRoutineOn, logSlipOn,
    moveTasksToToday, deleteTask, setPage, bumpGoal,
  } = useStore()
  /* Where a task came from: its project when it has one (Off-Plate and Michael's
     Corner are projects), otherwise its workspace when that is not Personal. */
  const whereOf = (t: Task) => projects.find((p) => p.id === t.projectId)?.name ?? (t.space !== 'personal' ? SPACE_LABELS[t.space] : undefined)

  const today = localDateKey()
  const yday = yesterdayKey()
  const [stage, setStage] = useState<Stage>('ask')
  /* Open-ness lives in the store: the header button reopens it from any page,
     so this component cannot be the one holding the switch. */
  const open = dailyOpen
  const [fixed, setFixed] = useState<Map<string, string>>(new Map())
  const [showAll, setShowAll] = useState(false)

  /* ---- what yesterday was ----
     No workspace filter anywhere in here: rule 5. A row that is not Personal
     says so on itself. */
  const keptYesterday = useMemo(() => {
    /* Rows the clock wrote are not habits he kept, they are the focus figure
       standing in the next tile. Counting both put the same 64 minutes on the
       board twice, and he counts. */
    const ids = new Set(habitLog.filter((t) => t.day === yday && !t.src?.startsWith('auto:')).map((t) => t.habitId))
    return habits.filter((h) => ids.has(h.id))
  }, [habitLog, habits, yday])

  const routinesYesterday = useMemo(() => {
    const ids = new Set(routineLog.filter((r) => r.day === yday).map((r) => r.routineId))
    return routines.filter((r) => ids.has(r.id))
  }, [routineLog, routines, yday])

  /* doneAt is a UTC instant. Slicing its first ten characters reads its UTC
     calendar date, a day behind his own for the two hours after midnight in
     Prague, so a task finished at 00:20 read as finished the day before that
     and dropped out of "what you did yesterday" entirely the one morning it
     mattered most. Read it through the same local-date key `yday` is. */
  const doneYesterday = useMemo(
    () => tasks.filter((t) => t.done && t.doneAt && localDateKey(new Date(t.doneAt)) === yday),
    [tasks, yday],
  )

  const focusYesterday = useMemo(
    () => SPACES.reduce((a, sp) => a + focusMinutesOn(focusSessions, yday, sp), 0),
    [focusSessions, yday],
  )

  /* ---- yesterday, in order ---- */
  const moments = useMemo<Moment[]>(() => {
    const out: Moment[] = []
    const seen = new Set<string>()
    for (const t of habitLog) {
      if (t.day !== yday || t.src?.startsWith('auto:') || seen.has(t.habitId)) continue
      const h = habits.find((x) => x.id === t.habitId)
      if (!h) continue
      /* A routine's own habit is the routine itself: it shows once, as the routine. */
      if (routinesYesterday.some((r) => r.habitId === h.id)) continue
      seen.add(t.habitId)
      const at = t.at ? Date.parse(t.at) : NaN
      out.push({ key: `h:${h.id}`, at: Number.isFinite(at) ? at : null, title: h.name, kind: 'habit' })
    }
    for (const r of routinesYesterday) out.push({ key: `r:${r.id}`, at: null, title: r.title, kind: 'routine' })
    for (const t of doneYesterday) out.push({ key: `t:${t.id}`, at: t.doneAt ? Date.parse(t.doneAt) : null, title: t.title, kind: 'task', sub: whereOf(t) })
    for (const f of focusSessions) {
      if (f.day !== yday) continue
      const at = f.at ? Date.parse(f.at) : NaN
      out.push({ key: `f:${f.id}`, at: Number.isFinite(at) ? at : null, title: f.label || 'Focus block', kind: 'focus', sub: fmtDuration(f.minutes) })
    }
    return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitLog, habits, routinesYesterday, doneYesterday, focusSessions, yday])

  /* ---- goals whose period yesterday belongs to ---- */
  const goalRange = (g: Goal) => { const tf = (g.timeframe ?? 'quarter') as GoalTf; return goalPeriodRange(tf, g.periodKey ?? goalPeriodKey(tf)) }
  const liveGoals = useMemo(() => goals.filter((g) => {
    if (g.closed || g.target <= 0) return false
    /* Only goals he moves himself, and the ones about something he is quitting.
       A goal that counts itself off a habit needs nothing from him here. */
    if (g.habitId && habits.find((h) => h.id === g.habitId)?.kind !== 'break') return false
    const r = goalRange(g)
    return r.from <= yday && yday <= r.to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [goals, habits, yday])
  const [bumped, setBumped] = useState<Map<string, number>>(new Map())

  /* ---- what is not written down yet ---- */
  const routineDriven = useMemo(
    () => new Map(routines.filter((r) => r.habitId && !r.archivedAt).map((r) => [r.habitId as string, r])),
    [routines],
  )

  /* A routine he got part way into and never finished. Daily ones only: a
     weekly review with one step ticked has not missed a day. And never one
     whose habit is already marked kept, or the only button on the row would be
     one that takes the day back off him. */
  /* Counted from the folder's HABITS now, not from steps. Since routines
     became folders of habits, a morning he got three quarters through was
     landing in this review as four separate unticked rows with no sign they
     belonged together, and the count above them read the raw habit total. One
     row per folder, the way it read when a routine was a routine. */
  const halfDone = useMemo<Half[]>(() => {
    const kept = new Set(habitLog.filter((t) => t.day === yday).map((t) => t.habitId))
    const out: Half[] = []
    for (const r of routines) {
      if (r.archivedAt) continue
      if (r.cadence !== 'daily' && r.cadence !== 'prework') continue
      if (r.habitId && kept.has(r.habitId)) continue
      if (routineLog.some((x) => x.routineId === r.id && x.day === yday)) continue
      const mine = habits.filter((h) => h.folderId === r.id && !h.optional && !h.paused)
      const total = mine.length
      if (!total) continue
      const done = mine.filter((h) => kept.has(h.id)).length
      /* Every folder that is not finished, not only the ones he started. A
         folder he never opened is exactly the thing this review exists to
         ask about, and as raw habits it used to arrive as five loose rows. */
      if (done < total) out.push({ r, done, total })
    }
    return out
  }, [routines, routineLog, habits, habitLog, yday])

  const unmarked = useMemo(() => {
    const kept = new Set(habitLog.filter((t) => t.day === yday).map((t) => t.habitId))
    const asRoutine = new Set(halfDone.map((x) => x.r.habitId).filter(Boolean) as string[])
    /* A habit inside a folder is asked about as part of its folder, above.
       Left in here too it was both a row of its own AND a member of a
       folder's count, so answering one did not clear the other. */
    const inFolder = new Set(halfDone.flatMap((x) => habits.filter((h) => h.folderId === x.r.id).map((h) => h.id)))
    return habits.filter((h) => (
      !asRoutine.has(h.id) && !h.folderId && !inFolder.has(h.id)
      && h.kind !== 'break' && !h.auto && !isCounted(h)
      && !kept.has(h.id) && dueOn(h, yday)
    ))
  }, [habits, habitLog, halfDone, yday])

  const quitting = useMemo(
    () => habits.filter((h) => h.kind === 'break' && !h.paused
      && (!h.quitSince || h.quitSince <= yday)
      && !slips.some((s) => s.habitId === h.id && s.day === yday)),
    [habits, slips, yday],
  )

  /* ---- what did not get done ----
     Read from what the rollover ACTUALLY did. It runs on load, before this
     mounts, and sweeps every unfinished task off yesterday's list into the
     backlog with plannedOn cleared. Looking for `list === 'today' && plannedOn
     === yesterday` therefore found an empty set every single time, and the
     whole stage silently never appeared. plan.returnedIds is where they went. */
  const leftOver = useMemo<Task[]>(() => {
    if (plan.returnedOn !== today) return []
    const ids = new Set(plan.returnedIds ?? [])
    /* Not on today's list already: pressing Today here, or on the Plan page
       before opening this, put it back, and offering it again as something
       that did not get done is the app forgetting what he just told it. */
    return tasks.filter((t) => ids.has(t.id) && !t.done && t.list !== 'today')
  }, [tasks, plan, today])

  /* ---- what today looks like ---- */
  const todayTasks = useMemo(
    () => tasks.filter((t) => !t.done && t.list === 'today' && (t.plannedOn ?? today) === today),
    [tasks, today],
  )
  const events = useMemo(
    () => SPACES.flatMap((sp) => (MOCK_AGENDA[sp] ?? []) as AgendaEvent[]).sort((a, b) => a.start.localeCompare(b.start)),
    [],
  )
  const goalsDue = useMemo(
    () => goals.filter((g) => g.deadline && g.deadline >= today && g.deadline <= localDateKey(new Date(Date.now() + 7 * 864e5))),
    [goals, today],
  )

  /* A reopen is a NEW walk. This never unmounts on close, so everything frozen
     for the last one survived into the next: the leftover headline said two
     over a list showing one, because the count came off a list frozen before he
     acted on it. Declared before the freeze below, so on the commit where it
     opens the clear happens first and the freeze then takes today's lists. */
  const was = useRef(false)
  useEffect(() => {
    if (dailyOpen && !was.current) {
      setRows(null); setLeft(null); setWalk(null)
      setFixed(new Map()); setShowAll(false); setStage('ask'); setBumped(new Map()); setKeep(new Set())
    }
    was.current = dailyOpen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyOpen])

  /* Frozen when the stage opens: rule 4. */
  const [rows, setRows] = useState<{ un: HabitDef[]; half: Half[]; quit: HabitDef[] } | null>(null)
  const [left, setLeft] = useState<Task[] | null>(null)
  /* Tasks he chose to leave on the list: answered, not carried, not dropped. */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (dailyOpen && !rows) setRows({ un: unmarked, half: halfDone, quit: quitting })
    if (dailyOpen && !left) setLeft(leftOver)
  }, [dailyOpen, rows, left, unmarked, halfDone, quitting, leftOver])

  const hasKept = keptYesterday.length + routinesYesterday.length + doneYesterday.length > 0 || focusYesterday > 0
  const hasUnmarked = unmarked.length + halfDone.length + quitting.length > 0
  const hasLeft = leftOver.length > 0
  const live = useMemo<Stage[]>(() => [
    'ask',
    ...(hasUnmarked ? ['unmarked' as Stage] : []),
    ...(liveGoals.length ? ['goals' as Stage] : []),
    ...(hasLeft ? ['left' as Stage] : []),
    'today',
    'close',
  ], [hasKept, hasUnmarked, hasLeft, liveGoals.length])
  /* Frozen with the rows, and for the same reason. Live, the stage he was
     standing on fell out of the list the moment he answered its last row, the
     index went to -1 and Next handed him back the opening screen. Doing the
     honest thing and clearing the whole list was the one path that looped. */
  const [walk, setWalk] = useState<Stage[] | null>(null)
  const stages = walk ?? live

  const everLogged = habitLog.length + routineLog.length + focusSessions.length > 0
  const owed = everLogged && dailyDone !== today && dailySkipped !== today
  /* Offered once a day, on its own, and that is the only door now: the header
     button that used to reopen it by hand left on his instruction
     (2026-08-27) -- he does not need to repeat something the morning offer
     already covers. */
  const asked = useRef(false)
  useEffect(() => {
    if (!owed || asked.current) return
    asked.current = true
    openDaily()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owed])
  useEffect(() => { if (open && !walk) setWalk(live) }, [open, walk, live])

  const leave = (walked: boolean) => closeDaily(walked)

  /* Escape, the browser back button and the phone's back gesture all get out,
     and the page behind is frozen while a full screen is over it. */
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') leave(false) }
    const pop = () => closeDaily(false)
    document.addEventListener('keydown', esc)
    window.addEventListener('popstate', pop)
    history.pushState({ dr: 1 }, '')
    const had = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      window.removeEventListener('popstate', pop)
      document.body.style.overflow = had
      if (history.state?.dr) history.back()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const at = stages.indexOf(stage)
  const next = () => {
    const n = stages[at + 1]
    if (!n) return leave(true)
    setStage(n)
    setShowAll(false)
  }
  const back = () => { const p = stages[at - 1]; if (p) setStage(p) }

  if (!open) return null

  const fix = (key: string, said: string, run: () => void) => {
    run()
    setFixed((prev) => new Map(prev).set(key, said))
  }

  const un = rows?.un ?? []
  const half = rows?.half ?? []
  const quit = rows?.quit ?? []
  const order = [...half.map((x) => `r:${x.r.id}`), ...un.map((h) => `h:${h.id}`)]
  const hidden = !showAll && order.length > SHOW_AT_ONCE
  const shows = (k: string) => !hidden || order.indexOf(k) < SHOW_AT_ONCE

  /* What is still open, counted across EVERYTHING he was shown, not only the
     tasks. Counting tasks alone meant a morning with eight unticked habits and
     no leftovers ended on "Nothing was hanging" one screen after listing the
     eight. That is round one's lie reached through a computation, which is
     worse, because the computation was the fix. */
  /* A task's state is read off the store rather than off `fixed`, so taking a
     Drop it back through the undo bar really does take it back: the row stops
     saying dropped and the count stops being one short. */
  const taskState = (id: string): string | null => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return 'dropped'
    if (t.done) return 'done'
    if (t.list === 'today') return 'carried to today'
    if (keep.has(id)) return 'left on the list'
    return null
  }
  const stillOpen = (rows ? [...rows.half.map((x) => `r:${x.r.id}`), ...rows.un.map((h) => `h:${h.id}`)]
    : [...halfDone.map((x) => `r:${x.r.id}`), ...unmarked.map((h) => `h:${h.id}`)])
    .filter((k) => !fixed.has(k)).length
    + (left ?? leftOver).filter((t) => taskState(t.id) === null).length
  /* Admitting a relapse is not putting the record right. Telling him it is
     misreads what he just did. */
  const putRight = [...fixed.keys()].filter((k) => !k.startsWith('s:') && !k.startsWith('t:')).length
    + (left ?? leftOver).filter((t) => taskState(t.id) !== null).length
  const owned = [...fixed.keys()].filter((k) => k.startsWith('s:')).length

  /* The headline counts what is STILL undone, so it cannot sit above a row that
     says "on today" claiming two when one is left. */
  const leftCount = (left ?? leftOver).filter((t) => taskState(t.id) === null).length
  /* What is actually waiting, by name. */
  const froze = rows ?? { un: unmarked, half: halfDone }
  const waiting: { id: string; name: string; where?: string }[] = [
    ...froze.half.filter((x) => !fixed.has(`r:${x.r.id}`))
      .map((x) => ({ id: x.r.id, name: x.r.title, where: x.r.space !== 'personal' ? SPACE_LABELS[x.r.space] : undefined })),
    ...froze.un.filter((h) => !fixed.has(`h:${h.id}`))
      .map((h) => ({ id: h.id, name: h.name, where: h.space !== 'personal' ? SPACE_LABELS[h.space] : undefined })),
    ...(left ?? leftOver).filter((t) => taskState(t.id) === null)
      .map((t) => ({ id: t.id, name: t.title, where: whereOf(t) })),
  ]
  /* ---- one page (rebuilt 2026-10-04) -------------------------------------
     No steps: everything yesterday asks of him is on one screen, built from the
     Today room's own cards, so it looks like Mission Control and Jarvis
     repaints it with the same tokens. */
  const ydate = new Date(`${yday}T12:00:00`)
  const habitsDue = keptYesterday.length + un.length + half.length
  const keptPct = habitsDue ? Math.round(((keptYesterday.length + [...fixed.keys()].filter((k) => k.startsWith('h:') || k.startsWith('r:')).length) / habitsDue) * 100) : 100
  /* Quarter hours that held something, for the dot strip. A focus block lights
     every quarter it ran through, anything else its own quarter. */
  const lit = new Map<number, 'focus' | 'busy'>()
  for (const m of moments) {
    if (m.at === null) continue
    const d = new Date(m.at)
    const q = d.getHours() * 4 + Math.floor(d.getMinutes() / 15)
    if (m.kind === 'focus') {
      const mins = focusSessions.find((f) => `f:${f.id}` === m.key)?.minutes ?? 15
      for (let i = 0; i < Math.max(1, Math.round(mins / 15)); i++) lit.set(q - i, 'focus')
    } else if (!lit.has(q)) lit.set(q, 'busy')
  }
  const tasksLeft = left ?? leftOver
  const openTasks = tasksLeft.filter((t) => taskState(t.id) === null)
  const unTotal = order.length
  const unLeft = order.filter((k) => !fixed.has(k)).length

  return (
    <div className="dr-screen" role="dialog" aria-modal="true" aria-label="Yesterday">
      <div className="dr-body">
        <div className="troom dr-room">
          <section className="troom-hero dr-hero">
            <div className="tr-card tr-card--ink dr-yday">
              <div>
                <p className="tr-l">Yesterday</p>
                <div className="tr-n dr-date">{ydate.getDate()}<span className="tr-mo">{ydate.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
                <p className="dr-wd">{ydate.toLocaleDateString('en-GB', { weekday: 'long' })}</p>
              </div>
              <div className="dr-kept">
                <p className="tr-l">Habits kept</p>
                <div className="tr-n">{keptPct}<span className="tr-u">%</span></div>
                <div className="tr-bar"><i style={{ width: `${keptPct}%` }} /></div>
              </div>
            </div>
            <div className="tr-card tr-tile">
              <p className="tr-l">Finished</p>
              <div className="tr-n"><Tally n={doneYesterday.length} at={120} /></div>
            </div>
            <div className="tr-card tr-tile">
              <p className="tr-l">Habits</p>
              <div className="tr-n"><Tally n={keptYesterday.length} at={180} /><i>/{habitsDue}</i></div>
            </div>
            <div className="tr-card tr-card--lime tr-tile">
              <p className="tr-l">Focused</p>
              <div className="tr-n">{focusYesterday > 0 ? fmtDuration(focusYesterday) : '0m'}</div>
            </div>
            <div className="tr-card tr-tile">
              <p className="tr-l">Routines</p>
              <div className="tr-n"><Tally n={routinesYesterday.length} at={240} /></div>
            </div>
          </section>

          <section className="tr-card tr-day dr-day">
            <div className="tr-head">
              <p className="tr-l">Through the day</p>
              <span className="tr-count-inline"><span className="tr-n">{moments.length}</span><span className="tr-l">{moments.length === 1 ? 'thing logged' : 'things logged'}</span></span>
            </div>
            <div className="tr-dots">
              {Array.from({ length: 96 }, (_, i) => <span key={i} className={`tr-q${lit.get(i) === 'focus' ? ' is-focus' : lit.get(i) === 'busy' ? ' is-busy' : ' is-spent'}`} />)}
            </div>
            {moments.length > 0 ? (
              <div className="dr-moments">
                {moments.map((m) => (
                  <div key={m.key} className={`dr-moment k-${m.kind}`} title={m.title}>
                    <span className="dr-mt mono">{m.at !== null ? hm(m.at) : ''}</span>
                    <span className="dr-mn">{m.title}</span>
                    <span className="dr-mk">{m.sub ?? KIND_WORD[m.kind]}</span>
                  </div>
                ))}
              </div>
            ) : <p className="tr-empty">Nothing was logged with a time yesterday.</p>}
          </section>

          <section className="troom-lists dr-lists">
            <div className="tr-card">
              <div className="tr-head"><p className="tr-l">Forgot to tick?</p><span className="tr-n tr-sm">{unLeft}<i>/{unTotal}</i></span></div>
              <div className="tr-rows">
                {unTotal === 0 && quit.length === 0 && <p className="tr-empty">Every habit was ticked.</p>}
                {half.map(({ r, done, total }) => {
                  const k = `r:${r.id}`
                  const on = fixed.has(k)
                  return (
                    <div className={`tr-r${on ? ' is-done' : ''}`} key={k}>
                      <button className={`tr-box${on ? ' is-on' : ''}`} role="checkbox" aria-checked={on} aria-label={`I finished ${r.title}`} disabled={on}
                        onClick={() => fix(k, 'marked', () => {
                          for (const h of habits.filter((x) => x.folderId === r.id && !x.optional && !x.paused)) markHabitOn(h.id, yday, true)
                          if (r.habitId) assertRoutineOn(r.habitId, yday, true)
                        })} />
                      <span className="tr-t">{r.title}</span>
                      <span className="tr-age is-cool">{done}<u>/{total}</u></span>
                    </div>
                  )
                })}
                {un.map((h) => {
                  const k = `h:${h.id}`
                  const on = fixed.has(k)
                  const driver = routineDriven.get(h.id)
                  const streak = currentStreak(habitLog, h.id, new Date(`${yday}T12:00:00`))
                  return (
                    <div className={`tr-r${on ? ' is-done' : ''}`} key={k}>
                      <button className={`tr-box${on ? ' is-on' : ''}`} role="checkbox" aria-checked={on} aria-label={`I did ${h.name}`} disabled={on}
                        onClick={() => fix(k, 'marked', () => (driver ? assertRoutineOn(h.id, yday, true) : markHabitOn(h.id, yday, true)))} />
                      <span className="tr-t">{h.name}</span>
                      {streak > 1 && <span className="tr-age is-cool">{streak}<u>d</u></span>}
                    </div>
                  )
                })}
              </div>
              {quit.length > 0 && (
                <div className="dr-slips">
                  <p className="tr-l">Slipped on any?</p>
                  <div className="tr-chips">
                    {quit.map((h) => {
                      const k = `s:${h.id}`
                      return fixed.has(k)
                        ? <span key={k} className="tr-chip is-said">{h.name}, logged</span>
                        : <button key={k} className="tr-chip" onClick={() => fix(k, 'logged', () => logSlipOn(h.id, yday))}>{h.name}</button>
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="tr-card">
              <div className="tr-head">
                <p className="tr-l">Did not get done</p>
                <span className="tr-n tr-sm is-hot">{openTasks.length}</span>
              </div>
              <div className="tr-rows">
                {tasksLeft.length === 0 && <p className="tr-empty">Nothing was left over.</p>}
                {tasksLeft.map((t) => {
                  const said = taskState(t.id)
                  return (
                    <div className={`tr-r dr-task${said ? ' is-done' : ''}`} key={t.id}>
                      <span className="tr-t" title={t.title}>{t.title}</span>
                      {said
                        ? <span className="dr-said">{said}</span>
                        : (
                          <span className="dr-acts">
                            <button className="dr-a is-go" onClick={() => moveTasksToToday([t.id])}>Today</button>
                            <button className="dr-a" onClick={() => setKeep((k) => new Set(k).add(t.id))}>Keep</button>
                            <button className="dr-a is-drop" onClick={() => deleteTask(t.id)}>Drop</button>
                          </span>
                        )}
                    </div>
                  )
                })}
              </div>
              {openTasks.length > 1 && (
                <button className="tr-start dr-carry" onClick={() => moveTasksToToday(openTasks.map((t) => t.id))}><span>Carry all {openTasks.length} to today</span></button>
              )}
            </div>

            <div className="tr-card">
              <div className="tr-head"><p className="tr-l">Goals</p><span className="tr-n tr-sm">{liveGoals.length}</span></div>
              <div className="tr-goals">
                {liveGoals.length === 0 && <p className="tr-empty">No goal is running.</p>}
                {liveGoals.map((g) => {
                  const cur = goalCurrent(g, habits, habitLog, goalRange(g), slips, focusSessions)
                  const pct = Math.min(100, Math.round((cur / g.target) * 100))
                  const added = bumped.get(g.id) ?? 0
                  return (
                    <div className="tr-goal" key={g.id}>
                      <div className="tr-goalhead">
                        <span className="tr-t">{g.name}</span>
                        <span className="tr-n tr-pct">{pct}%</span>
                      </div>
                      <div className="tr-bar"><i style={{ width: `${pct}%` }} /></div>
                      <div className="dr-goalfoot">
                        <p className="tr-l tr-of">{cur} of {g.target} {g.unit}</p>
                        {!g.habitId && (
                          <span className="dr-acts">
                            {added > 0 && <button className="dr-a" onClick={() => { bumpGoal(g.id, -1); setBumped((m) => new Map(m).set(g.id, (m.get(g.id) ?? 1) - 1)) }}>Undo</button>}
                            <button className="dr-a is-go" onClick={() => { bumpGoal(g.id, 1); setBumped((m) => new Map(m).set(g.id, (m.get(g.id) ?? 0) + 1)) }}>+1</button>
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="dr-foot">
        <button className="dr-skip" onClick={() => leave(false)}>Not now</button>
        <span className="dr-footnote">{stillOpen > 0 ? `${stillOpen} still open` : 'All answered'}</span>
        <button className="btn btn-primary dr-go" onClick={() => leave(true)}>Done, start the day</button>
      </div>
    </div>
  )

}
