/* Calendar times, read on a machine that is not in Prague.
     TZ=UTC node --experimental-strip-types scripts/ical-time-test.ts

   This parser runs in a Supabase Edge Function, where the process timezone is
   UTC, and every wall-clock reading used to come from getHours()/getDate().
   A nine o'clock meeting sent as 070000Z was reported at 07:00, while one sent
   with a TZID was right, so a feed carrying both read as nonsense rather than
   as an offset. That is what "I don't have any meeting at 11 nor at 14, it's
   all confused" was.

   Every case is run under three timezones. The answer must not depend on where
   the code happens to be. */
import { parseIcs } from '../supabase/functions/_shared/ical.ts'

const fails: string[] = []
const ok = (n: string, c: boolean, d = ''): void => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`)
  if (!c) fails.push(n)
}
const hhmm = (m: number | null) => m === null ? 'all-day'
  : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function read(vevents: string, from: string, to: string) {
  const ics = `BEGIN:VCALENDAR\n${vevents}\nEND:VCALENDAR`
  return parseIcs(ics, new Date(from), new Date(to))
}
const ev = (uid: string, start: string, end: string, title: string) =>
  `BEGIN:VEVENT\nUID:${uid}\nDTSTART${start}\nDTEND${end}\nSUMMARY:${title}\nEND:VEVENT`

/* Summer, Prague is UTC+2. */
{
  const got = read([
    ev('a', ':20260826T070000Z', ':20260826T080000Z', 'Sent as UTC'),
    ev('b', ';TZID=Europe/Prague:20260826T130000', ';TZID=Europe/Prague:20260826T140000', 'Sent with a TZID'),
  ].join('\n'), '2026-08-25', '2026-08-28')
  const by = (t: string) => got.find((e) => e.title === t)
  ok('a 09:00 Prague meeting sent as UTC reads 09:00', hhmm(by('Sent as UTC')?.start ?? null) === '09:00', hhmm(by('Sent as UTC')?.start ?? null))
  ok('a 13:00 meeting sent with a TZID reads 13:00', hhmm(by('Sent with a TZID')?.start ?? null) === '13:00', hhmm(by('Sent with a TZID')?.start ?? null))
  ok('both land on the same day', by('Sent as UTC')?.day === '2026-08-26' && by('Sent with a TZID')?.day === '2026-08-26')
}

/* Winter, Prague is UTC+1: the offset is not a constant and must not be hard-coded. */
{
  const got = read(ev('c', ':20260115T080000Z', ':20260115T090000Z', 'January'), '2026-01-14', '2026-01-17')
  ok('in January the same UTC stamp reads 09:00, not 10:00', hhmm(got[0]?.start ?? null) === '09:00', hhmm(got[0]?.start ?? null))
}

/* An evening in Prague is still that evening, not the next morning in UTC. */
{
  const got = read(ev('d', ':20260826T203000Z', ':20260826T213000Z', 'Late'), '2026-08-25', '2026-08-29')
  ok('a 22:30 Prague event stays on the 26th', got[0]?.day === '2026-08-26', `${got[0]?.day} ${hhmm(got[0]?.start ?? null)}`)
  ok('and reads 22:30', hhmm(got[0]?.start ?? null) === '22:30', hhmm(got[0]?.start ?? null))
}

/* An all-day entry is a date, not an instant, and must not slide off its day. */
{
  const got = read(`BEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20260826\nDTEND;VALUE=DATE:20260827\nSUMMARY:Dentist week\nEND:VEVENT`, '2026-08-25', '2026-08-29')
  ok('an all-day entry stays on its own day', got[0]?.day === '2026-08-26', String(got[0]?.day))
  ok('and has no time', got[0]?.start === null && got[0]?.allDay === true)
}

/* A weekly stand-up keeps its wall-clock hour across the clock change: 09:00
   in October is still 09:00 in November, not 08:00. */
{
  const got = read(`BEGIN:VEVENT\nUID:f\nDTSTART;TZID=Europe/Prague:20261019T090000\nDTEND;TZID=Europe/Prague:20261019T093000\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6\nSUMMARY:Stand-up\nEND:VEVENT`, '2026-10-18', '2026-12-01')
  const times = [...new Set(got.map((e) => hhmm(e.start)))]
  ok('a weekly stand-up is 09:00 every week, either side of the clock change',
     times.length === 1 && times[0] === '09:00', `${got.length} occurrences at ${times.join(', ')}`)
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
