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
    const r = goalRange(g)
    return r.from <= yday && yday <= r.to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [goals, yday])
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
    if (stage === 'unmarked' && !rows) setRows({ un: unmarked, half: halfDone, quit: quitting })
    if (stage === 'left' && !left) setLeft(leftOver)
  }, [stage, rows, left, unmarked, halfDone, quitting, leftOver])

  const hasKept = keptYesterday.length + routinesYesterday.length + doneYesterday.length > 0 || focusYesterday > 0
  const hasUnmarked = unmarked.length + halfDone.length + quitting.length > 0
  const hasLeft = leftOver.length > 0
  const live = useMemo<Stage[]>(() => [
    'ask',
    ...(hasKept ? ['replay' as Stage] : []),
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
  const primary = stage === 'close'
    ? { label: 'Start the day', run: () => leave(true) }
    : stage === 'ask'
      ? { label: 'Go through it', run: next }
      : { label: 'Next', run: next }

  return (
    <div className="dr-screen" role="dialog" aria-modal="true" aria-label="Daily review">
      <div className="dr-body" key={stage}>
        <div className="dr-rail" aria-hidden="true">
          {stages.slice(1).map((s, i) => <span key={s} className={`dr-seg${at - 1 >= i ? ' on' : ''}`} />)}
        </div>

        {stage === 'ask' && (
          <div className="dr-stage">
            <h1>Two minutes on yesterday?</h1>
            {(hasUnmarked || hasLeft) && (
              <p className="dr-fact mono">
                {[
                  hasUnmarked && `${unmarked.length + halfDone.length} unmarked`,
                  hasLeft && `${leftOver.length} unfinished`,
                ].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        )}

        {stage === 'replay' && (
          <div className="dr-stage">
            <h1>Yesterday, as it happened.</h1>
            <div className="dr-replay">
              <div className="panel dr-sum">
                <span className="microcap">In numbers</span>
                <div className="dr-bignums">
                  {[
                    { n: doneYesterday.length, l: doneYesterday.length === 1 ? 'task finished' : 'tasks finished' },
                    { n: keptYesterday.length, l: keptYesterday.length === 1 ? 'habit kept' : 'habits kept' },
                    { n: routinesYesterday.length, l: routinesYesterday.length === 1 ? 'routine run' : 'routines run' },
                    { n: focusYesterday, l: 'focused', fmt: fmtDuration },
                  ].map((x, i) => (
                    <div key={x.l} className={`dr-big${x.n === 0 ? ' is-zero' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                      <b className="dr-bignum mono"><Tally n={x.n} at={160 + i * 80} fmt={x.fmt} /></b>
                      <span>{x.l}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel dr-tlpanel">
                <span className="microcap">Through the day</span>
                <div className="dr-tl">
                  {PARTS.map((part) => {
                    const here = moments.filter((m) => partOf(m.at) === part)
                    if (!here.length) return null
                    return (
                      <section key={part} className="dr-tl-part">
                        <span className="dr-tl-label">{part}</span>
                        <ul className="dr-tl-list">
                          {here.map((m, i) => (
                            <li key={m.key} className={`dr-tl-item k-${m.kind}`} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                              <span className="dr-tl-time mono">{m.at !== null ? hm(m.at) : ''}</span>
                              <span className="dr-check" aria-hidden="true"><Icon.Check size={12} strokeWidth={3.4} /></span>
                              <span className="dr-tl-title">{m.title}</span>
                              <span className="dr-tl-kind">{m.sub ? `${m.sub}, ` : ''}{KIND_WORD[m.kind]}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {stage === 'unmarked' && (
          <div className="dr-stage">
            <h1>Did you forget to tick anything?</h1>
            <p className="dr-fact mono">{order.length} open from yesterday. Tap what you actually did.</p>
            <ul className="dr-fix dr-cards">
              {half.filter((x) => shows(`r:${x.r.id}`)).map(({ r, done, total }) => {
                const k = `r:${r.id}`
                return (
                  <li key={k} className={`dr-row${fixed.has(k) ? ' is-fixed' : ''}`}>
                    <span className="dr-rowmain">
                      <span className="dr-rowname">{r.title}</span>
                      <span className="dr-rowsub mono">
                        {done} of {total}{r.space !== 'personal' && `, ${SPACE_LABELS[r.space]}`}
                      </span>
                    </span>
                    {fixed.has(k)
                      ? <span className="dr-said mono">{fixed.get(k)}</span>
                      : (
                        <button
                          className="dr-tick"
                          onClick={() => fix(k, 'marked', () => {
                            /* Marks the folder's own habits for that day, and
                               the folder's aggregate habit with them, so the
                               streak and the rows agree afterwards. */
                            for (const h of habits.filter((x) => x.folderId === r.id && !x.optional && !x.paused)) {
                              markHabitOn(h.id, yday, true)
                            }
                            if (r.habitId) assertRoutineOn(r.habitId, yday, true)
                          })}
                        >
                          I finished it
                        </button>
                      )}
                  </li>
                )
              })}
              {un.filter((h) => shows(`h:${h.id}`)).map((h) => {
                const k = `h:${h.id}`
                const driver = routineDriven.get(h.id)
                const streak = currentStreak(habitLog, h.id, new Date(`${yday}T12:00:00`))
                const sub = [
                  /* Only facts he cannot read off the title. A run he is one day
                     from losing is worth saying; "every day" under a habit
                     called Meditation is not. */
                  streak > 1 && `${streak} day run`,
                  driver && driver.title !== h.name && `kept by ${driver.title}`,
                  h.space !== 'personal' && SPACE_LABELS[h.space],
                ].filter(Boolean).join(', ')
                return (
                  <li key={k} className={`dr-row${fixed.has(k) ? ' is-fixed' : ''}`}>
                    <span className="dr-rowmain">
                      <span className="dr-rowname">{h.name}</span>
                      {sub && <span className="dr-rowsub mono">{sub}</span>}
                    </span>
                    {fixed.has(k)
                      ? <span className="dr-said mono">{fixed.get(k)}</span>
                      : (
                        <button className="dr-tick" onClick={() => fix(k, 'marked', () => (driver ? assertRoutineOn(h.id, yday, true) : markHabitOn(h.id, yday, true)))}>
                          I did it
                        </button>
                      )}
                  </li>
                )
              })}
              {hidden && (
                <li className="dr-row dr-rest">
                  <button className="dr-more-btn" onClick={() => setShowAll(true)}>
                    Show the other {order.length - SHOW_AT_ONCE}
                  </button>
                </li>
              )}
              {quit.length > 0 && (
                /* The names ARE the buttons. A single "I slipped" control beside
                   "4 being quit" read as though it would mark all four, which is
                   what he thought it did, and a control that looks like it might
                   do that is not one you press to find out. Each name marks only
                   itself, and the undo bar takes it straight back. */
                <li className="dr-row dr-slips">
                  <span className="dr-rowmain">
                    <span className="dr-rowname">Slipped on any of these yesterday?</span>
                    <span className="dr-slipwrap">
                      {quit.map((h) => {
                        const k = `s:${h.id}`
                        return fixed.has(k)
                          ? <span key={k} className="dr-said mono">{h.name}, logged</span>
                          : (
                            <button
                              key={k} className="dr-tick is-slip"
                              aria-label={`I slipped on ${h.name} yesterday`}
                              onClick={() => fix(k, 'logged', () => logSlipOn(h.id, yday))}
                            >
                              {h.name}
                            </button>
                          )
                      })}
                    </span>
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}

        {stage === 'goals' && (
          <div className="dr-stage">
            <h1>Where your goals stand.</h1>
            <p className="dr-fact mono">Goals that count a habit moved with what you just ticked. The rest you add to by hand.</p>
            <ul className="dr-fix dr-cards">
              {liveGoals.map((g) => {
                const cur = goalCurrent(g, habits, habitLog, goalRange(g), slips, focusSessions)
                const pct = Math.min(100, Math.round((cur / g.target) * 100))
                const added = bumped.get(g.id) ?? 0
                return (
                  <li key={g.id} className={`dr-row dr-goal${added ? ' is-fixed' : ''}`}>
                    <span className="dr-rowname">{g.name}</span>
                    <span className="dr-goalnum">
                      <b className="mono">{cur}</b><span className="mono">/ {g.target}{g.unit ? ` ${g.unit}` : ''}</span>
                      <em className="mono">{pct}%</em>
                    </span>
                    <span className="dr-goalbar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                    {g.habitId
                      ? <span className="dr-rowsub">Counts itself from its habit</span>
                      : (
                        <span className="dr-rowacts">
                          <button className="dr-tick" onClick={() => { bumpGoal(g.id, 1); setBumped((m) => new Map(m).set(g.id, (m.get(g.id) ?? 0) + 1)) }}>+1 for yesterday</button>
                          {added > 0 && <button className="dr-drop" onClick={() => { bumpGoal(g.id, -1); setBumped((m) => new Map(m).set(g.id, (m.get(g.id) ?? 1) - 1)) }}>Undo</button>}
                        </span>
                      )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {stage === 'left' && (
          <div className="dr-stage">
            <h1>
              {leftCount === 0 ? 'All of them answered.'
                : leftCount === 1 ? 'Carry this one over to today?'
                  : `Carry these ${leftCount} over to today?`}
            </h1>
            <p className="dr-fact mono">They did not get done yesterday. Today puts it on today's plan, the list keeps it for later.</p>
            {leftCount > 1 && (
              <button className="dr-tick dr-all" onClick={() => moveTasksToToday((left ?? leftOver).filter((t) => taskState(t.id) === null).map((t) => t.id))}>
                Carry all {leftCount} to today
              </button>
            )}
            <ul className="dr-fix dr-cards">
              {(left ?? leftOver).map((t) => {
                const said = taskState(t.id)
                const carried = t.carried ?? 0
                const sub = [carried > 1 && `back ${carried} times`, whereOf(t)].filter(Boolean).join(', ')
                return (
                  <li key={t.id} className={`dr-row${said ? ' is-fixed' : ''}`}>
                    <span className="dr-rowmain">
                      <span className="dr-rowname">{t.title}</span>
                      {sub && <span className="dr-rowsub mono">{sub}</span>}
                    </span>
                    {said
                      ? <span className="dr-said mono">{said}</span>
                      : (
                        <span className="dr-rowacts">
                          <button className="dr-tick" onClick={() => moveTasksToToday([t.id])}>Today</button>
                          <button className="dr-drop" onClick={() => setKeep((k) => new Set(k).add(t.id))}>Keep on list</button>
                          <button className="dr-drop" onClick={() => deleteTask(t.id)}>Drop</button>
                        </span>
                      )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {stage === 'today' && (
          <div className="dr-stage">
            <h1>{todayTasks.length || events.length ? 'What is in front of you.' : 'Nothing planned.'}</h1>
            {(events.length > 0 || todayTasks.length > 0) && (
              <ul className="dr-list dr-plain">
                {events.slice(0, 4).map((e, i) => (
                  <li key={e.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <span className="mono dr-at">{e.start}</span> {e.title}
                  </li>
                ))}
                {todayTasks.slice(0, 6).map((t, i) => (
                  <li key={t.id} style={{ animationDelay: `${(Math.min(events.length, 4) + i) * 50}ms` }}>
                    {t.title}
                    {t.estimated && t.estimateMin > 0 && <span className="mono dr-at"> {fmtDuration(t.estimateMin)}</span>}
                  </li>
                ))}
                {todayTasks.length > 6 && <li className="dr-more">and {todayTasks.length - 6} more</li>}
              </ul>
            )}
            {goalsDue.length > 0 && (
              <p className="dr-fact mono">
                {goalsDue.length === 1
                  ? `${goalsDue[0].name}, due ${goalsDue[0].deadline === today ? 'today' : 'this week'}`
                  : `${goalsDue.length} goals due this week`}
              </p>
            )}
          </div>
        )}

        {stage === 'close' && (
          <div className="dr-stage">
            {/* The headline may not argue with the line under it. If something
                is still waiting, that IS the headline. */}
            <h1>
              {stillOpen > 0
                ? `${stillOpen} still waiting.`
                : putRight > 0 ? 'The record is straight.' : 'Nothing was hanging.'}
            </h1>
            {(putRight > 0 || owned > 0) && (
              <p className="dr-fact mono">
                {[putRight > 0 && `${putRight} put right`, owned > 0 && `${owned} owned up to`].filter(Boolean).join(', ')}
              </p>
            )}
            {/* Naming a number he cannot act on is a vanity metric. If something
                is waiting, it gets named, and the foot gets a way back to it. */}
            {waiting.length > 0 && (
              <ul className="dr-list dr-plain dr-waiting">
                {waiting.slice(0, 5).map((w, i) => (
                  <li key={w.id} style={{ animationDelay: `${i * 50}ms` }}>
                    {w.name}
                    {/* Two habits can be called the same thing in two
                        workspaces, and on this screen nothing else tells
                        them apart. */}
                    {w.where && <span className="mono dr-at"> {w.where}</span>}
                  </li>
                ))}
                {waiting.length > 5 && <li className="dr-more">and {waiting.length - 5} more</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* The forward action lives in the foot, so it is reachable at any list
          length and on a landscape phone, where it used to sit underneath the
          footer with Back printed across it. */}
      <div className="dr-foot">
        {/* Leaving lives on the left with Back. Beside Next, on a 390px screen,
            abandoning the review and advancing it were the same gesture. */}
        <div className="dr-footleft">
          {(at > 0 && stage !== 'close') || (stage === 'close' && stillOpen > 0)
            ? <button className="dr-back" onClick={back}>Back</button>
            : null}
          {stage !== 'ask' && stage !== 'close' && <button className="dr-skip" onClick={() => leave(false)}>Close</button>}
        </div>
        <div className="dr-footacts">
          {stage === 'ask' && <button className="dr-skip" onClick={() => leave(false)}>Not today</button>}
          {stage === 'today' && (
            <button className="dr-skip" onClick={() => { closeDaily(true); setPage('plan') }}>Open the plan</button>
          )}
          <button className="btn btn-primary dr-go" onClick={primary.run}>{primary.label}</button>
        </div>
      </div>
    </div>
  )
}
