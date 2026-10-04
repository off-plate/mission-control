/* PEOPLE, BUSINESS VIEW (his ask, 2026-10-04). The circle is for his personal
   life; this is every business he is reaching out to, as a list or as his
   Obsidian CRM board's five lanes, with one card per business holding its
   people, every touch and what he sent.

   Next step, days since the last touch and reply odds are worked out on every
   render (src/prospectcalc.ts) and never stored. Value is his own number. */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useStore } from './store'
import { Segmented, Select } from './ui'
import { localDateKey } from './util'
import { AVOID_DAYS } from './exceptions'
import { STAGES, SOURCES, STEPS, age, cleanDomain, isOpen, label, nextStep, replyOdds } from './prospectcalc'
import type { Prospect, ProspectPerson, ProspectSource, ProspectStage, TouchStep } from './types'

type Layout = 'list' | 'board'
const LAYOUT_KEY = 'mc-business-layout'
const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const pid = () => `pp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function nextLabel(p: Prospect): string {
  const n = nextStep(p)
  if (n === 'callOrVisit') return 'Call or visit'
  if (n) return label(STEPS, n)
  return p.stage === 'contacted' ? 'Sequence done' : p.stage === 'talking' ? 'Their move' : label(STAGES, p.stage)
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
  const open = openId ? prospects.find((p) => p.id === openId) : undefined

  return (
    <div className="pp-page pr-page">
      <div className="pr-bar" role="toolbar" aria-label="People">
        <h1 className="pp-h1">People</h1>
        {modeSwitch}
        <Segmented size="sm" label="Layout" value={layout} onPick={setLayout} options={[{ id: 'list', label: 'List' }, { id: 'board', label: 'Board' }]} />
        <button className="btn btn-primary pp-add" type="button" onClick={() => setAdding(true)}>Add prospect</button>
      </div>

      {prospects.length === 0 ? (
        <div className="pr-empty">
          <p>Every business you reach out to goes here: who they are, who decides, and every email you sent.</p>
          <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}>Add the first prospect</button>
        </div>
      ) : layout === 'list' ? (
        <ProspectList prospects={prospects} today={today} onOpen={setOpenId} />
      ) : (
        <ProspectBoard
          prospects={prospects} today={today} onOpen={setOpenId}
          onMove={(id, stage) => { updateProspect(id, { stage }); if (stage === 'lost') setOpenId(id) }}
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

function ProspectList({ prospects, today, onOpen }: { prospects: Prospect[]; today: string; onOpen: (id: string) => void }) {
  const byAge = (a: Prospect, b: Prospect) => age(b, today).days - age(a, today).days
  const groups: { title: string; rows: Prospect[]; fold?: boolean }[] = [
    { title: 'Needs a move', rows: prospects.filter(isOpen).sort(byAge) },
    { title: 'In conversation', rows: prospects.filter((p) => p.stage === 'talking').sort(byAge) },
    { title: 'Acquired', rows: prospects.filter((p) => p.stage === 'won'), fold: true },
    { title: 'Lost', rows: prospects.filter((p) => p.stage === 'lost'), fold: true },
  ].filter((g) => g.rows.length)
  const row = (p: Prospect) => {
    const a = ageLabel(p, today)
    return (
      <li key={p.id}>
        <button className={`pr-row st-${p.stage}`} type="button" onClick={() => onOpen(p.id)}>
          <span className="pr-biz"><b>{p.name}</b><span>{p.domain}{p.domain ? ' ' : ''}<span className="pr-src">{label(SOURCES, p.source)}</span></span></span>
          <span className="pr-stage"><span className="pr-chip">{label(STAGES, p.stage)}</span></span>
          <span className="pr-next"><span>{p.stage === 'lost' ? (p.lostReason || 'No reason written') : nextLabel(p)}</span><span className={`pr-age${a.stale ? ' is-stale' : ''}`}>{a.t}</span></span>
          <Meter n={p.value} kind="value" />
          <Meter n={replyOdds(p)} kind="odds" none={p.stage === 'talking' ? 'replied' : ''} />
        </button>
      </li>
    )
  }
  return (
    <div className="pr-list">
      <div className="pr-row is-head" aria-hidden="true"><span>Business</span><span className="pr-stage">Stage</span><span className="pr-next">Next step</span><span>Value</span><span>Reply</span></div>
      {groups.map((g) => g.fold ? (
        <details key={g.title} className="pr-group">
          <summary>{g.title} <span className="mono">{g.rows.length}</span></summary>
          <ul>{g.rows.map(row)}</ul>
        </details>
      ) : (
        <section key={g.title} className="pr-group">
          <h2>{g.title} <span className="mono">{g.rows.length}</span></h2>
          <ul>{g.rows.map(row)}</ul>
        </section>
      ))}
    </div>
  )
}

function ProspectBoard({ prospects, today, onOpen, onMove }: {
  prospects: Prospect[]; today: string; onOpen: (id: string) => void; onMove: (id: string, stage: ProspectStage) => void
}) {
  const [over, setOver] = useState<ProspectStage | null>(null)
  const drop = (stage: ProspectStage) => (e: DragEvent) => {
    e.preventDefault(); setOver(null)
    const id = e.dataTransfer.getData('text/prospect')
    if (id && prospects.find((p) => p.id === id)?.stage !== stage) onMove(id, stage)
  }
  return (
    <div className="pr-boardwrap">
      <div className="pr-board">
        {STAGES.map((s) => {
          const rows = prospects.filter((p) => p.stage === s.id)
          return (
            <section
              key={s.id} className={`pr-col st-${s.id}${over === s.id ? ' is-over' : ''}`} aria-label={s.label}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id) }} onDragLeave={() => setOver(null)} onDrop={drop(s.id)}
            >
              <h2>{s.label} <span className="mono">{rows.length}</span></h2>
              {rows.map((p) => {
                const a = ageLabel(p, today)
                const odds = replyOdds(p)
                return (
                  <button
                    key={p.id} type="button" className="pr-pcard" draggable onClick={() => onOpen(p.id)}
                    onDragStart={(e) => { e.dataTransfer.setData('text/prospect', p.id); e.dataTransfer.effectAllowed = 'move' }}
                  >
                    <b>{p.name}</b>
                    {p.stage === 'lost'
                      ? <span className="pr-lost">{p.lostReason || 'No reason written'}</span>
                      : <span className={`pr-age${a.stale ? ' is-stale' : ''}`}>{nextLabel(p)}, {a.t}</span>}
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
  useEffect(() => { if (p.stage === 'lost' && !p.lostReason) lostRef.current?.querySelector('input')?.focus() }, [p.stage, p.lostReason])

  return (
    <div className="pp-scrim pr-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className={`pp-card is-open pr-sheet st-${p.stage}`} aria-label={p.name}>
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

          {/* Where this business is in the pipeline, in its stage's colour. */}
          {p.stage !== 'lost' && (
            <div className="pr-stepper" aria-label={`Stage: ${label(STAGES, p.stage)}`}>
              {STAGES.filter((s) => s.id !== 'lost').map((s, i, all) => (
                <span key={s.id} className={i <= all.findIndex((x) => x.id === p.stage) ? 'is-on' : ''}><i />{s.label}</span>
              ))}
            </div>
          )}
          <div className="pr-scores">
            <div><span>Value</span><Field className="pp-inline pr-big" type="number" label="Value, 0 to 100" placeholder="-" value={p.value != null ? String(p.value) : ''}
              onCommit={(v) => { const n = Math.round(Number(v)); set({ value: v === '' || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(100, n)) }) }} /></div>
            <div><span>Reply odds</span><b className="pr-big">{odds ?? (p.stage === 'talking' ? 'replied' : '-')}</b>
              {odds != null && <small>{label(SOURCES, p.source)}{decider ? ', decider +10' : ''}{unanswered ? `, ${unanswered} unanswered -${unanswered * 10}` : ''}</small>}</div>
          </div>

          <div className="pp-row2">
            <div className="pp-field"><span>Stage</span>
              <Select className="pp-dd" ariaLabel="Stage" value={p.stage} onChange={(stage) => set({ stage })} options={STAGES.map((s) => ({ value: s.id, label: s.label }))} />
            </div>
            <div className="pp-field"><span>Source</span>
              <Select className="pp-dd" ariaLabel="Source" value={p.source} onChange={(source) => set({ source })} options={SOURCES.map((s) => ({ value: s.id, label: s.label }))} />
            </div>
          </div>
          {p.stage === 'lost' && (
            <div className="pp-field" ref={lostRef}><span>Why it was lost</span>
              <Field label="Why it was lost" placeholder="No budget until spring" value={p.lostReason ?? ''} onCommit={(v) => set({ lostReason: v || undefined })} />
            </div>
          )}
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
