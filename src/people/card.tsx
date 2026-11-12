import { useEffect, useState } from 'react'
import { Select } from '../ui'
import { ALL_NAMES, daysUntil, nameDayFor } from '../namedays'
import type { ContactChannel, Person, PersonBond, PersonContact, PersonTier } from '../types'
import { CHANNEL, CHANNELS, Health, MONTHS, OFF_COLOUR, TIER, TIERS, colourOf, inDays, initials, overdue, sinceLabel } from './shared'

export const CADENCES: [number, string][] = [
  [1, 'Every day'], [3, 'Every 3 days'], [7, 'Every week'], [14, 'Every 2 weeks'],
  [30, 'Every month'], [90, 'Every 3 months'], [180, 'Every 6 months'], [365, 'Every year'],
]

export const ChannelIcon = ({ id, size = 16 }: { id: ContactChannel; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {CHANNEL[id].icon}
  </svg>
)

/* Suggestions only: any word he types is kept as he typed it. */
export const REL_WORDS = ['brother', 'sister', 'partner', 'wife', 'husband', 'mother', 'father', 'son', 'daughter', 'cousin', 'friend', 'best friend', 'colleague', 'boss', 'client', 'business partner', 'neighbour', 'ex']

export const fmtMD = (mmdd: string) => { const [m, d] = mmdd.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }

export const fmtDay = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

export function PersonCard({
  person, hh, people, bonds, contacts, today, onClose, onPatch, onTier, onLog, onUnlog, onLink, onLabel, onUnlink, onRemove,
}: {
  person: Person
  hh: Health
  people: Person[]
  bonds: PersonBond[]
  contacts: PersonContact[]
  today: string
  onClose: () => void
  onPatch: (patch: Partial<Pick<Person, 'name' | 'rel' | 'cadenceDays' | 'job' | 'birthday' | 'birthYear' | 'nameDayAs' | 'remindersOff'>>) => void
  onTier: (tier: PersonTier) => void
  onLog: (day: string, ch: ContactChannel) => void
  onUnlog: (id: string) => void
  onLink: (other: string, word: string) => void
  onLabel: (bondId: string, word: string) => void
  onUnlink: (bondId: string) => void
  onRemove: () => void
}) {
  const [day, setDay] = useState(today)
  const [armed, setArmed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [linkTo, setLinkTo] = useState('')
  const [linkWord, setLinkWord] = useState('')
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 2200)
    return () => window.clearTimeout(t)
  }, [flash])

  const linked = bonds
    .filter((b) => b.a === person.id || b.b === person.id)
    .map((b) => ({ bond: b, other: people.find((p) => p.id === (b.a === person.id ? b.b : b.a)) }))
    .filter((x): x is { bond: typeof x.bond; other: Person } => !!x.other)
  const unlinked = people.filter((p) => p.id !== person.id && !linked.some((l) => l.other.id === p.id))
  const history = [...contacts].sort((a, b) => (a.day === b.day ? b.createdAt - a.createdAt : a.day < b.day ? 1 : -1))
  const tracked = !person.remindersOff
  const colour = tracked ? colourOf(hh) : OFF_COLOUR
  const dueText = !tracked ? 'Reminders are off for them'
    : hh.days === null ? 'Log a first one'
      : hh.left < 0 ? `${-hh.left} days overdue`
        : hh.left === 0 ? 'Due today'
          : `Due in ${hh.left} days`
  const dueTone = !tracked ? '' : overdue(hh) ? 'is-alert' : hh.left <= 7 && hh.h <= 0.5 ? 'is-warn' : 'is-good'

  return (
    <div className="pp-card-scroll">
      <div className="pp-card-top">
        <span className="pp-card-av" style={{ background: colour }}>{initials(person.name)}</span>
        <div className="pp-card-names">
          <input className="pp-inline pp-in-name" value={person.name} aria-label="Name" onChange={(e) => onPatch({ name: e.target.value })} />
          <input className="pp-inline pp-in-rel" value={person.rel} aria-label="Who they are to you" placeholder="Who they are to you" onChange={(e) => onPatch({ rel: e.target.value })} />
        </div>
        <button className="pp-close" type="button" aria-label="Close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div className="pp-health">
        {tracked && <div className="pp-health-big"><i style={{ background: colour, transform: `scaleX(${Math.max(0.001, hh.h)})` }} /></div>}
        <div className="pp-health-lines">
          <span className="pp-when">{sinceLabel(hh)}</span>
          <span className={`pp-due-txt ${dueTone}`}>{dueText}</span>
        </div>
        <label className="pp-remind-toggle">
          <input type="checkbox" checked={tracked} onChange={(e) => onPatch({ remindersOff: !e.target.checked })} />
          <span className="pp-remind-switch" aria-hidden="true" />
          Remind me to reach out
        </label>
      </div>

      <AboutPerson person={person} today={today} onPatch={onPatch} />

      <div className="pp-row2">
        <div className="pp-field"><span>Talk to them</span>
          <Select
            className="pp-dd" ariaLabel="How often to talk to them" value={person.cadenceDays} disabled={!tracked}
            onChange={(n) => onPatch({ cadenceDays: n })}
            options={[
              ...CADENCES.map(([n, l]) => ({ value: n, label: l })),
              ...(CADENCES.some(([n]) => n === person.cadenceDays) ? [] : [{ value: person.cadenceDays, label: `Every ${person.cadenceDays} days` }]),
            ]}
          />
        </div>
        <div className="pp-field"><span>Circle</span>
          <Select
            className="pp-dd" ariaLabel="Circle" value={person.tier}
            onChange={(t) => onTier(t)} options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>
      </div>

      <div className="pp-section">
        <h3>Log a contact</h3>
        <div className="pp-channels">
          {CHANNELS.map((c) => (
            <button
              key={c.id} type="button" className="pp-ch"
              onClick={() => { onLog(day || today, c.id); setFlash(`Logged: ${c.label.toLowerCase()}${day && day !== today ? `, ${fmtDay(day)}` : ''}`) }}
            >
              <ChannelIcon id={c.id} size={18} />{c.label}
            </button>
          ))}
        </div>
        <label className="pp-log-when">On
          <input type="date" className="pp-select pp-date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <p className={`pp-flash${flash ? ' is-on' : ''}`} role="status" aria-live="polite">{flash ?? ''}</p>
      </div>

      <div className="pp-section">
        <h3>History</h3>
        {history.length === 0 && <p className="pp-muted">Nothing logged yet.</p>}
        {history.length > 0 && (
          <ul className="pp-history">
            {history.map((c) => (
              <li key={c.id}>
                <ChannelIcon id={c.channel} />
                <span className="pp-h-ch">{CHANNEL[c.channel].label}</span>
                <span className="pp-h-date">{fmtDay(c.day)}</span>
                <button className="pp-x" type="button" aria-label="Remove this entry" onClick={() => onUnlog(c.id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pp-section">
        <h3>Connected to</h3>
        {linked.length === 0 && <p className="pp-muted pp-mb">Only to you, so far.</p>}
        {linked.length > 0 && (
          <ul className="pp-links">
            {linked.map(({ bond, other }) => (
              <li key={bond.id}>
                <span className="pp-link-name">{other.name}</span>
                <span className="pp-link-is">is their</span>
                <BondWord
                  value={(bond.a === person.id ? bond.bToA : bond.aToB) ?? ''}
                  label={`What ${other.name} is to ${person.name}`}
                  onCommit={(w) => onLabel(bond.id, w)}
                />
                <button className="pp-x" type="button" aria-label={`Remove the link to ${other.name}`} onClick={() => onUnlink(bond.id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
        {unlinked.length > 0 && (
          <form
            className="pp-link-add"
            onSubmit={(e) => { e.preventDefault(); if (linkTo) { onLink(linkTo, linkWord); setLinkTo(''); setLinkWord('') } }}
          >
            <Select
              className="pp-dd pp-link-who" ariaLabel="Who to connect" value={linkTo} onChange={setLinkTo}
              options={[{ value: '', label: 'Connect someone' }, ...unlinked.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <input
              className="pp-text" list="pp-rel-words" value={linkWord} placeholder="is their… brother, friend"
              aria-label={`What they are to ${person.name}`} onChange={(e) => setLinkWord(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={!linkTo}>Connect</button>
          </form>
        )}
        <datalist id="pp-rel-words">{REL_WORDS.map((w) => <option key={w} value={w} />)}</datalist>
      </div>

      <button className={`pp-danger${armed ? ' is-armed' : ''}`} type="button" onClick={() => (armed ? onRemove() : setArmed(true))}>
        {armed ? `Click again to remove ${person.name}` : 'Remove from People'}
      </button>
    </div>
  )
}

export function AddPerson({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, rel: string, tier: PersonTier, cadence: number) => void }) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState('')
  const [tier, setTier] = useState<PersonTier>('friends')
  const [cadence, setCadence] = useState(TIER.friends.cadence)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pp-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form
        className="pp-dialog"
        aria-label="Add a person"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim(), rel.trim(), tier, cadence) }}
      >
        <h2>Add a person</h2>
        <label className="pp-field">Name
          <input className="pp-text" autoFocus required value={name} placeholder="Their name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pp-field">Who they are to you
          <input className="pp-text" value={rel} placeholder="Brother, gym friend, accountant" onChange={(e) => setRel(e.target.value)} />
        </label>
        <div className="pp-row2">
          <div className="pp-field"><span>Circle</span>
            <Select
              className="pp-dd pp-add-circle" ariaLabel="Circle" value={tier}
              onChange={(t) => { setTier(t); setCadence(TIER[t].cadence) }}
              options={TIERS.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
          <div className="pp-field"><span>Talk to them</span>
            <Select
              className="pp-dd" ariaLabel="How often to talk to them" value={cadence} onChange={setCadence}
              options={CADENCES.map(([n, l]) => ({ value: n, label: l }))}
            />
          </div>
        </div>
        <div className="pp-dialog-actions">
          <button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" disabled={!name.trim()}>Add</button>
        </div>
      </form>
    </div>
  )
}

/* Saved when he leaves the field or presses Enter, so typing a word is not a
   synced write per keystroke. */
export function BondWord({ value, label, onCommit, className = 'pp-inline pp-link-word', list = 'pp-rel-words', placeholder = 'add a word' }: {
  value: string; label: string; onCommit: (w: string) => void; className?: string; list?: string; placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()) }
  return (
    <input
      className={className} list={list} value={draft} placeholder={placeholder} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

/* Job, birthday and name day. The birthday is a day and a month, with the year
   only when he knows it; the name day follows the first name unless he says
   which calendar name it goes by. */
export function AboutPerson({ person, today, onPatch }: {
  person: Person
  today: string
  onPatch: (patch: Partial<Pick<Person, 'job' | 'birthday' | 'birthYear' | 'nameDayAs'>>) => void
}) {
  const [bm, bd] = (person.birthday ?? '-').split('-')
  const [month, setMonth] = useState(bm ?? '')
  const [day, setDay] = useState(bd ?? '')
  useEffect(() => { const [m, d] = (person.birthday ?? '-').split('-'); setMonth(m ?? ''); setDay(d ?? '') }, [person.birthday])
  const setBirth = (m: string, d: string) => {
    setMonth(m); setDay(d)
    if (m && d) onPatch({ birthday: `${m}-${d}` })
    else if (!m && !d) onPatch({ birthday: undefined, birthYear: undefined })
  }
  const maxDay = month ? new Date(2024, Number(month), 0).getDate() : 31
  const bdays = person.birthday ? daysUntil(person.birthday, today) : null
  // The age on the next birthday: this year's if it has not passed yet, else next year's.
  const turning = person.birthday && person.birthYear
    ? Number(today.slice(0, 4)) + (person.birthday < today.slice(5) ? 1 : 0) - person.birthYear
    : null
  const nd = nameDayFor(person.name, person.nameDayAs)
  const ndays = nd ? daysUntil(nd.day, today) : null
  const first = person.name.trim().split(/\s+/)[0] ?? ''

  return (
    <div className="pp-section pp-about">
      <label className="pp-field">Job
        <BondWord
          value={person.job ?? ''} label="Job" className="pp-text" list="" placeholder="What they do"
          onCommit={(w) => onPatch({ job: w || undefined })}
        />
      </label>

      <div className="pp-field">
        <span>Birthday</span>
        <div className="pp-birth">
          <Select
            className="pp-dd" ariaLabel="Birthday day" value={day} onChange={(d) => setBirth(month, d)}
            options={[{ value: '', label: 'Day' }, ...Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => ({ value: d, label: String(Number(d)) }))]}
          />
          <Select
            className="pp-dd" ariaLabel="Birthday month" value={month}
            onChange={(m) => setBirth(m, day && m && Number(day) > new Date(2024, Number(m), 0).getDate() ? '' : day)}
            options={[{ value: '', label: 'Month' }, ...MONTHS.map((m, i) => ({ value: String(i + 1).padStart(2, '0'), label: m }))]}
          />
          <input
            className="pp-text" inputMode="numeric" aria-label="Birth year, if you know it" placeholder="Year"
            defaultValue={person.birthYear ?? ''} key={person.birthYear ?? 'none'}
            onBlur={(e) => {
              const y = Number(e.target.value)
              const ok = Number.isInteger(y) && y > 1900 && y <= Number(today.slice(0, 4))
              if (!e.target.value.trim()) { if (person.birthYear) onPatch({ birthYear: undefined }) }
              else if (ok && y !== person.birthYear) onPatch({ birthYear: y })
              else if (!ok) e.target.value = person.birthYear ? String(person.birthYear) : ''
            }}
          />
        </div>
        {person.birthday && bdays !== null && (
          <span className={`pp-about-line${bdays <= 7 ? ' is-soon' : ''}`}>
            {turning !== null ? `Turns ${turning} on ${fmtMD(person.birthday)}` : fmtMD(person.birthday)}, {inDays(bdays)}
          </span>
        )}
      </div>

      <div className="pp-field">
        <span>Name day</span>
        {nd && ndays !== null
          ? <span className={`pp-about-line is-strong${ndays <= 7 ? ' is-soon' : ''}`}>{nd.name}, {fmtMD(nd.day)}, {inDays(ndays)}</span>
          : <span className="pp-about-line">{person.nameDayAs ? `"${person.nameDayAs}" is not in the Czech calendar` : `No name day for "${first}" in the Czech calendar`}</span>}
        <BondWord
          value={person.nameDayAs ?? ''} label="Name day goes by" className="pp-text" list="pp-cal-names"
          placeholder={nd && !person.nameDayAs ? `Goes by ${nd.name}` : 'Goes by, e.g. Veronika'}
          onCommit={(w) => onPatch({ nameDayAs: w || undefined })}
        />
        <datalist id="pp-cal-names">{ALL_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
    </div>
  )
}
