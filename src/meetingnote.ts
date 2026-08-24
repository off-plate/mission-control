/* Turning a meeting into a note he does not have to name.

   His problem, in his words: he got stuck twice in one day just deciding what
   to call the note. That is the whole target. Everything here exists to make
   the naming decision disappear, and nothing here invents content.

   His call on the shape, and it is the right one: the title carries the name
   AND the date, the body carries the people, and there is no skeleton of empty
   headings. A meeting the app knows nothing about does not get "Decisions /
   Actions / Open questions" pre-written into it, because that is scaffolding
   he then has to delete, which is a second decision rather than none. */

import type { CalEvent } from './ical'

/** 24. 8., the way a Czech calendar writes it. */
function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })
}

/** The note's first line, which is its title on the Notes page. */
export function meetingTitle(e: CalEvent): string {
  return `${e.title}, ${shortDate(e.day)}`
}

/** A stable mark tying a note to the meeting it was written for, so the app can
 *  tell one he has already written up from one he has not, and never offers the
 *  same meeting twice. Kept as an HTML comment: invisible in the editor, and it
 *  survives the markdown round trip. */
export const meetingMark = (uid: string) => `<!-- meeting:${uid} -->`
export function meetingUidOf(body: string): string | null {
  const m = body.match(/<!--\s*meeting:(.+?)\s*-->/)
  return m ? m[1].trim() : null
}

/**
 * The whole note, as markdown. Title line, then who was there, then a blank
 * line for him to start on. Nothing else: no headings he did not ask for, no
 * agenda invented out of a meeting title, no placeholder prose.
 */
export function meetingNote(e: CalEvent): string {
  const lines: string[] = [meetingTitle(e)]
  lines.push('')
  if (e.people.length) lines.push(e.people.map((p) => `**${p}**`).join(', '))
  if (e.link) lines.push(`[${new URL(e.link).hostname.replace(/^www\./, '')}](${e.link})`)
  else if (e.where) lines.push(e.where)
  if (e.people.length || e.link || e.where) lines.push('')
  /* The cursor lands here, on an empty bullet, because the next thing that
     happens is him typing what was said. */
  lines.push('- ')
  lines.push('')
  lines.push(meetingMark(e.uid))
  return lines.join('\n')
}

/** Which meeting the app should offer to write up, right now.
 *  Running > about to start > the one just finished, and nothing at all if he
 *  has already written that one up. */
export function meetingToWriteUp(
  events: CalEvent[],
  writtenUids: Set<string>,
  now: Date,
): { event: CalEvent; state: 'now' | 'next' | 'just-ended' } | null {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const mins = now.getHours() * 60 + now.getMinutes()
  const todays = events
    .filter((e) => e.day === day && !e.allDay && e.start !== null && !writtenUids.has(e.uid))
    .sort((a, b) => (a.start as number) - (b.start as number))

  const running = todays.find((e) => (e.start as number) <= mins && mins < (e.end ?? (e.start as number) + 60))
  if (running) return { event: running, state: 'now' }
  /* Half an hour ahead: far enough to prepare, close enough that it is the
     meeting he is actually thinking about. */
  const soon = todays.find((e) => (e.start as number) > mins && (e.start as number) - mins <= 30)
  if (soon) return { event: soon, state: 'next' }
  /* And the one that just ended, because writing it up afterwards is the other
     half of the problem he described. */
  const ended = [...todays].reverse().find((e) => {
    const end = e.end ?? (e.start as number) + 60
    return end <= mins && mins - end <= 30
  })
  if (ended) return { event: ended, state: 'just-ended' }
  return null
}
