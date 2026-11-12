import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { reelKind, parseReels, dedupe } from '../reels'
import {
    forgetFolder, grantFolder, pickFolder, type FolderState
} from '../localreels'
import { callFunction } from '../supabase'
import { loadYouTubeApi } from '../mundiplayer'
import { YT } from './shared'

export function Reel({ url, label, count, onOpenLibrary, onNext, onRatio }: {
  url: string; label?: string; count: number; onOpenLibrary: () => void; onNext: () => void
  /** His report (2026-09-18): the column was sized to a flat 9:16 guess, and
   *  a real reel that isn't exactly that (4:5 is common) got cropped harder
   *  than before to fill a box shaped for a clip it wasn't. Null between
   *  clips (or for YouTube/Vimeo, which this can't measure) falls back to
   *  9:16 in the parent rather than carrying over the last clip's shape. */
  onRatio?: (r: number | null) => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const [sound, setSound] = useState(true)
  const [failed, setFailed] = useState(false)
  /* His ask (2026-09-12): "I cannot stop it at all". One switch for every kind
     of reel -- the <video> element, the YouTube player, and the Vimeo embed --
     because from where he is sitting they are all just the clip that is
     playing. A new clip starts playing, so this resets with the url. */
  const [paused, setPaused] = useState(false)
  useEffect(() => { setPaused(false) }, [url])
  const kind = url ? reelKind(url) : null

  const { reelFiles, setReelFile } = useStore()
  /* An Instagram link is a page, not a video -- reel-fetch downloads it once
     and this download's success is what gets remembered, in the synced
     library, forever: a file that downloaded once will download the same way
     again. A FAILURE IS NEVER SYNCED. Some public reels refuse to hand over
     their video to a plain fetch at all -- Instagram withholds it, most often
     over the track's music rights, not over the reel being private -- and
     that isn't a fact about the link that a retry fixes, but it also isn't
     provably permanent, so it gets tried again next time this screen opens
     rather than being bricked from one bad attempt. `attempt` is this
     component's own memory of "already tried this url this time", not the
     store's. */
  const cached = kind === 'instagram' ? reelFiles?.[url] : undefined
  const [attempt, setAttempt] = useState<{ url: string; failed: boolean; message: string } | null>(null)

  useEffect(() => { setFailed(false); setSound(true); onRatio?.(null) }, [url])

  useEffect(() => {
    if (kind !== 'instagram' || cached || attempt?.url === url) return
    setAttempt({ url, failed: false, message: '' })
    void callFunction('reel-fetch', { method: 'POST', body: { url } }).then((res) => {
      const fileUrl = res.ok && typeof (res.data as { fileUrl?: unknown })?.fileUrl === 'string'
        ? (res.data as { fileUrl: string }).fileUrl
        : ''
      if (fileUrl) { setReelFile(url, fileUrl); return }
      /* The reason changes with what reel-fetch actually tried -- signed in or
         not, expired session or a reel with no video at all -- so the message
         it sent back is what shows, not a copy of it kept here to drift. */
      const message = !res.ok && res.message?.trim() ? res.message : 'Could not reach the downloader.'
      setAttempt((cur) => (cur?.url === url ? { url, failed: true, message } : cur))
    })
  }, [url, kind, cached, attempt, setReelFile])

  const playable = kind === 'instagram' ? (cached || null) : url
  const effectiveKind = kind === 'instagram' ? (cached ? 'file' : null) : kind

  useEffect(() => {
    const v = vid.current
    if (!v || effectiveKind !== 'file') return
    v.muted = false
    /* Unmuted autoplay is refused unless the browser trusts this origin. Rather
       than guess, ask for sound and take muted playback over no playback. */
    v.play().catch(() => { v.muted = true; setSound(false); v.play().catch(() => setFailed(true)) })
  }, [playable, effectiveKind])

  useEffect(() => {
    const v = vid.current
    if (!v) return
    if (paused) v.pause()
    else void v.play().catch(() => { /* autoplay rules, already handled on mount */ })
  }, [paused, playable])

  /* His call (2026-09-29): no Sound on button, sound is always on while this
     screen is up. A browser only allows unmuted playback after a gesture, so
     when autoplay was forced muted, the first tap or key anywhere unmutes it. */
  useEffect(() => {
    if (sound) return
    const hear = () => { const v = vid.current; if (v) { v.muted = false; void v.play() } setSound(true) }
    const opts = { capture: true, once: true } as const
    addEventListener('pointerdown', hear, opts)
    addEventListener('keydown', hear, opts)
    return () => { removeEventListener('pointerdown', hear, opts); removeEventListener('keydown', hear, opts) }
  }, [sound])

  const deadInstagram = kind === 'instagram' && !cached && attempt?.url === url && attempt.failed
  const fetchingInstagram = kind === 'instagram' && !cached && !deadInstagram

  return (
    <div className={`tl-reel${effectiveKind && !failed ? ' has-media' : ''}`}>
      {/* A clip that ends is a clip that hands off to another one, straight
          away, the same way he stops one habit for another instead of sitting
          in the gap. `loop` on the file, and `loop=1` in the YouTube/Vimeo
          embed, both used to replay the SAME clip forever -- so nothing here
          ever advanced on its own, only the manual Next button did. */}
      {!failed && effectiveKind === 'file' && (
        <video
          ref={vid} className="tl-media" src={playable ?? undefined} autoPlay playsInline
          onEnded={onNext} onError={() => setFailed(true)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth > 0 && v.videoHeight > 0) onRatio?.(v.videoWidth / v.videoHeight)
          }}
        />
      )}
      {!failed && kind === 'youtube' && (
        <YouTubeReel url={url} sound={sound} paused={paused} onEnded={onNext} onFail={() => setFailed(true)} />
      )}
      {/* Vimeo is a plain embed with no player API wired up here, so "paused"
          means the iframe is not mounted. Pressing play remounts it, which
          restarts the clip rather than resuming it -- worth it, because a
          control that visibly does nothing on one kind of reel is worse. */}
      {!failed && kind === 'vimeo' && !paused && (
        <iframe key={`${url}|${sound}`} className="tl-media" src={embedSrc(url, sound)} title="Reel"
          allow="autoplay; encrypted-media" frameBorder="0" />
      )}
      {!failed && kind === 'other' && (
        <img
          className="tl-media" src={url} alt="" onError={() => setFailed(true)}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth > 0 && img.naturalHeight > 0) onRatio?.(img.naturalWidth / img.naturalHeight)
          }}
        />
      )}

      {fetchingInstagram && (
        <div className="tl-reelempty">
          <p className="tl-l">Fetching this Reel…</p>
          <p>Downloaded once, then it plays straight from here on every device.</p>
        </div>
      )}
      {deadInstagram && (
        <div className="tl-reelempty is-bad">
          <p className="tl-l">That Reel would not download</p>
          <p className="tl-url">{url}</p>
          {/* The old wording here was a static guess, first blaming music
              rights and then a hardcoded rewrite of "what usually happens".
              Neither survives him actually setting up a session: reel-fetch
              now has two different true answers -- signed in vs not, expired
              vs never worked -- and the one that applies is decided server
              side. So the words on screen are reel-fetch's OWN answer, read
              straight (2026-09-12), not a copy of it kept here to go stale
              the next time that function's reasoning changes. */}
          <p>{attempt?.message || "It'll try again next time this screen opens."}</p>
        </div>
      )}

      {!kind && (
        <div className="tl-reelempty">
          <p className="tl-l">The reel is empty</p>
          <p>Paste your links and one plays here every time, full height, with sound.
          A wall of YouTube links is fine: the panel pulls the URLs out of it.</p>
        </div>
      )}
      {failed && (
        <div className="tl-reelempty is-bad">
          <p className="tl-l">That link would not load</p>
          <p className="tl-url">{url}</p>
          <p>It is still in the library. Skip to the next one, or take it out.</p>
        </div>
      )}

      <div className="tl-reelbar">
        <button className="tl-setshot" onClick={onOpenLibrary}>
          {count ? `${count} reel${count === 1 ? '' : 's'}` : 'Add reels'}
        </button>
        {/* His report (2026-09-12): "I dont know which video it is, you
            doesnt show me any link" -- when one clip stalls with nothing on
            screen, there was no way to tell which link in the library it even
            was without opening the console. Always on screen now, not only in
            an error state: a blob URL is meaningless to read, so a local
            file shows its own name instead of the handle it is held by. */}
        {kind && !failed && (
          <a
            className="tl-nowplaying"
            href={url.startsWith('blob:') ? undefined : url}
            target={url.startsWith('blob:') ? undefined : '_blank'}
            rel="noreferrer"
            title={label ?? url}
          >
            {label ?? url}
          </a>
        )}
        {kind && kind !== 'other' && !failed && (
          <button className="tl-setshot" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
            {paused ? 'Play' : 'Pause'}
          </button>
        )}
        {count > 1 && <button className="tl-setshot" onClick={onNext}>Next</button>}
      </div>
    </div>
  )
}

/** A YouTube clip through the real IFrame API, not a static embed: the raw
 *  iframe had no way to know when a clip ended, so `loop=1` was the only
 *  option and the same thirty seconds played forever. This one calls onEnded
 *  the moment the clip finishes, the same pattern Mundi Opus already uses. */
export function YouTubeReel({ url, sound, paused, onEnded, onFail }: {
  url: string; sound: boolean; paused: boolean; onEnded: () => void; onFail: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null)
  const onEndedRef = useRef(onEnded)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])
  const id = url.match(YT)?.[1] ?? ''

  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedRef = useRef(false)
  const armStallRef = useRef<() => void>(() => {})
  const kickRef = useRef<() => void>(() => {})
  const pausedRef = useRef(paused)
  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    if (!id) { onFail(); return }
    let alive = true
    /* THE NODE THE API DESTROYS MUST NOT BE REACT'S. Given an element, the
       IFrame API REPLACES it with its own iframe -- so the div React rendered
       is gone from the DOM while React still believes it is there, and the
       next unmount throws "Failed to execute 'removeChild' on 'Node': The node
       to be removed is not a child of this node". That is the crash he kept
       hitting on this screen (2026-09-12), found from the message the error
       card now prints. So React owns an empty host it never fills, and the
       node handed to the API is created here and cleaned up here. */
    const host = hostRef.current
    if (!host) return
    const mount = document.createElement('div')
    /* The API copies this node's className onto the iframe it swaps in, which
       is how `.tl-media` -- the fill rule every other reel kind answers to --
       reaches the real playing element. Keeping it on the wrapper instead left
       the iframe unstyled and unfindable. */
    mount.className = 'tl-media'
    host.appendChild(mount)

    /* A HUNG PLAYER IS A FAILED ONE. His report (2026-09-12): a video that
       "isn't loading at all", with nothing in the app to say which one or
       even that anything is wrong. Two different ways that happens, both
       covered by starting this the moment the effect runs rather than after
       the API script has already loaded:
         - the script loads and the player exists, but YouTube's own internal
           calls get blocked (an ad-blocker or privacy extension is enough)
           and it never fires onError, so it just sits there;
         - the SCRIPT ITSELF never loads at all, in which case the code below
           never even runs -- a timer started inside that `.then()` would
           never exist to fire. Verified against this exact case: the first
           version of this fix started the clock only after load succeeded,
           and passed every test except the one that mattered, a fully
           blocked script, which it left hanging forever.
       Ten seconds either way, and it now surfaces exactly like any other
       failure: the card, the link, Skip. */
    /* ONE PLAYER FOR EVERY CLIP. His report (2026-09-29): on his phone the
       sound sometimes did not play. A phone only lets a player make sound
       after a tap, and a new player per clip lost that permission on every
       auto-advance. The player is built once and later clips go in with
       loadVideoById, so the permission from the first tap carries over. */
    const armStall = () => {
      startedRef.current = false
      if (stallRef.current) clearTimeout(stallRef.current)
      stallRef.current = setTimeout(() => { if (alive && !startedRef.current) onFail() }, 10_000)
    }
    armStallRef.current = armStall
    armStall()
    /* His report (2026-09-29): "YouTube videos don't play on their own" on his
       phone. A phone refuses to start a player with sound before a tap, and
       then it just sits there. Ask for sound first; if nothing is playing
       1.5s later, take muted playback over none, and his first touch
       unmutes it (the gesture effect below). */
    kickRef.current = () => {
      setTimeout(() => {
        const p = playerRef.current
        if (!alive || !p?.getPlayerState || pausedRef.current) return
        const st = p.getPlayerState()
        if (st !== 1 && st !== 3) { p.mute?.(); p.playVideo?.() }
      }, 1500)
    }

    void loadYouTubeApi().then(() => {
      if (!alive || !host.isConnected) return
      playerRef.current = new window.YT!.Player(mount, {
        videoId: id,
        /* Controls on for a touch screen (2026-09-29): with them off there is
           no play button, so a clip the phone would not autoplay could not
           be started by hand at all. Desktop keeps the clean frame. */
        playerVars: { autoplay: 1, mute: sound ? 0 : 1, controls: matchMedia('(pointer: coarse)').matches ? 1 : 0, playsinline: 1, rel: 0 },
        events: {
          onReady: () => kickRef.current(),
          onStateChange: (e: { data: number }) => {
            if (e.data === 1 || e.data === 3) { startedRef.current = true; if (stallRef.current) clearTimeout(stallRef.current) }
            if (e.data === 0) onEndedRef.current()
          },
          onError: () => { if (stallRef.current) clearTimeout(stallRef.current); onFail() },
        },
      })
    })
    return () => {
      alive = false
      if (stallRef.current) clearTimeout(stallRef.current)
      try { playerRef.current?.destroy?.() } catch { /* already gone with its node */ }
      playerRef.current = null
      /* Whatever the API left behind goes with it. React never rendered these
         children, so clearing them is not touching anything React tracks. */
      host.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const firstId = useRef(id)
  useEffect(() => {
    if (id === firstId.current) return
    firstId.current = id
    if (!id) { onFail(); return }
    const p = playerRef.current
    if (!p?.loadVideoById) return
    armStallRef.current()
    p.loadVideoById(id)
    kickRef.current()
    if (pausedRef.current) p.pauseVideo?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.mute) return
    if (sound) p.unMute?.()
    else p.mute?.()
  }, [sound])

  /* The browser can start the player muted without telling this component.
     Any gesture on the page is the moment it will allow sound, so take it. */
  useEffect(() => {
    if (!sound) return
    const hear = () => {
      const p = playerRef.current
      if (p?.isMuted?.()) p.unMute?.()
      /* Left unstarted or cued by the browser: the tap is the permission. */
      const st = p?.getPlayerState?.()
      if (!pausedRef.current && (st === -1 || st === 5)) p.playVideo?.()
    }
    addEventListener('pointerdown', hear, true)
    addEventListener('keydown', hear, true)
    return () => { removeEventListener('pointerdown', hear, true); removeEventListener('keydown', hear, true) }
  }, [sound])

  useEffect(() => {
    const p = playerRef.current
    if (!p?.pauseVideo) return
    if (paused) p.pauseVideo?.()
    else p.playVideo?.()
  }, [paused])

  /* Given a real element (not a string id), the IFrame API replaces this div
     in place with its generated iframe and carries the className over, so
     tl-media -- the fill rule every other reel kind already answers to --
     lands on the real playing element with no extra wrapper or CSS. */
  return <div ref={hostRef} className="tl-ythost" data-clip={id} />
}

/* ---- the library ---- */
/* A PROMPT CANNOT TAKE THREE HUNDRED LINKS, which is what he asked for. This
   is a textarea he can paste a page into: every URL in it is pulled out, the
   same clip under four different YouTube spellings counts once, and the panel
   says what it took before he saves. */
export function ReelLibrary({ pool, folder, onClose }: {
  pool: string[]
  folder: { state: FolderState; setState: (s: FolderState) => void }
  onClose: () => void
}) {
  const { reels, setReels } = useStore()
  const [text, setText] = useState(() => (reels ?? []).join('\n'))
  const parsed = useMemo(() => parseReels(text), [text])
  const counts = useMemo(() => {
    const c = { youtube: 0, vimeo: 0, instagram: 0, file: 0, other: 0 }
    for (const u of parsed) c[reelKind(u)]++
    return c
  }, [parsed])
  const curated = pool.length - dedupe(reels ?? []).length

  return (
    <div className="tl-lib" role="dialog" aria-modal="true" aria-label="Reel library">
      <div className="tl-libbox">
        <header>
          <span className="tl-l">The reel library</span>
          <button className="tl-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="tl-libsay">
          Paste as many links as you like. One per line, separated by commas, or a whole page
          with links in it: every URL gets pulled out and the same clip twice counts once.
        </p>

        {/* A FOLDER ON HIS OWN MACHINE. His instruction (2026-09-12) after
            Instagram refused a download for the third time: he is not uploading
            anything, the app should read the clips off his disk. A page cannot
            open a path -- file:// from https is refused everywhere -- but it can
            be handed a folder, once, and remember it. */}
        <div className="tl-folder">
          {folder.state.status === 'unsupported' && (
            <p className="tl-libsay is-quiet">
              Reading a folder needs Chrome or Edge. Safari and Firefox do not offer it, so on
              those the links above are the only way in.
            </p>
          )}
          {folder.state.status === 'none' && (
            <>
              <button className="tl-setshot" onClick={() => void pickFolder().then(folder.setState)}>
                Play from a folder
              </button>
              <span className="tl-libsay is-quiet">
                Point it at a folder of .mp4, .webm, .mov or .m4v and they play here. Nothing is
                uploaded and nothing leaves the machine.
              </span>
            </>
          )}
          {folder.state.status === 'needs-permission' && (
            <>
              <button className="tl-setshot is-hot" onClick={() => void grantFolder().then(folder.setState)}>
                Allow {folder.state.name} again
              </button>
              <span className="tl-libsay is-quiet">
                The folder is remembered; the browser asks for permission again each time it
                restarts, and only off a click.
              </span>
            </>
          )}
          {folder.state.status === 'ready' && (
            <>
              <span className="tl-libsay">
                <b>{folder.state.reels.length}</b> clip{folder.state.reels.length === 1 ? '' : 's'} from <b>{folder.state.name}</b>
              </span>
              <button className="tl-setshot" onClick={() => void pickFolder().then(folder.setState)}>Change folder</button>
              <button className="tl-setshot" onClick={() => void forgetFolder().then(folder.setState)}>Stop using it</button>
            </>
          )}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...\nhttps://youtube.com/shorts/...\nhttps://www.instagram.com/reel/...'} />
        <div className="tl-libcount">
          <span><b>{parsed.length}</b> link{parsed.length === 1 ? '' : 's'}</span>
          <span><b>{counts.youtube}</b> YouTube</span>
          <span><b>{counts.vimeo}</b> Vimeo</span>
          <span><b>{counts.instagram}</b> Instagram</span>
          <span><b>{counts.file}</b> file{counts.file === 1 ? '' : 's'}</span>
          {counts.other > 0 && <span className="off"><b>{counts.other}</b> not recognised</span>}
          {curated > 0 && <span className="off"><b>{curated}</b> already shipped</span>}
        </div>
        <div className="tl-libfoot">
          <button className="tl-back" onClick={() => { setReels(parsed); onClose() }}>Save the library</button>
          <button className="tl-setshot" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i

export function embedSrc(url: string, sound: boolean): string {
  const y = url.match(YT)
  if (y) return `https://www.youtube-nocookie.com/embed/${y[1]}?autoplay=1&mute=${sound ? 0 : 1}&loop=1&controls=0&playsinline=1&rel=0&playlist=${y[1]}`
  const v = url.match(VIMEO)
  if (v) return `https://player.vimeo.com/video/${v[1]}?autoplay=1&muted=${sound ? 0 : 1}&loop=1`
  return url
}
