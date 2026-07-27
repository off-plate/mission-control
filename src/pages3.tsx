import { useRef, useState } from 'react'
import { Band, Dropdown } from './pages1'
import { useStore } from './store'
import { parseDictation, TAB_FOR, type ParsedItem } from './assistant'
import { fmtWhen } from './util'
import { extractFromJournal, hasAiKey, shrinkImage, transcribeImage, type JournalItems } from './ai'
import { readImage } from './ocr'
import type { HabitFrequency } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_LABEL: Record<ParsedItem['kind'], string> = { task: 'task', goal: 'goal', done: 'done' }

/* Photograph a journal page, read it, and turn what you committed to into real
   items. Nothing is saved until you have read the transcript and chosen: the
   model can produce fluent, confident Czech you never wrote, and its confidence
   score says nothing about whether it is right. The photo and the transcript
   stay in this page and are never written to the database. */
function JournalReader() {
  const { space, addTask, addGoal, addHabit } = useStore()
  const [photo, setPhoto] = useState<string | null>(null)
  const [stage, setStage] = useState<'idle' | 'reading' | 'thinking' | 'review'>('idle')
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [items, setItems] = useState<JournalItems | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pct, setPct] = useState(0)
  const [conf, setConf] = useState<number | null>(null)
  const [readBy, setReadBy] = useState<'device' | 'ai'>('device')
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPhoto(null); setStage('idle'); setError(''); setText(''); setItems(null)
    setPicked(new Set()); setPct(0); setConf(null); setReadBy('device')
  }

  /* Read it here on the machine first: no key, no account, and the photo never
     leaves the device. The AI reader is a second opinion for messy writing. */
  const onFile = async (file?: File) => {
    if (!file) return
    setError(''); setItems(null); setText(''); setConf(null); setPct(0); setStage('reading')
    try {
      const url = await shrinkImage(file)
      setPhoto(url)
      const r = await readImage(url, 'ces+eng', setPct)
      setReadBy('device')
      setConf(r.confidence)
      setText(r.text)
      if (!r.text) setError('Nothing legible came out of that. Try a straighter, better lit shot, or use the AI reader below.')
      setStage('review')
    } catch (e) {
      setStage('idle')
      setError(`Could not read that image. ${e instanceof Error ? e.message : ''}`.trim())
    }
  }

  /* Same photo, better reader, for when the on-device pass mangles cursive. */
  const readWithAi = async () => {
    if (!photo) return
    setError(''); setStage('reading')
    const r = await transcribeImage(photo)
    if (!r.ok) {
      setStage('review')
      setError(
        r.reason === 'no-key' ? 'No Groq key yet. Add one in Settings to use the AI reader.'
        : r.reason === 'bad-key' ? 'That Groq key was rejected. Check it in Settings.'
        : r.reason === 'rate-limit' ? 'Groq is rate limiting. Wait a moment and try again.'
        : r.reason === 'too-big' ? 'That photo is too large even after shrinking.'
        : 'The AI reader could not be reached. The text above is still yours to edit.')
      return
    }
    setReadBy('ai'); setConf(null); setText(r.text); setStage('review')
  }

  const findItems = async () => {
    setStage('thinking'); setError('')
    const r = await extractFromJournal(text)
    if (!r.ok) { setStage('review'); setError('Could not pull items out of that. You can still edit the text and try again.'); return }
    setItems(r.items)
    const all = new Set<string>()
    r.items.tasks.forEach((_, i) => all.add(`t${i}`))
    r.items.goals.forEach((_, i) => all.add(`g${i}`))
    r.items.habits.forEach((_, i) => all.add(`h${i}`))
    setPicked(all)
    setStage('review')
  }

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  const save = () => {
    if (!items) return
    items.tasks.forEach((t, i) => { if (picked.has(`t${i}`)) addTask({ title: t.title, source: 'mc', estimateMin: t.estimateMin ?? 0, space, list: 'backlog', category: 'quick' }) })
    items.goals.forEach((g, i) => { if (picked.has(`g${i}`)) addGoal({ space, name: g.title, current: 0, target: 3, unit: 'steps', note: '', why: g.why, timeframe: 'weekly', category: 'life', milestones: [] }) })
    items.habits.forEach((h, i) => { if (picked.has(`h${i}`)) addHabit({ name: h.title, frequency: (h.frequency as HabitFrequency) ?? 'daily', kind: 'build' }) })
    reset()
  }

  const total = items ? items.tasks.length + items.goals.length + items.habits.length : 0
  const busy = stage === 'reading' || stage === 'thinking'

  return (
    <div className="panel journal">
      <span className="microcap">Read a page of your journal</span>
      <p className="assist-note" style={{ marginTop: 6 }}>
        Photograph a written page and it transcribes what is there, on this device, with no key and
        nothing uploaded. You read the transcript, fix what it got wrong, and choose what becomes real.
        Nothing here is saved anywhere until you do.
      </p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => onFile(e.target.files?.[0])} />

      {stage === 'idle' && !photo && (
        <div className="journal-drop">
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Take or choose a photo</button>
          <span className="assist-note">Works offline. Clear writing reads well; joined-up cursive needs the AI reader.</span>
        </div>
      )}

      {error && <p className="sheet-warn">{error}</p>}

      {photo && (
        <div className="journal-work">
          <div className="journal-shot">
            <img src={photo} alt="The page you photographed" />
            <button className="btn btn-quiet" onClick={reset}>Different photo</button>
          </div>

          <div className="journal-text">
            {busy && (
              <div className="empty">
                {stage === 'reading'
                  ? `Reading the page on this device${pct > 0 && pct < 100 ? `, ${pct}%` : ''}.`
                  : 'Looking for what you committed to.'}
              </div>
            )}
            {!busy && (
              <>
                <label className="field-label" htmlFor="jtext">
                  {readBy === 'ai' ? 'What the AI reader got.' : 'What this device read.'} Fix anything wrong before you go on.
                </label>
                <textarea id="jtext" className="textinput journal-area" value={text} onChange={(e) => setText(e.target.value)} rows={10} />
                {text.includes('[?]') && (
                  <p className="sheet-warn">[?] marks a word it could not read. Replace those before continuing.</p>
                )}
                {readBy === 'device' && conf !== null && conf < 70 && (
                  <p className="sheet-warn">
                    Low confidence ({conf}%). On-device reading struggles with joined-up handwriting. The AI reader handles cursive far better.
                  </p>
                )}
                <div className="journal-readers">
                  <span className="assist-note">
                    {readBy === 'device'
                      ? `Read here on your device${conf !== null ? `, ${conf}% confident` : ''}. The photo never left it.`
                      : 'Read by Groq. The photo was sent to it for this one call.'}
                  </span>
                  {readBy === 'device' && (
                    <button className="btn btn-quiet" onClick={readWithAi} disabled={!hasAiKey()} title={hasAiKey() ? 'Send this photo to Groq for a better read' : 'Needs a Groq key in Settings'}>
                      Try the AI reader
                    </button>
                  )}
                  {readBy === 'ai' && (
                    <button className="btn btn-quiet" onClick={() => photo && onFile(undefined)} disabled>Read by AI</button>
                  )}
                </div>
                <div className="coach-nav" style={{ marginTop: 'var(--s3)' }}>
                  <button className="btn btn-primary" disabled={!text.trim()} onClick={findItems}>
                    {items ? 'Look again' : 'Find tasks, goals and habits'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {items && !busy && (
        <div className="journal-items">
          {total === 0 && <p className="bucket-empty">Nothing in that page reads as something to do. That is a fine answer.</p>}
          {items.tasks.map((t, i) => (
            <label className={`journal-item${picked.has(`t${i}`) ? ' on' : ''}`} key={`t${i}`}>
              <input type="checkbox" checked={picked.has(`t${i}`)} onChange={() => toggle(`t${i}`)} />
              <span className="assist-tag k-task">task</span>
              <span className="grow">{t.title}</span>
              {t.estimateMin ? <span className="est-chip">{t.estimateMin}m</span> : null}
            </label>
          ))}
          {items.goals.map((g, i) => (
            <label className={`journal-item${picked.has(`g${i}`) ? ' on' : ''}`} key={`g${i}`}>
              <input type="checkbox" checked={picked.has(`g${i}`)} onChange={() => toggle(`g${i}`)} />
              <span className="assist-tag k-goal">goal</span>
              <span className="grow">{g.title}</span>
            </label>
          ))}
          {items.habits.map((h, i) => (
            <label className={`journal-item${picked.has(`h${i}`) ? ' on' : ''}`} key={`h${i}`}>
              <input type="checkbox" checked={picked.has(`h${i}`)} onChange={() => toggle(`h${i}`)} />
              <span className="assist-tag k-done">habit</span>
              <span className="grow">{h.title}</span>
              <span className="mono meta">{h.frequency}</span>
            </label>
          ))}
          {total > 0 && (
            <div className="coach-nav" style={{ marginTop: 'var(--s3)' }}>
              <button className="btn btn-quiet" onClick={reset}>Discard</button>
              <button className="btn btn-primary" disabled={picked.size === 0} onClick={save}>
                Add {picked.size} {picked.size === 1 ? 'item' : 'items'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AssistantPage() {
  const { applyDictation, assistantLog, revertAssistantItem, setPage } = useStore()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedItem[] | null>(null)
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const voiceSupported = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const understand = () => {
    const p = parseDictation(text)
    setParsed(p.length ? p : [])
  }

  const apply = () => {
    if (!parsed || !parsed.length) return
    applyDictation(text.trim(), parsed)
    setText(''); setParsed(null)
  }

  const setKind = (i: number, kind: ParsedItem['kind']) =>
    setParsed((p) => (p ? p.map((x, j) => (j === i ? { ...x, kind } : x)) : p))

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    if (listening) { recRef.current?.stop(); return }
    const r = new SR()
    r.lang = 'cs-CZ'; r.interimResults = true; r.continuous = true
    r.onresult = (e: any) => {
      let s = ''
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
      setText(s)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    r.start(); recRef.current = r; setListening(true)
  }

  return (
    <div className="page">
      <Band title="Assistant" />

      <JournalReader />


      <div className="panel" style={{ marginBottom: 'var(--s5)' }}>
        <span className="microcap">Dictate or type</span>
        <div className="assist-input">
          <textarea
            className="textinput assist-textarea"
            rows={3}
            placeholder="e.g. Call the bank about the plan, goal this week send 10 cold emails, done the accountant email"
            value={text}
            onChange={(e) => { setText(e.target.value); setParsed(null) }}
            aria-label="What's on your mind"
          />
          {voiceSupported && (
            <button className={`assist-mic${listening ? ' on' : ''}`} onClick={voice} aria-label={listening ? 'Stop listening' : 'Dictate'} title="Dictate (Czech)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 19v3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={understand} disabled={!text.trim()}>Understand</button>
          {listening && <span className="microcap" style={{ color: 'var(--alert)' }}>listening…</span>}
          <span className="assist-note">Demo parser. The real build sends this to a model (Groq, free) and files it the same way.</span>
        </div>

        {parsed && (
          <div className="assist-proposed">
            <span className="microcap" style={{ display: 'block', marginBottom: 'var(--s2)' }}>It will file these</span>
            {parsed.length === 0 && <p className="bucket-empty">Nothing to file. Try naming a task, a goal, or something you finished.</p>}
            {parsed.map((p, i) => (
              <div className="assist-row" key={i}>
                <select className="assist-kind" value={p.kind} onChange={(e) => setKind(i, e.target.value as ParsedItem['kind'])} aria-label="Item type">
                  <option value="task">task</option>
                  <option value="goal">goal</option>
                  <option value="done">done</option>
                </select>
                <span className="grow">{p.text}</span>
                {p.estimateMin != null && <span className="est-chip">{p.estimateMin}m</span>}
                <span className="assist-dest mono">→ {TAB_FOR[p.kind]}</span>
              </div>
            ))}
            {parsed.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                <button className="btn btn-ghost" onClick={() => setParsed(null)}>Discard</button>
                <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={apply}>File {parsed.length} {parsed.length === 1 ? 'item' : 'items'}</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <span className="microcap">History · what went where</span>
        {assistantLog.length === 0 && <p className="bucket-empty">Nothing filed yet. Everything you dictate shows here, and you can undo any of it.</p>}
        {assistantLog.map((entry) => (
          <div className="assist-log" key={entry.id}>
            <div className="assist-log-head">
              <span className="grow">“{entry.text}”</span>
              <span className="mono meta">{fmtWhen(entry.when)}</span>
            </div>
            {entry.items.map((it) => (
              <div className="assist-log-item" key={it.id}>
                <span className={`assist-tag k-${it.kind}`}>{KIND_LABEL[it.kind]}</span>
                <span className="grow">{it.label}</span>
                <button className="assist-goto" onClick={() => setPage(it.tab)} aria-label={`Open ${it.tab}`}>{it.tab} ↗</button>
                <button className="btn btn-danger" style={{ minHeight: 28, fontSize: 'var(--text-xs)', padding: '0 8px' }} onClick={() => revertAssistantItem(entry.id, it.id)} aria-label={`Undo ${it.label}`}>undo</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- BRAIN DUMP (sticky-note board) ---------------- */

const NOTE_COLORS: { id: string; bg: string }[] = [
  { id: 'amber', bg: '#f6ead0' },
  { id: 'coral', bg: '#f3d8cd' },
  { id: 'green', bg: '#dbe4d1' },
  { id: 'blue', bg: '#d3dde6' },
  { id: 'clay', bg: '#e4d8cb' },
  { id: 'paper', bg: '#fbf8f1' },
]
const colorBg = (id: string) => NOTE_COLORS.find((c) => c.id === id)?.bg ?? '#fbf8f1'
const TAG_RE = /#[\p{L}\d_-]+/gu
const tagsOf = (t: string) => t.match(TAG_RE) ?? []

function renderNote(t: string) {
  return t.split(/(#[\p{L}\d_-]+)/gu).map((p, i) => (/^#/.test(p) ? <span className="note-tag" key={i}>{p}</span> : <span key={i}>{p}</span>))
}

export function BrainDumpPage() {
  const { ideas, space, addIdea, setIdeaColor, deleteIdea, addTask, setPage } = useStore()
  const [text, setText] = useState('')
  const [color, setColor] = useState('amber')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const spaceIdeas = ideas.filter((i) => i.space === space)
  const allTags = Array.from(new Set(spaceIdeas.flatMap((i) => tagsOf(i.text).map((t) => t.toLowerCase()))))
  const tag = activeTag && allTags.includes(activeTag) ? activeTag : null
  const shown = tag ? spaceIdeas.filter((i) => tagsOf(i.text).some((t) => t.toLowerCase() === tag)) : spaceIdeas
  const submit = () => { if (!text.trim()) return; addIdea(text, color); setText('') }

  return (
    <div className="page">
      <Band title="Brain dump" />

      {allTags.length > 0 && (
        <div className="note-filter">
          <button className={`note-chip${!tag ? ' on' : ''}`} onClick={() => setActiveTag(null)}>all</button>
          {allTags.map((t) => (
            <button key={t} className={`note-chip${tag === t ? ' on' : ''}`} onClick={() => setActiveTag(tag === t ? null : t)}>{t}</button>
          ))}
        </div>
      )}

      <div className="bd-grid">
        <div className="bd-composer">
          <textarea
            className="textinput" rows={4} style={{ width: '100%' }}
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
            placeholder="Whatever is on your mind. Add a #category to group it."
            aria-label="New note"
          />
          <div className="note-composer-row">
            <div className="note-swatches" role="radiogroup" aria-label="Note colour">
              {NOTE_COLORS.map((c) => (
                <button key={c.id} className={`note-swatch${color === c.id ? ' on' : ''}`} style={{ background: c.bg }} aria-label={c.id} aria-pressed={color === c.id} onClick={() => setColor(c.id)} />
              ))}
            </div>
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!text.trim()} onClick={submit}>Add note</button>
          </div>
        </div>

        {shown.map((i) => (
          <div className="sticky" key={i.id} style={{ background: colorBg(i.color) }}>
            <p className="note-text">{renderNote(i.text)}</p>
            <div className="note-foot">
              <span className="mono note-when">{fmtWhen(i.when)}</span>
              <div className="note-colors">
                {NOTE_COLORS.map((c) => (
                  <button key={c.id} className={`note-dot${i.color === c.id ? ' on' : ''}`} style={{ background: c.bg }} aria-label={`Set ${c.id}`} onClick={() => setIdeaColor(i.id, c.id)} />
                ))}
              </div>
              {/* An idea worth doing becomes a task; one that is spent comes off the board. */}
              <Dropdown label="Note options" className="note-kebab">
                <button role="menuitem" onClick={() => {
                  addTask({ title: i.text.replace(TAG_RE, '').trim().slice(0, 120), source: 'mc', estimateMin: 0, space, list: 'backlog', category: 'deep' })
                  setPage('plan')
                }}>Make it a task</button>
                <button role="menuitem" className="danger" onClick={() => deleteIdea(i.id)}>Delete</button>
              </Dropdown>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
