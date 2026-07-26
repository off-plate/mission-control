import { useRef, useState } from 'react'
import { Band } from './pages1'
import { useStore } from './store'
import { parseDictation, TAB_FOR, type ParsedItem } from './assistant'

/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_LABEL: Record<ParsedItem['kind'], string> = { task: 'task', goal: 'goal', done: 'done' }

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
      <Band title="Assistant" sub="say what’s on your mind, it files it in the right place" />

      <div className="panel" style={{ maxWidth: 820, marginBottom: 'var(--s5)' }}>
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
                {p.estimateMin != null && <span className="est-chip">~{p.estimateMin}m</span>}
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

      <div className="panel" style={{ maxWidth: 820 }}>
        <span className="microcap">History · what went where</span>
        {assistantLog.length === 0 && <p className="bucket-empty">Nothing filed yet. Everything you dictate shows here, and you can undo any of it.</p>}
        {assistantLog.map((entry) => (
          <div className="assist-log" key={entry.id}>
            <div className="assist-log-head">
              <span className="grow">“{entry.text}”</span>
              <span className="mono meta">{entry.when}</span>
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
  { id: 'violet', bg: '#ded6e6' },
  { id: 'paper', bg: '#fbf8f1' },
]
const colorBg = (id: string) => NOTE_COLORS.find((c) => c.id === id)?.bg ?? '#fbf8f1'
const TAG_RE = /#[\p{L}\d_-]+/gu
const tagsOf = (t: string) => t.match(TAG_RE) ?? []

function renderNote(t: string) {
  return t.split(/(#[\p{L}\d_-]+)/gu).map((p, i) => (/^#/.test(p) ? <span className="note-tag" key={i}>{p}</span> : <span key={i}>{p}</span>))
}

export function BrainDumpPage() {
  const { ideas, addIdea, setIdeaColor } = useStore()
  const [text, setText] = useState('')
  const [color, setColor] = useState('amber')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const allTags = Array.from(new Set(ideas.flatMap((i) => tagsOf(i.text).map((t) => t.toLowerCase()))))
  const shown = activeTag ? ideas.filter((i) => tagsOf(i.text).some((t) => t.toLowerCase() === activeTag)) : ideas
  const submit = () => { if (!text.trim()) return; addIdea(text, color); setText('') }

  return (
    <div className="page">
      <Band title="Brain dump" sub="sticky notes for whatever is in your head" />

      <div className="panel note-composer" style={{ maxWidth: 720, marginBottom: 'var(--s5)' }}>
        <textarea
          className="textinput" rows={2} style={{ width: '100%' }}
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

      {allTags.length > 0 && (
        <div className="note-filter">
          <button className={`note-chip${!activeTag ? ' on' : ''}`} onClick={() => setActiveTag(null)}>all</button>
          {allTags.map((t) => (
            <button key={t} className={`note-chip${activeTag === t ? ' on' : ''}`} onClick={() => setActiveTag(activeTag === t ? null : t)}>{t}</button>
          ))}
        </div>
      )}

      <div className="sticky-board">
        {shown.map((i) => (
          <div className="sticky" key={i.id} style={{ background: colorBg(i.color) }}>
            <p className="note-text">{renderNote(i.text)}</p>
            <div className="note-foot">
              <span className="mono note-when">{i.when}</span>
              <div className="note-colors">
                {NOTE_COLORS.map((c) => (
                  <button key={c.id} className={`note-dot${i.color === c.id ? ' on' : ''}`} style={{ background: c.bg }} aria-label={`Set ${c.id}`} onClick={() => setIdeaColor(i.id, c.id)} />
                ))}
              </div>
            </div>
          </div>
        ))}
        {shown.length === 0 && <p className="bucket-empty">No notes tagged {activeTag}. Clear the filter or add one.</p>}
      </div>
    </div>
  )
}
