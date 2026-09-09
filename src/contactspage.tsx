/* CONTACTS. The CRM sales pipeline (stages, sourced leads, the board/table
   switcher, importing a lead export) was deleted here on his instruction
   (2026-09-09) -- he does not work it inside Mission Control. This page is
   plain contacts only: people, their logged touches, and "gone quiet". */
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store'
import { AutoTextarea, Band, Select, SpaceMark, type SelectOption } from './ui'
import { contactDaysSince, contactStatus, type Contact, type ContactActivity, type ContactStatus } from './types'

const STATUS_LABEL: Record<ContactStatus, string> = { quiet: 'Gone Quiet', soon: 'Reach Out Soon', track: 'On Track' }
const LOG_TYPES = ['call', 'text', 'email', 'meeting'] as const
const LOG_LABEL: Record<string, string> = { call: 'Call', text: 'Text', email: 'Email', meeting: 'Meeting' }

/* The one closed set a relationship can be. Closed on purpose: a filter
   over freeform text is not a filter. A contact saved before this shipped
   can still hold a value outside this list -- ContactDetailPanel adds it
   back in as an extra option rather than silently discarding it. */
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
   centred card, so a full record (fields, log, activity) has room to
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

function ContactDetailPanel({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { projects, contactActivity, updateContact, deleteContact, logContactActivity, deleteContactActivity } = useStore()
  const [name, setName] = useState(contact.name)
  const [tag, setTag] = useState(contact.tag)
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [email, setEmail] = useState(contact.email ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [role, setRole] = useState(contact.role ?? '')
  const [next, setNext] = useState(contact.next ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')

  /* Every field commits the moment it's left, not on a single "Save" at the
     end -- the panel's own Escape key and a backdrop click both call this
     same onClose, so a save that only happened there would be skippable.
     Losing a field to a stray click is worse than a few extra writes. */
  const commit = (patch: Partial<Contact>) => updateContact(contact.id, patch)
  const logTouch = (t: ContactActivity['type']) => logContactActivity(contact.id, t)

  const mine = contactActivity.filter((a) => a.contactId === contact.id).sort((a, b) => b.at.localeCompare(a.at))
  const days = contactDaysSince(contact, contactActivity)
  const status = contactStatus(contact, contactActivity)
  const project = contact.projectId ? projects.find((p) => p.id === contact.projectId) : undefined

  const tagOptions: SelectOption<string>[] = [
    { value: '', label: 'Not set' },
    ...RELATIONSHIPS.map((r) => ({ value: r as string, label: r })),
    ...(tag && !(RELATIONSHIPS as readonly string[]).includes(tag) ? [{ value: tag, label: tag }] : []),
  ]

  return (
    <ContactPanel title={contact.name || 'New contact'} avatarName={contact.name || '?'} onClose={onClose}>
      <div className="contact-toprow">
        <span className={`statusbadge s-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="contact-lasttouch">Last touch: {ageLabel(days)}</span>
      </div>

      {(contact.phone || contact.email) && (
        <div className="callrow">
          {contact.phone && <a className="btn btn-primary callbtn" href={`tel:${contact.phone.replace(/\s/g, '')}`}>Call {contact.phone}</a>}
          {contact.email && <a className="btn btn-quiet callbtn" href={`mailto:${contact.email}`}>Email</a>}
        </div>
      )}

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

      <label className="field-label">Log a touch</label>
      <div className="contact-logrow contact-logrow-top">
        {LOG_TYPES.map((t) => (
          <button key={t} className="logbtn" onClick={() => logTouch(t)}>{LOG_LABEL[t]}</button>
        ))}
      </div>

      <label className="field-label" htmlFor="ct-next">Next</label>
      <input id="ct-next" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }} placeholder="What's the next step with this person?"
        value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => commit({ next: next.trim() })} />

      <label className="field-label" htmlFor="ct-notes">Notes</label>
      <AutoTextarea id="ct-notes" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }}
        value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => commit({ notes: notes.trim() })} />

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
        <button className="btn btn-danger" onClick={() => { deleteContact(contact.id); onClose() }}>Delete</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </ContactPanel>
  )
}

function NewContactPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { addContact } = useStore()
  const [name, setName] = useState('')
  const save = () => { if (!name.trim()) return; const id = addContact(name); onClose(); onCreated(id) }
  return (
    <ContactPanel title="New contact" onClose={onClose}>
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

export function ContactsPage() {
  const { contacts, contactActivity, storageFull } = useStore()
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'company' | 'days' | 'next'>('days')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [relFilter, setRelFilter] = useState('')

  const openContact = contacts.find((c) => c.id === openId) ?? null
  const rows = contacts.map((c) => ({ c, days: contactDaysSince(c, contactActivity), status: contactStatus(c, contactActivity) }))
  const relOptions = Array.from(new Set(contacts.map((c) => c.tag).filter(Boolean))).sort()
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

  return (
    <div className="page">
      <Band title="Contacts" metrics={[{ v: String(contacts.length), k: 'people' }]} />

      <div className="kindrow">
        {relOptions.length > 0 && (
          <Select className="cpage-filter" ariaLabel="Filter by relationship" value={relFilter} onChange={setRelFilter}
            options={[{ value: '', label: 'All relationships' }, ...relOptions.map((r) => ({ value: r, label: r }))]} />
        )}
        <button className="btn btn-quiet" onClick={() => setAdding(true)}>Add a person</button>
      </div>

      {storageFull && (
        <p className="cpage-warn">This device cannot save any more. Anything changed from here is lost on reload.</p>
      )}

      {contacts.length === 0 ? (
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
      )}

      {adding && <NewContactPanel onClose={() => setAdding(false)} onCreated={setOpenId} />}
      {openContact && <ContactDetailPanel contact={openContact} onClose={() => setOpenId(null)} />}
    </div>
  )
}
