/* The assistant, as a rail on Today rather than a page of its own.

   It used to be a tab with a photo reader, an OCR fallback and a history log
   the width of the screen. He asked for the opposite: one column that is
   always there while he is looking at his day, where he can say a thing and
   have it filed. No camera, no image reading, nothing to open first. */

import { useRef, useState } from 'react'
import { AutoTextarea } from './pages1'
import { useStore } from './store'
import { Linkify } from './widgets'
import { parseDictation, TAB_FOR, type ParsedItem } from './assistant'
import { parseSpoken } from './ai'
import { fmtDuration } from './util'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function AssistantRail() {
  const { applyDictation, assistantLog, revertAssistantItem, setPage } = useStore()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedItem[] | null>(null)
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fellBack, setFellBack] = useState('')
  const recRef = useRef<any>(null)
  const voiceSupported = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  /* The model reads what you actually said. The regex splitter is the fallback
     for no key or an unreachable Groq, and says so rather than passing itself
     off as the same thing. */
  const understand = async () => {
    setBusy(true); setFellBack('')
    const r = await parseSpoken(text)
    if (r.ok) { setParsed(r.items); setBusy(false); return }
    setFellBack(
      r.reason === 'no-key' ? 'No Groq key, so this was split by keyword. Add a key in Settings for a real read.'
      : r.reason === 'rate-limit' ? 'Groq is rate limiting, so this was split by keyword.'
      : r.reason === 'bad-key' ? 'That Groq key was rejected, so this was split by keyword.'
      : 'Groq could not be reached, so this was split by keyword.')
    setParsed(parseDictation(text))
    setBusy(false)
  }

  const apply = () => {
    if (!parsed || !parsed.length) return
    applyDictation(text.trim(), parsed)
    setText(''); setParsed(null); setFellBack('')
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

  /* The last few things filed, newest first. The full log was a page; here it
     is a tail, long enough to undo something you just said wrong. */
  const recent = assistantLog.slice(0, 4)

  return (
    <aside className="assist-rail" aria-label="Assistant">
      <div className="panel assist-rail-say">
        <span className="microcap">Assistant</span>
        <div className="assist-input">
          <AutoTextarea
            className="textinput assist-textarea"
            minRows={3}
            placeholder="Call the bank about the plan, 20 min…"
            value={text}
            onChange={(e) => { setText(e.target.value); setParsed(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void understand() }}
            aria-label="What's on your mind"
          />
          <div className="assist-tools">
            {voiceSupported && (
              <button className={`assist-mic${listening ? ' on' : ''}`} onClick={voice} aria-label={listening ? 'Stop listening' : 'Dictate'} title="Dictate (Czech)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 19v3" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {listening && <span className="assist-listening">listening</span>}
            <button className="btn btn-primary assist-go" onClick={() => void understand()} disabled={!text.trim() || busy}>
              {busy ? 'Reading' : 'Understand'}
            </button>
          </div>
        </div>

        {parsed && (
          <div className="assist-proposed">
            <span className="microcap" style={{ display: 'block', marginBottom: 'var(--s2)' }}>It will file these</span>
            {fellBack && <p className="sheet-warn" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>{fellBack}</p>}
            {parsed.length === 0 && <p className="empty is-boxed">Nothing to file. Try naming a task, a goal, or something you finished.</p>}
            {parsed.map((p, i) => (
              <div className="assist-row" key={i}>
                <select className="assist-kind" value={p.kind} onChange={(e) => setKind(i, e.target.value as ParsedItem['kind'])} aria-label="Item type">
                  <option value="task">task</option>
                  <option value="goal">goal</option>
                  <option value="done">done</option>
                </select>
                <span className="grow"><Linkify text={p.text} /></span>
                {p.estimateMin != null && <span className="chip tone-info">{fmtDuration(p.estimateMin)}</span>}
                <span className="assist-dest mono">→ {TAB_FOR[p.kind]}</span>
              </div>
            ))}
            {parsed.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                <button className="btn btn-ghost" onClick={() => { setParsed(null); setFellBack('') }}>Discard</button>
                <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={apply}>File {parsed.length} {parsed.length === 1 ? 'item' : 'items'}</button>
              </div>
            )}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="panel assist-rail-log">
          <span className="microcap">Just filed</span>
          {recent.map((entry) => (
            <div className="assist-log" key={entry.id}>
              {entry.items.map((it) => (
                <div className="assist-log-item" key={it.id}>
                  <span className={`chip ${it.kind === 'done' ? 'tone-progress' : it.kind === 'goal' ? 'tone-info' : 'tone-accent'}`}>{it.kind}</span>
                  <span className="grow">{it.label}</span>
                  <button className="assist-goto" onClick={() => setPage(it.tab)} aria-label={`Open ${it.tab}`}>{it.tab} ↗</button>
                  <button className="assist-undo" onClick={() => revertAssistantItem(entry.id, it.id)} aria-label={`Undo ${it.label}`}>undo</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
