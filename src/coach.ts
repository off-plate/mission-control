/* Coach's analyzer. You give it the thing you are avoiding in plain words;
   it hands back the factual breakdown, the cost of stalling, and an easy
   first step. This is the demo stand-in: it detects the kind of task by
   keywords and drafts from tuned templates. The real build sends your text
   to a model (Groq, free) that reads the actual thing and returns the same
   shape, so the UI and the flow do not change. */

import type { CoachFacts, TaskCategory } from './types'

export interface CoachAnalysis extends CoachFacts {
  firstStep: string
  firstStepMin: number
  category: TaskCategory
}

interface Kind {
  test: RegExp
  category: TaskCategory
  why: string
  steps: string
  cost: string
  firstStep: string
  firstStepMin: number
}

const KINDS: Kind[] = [
  {
    test: /\b(call|phone|ring|dial|voicemail|volat|zavolat|telefon|zavolám)\b/i,
    category: 'call',
    why: 'The hard part is not knowing how the other side will react, so it feels safer to keep not dialing.',
    steps: 'Write down the one outcome you want from this call. Find any reference number, date, or account they will ask for. Call, say the one thing plainly, and ask for the result in writing.',
    cost: 'Nothing moves until the call happens. Every day it waits, the problem sits exactly where it is, and these usually grow quietly instead of going away.',
    firstStep: 'Write the one sentence you want to say when they pick up.',
    firstStepMin: 5,
  },
  {
    test: /\b(pay|payment|invoice|bill|owe|faktur|platb|splátk|zaplatit|účet|dluh)\b/i,
    category: 'admin',
    why: 'Money things carry a bit of dread, so it is tempting to not look at the exact number.',
    steps: 'Confirm the exact amount and the deadline. Check the money is there, or decide what moves to cover it. Make the payment and save the confirmation.',
    cost: 'Late payments turn into penalties, interest, or a mark against you, and those cost far more than the original amount. This is the kind of thing that compounds.',
    firstStep: 'Open the bill and write down the amount and the due date. Nothing else.',
    firstStepMin: 5,
  },
  {
    test: /\b(email|e-mail|mail|message|write|reply|respond|text|follow.?up|napsat|odepsat|zpráv|napiš|odpovědět)\b/i,
    category: 'admin',
    why: 'You are probably rewriting it in your head. The unsent version is always heavier than the sent one.',
    steps: 'Decide the single thing this message needs to achieve. Write two sentences: what you need and by when. Send it, no preamble, no apology for the delay.',
    cost: 'An unsent message keeps the whole thing stalled on your side. The other person is waiting, and the silence reads worse than a plain answer would.',
    firstStep: 'Write the two sentences as a draft. Do not send yet.',
    firstStepMin: 5,
  },
  {
    test: /\b(form|application|submit|apply|fill|register|žádost|formulář|podat|vyplnit|přihlá)\b/i,
    category: 'admin',
    why: 'It looks bigger than it is because you have not seen exactly what it asks for yet.',
    steps: 'Read what the form actually asks for. Gather the documents or numbers you are missing. Fill what you can now, flag the gaps, and submit or schedule the rest.',
    cost: 'Unsubmitted paperwork keeps whatever it unlocks blocked, and the deadlines on these do not wait for you to feel ready.',
    firstStep: 'Open the form and read only what it asks for. Fill nothing yet.',
    firstStepMin: 10,
  },
  {
    test: /\b(book|appointment|schedule|reserve|doctor|dentist|objednat|termín|schůzk|rezerv)\b/i,
    category: 'quick',
    why: 'It is small, which is exactly why it keeps slipping under bigger things.',
    steps: 'Pick two dates that could work. Find the number or booking link. Book the earliest one and put it on the calendar.',
    cost: 'The longer you wait to book, the further out the free slots are. Avoiding it now just pushes the whole thing later.',
    firstStep: 'Pick the two dates that could work.',
    firstStepMin: 5,
  },
  {
    test: /\b(talk|tell|conversation|discuss|confront|apolog|honest|promluvit|říct|rozhovor|přiznat)\b/i,
    category: 'deep',
    why: 'You are carrying the whole conversation at once. It gets lighter the moment you say the first true sentence.',
    steps: 'Decide the one thing they need to hear. Pick a real moment, not in passing. Open with that one thing directly, then let it be a conversation, not a speech.',
    cost: 'The gap between what they think and what is true only widens the longer you wait, and the eventual talk gets heavier, not lighter.',
    firstStep: 'Write the one sentence you most need to say.',
    firstStepMin: 10,
  },
  {
    test: /\b(open|read|check|review|inbox|mailbox|schránk|otevřít|přečíst|zkontrolovat|projít)\b/i,
    category: 'admin',
    why: 'The fear is one specific thing inside. Reading is not deciding, and tonight you only read.',
    steps: 'Set a rule: you only read and list, no replies and no decisions today. Open it, read everything, write down any dates or actions. Stop there.',
    cost: 'Whatever is in there is already happening whether you look or not. Not opening it does not stop the clock, it just keeps you from seeing it.',
    firstStep: 'Open it and read the titles only, nothing else.',
    firstStepMin: 5,
  },
  {
    test: /\b(cancel|unsubscribe|return|refund|complain|dispute|zrušit|reklamac|vrátit|stížnost)\b/i,
    category: 'admin',
    why: 'It feels like a fight you have to win, but it is mostly just stating what you want clearly.',
    steps: 'Find the account, order, or contract number. State plainly what you want (cancel, return, refund) and by when. Get their confirmation in writing.',
    cost: 'Until you act, you keep paying for or carrying something you already decided you do not want.',
    firstStep: 'Find the account or order number and write it on one line.',
    firstStepMin: 5,
  },
]

const FALLBACK: Omit<Kind, 'test'> = {
  category: 'admin',
  why: 'Avoided things do not shrink on their own. Seeing it in plain steps is usually the whole unlock.',
  steps: 'Break it into the two or three concrete moves it actually takes. Note anything you need before you can start. Then do the first move, not the whole thing.',
  cost: 'It does not disappear, it just sits in the back of your mind taking up space and getting heavier the longer you leave it.',
  firstStep: 'Spend five minutes writing down exactly what this involves.',
  firstStepMin: 5,
}

function clean(input: string): string {
  const t = input.trim().replace(/\s+/g, ' ')
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(cap) ? cap : `${cap}.`
}

export function analyzeAvoidance(input: string): CoachAnalysis {
  const k = KINDS.find((x) => x.test.test(input)) ?? FALLBACK
  return {
    avoiding: `${clean(input)} ${k.why}`,
    steps: k.steps,
    cost: k.cost,
    firstStep: k.firstStep,
    firstStepMin: k.firstStepMin,
    category: k.category,
  }
}

/**
 * The pattern library, shaped into the same eight beats the model fills in, so
 * the page has one structure whether or not a key is set. It is generic and the
 * page says so; what it must not do is look like a different feature.
 */
export function fallbackRead(input: string): import('./ai').AvoidanceRead {
  const a = analyzeAvoidance(input)
  const parts = a.steps.split(/(?<=\.)\s+/).filter(Boolean)
  const rest = parts.slice(1).join(' ') || a.steps
  return {
    naming: a.avoiding,
    absolutes: [],
    feeling: 'Whatever this feels like right now is real, and it is not a verdict on you. Feeling it and judging yourself for it are two different acts.',
    verdict: a.cost,
    document: 'Open the actual thing before deciding anything about it. The letter, the form, the thread. What is in front of you is smaller than what you have been carrying.',
    firstStep: a.firstStep,
    firstStepMin: a.firstStepMin,
    onYourTerms: 'Do it the way that costs you least: your hour, your words, written rather than spoken if that is easier. Nothing here says it has to be done the hard way.',
    nextPiece: rest,
    category: a.category,
  }
}
