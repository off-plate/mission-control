/* Mundi Opus lives above the whole app, the same way the Pomodoro timer does:
   a global player that keeps going when he leaves the Zone, instead of one
   scoped to the Zone tile that lost its own iframe (and the music with it)
   the moment that tile unmounted. "It should keep going and be an extension
   of the floating focus badge with media controls" is what this is.

   The YouTube iframe itself is never shown: it plays from a permanently
   off-screen host that this provider owns and never unmounts, and every view
   (the Zone tile, the floating badge) shows the track's own real thumbnail
   image instead, sourced from YouTube's public thumbnail CDN by video id, no
   key required. That sidesteps the one hard problem a visible, portalled
   iframe would raise (keeping the SAME live embed rendered in two very
   differently sized places without restarting it) for a cost he never asked
   to be able to see: whether the "art" is a still or the frame itself. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { MUNDI_OPUS_QUEUE } from './mundiopus'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null
/** Shared with giveup.tsx: one script tag, one onYouTubeIframeAPIReady chain,
 *  whichever visible or off-canvas player asks for it first. */
export function loadYouTubeApi(): Promise<void> {
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

export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

function nextIndex(cur: number, shuffled: boolean): number {
  if (shuffled && MUNDI_OPUS_QUEUE.length > 1) {
    let i = cur
    while (i === cur) i = Math.floor(Math.random() * MUNDI_OPUS_QUEUE.length)
    return i
  }
  return (cur + 1) % MUNDI_OPUS_QUEUE.length
}

interface MundiOpus {
  ready: boolean
  /** Has been played at least once this session: the floating badge only
   *  carries transport for a player he has actually touched. */
  started: boolean
  track: number
  playing: boolean
  pos: number
  dur: number
  loop: boolean
  shuffle: boolean
  toggle: () => void
  go: (by: 1 | -1) => void
  seekTo: (seconds: number) => void
  seekBy: (delta: number) => void
  setLoop: (v: boolean) => void
  setShuffle: (v: boolean) => void
  /** Build the player now. Called when the Zone opens, or on first play. */
  ensure: () => void
}

const Ctx = createContext<MundiOpus | null>(null)
export function useMundiOpus(): MundiOpus {
  const c = useContext(Ctx)
  if (!c) throw new Error('useMundiOpus outside provider')
  return c
}

export function MundiOpusProvider({ children }: { children: ReactNode }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [started, setStarted] = useState(false)
  const [track, setTrack] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [loop, setLoop] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const loopRef = useRef(loop)
  const shuffleRef = useRef(shuffle)
  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])

  /* Nothing is loaded until something asks for it. The provider sits above the
     whole app, so building the player on mount pulled a YouTube embed into
     every single page view, for a player he may never open, and left one
     polling per open tab. ZonePlayer calls ensure() when the room opens, and
     toggle() calls it if he presses play from anywhere else. */
  const [wanted, setWanted] = useState(false)
  useEffect(() => {
    if (!wanted) return
    let alive = true
    void loadYouTubeApi().then(() => {
      if (!alive || !mountRef.current) return
      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId: MUNDI_OPUS_QUEUE[0].id,
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1 },
        events: {
          /* No compute-pressure grant here any more. There was one, setting
             the iframe's `allow` on ready, and it never worked: permissions
             policy is evaluated when the frame navigates, and onReady fires
             long after that. YouTube's own player script asks for the
             feature, our static host cannot delegate it at frame-creation
             time through the IFrame API, and nothing about playback depends
             on it. The gate treats the resulting console line as the
             third-party noise it is, rather than keeping code that looks
             like a fix and is not one. */
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
  }, [wanted])

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
    if (!p) { setWanted(true); setStarted(true); return }
    /* Set the instant he asks for it, not on the iframe's own confirmation
       that it actually started: that is a network round trip to YouTube,
       and the corner badge showing up should not wait on it. */
    if (playing) { p.pauseVideo() } else { setStarted(true); p.playVideo() }
  }
  const go = (by: 1 | -1) => setTrack((i) => (i + by + MUNDI_OPUS_QUEUE.length) % MUNDI_OPUS_QUEUE.length)
  const seekTo = (seconds: number) => {
    const p = playerRef.current
    if (!p || !dur) return
    const t = Math.min(dur, Math.max(0, seconds))
    p.seekTo(t, true)
    setPos(t)
  }
  const seekBy = (delta: number) => seekTo(pos + delta)

  const value: MundiOpus = { ready, started, track, playing, pos, dur, loop, shuffle, toggle, go, seekTo, seekBy, setLoop, setShuffle, ensure: () => setWanted(true) }
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Permanently off-canvas: not display:none or visibility:hidden, which
         some browsers throttle or pause media inside, just positioned where
         nothing is ever looking. */}
      <div className="mo-host" aria-hidden="true"><div ref={mountRef} /></div>
    </Ctx.Provider>
  )
}
