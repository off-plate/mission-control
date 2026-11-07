/* REVOLUT (2026-11-07). His CZK account statement, read only, in the plainest form that works:
   the pocket balances, income and spending by month, and one scrollable table of every row.

   The data is not in the app's state blob (7,800 rows would ride along on every sync). It lives
   in mc_revolut_* tables (supabase/revolut.sql) that this page can only SELECT from, filled by the
   /revolut-sync skill through the revolut-ingest function. A move between his own pockets is not
   income or spending, so it is hidden unless he asks for it.

   Colour is meaning (COLOR.md): green = money he has and money that came in, amber = pending,
   coral = the data is old, slate = plain figures. No category colours, no subtitles. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { dbClient, currentAccount } from './supabase'
import { Segmented } from './ui'
import { RevolutInsights } from './revolutinsightsview'
import { addDays, type Row } from './revolutinsights'
import './revolut.css'

interface Tx { id: string; product: string; type: string; started: string; description: string; amount: number; state: string; balance: number | null; category: string; internal: boolean }
interface Bal { product: string; balance: number; as_of: string }
interface Month { month: string; income: number; spending: number; net: number; n: number }
interface Sync { synced_at: string; rows_total: number; range_to: string | null; current_displayed: number | null }

const PAGE = 300
const STALE_HOURS = 72
const POCKETS = ['Current', 'Savings', 'Deposit']

const czk = (n: number, signed = false) => {
  const s = Math.abs(n).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 })
  return `${signed ? (n < 0 ? '-' : n > 0 ? '+' : '') : n < 0 ? '-' : ''}${s} Kč`
}
const monthName = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

type Scope = 'real' | 'all'

export function RevolutPage() {
  const [me, setMe] = useState<boolean | null>(null)
  const [bal, setBal] = useState<Bal[]>([])
  const [months, setMonths] = useState<Month[]>([])
  const [sync, setSync] = useState<Sync | null>(null)
  const [rows, setRows] = useState<Tx[]>([])
  const [more, setMore] = useState(true)
  const [err, setErr] = useState('')
  const [scope, setScope] = useState<Scope>('real')
  const [pocket, setPocket] = useState<'all' | string>('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState<Row[] | null>(null)

  const fetchRows = useCallback(async (from: number, replace: boolean) => {
    const c = dbClient()
    if (!c) return
    setBusy(true)
    let query = c.from('mc_revolut_tx')
      .select('id, product, type, started, description, amount, state, balance, category, internal')
      .order('started', { ascending: false }).order('seq', { ascending: false }).range(from, from + PAGE - 1)
    if (scope === 'real') query = query.eq('internal', false)
    if (pocket !== 'all') query = query.eq('product', pocket)
    const term = q.trim().replace(/[%,()]/g, ' ')
    if (term) query = query.or(`description.ilike.%${term}%,category.ilike.%${term}%`)
    const { data, error } = await query
    setBusy(false)
    if (error) { setErr(error.message); return }
    const got = (data ?? []) as Tx[]
    setRows((prev) => (replace ? got : [...prev, ...got]))
    setMore(got.length === PAGE)
  }, [scope, pocket, q])

  useEffect(() => {
    let live = true
    ;(async () => {
      const c = dbClient()
      const acc = await currentAccount()
      if (!live) return
      setMe(!!c && !!acc)
      if (!c || !acc) return
      const [b, m, s] = await Promise.all([
        c.rpc('revolut_balances'), c.rpc('revolut_by_month', { months: 12 }),
        c.from('mc_revolut_sync').select('synced_at, rows_total, range_to, current_displayed').maybeSingle(),
      ])
      if (!live) return
      if (b.error || m.error) setErr((b.error ?? m.error)!.message)
      setBal(((b.data ?? []) as Bal[]).map((x) => ({ ...x, balance: Number(x.balance) })))
      setMonths(((m.data ?? []) as Month[]).map((x) => ({ ...x, income: Number(x.income), spending: Number(x.spending), net: Number(x.net) })))
      setSync((s.data as Sync | null) ?? null)
    })()
    return () => { live = false }
  }, [])

  /* Two years of rows for the insights: pages of 1000, oldest first, so balances can be carried forward. */
  const asOf = sync?.range_to ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date())
  useEffect(() => {
    if (!me) return
    let live = true
    ;(async () => {
      const c = dbClient()
      if (!c) return
      const from = addDays(asOf, -730)
      const out: Row[] = []
      for (let i = 0; i < 20000; i += 1000) {
        const { data, error } = await c.from('mc_revolut_tx')
          .select('day, started, product, amount, balance, category, internal, state, description')
          .gte('day', from).order('started', { ascending: true }).order('seq', { ascending: true }).order('id', { ascending: true }).range(i, i + 999)
        if (error) { if (live) setErr(error.message); return }
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          out.push({ day: String(r.day), started: String(r.started), product: String(r.product), amount: Number(r.amount), balance: r.balance === null ? null : Number(r.balance),
            category: String(r.category), internal: !!r.internal, state: String(r.state), description: String(r.description) })
        }
        if (!data || data.length < 1000) break
      }
      if (live) setAll(out)
    })()
    return () => { live = false }
  }, [me, asOf])

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchRows(0, true) }, q ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [fetchRows, q])

  const total = useMemo(() => bal.reduce((s, b) => s + b.balance, 0), [bal])
  const byPocket = useMemo(() => POCKETS.map((p) => bal.find((b) => b.product === p)).filter((b): b is Bal => !!b), [bal])
  const staleH = sync ? (Date.now() - Date.parse(sync.synced_at)) / 3_600_000 : null
  const stale = staleH !== null && staleH > STALE_HOURS

  if (me === false) return <div className="rv-page"><p className="rv-quiet">Sign in to see Revolut.</p></div>

  return (
    <div className="rv-page">
      <div className="rv-top">
        <h1 className="rv-title">Revolut</h1>
        <span className={`rv-sync${stale ? ' is-stale' : ''}`}>
          {sync ? `Synced ${when(sync.synced_at)}, data to ${sync.range_to ? new Date(sync.range_to + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'n/a'}` : 'Not synced yet. Run /revolut-sync.'}
        </span>
      </div>

      {err && <p className="rv-err" role="alert">{err}</p>}

      <div className="rv-cards">
        <div className="rv-card rv-total">
          <b>Total</b>
          <span className="rv-money">{czk(total)}</span>
          {sync?.current_displayed != null && <small>Current shows {czk(Number(sync.current_displayed))} with pending</small>}
        </div>
        {byPocket.map((b) => (
          <div className="rv-card" key={b.product}>
            <b>{b.product}</b>
            <span className="rv-money">{czk(b.balance)}</span>
          </div>
        ))}
      </div>

      {all ? <RevolutInsights rows={all} asOf={asOf} /> : sync && <p className="rv-quiet">Loading insights</p>}

      <h2 className="rv-h">By month</h2>
      <div className="rv-scroll rv-monthbox">
        <table className="rv-table rv-months">
          <thead><tr><th>Month</th><th className="r">In</th><th className="r">Out</th><th className="r">Net</th><th className="r">Rows</th></tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}</td>
                <td className="r rv-in">{czk(m.income)}</td>
                <td className="r">{czk(m.spending)}</td>
                <td className={`r${m.net >= 0 ? ' rv-in' : ' rv-out'}`}>{czk(m.net, true)}</td>
                <td className="r rv-dim">{m.n}</td>
              </tr>
            ))}
            {!months.length && <tr><td colSpan={5} className="rv-quiet">No data yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="rv-h">Transactions</h2>
      <div className="rv-bar">
        <label className="rv-search">
          <input type="search" value={q} placeholder="Search description or category" aria-label="Search transactions" onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented size="sm" label="Pocket" value={pocket} onPick={setPocket}
          options={[{ id: 'all', label: 'All' }, ...POCKETS.map((p) => ({ id: p, label: p }))]} />
        <Segmented size="sm" label="Scope" value={scope} onPick={setScope}
          options={[{ id: 'real', label: 'Income and spending' }, { id: 'all', label: 'With pocket moves' }]} />
      </div>
      <div className="rv-scroll rv-txbox" tabIndex={0} aria-label="Transactions">
        <table className="rv-table">
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Pocket</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.state !== 'COMPLETED' ? 'is-odd' : undefined}>
                <td className="rv-dim rv-nowrap">{t.started.slice(0, 16).replace('T', ' ')}</td>
                <td className="rv-desc">{t.description}{t.state === 'PENDING' && <em className="rv-pending">Pending</em>}{(t.state === 'REVERTED' || t.state === 'DECLINED') && <em className="rv-dim">{t.state.toLowerCase()}</em>}</td>
                <td className="rv-dim">{t.internal ? 'own pockets' : t.category}</td>
                <td className="rv-dim">{t.product}</td>
                <td className={`r rv-nowrap${t.amount > 0 && !t.internal ? ' rv-in' : ''}`}>{czk(t.amount, true)}</td>
                <td className="r rv-dim rv-nowrap">{t.balance === null ? '' : czk(t.balance)}</td>
              </tr>
            ))}
            {!rows.length && !busy && <tr><td colSpan={6} className="rv-quiet">{q ? 'Nothing matches.' : 'No transactions yet.'}</td></tr>}
          </tbody>
        </table>
        {more && rows.length > 0 && (
          <div className="rv-more"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void fetchRows(rows.length, false)}>{busy ? 'Loading' : 'Load more'}</button></div>
        )}
      </div>
    </div>
  )
}
