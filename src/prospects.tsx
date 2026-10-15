/* PEOPLE, BUSINESS VIEW (his ask, 2026-10-04). The circle is for his personal
   life; this is every business he is reaching out to, with one card per
   business holding its people, every touch and what he sent.

   2026-10-13, his ask: it mirrors the Off-Plate Prospects Sheet. The list is
   the Sheet as a table, its columns in its order, every row of every tab, and
   the statuses are the Sheet's. /eco-sync sends the whole Sheet each run
   (prospectcalc applySheet); the Sheet is the master for its columns.

   Next step, days since the last touch and reply odds are worked out on every
   render (src/prospectcalc.ts) and never stored. Value is his own number. */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useStore } from './store'
import * as Icon from './icons'
import { Segmented, Select } from './ui'
import { localDateKey } from './util'
import { AVOID_DAYS } from './exceptions'
import { BOARD_ALWAYS, MEETING, ON_HOLD, STAGES, SOURCES, STEPS, TALKING, WON, age, cleanDomain, inSequence, isDead, isOpen, isReady, label, nextStep, replyOdds, stageRank } from './prospectcalc'
import type { Prospect, ProspectLinks, ProspectPerson, ProspectSheetRow, ProspectSource, ProspectStage, TouchStep } from './types'

type Layout = 'list' | 'board'
const LAYOUT_KEY = 'mc-business-layout'

/* Colour family of a status: the five lane colours the view already had.
   Everything before the first email is prep, the sequence is outreach, a
   reply is a conversation. */
/* Seven, his ask (2026-10-13: "some colour difference based on the phase"):
   research, build, ready to send, outreach, replied, acquired, lost. */
type Phase = 'research' | 'build' | 'reach' | 'contacted' | 'talking' | 'won' | 'lost'
export function phase(s: ProspectStage): Phase {
  if (isDead(s)) return 'lost'
  if (s === WON) return 'won'
  if (s === TALKING || s === MEETING || s === ON_HOLD) return 'talking'
  if (stageRank(s) >= stageRank('Contacted')) return 'contacted'
  if (stageRank(s) >= stageRank('Ready to contact')) return 'reach'
  return s.startsWith('Build') ? 'build' : 'research'
}
const st = (s: ProspectStage) => `st-${phase(s)}`
/** Every status in order, plus any he added to the Sheet that this build does not know. */
const allStages = (list: Prospect[]): ProspectStage[] =>
  [...new Set([...STAGES.map((s) => s.id), ...list.map((p) => p.stage)])].sort((a, b) => stageRank(a) - stageRank(b))
/* The Board: lanes that hold a card, then Responded waiting, Acquired and
   Lost always. Sixteen lanes put Lost four screens away from a drag. */
const boardStages = (list: Prospect[]): ProspectStage[] =>
  [...new Set([...list.map((p) => p.stage), ...BOARD_ALWAYS])].sort((a, b) => stageRank(a) - stageRank(b))

/* FILTERS (his ask, 2026-10-04: "the filtration, like Nexus does it").
   one live search plus country, status, source and sort dropdowns, remembered
   per device. Counts in each dropdown respect the other filters, so a number
   is always what picking it would show. */
type Sort = 'sheet' | 'today' | 'value' | 'odds' | 'age' | 'name'
type Skip = 'stage' | 'source' | 'country'
interface Filters { q: string; country: string; stage: ProspectStage | ''; source: ProspectSource | ''; sort: Sort }
const FILTER_KEY = 'mc-business-filters'
const NO_FILTERS: Filters = { q: '', country: '', stage: '', source: '', sort: 'sheet' }
/** Cards that are not in the Sheet: friends, inbound, active clients. */
const NOT_IN_SHEET = '-'
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const SORTS: { value: Sort; label: string }[] = [
  { value: 'sheet', label: 'Sheet order' }, { value: 'today', label: 'Who to write today' },
  { value: 'age', label: 'Waiting longest' }, { value: 'value', label: 'Value' },
  { value: 'odds', label: 'Reply odds' }, { value: 'name', label: 'Name' },
]
/* The old grouped list's order, kept as a sort: replies first, then everyone
   whose 2 days have passed, then the rest of the sequence, then prep, then
   the conversations, acquired and lost. */
function todayRank(p: Prospect, today: string): number {
  if (isOpen(p) && p.replied) return 0
  if (isOpen(p) && isReady(p, today)) return 1
  if (isOpen(p) && inSequence(p)) return 2
  if (isOpen(p)) return 3
  return 4 + ['talking', 'won', 'lost'].indexOf(phase(p.stage))
}
function sorter(sort: Sort, today: string): (a: Prospect, b: Prospect) => number {
  if (sort === 'value') return (a, b) => (b.value ?? -1) - (a.value ?? -1)
  if (sort === 'odds') return (a, b) => (replyOdds(b) ?? -1) - (replyOdds(a) ?? -1)
  if (sort === 'name') return (a, b) => a.name.localeCompare(b.name)
  if (sort === 'today') return (a, b) => todayRank(a, today) - todayRank(b, today) || age(b, today).days - age(a, today).days
  if (sort === 'sheet') return (a, b) => (a.sheet?.row ?? Infinity) - (b.sheet?.row ?? Infinity) || a.name.localeCompare(b.name)
  return (a, b) => age(b, today).days - age(a, today).days
}
const countryOf = (p: Prospect) => p.sheet?.country ?? NOT_IN_SHEET
function matches(p: Prospect, f: Filters, skip?: Skip): boolean {
  if (skip !== 'stage' && f.stage && p.stage !== f.stage) return false
  if (skip !== 'source' && f.source && p.source !== f.source) return false
  if (skip !== 'country' && f.country && countryOf(p) !== f.country) return false
  if (!f.q.trim()) return true
  const s = p.sheet
  const hay = fold([p.name, p.domain, s?.niche, s?.location, s?.notes, p.notes, ...p.people.map((x) => x.name)].filter(Boolean).join(' '))
  return fold(f.q.trim()).split(/\s+/).every((w) => hay.includes(w))
}

/* The filters sit in the bar itself, the Personal bar's own pieces (his ask,
   2026-10-04): its search box and its dropdowns, no chip rows. */
function FilterTools({ f, set, all }: { f: Filters; set: (f: Filters) => void; all: Prospect[] }) {
  const count = (skip: Skip, extra: (p: Prospect) => boolean) => all.filter((p) => matches(p, f, skip) && extra(p)).length
  const countries = [...new Set(all.map(countryOf))].sort((a, b) => (a === NOT_IN_SHEET ? 1 : b === NOT_IN_SHEET ? -1 : 0))
  return (
    <>
      <div className="pp-search">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m10.4 10.4 3.4 3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
        <input
          className="pp-search-input" type="search" value={f.q} placeholder="Search prospects" aria-label="Search prospects"
          onChange={(e) => set({ ...f, q: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); if (f.q) set({ ...f, q: '' }); else e.currentTarget.blur() } }}
        />
      </div>
      {countries.length > 1 && (
        <Select
          className="pp-dd pp-circle-pick" ariaLabel="Country" value={f.country}
          onChange={(country) => set({ ...f, country })}
          options={[
            { value: '', label: `All countries (${count('country', () => true)})` },
            ...countries.map((c) => ({ value: c, label: `${c === NOT_IN_SHEET ? 'Not in the Sheet' : c} (${count('country', (p) => countryOf(p) === c)})` })),
          ]}
        />
      )}
      <Select
        className="pp-dd pp-circle-pick" ariaLabel="Status" value={f.stage}
        onChange={(v) => set({ ...f, stage: v })}
        options={[
          { value: '', label: `All statuses (${count('stage', () => true)})` },
          ...allStages(all).map((s) => ({ value: s, label: `${s} (${count('stage', (p) => p.stage === s)})` })),
        ]}
      />
      <Select
        className="pp-dd pp-circle-pick" ariaLabel="Source" value={f.source}
        onChange={(v) => set({ ...f, source: v as ProspectSource | '' })}
        options={[
          { value: '', label: `All sources (${count('source', () => true)})` },
          ...SOURCES.map((s) => ({ value: s.id, label: `${s.label} (${count('source', (p) => p.source === s.id)})` })),
        ]}
      />
      <Select
        className="pp-dd pp-circle-pick" ariaLabel="Sort" value={f.sort}
        onChange={(sort) => set({ ...f, sort })}
        options={SORTS.map((o) => ({ value: o.value, label: `Sort: ${o.label}` }))}
      />
    </>
  )
}
const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const pid = () => `pp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function nextLabel(p: Prospect): string {
  if (p.replied && isOpen(p)) return 'They replied'
  const n = nextStep(p)
  if (n === 'callOrVisit') return 'Call or visit'
  if (n) return label(STEPS, n)
  if (!inSequence(p) && isOpen(p)) return '' // prep: the audit or build is the work, there is no next email
  return p.stage === TALKING || p.stage === MEETING ? 'Their move' : isOpen(p) ? 'Sequence done' : p.stage
}
function ageLabel(p: Prospect, today: string): { t: string; stale: boolean } {
  const a = age(p, today)
  const n = a.days === 0 ? 'today' : a.days === 1 ? '1 day' : `${a.days} days`
  const last = [...p.touches].sort((x, y) => x.day.localeCompare(y.day)).at(-1)
  const t = a.since === 'added'
    ? (a.days === 0 ? 'added today' : `added ${n} ago`)
    : (a.days === 0 ? `${label(STEPS, last!.step).toLowerCase()} today` : `${n} since ${label(STEPS, last!.step).toLowerCase()}`)
  return { t, stale: isOpen(p) && a.days >= AVOID_DAYS }
}

export function BusinessView({ modeSwitch }: { modeSwitch: JSX.Element }) {
  const { prospects, addProspect, updateProspect } = useStore()
  const today = localDateKey()
  const [layout, setLayout] = useState<Layout>(() => { try { return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'list' } catch { return 'list' } })
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, layout) } catch { /* private mode */ } }, [layout])
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /* Phone only (his ask, 2026-10-15): the filters took the whole screen and
     left the table a sliver, so they fold behind one button there. */
  const [filtersOpen, setFiltersOpen] = useState(false)
  const open = openId ? prospects.find((p) => p.id === openId) : undefined
  const [f, setF] = useState<Filters>(() => {
    try {
      const saved = { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}') } as Filters
      /* Filters saved before the Sheet statuses hold an old lane id. */
      return { ...saved, stage: STAGES.some((s) => s.id === saved.stage) ? saved.stage : '', sort: SORTS.some((s) => s.value === saved.sort) ? saved.sort : 'sheet' }
    } catch { return NO_FILTERS }
  })
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)) } catch { /* private mode */ } }, [f])
  const shown = prospects.filter((p) => matches(p, f)).sort(sorter(f.sort, today))
  const showCountry = !f.country && new Set(prospects.map(countryOf)).size > 1

  return (
    <div className="pp-page pr-page">
      <div className="pr-bar" role="toolbar" aria-label="People">
        <h1 className="pp-h1">People</h1>
        {modeSwitch}
        <Segmented size="sm" label="Layout" value={layout} onPick={setLayout} options={[{ id: 'list', label: 'Table' }, { id: 'board', label: 'Board' }]} />
        {prospects.length > 0 && (() => {
          const active = [f.q, f.country, f.stage, f.source].filter(Boolean).length
          return (
            <>
              <button className="btn btn-ghost btn-sq pr-filter-btn" type="button" aria-expanded={filtersOpen} aria-label={active ? `Filters, ${active} on` : 'Filters'} onClick={() => setFiltersOpen((v) => !v)}>
                <Icon.Sliders size={16} />{active > 0 && <span className="btn-sq-dot" aria-hidden="true" />}
              </button>
              <div className={`pr-filters${filtersOpen ? ' is-open' : ''}`}><FilterTools f={f} set={setF} all={prospects} /></div>
            </>
          )
        })()}
        <button className="btn btn-primary pp-add" type="button" onClick={() => setAdding(true)} aria-label="Add prospect">
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          Add
        </button>
      </div>

      {prospects.length === 0 ? (
        <div className="pr-empty">
          <p>Every business you reach out to goes here: who they are, who decides, and every email you sent.</p>
          <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>Add the first prospect</button>
        </div>
      ) : null}
      {prospects.length === 0 ? null : shown.length === 0 ? (
        <div className="pr-empty">
          <p>Nothing matches these filters.</p>
          <button className="btn btn-quiet" type="button" onClick={() => setF({ ...NO_FILTERS, sort: f.sort })}>Clear filters</button>
        </div>
      ) : layout === 'list' ? (
        <ProspectTable prospects={shown} today={today} showCountry={showCountry} onOpen={setOpenId} />
      ) : (
        <ProspectBoard
          prospects={shown} stages={f.stage ? [f.stage] : boardStages(shown)} today={today} onOpen={setOpenId}
          onMove={(id, stage) => { updateProspect(id, { stage }); if (isDead(stage)) setOpenId(id) }}
        />
      )}

      {open && <ProspectCard key={open.id} p={open} today={today} onClose={() => setOpenId(null)} />}
      {adding && (
        <AddProspect
          onClose={() => setAdding(false)}
          onAdd={(input) => { const id = addProspect(input); setAdding(false); setOpenId(id) }}
        />
      )}
    </div>
  )
}

function Meter({ n, kind, none = 'unset' }: { n: number | null | undefined; kind: 'value' | 'odds'; none?: string }) {
  if (n == null) return <span className="pr-score is-none">{none}</span>
  return <span className={`pr-score is-${kind}`}><b>{n}</b><i><s style={{ transform: `scaleX(${Math.max(0.001, n / 100)})` }} /></i></span>
}

/* THE TABLE (his ask, 2026-10-13: "a table like the Sheet, like Excel or
   Google Sheets"). The Sheet's columns in the Sheet's order, then the three
   Mission Control works out. Row numbers and the business stay pinned while
   the rest scrolls sideways, the header stays pinned while it scrolls down.
   A cell shows one line; the card shows all of it. */
type Col = { h: string; cls?: string; cell: (p: Prospect, today: string) => ReactNode; title?: (p: Prospect) => string | undefined }
const sheetCol = (h: string, k: keyof ProspectSheetRow, cls?: string): Col => ({ h, cls, cell: (p) => p.sheet?.[k] ?? '', title: (p) => String(p.sheet?.[k] ?? '') || undefined })
/* Status sits right after Business, his ask (2026-10-13). */
const STATUS_COL: Col = { h: 'Status', cell: (p) => <span className={`pr-chip ${st(p.stage)}`}>{isDead(p.stage) && p.lostReason ? `${p.stage}: ${p.lostReason}` : p.stage}</span> }
const COLS: Col[] = [
  sheetCol('Niche', 'niche'),
  sheetCol('Location', 'location'),
  sheetCol('Google rating', 'rating', 'is-n'),
  sheetCol('Google reviews', 'reviews', 'is-n'),
  { h: 'Domain', cell: (p) => p.domain ? <a href={`https://${p.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p.domain}</a> : '' },
  sheetCol('Website problem', 'webProblem', 'is-wide'),
  sheetCol('Social / ads problem', 'socialProblem', 'is-wide'),
  sheetCol('Date', 'date'),
  sheetCol('Notes', 'notes', 'is-wide'),
  sheetCol('Finance', 'finance', 'is-wide'),
  sheetCol('Finance priority', 'financePriority'),
  { h: 'Next step', cls: 'is-next', cell: (p, today) => { const a = ageLabel(p, today); const n = nextLabel(p); return <>{n && <span>{n} </span>}<span className={`pr-age${a.stale ? ' is-stale' : ''}`}>{a.t}</span></> } },
  { h: 'Value', cell: (p) => <Meter n={p.value} kind="value" none="-" /> },
  { h: 'Reply', cell: (p) => <Meter n={replyOdds(p)} kind="odds" none={p.stage === TALKING || p.stage === MEETING ? 'replied' : '-'} /> },
]

function ProspectTable({ prospects, today, showCountry, onOpen }: { prospects: Prospect[]; today: string; showCountry: boolean; onOpen: (id: string) => void }) {
  /* Arrives already filtered and sorted (FilterTools). */
  return (
    <div className="pr-sheetwrap">
      <table className="pr-grid">
        <thead>
          <tr>
            <th className="pr-c-num" scope="col">#</th>
            <th className="pr-c-biz" scope="col">Business</th>
            <th scope="col">Status</th>
            {showCountry && <th scope="col">Country</th>}
            {COLS.map((c) => <th key={c.h} scope="col" className={c.cls}>{c.h}</th>)}
          </tr>
        </thead>
        <tbody>
          {prospects.map((p, i) => (
            <tr key={p.id} className={st(p.stage)} onClick={() => onOpen(p.id)}>
              <td className="pr-c-num">{i + 1}</td>
              <th className="pr-c-biz" scope="row"><button type="button" onClick={(e) => { e.stopPropagation(); onOpen(p.id) }}>{p.name}</button></th>
              <td>{STATUS_COL.cell(p, today)}</td>
              {showCountry && <td>{p.sheet?.country ?? 'Not in the Sheet'}</td>}
              {COLS.map((c) => <td key={c.h} className={c.cls} title={c.title?.(p)}>{c.cell(p, today)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProspectBoard({ prospects, stages, today, onOpen, onMove }: {
  prospects: Prospect[]; stages: ProspectStage[]; today: string; onOpen: (id: string) => void; onMove: (id: string, stage: ProspectStage) => void
}) {
  const [over, setOver] = useState<ProspectStage | null>(null)
  const drop = (stage: ProspectStage) => (e: DragEvent) => {
    e.preventDefault(); setOver(null)
    const id = e.dataTransfer.getData('text/prospect')
    if (id && prospects.find((p) => p.id === id)?.stage !== stage) onMove(id, stage)
  }
  return (
    <div className="pr-boardwrap">
      <div className="pr-board" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(230px, ${stages.length === 1 ? '420px' : '1fr'}))`, minWidth: stages.length === 1 ? 0 : stages.length * 242 }}>
        {stages.map((s) => {
          const rows = prospects.filter((p) => p.stage === s)
          return (
            <section
              key={s} className={`pr-col ${st(s)}${over === s ? ' is-over' : ''}`} aria-label={s}
              onDragOver={(e) => { e.preventDefault(); setOver(s) }} onDragLeave={() => setOver(null)} onDrop={drop(s)}
            >
              <h2>{s} <span className="mono">{rows.length}</span></h2>
              {rows.map((p) => {
                const a = ageLabel(p, today)
                const odds = replyOdds(p)
                return (
                  <button
                    key={p.id} type="button" className="pr-pcard" draggable onClick={() => onOpen(p.id)}
                    onDragStart={(e) => { e.dataTransfer.setData('text/prospect', p.id); e.dataTransfer.effectAllowed = 'move' }}
                  >
                    <b>{p.name}</b>
                    {isDead(p.stage)
                      ? <span className="pr-lost">{p.lostReason || 'No reason written'}</span>
                      : <span className={`pr-age${a.stale ? ' is-stale' : ''}`}>{[nextLabel(p), a.t].filter(Boolean).join(', ')}</span>}
                    <span className="pr-pmeta mono"><span>Value {p.value ?? '-'}</span>{odds != null && <span>Reply {odds}</span>}</span>
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/* Saved when he leaves the field or presses Enter, so typing is not a synced
   write per keystroke. Same rule as the person card's words. */
function Field({ value, onCommit, label: aria, className = 'pp-text', placeholder, type = 'text', multiline }: {
  value: string; onCommit: (v: string) => void; label: string; className?: string; placeholder?: string; type?: string; multiline?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()) }
  return multiline
    ? <textarea className={`${className} pr-area`} value={draft} placeholder={placeholder} aria-label={aria} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
    : <input
        className={className} type={type} value={draft} placeholder={placeholder} aria-label={aria}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      />
}

function ProspectCard({ p, today, onClose }: { p: Prospect; today: string; onClose: () => void }) {
  const { updateProspect, deleteProspect, logTouch, removeTouch } = useStore()
  const set = (patch: Parameters<typeof updateProspect>[1]) => updateProspect(p.id, patch)
  const setPerson = (id: string, patch: Partial<ProspectPerson>) => set({ people: p.people.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const odds = replyOdds(p)
  const decider = p.people.some((x) => x.decides && (x.email || x.phone))
  const unanswered = isOpen(p) ? p.touches.length : 0
  const touches = [...p.touches].sort((a, b) => a.day.localeCompare(b.day))
  const lostRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (isDead(p.stage) && !p.lostReason) lostRef.current?.querySelector('input')?.focus() }, [p.stage, p.lostReason])
  const ph = phase(p.stage)

  return (
    <div className="pp-scrim pr-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className={`pp-card is-open pr-sheet ${st(p.stage)}`} aria-label={p.name}>
        <div className="pp-card-scroll">
          <div className="pp-card-top">
            <div className="pp-card-names">
              <Field className="pp-inline pp-in-name" label="Business name" value={p.name} onCommit={(v) => v && set({ name: v })} />
              <Field className="pp-inline pp-in-rel" label="Domain" placeholder="domain.cz" value={p.domain ?? ''} onCommit={(v) => set({ domain: cleanDomain(v) || undefined })} />
            </div>
            <button className="pp-close" type="button" aria-label="Close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>

          {/* Where this business is, in its status's colour: the Sheet's
              sixteen statuses read as four phases here. */}
          {ph !== 'lost' && (
            <div className="pr-stepper" aria-label={`Status: ${p.stage}`}>
              {PHASES.map((x, i) => (
                <span key={x.id} className={i <= PHASES.findIndex((y) => y.id === (ph === 'research' || ph === 'build' ? 'reach' : ph)) ? 'is-on' : ''}><i />{x.label}</span>
              ))}
            </div>
          )}
          <div className="pr-scores">
            <div><span>Value</span><Field className="pp-inline pr-big" type="number" label="Value, 0 to 100" placeholder="-" value={p.value != null ? String(p.value) : ''}
              onCommit={(v) => { const n = Math.round(Number(v)); set({ value: v === '' || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(100, n)) }) }} /></div>
            <div><span>Reply odds</span><b className="pr-big">{odds ?? (p.stage === TALKING || p.stage === MEETING ? 'replied' : '-')}</b>
              {odds != null && <small>{label(SOURCES, p.source)}{decider ? ', decider +10' : ''}{unanswered ? `, ${unanswered} unanswered -${unanswered * 10}` : ''}</small>}</div>
          </div>

          <div className="pp-row2">
            <div className="pp-field"><span>Status</span>
              <Select className="pp-dd" ariaLabel="Status" value={p.stage} onChange={(stage) => set({ stage })} options={allStages([p]).map((s) => ({ value: s, label: s }))} />
            </div>
            <div className="pp-field"><span>Source</span>
              <Select className="pp-dd" ariaLabel="Source" value={p.source} onChange={(source) => set({ source })} options={SOURCES.map((s) => ({ value: s.id, label: s.label }))} />
            </div>
          </div>
          {isDead(p.stage) && (
            <div className="pp-field" ref={lostRef}><span>Why it was lost</span>
              <Field label="Why it was lost" placeholder="No budget until spring" value={p.lostReason ?? ''} onCommit={(v) => set({ lostReason: v || undefined })} />
            </div>
          )}
          {p.replied && isOpen(p) && (
            <div className="pr-replied" role="status">
              <b>They replied, {fmtDay(p.replied.day)}</b>
              {p.replied.subject && <span className="pr-subject">{p.replied.subject}</span>}
              {p.replied.body && <details><summary>Show the reply</summary><p>{p.replied.body}</p></details>}
              <div className="pr-replied-actions">
                <button className="btn btn-primary" type="button" onClick={() => set({ stage: TALKING, replied: undefined })}>Move to Responded waiting</button>
                <button className="btn btn-quiet" type="button" onClick={() => set({ replied: undefined })}>Not a real reply</button>
              </div>
            </div>
          )}

          {p.sheet && <SheetFacts s={p.sheet} />}

          <Links links={p.links ?? {}} onSet={(links) => set({ links: Object.values(links).some(Boolean) ? links : undefined })} />

          <div className="pp-field"><span>Why them</span>
            <Field label="Why them" placeholder="What caught your eye" value={p.why ?? ''} onCommit={(v) => set({ why: v || undefined })} />
          </div>

          <section className="pp-section">
            <h3>People</h3>
            <ul className="pr-people">
              {p.people.map((x) => (
                <li key={x.id}>
                  <div className="pp-row2">
                    <Field label="Name" placeholder="Name" value={x.name} onCommit={(v) => setPerson(x.id, { name: v })} />
                    <Field label="Role" placeholder="Owner, manager" value={x.role ?? ''} onCommit={(v) => setPerson(x.id, { role: v || undefined })} />
                    <Field label="Email" type="email" placeholder="Email" value={x.email ?? ''} onCommit={(v) => setPerson(x.id, { email: v || undefined })} />
                    <Field label="Phone" type="tel" placeholder="Phone" value={x.phone ?? ''} onCommit={(v) => setPerson(x.id, { phone: v || undefined })} />
                  </div>
                  <div className="pr-person-foot">
                    <label className="pr-check"><input type="checkbox" checked={!!x.decides} onChange={(e) => setPerson(x.id, { decides: e.target.checked || undefined })} /> Decides</label>
                    <button className="pp-link" type="button" onClick={() => set({ people: p.people.filter((y) => y.id !== x.id) })}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn btn-quiet" type="button" onClick={() => set({ people: [...p.people, { id: pid(), name: '' }] })}>Add person</button>
          </section>

          <section className="pp-section">
            <h3>Touches</h3>
            {touches.length > 0 && (
              <ul className="pr-touches">
                {touches.map((t) => {
                  const to = p.people.find((x) => x.id === t.to)?.name
                  return (
                    <li key={t.id}>
                      <div className="pr-touch-head">
                        <b>{label(STEPS, t.step)}</b>
                        <span className="mono">{fmtDay(t.day)}{to ? `, to ${to}` : ''}</span>
                        <button className="pp-x" type="button" aria-label={`Remove ${label(STEPS, t.step)}`} onClick={() => removeTouch(p.id, t.id)}>
                          <svg width="10" height="10" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                        </button>
                      </div>
                      {t.subject && <span className="pr-subject">{t.subject}</span>}
                      {t.body && <details><summary>Show what you sent</summary><p>{t.body}</p></details>}
                    </li>
                  )
                })}
              </ul>
            )}
            <LogTouch p={p} today={today} onLog={(t) => logTouch(p.id, t)} />
          </section>

          <div className="pp-field"><span>Notes</span>
            <Field multiline label="Notes" value={p.notes ?? ''} onCommit={(v) => set({ notes: v || undefined })} />
          </div>

          <button
            className={`pp-danger${armed ? ' is-armed' : ''}`} type="button" onBlur={() => setArmed(false)}
            onClick={() => { if (armed) { deleteProspect(p.id); onClose() } else setArmed(true) }}
          >
            {armed ? 'Tap again to remove' : 'Remove prospect'}
          </button>
        </div>
      </aside>
    </div>
  )
}

const PHASES: { id: Phase; label: string }[] = [
  { id: 'reach', label: 'Prep' }, { id: 'contacted', label: 'Outreach' }, { id: 'talking', label: 'Replied' }, { id: 'won', label: 'Acquired' },
]

/* The Sheet's columns for this business, read-only: the Sheet is the master,
   so they are changed there and arrive with the next /eco-sync. */
const FACTS: { k: keyof ProspectSheetRow; label: string }[] = [
  { k: 'country', label: 'Country' }, { k: 'niche', label: 'Niche' }, { k: 'location', label: 'Location' },
  { k: 'rating', label: 'Google rating' }, { k: 'reviews', label: 'Google reviews' }, { k: 'date', label: 'Date' },
  { k: 'webProblem', label: 'Website problem' }, { k: 'socialProblem', label: 'Social / ads problem' },
  { k: 'notes', label: 'Notes' }, { k: 'finance', label: 'Finance' }, { k: 'financePriority', label: 'Finance priority' },
]
function SheetFacts({ s }: { s: ProspectSheetRow }) {
  return (
    <section className="pp-section">
      <h3>From the Sheet</h3>
      <dl className="pr-facts">
        {FACTS.filter((f) => s[f.k] !== undefined && s[f.k] !== '').map((f) => (
          <div key={f.k}><dt>{f.label}</dt><dd>{String(s[f.k])}</dd></div>
        ))}
      </dl>
    </section>
  )
}

const LINKS: { id: keyof ProspectLinks; label: string }[] = [
  { id: 'drive', label: 'Drive folder' }, { id: 'outreach', label: 'Outreach doc' }, { id: 'proposal', label: 'Proposal' },
]
/* Where its files live, one click away (his ask, 2026-10-11). Paste a URL;
   once set, the label opens it. Nothing in Drive moves. */
function Links({ links, onSet }: { links: ProspectLinks; onSet: (l: ProspectLinks) => void }) {
  return (
    <div className="pr-links">
      {LINKS.map((l) => (
        <div key={l.id} className="pp-field"><span>{links[l.id] ? <a href={links[l.id]} target="_blank" rel="noreferrer">{l.label}</a> : l.label}</span>
          <Field label={l.label} type="url" placeholder="Paste link" value={links[l.id] ?? ''} onCommit={(v) => onSet({ ...links, [l.id]: /^https?:\/\//.test(v) ? v : undefined })} />
        </div>
      ))}
    </div>
  )
}

function LogTouch({ p, today, onLog }: { p: Prospect; today: string; onLog: (t: { step: TouchStep; day: string; to?: string; subject?: string; body?: string }) => void }) {
  const n = nextStep(p)
  const fresh = (): TouchStep => (n === 'callOrVisit' || !n ? 'call' : n)
  const [step, setStep] = useState<TouchStep>(fresh)
  const [day, setDay] = useState(today)
  const [to, setTo] = useState(() => p.people.find((x) => x.decides)?.id ?? p.people[0]?.id ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const email = step === 'work' || step === 'reminder' || step === 'personal'
  return (
    <form
      className="pr-log" aria-label="Log a touch"
      onSubmit={(e) => {
        e.preventDefault()
        onLog({ step, day, ...(to ? { to } : {}), ...(email && subject.trim() ? { subject: subject.trim() } : {}), ...(body.trim() ? { body: body.trim() } : {}) })
        setSubject(''); setBody('')
      }}
    >
      <div className="pp-row2">
        <Select className="pp-dd" ariaLabel="Step" value={step} onChange={setStep} options={STEPS.map((s) => ({ value: s.id, label: s.label }))} />
        <input className="pp-text" type="date" aria-label="Day" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
      </div>
      {p.people.length > 0 && (
        <Select className="pp-dd" ariaLabel="To" value={to} onChange={setTo} options={[{ value: '', label: 'To no one in particular' }, ...p.people.map((x) => ({ value: x.id, label: x.name || 'Unnamed' }))]} />
      )}
      {email && <input className="pp-text" aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
      <textarea className="pp-text pr-area" aria-label={email ? 'What you sent' : 'How it went'} placeholder={email ? 'Paste what you sent' : 'How it went'} value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn btn-primary" type="submit">Log {label(STEPS, step).toLowerCase()}</button>
    </form>
  )
}

function AddProspect({ onClose, onAdd }: { onClose: () => void; onAdd: (p: { name: string; domain?: string; source: ProspectSource; people: ProspectPerson[] }) => void }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [source, setSource] = useState<ProspectSource>('found')
  const [contact, setContact] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pp-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form
        className="pp-dialog" aria-label="Add a prospect"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          onAdd({ name: name.trim(), domain: cleanDomain(domain) || undefined, source, people: contact.trim() ? [{ id: pid(), name: contact.trim() }] : [] })
        }}
      >
        <h2>Add a prospect</h2>
        <label className="pp-field">Business
          <input className="pp-text" autoFocus required value={name} placeholder="Business name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pp-field">Domain
          <input className="pp-text" value={domain} placeholder="domain.cz" onChange={(e) => setDomain(e.target.value)} />
        </label>
        <div className="pp-row2">
          <div className="pp-field"><span>Source</span>
            <Select className="pp-dd" ariaLabel="Source" value={source} onChange={setSource} options={SOURCES.map((s) => ({ value: s.id, label: s.label }))} />
          </div>
          <label className="pp-field">Contact
            <input className="pp-text" value={contact} placeholder="Their name" onChange={(e) => setContact(e.target.value)} />
          </label>
        </div>
        <div className="pp-dialog-actions">
          <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Add</button>
        </div>
      </form>
    </div>
  )
}
