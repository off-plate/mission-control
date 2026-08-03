import { useStore } from './store'
import { Linkify } from './widgets'
import { Band, SpaceMark } from './pages1'
import { fmtDuration, localDateKey } from './util'
import { quitKeptDays, slipDays } from './types'

/* ---------------- ONE DAY OF THE RECORD ----------------

   "How can I see previously done days?" had no answer: the day list was the only
   place a day existed, and it was overwritten by the next one. Everything here
   was already on disk with a date on it, addressed by nothing.

   This page is read-only on purpose. A day that has passed is a record, and a
   record you can edit is not one. It reads from the same logs every other page
   reads, so it can never disagree with them. */

const shiftDay = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return localDateKey(new Date(y, m - 1, d + by))
}

const longDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function DayPage() {
  const {
    dayKey, openDay, setPage, inView,
    ledger, habits, habitLog, routines, routineLog, focusSessions, slips, stepLog, coachSessions,
  } = useStore()
  const day = dayKey ?? localDateKey()
  const today = localDateKey()

  const focus = focusSessions.filter((f) => f.day === day && inView(f.space))
  /* A focus block writes its own ledger row so its minutes are counted once.
     That row is TIME, not a finished task: listed under Finished it inflated
     the count and made this page disagree with Plan about the same day. The
     blocks have their own panel below. */
  const fromFocus = new Set(focusSessions.map((f) => f.ledgerId).filter(Boolean) as string[])
  const finished = ledger.filter((e) => e.when === day && inView(e.space) && !fromFocus.has(e.id))
  const focusMin = focus.reduce((a, f) => a + f.minutes, 0)

  /* A habit he has since retired still kept the days he kept it. Deleting the
     row used to take the name with it, which is the exact erasure archiving
     exists to prevent, so retired habits are read here too and say so. */
  const keptHabits = habits.filter((h) => {
    if (!inView(h.space)) return false
    if (h.archivedAt && h.archivedAt < day) return false
    return h.kind === 'break'
      ? quitKeptDays(h, slips, day, day).has(day)
      : habitLog.some((t) => t.habitId === h.id && t.day === day)
  })
  const slippedHabits = habits.filter((h) => inView(h.space) && slipDays(slips, h.id).has(day))
  const doneRoutines = routineLog
    .filter((r) => r.day === day)
    .map((r) => routines.find((x) => x.id === r.routineId))
    .filter((r) => r && inView(r.space))
  const numbers = stepLog.filter((e) => e.day === day)
  const faced = coachSessions.filter((c) => c.when === day && inView(c.space))

  const anything = finished.length || keptHabits.length || slippedHabits.length || doneRoutines.length || focus.length || numbers.length || faced.length
  const savedMin = finished.reduce((a, e) => a + (e.estimateMin - e.actualMin), 0)
  /* "2, 0h 10m against the estimates" was a count, a comma and a signed duration
     pretending to be a sentence. Say the direction in a word. */
  const against = savedMin === 0 ? 'level with the estimates'
    : savedMin > 0 ? `${fmtDuration(savedMin)} under the estimates`
    : `${fmtDuration(-savedMin)} over the estimates`

  return (
    <div className="page day-page">
      <Band
        title={longDate(day)}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => openDay(shiftDay(day, -1))} aria-label="The day before">←</button>
            <button className="btn btn-ghost" disabled={shiftDay(day, 1) > today} onClick={() => openDay(shiftDay(day, 1))} aria-label="The day after">→</button>
            <button className="btn btn-primary" onClick={() => setPage('today')}>Back to today</button>
          </>
        }
      />

      {!anything && (
        <div className="empty">
          Nothing was logged on this day. That is all it means: the record is empty, not the day.
        </div>
      )}

      {finished.length > 0 && (
        <div className="panel day-panel">
          <div className="day-head">
            <span className="microcap">Finished</span>
            <span className="day-fig mono">{finished.length} finished, {against}</span>
          </div>
          <div className="day-rows">
            {finished.map((e) => (
              <div className="day-row" key={e.id}>
                <SpaceMark space={e.space} />
                <span className="day-row-title">{e.title}</span>
                <span className="day-row-fig mono">{fmtDuration(e.actualMin)} of {fmtDuration(e.estimateMin)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(keptHabits.length > 0 || slippedHabits.length > 0) && (
        <div className="panel day-panel">
          <div className="day-head">
            <span className="microcap">Habits</span>
            <span className="day-fig mono">{keptHabits.length} kept</span>
          </div>
          <div className="day-rows">
            {keptHabits.map((h) => (
              <div className="day-row" key={h.id}>
                <SpaceMark space={h.space} />
                <span className="day-row-title">{h.name}</span>
                {h.archivedAt && <span className="day-tag">retired</span>}
              </div>
            ))}
            {slippedHabits.map((h) => (
              <div className="day-row is-slip" key={`s${h.id}`}>
                <SpaceMark space={h.space} />
                <span className="day-row-title">{h.name}</span>
                <span className="day-row-fig mono">slipped</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {doneRoutines.length > 0 && (
        <div className="panel day-panel">
          <div className="day-head">
            <span className="microcap">Routines</span>
            <span className="day-fig mono">{doneRoutines.length} finished</span>
          </div>
          <div className="day-rows">
            {doneRoutines.map((r) => (
              <div className="day-row" key={r!.id}>
                <SpaceMark space={r!.space} />
                <span className="day-row-title">{r!.title}</span>
                {r!.archivedAt && <span className="day-tag">retired</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {focus.length > 0 && (
        <div className="panel day-panel">
          <div className="day-head">
            <span className="microcap">Focus</span>
            <span className="day-fig mono">{fmtDuration(focusMin)} over {focus.length} {focus.length === 1 ? 'block' : 'blocks'}</span>
          </div>
          <div className="day-rows">
            {focus.map((f) => (
              <div className="day-row" key={f.id}>
                <SpaceMark space={f.space} />
                <span className="day-row-title"><Linkify text={f.label ?? 'Focus block'} /></span>
                <span className="day-row-fig mono">{fmtDuration(f.minutes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {numbers.length > 0 && (
        <div className="panel day-panel">
          <div className="day-head"><span className="microcap">Numbers</span></div>
          <div className="day-rows">
            {numbers.map((e) => (
              <div className="day-row" key={`${e.routineId}${e.stepId}`}>
                <span className="day-row-title">
                  {routines.find((r) => r.id === e.routineId)?.steps.find((s) => s.id === e.stepId)?.title
                    ?? routines.find((r) => r.id === e.routineId)?.title
                    ?? 'A routine step'}
                </span>
                <span className="day-row-fig mono">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {faced.length > 0 && (
        <div className="panel day-panel">
          <div className="day-head"><span className="microcap">Faced</span></div>
          <div className="day-rows">
            {faced.map((c) => (
              <div className="day-row" key={c.id}>
                <SpaceMark space={c.space} />
                <span className="day-row-title">{c.title}</span>
                <span className="day-row-fig mono">{c.didIt ? (c.felt === 'easier' ? 'easier than feared' : c.felt === 'harder' ? 'harder' : 'as feared') : 'still open'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="day-foot">
        {/* Today has not passed; telling him it had made the sentence a lie on
            the one day he opens most. */}
        {day === localDateKey()
          ? 'Today is still being written; this page is its record so far.'
          : 'A day that has passed is a record, so nothing on it can be changed here.'}{' '}
        <button className="linkish" onClick={() => openDay(shiftDay(day, -1))}>The day before</button>
      </p>
    </div>
  )
}
