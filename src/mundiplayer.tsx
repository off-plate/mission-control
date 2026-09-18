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

import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { MUNDI_OPUS_PLAYLIST_ID, readResume, saveResume, type Track } from './mundiopus'
import { tunePool } from './tunes'
import { useStore } from './store'

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

/* Against the LIVE queue, not the curated constant. Once he pastes a library
   the constant is no longer what is playing, and a shuffle that still counted
   six would have refused to reach his seventh track. */
function nextIndex(cur: number, shuffled: boolean, len: number): number {
  if (shuffled && len > 1) {
    let i = cur
    while (i === cur) i = Math.floor(Math.random() * len)
    return i
  }
  return (cur + 1) % Math.max(1, len)
}

interface MundiOpus {
  ready: boolean
  /** Has been played at least once this session: the floating badge only
   *  carries transport for a player he has actually touched. */
  started: boolean
  track: number
  /** What is actually in the queue: his own library when he has pasted one,
   *  the curated channel when he has not. */
  queue: Track[]
  playing: boolean
  pos: number
  dur: number
  loop: boolean
  shuffle: boolean
  toggle: () => void
  go: (by: 1 | -1) => void
  /** Play a specific track. His ask (2026-09-12): open the list and click the
   *  one he wants, rather than skipping to it. */
  jump: (index: number) => void
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
  const { tunes } = useStore()
  /* Read once: this is what he was listening to and how far in, from
     whenever this device last had the player open. */
  const resumeRef = useRef(readResume())
  /* The live playlist's own member ids, learned from the player itself once
     it has actually cued the playlist (see the onStateChange below) -- empty
     until then, which is also what makes the room silent for the one beat
     before that happens rather than showing anything stale or wrong. */
  const [liveQueue, setLiveQueue] = useState<Track[]>([])
  const gotLiveQueue = useRef(false)
  /* His library if he has pasted one, the live playlist if not. */
  const queue = useMemo(() => tunePool(tunes, liveQueue), [tunes, liveQueue])
  const queueRef = useRef(queue)
  useEffect(() => { queueRef.current = queue }, [queue])
  const [track, setTrack] = useState(resumeRef.current.index)
  const trackRef = useRef(track)
  useEffect(() => { trackRef.current = track }, [track])
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  const [loop, setLoop] = useState(resumeRef.current.loop)
  const [shuffle, setShuffle] = useState(resumeRef.current.shuffle)
  const loopRef = useRef(loop)
  const shuffleRef = useRef(shuffle)
  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  /* Set right before an ended-track advance and read once by the load effect
     below. `playing` itself is already false by then -- onStateChange just
     set it, for the track that just finished -- so without this the load
     effect reads a stale "not playing" and only cues the next track instead
     of starting it: the room would go quiet at the end of every song instead
     of moving on. */
  const autoAdvanceRef = useRef(false)
  /** Set by toggle() when there is no player yet, read once by onReady. */
  const autoplayOnReadyRef = useRef(false)

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
      /* Nothing pasted: there is no video id to hand the constructor, because
         the whole point is that the real list only exists on YouTube's side.
         Built with no videoId, then cued to the live playlist in onReady,
         which is what actually resolves it -- see the onStateChange below. */
      const initialId = queueRef.current[0]?.id
      playerRef.current = new window.YT.Player(mountRef.current, {
        ...(initialId ? { videoId: initialId } : {}),
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
          onReady: () => {
            const p = playerRef.current
            const r = resumeRef.current
            if (!initialId) {
              p.cuePlaylist({ listType: 'playlist', list: MUNDI_OPUS_PLAYLIST_ID, index: r.index, startSeconds: r.pos })
            } else if (r.pos > 3) {
              p.seekTo(r.pos, true)
            }
            setReady(true)
            /* Pressing play before the player has ever been built (including
               the `missioncontrol://zone-play` shortcut, which may be the
               very first thing that opens the Zone this session) used to
               only get as far as building and cueing it -- cueVideoById and
               a bare constructor videoId both cue, neither plays, so the
               room stayed silent until he pressed play a second time.
               toggle() sets this flag for exactly that case. */
            if (autoplayOnReadyRef.current) {
              autoplayOnReadyRef.current = false
              setStarted(true)
              p.playVideo()
            }
          },
          onStateChange: (e: any) => {
            setPlaying(e.data === 1)
            /* The live playlist's real member ids, learned the first moment
               the player actually has them (YouTube's own current list, not
               anything fetched or guessed here) -- and only the first time:
               a playlist changing mid-session is not worth re-polling for. */
            if (!gotLiveQueue.current) {
              const ids: string[] = playerRef.current?.getPlaylist?.() ?? []
              if (ids.length) {
                gotLiveQueue.current = true
                setLiveQueue(ids.map((id) => ({ id, title: '' })))
              }
            }
            if (e.data !== 0) return
            // ENDED: repeat replays what just finished, otherwise move on
            // myself, shuffled or not. Never YouTube's own next pick.
            if (loopRef.current) {
              playerRef.current?.seekTo(0, true)
              playerRef.current?.playVideo()
            } else {
              autoAdvanceRef.current = true
              setTrack((i) => nextIndex(i, shuffleRef.current, queueRef.current.length))
            }
          },
        },
      })
    })
    return () => { alive = false; playerRef.current?.destroy?.() }
  }, [wanted])

  /* His report (2026-09-12): the track kept restarting from 0:00 every so
     often while he worked elsewhere -- notes, anything. Not a timer of its
     own: the sync pull (store.tsx, every 60s and on every window focus)
     calls applyExternal for ANY remote change, anywhere in the whole synced
     blob, and applyExternal sets `tunes` from a freshly-parsed array every
     time it runs, whether or not the list actually changed. `queue` here is
     a useMemo over `tunes`, so that new-but-equal array gave `queue` a new
     identity too, and this effect was keyed on `queue` itself -- a sync
     pull that touched a totally unrelated field silently looked like "the
     queue changed" and reloaded the current video. Keying on the actual
     video id at the current track instead means a same-content resync
     changes nothing here; only a real track change (a skip, a genuinely
     different pasted library) does. */
  const row = queue[track] ?? queue[0]
  const rowId = row?.id
  const first = useRef(true)
  useEffect(() => {
    if (!ready) return
    if (first.current) { first.current = false; return }
    const p = playerRef.current
    if (!p || !rowId) return
    /* Already exactly this video -- the live-playlist bootstrap in onReady
       just cued it, at his resumed position, before this effect's first real
       run ever saw a real rowId to compare against. Reloading it here would
       be a no-op at best and, at worst, throws that resume position away. */
    if (p.getVideoData?.()?.video_id === rowId) return
    const shouldPlay = playing || autoAdvanceRef.current
    autoAdvanceRef.current = false
    if (shouldPlay) p.loadVideoById(rowId)
    else p.cueVideoById(rowId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId, ready])

  /* His report (2026-09-18): the room always came back at 0:00, whatever was
     playing when he last closed it. Every half-second while the player is
     up, this hands the current spot to localStorage (mundiopus.ts), and
     onReady above hands it right back next time -- cued, never auto-played,
     so it's there to resume rather than something that starts on its own. */
  useEffect(() => {
    if (!ready) return
    const t = window.setInterval(() => {
      const p = playerRef.current
      if (!p?.getCurrentTime) return
      setPos(p.getCurrentTime() ?? 0)
      setDur(p.getDuration() ?? 0)
      saveResume({ index: trackRef.current, pos: p.getCurrentTime() ?? 0, loop: loopRef.current, shuffle: shuffleRef.current })
    }, 500)
    return () => window.clearInterval(t)
  }, [ready])

  useEffect(() => {
    const onUnload = () => {
      const p = playerRef.current
      if (!p?.getCurrentTime) return
      saveResume({ index: trackRef.current, pos: p.getCurrentTime() ?? 0, loop: loopRef.current, shuffle: shuffleRef.current })
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const toggle = () => {
    const p = playerRef.current
    if (!p) { autoplayOnReadyRef.current = true; setWanted(true); setStarted(true); return }
    /* Set the instant he asks for it, not on the iframe's own confirmation
       that it actually started: that is a network round trip to YouTube,
       and the corner badge showing up should not wait on it. */
    if (playing) { p.pauseVideo() } else { setStarted(true); p.playVideo() }
  }

  /* The desktop shell's `missioncontrol://zone-play` deep link: open the
     room and make sure it's actually playing, one press away or none at
     all. Reuses toggle() rather than reaching for the player directly, so
     it gets the same "not built yet" handling above for free. */
  useEffect(() => {
    const onZonePlay = () => {
      location.hash = '/zone'
      if (!playing) toggle()
    }
    window.addEventListener('mc:zone-play', onZonePlay)
    return () => window.removeEventListener('mc:zone-play', onZonePlay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])
  const go = (by: 1 | -1) => setTrack((i) => {
    const len = Math.max(1, queueRef.current.length)
    return (i + by + len) % len
  })
  const jump = (index: number) => {
    const len = queueRef.current.length
    if (index < 0 || index >= len) return
    setTrack(index)
    setWanted(true)
  }
  const seekTo = (seconds: number) => {
    const p = playerRef.current
    if (!p || !dur) return
    const t = Math.min(dur, Math.max(0, seconds))
    p.seekTo(t, true)
    setPos(t)
  }
  const seekBy = (delta: number) => seekTo(pos + delta)

  const value: MundiOpus = { ready, started, track, queue, jump, playing, pos, dur, loop, shuffle, toggle, go, seekTo, seekBy, setLoop, setShuffle, ensure: () => setWanted(true) }
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
