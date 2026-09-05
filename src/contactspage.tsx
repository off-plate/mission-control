import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { useStore } from './store'
import { AutoTextarea, Band, Select, SpaceMark, type SelectOption } from './ui'
import {
  contactDaysSince, contactStatus, stageDaysSince, PIPELINE_STAGES, STAGE_LABEL,
  type Contact, type ContactStatus, type PipelineStage,
} from './types'

const STATUS_LABEL: Record<ContactStatus, string> = { quiet: 'Gone Quiet', soon: 'Reach Out Soon', track: 'On Track' }
const STATUS_ORDER: ContactStatus[] = ['quiet', 'soon', 'track']
/* Column colour, not badge colour -- s-quiet/s-soon/s-track (badges, tables)
   stay put; this is the top-stripe-and-dot treatment the board now shares
   with the pipeline board below it. */
const STATUS_COLOR: Record<ContactStatus, string> = { quiet: 'var(--alert)', soon: 'var(--warn)', track: 'var(--accent-text)' }
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

function ContactDetailPanel({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { projects, contactActivity, updateContact, deleteContact, logContactActivity, setContactStage } = useStore()
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
    <ContactPanel title={contact.name || 'New contact'} avatarName={contact.name || '?'} onClose={onClose}>
      {contact.stage ? (
        <>
          <span className="field-label">Stage</span>
          <div className="stagepick">
            {PIPELINE_STAGES.map((s) => (
              <button key={s} className={`stagepick-btn${s === contact.stage ? ' is-active' : ''}`}
                style={s === contact.stage ? { background: STAGE_COLOR[s], color: s === 'acquired' ? 'var(--ink)' : '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => setContactStage(contact.id, s)}>{STAGE_LABEL[s]}</button>
            ))}
          </div>
          <div className="contact-stageage">{ageLabel(stageDaysSince(contact))} in this stage</div>
        </>
      ) : (
        <button className="btn btn-quiet" style={{ marginBottom: 'var(--s3)' }}
          onClick={() => setContactStage(contact.id, 'reach_out')}>Add to pipeline</button>
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
          <button key={t} className="logbtn" onClick={() => logContactActivity(contact.id, t)}>{LOG_LABEL[t]}</button>
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

      <div className="cpanel-actions">
        <button className="btn btn-danger" onClick={() => { deleteContact(contact.id); onClose() }}>Delete</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </ContactPanel>
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

function ContactCard({ c, days, onOpen }: { c: Contact; days: number; onOpen: () => void }) {
  return (
    <button className="leadcard" onClick={onOpen}>
      <div className="leadcard-top">
        <Avatar name={c.name} />
        <div><div className="leadcard-name">{c.name}</div><div className="leadcard-sub">{c.tag || '—'}</div></div>
      </div>
      <div className="leadcard-foot"><span className="leadcard-age">{ageLabel(days)}</span></div>
    </button>
  )
}

function PipelineCard({ c, onOpen, onDragStart }: { c: Contact; onOpen: () => void; onDragStart: (e: DragEvent<HTMLDivElement>) => void }) {
  const days = stageDaysSince(c)
  const stale = c.stage === 'contacted' && days > 14
  return (
    <div className="leadcard" role="button" tabIndex={0} draggable onDragStart={onDragStart}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="leadcard-top">
        <Avatar name={c.name} />
        <div><div className="leadcard-name">{c.name}</div>
          {(c.company || c.role) && <div className="leadcard-sub">{[c.company, c.role].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>
      <div className="leadcard-foot">
        <span className={`leadcard-age${stale ? ' is-stale' : ''}`}>{ageLabel(days)} in stage</span>
        {c.next && <span className="leadcard-next" title={c.next}>{c.next}</span>}
      </div>
    </div>
  )
}

/* Acquired and Lost are still live lanes -- Off-Plate's own CRM note is
   explicit that Acquired stays visible ("what happens after the first
   invoice is where the money is") and Lost's reasons are the whole point.
   Folded by default is a display preference, not an archive: the count
   still shows, one click opens the lane back up. */
const FOLDED_BY_DEFAULT: PipelineStage[] = ['acquired', 'lost']

export function ContactsPage() {
  const { contacts, contactActivity, setContactStage } = useStore()
  const [kind, setKind] = useState<'people' | 'pipeline'>('people')
  const [view, setView] = useState<'board' | 'table'>('board')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'company' | 'days' | 'next'>('days')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [pSortKey, setPSortKey] = useState<'name' | 'stage' | 'company' | 'days' | 'next'>('days')
  const [pSortDir, setPSortDir] = useState<1 | -1>(-1)
  const [relFilter, setRelFilter] = useState('')
  const [folded, setFolded] = useState<Set<PipelineStage>>(new Set(FOLDED_BY_DEFAULT))
  const [dropStage, setDropStage] = useState<PipelineStage | null>(null)

  /* Stage is the only thing that decides which of the two this page shows a
     contact in -- not a separate kind field. "The board is the only place a
     client's stage lives" is the CRM Client card note's own rule; a contact
     either carries a stage or it doesn't. */
  const people = contacts.filter((c) => !c.stage)
  const prospects = contacts.filter((c): c is Contact & { stage: PipelineStage } => !!c.stage)
  const openContact = contacts.find((c) => c.id === openId) ?? null

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

  const prospectRows = prospects.map((c) => ({ c, days: stageDaysSince(c) }))
  const setPSort = (key: typeof pSortKey) => {
    if (key === pSortKey) setPSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1)
    else { setPSortKey(key); setPSortDir(key === 'name' ? 1 : -1) }
  }
  const pSortVal = (r: typeof prospectRows[number]) => (
    pSortKey === 'name' ? r.c.name
      : pSortKey === 'stage' ? PIPELINE_STAGES.indexOf(r.c.stage)
        : pSortKey === 'company' ? (r.c.company ?? '')
          : pSortKey === 'next' ? (r.c.next ?? '')
            : r.days
  )
  const pSortedRows = [...prospectRows].sort((a, b) => {
    const av = pSortVal(a), bv = pSortVal(b)
    if (av < bv) return -1 * pSortDir
    if (av > bv) return 1 * pSortDir
    return 0
  })

  const toggleFold = (stage: PipelineStage) => setFolded((prev) => {
    const next = new Set(prev)
    if (next.has(stage)) next.delete(stage); else next.add(stage)
    return next
  })

  return (
    <div className="page">
      <Band title="Contacts" metrics={[{ v: String(kind === 'pipeline' ? prospects.length : people.length), k: kind === 'pipeline' ? 'in pipeline' : 'people' }]} />

      <div className="kindrow">
        <div className="kind" role="tablist" aria-label="Kind">
          <button aria-pressed={kind === 'people'} onClick={() => setKind('people')}>People</button>
          <button aria-pressed={kind === 'pipeline'} onClick={() => setKind('pipeline')}>Pipeline</button>
        </div>
        <div className="cpage-subrow">
          <div className="seg seg-sm" role="group" aria-label="View">
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}><b>Board</b></button>
            <button aria-pressed={view === 'table'} onClick={() => setView('table')}><b>Table</b></button>
          </div>
          {kind === 'people' && relOptions.length > 0 && (
            <Select className="cpage-filter" ariaLabel="Filter by relationship" value={relFilter} onChange={setRelFilter}
              options={[{ value: '', label: 'All relationships' }, ...relOptions.map((r) => ({ value: r, label: r }))]} />
          )}
        </div>
      </div>

      <div className="formrow" style={{ marginBottom: 'var(--s4)' }}>
        <input className="textinput" placeholder={kind === 'pipeline' ? 'Add a prospect…' : 'Add a person…'} readOnly onClick={() => setAdding(true)} />
        <button className="btn btn-quiet" onClick={() => setAdding(true)}>Add</button>
      </div>

      {kind === 'people' ? (
        people.length === 0 ? (
          <div className="empty">Nobody added yet. Add the first person above.</div>
        ) : filteredRows.length === 0 ? (
          <div className="empty">Nobody with that relationship yet.</div>
        ) : view === 'board' ? (
          <div className="cboard">
            {STATUS_ORDER.map((st) => {
              const list = filteredRows.filter((r) => r.status === st).sort((a, b) => b.days - a.days)
              return (
                <div className="ccol" key={st} style={{ ['--stage-c' as string]: STATUS_COLOR[st] }}>
                  <div className="ccol-head"><span className="ccol-dot" /><span className="ccol-name">{STATUS_LABEL[st]}</span><span className="ccol-count">{list.length}</span></div>
                  {list.length ? list.map((r) => (
                    <ContactCard key={r.c.id} c={r.c} days={r.days} onOpen={() => setOpenId(r.c.id)} />
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
        <div className="empty">Nobody in the pipeline yet. Add someone above, or open a contact and add them to the pipeline.</div>
      ) : view === 'board' ? (
        <div className="cboard cboard-pipeline">
          {PIPELINE_STAGES.map((stage) => {
            const list = prospectRows.filter((r) => r.c.stage === stage).sort((a, b) => b.days - a.days)
            const isFolded = folded.has(stage)
            return (
              <div className={`ccol drop-zone${dropStage === stage ? ' drop-over' : ''}`} key={stage} style={{ ['--stage-c' as string]: STAGE_COLOR[stage] }}
                onDragOver={(e) => { e.preventDefault(); setDropStage(stage) }}
                onDragLeave={() => setDropStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/plain')
                  if (id) { setContactStage(id, stage); if (stage === 'lost') setOpenId(id) }
                  setDropStage(null)
                }}>
                <div className="ccol-head">
                  <span className="ccol-dot" /><span className="ccol-name">{STAGE_LABEL[stage]}</span><span className="ccol-count">{list.length}</span>
                  <button className="ccol-fold" onClick={() => toggleFold(stage)}>{isFolded ? 'Show' : 'Hide'}</button>
                </div>
                {!isFolded && (list.length ? list.map((r) => (
                  <PipelineCard key={r.c.id} c={r.c} onOpen={() => setOpenId(r.c.id)}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.c.id); e.dataTransfer.effectAllowed = 'move' }} />
                )) : <p className="ccol-empty">Nobody here.</p>)}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ctable-wrap">
          <table className="ctable">
            <thead><tr>
              <th onClick={() => setPSort('name')}>Name{pSortKey === 'name' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              <th onClick={() => setPSort('stage')}>Stage{pSortKey === 'stage' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              <th onClick={() => setPSort('company')}>Company / role{pSortKey === 'company' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              <th onClick={() => setPSort('days')}>Time in stage{pSortKey === 'days' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
              <th onClick={() => setPSort('next')}>Next{pSortKey === 'next' && <span className="arrow">{pSortDir === 1 ? '▲' : '▼'}</span>}</th>
            </tr></thead>
            <tbody>
              {pSortedRows.map((r) => (
                <tr key={r.c.id} onClick={() => setOpenId(r.c.id)}>
                  <td className="name"><div className="namecell"><Avatar name={r.c.name} size={30} /><div><b>{r.c.name}</b></div></div></td>
                  <td><span className={`statusbadge st-${r.c.stage}`}>{STAGE_LABEL[r.c.stage]}</span></td>
                  <td className="ellipsis">{[r.c.company, r.c.role].filter(Boolean).join(' · ') || '—'}</td>
                  <td>{ageLabel(r.days)}</td>
                  <td className="ellipsis">{r.c.next || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <NewContactPanel kind={kind} onClose={() => setAdding(false)} onCreated={(id) => {
          if (kind === 'pipeline') setContactStage(id, 'reach_out')
          setOpenId(id)
        }} />
      )}
      {openContact && <ContactDetailPanel contact={openContact} onClose={() => setOpenId(null)} />}
    </div>
  )
}
