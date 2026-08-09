/* A small MP3-player-shaped face on the YouTube IFrame Player API, queued with
   Mundi Opus tracks (mundiopus.ts). No YouTube chrome, no algorithm, no next
   video he did not choose: `rel: 0` and a fixed queue instead of autoplay.

   The IFrame API script loads once, globally, and is safe to request again
   from a second mount; `window.onYouTubeIframeAPIReady` only ever needs to
   fire once, so a second Zone open reuses what the first already loaded. */

import { useEffect, useRef, useState } from 'react'
import { MUNDI_OPUS_QUEUE } from './mundiopus'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const prior = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prior?.(); resolve() }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  return apiPromise
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

function nextIndex(cur: number, shuffled: boolean): number {
  if (shuffled && MUNDI_OPUS_QUEUE.length > 1) {
    let i = cur
    while (i === cur) i = Math.floor(Math.random() * MUNDI_OPUS_QUEUE.length)
    return i
  }
  return (cur + 1) % MUNDI_OPUS_QUEUE.length
}

export function ZonePlayer() {
  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [track, setTrack] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [loop, setLoop] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  // Read inside the player's onStateChange, a callback wired once at mount:
  // without refs it would keep closing over the loop/shuffle values from
  // that first render forever, deaf to either toggle.
  const loopRef = useRef(loop)
  const shuffleRef = useRef(shuffle)
  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])

  useEffect(() => {
    let alive = true
    void loadYouTubeApi().then(() => {
      if (!alive || !mountRef.current) return
      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId: MUNDI_OPUS_QUEUE[0].id,
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e: any) => {
            setPlaying(e.data === 1)
            if (e.data !== 0) return
            // ENDED: repeat replays what just finished, otherwise move on
            // myself, shuffled or not. Never YouTube's own next pick.
            if (loopRef.current) {
              playerRef.current?.seekTo(0, true)
              playerRef.current?.playVideo()
            } else {
              setTrack((i) => nextIndex(i, shuffleRef.current))
            }
          },
        },
      })
    })
    return () => { alive = false; playerRef.current?.destroy?.() }
  }, [])

  // A track change loads the new id and keeps playing if it was playing.
  const first = useRef(true)
  useEffect(() => {
    if (!ready) return
    if (first.current) { first.current = false; return }
    const p = playerRef.current
    if (!p) return
    if (playing) p.loadVideoById(MUNDI_OPUS_QUEUE[track].id)
    else p.cueVideoById(MUNDI_OPUS_QUEUE[track].id)
  }, [track, ready])

  useEffect(() => {
    if (!ready) return
    const t = window.setInterval(() => {
      const p = playerRef.current
      if (!p?.getCurrentTime) return
      setPos(p.getCurrentTime() ?? 0)
      setDur(p.getDuration() ?? 0)
    }, 500)
    return () => window.clearInterval(t)
  }, [ready])

  const toggle = () => {
    const p = playerRef.current
    if (!p) return
    playing ? p.pauseVideo() : p.playVideo()
  }
  // Manual skips stay literal and predictable; shuffle only decides what
  // plays next on its own, at the end of a track.
  const go = (by: 1 | -1) => setTrack((i) => (i + by + MUNDI_OPUS_QUEUE.length) % MUNDI_OPUS_QUEUE.length)
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0
  const remaining = dur > 0 ? mmss(Math.max(0, dur - pos)) : '·:··'

  return (
    <div className="zplayer">
      <div className="zplayer-row">
        {/* A real video, cropped square as its own album art rather than a
           separate fetched thumbnail: what plays is what you see. */}
        <div className="zplayer-art"><div ref={mountRef} /></div>
        <div className="zplayer-meta">
          <span className="zplayer-source">Mundi Opus</span>
          <span className="zplayer-title" title={MUNDI_OPUS_QUEUE[track].title}>{MUNDI_OPUS_QUEUE[track].title}</span>
        </div>
      </div>
      <div className="zplayer-scrub" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
        <b style={{ left: `${pct}%` }} />
      </div>
      <div className="zplayer-time mono">
        <span>{mmss(pos)}</span><span>−{remaining}</span>
      </div>
      <div className="zplayer-controls">
        <button
          className={`zplayer-btn zplayer-tog${loop ? ' is-on' : ''}`}
          onClick={() => setLoop((v) => !v)}
          aria-pressed={loop}
          aria-label={loop ? 'Repeat this track: on' : 'Repeat this track: off'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 7h13a3 3 0 0 1 3 3v2M20 17H7a3 3 0 0 1-3-3v-2" strokeLinecap="round" />
            <path d="M14 4l3 3-3 3M10 20l-3-3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="zplayer-btn" onClick={() => go(-1)} aria-label="Previous track" disabled={!ready}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2.5v14H6zM19 5v14L9 12z" /></svg>
        </button>
        <button className="zplayer-btn zplayer-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!ready}>
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1" /><rect x="13.5" y="5" width="4.5" height="14" rx="1" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5.5l13 6.5-13 6.5z" /></svg>
          )}
        </button>
        <button className="zplayer-btn" onClick={() => go(1)} aria-label="Next track" disabled={!ready}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2.5v14H16zM5 5v14l10-7z" /></svg>
        </button>
        <button
          className={`zplayer-btn zplayer-tog${shuffle ? ' is-on' : ''}`}
          onClick={() => setShuffle((v) => !v)}
          aria-pressed={shuffle}
          aria-label={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 7h3.5l9 10H20M4 17h3.5l3-3.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M17 4l3 3-3 3M17 14l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
