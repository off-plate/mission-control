/* The Zone's face on the global Mundi Opus player (mundiplayer.tsx): a small
   MP3-player-shaped hub, art plus a scrub bar he can actually drag, plus the
   five-button transport. The player itself lives above this component now,
   so leaving the Zone does not stop the music; this file only draws it. */

import { useEffect, useRef } from 'react'
import { MUNDI_OPUS_QUEUE } from './mundiopus'
import { thumbUrl, useMundiOpus } from './mundiplayer'
import * as Icon from './icons'

const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

export function ZonePlayer() {
  const p = useMundiOpus()
  const scrubRef = useRef<HTMLDivElement>(null)
  // Opening the room is what asks for the player; nothing else loads it.
  useEffect(() => { p.ensure() }, [p])
  const current = MUNDI_OPUS_QUEUE[p.track]
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
        <img className="zplayer-art" src={thumbUrl(current.id)} alt="" />
        <div className="zplayer-meta">
          <span className="zplayer-source">Mundi Opus</span>
          <span className="zplayer-title" title={current.title}>{current.title}</span>
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
      </div>
    </div>
  )
}
