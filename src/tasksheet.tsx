import { useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as Icon from './icons'
import { useStore } from './store'
import { slideOut, useSwipeDown } from './sheetdrag'
import { toneOf, tagOf } from './tags'
import { daysSince } from './health'
import { SPACE_LABELS } from './exceptions'
import { SLOTS, SPACES, type Task, type TimeSlot } from './types'
import { PLAN_AHEAD_DAYS, dayPlus } from './weekgrid'
import { fmtDuration, isEstimated, localDateKey, taskMinutes } from './util'

/* A TASK, ON THE PHONE (his ask, 2026-10-26: "completely redesign that
   section"). Tapping a task opens this instead of a kebab list of text rows.
   Built in the Habits sheet's language so the two read as one app: the main
   act is one big button, the next three are tiles, and every choice is a
   control you can see the current value of (which day, which part of the day,
   which project), not a list of "Move to ..." sentences. */
export function TaskSheet({ task, onClose, onDone, onEdit, onBreakdown, onFocus, onPlaced }: {
  task: Task
  onClose: () => void
  /** Day tasks ask how long they took; the list just ticks. */
  onDone: () => void
  onEdit: () => void
  onBreakdown: () => void
  onFocus?: () => void
  /** Tells Plan which day the task went to, so its day panel follows. */
  onPlaced: (offset: number) => void
}) {
  const { projects, toggleTask, moveTasksToToday, moveTaskList, assignSlot, setTaskAt, setTaskProject, setTaskSpace, deleteTask } = useStore()
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const close = useCallback(() => slideOut(sheetRef.current, scrimRef.current, () => closeRef.current()), [])
  useSwipeDown(sheetRef, close)

  const t = task
  const today = localDateKey()
  const onDay = t.list === 'today' ? (t.plannedOn ?? today) : null
  const project = t.projectId ? projects.find((p) => p.id === t.projectId) : undefined
  const inSpace = projects.filter((p) => p.space === t.space)
  const age = t.createdAt ? daysSince(t.createdAt) : 0
  const days = Array.from({ length: PLAN_AHEAD_DAYS + 1 }, (_, n) => ({ n, key: dayPlus(n) }))
  const dayName = (n: number, key: string) => n === 0 ? 'Today' : n === 1 ? 'Tmrw' : new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })

  const placeOn = (n: number) => { moveTasksToToday([t.id], dayPlus(n)); onPlaced(n) }
  const placeIn = (slot: TimeSlot) => {
    if (!onDay) { moveTaskList(t.id, 'today', today); onPlaced(0) }
    assignSlot(t.id, t.slot === slot && onDay ? undefined : slot)
  }
  const backToList = () => { moveTaskList(t.id, 'backlog'); assignSlot(t.id, undefined); setTaskAt(t.id, undefined) }
  const act = (f: () => void) => () => { f(); close() }

  return createPortal(
    <div className="hk" style={{ display: 'contents' }}>
      <div ref={scrimRef} className="hk-scrim" onClick={close} />
      <div ref={sheetRef} className="hk-sheet ts-sheet" role="dialog" aria-modal="true" aria-label={t.title} style={{ ['--c' as string]: 'var(--hk-accent)' }}>
        <div className="hk-grab" aria-hidden="true" />

        <h3 className="ts-title">{t.title}</h3>
        <div className="ts-meta">
          {project && <span className={`ts-chip tt${toneOf(project, projects)}`}>#{tagOf(project)}</span>}
          {isEstimated(t) && <span className="ts-chip"><Icon.Clock size={13} />{fmtDuration(taskMinutes(t))}</span>}
          {onDay && <span className="ts-chip">{onDay === today ? 'Today' : new Date(`${onDay}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })}{t.slot ? `, ${SLOTS.find((s) => s.id === t.slot)?.label}` : ''}</span>}
          {!onDay && age > 0 && <span className="ts-chip">On the list {age === 1 ? '1 day' : `${age} days`}</span>}
        </div>

        <button className={`hk-bigbtn ts-done${t.done ? ' is-undo' : ''}`} onClick={act(t.done ? () => toggleTask(t.id) : onDone)}>
          <Icon.Check size={20} strokeWidth={3} />{t.done ? 'Not done yet' : 'Mark done'}
        </button>

        {!t.done && (
          <div className="ts-tiles">
            {onFocus && <button onClick={act(onFocus)}><Icon.Focus size={20} /><span>Focus</span></button>}
            <button onClick={act(onEdit)}><Icon.Edit size={20} /><span>Edit</span></button>
            <button onClick={act(onBreakdown)}><Icon.List size={20} /><span>Break down</span></button>
          </div>
        )}

        {!t.done && (
          <>
            <div className="hk-field"><label>Plan for</label>
              <div className="ts-days" role="group" aria-label="Plan for a day">
                {days.map(({ n, key }) => (
                  <button key={key} aria-pressed={onDay === key} onClick={() => placeOn(n)}>
                    <small>{dayName(n, key)}</small><b>{Number(key.slice(8))}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="hk-field"><label>{onDay && onDay !== today ? 'Time of day' : 'Time of day, today'}</label>
              <div className="ts-slots">
                {SLOTS.map((sl) => (
                  <button key={sl.id} aria-pressed={!!onDay && t.slot === sl.id} onClick={() => placeIn(sl.id)}>
                    <b>{sl.label}</b><small>{sl.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {inSpace.length > 0 && (
          <div className="hk-field"><label>Project</label>
            <div className="ts-chips">
              <button aria-pressed={!t.projectId} onClick={() => setTaskProject(t.id, undefined)}>None</button>
              {inSpace.map((p) => (
                <button key={p.id} aria-pressed={t.projectId === p.id} onClick={() => setTaskProject(t.id, p.id)}>
                  <i className={`ts-dot tt${toneOf(p, projects)}`} aria-hidden="true" />{p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="hk-field"><label>Workspace</label>
          <div className="hk-seg">
            {SPACES.map((s) => <button key={s} aria-pressed={t.space === s} onClick={() => setTaskSpace(t.id, s)}>{SPACE_LABELS[s]}</button>)}
          </div>
        </div>

        <div className="ts-foot">
          {onDay && !t.done && <button className="ts-link" onClick={act(backToList)}>Back to the list</button>}
          <button className="ts-link is-danger" onClick={act(() => deleteTask(t.id))}>Delete task</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
