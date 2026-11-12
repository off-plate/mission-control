/* The Cookie Jar for the Claude connector. `ZOD_PATH=... node tools/mcp-jar-test.mjs`
   1. momentum-app.ts is the app's src/momentum.ts, body for body (only the imports differ)
   2. the connector's momentum, chain and ladder equal the app's engine on the same log
   3. the tool is read only and answers through the fake server */
import assert from 'assert/strict'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadKit, ROOT, TODAY } from './mcp-test-kit.mjs'

const K = await loadKit({
  modules: ['tools-jar.ts', 'ops-jar.ts'],
  extra: ["export { momentumRun as appRun, momentumNow as appNow, chainOf as appChain, rollUp as appRollUp } from './src/momentum.ts'"],
})
const { M, fixture, stateDb, fakeServer } = K
const J = M.ops_jar

/* ---- 1. no drift -------------------------------------------------------------- */
const app = readFileSync(resolve(ROOT, 'src/momentum.ts'), 'utf8').split('\n')
const copy = readFileSync(resolve(ROOT, 'supabase/functions/mc-mcp/momentum-app.ts'), 'utf8').split('\n')
const marker = copy.findIndex((l) => l.includes("the app's file, from its first line after the imports"))
assert.ok(marker > 0, 'copy has its marker line')
const firstAfterImports = app.findIndex((l, k) => k > 0 && app[k - 1].startsWith('import ') && !l.startsWith('import '))
assert.deepEqual(copy.slice(marker + 1).join('\n').trim(), app.slice(firstAfterImports).join('\n').trim(), 'momentum-app.ts drifted from src/momentum.ts: copy it again')

/* ---- 2. parity on a real-shaped log ------------------------------------------- */
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const b = fixture()
b.habits = [
  { id: 'h1', name: 'Stretch', space: 'personal', frequency: 'daily', days: [] },
  { id: 'h2', name: 'Read', space: 'personal', frequency: 'daily', days: [] },
  { id: 'h3', name: 'Workout / Gym / Fitness', space: 'personal', frequency: 'daily', days: [] },
  { id: 'h4', name: 'Weekly call', space: 'personal', frequency: 'weekly', days: [] },
]
b.habitLog = []; b.focusSessions = []
for (let i = 0; i < 40; i++) {
  const day = addDays(TODAY, -i)
  if (i % 3 !== 2) b.habitLog.push({ habitId: 'h1', day }, { habitId: 'h2', day })
  b.focusSessions.push({ id: `f${i}`, day, minutes: 150 + (i % 5) * 20, space: i % 4 ? 'work' : 'personal' })
  b.habitLog.push({ habitId: 'h3', day })
}
b.tasks.push(
  { id: 'old', title: 'Old thing', done: true, doneAt: `${addDays(TODAY, -1)}T09:00:00.000Z`, createdAt: addDays(TODAY, -20), space: 'personal' },
  { id: 'new', title: 'New thing', done: true, doneAt: `${addDays(TODAY, -1)}T10:00:00.000Z`, createdAt: addDays(TODAY, -1), space: 'work' },
)
b.prospects = [{ id: 'p1', touches: [{ day: TODAY }, { day: TODAY }, { day: addDays(TODAY, -2) }] }]

const workoutDays = [addDays(TODAY, -5)]
const appRun = M.appRun({ habits: b.habits, habitLog: b.habitLog, tasks: b.tasks, focusSessions: b.focusSessions, inView: () => true, workoutDays, outreach: b.prospects.flatMap((p) => p.touches) }, J.WINDOW)
const out = J.cookieJar(b, { workoutDays })
assert.equal(out.momentum, M.appNow(appRun), 'momentum equals the app')
assert.ok(out.momentum > 0, 'a real log turns the wheel')
assert.equal(out.chain.current, M.appChain(appRun).current, 'chain equals the app')
assert.equal(out.today.day, TODAY, 'today is Prague today')
assert.equal(out.today.outreach, 2, 'outreach touches counted')
const appLadder = M.appRollUp(appRun, 'w').reverse()
assert.equal(out.ladder.rungs.length, 14, 'default: 14 day rungs')
assert.equal(J.cookieJar(b, { workoutDays, zoom: 'w' }).ladder.rungs[0].momentum, appLadder[0].momentum, 'week rung equals the app')
assert.ok(Array.isArray(out.today.stillMissing))
assert.equal(J.cookieJar(b, { workoutDays: null }).note.includes('could not be read'), true, 'says when health could not be read')
assert.deepEqual(J.sessionDays([{ start_date_local: '2026-11-01T18:00:00', start_date: '2026-11-01T17:00:00Z' }, { start_date: '2026-11-02T07:00:00Z' }]), ['2026-11-01', '2026-11-02'])

/* ---- 3. through the server ----------------------------------------------------- */
const db = stateDb(b)
db.tables.zepp_activities = [{ start_date: `${workoutDays[0]}T08:00:00Z`, start_date_local: `${workoutDays[0]}T09:00:00` }]
const srv = fakeServer(K, M.tools_jar.register, db)
const res = await srv.call('get_momentum', { zoom: 'd', rows: 5 })
assert.ok(!res.isError, res.text)
const body = res.json
assert.equal(body.ladder.rungs.length, 5)
assert.equal(body.momentum, out.momentum)
assert.equal(srv.tools.get_momentum.cfg.annotations.readOnlyHint, true)
assert.equal(db.calls.updates, 0, 'nothing written')
console.log('mcp-jar-test: all passed')
