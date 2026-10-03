/* PROMPTS. What he wants to say to Claude, written while the usage window was
   closed, kept until it reopens, sorted by the project and session it belongs
   to. An inbox: projects and sessions down the left, the prompts in the middle,
   one open for editing on the right.

   Two honest limits. The app cannot see his Claude limit, so he starts the
   five-hour timer himself ("I hit the limit"). And it cannot type into Claude
   Code, so a prompt leaves by Copy. The reminder is a Notification when he has
   allowed them, and always the dot on the header button, but both only exist
   while the app is open. The timer lives on this device and is not synced. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { activeModel, getAiKey, request, stripReasoning } from './ai'
import { PROMPT_KINDS, type PromptItem, type PromptKind } from './types'
import { Band, Empty } from './ui'
import { usePromptWindow, WINDOW_MS } from './promptwindow'
import * as Icon from './icons'

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const age = (t: number) => {
  const h = Math.floor((Date.now() - t) / 3600e3)
  return h < 1 ? 'under 1h' : h < 24 ? `${h}h old` : `${Math.floor(h / 24)}d old`
}

/** The template used when there is no AI key, and the shape the model is asked for. */
function templatePolish(p: PromptItem): string {
  let s = p.text.trim().replace(/\s+/g, ' ')
  if (!/[.?!]$/.test(s)) s += '.'
  return `Context: ${p.project}. Read its CLAUDE.md first.\nTask: ${s}\nDone when: it works, the typecheck and build pass, and you list the files you touched.`
}

async function polishPrompt(p: PromptItem): Promise<{ text: string; ai: boolean }> {
  const key = getAiKey()
  if (!key) return { text: templatePolish(p), ai: false }
  try {
    const res = await request({
      model: activeModel(),
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'Rewrite the user\'s rough note as one clear prompt for Claude Code. Keep every fact and keep the language it is written in. Add no requirements the user did not state. Use three short parts: Context (one line), Task, Done when (what the user would check). Reply with the prompt only.' },
        { role: 'user', content: `Project: ${p.project}\nSession: ${p.session}\nKind: ${p.kind}\n\n${p.text}` },
      ],
    }, key)
    if (!res.ok) return { text: templatePolish(p), ai: false }
    const data = await res.json()
    const out = stripReasoning(data.choices?.[0]?.message?.content ?? '').trim()
    return out ? { text: out, ai: true } : { text: templatePolish(p), ai: false }
  } catch {
    return { text: templatePolish(p), ai: false }
  }
}

type Sel = { project: string | null; session: string | null; sent: boolean }

export function PromptsPage() {
  const { prompts, addPrompt, updatePrompt, setPromptSent, deletePrompt } = useStore()
  const open = useMemo(() => prompts.filter((p) => !p.sentAt), [prompts])
  const win = usePromptWindow(open.length)
  const [sel, setSel] = useState<Sel>({ project: null, session: null, sent: false })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [quick, setQuick] = useState('')
  const [quickProject, setQuickProject] = useState('')
  const [note, setNote] = useState('')
  const noteTimer = useRef<number | undefined>(undefined)
  const say = (m: string) => { setNote(m); window.clearTimeout(noteTimer.current); noteTimer.current = window.setTimeout(() => setNote(''), 2200) }

  const projects = useMemo(() => [...new Set(prompts.map((p) => p.project))].sort(), [prompts])
  const sessions = useMemo(() => [...new Set(prompts.map((p) => p.session))].sort(), [prompts])

  const rows = useMemo(() => {
    const src = sel.sent ? prompts.filter((p) => p.sentAt) : open.filter((p) => (!sel.project || p.project === sel.project) && (!sel.session || p.session === sel.session))
    return [...src].sort((a, b) => (sel.sent ? (b.sentAt ?? 0) - (a.sentAt ?? 0) : a.createdAt - b.createdAt))
  }, [prompts, open, sel])
  const active = rows.find((p) => p.id === activeId) ?? rows[0] ?? null

  const tree = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const p of open) {
      const s = m.get(p.project) ?? new Map<string, number>()
      s.set(p.session, (s.get(p.session) ?? 0) + 1)
      m.set(p.project, s)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project, s]) => ({ project, sessions: [...s.entries()].sort(([a], [b]) => a.localeCompare(b)), n: [...s.values()].reduce((x, y) => x + y, 0) }))
  }, [open])

  const sentCount = prompts.length - open.length
  const nodeName = sel.sent ? 'Sent' : sel.session ?? sel.project ?? 'the backlog'

  const addQuick = () => {
    const text = quick.trim()
    if (!text) return
    const project = sel.project ?? (quickProject.trim() || projects[0] || 'General')
    const id = addPrompt({ project, session: sel.session ?? 'General', kind: 'Idea', text })
    setQuick(''); setActiveId(id)
    if (sel.sent) setSel({ project: null, session: null, sent: false })
  }

  const copyAndSend = async (p: PromptItem) => {
    try { await navigator.clipboard.writeText(p.text); say('Copied. Marked sent.') } catch { say('Could not copy. Select the text and copy it.'); return }
    setPromptSent(p.id, true)
  }

  const hoursOn = win.state === 'hit' ? Math.min(5, Math.floor((WINDOW_MS - (win.leftMs ?? 0)) / 3600e3) + 1) : win.state === 'open' ? 5 : 0

  return (
    <div className="page">
      <Band title="Prompts" metrics={[{ v: String(open.length), k: 'waiting', tone: 'info' as const }]} />
      <div className="pb">
        <aside className="pb-rail">
          <div className={`pb-limit is-${win.state}`}>
            <b className="mono pb-clock">{win.state === 'hit' ? clock(win.leftMs ?? 0) : win.state === 'open' ? 'Open again' : 'Window open'}</b>
            <div className="pb-hours" aria-hidden="true">{[0, 1, 2, 3, 4].map((n) => <i key={n} className={n < hoursOn ? 'on' : ''} />)}</div>
            <div className="pb-limit-line">
              {win.state === 'hit' && win.hitAt ? `Resets about ${hhmm(win.hitAt + WINDOW_MS)}` : win.state === 'open' ? `${open.length} waiting, oldest first` : 'Tap when Claude says you are out'}
            </div>
            {win.state === 'ready' && <button className="btn btn-primary" onClick={win.hit}>I hit the limit</button>}
            {win.state === 'hit' && <button className="btn btn-ghost" onClick={win.clear}>Cancel</button>}
            {win.state === 'open' && <button className="btn btn-primary" onClick={win.clear}>Done</button>}
          </div>
          <nav className="pb-tree" aria-label="Projects and sessions">
            <button aria-current={!sel.project && !sel.sent ? 'true' : undefined} onClick={() => setSel({ project: null, session: null, sent: false })}>All prompts<span className="n mono">{open.length}</span></button>
            {tree.map((t) => (
              <div key={t.project}>
                <button className="p" aria-current={sel.project === t.project && !sel.session && !sel.sent ? 'true' : undefined} onClick={() => setSel({ project: t.project, session: null, sent: false })}>{t.project}<span className="n mono">{t.n}</span></button>
                {t.sessions.map(([s, n]) => (
                  <button key={s} className="s" aria-current={sel.project === t.project && sel.session === s && !sel.sent ? 'true' : undefined} onClick={() => setSel({ project: t.project, session: s, sent: false })}>{s}<span className="n mono">{n}</span></button>
                ))}
              </div>
            ))}
            <button className="p" aria-current={sel.sent ? 'true' : undefined} onClick={() => setSel({ project: null, session: null, sent: true })}>Sent<span className="n mono">{sentCount}</span></button>
          </nav>
        </aside>

        <section className="pb-list">
          <form className="pb-quick" onSubmit={(e) => { e.preventDefault(); addQuick() }}>
            <input className="textinput" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Add to ${nodeName}, press Enter`} aria-label="Quick add a prompt" />
            {!sel.project && <input className="textinput pb-quick-proj" list="pb-projects" value={quickProject} onChange={(e) => setQuickProject(e.target.value)} placeholder={projects[0] ?? 'Project'} aria-label="Project for the new prompt" />}
            <button className="btn btn-quiet" type="submit" aria-label="Add prompt" disabled={!quick.trim()}><Icon.Plus size={16} /></button>
          </form>
          <datalist id="pb-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="pb-sessions">{sessions.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="pb-rows">
            {rows.length === 0 && (prompts.length === 0
              ? <Empty>Nothing waiting. Write the next prompt while you think of it, and it waits here for the window.</Empty>
              : <Empty>{sel.sent ? 'Nothing sent yet.' : 'Nothing in here. Type above and press Enter.'}</Empty>)}
            {rows.map((p) => (
              <button key={p.id} className={`pb-row${p.sentAt ? ' is-sent' : ''}`} aria-current={active?.id === p.id ? 'true' : undefined} onClick={() => setActiveId(p.id)}>
                <span className="pb-row-t">{p.text}</span>
                <span className="pb-row-m"><span className={`pb-kind k-${p.kind}`}>{p.kind}</span>{!sel.session && <span>{p.session}</span>}<span>{age(p.createdAt)}</span></span>
              </button>
            ))}
          </div>
        </section>

        <section className="pb-detail">
          {active
            ? <PromptEditor key={active.id} p={active} update={(patch) => updatePrompt(active.id, patch)} copyAndSend={() => copyAndSend(active)}
              putBack={() => setPromptSent(active.id, false)} remove={() => deletePrompt(active.id)} say={say} />
            : <Empty>Pick a prompt to edit it.</Empty>}
        </section>
      </div>
      <div className={`pb-toast${note ? ' is-on' : ''}`} role="status">{note}</div>
    </div>
  )
}

function PromptEditor({ p, update, copyAndSend, putBack, remove, say }: {
  p: PromptItem
  update: (patch: Partial<Pick<PromptItem, 'project' | 'session' | 'kind' | 'text'>>) => void
  copyAndSend: () => void
  putBack: () => void
  remove: () => void
  say: (m: string) => void
}) {
  const [text, setText] = useState(p.text)
  const [project, setProject] = useState(p.project)
  const [session, setSession] = useState(p.session)
  const [polished, setPolished] = useState<{ text: string; ai: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef({ text, p })
  latest.current = { text, p }

  /* Typing writes to a local copy; the store gets it after a pause and when he
     leaves this prompt. Every store write is a full save of the synced blob. */
  useEffect(() => {
    if (text === p.text) return
    const t = window.setTimeout(() => update({ text }), 500)
    return () => window.clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (latest.current.text !== latest.current.p.text) update({ text: latest.current.text }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const doPolish = async () => {
    setBusy(true)
    const out = await polishPrompt({ ...p, text })
    setBusy(false)
    setPolished(out)
    if (!out.ai) say(getAiKey() ? 'The model did not answer, so this is the plain template.' : 'No AI key set, so this is the plain template.')
  }
  const copyOnly = async () => {
    try { await navigator.clipboard.writeText(text); say('Copied') } catch { say('Could not copy. Select the text and copy it.') }
  }

  return (
    <div className="pb-edit">
      <textarea className="textinput pb-text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Prompt text" />
      <div className="pb-meta">
        <input className="textinput" list="pb-projects" value={project} onChange={(e) => setProject(e.target.value)} onBlur={() => project.trim() !== p.project && update({ project })} aria-label="Project" />
        <input className="textinput" list="pb-sessions" value={session} onChange={(e) => setSession(e.target.value)} onBlur={() => session.trim() !== p.session && update({ session })} aria-label="Session" />
        <select className="textinput pb-kindsel" value={p.kind} onChange={(e) => update({ kind: e.target.value as PromptKind })} aria-label="Kind">
          {PROMPT_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      {polished && (
        <div className="pb-polish">
          <div><h4>Yours</h4><pre>{text}</pre></div>
          <div><h4>{polished.ai ? 'Polished' : 'Plain template'}</h4><pre>{polished.text}</pre></div>
          <div className="pb-polish-acts">
            <button className="btn btn-primary" onClick={() => { setText(polished.text); update({ text: polished.text }); setPolished(null) }}>Use this</button>
            <button className="btn btn-quiet" onClick={() => setPolished(null)}>Keep mine</button>
          </div>
        </div>
      )}
      <div className="pb-acts">
        {p.sentAt
          ? <button className="btn btn-primary" onClick={putBack}>Put back in the queue</button>
          : <button className="btn btn-primary" onClick={copyAndSend}><Icon.Copy size={16} />Copy and mark sent</button>}
        <button className="btn btn-quiet" onClick={() => { void doPolish() }} disabled={busy || !text.trim()}><Icon.Wand size={16} />{busy ? 'Polishing' : 'Polish'}</button>
        <button className="btn btn-quiet" onClick={() => { void copyOnly() }}>Copy only</button>
        <span className="pb-grow" />
        <button className="btn btn-ghost" onClick={remove}>Delete</button>
      </div>
    </div>
  )
}
