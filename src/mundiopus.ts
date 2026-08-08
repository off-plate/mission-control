/* Mundi Opus, https://www.youtube.com/@mundiopus, the channel he named for
   focus music in the Zone.

   YouTube has no free, keyless way to pull "everything on this channel right
   now": that needs the Data API and a key, which is not something to wire in
   without asking. So this is a curated queue instead, real videos found off
   the channel, each id verified against an actual search result rather than
   guessed. Add more the same way: paste the video id, name it in his words. */

export interface Track {
  id: string
  title: string
}

export const MUNDI_OPUS_QUEUE: Track[] = [
  { id: '6rvv8bU3pKA', title: 'You are coding a new exciting project · The Social Network' },
  { id: 'A953td1sKS8', title: 'You are building up your project · The Social Network' },
  { id: '4HM_W8z4bfE', title: 'You are limitless · Limitless' },
  { id: 'wUWdIaaCvjg', title: 'You are designing dreams · Inception' },
  { id: 'LYigiwbaX_U', title: 'You are hearing the music · Oppenheimer' },
  { id: 'WBKdhFLnKP0', title: 'You are being amazing · The Amazing Spider-Man' },
]
