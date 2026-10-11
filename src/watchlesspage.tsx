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
  asText, atUrl, blocks, recents, resetTidy, search, stamp, tidy, tidyFor, useTidy, useWatchless,
  type Block, type Transcript,
} from './watchless'
import { hasAiKey } from './ai'
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

/* The brief is the point of the page (his ask, 2026-10-05): what the video is,
   every key point explained with a jump to where it is said, what to take
   away, what got named, and whether the video is still worth the time. Older
   copies carry a plain string or bare takeaways and still read. */
function Brief({ doc }: { doc: Transcript }) {
  const b = doc.summary
  if (!b) return null
  if (typeof b === 'string') {
    return (
      <section className="wl-brief">
        <h2 className="wl-h2">The brief</h2>
        {b.split(/\n{2,}/).map((p, i) => <p key={i}>{p.trim()}</p>)}
      </section>
    )
  }
  const points = b.points?.length ? b.points : (b.takeaways ?? []).map((t) => ({ point: t, detail: '', at: '', sec: null }))
  return (
    <section className="wl-brief">
      <h2 className="wl-h2">What it is about</h2>
      {b.about && <p>{b.about}</p>}
      {points.length > 0 && (
        <>
          <h2 className="wl-h2 wl-h2-gap">Key points</h2>
          <ol className="wl-points">
            {points.map((p, i) => (
              <li key={i}>
                <p className="wl-point">
                  {p.point}
                  {p.sec != null && (
                    <a className="wl-at" href={atUrl(doc.videoId, p.sec)} target="_blank" rel="noreferrer">{p.at}</a>
                  )}
                </p>
                {p.detail && <p className="wl-detail">{p.detail}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      {b.outcomes && b.outcomes.length > 0 && (
        <>
          <h2 className="wl-h2 wl-h2-gap">What to take away</h2>
          <ul className="wl-list">{b.outcomes.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {b.mentions && b.mentions.length > 0 && (
        <>
          <h2 className="wl-h2 wl-h2-gap">Mentioned</h2>
          <ul className="wl-list">{b.mentions.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      )}
      {b.verdict && <p className="wl-verdict">{b.verdict}</p>}
      {b.coversUpTo && <p className="wl-covers">This brief covers the first {stamp(b.coversUpTo)} of the video.</p>}
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

  const tidyState = useTidy()
  const doc = state.status === 'ok' ? state.doc : null
  const raw = useMemo(() => (doc ? blocks(doc) : []), [doc])
  /* The repaired text replaces the caption run for reading, and the original is
     kept underneath: nothing the model did is destructive. */
  const clean = doc ? tidyFor(doc.videoId) : undefined
  const list = useMemo(
    () => (clean ? raw.map((b, i) => (clean.has(i) ? { ...b, text: clean.get(i) as string } : b)) : raw),
    [raw, clean, tidyState],
  )
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
        {/* The ask, in the original's own shape: a serif line, a mono prompt on
            a single rule, and a bracketed verb. No box, no fill, no radius. */}
        {!doc && <h1 className="wl-ask-h1">Paste a YouTube link</h1>}
        <form className={`wl-ask${doc ? ' is-tight' : ''}`} onSubmit={submit}>
          <span className="wl-caret" aria-hidden="true">&gt;</span>
          <input
            className="wl-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="youtube.com/watch?v=..."
            aria-label="YouTube link"
            spellCheck={false}
          />
          <button className="wl-go" type="submit" disabled={state.status === 'reading' || !input.trim()}>
            [ {state.status === 'reading' ? 'READING' : 'READ IT'} ]
          </button>
        </form>

        {state.status === 'idle' && seen.length > 0 && (
          <div className="wl-recent">
            <span className="wl-recent-h">Read before</span>
            {seen.map((r) => (
              <button key={r.videoId} className="wl-chip" onClick={() => { setInput(r.url); void read(r.url) }}>
                <span className="wl-chip-t">{r.title}</span>
              </button>
            ))}
          </div>
        )}

        {state.status === 'reading' && (
          <p className="wl-note">Reading. A video read before comes back at once; a new one has to be fetched.</p>
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
            <Brief doc={doc} />

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
              {/* His note: use the GLM key already in Settings here too. It
                  cannot improve the WORDS -- those are YouTube's caption track,
                  no model hears the audio -- but auto-captions arrive with no
                  full stops and no capitals, and repairing that is exactly what
                  a language model is for. On his key, so: on his press. */}
              {hasAiKey() && (
                <button
                  className="wl-tool"
                  onClick={() => { resetTidy(); void tidy(doc, raw) }}
                  disabled={tidyState.phase === 'working'}
                  title="Add the punctuation the captions never had"
                >
                  <Icon.Edit size={13} />
                  {tidyState.phase === 'working'
                    ? `Tidying ${tidyState.done}/${tidyState.total}`
                    : clean?.size ? 'Tidied' : 'Tidy up'}
                </button>
              )}
              <button className="wl-tool" onClick={copy}>
                <Icon.Copy size={13} />
                {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>

            {tidyState.phase === 'failed' && (
              <p className="wl-hint wl-tidyfail">Could not tidy the transcript: {tidyState.message}. What is on screen is the original.</p>
            )}

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
