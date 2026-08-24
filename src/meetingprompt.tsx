import { useMemo } from 'react'
import { useStore } from './store'
import { useCalendar } from './calendar'
import { meetingNote, meetingToWriteUp, meetingUidOf } from './meetingnote'
import { spaceFolderId } from './types'

/* The thing this whole calendar was built for.

   His problem, in his words: he got stuck twice in one day just deciding what
   to call a meeting note. Not writing it, NAMING it. So this does not offer to
   help him write anything. It removes one decision and gets out of the way.

   It only appears when there is a meeting worth naming: one running, one about
   to start, or one that just ended. Never a general "want to make a note?",
   because a prompt that is always there is furniture, and furniture is
   ignored. And never one he has already written up, which the uid buried in
   the note body settles. */

const HM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function MeetingPrompt() {
  const { notes, addNote, openNote, space } = useStore()
  const { state } = useCalendar()

  const written = useMemo(() => {
    const s = new Set<string>()
    for (const n of notes) { const uid = meetingUidOf(n.body); if (uid) s.add(uid) }
    return s
  }, [notes])

  const found = useMemo(
    () => (state.status === 'ok' ? meetingToWriteUp(state.events, written, new Date()) : null),
    [state, written],
  )
  if (!found) return null

  const { event: e, state: when } = found
  const said =
    when === 'now' ? `In ${e.title} until ${HM(e.end ?? (e.start as number))}`
      : when === 'next' ? `${e.title} at ${HM(e.start as number)}`
        : `${e.title} just finished`

  return (
    <div className="meet-prompt">
      <span className="meet-when mono">{when === 'now' ? 'now' : when === 'next' ? 'next' : 'just ended'}</span>
      <span className="meet-what">{said}</span>
      <button
        className="btn btn-primary meet-go"
        onClick={() => openNote(addNote(spaceFolderId(space), meetingNote(e)))}
      >Write it up</button>
    </div>
  )
}
