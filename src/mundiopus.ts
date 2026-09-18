/* Mundi Opus, his own "Focus" playlist on Michael's Corner
   (https://www.youtube.com/playlist?list=PLSa9TphRQqJ4).

   This used to be a curated list of video ids pasted into source -- real
   videos, but frozen the moment someone typed them in, and YouTube's Data
   API (the only way to ask "what's on this playlist right now") needs a key
   this app was never going to carry. The actual answer was already sitting
   in the IFrame Player API everyone here already loads: give it the
   playlist id instead of a video id, and YouTube keeps it current, handles
   next/previous and repeat/shuffle over the real list, and hands back
   whatever's playing through getVideoData(). Adding a track to the YouTube
   playlist is the only maintenance this needs from here on. */

export const MUNDI_OPUS_PLAYLIST_ID = 'PLSa9TphRQqJ4'

export interface Track {
  id: string
  title: string
}

/** Where he left off, so reopening the Zone doesn't throw him back to track
 *  one: which playlist index was playing and how far into it, read back on
 *  the next launch and cued (not played) at that exact spot. */
interface Resume {
  index: number
  pos: number
  loop: boolean
  shuffle: boolean
}
const RESUME_KEY = 'mc-mundi-opus-resume'

export function readResume(): Resume {
  try {
    const raw = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}')
    return {
      index: typeof raw.index === 'number' && raw.index >= 0 ? raw.index : 0,
      pos: typeof raw.pos === 'number' && raw.pos >= 0 ? raw.pos : 0,
      loop: raw.loop === true,
      shuffle: raw.shuffle === true,
    }
  } catch {
    return { index: 0, pos: 0, loop: false, shuffle: false }
  }
}

export function saveResume(next: Resume) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(next))
  } catch {
    // Not fatal: worst case is the next session starts over from track one.
  }
}
