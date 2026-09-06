import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { useStore } from './store'
import { AutoTextarea, Band, Select, SpaceMark, type SelectOption } from './ui'
import {
  contactDaysSince, contactStatus, stageDaysSince, PIPELINE_STAGES, STAGE_LABEL,
  type Contact, type ContactActivity, type ContactStatus, type LeadImportFile, type LeadOffer, type PipelineStage,
} from './types'

const STATUS_LABEL: Record<ContactStatus, string> = { quiet: 'Gone Quiet', soon: 'Reach Out Soon', track: 'On Track' }
/* An import is not a touch. contactDaysSince falls back to createdAt, so every freshly imported
   lead read "On Track, last touch today" while nothing had happened, which both invents a signal
   and zeroes the age clock that is the only avoidance measure this app has. */
const neverTouched = (c: Contact, activity: { contactId: string }[]) => !!c.lead && !activity.some((a) => a.contactId === c.id)
const STAGE_COLOR: Record<PipelineStage, string> = {
  reach_out: 'var(--info)', contacted: 'var(--warn)', conversation: 'var(--accent-text)', acquired: 'var(--accent)', lost: 'var(--alert)',
}
const LOG_TYPES = ['call', 'text', 'email', 'meeting'] as const
const LOG_LABEL: Record<string, string> = { call: 'Call', text: 'Text', email: 'Email', meeting: 'Meeting' }

/* The one closed set a relationship can be. Closed on purpose: this field
   doubles as the CRM's only filter, and a filter over freeform text is not
   a filter. A contact saved before this shipped can still hold a value
   outside this list -- ContactDetailPanel adds it back in as an extra
   option rather than silently discarding it on the next open. */
const RELATIONSHIPS = ['Client', 'Potential client', 'Vendor', 'Family', 'Partner', 'Friend', 'Colleague', 'Accountant', 'Co-founder', 'Advisor'] as const

/** Same shape ageDays elsewhere in the app already reads: days, not a date,
 *  because "21 days ago" answers the only question this page ever asks --
 *  not "was it a Tuesday". */
function ageLabel(d: number): string {
  if (d === 0) return 'today'
  if (d === 1) return '1 day ago'
  if (d < 30) return `${d} days ago`
  const months = Math.round(d / 30)
  return months === 1 ? '1 month ago' : `${months} months ago`
}

/* Six muted, already-in-use hues (the four category dots plus two of the
   same family) rather than a fresh palette -- a person's colour has no
   meaning of its own here, it only has to be stable and not fight the
   accent, and reusing what .cat-dot already established does both. */
const AV_COLORS = ['var(--cat-call)', 'var(--cat-admin)', 'var(--cat-deep)', 'var(--cat-quick)', 'var(--av-5)', 'var(--av-6)']
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'
}
function avColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}
function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: avColor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/* Replaces Sheet for this page only: a right-edge slide-in instead of a
   centred card, so a full CRM record (fields, log, activity) has room to
   breathe instead of scrolling inside a small box. Sheet itself is untouched
   and still what every other sheet in the app uses -- this is a deliberate,
   reviewed exception for Contacts, not a replacement for it. */
function ContactPanel({ title, avatarName, onClose, children }: { title: string; avatarName?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="cpanel-scrim" onClick={onClose} />
      <div className="cpanel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="cpanel-head">
          {avatarName && <Avatar name={avatarName} size={46} />}
          <h2>{title}</h2>
          <button className="cpanel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="cpanel-body">{children}</div>
      </div>
    </>
  )
}

function ContactDetailPanel({ contact, onClose, onPromoted }: { contact: Contact; onClose: () => void; onPromoted: (id: string) => void }) {
  const { projects, contactActivity, leadOffers, updateContact, deleteContact, logContactActivity, deleteContactActivity, setContactStage, promoteLead } = useStore()
  /* A sourced lead is not a Contact until he does something to it. Reading one costs nothing;
     the first edit, logged touch or stage change is what makes it real and synced. */
  const realId = (): string | undefined => {
    if (!contact.id.startsWith('lead:')) return contact.id
    const id = promoteLead(contact.id.slice(5))
    if (id) onPromoted(id)
    return id
  }
  const [name, setName] = useState(contact.name)
  const [tag, setTag] = useState(contact.tag)
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [email, setEmail] = useState(contact.email ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [role, setRole] = useState(contact.role ?? '')
  const [next, setNext] = useState(contact.next ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [lostReason, setLostReason] = useState(contact.lostReason ?? '')

  /* Every field commits the moment it's left, not on a single "Save" at the
     end -- the panel's own Escape key and a backdrop click both call this
     same onClose, so a save that only happened there would be skippable.
     Losing a field to a stray click is worse than a few extra writes. */
  const commit = (patch: Partial<Contact>) => { const id = realId(); if (id) updateContact(id, patch) }
  const logTouch = (t: ContactActivity['type']) => { const id = realId(); if (id) logContactActivity(id, t) }
  const moveStage = (st: PipelineStage) => { const id = realId(); if (id) setContactStage(id, st) }

  const mine = contactActivity.filter((a) => a.contactId === contact.id).sort((a, b) => b.at.localeCompare(a.at))
  const days = contactDaysSince(contact, contactActivity)
  const status = contactStatus(contact, contactActivity)
  const never = neverTouched(contact, contactActivity)
  const importedDays = contact.lead ? Math.max(0, Math.floor((Date.now() - new Date(contact.lead.importedAt).getTime()) / 86400000)) : 0
  const project = contact.projectId ? projects.find((p) => p.id === contact.projectId) : undefined

  const tagOptions: SelectOption<string>[] = [
    { value: '', label: 'Not set' },
    ...RELATIONSHIPS.map((r) => ({ value: r as string, label: r })),
    ...(tag && !(RELATIONSHIPS as readonly string[]).includes(tag) ? [{ value: tag, label: tag }] : []),
  ]

  return (
    <ContactPanel title={contact.name || 'New contact'} avatarName={contact.name || '?'} onClose={onClose}>
      {contact.stage ? (
        <>
          <span className="field-label">Stage</span>
          <div className="stagepick">
            {PIPELINE_STAGES.map((s) => (
              <button key={s} className={`stagepick-btn${s === contact.stage ? ' is-active' : ''}`}
                style={s === contact.stage ? { background: STAGE_COLOR[s], color: s === 'acquired' ? 'var(--ink)' : '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => moveStage(s)}>{STAGE_LABEL[s]}</button>
            ))}
          </div>
          {!never && <div className="contact-stageage">{ageLabel(stageDaysSince(contact))} in this stage</div>}
        </>
      ) : (
        <button className="btn btn-quiet" style={{ marginBottom: 'var(--s3)' }}
          onClick={() => moveStage('reach_out')}>Add to pipeline</button>
      )}
      {contact.stage === 'lost' && (
        <>
          <label className="field-label" htmlFor="ct-lostreason">Why</label>
          <AutoTextarea id="ct-lostreason" className="textinput cpanel-whybox" style={{ width: '100%', marginBottom: 'var(--s4)' }}
            placeholder="Said no, went quiet, or got disqualified -- their words where possible."
            value={lostReason} onChange={(e) => setLostReason(e.target.value)} onBlur={() => commit({ lostReason: lostReason.trim() })} />
        </>
      )}

      <div className="contact-toprow">
        {never
          ? <span className="statusbadge s-never">Never contacted</span>
          : <span className={`statusbadge s-${status}`}>{STATUS_LABEL[status]}</span>}
        <span className="contact-lasttouch">{never ? `Imported ${ageLabel(importedDays)}` : `Last touch: ${ageLabel(days)}`}</span>
      </div>

      {/* The number is the point of a sourced lead, so it is a link and a button before it is a
          field. Editing it is still possible below; reaching it takes one tap. */}
      {(contact.phone || contact.email) ? (
        <div className="callrow">
          {contact.phone && <a className="btn btn-primary callbtn" href={`tel:${contact.phone.replace(/\s/g, '')}`}>Call {contact.phone}</a>}
          {contact.email && <a className="btn btn-quiet callbtn" href={`mailto:${contact.email}`}>Email</a>}
        </div>
      ) : contact.lead ? (
        <p className="callrow-none">No phone and no email were found for this one. The Google profile is the only way in.</p>
      ) : null}

      {contact.lead && <p className="leadevidence leadevidence-top">{contact.lead.evidence}</p>}


      {/* For a sourced lead the identity fields are scraped and correct, and he is here to call
          rather than to type. They fold; for a person he added himself they stay open. */}
      {contact.lead ? (
        <details className="detailsblock"><summary>Edit details</summary>
        <label className="field-label" htmlFor="ct-name">Name</label>
        <input id="ct-name" className="textinput" style={{ width: '100%', marginBottom: 'var(--s3)' }}
          value={name} onChange={(e) => setName(e.target.value)} onBlur={() => commit({ name: name.trim() || contact.name })} />

        <label className="field-label" htmlFor="ct-tag">Relationship</label>
        <Select id="ct-tag" style={{ width: '100%', marginBottom: 'var(--s4)' }} ariaLabel="Relationship"
          value={tag} options={tagOptions} onChange={(v) => { setTag(v); commit({ tag: v }) }} />

        <label className="field-label">Contact info</label>
        <div className="contact-infogrid">
          <input className="textinput" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => commit({ phone: phone.trim() })} />
          <input className="textinput" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => commit({ email: email.trim() })} />
          <input className="textinput" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} onBlur={() => commit({ company: company.trim() })} />
          <input className="textinput" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} onBlur={() => commit({ role: role.trim() })} />
        </div>
        {project && (
          <div className="contact-projectlink">
            <SpaceMark space={project.space} always />
            Linked to <b>{project.name}</b>
          </div>
        )}
        </details>
      ) : (
        <>
        <label className="field-label" htmlFor="ct-name">Name</label>
        <input id="ct-name" className="textinput" style={{ width: '100%', marginBottom: 'var(--s3)' }}
          value={name} onChange={(e) => setName(e.target.value)} onBlur={() => commit({ name: name.trim() || contact.name })} />

        <label className="field-label" htmlFor="ct-tag">Relationship</label>
        <Select id="ct-tag" style={{ width: '100%', marginBottom: 'var(--s4)' }} ariaLabel="Relationship"
          value={tag} options={tagOptions} onChange={(v) => { setTag(v); commit({ tag: v }) }} />

        <label className="field-label">Contact info</label>
        <div className="contact-infogrid">
          <input className="textinput" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => commit({ phone: phone.trim() })} />
          <input className="textinput" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => commit({ email: email.trim() })} />
          <input className="textinput" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} onBlur={() => commit({ company: company.trim() })} />
          <input className="textinput" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} onBlur={() => commit({ role: role.trim() })} />
        </div>
        {project && (
          <div className="contact-projectlink">
            <SpaceMark space={project.space} always />
            Linked to <b>{project.name}</b>
          </div>
        )}
        </>
      )}

      <label className="field-label">Log a touch</label>
      <div className="contact-logrow contact-logrow-top">
        {LOG_TYPES.map((t) => (
          <button key={t} className="logbtn" onClick={() => logTouch(t)}>{LOG_LABEL[t]}</button>
        ))}
      </div>

      <label className="field-label" htmlFor="ct-next">Next</label>
      <input id="ct-next" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }} placeholder={contact.lead ? "What's the next step with this lead?" : "What's the next step with this person?"}
        value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => commit({ next: next.trim() })} />

      <label className="field-label" htmlFor="ct-notes">Notes</label>
      <AutoTextarea id="ct-notes" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }}
        value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => commit({ notes: notes.trim() })} />

      {contact.lead && <LeadBlock lead={contact.lead} offer={contact.lead.offerKey ? leadOffers[contact.lead.offerKey] : undefined} />}

      <label className="field-label">Activity</label>
      <div className="contact-activity">
        {mine.length ? mine.map((a) => (
          <div className="contact-activity-row" key={a.id}>
            <span className="contact-activity-icon">{LOG_LABEL[a.type][0]}</span>
            <div className="contact-activity-body">
              <div>{LOG_LABEL[a.type]}</div>
              <div className="contact-activity-when">
                {ageLabel(Math.max(0, Math.floor((Date.now() - new Date(a.at).getTime()) / 86400000)))}
                {' · '}{new Date(a.at).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <button className="contact-activity-del" aria-label="Remove this entry"
              onClick={() => deleteContactActivity(a.id)}>×</button>
          </div>
        )) : <p className="empty">Nothing logged yet.</p>}
      </div>

      <div className="cpanel-actions">
        <button className="btn btn-danger" onClick={() => { const id = realId(); if (id) deleteContact(id); onClose() }}>Delete</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </ContactPanel>
  )
}

/* Everything the lead engine measured, and the offer that measurement
   supports. Only rendered when the contact carries a lead, so a person he
   actually knows never sees a word of it. Read-only on purpose: these are
   measurements with a date on them, not fields to edit. Correcting one by
   hand would leave a number in the CRM that nothing checked. */
/* A price reads "19 000 Kč, credited in full against a build or the first
   three months of a retainer if they start inside 30 days." on the offer, and
   a card has room for the number. The panel still shows the sentence. */
/* One rating format everywhere: a Czech decimal comma, one place, so the same number never
   renders "2948" in the table and "2 948" in the panel. */
const fmtRating = (r: number) => r.toFixed(1).replace('.', ',')

function shortPrice(p: string): string {
  const m = p.match(/^(EUR\s?[\d\u00a0\u202f ]+|[\d\u00a0\u202f ]+\s?Kč)/)
  return m ? m[1].trim() : p.split(/[,.]/)[0]
}

/* Rebuilt from the place id rather than stored: a Maps URL is 199 characters
   and the id it contains is already here. */
function mapsHref(lead: NonNullable<Contact['lead']>): string {
  if (lead.mapsUrl) return lead.mapsUrl
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.city || '')}&query_place_id=${encodeURIComponent(lead.placeKey)}`
}

function LeadBlock({ lead, offer: o }: { lead: NonNullable<Contact['lead']>; offer?: LeadOffer }) {
  const rows: [string, string | undefined][] = o ? [
    ['Who it is for', o.whoFor], ['The problem', o.problem], ['The result', o.result],
    ['Included', o.included], ['Price', o.price], ['Step-down', o.stepDown],
    ['How long', o.howLong], ['Risk reversal', o.riskReversal], ['Why now', o.whyNow],
  ] : []
  return (
    <div className="leadblock">
      <div className="leadblock-head">
        <span className="leadscore" title={`${lead.score} out of 100`}>{lead.score}<i>/100</i></span>
        <span className="leadband">{lead.band}</span>
        <span className="leadwhere">{[lead.city, lead.category].filter(Boolean).join(' · ')}</span>
      </div>

      {/* The headline evidence is printed at the top of the panel, so this block carries only
          what it did not already say. */}
      {lead.evidenceAll && lead.evidenceAll.length > 0 && (
        <>
          <span className="field-label">Also measured</span>
          <ul className="leadevidence-more">
            {lead.evidenceAll.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </>
      )}

      <div className="leadfacts">
        {lead.rating != null && (
          <div><span>Google</span><b>{fmtRating(lead.rating)}{lead.reviews != null ? ` from ${lead.reviews.toLocaleString('cs-CZ')} reviews` : ''}</b></div>
        )}
        <div><span>Web presence</span><b>{lead.webPresence || 'not recorded'}</b></div>
        {lead.website && <div><span>Website</span><a href={lead.website} target="_blank" rel="noopener noreferrer">{lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></div>}
        {lead.instagram && <div><span>Instagram</span><a href={`https://instagram.com/${lead.instagram}`} target="_blank" rel="noopener noreferrer">@{lead.instagram}</a></div>}
        <div><span>Google profile</span><a href={mapsHref(lead)} target="_blank" rel="noopener noreferrer">Open in Maps</a></div>
      </div>

      {o && (
        /* The nine rows are identical across every lead carrying this offer, and he wrote them.
           Folded by default so the per-lead half is what the panel opens on. */
        <details className="leadofferwrap">
          <summary><b>{o.name}</b><span>{o.price}</span></summary>
          <dl className="leadoffer">
            {rows.map(([k, v]) => v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null)}
          </dl>
        </details>
      )}
    </div>
  )
}

function NewContactPanel({ kind, onClose, onCreated }: { kind: 'people' | 'pipeline'; onClose: () => void; onCreated: (id: string) => void }) {
  const { addContact } = useStore()
  const [name, setName] = useState('')
  const save = () => { if (!name.trim()) return; const id = addContact(name); onClose(); onCreated(id) }
  return (
    <ContactPanel title={kind === 'pipeline' ? 'New prospect' : 'New contact'} onClose={onClose}>
      <label className="field-label" htmlFor="nc-name">Name</label>
      <input id="nc-name" className="textinput" style={{ width: '100%' }} value={name} autoFocus
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save() }} />
      <div className="cpanel-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Add</button>
      </div>
    </ContactPanel>
  )
}

function PipelineCard({ c, offer, never, onOpen, onDragStart }: { c: Contact; offer?: LeadOffer; never: boolean; onOpen: () => void; onDragStart: (e: DragEvent<HTMLDivElement>) => void }) {
  const days = stageDaysSince(c)
  const stale = c.stage === 'contacted' && days > 14
  return (
    <div className="leadcard" role="button" tabIndex={0} draggable onDragStart={onDragStart}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="leadcard-top">
        <Avatar name={c.name} />
        <div><div className="leadcard-name">{c.name}</div>
          {(c.company || c.role || c.lead) && (
            <div className="leadcard-sub">
              {[c.company, c.role].filter(Boolean).join(' · ')
                || [c.lead?.category, c.lead?.rating != null ? `${fmtRating(c.lead.rating)}${c.lead.reviews != null ? ` (${c.lead.reviews.toLocaleString('cs-CZ')})` : ''}` : ''].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {c.lead && <span className="leadscore leadscore-sm" title={`${c.lead.score} out of 100, ${c.lead.band}`}>{c.lead.score}</span>}
      </div>
      {offer && <div className="leadcard-offer"><b>{offer.name}</b><span>{shortPrice(offer.price)}</span></div>}
      <div className="leadcard-foot">
        <span className={`leadcard-age${stale ? ' is-stale' : ''}`}>{never ? 'never contacted' : `${ageLabel(days)} in stage`}</span>
        {c.next && <span className="leadcard-next" title={c.next}>{c.next}</span>}
      </div>
    </div>
  )
}

/* Only Lost folds by default. Acquired is explicitly NOT an archive -- the
   CRM Client card note is clear that it stays visible ("what happens after
   the first invoice is where the money is"), and Michael confirmed he wants
   to see it, not just Lost, tucked away. Folding is a display preference
   either way: the count still shows, one click opens the lane back up. */
const FOLDED_BY_DEFAULT: PipelineStage[] = ['lost']

/* A sourced pipeline puts well over a thousand cards in one lane, and painting
   all of them is a locked-up phone rather than a useful board. The lane shows
   the top of its own sort order and says how many more there are; the table
   view and the filters are how you get to the rest. */
const LANE_CAP = 60

export function ContactsPage() {
  const { contacts, contactActivity, leadOffers, leads, leadsLoaded, leadSync, storageFull, setContactStage, promoteLead, importLeads } = useStore()
  /* Reloading after an import used to land on People, which is empty when every contact is a
     sourced prospect, and read as "the import failed". */
  /* Leads arrive from IndexedDB after mount, so a lazy initializer alone sees none of them and
     lands on an empty People tab after every reload. Same trap the view toggle already had. */
  const [kind, setKind] = useState<'people' | 'pipeline'>(() => (contacts.some((c) => c.lead) ? 'pipeline' : 'people'))
  const [kindChosen, setKindChosen] = useState(false)
  /* The board is right for a handful of prospects and wrong for a thousand sourced ones: they all
     sit in one lane, so four lanes of white fill the screen and the fifth is a column of cards.
     A pipeline that is mostly sourced opens as a table; the board is one click away.
     This has to react to the import, not only to what was on disk at mount: the lazy initializer
     alone ran once with zero leads, so importing dropped him straight onto the board it exists
     to avoid. Once he picks a view himself, his choice stands. */
  const [view, setView] = useState<'board' | 'table'>('board')
  const [viewChosen, setViewChosen] = useState(false)
  const leadCount = contacts.reduce((n, c) => n + (c.lead ? 1 : 0), 0) + leads.length
  useEffect(() => {
    if (!viewChosen && leadCount > 40) setView('table')
    if (!kindChosen && leadsLoaded && leads.length > 0) setKind('pipeline')
  }, [leadCount, viewChosen, kindChosen, leadsLoaded, leads.length])
  const isPhone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches
  const effView = isPhone && kind === 'pipeline' ? 'table' : view
  const pickView = (v: 'board' | 'table') => { setViewChosen(true); setView(v) }
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'company' | 'days' | 'next'>('days')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  /* A lead list is worked in score order. Age defaulted the sort to a column that says
     "never called" on every row until he starts calling. */
  const [pSortKey, setPSortKey] = useState<'name' | 'stage' | 'company' | 'days' | 'next' | 'score'>('score')
  const [pSortDir, setPSortDir] = useState<1 | -1>(-1)
  const [relFilter, setRelFilter] = useState('')
  const [folded, setFolded] = useState<Set<PipelineStage>>(new Set(FOLDED_BY_DEFAULT))
  const [dropStage, setDropStage] = useState<PipelineStage | null>(null)
  /* The pipeline holds hand-added prospects and thousands of sourced ones in
     one board on purpose (one page, more views and filters, never a second
     page). These are the filters that make that survivable. */
  const [cityFilter, setCityFilter] = useState('')
  const [offerFilter, setOfferFilter] = useState('')
  const [sourcedOnly, setSourcedOnly] = useState<'' | 'sourced' | 'hand'>('')
  const [importMsg, setImportMsg] = useState('')
  const [shown, setShown] = useState<Partial<Record<PipelineStage, number>>>({})
  /* Everything he asked for is imported; the floor lives here, where he can drop it, instead of
     in an export that silently threw rows away. */
  const [minScore, setMinScore] = useState(45)
  /* The board paints 60 a lane; the table was painting all of them, which is the same wall in a
     different shape. Both grow on request now. */
  const [tableCap, setTableCap] = useState(200)
  const [q, setQ] = useState('')
  /* 1206 of 2680 have neither number nor address. Without this they are invisible until he opens
     one, which costs a click each to find out he cannot call them. */
  const [reachableOnly, setReachableOnly] = useState(false)
  /* On a phone the filter row was pushing the first lead 1500px down the page, so it collapses
     behind one button there and stays inline on anything wider. */
  const [filtersOpen, setFiltersOpen] = useState(false)

  /* Stage is the only thing that decides which of the two this page shows a
     contact in -- not a separate kind field. "The board is the only place a
     client's stage lives" is the CRM Client card note's own rule; a contact
     either carries a stage or it doesn't. */
  const people = contacts.filter((c) => !c.stage)
  const worked = contacts.filter((c): c is Contact & { stage: PipelineStage } => !!c.stage)
  /* Leads that have not been worked yet live in IndexedDB, so they are shaped into the same row
     the board and table already render. They carry a "lead:" id, which is what tells every
     mutation below to turn them into a real Contact first. */
  const virtualLeads: (Contact & { stage: PipelineStage })[] = leads.map((l) => ({
    id: `lead:${l.placeKey}`,
    name: l.name, tag: 'Potential client', phone: l.phone, email: l.email,
    createdAt: l.lead.importedAt, stage: 'reach_out' as PipelineStage, stageAt: l.lead.importedAt,
    lead: l.lead,
  }))
  const prospects: (Contact & { stage: PipelineStage })[] = [...worked, ...virtualLeads]
  const openContact = contacts.find((c) => c.id === openId) ?? prospects.find((c) => c.id === openId) ?? null

  const rows = people.map((c) => ({ c, days: contactDaysSince(c, contactActivity), status: contactStatus(c, contactActivity) }))
  const relOptions = Array.from(new Set(people.map((c) => c.tag).filter(Boolean))).sort()
  const filteredRows = relFilter ? rows.filter((r) => r.c.tag === relFilter) : rows

  const setSort = (key: typeof sortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1)
    else { setSortKey(key); setSortDir(key === 'name' ? 1 : -1) }
  }
  const sortVal = (r: typeof rows[number]) => (
    sortKey === 'name' ? r.c.name
      : sortKey === 'status' ? r.status
        : sortKey === 'company' ? (r.c.company ?? '')
          : sortKey === 'next' ? (r.c.next ?? '')
            : r.days
  )
  const sortedRows = [...filteredRows].sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b)
    if (av < bv) return -1 * sortDir
    if (av > bv) return 1 * sortDir
    return 0
  })

  const cityOptions = Array.from(new Set(prospects.map((c) => c.lead?.city).filter((v): v is string => !!v))).sort()
  const anySourced = prospects.some((c) => c.lead)
  /* Every visible row carrying the same stage makes the column 500px of repetition on an
     ultrawide, and makes sorting by it do nothing. */
  const oneStage = new Set(prospects.map((c) => c.stage)).size <= 1
  const allNever = anySourced && prospects.every((c) => neverTouched(c, contactActivity))
  const offerNameOf = (c: Contact) => (c.lead?.offerKey ? leadOffers[c.lead.offerKey]?.name : undefined)
  const offerOptions = Array.from(new Set(prospects.map(offerNameOf).filter((v): v is string => !!v))).sort()
  const filteredProspects = prospects.filter((c) => (
    (!cityFilter || c.lead?.city === cityFilter)
    && (!offerFilter || offerNameOf(c) === offerFilter)
    && (sourcedOnly === '' || (sourcedOnly === 'sourced' ? !!c.lead : !c.lead))
    && (!c.lead || c.lead.score >= minScore)
    && (!reachableOnly || !!c.phone || !!c.email)
    && (!q || `${c.name} ${c.lead?.category ?? ''} ${c.lead?.city ?? ''} ${c.lead?.evidence ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  ))
  const prospectRows = filteredProspects.map((c) => ({ c, days: stageDaysSince(c) }))

  /* Reads a file the lead engine wrote. Deliberately a local file rather than
     anything bundled: mission-control is a public repo, and a few thousand
     businesses' phone numbers do not belong in it. */
  const onImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as LeadImportFile
      if (!Array.isArray(parsed?.leads)) { setImportMsg('That file does not look like a lead export.'); return }
      setImportMsg('Importing…')
      const { added, updated } = await importLeads(parsed)
      setImportMsg(`${added} added, ${updated} updated.`)
      window.setTimeout(() => setImportMsg(''), 6000)
      return
    } catch {
      setImportMsg('Could not read that file.')
    }
  }
  const setPSort = (key: typeof pSortKey) => {
    if (key === pSortKey) setPSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1)
    else { setPSortKey(key); setPSortDir(key === 'name' ? 1 : -1) }
  }
  const pSortVal = (r: typeof prospectRows[number]) => (
    pSortKey === 'name' ? r.c.name
      : pSortKey === 'stage' ? PIPELINE_STAGES.indexOf(r.c.stage)
        : pSortKey === 'company' ? (r.c.company ?? '')
          : pSortKey === 'next' ? (r.c.next ?? '')
            : pSortKey === 'score' ? (r.c.lead?.score ?? -1)
              : r.days
  )
  const pSortedRows = [...prospectRows].sort((a, b) => {
    const av = pSortVal(a), bv = pSortVal(b)
    if (av < bv) return -1 * pSortDir
    if (av > bv) return 1 * pSortDir
    return 0
  })

  const shownIn = (stage: PipelineStage) => shown[stage] ?? LANE_CAP
  const showMore = (stage: PipelineStage) => setShown((prev) => ({ ...prev, [stage]: (prev[stage] ?? LANE_CAP) + 200 }))

  const toggleFold = (stage: PipelineStage) => setFolded((prev) => {
    const next = new Set(prev)
    if (next.has(stage)) next.delete(stage); else next.add(stage)
    return next
  })

  return (
    <div className="page">
      {/* "1441 of 2680 in pipeline" reads as 1239 having failed to import. All of them are in the
          pipeline; a filter is hiding some. */}
      <Band title="Contacts" metrics={[
        kind === 'pipeline' && filteredProspects.length !== prospects.length
          ? { v: String(filteredProspects.length), k: `shown of ${prospects.length}` }
          : { v: String(kind === 'pipeline' ? prospects.length : people.length), k: kind === 'pipeline' ? 'in pipeline' : 'people' },
      ]} />

      <div className="kindrow">
        <div className="kind" role="tablist" aria-label="Kind">
          <button aria-pressed={kind === 'people'} onClick={() => { setKindChosen(true); setKind('people') }}>People</button>
          <button aria-pressed={kind === 'pipeline'} onClick={() => { setKindChosen(true); setKind('pipeline') }}>Pipeline</button>
        </div>
        <div className={`cpage-subrow${filtersOpen ? ' is-open' : ''}`}>
          {/* Board is a Pipeline-only concept: it's the one place a stage is
             actually dragged from column to column. People's three groups
             are computed, not something you arrange, so there is nothing
             for a Board/Table switch to toggle there -- it's Table, always. */}
          {kind === 'pipeline' && (
            <div className="seg seg-sm" role="group" aria-label="View">
              <button aria-pressed={view === 'board'} onClick={() => pickView('board')}><b>Board</b></button>
              <button aria-pressed={view === 'table'} onClick={() => pickView('table')}><b>Table</b></button>
            </div>
          )}
          {kind === 'people' && relOptions.length > 0 && (
            <Select className="cpage-filter" ariaLabel="Filter by relationship" value={relFilter} onChange={setRelFilter}
              options={[{ value: '', label: 'All relationships' }, ...relOptions.map((r) => ({ value: r, label: r }))]} />
          )}
          {kind === 'pipeline' && anySourced && (
            <input className="textinput cpage-search" type="search" placeholder="Search leads…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {kind === 'pipeline' && anySourced && (
            <button className="btn btn-quiet cpage-filtertoggle" aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}>Filters</button>
          )}
          {kind === 'pipeline' && anySourced && (
            <label className="btn btn-quiet cpage-import cpage-foldable">
              Import leads
              <input type="file" accept="application/json,.json" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = '' }} />
            </label>
          )}
          {kind === 'pipeline' && anySourced && (
            <label className="chk cpage-foldable"><input type="checkbox" checked={reachableOnly}
              onChange={(e) => setReachableOnly(e.target.checked)} /> Has a number</label>
          )}
          {kind === 'pipeline' && prospects.some((c) => c.lead) && (
            <Select className="cpage-filter cpage-foldable" ariaLabel="Minimum lead score" value={String(minScore)}
              onChange={(v) => setMinScore(Number(v))}
              options={[{ value: '0', label: 'Any score' }, { value: '45', label: 'Score 45+' }, { value: '60', label: 'Score 60+' }, { value: '75', label: 'Score 75+' }]} />
          )}
          {/* A filter with one option is not a filter. */}
          {kind === 'pipeline' && cityOptions.length > 1 && (
            <Select className="cpage-filter cpage-foldable" ariaLabel="Filter by city" value={cityFilter} onChange={setCityFilter}
              options={[{ value: '', label: 'All cities' }, ...cityOptions.map((c) => ({ value: c, label: c }))]} />
          )}
          {kind === 'pipeline' && offerOptions.length > 0 && (
            <Select className="cpage-filter cpage-foldable" ariaLabel="Filter by offer" value={offerFilter} onChange={setOfferFilter}
              options={[{ value: '', label: 'All offers' }, ...offerOptions.map((o) => ({ value: o, label: o }))]} />
          )}
          {kind === 'pipeline' && prospects.some((c) => c.lead) && (
            <Select className="cpage-filter cpage-foldable" ariaLabel="Filter by where it came from" value={sourcedOnly}
              onChange={(v) => setSourcedOnly(v as '' | 'sourced' | 'hand')}
              options={[{ value: '', label: 'Everyone' }, { value: 'sourced', label: 'Sourced' }, { value: 'hand', label: 'Added by hand' }]} />
          )}
        </div>
      </div>

      <div className="formrow" style={{ marginBottom: 'var(--s4)' }}>
        <input className="textinput" placeholder={kind === 'pipeline' ? 'Add a prospect…' : 'Add a person…'} readOnly onClick={() => setAdding(true)} />
        <button className="btn btn-quiet" onClick={() => setAdding(true)}>Add</button>
        {kind === 'pipeline' && !anySourced && (
          <label className="btn btn-quiet cpage-import">
            Import leads
            <input type="file" accept="application/json,.json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = '' }} />
          </label>
        )}
      </div>
      {storageFull && (
        <p className="cpage-warn">This device cannot save any more. Anything changed from here is lost on reload. Raise the score filter and re-import fewer leads, or sign in so the server holds them.</p>
      )}
      {kind === 'pipeline' && (importMsg || leadSync) && (
        <p className="cpage-importmsg">{[importMsg, leadSync].filter(Boolean).join('  ')}</p>
      )}

      {kind === 'people' ? (
        people.length === 0 ? (
          <div className="empty">Nobody added yet. Add the first person above.</div>
        ) : filteredRows.length === 0 ? (
          <div className="empty">Nobody with that relationship yet.</div>
        ) : (
          <div className="ctable-wrap">
            <table className="ctable">
              <thead><tr>
                <th onClick={() => setSort('name')}>Name{sortKey === 'name' && <span className="arrow">{sortDir === 1 ? '▲' : '▼'}</span>}</th>
                <th onClick={() => setSort('status')}>Status{sortKey === 'status' && <span className="arrow">{sortDir === 1 ? '▲' : '▼'}</span>}</th>
                <th onClick={() => setSort('company')}>Company / role{sortKey === 'company' && <span className="arrow">{sortDir === 1 ? '▲' : '▼'}</span>}</th>
                <th onClick={() => setSort('days')}>Last touch{sortKey === 'days' && <span className="arrow">{sortDir === 1 ? '▲' : '▼'}</span>}</th>
                <th onClick={() => setSort('next')}>Next{sortKey === 'next' && <span className="arrow">{sortDir === 1 ? '▲' : '▼'}</span>}</th>
              </tr></thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.c.id} onClick={() => setOpenId(r.c.id)}>
                    <td className="name"><div className="namecell"><Avatar name={r.c.name} size={30} /><div><b>{r.c.name}</b><span>{r.c.tag}</span></div></div></td>
                    <td><span className={`statusbadge s-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="ellipsis">{[r.c.company, r.c.role].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{ageLabel(r.days)}</td>
                    <td className="ellipsis">{r.c.next || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : prospects.length === 0 ? (
        <div className="empty">Nobody in the pipeline yet. Import a lead export or add a prospect from a wider screen, or open a contact and add them to the pipeline.</div>
      ) : filteredProspects.length === 0 ? (
        <div className="empty">Nobody matches those filters.</div>
      ) : effView === 'board' ? (
        <div className="cboard cboard-pipeline">
          {PIPELINE_STAGES.map((stage) => {
            /* Sourced rows sort by score, which is the order to work them in.
               Anything without one keeps the original age order and sits after. */
            const list = prospectRows.filter((r) => r.c.stage === stage)
              .sort((a, b) => (b.c.lead?.score ?? -1) - (a.c.lead?.score ?? -1) || b.days - a.days)
            const isFolded = folded.has(stage)
            return (
              <div className={`ccol drop-zone${dropStage === stage ? ' drop-over' : ''}`} key={stage} style={{ ['--stage-c' as string]: STAGE_COLOR[stage] }}
                onDragOver={(e) => { e.preventDefault(); setDropStage(stage) }}
                onDragLeave={() => setDropStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  if (id) {
                    const real = id.startsWith('lead:') ? promoteLead(id.slice(5)) : id
                    if (real) { setContactStage(real, stage); if (stage === 'lost') setOpenId(real) }
                  }
                  setDropStage(null)
                }}>
                <div className="ccol-head">
                  <span className="ccol-dot" /><span className="ccol-name">{STAGE_LABEL[stage]}</span><span className="ccol-count">{list.length}</span>
                  <button className="ccol-fold" onClick={() => toggleFold(stage)}>{isFolded ? 'Show' : 'Hide'}</button>
                </div>
                {!isFolded && (list.length ? (
                  <>
                    {list.slice(0, shownIn(stage)).map((r) => (
                      <PipelineCard key={r.c.id} c={r.c} offer={r.c.lead?.offerKey ? leadOffers[r.c.lead.offerKey] : undefined} never={neverTouched(r.c, contactActivity)} onOpen={() => setOpenId(r.c.id)}
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.c.id); e.dataTransfer.effectAllowed = 'move' }} />
                    ))}
                    {list.length > shownIn(stage) && (
                      <button className="ccol-more" onClick={() => showMore(stage)}>
                        {list.length - shownIn(stage)} more
                      </button>
                    )}
                  </>
                ) : <p className="ccol-empty">Nobody here.</p>)}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ctable-wrap">
          <table className="ctable">
            <thead><tr>
              <th onClick={() => setPSort('name')}>Name{pSortKey === 'name' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              <th onClick={() => setPSort('score')}>Score /100{pSortKey === 'score' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              {anySourced && <th>Phone</th>}
              {!oneStage && <th onClick={() => setPSort('stage')}>Stage{pSortKey === 'stage' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>}
              <th onClick={() => setPSort('company')}>{anySourced ? 'Where' : 'Company / role'}{pSortKey === 'company' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              {!allNever && <th onClick={() => setPSort('days')}>Age{pSortKey === 'days' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>}
              <th className="col-why" onClick={() => setPSort('next')}>{anySourced ? 'Why call them' : 'Next'}{pSortKey === 'next' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
            </tr></thead>
            <tbody>
              {pSortedRows.slice(0, tableCap).map((r) => (
                <tr key={r.c.id} onClick={() => setOpenId(r.c.id)}>
                  <td className="name"><div className="namecell"><Avatar name={r.c.name} size={30} /><div><b>{r.c.name}</b><span>{offerNameOf(r.c) ?? ''}</span></div></div></td>
                  <td className="mono">{r.c.lead ? r.c.lead.score : '—'}</td>
                  {anySourced && (
                    <td className="col-phone" onClick={(e) => e.stopPropagation()}>
                      {r.c.phone
                        ? <a href={`tel:${r.c.phone.replace(/\s/g, '')}`}>{r.c.phone}</a>
                        : <span className="col-phone-none">no number</span>}
                    </td>
                  )}
                  {!oneStage && <td><span className={`statusbadge st-${r.c.stage}`}>{STAGE_LABEL[r.c.stage]}</span></td>}
                  <td className="ellipsis">{[r.c.company, r.c.role].filter(Boolean).join(' · ') || [r.c.lead?.city, r.c.lead?.category].filter(Boolean).join(' · ') || '—'}</td>
                  {!allNever && <td>{neverTouched(r.c, contactActivity) ? 'never called' : ageLabel(r.days)}</td>}
                  <td className="col-why"><div className="clamp2">{r.c.next || r.c.lead?.evidence || '—'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pSortedRows.length > tableCap && (
            <button className="ccol-more" onClick={() => setTableCap((n) => n + 500)}>
              {pSortedRows.length - tableCap} more
            </button>
          )}
        </div>
      )}

      {adding && (
        <NewContactPanel kind={kind} onClose={() => setAdding(false)} onCreated={(id) => {
          if (kind === 'pipeline') setContactStage(id, 'reach_out')
          setOpenId(id)
        }} />
      )}
      {openContact && <ContactDetailPanel contact={openContact} onClose={() => setOpenId(null)} onPromoted={setOpenId} />}
    </div>
  )
}
