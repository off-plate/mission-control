/* THE ZONE, fifth pass: deep water.

   The four bordered tiles are gone. His words: "it's sort of very plain...
   I want this page to be completely different... it really has to be THE
   ZONE." The four-card grid was the plain part, because a dashboard is what
   you look AT and this is a room you are meant to be IN. So: one field, no
   card chrome, the countdown as the only object with real presence, and the
   note and the player as quiet surfaces sitting directly on the water.

   The colour is not decoration either. `--depth` (below) is the real
   elapsed share of the running block, and the room's ground is mixed from
   it, so twenty minutes in is visibly deeper water than the moment he sat
   down. Nothing fades that he has to read: bone on darker water gains
   contrast as it deepens, it never loses it.

   Type is Array for the countdown alone, a dot-matrix face that turns the
   number into an instrument rather than a label, over Technor for
   everything around it. Both checked against design-log.md first: the
   near-black-plus-orange this replaces was simultaneously one of the three
   named 2026 AI defaults and next door to a row already spent on a client
   site, which is exactly why it read like every other focus timer. */

import { useEffect, useRef, useState } from 'react'
import { useClockStamp, useFirstMove, useOpenToday } from './ui'
import { usePomodoro } from './pomodoro'
import { ZonePlayer, ZoneQueue } from './zoneplayer'
import { useStore } from './store'
import { SPACE_LABELS } from './mock'
import { isEstimated, localDateKey, taskMinutes } from './util'
import { SLOTS, type Task } from './types'
import * as Icon from './icons'

/* Minutes padded to two digits, unlike everywhere else in the app: this one
   is a read-out on a dial, and a departure board never drops a digit. Without
   the pad the instrument physically shrank from five glyphs to four as the
   block passed ten minutes left. */
const mmss = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`

function EyeIcon() {
  return (
    <Icon.Eye size={22} />
  )
}
function CupIcon() {
  return (
    <Icon.Cup size={22} />
  )
}
function CheckRing() {
  return (
    <Icon.CheckRing size={22} />
  )
}
function FlagIcon() {
  return (
    <Icon.Flag size={22} />
  )
}
function GearIcon() {
  return (
    <Icon.Settings size={17} />
  )
}
function StopIcon() {
  return (
    <Icon.Square size={15} filled />
  )
}
function CloseIcon() {
  return (
    <Icon.Close size={17} />
  )
}
function BackIcon() {
  return (
    <Icon.ChevronLeft size={17} />
  )
}
function ChevronIcon() {
  return (
    <Icon.ChevronDown size={13} />
  )
}
function CheckIcon() {
  return (
    <Icon.Check size={14} strokeWidth={2.4} />
  )
}

/* TODAY'S LIST, IN THE ROOM. His ask (2026-09-10): the top half split, with
   what he planned for today on the left of the instrument. It mirrors Today
   for the workspace he is standing in -- the same rows, the same slots, the
   same tick -- because a second list that could disagree with that one is
   worse than no list.

   It carries the two things he asked for and nothing else: pick what the
   timer is pointed at, and tick a task off without leaving the room. */
function ZoneList({ activeId, onPick }: { activeId: string | null; onPick: (id: string) => void }) {
  const { tasks, inView, toggleTask, toggleSubtask, space } = useStore()
  const today = localDateKey()
  /* His ask (2026-09-11): see a task's steps in here too. The one the timer is
     pointed at opens on its own, because that is the task he is actually
     working and its steps are the next thing he needs; everything else opens
     on a click, so a day of broken-down tasks does not bury the list. An entry
     here overrides that default in either direction. */
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const stepsShown = (t: Task) => override[t.id] ?? (activeId === t.id)
  const toggleSteps = (t: Task) => setOverride((o) => ({ ...o, [t.id]: !stepsShown(t) }))
  const mine = tasks
    .filter((t) => inView(t.space) && t.list === 'today' && (t.plannedOn ?? today) === today)
    .sort((a, b) => (Number(a.done) - Number(b.done)) || SLOT_ORDER(a.slot) - SLOT_ORDER(b.slot))

  const bySlot = new Map<string, Task[]>()
  for (const t of mine) {
    const key = t.done ? 'done' : (t.slot ?? 'unslotted')
    const list = bySlot.get(key)
    if (list) list.push(t); else bySlot.set(key, [t])
  }
  const order = [...SLOTS.map((s) => s.id as string), 'unslotted', 'done']
  const groups = order.filter((k) => bySlot.has(k)).map((k) => [k, bySlot.get(k) as Task[]] as const)

  const left = mine.filter((t) => !t.done).length

  return (
    <div className="zlist">
      <div className="zlist-head">
        <span className="zlist-title">Today</span>
        <span className="zlist-count">{left ? `${left} left` : 'all done'}</span>
      </div>
      {mine.length === 0 ? (
        <p className="zlist-empty">Nothing on today's list in {SPACE_LABELS[space] ?? 'this workspace'}.</p>
      ) : (
        <div className="zlist-body">
          {groups.map(([key, rows]) => (
            <div className="zlist-group" key={key}>
              <span className="zlist-slot">{key === 'done' ? 'Done' : key === 'unslotted' ? 'Anytime' : SLOTS.find((s) => s.id === key)?.label ?? key}</span>
              {rows.map((t) => {
                const steps = t.subtasks ?? []
                const doneSteps = steps.filter((s) => s.done).length
                const showSteps = steps.length > 0 && stepsShown(t)
                return (
                  <div key={t.id} className={`zrow-wrap${showSteps ? ' has-steps' : ''}`}>
                    <div className={`zrow${t.done ? ' is-done' : ''}${activeId === t.id ? ' is-active' : ''}`}>
                      <button
                        className="zrow-tick"
                        role="checkbox"
                        aria-checked={!!t.done}
                        aria-label={t.done ? `Reopen ${t.title}` : `Finish ${t.title}`}
                        onClick={() => toggleTask(t.id)}
                      >
                        {t.done && <CheckIcon />}
                      </button>
                      <button
                        className="zrow-pick"
                        onClick={() => onPick(t.id)}
                        disabled={t.done}
                        title={t.done ? undefined : 'Point the timer at this'}
                      >
                        <span className="zrow-title">{t.title}</span>
                        {isEstimated(t) && t.estimateMin > 0 && <span className="zrow-min mono">{taskMinutes(t)}m</span>}
                      </button>
                      {steps.length > 0 && (
                        <button
                          className={`zrow-steps${showSteps ? ' is-open' : ''}`}
                          onClick={() => toggleSteps(t)}
                          aria-expanded={showSteps}
                          aria-label={`${showSteps ? 'Hide' : 'Show'} the ${steps.length} steps of ${t.title}`}
                        >
                          <span className="mono">{doneSteps}/{steps.length}</span>
                          <ChevronIcon />
                        </button>
                      )}
                    </div>
                    {showSteps && (
                      <div className="zsteps">
                        {steps.map((s) => (
                          <div key={s.id} className={`zsub${s.done ? ' is-done' : ''}`}>
                            <button
                              className="zsub-tick"
                              role="checkbox"
                              aria-checked={s.done}
                              aria-label={s.done ? `Reopen ${s.title}` : `Finish ${s.title}`}
                              onClick={() => toggleSubtask(t.id, s.id)}
                            >
                              {s.done && <CheckIcon />}
                            </button>
                            <span className="zsub-title">{s.title}</span>
                            {s.estimateMin > 0 && <span className="zsub-min mono">{s.estimateMin}m</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const SLOT_ORDER = (slot?: string) => {
  const i = SLOTS.findIndex((s) => s.id === slot)
  return i < 0 ? SLOTS.length : i
}

type PhaseState = 'running' | 'paused' | 'break' | 'done' | 'idle'

function PhaseIcon({ state }: { state: PhaseState }) {
  if (state === 'break') return <CupIcon />
  if (state === 'done') return <CheckRing />
  if (state === 'idle') return <FlagIcon />
  return <EyeIcon />
}

function ZoneTask() {
  const pomo = usePomodoro()
  const { setFocusTaskId } = useStore()
  const firstMove = useFirstMove()
  const openToday = useOpenToday()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<'focus' | 'break' | null>(null)
  // A hand pick overrides the auto first-move; it clears itself the moment
  // that task leaves today's open list (finished, or dropped from today),
  // rather than pointing at something that no longer exists.
  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosenTask = chosenId ? openToday.find((t) => t.id === chosenId) : undefined
  const activeTask = chosenTask ?? firstMove

  const phaseState: PhaseState =
    pomo.phase === 'await' ? 'done' :
    pomo.phase === 'break' ? 'break' :
    pomo.phase === 'focus' ? (pomo.running ? 'running' : 'paused') :
    'idle'

  const pct =
    pomo.phase === 'focus' ? 1 - pomo.secondsLeft / Math.max(1, pomo.blockMin * 60) :
    pomo.phase === 'break' ? 1 - pomo.secondsLeft / Math.max(1, pomo.breakMin * 60) :
    pomo.phase === 'await' ? 1 : 0

  const label = { running: 'Focus', paused: 'Paused', break: 'Break', done: 'Done', idle: activeTask ? 'Ready' : 'Nothing lined up' }[phaseState]

  const title =
    pomo.phase === 'focus' || pomo.phase === 'await' ? (pomo.focusLabel ?? 'Focus block') :
    pomo.phase === 'break' ? 'Short break' :
    activeTask ? activeTask.title : 'Plan has nothing on today’s list yet.'

  // The about-to-start duration shown while idle has to match what pressing
  // Start actually does: the task's own estimate when it has one, the
  // default setting when it doesn't. Never a number Start then contradicts.
  const idleMin = activeTask && isEstimated(activeTask) && activeTask.estimateMin > 0 ? taskMinutes(activeTask) : pomo.focusMin
  const clockText = phaseState === 'done' ? 'done' : phaseState === 'idle' ? mmss(idleMin * 60) : mmss(pomo.secondsLeft)

  const filledDots = pomo.cyclesDone % 4 === 0 && pomo.cyclesDone > 0 ? 4 : pomo.cyclesDone % 4
  const r = 44
  const c = 2 * Math.PI * r

  const start = () => {
    if (activeTask) {
      pomo.startFocus(isEstimated(activeTask) && activeTask.estimateMin > 0 ? taskMinutes(activeTask) : undefined, activeTask.title)
      setFocusTaskId(activeTask.id)
    } else {
      pomo.startFocus()
    }
  }

  /* Picking from the list. Idle, it simply becomes what Start will run. Mid
     block it does NOT silently re-point the timer -- minutes already banked
     belong to the task they were spent on -- so it is held as what comes next
     and the room says so. */
  const pick = (id: string) => {
    /* Picking the one already picked hands the room back to the auto choice.
       That option used to be a row in a sheet; the list on the left is the
       picker now, so it is a toggle rather than a second control. */
    setChosenId((prev) => (prev === id ? null : id))
  }
  const queued = phaseState !== 'idle' && chosenTask && chosenTask.title !== pomo.focusLabel ? chosenTask : null

  return (
    <div className={`znow zn-${phaseState}`}>
      <div className="znow-split">
      <ZoneList activeId={activeTask?.id ?? null} onPick={pick} />
      <div className="znow-main">
      {/* The band: what he is on, and the real hour, set as type on the field
          rather than boxed. The hour earns its place here because the whole
          point of this room is losing track of it. */}
      <header className="znow-band">
        <div className="znow-what">
          {/* The phase glyph sits INSIDE the title line, not as an all-caps
              tracked word above it. That eyebrow was the one shape the house
              rules forbid outright, and it carried nothing: the ring's colour
              and the button's verb already say the state, and in the empty
              case it read "Nothing lined up" directly above a title saying
              the same sentence again. */}
          {/* Long titles get smaller type, not fewer characters. A pasted URL
              can run to seven lines at display size and swallow the room, and
              the answer to that is to fit it, not to cut it: he asked for a
              long title to be HANDLED, and an ellipsis through the middle of
              an address hides exactly the part worth reading. */}
          <h1
            className="znow-title"
            data-len={title.length > 120 ? 'xl' : title.length > 60 ? 'l' : undefined}
            title={title}
          >
            <PhaseIcon state={phaseState} />
            <span>{title}</span>
          </h1>
        </div>
        <ZoneClock />
      </header>

      <div className="znow-face-wrap">
        <div className="znow-face">
          <svg className="zring" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="zring-track" cx="50" cy="50" r={r} />
            {phaseState !== 'idle' && (
              <circle
                className="zring-fill" cx="50" cy="50" r={r}
                style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(1, Math.max(0, pct))) }}
              />
            )}
          </svg>
          <div className="znow-center">
            <span className="znow-clock">{clockText}</span>
            <div className="znow-dots" title={`${filledDots} of 4 blocks done today`} aria-label={`${filledDots} of 4 blocks done today`}>
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < filledDots ? 'is-on' : ''} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="znow-actions">
        {(phaseState === 'running' || phaseState === 'paused' || phaseState === 'break') && (
          <button className="znow-icon" onClick={pomo.stop} aria-label="Stop this block"><StopIcon /></button>
        )}
        {phaseState === 'idle' && (
          <button className="znow-pill" onClick={start}>Start</button>
        )}
        {(phaseState === 'running' || phaseState === 'paused' || phaseState === 'break') && (
          <button className="znow-pill" onClick={pomo.toggle}>{phaseState === 'paused' ? 'Resume' : 'Pause'}</button>
        )}
        {phaseState === 'done' && <span className="znow-pill is-done">Banked</span>}
        <button
          className="znow-icon" aria-expanded={settingsOpen} aria-label="Timer settings"
          onClick={() => { setSettingsOpen((v) => !v); setEditing(null) }}
        >
          <GearIcon />
        </button>
      </div>
      {queued && (
        <p className="znow-queued">
          Next up <b>{queued.title}</b>
          <button onClick={() => { pomo.startFocus(isEstimated(queued) && queued.estimateMin > 0 ? taskMinutes(queued) : undefined, queued.title); setFocusTaskId(queued.id) }}>
            Switch now
          </button>
        </p>
      )}
      </div>
      </div>
      {settingsOpen && (
        <div className="znow-settings" role="dialog" aria-label="Timer settings">
          {editing === null ? (
            <>
              <div className="znow-settings-head">
                <span>Settings</span>
                <button className="znow-icon" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><CloseIcon /></button>
              </div>
              <button className="znow-settings-row" onClick={() => setEditing('focus')}>
                <span>Focus session</span>
                <span className="mono">{pomo.focusMin}m ›</span>
              </button>
              <button className="znow-settings-row" onClick={() => setEditing('break')}>
                <span>Short break</span>
                <span className="mono">{pomo.breakMin}m ›</span>
              </button>
            </>
          ) : (
            <>
              <div className="znow-settings-head">
                <button className="znow-icon" onClick={() => setEditing(null)} aria-label="Back to settings"><BackIcon /></button>
                <span>{editing === 'focus' ? 'Focus session' : 'Short break'}</span>
              </div>
              <div className="znow-stepper">
                <button
                  aria-label="Less minutes"
                  onClick={() => (editing === 'focus' ? pomo.setFocusMin(Math.max(5, pomo.focusMin - 5)) : pomo.setBreakMin(Math.max(5, pomo.breakMin - 5)))}
                >
                  −
                </button>
                <span className="mono">
                  {editing === 'focus' ? pomo.focusMin : pomo.breakMin}<small>min</small>
                </span>
                <button
                  aria-label="More minutes"
                  onClick={() => (editing === 'focus' ? pomo.setFocusMin(Math.min(90, pomo.focusMin + 5)) : pomo.setBreakMin(Math.min(30, pomo.breakMin + 5)))}
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const DAYPART_LABEL: Record<'morning' | 'day' | 'evening' | 'night', string> = {
  morning: 'Morning', day: 'Afternoon', evening: 'Evening', night: 'Night',
}
function daypart(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'day'
  if (hour < 22) return 'evening'
  return 'night'
}

function ZoneClock() {
  const now = useClockStamp()
  const [part, setPart] = useState(() => daypart(new Date().getHours()))
  useEffect(() => {
    const t = window.setInterval(() => setPart(daypart(new Date().getHours())), 60000)
    return () => window.clearInterval(t)
  }, [])
  /* Type on the field, no card. The gradient card this replaces was one of
     the four tiles that made the room read as a dashboard; the daypart it
     was drawing is kept as a word, which says the same thing in less. */
  return (
    <div className="zclock">
      <span className="zclock-time">{now.time}</span>
      <span className="zclock-date">{now.day} {now.date}<i>{DAYPART_LABEL[part]}</i></span>
    </div>
  )
}

/* How deep into the block he is, 0 to 1. The room's ground colour is mixed
   from this, so twenty minutes in is visibly deeper water than the moment he
   sat down. Real elapsed minutes, nothing decorative: idle and break leave
   the room at the surface, because neither is being deep in anything.

   App.tsx reads this and puts it on the shell, not on the room: the shell is
   the element that paints the water AND holds the header, and a custom
   property set on the room could never have reached it, since they only
   inherit downward. Set here first, it did nothing at all. */
export function useZoneDepth(): number {
  const pomo = usePomodoro()
  if (pomo.phase !== 'focus') return 0
  const elapsed = pomo.blockMin * 60 - pomo.secondsLeft
  return Math.min(1, Math.max(0, elapsed / Math.max(1, pomo.blockMin * 60)))
}

export function ZonePage() {
  /* His instruction (2026-09-12): drop the room's own Note editor -- Note
     already has a home in the floating dock, reopened for the Zone in the
     same change -- and give its spot to the queue instead, since that is
     the thing that actually needed room to grow. The player's transport
     keeps its own slot on the right, unchanged. */
  return (
    <div className="zroom">
      <ZoneTask />
      <div className="zroom-rail">
        <section className="zpanel zpanel-queue" aria-label="Queue"><ZoneQueue /></section>
        <section className="zpanel zpanel-player" aria-label="Mundi Opus"><ZonePlayer /></section>
      </div>
    </div>
  )
}
