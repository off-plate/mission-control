/* THE WATCHLESS PAGE. Paste a link, read the thing.

   His ask (2026-09-11): bring Watchless into Mission Control, in the dock at
   the bottom right, next to Health.

   The shape follows what the reader is for. A video is an hour you cannot skim;
   a transcript is five minutes you can. So the brief is first, the chapters are
   a table of contents you can jump from, and the transcript reads as paragraphs
   rather than as the three-word subtitle cues the machine actually returns.

   Nothing here fetches on its own. A request to the reader can spend a credit
   against a monthly cap, so it happens when he asks and not when a component
   mounts, and what came back always says what it cost -- including the zero a
   cache hit costs, because "free" is worth seeing. */
import { useMemo, useRef, useState } from 'react'
import {
  asText, atUrl, blocks, recents, search, stamp, useWatchless,
  type Block, type Transcript,
} from './watchless'
import * as Icon from './icons'

function Head({ doc }: { doc: Transcript }) {
  return (
    <header className="wl-head">
      {/* A missing thumbnail renders as a broken-image glyph, which looks
          like a bug rather than an absence. */}
      {doc.thumbnail && <img className="wl-thumb" src={doc.thumbnail} alt="" loading="lazy" />}
      <div className="wl-headtext">
        <h1 className="wl-title">{doc.title}</h1>
        <p className="wl-meta">
          {doc.channel && <span>{doc.channel}</span>}
          <span>{stamp(doc.duration)}</span>
          <span>{doc.words.toLocaleString('en-GB')} words</span>
          {/* What it cost to make this copy. A cache hit is the good case and
              says so, rather than staying quiet and looking the same as a
              request that just spent. */}
          <span className={doc.cached || doc.cost === 0 ? 'wl-free' : 'wl-paid'}>
            {doc.cached ? 'from the cache, free' : doc.cost === 0 ? 'free, YouTube gave it up' : `cost ${doc.cost}`}
          </span>
        </p>
      </div>
      <a className="wl-watch" href={doc.url} target="_blank" rel="noreferrer">
        <Icon.ExternalLink size={13} />
        Watch
      </a>
    </header>
  )
}

function Brief({ text }: { text: string }) {
  return (
    <section className="wl-brief">
      <h2 className="wl-h2">The brief</h2>
      {text.split(/\n{2,}/).map((p, i) => <p key={i}>{p.trim()}</p>)}
    </section>
  )
}

function Chapters({ list, onJump }: { list: Block[]; onJump: (i: number) => void }) {
  const named = list.filter((b) => b.title)
  if (!named.length) return null
  return (
    <nav className="wl-chapters" aria-label="Chapters">
      {list.map((b, i) => b.title && (
        <button key={i} className="wl-chip" onClick={() => onJump(i)}>
          <span className="wl-chip-at mono">{stamp(b.start)}</span>
          <span className="wl-chip-t">{b.title}</span>
        </button>
      ))}
    </nav>
  )
}

/** The matched term, marked in place. Rendered rather than injected as HTML:
 *  a transcript is text from a stranger's video and has no business being
 *  parsed as markup. */
function Marked({ text, term }: { text: string; term: string }) {
  const q = term.trim()
  if (!q) return <>{text}</>
  const parts: React.ReactNode[] = []
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  let from = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at < 0) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>)
    from = at + q.length
  }
  parts.push(text.slice(from))
  return <>{parts}</>
}

export function WatchlessPage() {
  const { state, read, clear } = useWatchless()
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const seen = recents()

  const doc = state.status === 'ok' ? state.doc : null
  const list = useMemo(() => (doc ? blocks(doc) : []), [doc])
  const found = useMemo(() => search(list, term), [list, term])

  const jump = (i: number) => {
    const el = bodyRef.current?.querySelector(`[data-block="${i}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) void read(input)
  }

  const copy = async () => {
    if (!doc) return
    try {
      await navigator.clipboard.writeText(asText(doc))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* a refused clipboard is not worth an error state */ }
  }

  return (
    <div className="page">
      <div className="wl">
        <form className="wl-ask" onSubmit={submit}>
          <input
            className="wl-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
            spellCheck={false}
          />
          <button className="wl-go" type="submit" disabled={state.status === 'reading' || !input.trim()}>
            {state.status === 'reading' ? 'Reading' : 'Read'}
          </button>
        </form>

        {state.status === 'idle' && (
          <div className="wl-empty">
            <p>Paste a link and read it instead of watching it.</p>
            {seen.length > 0 && (
              <div className="wl-recent">
                <span className="wl-recent-h">Read before</span>
                {seen.map((r) => (
                  <button key={r.videoId} className="wl-chip" onClick={() => { setInput(r.url); void read(r.url) }}>
                    <span className="wl-chip-t">{r.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {state.status === 'reading' && (
          <p className="wl-empty">
            Reading. A video the reader has seen before comes back at once; a new one has to be fetched.
          </p>
        )}

        {state.status === 'error' && (
          <div className="wl-empty is-bad">
            <p className="wl-err">{state.message}</p>
            {state.hint && <p className="wl-hint">{state.hint}</p>}
            <button className="wl-go" onClick={clear}>Try another</button>
          </div>
        )}

        {doc && (
          <>
            <Head doc={doc} />
            {doc.summary && <Brief text={doc.summary} />}

            <div className="wl-tools">
              <div className="wl-find">
                <Icon.Search size={14} />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Find in the transcript"
                  aria-label="Find in the transcript"
                  spellCheck={false}
                />
                {term && <span className="wl-count">{found.count || 'nothing'}</span>}
              </div>
              <button className="wl-tool" onClick={copy}>
                <Icon.Copy size={13} />
                {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>

            <Chapters list={list} onJump={jump} />

            <div className="wl-body" ref={bodyRef}>
              {list.map((b, i) => (
                <section
                  key={i}
                  data-block={i}
                  className={`wl-block${term && found.hits.has(i) ? ' is-hit' : ''}${term && !found.hits.has(i) ? ' is-dim' : ''}`}
                >
                  <a className="wl-at mono" href={atUrl(doc.videoId, b.start)} target="_blank" rel="noreferrer" title="Open the video here">
                    {stamp(b.start)}
                  </a>
                  <div className="wl-text">
                    {b.title && <h3 className="wl-blocktitle">{b.title}</h3>}
                    <p><Marked text={b.text} term={term} /></p>
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
