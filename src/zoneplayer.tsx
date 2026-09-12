/* The Zone's face on the global Mundi Opus player (mundiplayer.tsx): a small
   MP3-player-shaped hub, art plus a scrub bar he can actually drag, plus the
   five-button transport. The player itself lives above this component now,
   so leaving the Zone does not stop the music; this file only draws it. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { thumbUrl, useMundiOpus } from './mundiplayer'
import { useStore } from './store'
import { missingTitles, onTitles, parseTunes, titleFor, titlesVersion, trackTitle, tuneId, wantTitles } from './tunes'
import * as Icon from './icons'

/* hqdefault does not exist for every video (a live stream has none), and a
   missing one 404s into the console on every render. Fall back to mqdefault
   once, then give up quietly rather than looping. */
function fallbackThumb(e: React.SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget
  if (img.dataset.fell) { img.style.visibility = 'hidden'; return }
  img.dataset.fell = '1'
  img.src = img.src.replace('/hqdefault.jpg', '/mqdefault.jpg')
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

export function ZonePlayer() {
  const p = useMundiOpus()
  const { tunes } = useStore()
  const scrubRef = useRef<HTMLDivElement>(null)
  const [list, setList] = useState(false)
  const [lib, setLib] = useState(false)
  // Opening the room is what asks for the player; nothing else loads it.
  useEffect(() => { p.ensure() }, [p])

  /* Titles arrive from oEmbed after the list is already on screen, so this
     re-renders when they land rather than showing ids until the next click. */
  useSyncExternalStore(onTitles, titlesVersion, () => 0)
  useEffect(() => { wantTitles(missingTitles(p.queue)) }, [p.queue])

  const current = p.queue[p.track] ?? p.queue[0]
  const mine = (tunes ?? []).length > 0
  if (!current) return null
  const shownTitle = trackTitle(current)
  const pct = p.dur > 0 ? Math.min(100, (p.pos / p.dur) * 100) : 0
  const remaining = p.dur > 0 ? mmss(Math.max(0, p.dur - p.pos)) : '·:··'

  const seekAt = (clientX: number) => {
    const el = scrubRef.current
    if (!el || !p.ready || !p.dur) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    p.seekTo(ratio * p.dur)
  }

  return (
    <div className="zplayer">
      <div className="zplayer-row">
        <img className="zplayer-art" src={thumbUrl(current.id)} alt="" onError={fallbackThumb} />
        <div className="zplayer-meta">
          <span className="zplayer-source">{mine ? `Your queue, ${p.queue.length}` : 'Mundi Opus'}</span>
          <span className="zplayer-title" title={shownTitle}>{shownTitle}</span>
        </div>
      </div>
      <div
        className="zplayer-scrub" ref={scrubRef}
        role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(p.dur)} aria-valuenow={Math.round(p.pos)}
        tabIndex={p.ready && p.dur ? 0 : -1}
        onPointerDown={(e) => { if (!p.ready || !p.dur) return; (e.target as Element).setPointerCapture(e.pointerId); seekAt(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons === 1) seekAt(e.clientX) }}
        onKeyDown={(e) => {
          if (!p.ready || !p.dur) return
          if (e.key === 'ArrowRight') { e.preventDefault(); p.seekBy(5) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); p.seekBy(-5) }
        }}
      >
        <i style={{ width: `${pct}%` }} />
        <b style={{ left: `${pct}%` }} />
      </div>
      <div className="zplayer-time mono">
        <span>{mmss(p.pos)}</span><span>−{remaining}</span>
      </div>
      <div className="zplayer-controls">
        <button
          className={`zplayer-btn zplayer-tog${p.loop ? ' is-on' : ''}`}
          onClick={() => p.setLoop(!p.loop)}
          aria-pressed={p.loop}
          aria-label={p.loop ? 'Repeat this track: on' : 'Repeat this track: off'}
        >
          <Icon.Repeat size={17} />
        </button>
        <button className="zplayer-btn" onClick={() => p.go(-1)} aria-label="Previous track" disabled={!p.ready}>
          <Icon.SkipBack size={16} filled />
        </button>
        <button className="zplayer-btn zplayer-play" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} disabled={!p.ready}>
          {p.playing ? (
            <Icon.Pause size={18} filled />
          ) : (
            <Icon.Play size={18} filled />
          )}
        </button>
        <button className="zplayer-btn" onClick={() => p.go(1)} aria-label="Next track" disabled={!p.ready}>
          <Icon.SkipNext size={16} filled />
        </button>
        <button
          className={`zplayer-btn zplayer-tog${p.shuffle ? ' is-on' : ''}`}
          onClick={() => p.setShuffle(!p.shuffle)}
          aria-pressed={p.shuffle}
          aria-label={p.shuffle ? 'Shuffle: on' : 'Shuffle: off'}
        >
          <Icon.Shuffle size={17} />
        </button>
        {/* His ask (2026-09-12): open the list and click what he wants,
            instead of pressing Next until it comes round. */}
        <button
          className={`zplayer-btn zplayer-tog${list ? ' is-on' : ''}`}
          onClick={() => { setList((v) => !v); setLib(false) }}
          aria-expanded={list}
          aria-label={list ? 'Hide the queue' : 'Show the queue'}
        >
          <Icon.List size={17} />
        </button>
      </div>

      {list && (
        <div className="zqueue">
          <div className="zqueue-head">
            <span>{mine ? 'Your queue' : 'Mundi Opus'}</span>
            <button className="zqueue-add" onClick={() => { setLib(true); setList(false) }}>
              <Icon.Plus size={13} />
              {mine ? 'Edit links' : 'Add your own'}
            </button>
          </div>
          <ul className="zqueue-list">
            {p.queue.map((row, i) => (
              <li key={row.id + i}>
                <button
                  className={`zqueue-row${i === p.track ? ' is-on' : ''}`}
                  onClick={() => p.jump(i)}
                  title={row.title}
                >
                  <img src={thumbUrl(row.id)} alt="" loading="lazy" onError={fallbackThumb} />
                  <span className="zqueue-title">{trackTitle(row)}</span>
                  {i === p.track && p.playing && <Icon.Waveform size={13} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lib && <TuneLibrary onClose={() => setLib(false)} />}
    </div>
  )
}

/* Paste links, ADD a queue.
   His report (2026-09-12): he pasted four links and the rest of his queue
   was gone. It was, because this started as the reel library's editor --
   a box that replaces the whole list with whatever text is in it, prefilled
   with the current library so leaving it untouched round-tripped safely. The
   moment he pasted without keeping the old links in view, they were the text
   that got saved over.

   So this is an ADD box now, never a replace box. Everything already in his
   library is shown above it and stays there no matter what he pastes below;
   pasting only ever appends what is new. Removing one is its own button,
   right on the row, so it is a decision he makes on purpose rather than a
   side effect of editing text. */
function TuneLibrary({ onClose }: { onClose: () => void }) {
  const { tunes, setTunes } = useStore()
  const mine = tunes ?? []
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseTunes(text), [text])
  const already = useMemo(() => new Set(mine.map(tuneId)), [mine])
  const fresh = useMemo(() => parsed.filter((u) => !already.has(tuneId(u))), [parsed, already])
  /* What he pasted that is NOT a YouTube link, so a typo is visible rather
     than silently dropped. */
  const rejected = useMemo(
    () => text.split('\n').filter((line) => line.trim() && !parseTunes(line).length).length,
    [text],
  )

  const add = () => {
    if (!fresh.length) { onClose(); return }
    const next = [...mine, ...fresh]
    setTunes(next)
    wantTitles(fresh.map((u) => tuneId(u) as string))
    setText('')
  }
  const remove = (id: string) => setTunes(mine.filter((u) => tuneId(u) !== id))

  return (
    <div className="zlib" role="dialog" aria-label="Focus music">
      <div className="zlib-head">
        <span>Focus music</span>
        <button className="zplayer-btn" onClick={onClose} aria-label="Close"><Icon.Close size={15} /></button>
      </div>

      {mine.length > 0 && (
        <ul className="zlib-current">
          {mine.map((url) => {
            const id = tuneId(url)
            if (!id) return null
            return (
              <li key={id}>
                <span className="zlib-current-title">{titleFor(id) ?? id}</span>
                <button className="zlib-remove" onClick={() => remove(id)} aria-label={`Remove ${titleFor(id) ?? id}`}>
                  <Icon.Close size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="zlib-say">
        {mine.length ? 'Paste more links to add to the list above. Nothing already there is removed.'
          : 'Paste YouTube links, one per line. Empty, Mundi Opus plays instead.'}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder="https://www.youtube.com/watch?v=..."
        aria-label="Add YouTube links"
      />
      <div className="zlib-foot">
        <span>
          {fresh.length > 0 && `${fresh.length} new ${fresh.length === 1 ? 'track' : 'tracks'}`}
          {parsed.length > fresh.length && ` (${parsed.length - fresh.length} already in your list)`}
          {rejected > 0 && `${fresh.length || parsed.length > fresh.length ? ', ' : ''}${rejected} ${rejected === 1 ? 'line is' : 'lines are'} not a YouTube link`}
        </span>
        <button className="zlib-save" onClick={add} disabled={!fresh.length}>
          {fresh.length ? `Add ${fresh.length}` : 'Add'}
        </button>
      </div>
    </div>
  )
}
