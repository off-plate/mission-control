/* "I wanna give up": a panic button for the exact moment he's about to quit
   something, not a page he visits when he's already fine. Left column plays
   real motivational video (his call, YouTube links, verified against an
   actual search result the same way MUNDI_OPUS_QUEUE is -- never guessed).
   Right column is the actual argument: pick a horizon, and see what today's
   choice turns into at that distance, both ways. The two tracks are meant to
   diverge on purpose -- the top can be as good as his real goals get, the
   bottom can be as bad as quitting actually gets. Neither is padded to be
   comfortable. */

export interface GiveUpVideo {
  id: string
  title: string
  source: string
}

export const GIVEUP_QUEUE: GiveUpVideo[] = [
  { id: 'OM3H1J8Ht2o', title: 'You Cannot Give Up', source: 'David Goggins' },
  { id: 'yRfK5-7B-SU', title: 'Keep Getting Up', source: 'David Goggins' },
  { id: 'Cw0hZQ8Na_Y', title: 'Get Up and Get It Done', source: 'David Goggins' },
  { id: '6vuetQSwFW8', title: 'How Bad Do You Want It', source: 'Eric Thomas' },
  { id: 'sV91uo6pcQg', title: 'Discipline Equals Freedom', source: 'Jocko Willink' },
  { id: 'xd-9D3GzUpo', title: 'Mamba Mentality', source: 'Kobe Bryant' },
  { id: '_YYmfM2TfUA', title: 'The Training Montage', source: 'Rocky' },
  { id: 'HIcGuFnl7ZU', title: 'Why Do We Fall', source: 'Batman Begins' },
]

export interface Horizon {
  id: string
  label: string
  up: string
  down: string
}

/** habitName, when this was opened from a specific quitting habit, sharpens
 *  only the "tonight" tier -- the one horizon short enough that a single habit
 *  is the whole story. Every longer horizon is about the life the habit is
 *  standing in for, not the habit itself. */
export function giveUpHorizons(habitName?: string): Horizon[] {
  return [
    {
      id: 'today',
      label: 'Tonight',
      up: habitName
        ? `You don't give in on ${habitName} tonight. That's the whole win. It doesn't have to be more than that to count.`
        : `You close this and go do the thing anyway. That's the whole win tonight, and it's enough.`,
      down: habitName
        ? `Giving in on ${habitName} tonight doesn't make it easier. It just gives you a new "day one," and you already know how many of those you've had.`
        : `Nothing changes tonight, except one more day gets added to the pile of days you told yourself you'd start. That pile has a name, if you let it have one.`,
    },
    {
      id: 'week',
      label: 'This week',
      up: `This week you send the email you've been dreading. Moneta gets a call instead of your silence. Sunday's Datová schránka check finds nothing scary, because you looked before it could surprise you.`,
      down: `This week the number in Compass doesn't move. Moneta still hasn't heard from you. The schránka stays unchecked, which means whatever's sitting in there gets to surprise you later, on its terms, not yours.`,
    },
    {
      id: 'month',
      label: 'This month',
      up: `A month from now the thing that's been circling your head all year has an actual payment plan attached to it. Not solved. Structured. That's the whole difference between panic and progress.`,
      down: `A month from now it's still just a number you're scared of instead of a number you're managing, except now there's another month of interest sitting on top of it that didn't have to be there.`,
    },
    {
      id: '3mo',
      label: '3 months',
      up: `Three months of not quitting stacks into something real: Off-Plate has sent real emails and gotten real replies, maybe a real client. You look like someone who shows up. She's watched you actually do this instead of talk about it.`,
      down: `Three months from now you're having the same finance conversation with her you're avoiding right now, except it isn't the first time anymore, and "I know, I know" doesn't land the same the second time.`,
    },
    {
      id: 'year',
      label: 'A year from now',
      up: `A year of this and the 400K isn't a weight anymore, it's a story you tell about the year you turned it around. Off-Plate has a real name in Prague. You're not performing "having your life together" for her. You have it.`,
      down: `A year from now Off-Plate is a folder of drafts nobody sent. The debt is still there, bigger, because debt doesn't wait for you to feel ready. You're not "about to turn it around" anymore. You've been about to for a year.`,
    },
    {
      id: 'years',
      label: 'Years from now',
      up: `Years from now this is the year you point to: the year the business got real, the year you asked her to marry you from a floor that could actually hold the weight. Not luck. Just a long run of ordinary Tuesdays, like this one, where you didn't quit.`,
      down: `Years from now this isn't a bad week you remember, it's a pattern you recognize in yourself and can't explain to her, or one day to your own kids, why you always start and never finish. That's the real cost. Not the money. The version of you that gave up so many times he stopped being surprised by it.`,
    },
  ]
}
