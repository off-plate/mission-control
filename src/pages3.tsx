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

/* ---------------- BRAIN DUMP ---------------- */

export function BrainDumpPage() {
  const { ideas, addIdea, deleteIdea } = useStore()
  const [text, setText] = useState('')
  const submit = () => { if (!text.trim()) return; addIdea(text); setText('') }
  return (
    <div className="page">
      <Band title="Brain dump" sub="get it out of your head, sort it later" />

      <div className="panel" style={{ maxWidth: 820, marginBottom: 'var(--s5)' }}>
        <span className="microcap">New idea</span>
        <textarea
          className="textinput" rows={2} style={{ width: '100%', marginTop: 'var(--s2)' }}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          placeholder="Whatever is in your head. One line or a paragraph."
          aria-label="New idea"
        />
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)', alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={submit}>Add</button>
          <span className="assist-note">Capture now, no fields, no sorting. Cmd/Ctrl+Enter adds it.</span>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 820 }}>
        <span className="microcap">{ideas.length} {ideas.length === 1 ? 'idea' : 'ideas'}</span>
        {ideas.length === 0 && <p className="bucket-empty">Nothing here yet. Dump the first thing on your mind.</p>}
        <div className="idea-list">
          {ideas.map((i) => (
            <div className="idea" key={i.id}>
              <p className="idea-text">{i.text}</p>
              <div className="idea-foot">
                <span className="mono meta">{i.when}</span>
                <button className="assist-goto" onClick={() => deleteIdea(i.id)} aria-label="Delete idea">remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
