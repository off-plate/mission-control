/* The rule that tells a meeting from an hour he blocked out.
     node --experimental-strip-types scripts/calkind-test.ts

   Run on its own rather than through the app, because the calendar needs a
   signed-in account the browser tests do not have, and this rule is what the
   assistant's entire account of his day rests on. */
import { isMeeting } from '../src/calkind.ts'

const fails: string[] = []
const ok = (n: string, c: boolean, d = ''): void => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`)
  if (!c) fails.push(n)
}

/* His real day, the one that came back described as seven meetings. */
const day = [
  { title: 'RVLT focus session', allDay: false, people: [], meeting: false },
  { title: 'Gym', allDay: false, people: ['Michael Florian'], meeting: false },
  { title: 'Timesheet', allDay: false, people: [], meeting: false },
  { title: 'Zero inbox', allDay: false, people: ['Michael Florian'], meeting: false },
  { title: 'Tech alignment', allDay: false, people: ['Michael Florian', 'Petr'], meeting: true },
  { title: 'CTP call', allDay: false, people: ['Michael Florian', 'Klara', 'Jan'], meeting: true },
  { title: 'Weekly status', allDay: false, people: ['Michael Florian', 'Tereza'], meeting: true },
]
for (const e of day) {
  ok(`${e.title} is ${e.meeting ? 'a meeting' : 'his own block'}`,
     isMeeting(e) === e.meeting, `got ${isMeeting(e) ? 'meeting' : 'block'}`)
}

/* Nobody dials into their own gym session, so a call link settles it even with
   an empty guest list: a client sync he set up himself is still a meeting. */
ok('a solo entry with a call link is a meeting',
   isMeeting({ allDay: false, people: [], link: 'https://meet.google.com/x' }) === true)

/* An all-day entry is a marker on the day, not a slot in it, so it is neither
   a meeting nor an hour of his time and must not be counted as either. */
ok('an all-day entry is never a meeting',
   isMeeting({ allDay: true, people: ['Michael Florian', 'Petr'] }) === false)
ok('even an all-day one with a call link',
   isMeeting({ allDay: true, people: [], link: 'https://meet.google.com/x' }) === false)

/* Only him on the invitation is the whole point: one name is not company. */
ok('one person on it is not a meeting', isMeeting({ allDay: false, people: ['Michael Florian'] }) === false)
ok('two people on it is', isMeeting({ allDay: false, people: ['Michael Florian', 'Petr'] }) === true)
ok('a missing guest list does not throw', isMeeting({ allDay: false } as never) === false)

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)
