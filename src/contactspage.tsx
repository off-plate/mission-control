import { useState } from 'react'
import { useStore } from './store'
import { AutoTextarea, Band, Segmented, Select, SpaceMark, type SelectOption } from './ui'
import { Sheet } from './modals'
import { contactDaysSince, contactStatus, type Contact, type ContactStatus } from './types'

const STATUS_LABEL: Record<ContactStatus, string> = { quiet: 'Gone Quiet', soon: 'Reach Out Soon', track: 'On Track' }
const STATUS_ORDER: ContactStatus[] = ['quiet', 'soon', 'track']
const LOG_TYPES = ['call', 'text', 'email', 'meeting'] as const
const LOG_LABEL: Record<string, string> = { call: 'Call', text: 'Text', email: 'Email', meeting: 'Meeting' }

/* The one closed set a relationship can be. Closed on purpose: this field
   doubles as the CRM's only filter, and a filter over freeform text is not
   a filter. A contact saved before this shipped can still hold a value
   outside this list -- ContactDetailSheet adds it back in as an extra
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

function ContactDetailSheet({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { projects, contactActivity, updateContact, deleteContact, logContactActivity } = useStore()
  const [name, setName] = useState(contact.name)
  const [tag, setTag] = useState(contact.tag)
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [email, setEmail] = useState(contact.email ?? '')
  const [company, setCompany] = useState(contact.company ?? '')
  const [role, setRole] = useState(contact.role ?? '')
  const [next, setNext] = useState(contact.next ?? '')
  const [notes, setNotes] = useState(contact.notes ?? '')

  /* Every field commits the moment it's left, not on a single "Save" at the
     end -- Sheet's own Escape key and a backdrop click both call this same
     onClose, so a save that only happened there would be skippable. Losing
     a field to a stray click is worse than a few extra writes. */
  const commit = (patch: Partial<Contact>) => updateContact(contact.id, patch)

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
    <Sheet title={contact.name || 'New contact'} onClose={onClose} steady>
      <div className="contact-toprow">
        <span className={`statusbadge s-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="contact-lasttouch">Last touch: {ageLabel(days)}</span>
      </div>

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

      <label className="field-label" htmlFor="ct-next">Next</label>
      <input id="ct-next" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }} placeholder="What's the next step with this person?"
        value={next} onChange={(e) => setNext(e.target.value)} onBlur={() => commit({ next: next.trim() })} />

      <label className="field-label" htmlFor="ct-notes">Notes</label>
      <AutoTextarea id="ct-notes" className="textinput" style={{ width: '100%', marginBottom: 'var(--s4)' }}
        value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => commit({ notes: notes.trim() })} />

      <label className="field-label">Log a touch</label>
      <div className="contact-logrow">
        {LOG_TYPES.map((t) => (
          <button key={t} className="btn btn-quiet" onClick={() => logContactActivity(contact.id, t)}>{LOG_LABEL[t]}</button>
        ))}
      </div>

      <label className="field-label">Activity</label>
      <div className="contact-activity">
        {mine.length ? mine.map((a) => (
          <div className="contact-activity-row" key={a.id}>
            <span className="contact-activity-icon">{LOG_LABEL[a.type][0]}</span>
            <div className="contact-activity-body">
              <div>{LOG_LABEL[a.type]}</div>
              <div className="contact-activity-when">{ageLabel(Math.max(0, Math.floor((Date.now() - new Date(a.at).getTime()) / 86400000)))}</div>
            </div>
          </div>
        )) : <p className="empty">Nothing logged yet.</p>}
      </div>

      <div className="sheet-actions">
        <button className="btn btn-danger" onClick={() => { deleteContact(contact.id); onClose() }}>Delete</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  )
}

function NewContactSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { addContact } = useStore()
  const [name, setName] = useState('')
  const save = () => { if (!name.trim()) return; const id = addContact(name); onClose(); onCreated(id) }
  return (
    <Sheet title="New contact" onClose={onClose}>
      <label className="field-label" htmlFor="nc-name">Name</label>
      <input id="nc-name" className="textinput" style={{ width: '100%' }} value={name} autoFocus
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save() }} />
      <div className="sheet-actions">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Add</button>
      </div>
    </Sheet>
  )
}

function ContactCard({ c, days, status, onOpen }: { c: Contact; days: number; status: ContactStatus; onOpen: () => void }) {
  return (
    <button className="ccard" onClick={onOpen}>
      <b>{c.name}</b>
      <div className="ccard-sub">{c.tag || '—'}</div>
      <div className="ccard-foot">
        <span className="ccard-lasttouch">{ageLabel(days)}</span>
      </div>
    </button>
  )
}

export function ContactsPage() {
  const { contacts, contactActivity } = useStore()
  const [view, setView] = useState<'board' | 'table'>('board')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'company' | 'days' | 'next'>('days')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [relFilter, setRelFilter] = useState('')

  const rows = contacts.map((c) => ({ c, days: contactDaysSince(c, contactActivity), status: contactStatus(c, contactActivity) }))
  const openContact = contacts.find((c) => c.id === openId) ?? null

  /* Relationship is the only filter this page gets -- deliberately, not an
     oversight. Options come from what's actually in use, not the full
     RELATIONSHIPS list, so the control never offers a choice that would
     return nothing. */
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
      <Band title="Contacts" />
      <div className="cpage-head">
        <Segmented value={view} onPick={setView} label="View" size="sm"
          options={[{ id: 'board', label: 'Board' }, { id: 'table', label: 'Table' }]} />
        {relOptions.length > 0 && (
          <Select className="cpage-filter" ariaLabel="Filter by relationship" value={relFilter} onChange={setRelFilter}
            options={[{ value: '', label: 'All relationships' }, ...relOptions.map((r) => ({ value: r, label: r }))]} />
        )}
      </div>
      <div className="formrow" style={{ marginBottom: 'var(--s4)' }}>
        <input className="textinput" placeholder="Add a person…" readOnly onClick={() => setAdding(true)} />
        <button className="btn btn-quiet" onClick={() => setAdding(true)}>Add</button>
      </div>

      {contacts.length === 0 ? (
        <div className="empty">Nobody added yet. Add the first person above.</div>
      ) : filteredRows.length === 0 ? (
        <div className="empty">Nobody with that relationship yet.</div>
      ) : view === 'board' ? (
        <div className="cboard">
          {STATUS_ORDER.map((st) => {
            const list = filteredRows.filter((r) => r.status === st).sort((a, b) => b.days - a.days)
            return (
              <div className="ccol" key={st}>
                <div className="ccol-head"><span className={`statusbadge s-${st}`}>{STATUS_LABEL[st]}</span><span className="ccol-count">{list.length}</span></div>
                {list.length ? list.map((r) => (
                  <ContactCard key={r.c.id} c={r.c} days={r.days} status={r.status} onOpen={() => setOpenId(r.c.id)} />
                )) : <p className="ccol-empty">Nobody here.</p>}
              </div>
            )
          })}
        </div>
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
                  <td className="name"><b>{r.c.name}</b><span>{r.c.tag}</span></td>
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

      {adding && <NewContactSheet onClose={() => setAdding(false)} onCreated={(id) => setOpenId(id)} />}
      {openContact && <ContactDetailSheet contact={openContact} onClose={() => setOpenId(null)} />}
    </div>
  )
}
