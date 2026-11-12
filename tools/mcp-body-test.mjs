/* Health and the gym for the Claude connector. `TZ=Europe/Prague ZOD_PATH=... node tools/mcp-body-test.mjs`
   1. parseHevy equals the app's src/hevy.ts fetchHevyWorkoutDays on the same Hevy pages
   2. gym goal progress equals src/gymcalc.ts currentFor + pctFor
   3. sync_hevy ticks only days not yet kept, only ON, and survives the real merge
   4. get_health keeps each reading's own day */
process.env.TZ = 'Europe/Prague'
import assert from 'assert/strict'
import { loadKit, TODAY } from './mcp-test-kit.mjs'

const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const at = (day, hh) => `${day}T${hh}:00:00Z`
const W = (day, hh, mins, exercises, title = 'Push') => ({ title, start_time: at(day, hh), end_time: new Date(Date.parse(at(day, hh)) + mins * 60000).toISOString(), exercises })
const D1 = addDays(TODAY, -10), D2 = addDays(TODAY, -3), D3 = addDays(TODAY, -1)
const WORKOUTS = [
  W(D3, '16', 55, [{ title: 'Bench Press (Barbell)', sets: [{ weight_kg: 70, reps: 6 }, { weight_kg: 72.5, reps: 4 }] }, { title: 'Pull Up', sets: [{ reps: 8 }, { reps: 7 }, { weight_kg: null, reps: 5 }] }]),
  W(D2, '07', 40, [{ title: 'Bench Press (Barbell)', sets: [{ weight_kg: 65, reps: 8 }] }, { title: 'Stair Machine', sets: [{ duration_seconds: 900 }] }], 'Cardio + bench'),
  W(D1, '23', 60, [{ title: 'Bench Press (Barbell)', sets: [{ weight_kg: 60, reps: 10 }] }, { title: 'Deadlift (Barbell)', sets: [{ weight_kg: 140, reps: 3 }] }]), // 23:00 UTC = next day in Prague
  W(D1, '10', 30, [{ title: 'Bench Press (Barbell)', sets: [{ weight_kg: 62, reps: 10 }] }]),
]
const pages = [WORKOUTS.slice(0, 2), WORKOUTS.slice(2)]
globalThis.fetch = async (url) => {
  const page = Number(new URL(url).searchParams.get('page'))
  return { ok: true, status: 200, json: async () => ({ page, page_count: pages.length, workouts: pages[page - 1] ?? [] }) }
}
globalThis.Deno = { env: { get: (k) => (k === 'HEVY_API_KEY' ? 'test-key' : undefined) } }

const K = await loadKit({
  modules: ['tools-body.ts', 'ops-body.ts'],
  extra: [
    "export { fetchHevyWorkoutDays as appFetchHevy, getHevyExerciseHistory as appHistory } from './src/hevy.ts'",
    "export { currentFor as appCurrentFor, pctFor as appPctFor } from './src/gymcalc.ts'",
  ],
})
const { M, fixture, stateDb, fakeServer, refuses, clone } = K
const B = M.ops_body
const store = new Map([['mc-hevy-key', 'test-key']])
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }

/* ---- 1. parity with the app's Hevy reader ---- */
const app = await M.appFetchHevy()
assert.ok(app.ok, 'app reader ran')
const mine = B.parseHevy(WORKOUTS)
assert.deepEqual(mine.days.slice().sort(), app.days.slice().sort(), 'same training days (Prague calendar)')
assert.ok(mine.days.includes(addDays(D1, 1)), 'a 23:00 UTC workout lands on the next Prague day')
assert.deepEqual(mine.stairDays, app.stairDays, 'same stair days')
assert.deepEqual(mine.stats, app.stats, 'same minutes and volume per day')
assert.deepEqual(mine.history, M.appHistory(), 'same per-exercise history and PR flags')
assert.equal(mine.workouts[0].day, D3, 'workouts newest first')

/* ---- 2. gym goals = gymcalc ---- */
const b = fixture()
b.gymGoals = [
  { id: 'g1', name: 'Bench e1RM', metric: 'e1rm', exerciseName: 'Bench Press (Barbell)', goal: 90, unit: 'kg' },
  { id: 'g2', name: 'Pull-up day total', metric: 'repTotal', exerciseName: 'Pull Up', goal: 25, unit: 'reps' },
  { id: 'g3', name: 'Sessions logged', metric: 'sessions', goal: 20, unit: 'sessions' },
  { id: 'g4', name: 'Bodyweight', metric: 'manual', goal: 91, unit: 'kg', current: 96, lowerIsBetter: true },
  { id: 'g5', name: 'Squat', metric: 'e1rm', exerciseName: 'Squat (Barbell)', goal: 120, unit: 'kg' },
]
const live = B.gymGoalsLive(b, mine)
for (const g of b.gymGoals) {
  const cur = M.appCurrentFor(g, M.appHistory(), Object.keys(app.stats).length)
  const row = live.find((x) => x.id === g.id)
  assert.equal(row.current, cur == null ? null : Math.round(cur * 10) / 10, `current parity: ${g.name}`)
  assert.equal(row.pct, Math.round(M.appPctFor(g, cur) * 100), `pct parity: ${g.name}`)
}
assert.match(live.find((x) => x.id === 'g5').status, /never logged/)

/* ---- 3. sync_hevy ---- */
b.habits = [
  { id: 'h-gym', name: 'Workout / Gym / Fitness', space: 'personal', frequency: 'daily', days: [false, false, false, false, false, false, false] },
  { id: 'h-cardio', name: 'Bike / Run / Stairs', space: 'personal', frequency: 'daily', days: [false, false, false, false, false, false, false] },
]
b.habitLog = [{ habitId: 'h-gym', day: D3, src: 'manual-keep' }]
const db = stateDb(clone(b))
const srv = fakeServer(K, M.tools_body.register, db)
const r1 = await srv.call('sync_hevy', { since: addDays(TODAY, -20) })
assert.ok(!r1.isError, r1.text)
const log = db.tables.mc_state[0].data.habitLog
const gymDays = log.filter((t) => t.habitId === 'h-gym').map((t) => t.day).sort()
assert.deepEqual(gymDays, mine.days.slice().sort(), 'every Hevy day ticked once')
assert.ok(log.some((t) => t.habitId === 'h-gym' && t.day === D3 && t.src === 'manual-keep'), 'a day he already kept is left exactly as it was')
assert.deepEqual(log.filter((t) => t.habitId === 'h-cardio').map((t) => t.day), [D2], 'stair day ticks Bike / Run / Stairs')
const r2 = await srv.call('sync_hevy', { since: addDays(TODAY, -20) })
assert.match(r2.text, /already up to date/, 'second run changes nothing')
const r3 = await srv.call('sync_hevy', { since: D2 })
assert.ok(!r3.isError)
const merged = JSON.parse(M.mergeStates(JSON.stringify(b), JSON.stringify(db.tables.mc_state[0].data)))
assert.equal(merged.habitLog.filter((t) => t.habitId === 'h-gym').length, mine.days.length, 'ticks survive the real merge against a stale app copy')
const noHabit = fixture(); noHabit.habitLog = []
await assert.rejects(async () => B.hevyHabitTicks(noHabit, mine, D1), /Workout \/ Gym \/ Fitness/)

/* ---- get_gym through the server ---- */
const g = await srv.call('get_gym', { from: addDays(TODAY, -30) })
assert.ok(!g.isError, g.text)
assert.equal(g.json.sessions, 4); assert.equal(g.json.lastSession, D3)
assert.ok(g.json.prs.some((p) => p.exercise === 'Bench Press (Barbell)'))
assert.equal(srv.tools.get_gym.cfg.annotations.readOnlyHint, true)

/* ---- 4. health ---- */
const hdb = stateDb(clone(b))
hdb.tables.zepp_wellness = [
  { day: addDays(TODAY, -1), resting_hr: null, sleep_secs: null, steps: null, weight: null, ctl: 41, atl: 50 },
  { day: '2026-06-02', resting_hr: 58, sleep_secs: 25200, steps: 9000, weight: 95.5, ctl: 30, atl: 31 },
]
hdb.tables.zepp_activities = [{ id: 'a1', start_date: at(D2, '07'), start_date_local: `${D2}T08:00:00`, type: 'Ride', name: 'Morning ride', moving_time: 1800, average_heartrate: 130, distance: 12345 }]
hdb.tables.zepp_sync_log = [{ ran_at: '2026-11-12T08:00:00Z', ok: true, wellness_rows: 60, activity_rows: 3, error: null }]
const hs = fakeServer(K, M.tools_body.register, hdb)
const h = await hs.call('get_health', {})
assert.ok(!h.isError, h.text)
assert.equal(h.json.latestReadings.resting_hr.day, '2026-06-02', 'an old reading keeps its own day')
assert.ok(h.json.latestReadings.resting_hr.daysOld > 100)
assert.equal(h.json.latestReadings.ctl.day, addDays(TODAY, -1))
assert.equal(h.json.latestReadings.sleep_secs.value, '7h 00m')
assert.deepEqual(h.json.sessions.map((s) => [s.day, s.minutes, s.km]), [[D2, 30, 12.3]])
assert.equal(h.json.lastSync.ok, true)
assert.equal(hdb.calls.updates, 0, 'get_health writes nothing')
assert.deepEqual(srv.names().sort(), ['get_gym', 'get_health', 'sync_health', 'sync_hevy'])
console.log(`mcp-body-test: all passed (${K.zodReal ? 'schemas validated' : 'schemas NOT validated'})`)
