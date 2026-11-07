/* REMINDERS, inspired by Apple's Reminders (his ask, 2026-11-07).

   Same anatomy as Apple's: five smart lists as tiles with counts (Today,
   Scheduled, All, Flagged, Completed), his own coloured lists below, and the
   chosen list on the right with round tick circles. A ticked reminder fades
   and leaves, completed ones stay one tap away. Tapping a reminder opens it in
   place: title, notes, when it reminds him, repeat, list, flag, delete.

   A reminder time is when it reminds him, not a deadline. Nothing turns red
   when it passes (Mission Control is against due dates, memory
   feedback_no_due_dates); a passed one is just listed under "Earlier".

   On a phone the lists and the open list are two screens, like the iPhone app. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { DEFAULT_LIST_ID, fromLocalStamp, toLocalStamp } from './store/reminders'
import { alertsSupported } from './reminderalerts'
import type { Reminder } from './types'
import './reminders.css'

/* Named colours, each dark enough for a white glyph on it and for coloured text on white. */
export const REMINDER_COLORS: Record<string, string> = {
  red: '#C4151D', orange: '#B35400', amber: '#8A6200', green: '#00733F',
  teal: '#0B7285', blue: '#2453E6', purple: '#6B3FC7', brown: '#7A5230',
}
const colorOf = (c: string) => REMINDER_COLORS[c] ?? REMINDER_COLORS.blue

type SmartId = 'today' | 'scheduled' | 'all' | 'flagged' | 'completed'
const SMART: { id: SmartId; name: string; color: string }[] = [
  { id: 'today', name: 'Today', color: '#2453E6' },
  { id: 'scheduled', name: 'Scheduled', color: '#C4151D' },
  { id: 'all', name: 'All', color: '#12100C' },
  { id: 'flagged', name: 'Flagged', color: '#B35400' },
  { id: 'completed', name: 'Completed', color: '#00733F' },
]
const isSmart = (s: string): s is SmartId => SMART.some((m) => m.id === s)
const REPEATS: { id: Reminder['repeat'] | 'none'; label: string }[] = [
  { id: 'none', label: 'Never' }, { id: 'daily', label: 'Every day' }, { id: 'weekly', label: 'Every week' }, { id: 'monthly', label: 'Every month' },
]

const SEL_KEY = 'mc-rem-sel'
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const at = (d: Date, h: number, m = 0) => { const x = dayStart(d); x.setHours(h, m); return x }
const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

function dayDiff(d: Date, now: Date): number {
  return Math.round((dayStart(d).getTime() - dayStart(now).getTime()) / 864e5)
}
function dayLabel(d: Date, now: Date): string {
  const n = dayDiff(d, now)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n > 1 && n < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' })
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}
const whenText = (stamp: string, now: Date) => { const d = fromLocalStamp(stamp); return `${dayLabel(d, now)} ${hm(d)}` }

/** The quick times Apple offers, computed from now. */
function quickTimes(now: Date): { label: string; stamp: string }[] {
  const out: { label: string; stamp: string }[] = []
  const evening = at(now, 19)
  if (evening.getTime() > now.getTime() + 15 * 60000) out.push({ label: 'This evening', stamp: toLocalStamp(evening) })
  out.push({ label: 'Tomorrow', stamp: toLocalStamp(at(addDays(now, 1), 9)) })
  const toSat = (6 - now.getDay() + 7) % 7 || 7
  out.push({ label: 'This weekend', stamp: toLocalStamp(at(addDays(now, now.getDay() === 6 ? 0 : toSat), 10)) })
  const toMon = (8 - now.getDay()) % 7 || 7
  out.push({ label: 'Next week', stamp: toLocalStamp(at(addDays(now, toMon), 9)) })
  return out
}
/** The next whole hour, for a reminder added to Today with no time said. */
function nextHour(now: Date): string { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return toLocalStamp(d) }

function inSmart(id: SmartId, r: Reminder, now: Date): boolean {
  if (id === 'completed') return !!r.doneAt
  if (r.doneAt) return false
  if (id === 'today') return !!r.remindAt && dayDiff(fromLocalStamp(r.remindAt), now) <= 0
  if (id === 'scheduled') return !!r.remindAt
  if (id === 'flagged') return r.flagged
  return true
}

const Ico = {
  today: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>,
  scheduled: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  all: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5" /></svg>,
  flagged: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></svg>,
  completed: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.5 3.5 7.5-8" /></svg>,
  list: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" /></svg>,
  plus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" /></svg>,
  clock: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>,
  repeat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3M4 12v-2a4 4 0 0 1 4-4h12M7 21l-3-3 3-3M20 12v2a4 4 0 0 1-4 4H4" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>,
  bell: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" /></svg>,
}

export function RemindersPage() {
  const { reminders, reminderLists, addReminder, updateReminder, toggleReminder, deleteReminder, addReminderList, updateReminderList, deleteReminderList } = useStore()
  const [sel, setSelRaw] = useState<string>(() => { try { return localStorage.getItem(SEL_KEY) || 'today' } catch { return 'today' } })
  const [phoneList, setPhoneList] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [fading, setFading] = useState<Record<string, true>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newList, setNewList] = useState<{ name: string; color: string } | null>(null)
  const [editList, setEditList] = useState(false)
  const [perm, setPerm] = useState(() => (alertsSupported() ? Notification.permission : 'denied'))
  const [now, setNow] = useState(() => new Date())
  const lastUserList = useRef<string>(DEFAULT_LIST_ID)
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(t) }, [])

  /* A list that was deleted (here or on another device) falls back to Today. */
  const smart = isSmart(sel) ? SMART.find((m) => m.id === sel)! : null
  const list = smart ? null : reminderLists.find((l) => l.id === sel) ?? null
  useEffect(() => { if (!smart && !list) setSelRaw('today') }, [smart, list])
  if (list) lastUserList.current = list.id

  const setSel = (id: string) => {
    setSelRaw(id); setOpenId(null); setEditList(false); setPhoneList(true)
    try { localStorage.setItem(SEL_KEY, id) } catch { /* private window */ }
  }
  const listById = useMemo(() => new Map(reminderLists.map((l) => [l.id, l])), [reminderLists])
  const open_ = reminders.filter((r) => !r.doneAt)

  const shown = reminders.filter((r) => {
    if (smart) {
      if (smart.id === 'completed') return !!r.doneAt
      if (fading[r.id]) return true
      if (r.doneAt && showDone && smart.id === 'all') return true
      return inSmart(smart.id, r, now)
    }
    return r.listId === sel && (!r.doneAt || showDone || !!fading[r.id])
  })
  const byTime = (a: Reminder, b: Reminder) => (a.remindAt ?? '9').localeCompare(b.remindAt ?? '9') || a.createdAt - b.createdAt

  /* Groups: Scheduled by day, All and Completed by list, the rest flat. */
  const groups: { key: string; label?: string; color?: string; rows: Reminder[] }[] = []
  if (smart?.id === 'scheduled') {
    const m = new Map<string, Reminder[]>()
    for (const r of [...shown].sort(byTime)) {
      const d = fromLocalStamp(r.remindAt!)
      const k = dayDiff(d, now) < 0 ? 'Earlier' : dayLabel(d, now)
      m.set(k, [...(m.get(k) ?? []), r])
    }
    m.forEach((rows, k) => groups.push({ key: k, label: k, rows }))
  } else if (smart?.id === 'all' || smart?.id === 'completed') {
    for (const l of reminderLists) {
      const rows = shown.filter((r) => r.listId === l.id).sort(smart.id === 'completed' ? (a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) : byTime)
      if (rows.length) groups.push({ key: l.id, label: l.name, color: colorOf(l.color), rows })
    }
  } else {
    groups.push({ key: 'one', rows: [...shown].sort(byTime) })
  }

  const count = smart?.id === 'completed' ? shown.length : shown.filter((r) => !r.doneAt).length
  const doneHere = smart ? (smart.id === 'all' ? reminders.filter((r) => r.doneAt).length : 0) : reminders.filter((r) => r.listId === sel && r.doneAt).length
  const title = smart ? smart.name : list?.name ?? ''
  const titleColor = smart ? smart.color : colorOf(list?.color ?? 'blue')

  const tick = (r: Reminder) => {
    const becoming = !r.doneAt
    toggleReminder(r.id)
    if (becoming && smart?.id !== 'completed' && !showDone) {
      setFading((f) => ({ ...f, [r.id]: true }))
      window.setTimeout(() => setFading((f) => { const g = { ...f }; delete g[r.id]; return g }), 900)
    }
  }

  const add = () => {
    const t = draft.trim()
    if (!t) return
    const listId = list ? list.id : (listById.has(lastUserList.current) ? lastUserList.current : reminderLists[0].id)
    addReminder({
      title: t, listId,
      remindAt: smart?.id === 'today' || smart?.id === 'scheduled' ? nextHour(now) : undefined,
      flagged: smart?.id === 'flagged',
    })
    setDraft('')
  }

  const askAlerts = () => { if (alertsSupported()) void Notification.requestPermission().then(setPerm) }

  return (
    <div className={`page rem-page${phoneList ? ' is-listview' : ''}`}>
      <aside className="rem-side" aria-label="Reminder lists">
        <div className="rem-side-head">
          <h1 className="rem-h1">Reminders</h1>
          {alertsSupported() && perm !== 'granted' && (
            <button className="rem-alerts" onClick={askAlerts} disabled={perm === 'denied'} title={perm === 'denied' ? 'Notifications are blocked for this site in the browser settings' : undefined}>
              <span className="rem-ico">{Ico.bell}</span>{perm === 'denied' ? 'Alerts blocked' : 'Turn on alerts'}
            </button>
          )}
        </div>
        <div className="rem-tiles">
          {SMART.map((m) => {
            const on = sel === m.id
            const n = m.id === 'completed' ? reminders.filter((r) => r.doneAt).length : open_.filter((r) => inSmart(m.id, r, now)).length
            return (
              <button key={m.id} className={`rem-tile${on ? ' is-on' : ''}${m.id === 'completed' ? ' is-wide' : ''}`} style={{ ['--c' as string]: m.color }} aria-pressed={on} onClick={() => setSel(m.id)}>
                <span className="rem-tile-row"><span className="rem-dot">{Ico[m.id]}</span><span className="rem-cnt">{n}</span></span>
                <span className="rem-tl">{m.name}</span>
              </button>
            )
          })}
        </div>
        <div>
          <h2 className="rem-sh">My Lists</h2>
          {reminderLists.map((l) => (
            <button key={l.id} className={`rem-lrow${sel === l.id ? ' is-on' : ''}`} aria-pressed={sel === l.id} onClick={() => setSel(l.id)}>
              <span className="rem-ldot" style={{ background: colorOf(l.color) }}>{Ico.list}</span>
              <span className="rem-lname">{l.name}</span>
              <span className="rem-lcnt">{open_.filter((r) => r.listId === l.id).length}</span>
            </button>
          ))}
          {newList ? (
            <div className="rem-newlist">
              <input autoFocus className="rem-input" placeholder="List name" aria-label="List name" value={newList.name}
                onChange={(e) => setNewList({ ...newList, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newList.name.trim()) { const id = addReminderList(newList.name, newList.color); setNewList(null); setSel(id) }
                  if (e.key === 'Escape') setNewList(null)
                }} />
              <Swatches value={newList.color} onPick={(c) => setNewList({ ...newList, color: c })} />
              <div className="rem-row-actions">
                <button className="rem-btn" onClick={() => setNewList(null)}>Cancel</button>
                <button className="rem-btn is-primary" disabled={!newList.name.trim()} onClick={() => { const id = addReminderList(newList.name, newList.color); setNewList(null); setSel(id) }}>Add list</button>
              </div>
            </div>
          ) : (
            <button className="rem-addlist" onClick={() => setNewList({ name: '', color: 'purple' })}><span className="rem-ico">{Ico.plus}</span>Add list</button>
          )}
        </div>
      </aside>

      <section className="rem-pane" aria-label={title}>
        <button className="rem-back" onClick={() => setPhoneList(false)}><span className="rem-ico">{Ico.back}</span>Lists</button>
        <div className="rem-ph">
          {list && editList ? (
            <input className="rem-pt-input" style={{ color: titleColor }} defaultValue={list.name} aria-label="List name" autoFocus
              onBlur={(e) => updateReminderList(list.id, { name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          ) : (
            <h2 className="rem-pt" style={{ color: titleColor }}>{title}</h2>
          )}
          <span className="rem-pc">{count}</span>
        </div>
        {list && (
          <div className="rem-listtools">
            <button className="rem-link" onClick={() => setEditList((v) => !v)}>{editList ? 'Done' : 'Edit list'}</button>
            {editList && (
              <>
                <Swatches value={list.color} onPick={(c) => updateReminderList(list.id, { color: c })} />
                {reminderLists.length > 1 && <button className="rem-link is-danger" onClick={() => { deleteReminderList(list.id); setSel('today') }}>Delete list</button>}
              </>
            )}
          </div>
        )}

        <div className="rem-scroll">
          {groups.map((g) => (
            <div key={g.key} className="rem-group">
              {g.label && <h3 className="rem-gh" style={g.color ? { color: g.color } : undefined}>{g.label}</h3>}
              {g.rows.map((r) => (
                <Row key={r.id} r={r} now={now} open={openId === r.id} fading={!!fading[r.id]}
                  listName={smart && smart.id !== 'all' && smart.id !== 'completed' ? listById.get(r.listId)?.name : undefined}
                  color={colorOf(listById.get(r.listId)?.color ?? 'blue')}
                  lists={reminderLists}
                  onTick={() => tick(r)} onOpen={() => setOpenId(openId === r.id ? null : r.id)}
                  onPatch={(p) => updateReminder(r.id, p)} onDelete={() => { setOpenId(null); deleteReminder(r.id) }} />
              ))}
            </div>
          ))}
          {!shown.length && <div className="rem-empty">{smart?.id === 'completed' ? 'Nothing completed yet' : 'No reminders'}</div>}
          {smart?.id !== 'completed' && (
            <label className="rem-new">
              <span className="rem-plus">{Ico.plus}</span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
                placeholder="New Reminder" aria-label="New reminder" enterKeyHint="done" />
            </label>
          )}
        </div>
        {(doneHere > 0 || showDone) && smart?.id !== 'completed' && (
          <div className="rem-foot">
            <button className="rem-link" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide completed' : `Show completed (${doneHere})`}</button>
          </div>
        )}
      </section>
    </div>
  )
}

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="rem-swatches" role="group" aria-label="List colour">
      {Object.entries(REMINDER_COLORS).map(([k, hex]) => (
        <button key={k} className={`rem-sw${value === k ? ' is-on' : ''}`} style={{ background: hex }} aria-label={k} aria-pressed={value === k} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function Row({ r, now, open, fading, listName, color, lists, onTick, onOpen, onPatch, onDelete }: {
  r: Reminder; now: Date; open: boolean; fading: boolean; listName?: string; color: string
  lists: { id: string; name: string; color: string }[]
  onTick: () => void; onOpen: () => void; onPatch: (p: Partial<Reminder>) => void; onDelete: () => void
}) {
  const done = !!r.doneAt
  const when = r.remindAt ? whenText(r.remindAt, now) : ''
  const repeatLabel = REPEATS.find((x) => x.id === r.repeat)?.label
  return (
    <div className={`rem-r${fading ? ' is-fading' : ''}${open ? ' is-open' : ''}`}>
      <button className={`rem-ck${done ? ' is-done' : ''}`} style={{ ['--c' as string]: color }} onClick={onTick} aria-label={done ? `Mark ${r.title} not done` : `Mark ${r.title} done`}>
        {done && Ico.check}
      </button>
      <div className="rem-body">
        {open ? (
          <input className="rem-title-input" defaultValue={r.title} aria-label="Title" autoFocus
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.title) onPatch({ title: v }) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        ) : (
          <button className="rem-open" onClick={onOpen} aria-expanded={open}>
            <span className={`rem-title${done ? ' is-done' : ''}`}>{r.title}</span>
            {r.notes && <span className="rem-notes">{r.notes}</span>}
            {(when || r.repeat || listName) && (
              <span className="rem-meta">
                {when && <span className="rem-m"><span className="rem-ico sm">{Ico.clock}</span>{when}</span>}
                {r.repeat && <span className="rem-m"><span className="rem-ico sm">{Ico.repeat}</span>{repeatLabel}</span>}
                {listName && <span className="rem-m" style={{ color }}>{listName}</span>}
              </span>
            )}
          </button>
        )}
        {open && (
          <div className="rem-detail">
            <textarea className="rem-notes-input" defaultValue={r.notes} placeholder="Notes" aria-label="Notes" rows={2}
              onBlur={(e) => { if (e.target.value !== r.notes) onPatch({ notes: e.target.value.trim() }) }} />
            <div className="rem-dl">Remind me</div>
            <div className="rem-chips">
              {quickTimes(now).map((q) => (
                <button key={q.label} className={`rem-chip${r.remindAt === q.stamp ? ' is-on' : ''}`} aria-pressed={r.remindAt === q.stamp} onClick={() => onPatch({ remindAt: q.stamp })}>{q.label}</button>
              ))}
              <input className="rem-dt" type="datetime-local" aria-label="Pick a date and time" value={r.remindAt ?? ''}
                onChange={(e) => onPatch({ remindAt: e.target.value || undefined })} />
              {r.remindAt && <button className="rem-chip" onClick={() => onPatch({ remindAt: undefined, repeat: undefined })}>No time</button>}
            </div>
            {r.remindAt && (
              <>
                <div className="rem-dl">Repeat</div>
                <div className="rem-chips">
                  {REPEATS.map((x) => {
                    const on = (r.repeat ?? 'none') === x.id
                    return <button key={x.label} className={`rem-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onPatch({ repeat: x.id === 'none' ? undefined : x.id })}>{x.label}</button>
                  })}
                </div>
              </>
            )}
            {lists.length > 1 && (
              <>
                <div className="rem-dl">List</div>
                <div className="rem-chips">
                  {lists.map((l) => (
                    <button key={l.id} className={`rem-chip${r.listId === l.id ? ' is-on' : ''}`} aria-pressed={r.listId === l.id} onClick={() => onPatch({ listId: l.id })}>
                      <i className="rem-chip-dot" style={{ background: colorOf(l.color) }} />{l.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="rem-row-actions">
              <button className="rem-link is-danger" onClick={onDelete}>Delete</button>
              <button className="rem-btn is-primary" onClick={onOpen}>Done</button>
            </div>
          </div>
        )}
      </div>
      <button className={`rem-flag${r.flagged ? ' is-on' : ''}`} onClick={() => onPatch({ flagged: !r.flagged })} aria-label={r.flagged ? 'Remove flag' : 'Flag'} aria-pressed={r.flagged}>
        {Ico.flagged}
      </button>
    </div>
  )
}
