/* The moment he's about to quit something, not a page for later. Loads its
   own visible YouTube player (loadYouTubeApi is shared with Mundi Opus, the
   player itself is not -- this one is meant to be watched, Mundi Opus is
   meant to be background). Plays as a continuous, shuffled playlist by
   default: one video ends, a different one starts right away, on its own --
   repeat is a manual choice, not the default. Opens on a random pick from the
   queue every time, so two visits in one bad week don't open on the same
   clip. Picking a horizon on the right never touches this: track and horizon
   are separate state, and the player is built once, so nothing on the right
   side can restart or swap what's playing on the left. */

import { useEffect, useRef, useState } from 'react'
import { GIVEUP_QUEUE, giveUpHorizons } from './giveup'
import { loadYouTubeApi } from './mundiplayer'
import * as Icon from './icons'

function randomIndex(len: number): number {
  return Math.floor(Math.random() * len)
}
function otherRandomIndex(cur: number, len: number): number {
  if (len <= 1) return cur
  let i = cur
  while (i === cur) i = randomIndex(len)
  return i
}

export function GiveUpMode({ habitName, onClose }: { habitName?: string; onClose: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null)
  const [track, setTrack] = useState(() => randomIndex(GIVEUP_QUEUE.length))
  const [ready, setReady] = useState(false)
  const [loop, setLoop] = useState(false)
  const [shuffle, setShuffle] = useState(true)
  const loopRef = useRef(loop)
  const shuffleRef = useRef(shuffle)
  useEffect(() => { loopRef.current = loop }, [loop])
  useEffect(() => { shuffleRef.current = shuffle }, [shuffle])
  const [horizon, setHorizon] = useState(0)
  const horizons = giveUpHorizons(habitName)

  useEffect(() => {
    let alive = true
    void loadYouTubeApi().then(() => {
      if (!alive || !mountRef.current) return
      playerRef.current = new window.YT!.Player(mountRef.current, {
        videoId: GIVEUP_QUEUE[track].id,
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, autoplay: 1 },
        events: {
          onReady: () => { setReady(true); playerRef.current?.playVideo() },
          onStateChange: (e: { data: number }) => {
            if (e.data !== 0) return
            // ENDED: by default move on myself to a shuffled pick, straight
            // away -- never YouTube's own related-next. Repeat is opt-in.
            if (loopRef.current) {
              playerRef.current?.seekTo(0, true)
              playerRef.current?.playVideo()
            } else {
              setTrack((i) => (shuffleRef.current ? otherRandomIndex(i, GIVEUP_QUEUE.length) : (i + 1) % GIVEUP_QUEUE.length))
            }
          },
        },
      })
    })
    return () => { alive = false; playerRef.current?.destroy?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready) return
    playerRef.current?.loadVideoById?.(GIVEUP_QUEUE[track].id)
  }, [track, ready])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cur = GIVEUP_QUEUE[track]
  const h = horizons[horizon]

  return (
    <div className="overlay giveup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="giveup-sheet" role="dialog" aria-modal="true" aria-label="I wanna give up">
        <div className="sheet-head">
          <h2>I wanna give up</h2>
          <button className="close" onClick={onClose} aria-label="Close"><Icon.Close size={16} /></button>
        </div>
        <div className="giveup-body">
          <div className="giveup-video">
            <div className="giveup-frame"><div ref={mountRef} /></div>
            <div className="giveup-nowplaying">
              <span className="giveup-title">{cur.title}</span>
              <span className="giveup-source">{cur.source}</span>
            </div>
            <div className="giveup-controls">
              <button
                className={`giveup-btn giveup-tog${loop ? ' is-on' : ''}`}
                onClick={() => setLoop((v) => !v)} aria-pressed={loop} aria-label={loop ? 'Repeat this video: on' : 'Repeat this video: off'}
              ><Icon.Repeat size={15} /></button>
              <button
                className="giveup-btn"
                onClick={() => setTrack((i) => (i - 1 + GIVEUP_QUEUE.length) % GIVEUP_QUEUE.length)}
                aria-label="Previous video"
              ><Icon.SkipBack size={14} filled /></button>
              <button
                className="giveup-btn"
                onClick={() => setTrack((i) => (shuffle ? otherRandomIndex(i, GIVEUP_QUEUE.length) : (i + 1) % GIVEUP_QUEUE.length))}
                aria-label="Next video"
              ><Icon.SkipNext size={14} filled /></button>
              <button
                className={`giveup-btn giveup-tog${shuffle ? ' is-on' : ''}`}
                onClick={() => setShuffle((v) => !v)} aria-pressed={shuffle} aria-label={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
              ><Icon.Shuffle size={15} /></button>
            </div>
          </div>
          <div className="giveup-panel">
            <div className="giveup-horizons">
              {horizons.map((row, i) => (
                <button
                  key={row.id}
                  className={`giveup-hpill${i === horizon ? ' is-on' : ''}`}
                  onClick={() => setHorizon(i)}
                >{row.label}</button>
              ))}
            </div>
            <div className="giveup-track giveup-up">
              <span className="microcap">If you keep going</span>
              <p>{h.up}</p>
            </div>
            <div className="giveup-track giveup-down">
              <span className="microcap">If you stop now</span>
              <p>{h.down}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
