/* Revolut insights maths (src/revolutinsights.ts), INVENTED rows only.
   node tools/revolut-insights-test.mjs */
import assert from 'assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const out = await build({ entryPoints: ['src/revolutinsights.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' })
const dir = mkdtempSync(join(tmpdir(), 'rvi-'))
writeFileSync(join(dir, 'm.mjs'), out.outputFiles[0].text)
const T = await import(pathToFileURL(join(dir, 'm.mjs')).href)

let n = 0
const row = (day, amount, o = {}) => ({ day, started: `${day}T${o.time ?? '12:00:00'}`, product: o.product ?? 'Current', amount, balance: o.balance ?? null, category: o.category ?? 'shopping', internal: !!o.internal, state: o.state ?? 'COMPLETED', description: o.d ?? `Shop ${++n}` })
const AS_OF = '2026-11-07'

/* ---- totals: what counts ------------------------------------------------ */
const rows = [
  row('2026-11-01', 50000, { category: 'transfers', d: 'Salary Co' }),
  row('2026-11-02', -1000, { category: 'groceries' }),
  row('2026-11-03', -500, { category: 'restaurants', state: 'PENDING' }),
  row('2026-11-03', -9999, { category: 'restaurants', state: 'DECLINED' }),
  row('2026-11-03', -777, { category: 'restaurants', state: 'REVERTED' }),
  row('2026-11-04', -2000, { category: 'investing', d: 'Broker' }),
  row('2026-11-04', -5000, { category: 'own pockets', internal: true, d: 'To pocket' }),
  row('2026-11-05', 200, { category: 'refund', d: 'Refund' }),
  row('2026-10-30', -300, { category: 'groceries' }),
]
const t = T.totals(rows, '2026-11-01', '2026-11-07')
assert.equal(t.income, 50000, 'only real income, the refund is not income')
assert.equal(t.spending, 1000 + 500 - 200, 'pending counts, declined/reverted/internal/investing do not, refund reduces spending')
assert.equal(t.invested, 2000)
assert.equal(t.net, 50000 - 1300 - 2000)
assert.equal(t.days, 7)
assert.ok(Math.abs(t.avgDaily - 1300 / 7) < 1e-9)

/* ---- categories, deltas -------------------------------------------------- */
const c = T.categories(rows, '2026-11-01', '2026-11-07', '2026-10-25', '2026-10-31')
assert.equal(c[0].category, 'groceries'); assert.equal(c[0].spending, 1000)
assert.equal(c[0].prev, 300); assert.ok(Math.abs(c[0].deltaPct - (700 / 300)) < 1e-9)
assert.equal(c.find((x) => x.category === 'restaurants').deltaPct, null, 'no previous spend means no percentage')
assert.ok(!c.some((x) => x.category === 'investing' || x.category === 'own pockets'))
assert.ok(Math.abs(c.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, 'shares add to 100%')

/* ---- merchants: grouped without regard to case, internal and investing skipped ---- */
const mr = T.merchants([row('2026-11-01', -100, { d: 'Cafe Alpha' }), row('2026-11-02', -50, { d: 'CAFE ALPHA ' }), row('2026-11-03', -400, { d: 'Big Shop' }), row('2026-11-03', -900, { d: 'Fund', category: 'investing' })], '2026-11-01', '2026-11-07')
assert.deepEqual(mr.map((m) => [m.name, m.total, m.n]), [['Big Shop', 400, 1], ['Cafe Alpha', 150, 2]])
assert.equal(mr[1].avg, 75)

/* ---- biggest ------------------------------------------------------------- */
const bg = T.biggest(rows, '2026-11-01', '2026-11-07', 2)
assert.equal(bg.length, 2); assert.equal(bg[0].amount, 1000); assert.equal(bg[1].amount, 500)

/* ---- patterns: 2026-11-07 is a Saturday, 03:30 counts as night ------------------- */
const p = T.pattern([row('2026-11-07', -100, { time: '03:30:00' }), row('2026-11-07', -50, { time: '18:00:00' }), row('2026-11-06', -10, { time: '04:59:59' }), row('2026-11-05', -1, { time: '05:00:00' })], '2026-11-01', '2026-11-07')
assert.equal(p.weekday[5].name, 'Saturday'); assert.equal(p.weekday[5].spending, 150)
assert.equal(p.hours[3], 100); assert.equal(p.hours[18], 50)
assert.equal(p.nightDays, 2); assert.equal(p.nightSpending, 110, '05:00 is not night')

/* ---- recurring ---------------------------------------------------------- */
const sub = (d, k, amt, gap = 30, start = '2026-05-01') => Array.from({ length: k }, (_, i) => row(T.addDays(start, i * gap), -(amt + (i % 2)), { d, category: 'subscriptions' }))
const recRows = [
  ...sub('Stream Co', 6, 199),                                 // monthly, steady: found
  ...sub('Gym Co', 5, 800, 31, '2026-06-01'),                  // monthly: found
  ...sub('Daily Ride', 60, 120, 1, '2026-09-01'),              // daily: not monthly
  ...sub('Twice Only', 2, 99),                                 // too few
  ...sub('Old Sub', 6, 150, 30, '2025-01-01'),                 // stopped long ago
  ...[500, 90, 1300, 60, 700].map((a, i) => row(T.addDays('2026-06-01', i * 30), -a, { d: 'Erratic' })), // amounts all over the place
]
const rec = T.recurring(recRows, AS_OF)
assert.deepEqual(rec.map((r) => r.name), ['Gym Co', 'Stream Co'], 'sorted by monthly cost')
assert.ok(rec[1].monthly >= 199 && rec[1].monthly <= 200); assert.equal(rec[1].yearly, rec[1].monthly * 12)

/* ---- balance series: pockets carry forward, rows before `from` seed the start ------- */
const bs = T.balanceSeries([
  row('2026-10-20', -5, { product: 'Current', balance: 100 }),
  row('2026-10-20', 0, { product: 'Savings', balance: 400 }),
  row('2026-11-03', -20, { product: 'Current', balance: 80 }),
  row('2026-11-05', 0, { product: 'Deposit', balance: 1000 }),
  row('2026-11-05', 0, { product: 'Current', balance: null }),
], '2026-11-01', '2026-11-06')
assert.deepEqual(bs.map((x) => x.total), [500, 500, 480, 480, 1480, 1480])
assert.equal(bs[0].day, '2026-11-01'); assert.equal(bs.length, 6)

/* ---- monthly: 12 keys, oldest first, across a year boundary -------------------- */
const mo = T.monthly([row('2026-01-15', 1000, { category: 'transfers' }), row('2025-12-20', -300), row('2024-01-01', -1)], '2026-01-31', 12)
assert.equal(mo.length, 12); assert.equal(mo[0].month, '2025-02'); assert.equal(mo[11].month, '2026-01')
assert.equal(mo[10].month, '2025-12'); assert.equal(mo[10].spending, 300); assert.equal(mo[11].income, 1000)

/* ---- the whole thing: lines are sentences, never NaN or undefined ---------------------- */
const all = T.analyse([...rows, ...recRows, ...sub('Bet House', 4, 2000, 7, '2026-10-12').map((r) => ({ ...r, category: 'betting' }))], AS_OF, 30)
assert.ok(all.lines.length >= 4)
for (const l of all.lines) { assert.ok(!/NaN|undefined|Infinity|—/.test(l), l); assert.ok(l.endsWith('.'), l) }
assert.ok(all.lines.some((l) => l.startsWith('Betting:') || l.startsWith('Betting is the biggest')), 'betting is mentioned')
assert.ok(all.lines.every((l) => /^[A-Z0-9]/.test(l)), 'every sentence starts with a capital')
assert.ok(!all.lines.some((l) => /\d{4}-\d{2}-\d{2}/.test(l)), 'no ISO dates in sentences')
const small = T.analyse([row('2026-11-05', -4000, { category: 'groceries', d: 'Big Shop' }), row('2026-11-06', -500, { category: 'betting', d: 'Bet House' }), row('2026-11-01', 9000, { category: 'transfers', d: 'Salary' })], AS_OF, 30)
assert.ok(small.lines.some((l) => l.startsWith('Betting: ')), 'betting gets its own line when it is not the top category')
assert.ok(small.lines.some((l) => l.startsWith('Biggest single payment: Big Shop for 4\u00a0000\u00a0Kč on 5 November.')), 'friendly date')
assert.equal(all.from, '2026-10-09'); assert.equal(all.prevTo, '2026-10-08'); assert.equal(all.prevFrom, '2026-09-09')
assert.equal(T.czk(1234567), '1 234 567 Kč'); assert.equal(T.czk(-0.4), '0 Kč'); assert.equal(T.czk(-5, true), '-5 Kč')
console.log('revolut-insights-test: all passed')
