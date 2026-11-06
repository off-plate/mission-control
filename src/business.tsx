/* THE BUSINESS ROOM (2026-11-07). His ask: "a switch in Mission Control where it
   switches me to the business side ... fully optimised for seeing the next steps".

   A room, not a space. Off-Plate and Michael's Corner stopped being workspaces on
   2026-10-02 and foldSpaces keeps them folded on every load, so a third space
   would have meant touching every page's filters and his real data. A room (like
   the Zone and JARVIS) re-themes and re-orients without moving a row.

   Read-only over the prospect cards the Sheet sync already keeps, plus one
   additive field on a card: `next`, the one next step and who it waits on.
   No due dates (the app is against them): the only clock is how long a client
   has been quiet. Client names live in his signed-in state, never in this file. */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { Band, Select } from './ui'
import * as Icon from './icons'
import type { Prospect } from './types'
import { MEETING, ON_HOLD, TALKING, WON, isReady, inSequence } from './prospectcalc'

const DAY = 86_400_000
const PERSONAL_FOLDER = 'nf-space-personal'
const GROUPS: { title: string; stages: string[] }[] = [
  { title: 'Active clients', stages: [WON] },
  { title: 'In conversation', stages: [MEETING, TALKING, ON_HOLD] },
]
const STAGE_NAME: Record<string, string> = { [WON]: 'Active', [MEETING]: 'Meeting planned', [TALKING]: 'In conversation', [ON_HOLD]: 'On hold' }

/** Days since anything happened with this client: a touch, a reply, or the next step being set. */
export function quietDays(p: Prospect, now = Date.now()): number {
  const stamps = [p.next?.at ?? 0, ...p.touches.map((t) => Date.parse(`${t.day}T12:00:00`) || 0)]
  if (p.replied?.day) stamps.push(Date.parse(`${p.replied.day}T12:00:00`) || 0)
  const last = Math.max(...stamps, p.createdAt)
  return Math.max(0, Math.floor((now - last) / DAY))
}
const quietText = (d: number) => (d === 0 ? 'active today' : d === 1 ? 'quiet 1 day' : `quiet ${d} days`)

/** Waiting on me first (a client with no next step is waiting on me), then the quietest. */
export function byUrgency(a: Prospect, b: Prospect, now = Date.now()): number {
  const mine = (p: Prospect) => (!p.next || p.next.on === 'me' ? 0 : 1)
  return mine(a) - mine(b) || quietDays(b, now) - quietDays(a, now) || a.name.localeCompare(b.name)
}

function ClientRow({ p }: { p: Prospect }) {
  const { updateProspect } = useStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.next?.text ?? '')
  const q = quietDays(p)
  const on = p.next?.on ?? 'me'
  const save = (text: string, who = on) => {
    const t = text.trim()
    if (t !== (p.next?.text ?? '') || who !== on) updateProspect(p.id, { next: t ? { text: t, on: who, at: Date.now() } : undefined })
    setEditing(false)
  }
  return (
    <li className="biz-row" data-on={p.next ? on : 'none'}>
      <div className="biz-who">
        <span className="biz-name">{p.name}</span>
        <span className="biz-stage">{STAGE_NAME[p.stage] ?? p.stage}</span>
      </div>
      <div className="biz-next">
        {editing ? (
          <input
            className="biz-input" autoFocus value={draft} maxLength={200}
            aria-label={`Next step for ${p.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(draft); if (e.key === 'Escape') { setDraft(p.next?.text ?? ''); setEditing(false) } }}
            onBlur={() => save(draft)}
          />
        ) : p.next ? (
          <button className="biz-step" onClick={() => { setDraft(p.next?.text ?? ''); setEditing(true) }}>{p.next.text}</button>
        ) : (
          <button className="biz-step is-empty" onClick={() => { setDraft(''); setEditing(true) }}>Set the next step</button>
        )}
      </div>
      <div className="biz-meta">
        <span className="biz-switch" role="group" aria-label="Waiting on">
          <button aria-pressed={on === 'me'} disabled={!p.next} onClick={() => p.next && save(p.next.text, 'me')}>Me</button>
          <button aria-pressed={on === 'client'} disabled={!p.next} onClick={() => p.next && save(p.next.text, 'client')}>Client</button>
        </span>
        <span className={`biz-quiet${q >= 7 ? ' is-old' : ''}`}>{quietText(q)}</span>
        {p.links?.drive && (
          <a className="biz-link" href={p.links.drive} target="_blank" rel="noreferrer" aria-label={`${p.name} folder in Drive`}><Icon.ExternalLink size={16} /></a>
        )}
      </div>
    </li>
  )
}

function Transcripts({ clients }: { clients: Prospect[] }) {
  const { notes, addNote, setNoteDone } = useStore()
  const [who, setWho] = useState('')
  const [text, setText] = useState('')
  const pending = notes.filter((n) => n.title.startsWith('Transcript:') && !n.done)
  const name = clients.find((c) => c.id === who)?.name
  const save = () => {
    if (!name || !text.trim()) return
    const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    addNote(PERSONAL_FOLDER, `Transcript: ${name}, ${day}\n\n${text.trim()}`)
    setText('')
  }
  return (
    <section className="biz-sec" aria-labelledby="biz-tr">
      <h2 id="biz-tr" className="biz-h">Transcripts to process <span className="biz-count">{pending.length}</span></h2>
      <div className="biz-paste">
        <Select id="biz-client" className="biz-select" value={who} onChange={setWho} ariaLabel="Which client"
          options={[{ value: '', label: 'Which client' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
        <textarea className="biz-text" rows={4} value={text} maxLength={120000} placeholder="Paste the transcript" onChange={(e) => setText(e.target.value)} aria-label="Transcript" />
        <button className="btn btn-primary" disabled={!name || !text.trim()} onClick={save}>Save transcript</button>
      </div>
      {pending.length > 0 && (
        <ul className="biz-list">
          {pending.map((n) => (
            <li key={n.id} className="biz-tr-row">
              <span>{n.title}</span>
              <button className="btn btn-quiet" onClick={() => setNoteDone(n.id, true)}>Done</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function BusinessPage() {
  const { prospects } = useStore()
  /* The room paints its own accent while it is open, the way a space does, and gives the
     active space's back when he leaves. */
  useEffect(() => {
    const el = document.documentElement
    const prev = el.getAttribute('data-space')
    el.setAttribute('data-space', 'business')
    return () => { if (prev) el.setAttribute('data-space', prev); else el.removeAttribute('data-space') }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const live = useMemo(() => prospects.filter((p) => GROUPS.some((g) => g.stages.includes(p.stage))), [prospects])
  const replies = prospects.filter((p) => p.replied)
  const ready = prospects.filter((p) => isReady(p, today)).length
  const chasing = prospects.filter((p) => inSequence(p)).length
  const onMe = live.filter((p) => !p.next || p.next.on === 'me').length

  return (
    <div className="page biz">
      <Band title="Business" metrics={[
        { v: String(onMe), k: 'waiting on you', tone: onMe > 0 ? 'info' : undefined },
        { v: String(replies.length), k: 'replies' },
        { v: String(live.length), k: 'clients' },
      ]} />

      {live.length === 0 && <div className="empty">No clients yet. Cards appear here once a prospect is a meeting, a conversation or a client.</div>}

      {GROUPS.map((g) => {
        const rows = live.filter((p) => g.stages.includes(p.stage)).sort((a, b) => byUrgency(a, b))
        if (!rows.length) return null
        return (
          <section key={g.title} className="biz-sec" aria-label={g.title}>
            <h2 className="biz-h">{g.title} <span className="biz-count">{rows.length}</span></h2>
            <ul className="biz-list">{rows.map((p) => <ClientRow key={p.id} p={p} />)}</ul>
          </section>
        )
      })}

      {replies.length > 0 && (
        <section className="biz-sec" aria-label="Replies">
          <h2 className="biz-h">Replies waiting for you <span className="biz-count">{replies.length}</span></h2>
          <ul className="biz-list">
            {replies.map((p) => (
              <li key={p.id} className="biz-reply">
                <span className="biz-name">{p.name}</span>
                <span className="biz-quiet">{p.replied?.subject ?? 'Reply'}</span>
                <button className="btn btn-quiet" onClick={() => { location.hash = '/people' }}>Open</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Transcripts clients={live} />

      <section className="biz-sec" aria-label="Outreach">
        <h2 className="biz-h">Outreach</h2>
        <div className="biz-out">
          <span><b>{ready}</b> ready to contact</span>
          <span><b>{chasing}</b> in the sequence</span>
          <button className="btn btn-quiet" onClick={() => { location.hash = '/people' }}>Open outreach</button>
        </div>
      </section>
    </div>
  )
}
