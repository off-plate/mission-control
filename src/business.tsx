/* BUSINESS MODE (2026-11-07). His ask: "a switch that will change the whole layout. Everything in the
   menu will be directed to the business." Approved prototype: claude.ai/artifact/82kF7Ufc6j8TsBqKwosGNw.

   A MODE, not a space. Off-Plate stopped being a workspace on 2026-10-02 and foldSpaces keeps it
   folded, so the switch (App.tsx, `mc:mode`, per device like HUD) swaps the menu, the pages and the
   accent, and moves no rows. The pages here read the prospect cards the Sheet sync keeps, the calendar
   feed and his notes. Additive card fields only: `next`, `closed`, `prep`.

   No due dates (the app is against them): the clock is how long a client has been quiet. Client names
   live in his signed-in state, never in this file. */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { Band } from './ui'
import * as Icon from './icons'
import type { Note, Prospect } from './types'
import { MEETING, ON_HOLD, STEPS, TALKING, WON, isDead, label, stageRank, isReady, inSequence } from './prospectcalc'
import { useCalendar, isMeeting } from './calendar'
import type { CalEvent } from './ical'
import { localDateKey } from './util'

const DAY = 86_400_000
const PERSONAL_FOLDER = 'nf-space-personal'

/* ---- the five board columns over the Sheet's statuses ------------------- */
export type Col = 'outreach' | 'contacted' | 'conversation' | 'active' | 'done'
export const COLS: { id: Col; name: string }[] = [
  { id: 'outreach', name: 'Outreach' }, { id: 'contacted', name: 'Contacted' },
  { id: 'conversation', name: 'In conversation' }, { id: 'active', name: 'Active' }, { id: 'done', name: 'Done' },
]
export function colOf(p: Prospect): Col | null {
  if (isDead(p.stage)) return null
  if (p.stage === WON) return p.closed ? 'done' : 'active'
  if (p.stage === TALKING || p.stage === MEETING || p.stage === ON_HOLD) return 'conversation'
  return stageRank(p.stage) >= stageRank('Contacted') ? 'contacted' : 'outreach'
}
/** What a drop on a column writes. The Sheet stays the master for statuses: /offplate-sync overwrites these on its next run. */
const DROP: Record<Col, { stage: string; closed?: number }> = {
  outreach: { stage: 'Ready to contact' }, contacted: { stage: 'Contacted' }, conversation: { stage: TALKING },
  active: { stage: WON }, done: { stage: WON, closed: 1 },
}
const isLive = (p: Prospect) => { const c = colOf(p); return c === 'conversation' || c === 'active' }

/** Days since anything happened: a touch, a reply, the next step being set. */
export function quietDays(p: Prospect, now = Date.now()): number {
  const stamps = [p.next?.at ?? 0, ...p.touches.map((t) => Date.parse(`${t.day}T12:00:00`) || 0)]
  if (p.replied?.day) stamps.push(Date.parse(`${p.replied.day}T12:00:00`) || 0)
  return Math.max(0, Math.floor((now - Math.max(...stamps, p.createdAt)) / DAY))
}
const onMe = (p: Prospect) => !p.next || p.next.on === 'me'
export function byUrgency(a: Prospect, b: Prospect, now = Date.now()): number {
  return Number(!onMe(a)) - Number(!onMe(b)) || quietDays(b, now) - quietDays(a, now) || a.name.localeCompare(b.name)
}
function Quiet({ p }: { p: Prospect }) {
  const d = quietDays(p)
  return <span className={`biz-quiet${d >= 7 ? ' is-old' : ''}`}>{d === 0 ? 'active today' : d === 1 ? 'quiet 1 day' : `quiet ${d} days`}</span>
}

/* ---- transcripts are notes titled "Transcript: <client>, <day>" --------- */
const isTranscript = (n: Note) => n.title.startsWith('Transcript:')
const transcriptsOf = (notes: Note[], p: Prospect) => notes.filter((n) => isTranscript(n) && n.title.includes(p.name))

/* ---- calendar: a meeting belongs to a client when its title, place or guests name them --- */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(s\.?r\.?o\.?|a\.?s\.?|spol\.)/g, '').trim()
export function clientFor(e: CalEvent, list: Prospect[]): Prospect | undefined {
  const hay = norm([e.title, e.where ?? '', ...(e.people ?? [])].join(' '))
  return list.find((p) => {
    const keys = [p.name, p.domain?.split('.')[0] ?? '', ...p.people.map((x) => x.name)].map(norm).filter((k) => k.length >= 4)
    return keys.some((k) => hay.includes(k))
  })
}
const fmtDay = (d: string) => { const t = Date.parse(`${d}T12:00:00`); return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
const hhmm = (m: number | null) => (m == null ? 'All day' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
function useClientMeetings(list: Prospect[]) {
  const { state } = useCalendar()
  const events = state.status === 'ok' ? state.events : []
  return { state, meetings: events.filter((e) => !e.allDay && isMeeting(e)).map((e) => ({ e, p: clientFor(e, list) })).filter((m): m is { e: CalEvent; p: Prospect } => !!m.p) }
}

/* ---- shared pieces ------------------------------------------------------ */
function WhoSwitch({ p, dark }: { p: Prospect; dark?: boolean }) {
  const { updateProspect } = useStore()
  const set = (on: 'me' | 'client') => updateProspect(p.id, { next: { text: p.next?.text ?? '', on, at: Date.now() } })
  const cur = p.next?.on ?? 'me'
  return (
    <span className={`biz-switch${dark ? ' is-dark' : ''}`} role="group" aria-label="Waiting on">
      <button aria-pressed={cur === 'me'} onClick={() => set('me')}>Me</button>
      <button aria-pressed={cur === 'client'} onClick={() => set('client')}>Client</button>
    </span>
  )
}
const openClient = (id: string) => { sessionStorage.setItem('mc:biz-client', id); location.hash = '/clients'; window.dispatchEvent(new Event('mc:biz-client')) }
function ClientLink({ p }: { p: Prospect }) {
  return <button className="biz-clink" onClick={() => openClient(p.id)}>{p.name}</button>
}

/** The one way in for a transcript, from the header, Today, Meetings or a client. */
export function PasteTranscript() {
  const { prospects, addNote } = useStore()
  const [open, setOpen] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const [text, setText] = useState('')
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string | undefined>).detail ?? ''; setPick(id); setText(''); setOpen(id || 'any') }
    window.addEventListener('mc:paste-transcript', on)
    return () => window.removeEventListener('mc:paste-transcript', on)
  }, [])
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])
  if (!open) return null
  const choices = prospects.filter((p) => { const c = colOf(p); return c && c !== 'outreach' }).sort((a, b) => a.name.localeCompare(b.name))
  const name = choices.find((c) => c.id === pick)?.name
  const save = () => {
    if (!name || !text.trim()) return
    const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    addNote(PERSONAL_FOLDER, `Transcript: ${name}, ${day}\n\n${text.trim()}`)
    setOpen(null)
  }
  return (
    <div className="biz-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
      <div className="biz-modal" role="dialog" aria-modal="true" aria-label="Paste a transcript">
        <h2 className="biz-h">Paste a transcript</h2>
        <div className="biz-pick" role="group" aria-label="Which client">
          {choices.map((c) => <button key={c.id} aria-pressed={pick === c.id} onClick={() => setPick(c.id)}>{c.name}</button>)}
        </div>
        <textarea className="biz-text" autoFocus rows={8} value={text} maxLength={120000} placeholder="Paste the transcript from the meeting" onChange={(e) => setText(e.target.value)} aria-label="Transcript" />
        <div className="biz-modal-acts">
          <button className="btn btn-ghost" onClick={() => setOpen(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={!name || !text.trim()} onClick={save}>Save transcript</button>
        </div>
      </div>
    </div>
  )
}
export const pasteTranscript = (id?: string) => window.dispatchEvent(new CustomEvent('mc:paste-transcript', { detail: id }))

/* ---- Today -------------------------------------------------------------- */
export function BusinessPage() {
  const { prospects, notes, setNoteDone } = useStore()
  const today = localDateKey()
  const live = useMemo(() => prospects.filter(isLive), [prospects])
  const { state, meetings } = useClientMeetings(prospects.filter((p) => colOf(p)))
  const todays = meetings.filter((m) => m.e.day === today).sort((a, b) => (a.e.start ?? 0) - (b.e.start ?? 0))
  const mine = live.filter(onMe).sort(byUrgency)
  const replies = prospects.filter((p) => p.replied && colOf(p))
  const open = notes.filter((n) => isTranscript(n) && !n.done)
  const quiet = live.filter((p) => quietDays(p) >= 7).length
  return (
    <div className="page biz">
      <Band title="Today" metrics={[
        { v: String(todays.length), k: 'meetings' },
        { v: String(mine.length), k: 'waiting on you', tone: mine.length ? 'info' : undefined },
        { v: String(replies.length), k: 'replies' },
        { v: String(quiet), k: 'gone quiet', tone: quiet ? 'urgent' : undefined },
      ]} />
      <div className="biz-grid">
        <div className="biz-stack">
          <section className="biz-sec" aria-label="Meetings today">
            <h2 className="biz-h">Meetings today <span className="biz-count">{todays.length}</span></h2>
            {state.status !== 'ok' && <div className="empty">The calendar is not loaded on this device.</div>}
            <ul className="biz-list">
              {todays.map(({ e, p }) => <MeetingRow key={e.uid} e={e} p={p} />)}
              {state.status === 'ok' && !todays.length && <li className="empty">No client meetings today.</li>}
            </ul>
          </section>
          <section className="biz-sec" aria-label="Waiting on you">
            <h2 className="biz-h">Waiting on you <span className="biz-count">{mine.length}</span></h2>
            <ul className="biz-list">
              {mine.map((p) => (
                <li key={p.id} className="biz-row is-mine">
                  <div className="biz-main"><ClientLink p={p} /><span className="biz-sub">{p.next?.text || 'No next step yet'}</span></div>
                  <Quiet p={p} /><WhoSwitch p={p} />
                </li>
              ))}
              {!mine.length && <li className="empty">Nothing is waiting on you.</li>}
            </ul>
          </section>
        </div>
        <div className="biz-stack">
          <section className="biz-sec" aria-label="Replies">
            <h2 className="biz-h">Replies to answer <span className="biz-count">{replies.length}</span></h2>
            <ul className="biz-list">
              {replies.map((p) => (
                <li key={p.id} className="biz-row">
                  <div className="biz-main"><ClientLink p={p} /><span className="biz-sub">{p.replied?.subject ?? 'Reply'}</span></div>
                  <button className="btn btn-quiet" onClick={() => { location.hash = '/outreach' }}>Open</button>
                </li>
              ))}
              {!replies.length && <li className="empty">No replies waiting.</li>}
            </ul>
          </section>
          <section className="biz-sec" aria-label="Transcripts">
            <h2 className="biz-h">Transcripts without a recap <span className="biz-count">{open.length}</span></h2>
            <ul className="biz-list">
              {open.map((n) => (
                <li key={n.id} className="biz-row">
                  <div className="biz-main"><span className="biz-name">{n.title.replace('Transcript: ', '')}</span></div>
                  <button className="btn btn-quiet" onClick={() => setNoteDone(n.id, true)}>Recap sent</button>
                </li>
              ))}
              {!open.length && <li className="empty">Every transcript has its recap.</li>}
            </ul>
            <button className="btn btn-ghost biz-gap" onClick={() => pasteTranscript()}>Paste a transcript</button>
          </section>
        </div>
      </div>
    </div>
  )
}

function MeetingRow({ e, p }: { e: CalEvent; p: Prospect }) {
  const { updateProspect } = useStore()
  const ready = p.prep?.includes(e.uid)
  return (
    <li className={`biz-row${ready ? '' : ' is-mine'}`}>
      <span className="biz-time">{hhmm(e.start)}</span>
      <div className="biz-main"><ClientLink p={p} /><span className="biz-sub">{e.title}</span></div>
      {ready
        ? <span className="biz-chip is-good">Prep ready</span>
        : <button className="btn btn-primary" onClick={() => updateProspect(p.id, { prep: [...(p.prep ?? []), e.uid] })}>Prep is ready</button>}
    </li>
  )
}

/* ---- Clients: the board, and one client's workspace --------------------- */
export function ClientsPage() {
  const { prospects } = useStore()
  const [openId, setOpenId] = useState<string | null>(() => sessionStorage.getItem('mc:biz-client'))
  useEffect(() => {
    const on = () => setOpenId(sessionStorage.getItem('mc:biz-client'))
    window.addEventListener('mc:biz-client', on)
    return () => window.removeEventListener('mc:biz-client', on)
  }, [])
  const close = () => { sessionStorage.removeItem('mc:biz-client'); setOpenId(null) }
  const open = openId ? prospects.find((p) => p.id === openId) : undefined
  if (open) return <ClientSpace p={open} back={close} />
  return <Board onOpen={(id) => { sessionStorage.setItem('mc:biz-client', id); setOpenId(id) }} />
}

const CAP = 12
function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { prospects, updateProspect } = useStore()
  const [over, setOver] = useState<Col | null>(null)
  const [more, setMore] = useState<Col[]>([])
  const by = (c: Col) => prospects.filter((p) => colOf(p) === c).sort(byUrgency)
  const drop = (c: Col, id: string) => {
    const p = prospects.find((x) => x.id === id)
    if (!p || colOf(p) === c) return
    updateProspect(id, { stage: DROP[c].stage, closed: DROP[c].closed ? Date.now() : undefined })
  }
  const active = by('active').length, talking = by('conversation').length
  return (
    <div className="page biz">
      <Band title="Clients" metrics={[{ v: String(active), k: 'active' }, { v: String(talking), k: 'in conversation' }]} />
      <div className="biz-board">
        {COLS.map((c) => {
          const all = by(c.id), shown = more.includes(c.id) ? all : all.slice(0, CAP)
          return (
            <div key={c.id} className={`biz-colm${over === c.id ? ' is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(c.id) }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); drop(c.id, e.dataTransfer.getData('text/plain')) }}>
              <h3 className="biz-colh">{c.name}<span>{all.length}</span></h3>
              {shown.map((p) => (
                <button key={p.id} className={`biz-card${onMe(p) && c.id !== 'outreach' ? ' is-mine' : ''}`} draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => onOpen(p.id)}>
                  <span className="biz-name">{p.name}</span>
                  {p.sheet?.niche && <span className="biz-sub">{[p.sheet.niche, p.sheet.location].filter(Boolean).join(', ')}</span>}
                  {p.next?.text && <span className="biz-cnext">{p.next.text}</span>}
                  <span className="biz-cfoot">
                    {c.id !== 'outreach' && <span className={`biz-chip ${onMe(p) ? 'is-warn' : 'is-info'}`}>{onMe(p) ? 'On you' : 'On client'}</span>}
                    {c.id !== 'outreach' && <Quiet p={p} />}
                  </span>
                </button>
              ))}
              {all.length > shown.length && <button className="btn btn-ghost biz-more" onClick={() => setMore([...more, c.id])}>Show {all.length - shown.length} more</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ClientSpace({ p, back }: { p: Prospect; back: () => void }) {
  const { updateProspect, notes } = useStore()
  const [draft, setDraft] = useState(p.next?.text ?? '')
  useEffect(() => setDraft(p.next?.text ?? ''), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const col = colOf(p)
  const saveNext = () => { const t = draft.trim(); if (t !== (p.next?.text ?? '')) updateProspect(p.id, { next: { text: t, on: p.next?.on ?? 'me', at: Date.now() } }) }
  const trs = transcriptsOf(notes, p)
  const history = [
    ...p.touches.map((t) => ({ day: t.day, title: t.subject || label(STEPS, t.step), sub: 'Sent', tone: 'is-info' })),
    ...(p.replied ? [{ day: p.replied.day, title: p.replied.subject || 'Reply', sub: 'They replied', tone: 'is-good' }] : []),
    ...trs.map((n) => ({ day: n.when, title: n.title.replace('Transcript: ', 'Transcript, '), sub: n.done ? 'Recap sent' : 'Recap not sent', tone: n.done ? 'is-good' : 'is-alert' })),
  ].sort((a, b) => b.day.localeCompare(a.day))
  const facts = [p.sheet?.niche, p.sheet?.location, p.people.find((x) => x.decides)?.name ?? p.people[0]?.name].filter(Boolean)
  return (
    <div className="page biz">
      <button className="biz-crumb" onClick={back}><Icon.ChevronLeft size={16} />Clients</button>
      <div className="biz-chead">
        <div>
          <h1 className="biz-title">{p.name}</h1>
          {facts.length > 0 && <div className="biz-facts">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
        </div>
        <div className="biz-stages" role="group" aria-label="Stage">
          {COLS.map((c) => (
            <button key={c.id} aria-pressed={col === c.id} onClick={() => updateProspect(p.id, { stage: DROP[c.id].stage, closed: DROP[c.id].closed ? Date.now() : undefined })}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="biz-grid">
        <div className="biz-stack">
          <div className="biz-nextcard">
            <label className="biz-nextlbl" htmlFor={`next-${p.id}`}>Next step</label>
            <input id={`next-${p.id}`} className="biz-nextin" value={draft} maxLength={200} placeholder="What happens next"
              onChange={(e) => setDraft(e.target.value)} onBlur={saveNext} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            <div className="biz-nextbar"><WhoSwitch p={p} dark /><Quiet p={p} /></div>
          </div>
          <section className="biz-sec" aria-label="History">
            <h2 className="biz-h">History</h2>
            <ul className="biz-tl">
              {history.map((h, i) => (
                <li key={i}><span className="biz-tld">{fmtDay(h.day)}</span><div><span className="biz-name">{h.title}</span><span className={`biz-chip ${h.tone}`}>{h.sub}</span></div></li>
              ))}
              {!history.length && <li className="empty">Nothing yet.</li>}
            </ul>
          </section>
        </div>
        <div className="biz-stack">
          <section className="biz-sec" aria-label="Files">
            <h2 className="biz-h">Files</h2>
            <div className="biz-links">
              {p.links?.drive ? <a className="btn btn-ghost" href={p.links.drive} target="_blank" rel="noreferrer">Drive folder <Icon.ExternalLink size={14} /></a> : <span className="biz-sub">No Drive folder linked yet.</span>}
              {p.links?.proposal && <a className="btn btn-ghost" href={p.links.proposal} target="_blank" rel="noreferrer">Proposal <Icon.ExternalLink size={14} /></a>}
              {p.links?.outreach && <a className="btn btn-ghost" href={p.links.outreach} target="_blank" rel="noreferrer">Outreach doc <Icon.ExternalLink size={14} /></a>}
              {p.domain && <a className="btn btn-ghost" href={`https://${p.domain}`} target="_blank" rel="noreferrer">{p.domain} <Icon.ExternalLink size={14} /></a>}
            </div>
          </section>
          <section className="biz-sec" aria-label="Actions">
            <h2 className="biz-h">Actions</h2>
            <div className="biz-links">
              <button className="btn btn-primary" onClick={() => pasteTranscript(p.id)}>Paste a transcript</button>
              <button className="btn btn-ghost" onClick={() => { location.hash = '/invoices' }}>Invoices</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/* ---- Meetings ----------------------------------------------------------- */
export function MeetingsPage() {
  const { prospects, notes, setNoteDone } = useStore()
  const { state, meetings } = useClientMeetings(prospects.filter((p) => colOf(p)))
  const today = localDateKey()
  const days = Array.from({ length: 7 }, (_, i) => localDateKey(new Date(Date.now() + i * DAY)))
  const week = meetings.filter((m) => days.includes(m.e.day))
  const missing = week.filter((m) => !m.p.prep?.includes(m.e.uid)).length
  const trs = notes.filter(isTranscript).sort((a, b) => b.when.localeCompare(a.when)).slice(0, 30)
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
  return (
    <div className="page biz">
      <Band title="Meetings" metrics={[
        { v: String(week.length), k: 'next 7 days' },
        { v: String(missing), k: 'prep missing', tone: missing ? 'urgent' : undefined },
        { v: String(trs.filter((n) => !n.done).length), k: 'recap not sent' },
      ]} />
      {state.status !== 'ok' && <div className="empty">The calendar is not loaded on this device.</div>}
      <div className="biz-week">
        {days.map((d) => (
          <div key={d} className={`biz-day${d === today ? ' is-today' : ''}`}>
            <h3 className="biz-colh">{label(d)}{d === today && <span>today</span>}</h3>
            {week.filter((m) => m.e.day === d).sort((a, b) => (a.e.start ?? 0) - (b.e.start ?? 0)).map(({ e, p }) => (
              <button key={e.uid} className="biz-mtg" onClick={() => openClient(p.id)}>
                <b>{hhmm(e.start)}</b><span className="biz-name">{p.name}</span><span className="biz-sub">{e.title}</span>
                <span className={`biz-chip ${p.prep?.includes(e.uid) ? 'is-good' : 'is-alert'}`}>{p.prep?.includes(e.uid) ? 'Prep ready' : 'Prep missing'}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <section className="biz-sec" aria-label="Transcripts">
        <h2 className="biz-h">Transcripts <span className="biz-count">{trs.length}</span></h2>
        <ul className="biz-list">
          {trs.map((n) => (
            <li key={n.id} className="biz-row">
              <div className="biz-main"><span className="biz-name">{n.title.replace('Transcript: ', '')}</span></div>
              <span className={`biz-chip ${n.done ? 'is-good' : 'is-warn'}`}>{n.done ? 'Recap sent' : 'Recap not sent'}</span>
              {!n.done && <button className="btn btn-quiet" onClick={() => setNoteDone(n.id, true)}>Recap sent</button>}
            </li>
          ))}
          {!trs.length && <li className="empty">No transcripts yet.</li>}
        </ul>
        <button className="btn btn-ghost biz-gap" onClick={() => pasteTranscript()}>Paste a transcript</button>
      </section>
    </div>
  )
}

/* ---- the outreach count line, for the Outreach page header ---------------- */
export function useOutreachCounts() {
  const { prospects } = useStore()
  const today = localDateKey()
  return { ready: prospects.filter((p) => isReady(p, today)).length, chasing: prospects.filter((p) => inSequence(p)).length }
}
