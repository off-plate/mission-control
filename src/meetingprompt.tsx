import { useMemo } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { meetingNote, meetingToWriteUp, meetingUidOf, shortDate } from './meetingnote'
import { localDateKey } from './util'
import { spaceFolderId } from './types'

/* The thing this whole calendar was built for.

   His problem, in his words: he got stuck twice in one day just deciding what
   to call a meeting note. Not writing it, NAMING it. So this does not offer to
   help him write anything. It removes one decision and gets out of the way.

   It is one of two things, always: the meeting running right now, or the very
   next one on the calendar, however far off. Deliberately always-on now, on
   his instruction (2026-08-27): a 30-minute cap on "next" meant a free
   afternoon before an evening meeting showed nothing at all, which was the
   opposite of the point. Never one he has already written up, which the uid
   buried in the note body settles. */

const HM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function MeetingPrompt() {
  const { notes, addNote, openNote, space } = useStore()
  const { state } = useCalendar()

  const found = useMemo(
    () => (state.status === 'ok' ? meetingToWriteUp(state.events, new Date()) : null),
    [state],
  )

  /* The note for THIS meeting, if he has already made it. Matched on the uid
     buried in the body, which is what ties a note to a meeting across renames:
     he can retitle the note to anything and this still finds it. */
  const already = useMemo(
    () => (found ? notes.find((n) => meetingUidOf(n.body) === found.event.uid) : undefined),
    [notes, found],
  )

  if (!found) return null

  const { event: e, state: when } = found
  /* "Next" can now be tomorrow or later, so the time alone would lie about
     which day it names. The date only appears when it is not today. */
  const said =
    when === 'now' ? `In ${e.title} until ${HM(e.end ?? (e.start as number))}`
      : e.day === localDateKey() ? `${e.title} at ${HM(e.start as number)}`
        : `${e.title}, ${shortDate(e.day)} at ${HM(e.start as number)}`

  return (
    <div className="meet-prompt">
      <span className="meet-when mono">{when === 'now' ? 'now' : 'next'}</span>
      <span className="meet-what">{said}</span>
      {/* One button, two jobs, and it names the one it is doing. Writing it up
          does not make the row disappear any more, so the second press has to
          take him to the note, and never silently make a duplicate. */}
      <button
        className="btn btn-primary meet-go"
        onClick={() => (already ? openNote(already.id) : openNote(addNote(spaceFolderId(space), meetingNote(e))))}
      >{already ? 'Open the note' : 'Write it up'}</button>
    </div>
  )
}
