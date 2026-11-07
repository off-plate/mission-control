/* REVOLUT INSIGHTS (2026-11-07). Pure maths over his statement rows, no React and no network, so it is
   testable on its own (tools/revolut-insights-test.mjs) and the page only draws what comes out.

   What counts (same rules as the revolut_* connector tools):
   - a move between his own pockets (internal) is neither income nor spending, and is skipped;
   - declined, failed and reverted rows are skipped, pending counts;
   - investing (category "investing") is money he put away, so it is its own figure and is not
     spending; a card refund reduces spending instead of counting as income;
   - net = income - spending - invested = how much his Revolut balance really moved. */

export interface Row {
  day: string; started: string; product: string; amount: number; balance: number | null
  category: string; internal: boolean; state: string; description: string
}

export const czk = (n: number, signed = false) => {
  const r = Math.round(Math.abs(n))
  const s = r.toLocaleString('cs-CZ')
  return `${signed ? (n < 0 ? '-' : n > 0 ? '+' : '') : n < 0 && r !== 0 ? '-' : ''}${s} Kč`
}

export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const niceDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const weekdayOf = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7

export const isReal = (r: Row) => !r.internal && (r.state === 'COMPLETED' || r.state === 'PENDING')
const inRange = (r: Row, from: string, to: string) => r.day >= from && r.day <= to
const isInvest = (r: Row) => r.category === 'investing'
const isRefund = (r: Row) => r.category === 'refund' && r.amount > 0
/** Money out for spending purposes: a positive number, refunds count negative. */
const outOf = (r: Row) => (isInvest(r) ? 0 : r.amount < 0 ? -r.amount : isRefund(r) ? -r.amount : 0)

export interface Totals { income: number; spending: number; invested: number; net: number; days: number; avgDaily: number }
export function totals(rows: Row[], from: string, to: string): Totals {
  let income = 0, spending = 0, invested = 0
  for (const r of rows) {
    if (!isReal(r) || !inRange(r, from, to)) continue
    if (isInvest(r)) { invested += -r.amount; continue }
    spending += outOf(r)
    if (r.amount > 0 && !isRefund(r)) income += r.amount
  }
  const days = daysBetween(from, to) + 1
  return { income, spending, invested, net: income - spending - invested, days, avgDaily: spending / Math.max(days, 1) }
}

export interface CategoryRow { category: string; spending: number; share: number; prev: number; deltaPct: number | null; n: number }
export function categories(rows: Row[], from: string, to: string, prevFrom: string, prevTo: string): CategoryRow[] {
  const cur = new Map<string, { s: number; n: number }>()
  const prev = new Map<string, number>()
  for (const r of rows) {
    if (!isReal(r)) continue
    const o = outOf(r)
    if (!o && !isRefund(r)) continue
    if (inRange(r, from, to)) { const c = cur.get(r.category) ?? { s: 0, n: 0 }; c.s += o; c.n++; cur.set(r.category, c) }
    else if (inRange(r, prevFrom, prevTo)) prev.set(r.category, (prev.get(r.category) ?? 0) + o)
  }
  /* A refund sits in its own category with negative spend; it lowers the headline spending but is not
     a category row, so the shares are taken over the categories that are listed. */
  const total = [...cur.values()].filter((c) => c.s > 0).reduce((s, c) => s + c.s, 0) || 1
  return [...cur.entries()].filter(([, c]) => c.s > 0).map(([category, c]) => {
    const p = prev.get(category) ?? 0
    return { category, spending: c.s, share: c.s / total, prev: p, deltaPct: p > 0 ? (c.s - p) / p : null, n: c.n }
  }).sort((a, b) => b.spending - a.spending)
}

export interface Merchant { name: string; total: number; n: number; avg: number }
export function merchants(rows: Row[], from: string, to: string, max = 10): Merchant[] {
  const m = new Map<string, Merchant>()
  for (const r of rows) {
    if (!isReal(r) || !inRange(r, from, to) || r.amount >= 0 || isInvest(r)) continue
    const key = r.description.trim().toLowerCase()
    const e = m.get(key) ?? { name: r.description.trim(), total: 0, n: 0, avg: 0 }
    e.total += -r.amount; e.n++
    m.set(key, e)
  }
  return [...m.values()].map((e) => ({ ...e, avg: e.total / e.n })).sort((a, b) => b.total - a.total).slice(0, max)
}

export interface Big { day: string; description: string; amount: number; category: string }
export function biggest(rows: Row[], from: string, to: string, max = 8): Big[] {
  return rows.filter((r) => isReal(r) && inRange(r, from, to) && r.amount < 0 && !isInvest(r))
    .sort((a, b) => a.amount - b.amount).slice(0, max)
    .map((r) => ({ day: r.day, description: r.description.trim(), amount: -r.amount, category: r.category }))
}

export interface Pattern { weekday: { name: string; spending: number; n: number }[]; hours: number[]; nightDays: number; nightSpending: number }
export function pattern(rows: Row[], from: string, to: string): Pattern {
  const weekday = WEEKDAYS.map((name) => ({ name, spending: 0, n: 0 }))
  const hours = new Array(24).fill(0) as number[]
  const night = new Set<string>()
  let nightSpending = 0
  for (const r of rows) {
    if (!isReal(r) || !inRange(r, from, to) || r.amount >= 0 || isInvest(r)) continue
    const w = weekday[weekdayOf(r.day)]
    w.spending += -r.amount; w.n++
    const h = Number(r.started.slice(11, 13))
    if (h >= 0 && h < 24) hours[h] += -r.amount
    if (h < 5) { night.add(r.day); nightSpending += -r.amount }
  }
  return { weekday, hours, nightDays: night.size, nightSpending }
}

export interface Recurring { name: string; monthly: number; n: number; last: string; yearly: number }
/** Payments that come round about monthly: 3 or more, a monthly gap (25 to 35 days at the median), similar amounts. */
export function recurring(rows: Row[], asOf: string): Recurring[] {
  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    if (!isReal(r) || r.amount >= 0 || isInvest(r) || r.day < addDays(asOf, -400)) continue
    const key = r.description.trim().toLowerCase()
    const g = groups.get(key) ?? []
    g.push(r); groups.set(key, g)
  }
  const out: Recurring[] = []
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  for (const g of groups.values()) {
    if (g.length < 3) continue
    g.sort((a, b) => a.day.localeCompare(b.day))
    const gaps: number[] = []
    for (let i = 1; i < g.length; i++) gaps.push(daysBetween(g[i - 1].day, g[i].day))
    const mg = median(gaps)
    if (mg < 25 || mg > 35) continue
    const amt = median(g.map((r) => -r.amount))
    const close = g.filter((r) => Math.abs(-r.amount - amt) <= amt * 0.2).length
    if (close / g.length < 0.7) continue
    const last = g[g.length - 1].day
    if (daysBetween(last, asOf) > 45) continue
    out.push({ name: g[0].description.trim(), monthly: amt, n: g.length, last, yearly: amt * 12 })
  }
  return out.sort((a, b) => b.monthly - a.monthly)
}

/** The whole account's balance at the end of each day: every pocket's last known running balance, added up. */
export function balanceSeries(rows: Row[], from: string, to: string): { day: string; total: number }[] {
  const sorted = rows.filter((r) => r.balance !== null).sort((a, b) => a.started.localeCompare(b.started))
  const last = new Map<string, number>()
  const out: { day: string; total: number }[] = []
  let i = 0
  const first = sorted.length ? sorted[0].day : to
  for (let d = first < from ? from : first; d <= to; d = addDays(d, 1)) {
    while (i < sorted.length && sorted[i].day <= d) { last.set(sorted[i].product, sorted[i].balance as number); i++ }
    if (d < from) continue
    let total = 0
    for (const v of last.values()) total += v
    out.push({ day: d, total })
  }
  return out
}

export interface Month { month: string; income: number; spending: number; invested: number; net: number }
export function monthly(rows: Row[], asOf: string, count = 12): Month[] {
  const keys: string[] = []
  const [y, m] = asOf.split('-').map(Number)
  for (let k = count - 1; k >= 0; k--) { const d = new Date(Date.UTC(y, m - 1 - k, 1)); keys.push(d.toISOString().slice(0, 7)) }
  const by = new Map(keys.map((k) => [k, { month: k, income: 0, spending: 0, invested: 0, net: 0 }]))
  for (const r of rows) {
    if (!isReal(r)) continue
    const e = by.get(r.day.slice(0, 7))
    if (!e) continue
    if (isInvest(r)) { e.invested += -r.amount; continue }
    e.spending += outOf(r)
    if (r.amount > 0 && !isRefund(r)) e.income += r.amount
  }
  for (const e of by.values()) e.net = e.income - e.spending - e.invested
  return keys.map((k) => by.get(k)!)
}

export interface Insights {
  cur: Totals; prev: Totals; cats: CategoryRow[]; merchants: Merchant[]; biggest: Big[]; pattern: Pattern
  recurring: Recurring[]; balance: { day: string; total: number }[]; months: Month[]; lines: string[]
  from: string; to: string; prevFrom: string; prevTo: string
}

export function analyse(rows: Row[], asOf: string, days: number): Insights {
  const to = asOf, from = addDays(asOf, -(days - 1))
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1))
  const cur = totals(rows, from, to), prev = totals(rows, prevFrom, prevTo)
  const cats = categories(rows, from, to, prevFrom, prevTo)
  const ms = merchants(rows, from, to), big = biggest(rows, from, to), pat = pattern(rows, from, to)
  const rec = recurring(rows, asOf)
  // the balance chart needs rows from before `from` to seed each pocket, so it gets the whole list
  const bal = balanceSeries(rows, from, to)
  const lines: string[] = []
  const pct = (a: number, b: number) => Math.round(Math.abs(a - b) / b * 100)
  if (prev.spending > 0 && cur.spending > 0) lines.push(`Spending is ${pct(cur.spending, prev.spending)}% ${cur.spending >= prev.spending ? 'higher' : 'lower'} than the ${days} days before (${czk(cur.spending)} against ${czk(prev.spending)}).`)
  if (cur.income > 0 || cur.spending > 0) {
    lines.push(cur.net >= 0
      ? `Your balance grew by ${czk(cur.net)} (income ${czk(cur.income)}, spending ${czk(cur.spending)}${cur.invested ? `, invested ${czk(cur.invested)}` : ''}).`
      : `Your balance fell by ${czk(-cur.net)}: ${czk(cur.spending)} spent against ${czk(cur.income)} that came in${cur.invested ? `, plus ${czk(cur.invested)} invested` : ''}.`)
  }
  if (cats[0]) lines.push(`${cap(cats[0].category)} is the biggest category: ${czk(cats[0].spending)}, ${Math.round(cats[0].share * 100)}% of spending.`)
  const bet = cats.find((c) => c.category === 'betting')
  if (bet && cats[0].category !== 'betting') lines.push(`Betting: ${czk(bet.spending)} over ${bet.n} payments, ${Math.round(bet.share * 100)}% of spending.`)
  if (big[0]) lines.push(`Biggest single payment: ${big[0].description} for ${czk(big[0].amount)} on ${niceDay(big[0].day)}.`)
  const busiest = [...pat.weekday].sort((a, b) => b.spending - a.spending)[0]
  if (busiest && busiest.spending > 0) lines.push(`${busiest.name} is the heaviest spending day of the week (${czk(busiest.spending)} in this period). You average ${czk(cur.avgDaily)} a day.`)
  if (pat.nightDays > 0) lines.push(`${pat.nightDays} ${pat.nightDays === 1 ? 'day' : 'days'} with spending between midnight and 5 am, ${czk(pat.nightSpending)} in total.`)
  if (rec.length) lines.push(`${rec.length} recurring ${rec.length === 1 ? 'payment' : 'payments'} found, about ${czk(rec.reduce((s, r) => s + r.monthly, 0))} a month.`)
  return { cur, prev, cats, merchants: ms, biggest: big, pattern: pat, recurring: rec, balance: bal, months: monthly(rows, asOf, 12), lines, from, to, prevFrom, prevTo }
}
