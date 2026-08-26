/* An untick has to survive a sync.

   His report, verbatim: "I checked one of the habits, and then I realized that
   I didn't basically do the habit. And I'm trying to unclick it. But whenever I
   unclick it, on the next synchronization or page reload, it's brought back
   that it shows the habit is checked."

   Two independent paths were handing the tick back and either one alone is
   enough to reproduce it:

   1. `habitLog` is merged as a UNION by row identity. Removing the row on this
      device left the other device's copy standing, and the union returned it.
      Every other removal in the store buries its key; this one did not.
   2. `resolveHabit` merged `days` as `win || lose`, on the reasoning that a day
      either side saw kept was kept. True for a device that slept through a day,
      and fatal for an untick: whichever side still held the day handed it back,
      so unticking could never win no matter which side saved last.

   Run: node tools/untick-test.mjs
*/
import { mergeStates, rowKey } from '../src/sync-merge.ts'

let fail = 0
const ok = (cond, what) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + what); if (!cond) fail++ }

const p = (n) => String(n).padStart(2, '0')
const d = new Date()
const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
const dayKey = (i) => { const x = new Date(mon); x.setDate(mon.getDate() + i)
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}` }
const todayIdx = (d.getDay() + 6) % 7
const today = dayKey(todayIdx)

const habit = (days) => ({ id: 'h1', name: 'Take creatine', days, history: [] })
const blob = (o) => JSON.stringify({ schema: 'v', savedAt: o.savedAt, graveyard: o.graveyard ?? [],
  habits: [habit(o.days)], habitLog: o.log })

const ticked = Array.from({ length: 7 }, (_, i) => i === todayIdx)
const clear = Array.from({ length: 7 }, () => false)

/* The other device still believes it is ticked and saved FIRST. This device
   unticked it and saved last, burying the row. */
const other = blob({ savedAt: 1000, days: ticked, log: [{ habitId: 'h1', day: today }] })
const mine = blob({ savedAt: 2000, days: clear, log: [],
  graveyard: [{ k: rowKey('habitLog', { habitId: 'h1', day: today }), at: 2000 }] })

for (const [name, x, y] of [['mine merged onto theirs', mine, other], ['theirs merged onto mine', other, mine]]) {
  const m = JSON.parse(mergeStates(x, y))
  ok(m.habitLog.length === 0, `${name}: the log row stays gone`)
  ok(m.habits[0].days[todayIdx] === false, `${name}: the day stays unticked`)
}

/* And the reason the union existed still holds: a device that never saw the
   tick must not delete it. No tombstone, so the tick survives. */
const asleep = blob({ savedAt: 3000, days: clear, log: [] })
const awake = blob({ savedAt: 1500, days: ticked, log: [{ habitId: 'h1', day: today }] })
const m2 = JSON.parse(mergeStates(asleep, awake))
ok(m2.habitLog.length === 1, 'a tick nobody buried survives a sleeping device')
ok(m2.habits[0].days[todayIdx] === true, 'and its day stays ticked')

/* Ticking again after an untick has to beat the tombstone the other side holds. */
const reTick = blob({ savedAt: 4000, days: ticked, log: [{ habitId: 'h1', day: today }],
  graveyard: [{ k: rowKey('habitLog', { habitId: 'h1', day: today }), at: 4000, undone: true }] })
const m3 = JSON.parse(mergeStates(reTick, mine))
ok(m3.habitLog.length === 1, 'doing it again after an untick digs the row back up')
ok(m3.habits[0].days[todayIdx] === true, 'and the day reads ticked again')

console.log(fail ? `\n${fail} failed` : '\nall untick checks passed')
process.exitCode = fail ? 1 : 0
