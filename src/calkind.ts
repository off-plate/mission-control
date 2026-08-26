/* Is a calendar entry an appointment with other people, or an hour he blocked
   out for himself?

   ITS OWN FILE, with no imports beyond a type, for two reasons. It is the rule
   the assistant's whole account of his day rests on, so it is worth testing on
   its own rather than through a signed-in calendar the tests cannot reach. And
   calendar.ts pulls in React and Supabase, which a rule about a guest list has
   no business needing. */

import type { CalEvent } from './ical'

/** Everything a decision here needs, so a test can state a case in one line. */
export type Entry = Pick<CalEvent, 'allDay' | 'people'> & { link?: string }

/** Other people are in it, and he has to turn up.

    THE DISTINCTION IS IN THE DATA, not in the title. A day of his runs "RVLT
    focus session, gym, timesheet, tech alignment, CTP call, weekly status,
    zero inbox", and calling all seven meetings is how the brief told him his
    morning was full of meetings when four of them were his own time. Guessing
    from words would need a list of every phrase he might ever use for focus,
    and would still call the gym a meeting.

    `people` is everyone invited, organiser first, so an entry with nobody else
    on it is an hour he gave himself. A conference link settles it the other
    way: nobody dials into their own gym session.

    An all-day entry is neither. It is a marker on the day, not a slot in it. */
export function isMeeting(e: Entry): boolean {
  if (e.allDay) return false
  if (e.link) return true
  return (e.people?.length ?? 0) > 1
}
