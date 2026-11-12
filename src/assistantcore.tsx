/* THE ASSISTANT'S CORE, shared by the full page (assistantpage.tsx, lazy-
   loaded) and the dock's compact widget (assistantdock.tsx, loaded on every
   page since the dock itself is). Split out (2026-09-08) after the first
   version of the dock panel silently pulled the ENTIRE assistant page --
   canvas cards, voice mode, dictation, all of it -- into the app's eager
   main bundle: dock.tsx has no lazy boundary of its own, so a static import
   of anything in assistantpage.tsx dragged that whole lazy chunk in with it
   (confirmed in the build output, and by the chunk that used to be its own
   ~54KB file disappearing into index.js once assistantdock.tsx imported
   from it directly). Everything actually needed for a real conversation --
   the brief, the doer, the mark, the play button, useAssistantThread itself
   -- lives here instead, with no page-only code (CardBody, the canvas,
   Dictate) anywhere in this file. assistantpage.tsx imports this module too,
   so there is exactly one copy of each, never a fork.

   VoicePanel and its startVoice/runSkill/endVoice glue (useVoiceGlue, at the
   bottom) joined this file the same day, on his second ask: the dock's quick
   panel is "primarily voice", not text-first with voice as an afterthought,
   so voice mode has to be as eager as everything else here -- a real,
   deliberate cost this time, not the accident the first pass over this file
   was written to undo. Dictation stayed behind in assistantpage.tsx: nothing
   in his ask mentioned typed dictation for the quick panel, only voice.

   The hooks and parts live in src/assistantcore/: the morning brief
   (brief.tsx), the actions he can ask for (doer.tsx), search (finder.tsx),
   the orb mark (mark.tsx) and the voice panel (voice.tsx). This file keeps
   the thread that ties them together and re-exports the rest. */
import { useState } from 'react'
import { MORNING, ask, parseBulkPlan, type CardKind, type Reply } from './assistant'
import { getAiProvider, PROVIDERS } from './ai'
import { useBrief } from './assistantcore/brief'
import { type Done, useDoer } from './assistantcore/doer'
import { useFinder } from './assistantcore/finder'
export { taskCard } from './assistantcore/doer'
export type { Done } from './assistantcore/doer'
export { Mark, Speak } from './assistantcore/mark'
export type { MarkState } from './assistantcore/mark'
export { VoicePanel, useVoiceGlue } from './assistantcore/voice'

/** Where a card sorts when several come at once: the day, then the days after it,
 *  then the list, then everything else in the order it arrived. */
const DAY_FIRST: Partial<Record<CardKind, number>> = { today: 0, planned: 1, backlog: 2 }
export const dayRank = (k: CardKind): number => DAY_FIRST[k] ?? 3

export interface Turn { who: 'you' | 'it'; text: string; reply?: Reply; done?: Done[]; touched?: string[]; /** The LOVE YOU 3000 reply: the core plays its own show. */ egg?: boolean }

/** Where a turn's changes landed: the cards that hold them, in the order they
 *  happened, and the rows to mark. Empty when nothing it did has a place. */
function landed(done: Done[]): { kinds: CardKind[]; keys: string[] } {
  const ok = done.filter((d) => d.ok && d.at?.card)
  return {
    kinds: [...new Set(ok.map((d) => d.at!.card!))].slice(0, 3),
    keys: ok.flatMap((d) => (d.at?.key ? [d.at.key] : [])),
  }
}

/* Everything ONE conversation actually is: the turns, what the canvas is
   showing, the in-flight/error state, and the one function that drives all
   of it. Pulled out of AssistantPage untouched (2026-09-08) so the dock's
   own compact panel (assistantdock.tsx) can carry a real conversation --
   the rate-limit retry, the provider-named errors, the canvas card
   selection, all of it -- rather than a second, thinner copy of "ask a
   question" built next to this one. Every caller gets its OWN turns: this
   is not a shared store, so the dock's quick exchange and the full page's
   are two different threads, the same way leaving the full page today
   already forgets what was asked on it -- nothing here removes a
   continuity that existed before it. */
export function useAssistantThread() {
  const brief = useBrief()
  const run = useDoer()
  const find = useFinder()
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /* A second line that says what to DO about it. An error naming a retired
     model means nothing to him; "the model this app used was retired, this
     build already moved to its replacement, reload" is something he can act on. */
  const [errHint, setErrHint] = useState<string | null>(null)
  /* What the right half is showing. It survives a reply that names no cards,
     because a canvas that empties itself every time he asks a plain question is
     a canvas he cannot work from. */
  const [canvas, setCanvasRaw] = useState<CardKind[]>(['today'])
  /* The day leads. A turn that made a project and seven tasks touched both, and
     the project list used to open first with the day below the fold, though the
     day was what he asked about (his report, 2026-11-07). The rest keep their order. */
  const setCanvas = (ks: CardKind[]) => setCanvasRaw([...ks].sort((a, b) => dayRank(a) - dayRank(b)))
  /** Rows the last change touched, marked on the canvas. */
  const [touched, setTouched] = useState<string[]>([])
  /* The answer as it is being written. The model emits its sentence first, so
     this fills in a few words at a time while the rest of the object is still
     coming, which is the difference between watching it think and watching a
     spinner spin. */
  const [live, setLive] = useState('')

  /* Returns the answer's words. The button ignores them and voice mode reads
     them out; an empty string means there was nothing to say. */
  /* `shown` is what goes in the thread when it differs from what is asked. The
     morning brief is a skill: he pressed a button, so the thread should say
     "Morning brief", not recite the paragraph the button sends on his behalf.
     Seeing the engineering is seeing the wiring. */
  const send = async (text: string, shown?: string): Promise<string> => {
    if (busy) return ''
    setBusy(true); setErr(null); setErrHint(null); setLive('')
    setTurns((t) => [...t, { who: 'you', text: shown ?? text }])
    /* A real day plan, parsed straight into real rows -- no model asked to
       reproduce it, so nothing in it can be sampled, truncated or reordered.
       See parseBulkPlan's own note for why this exists at all. */
    const bulk = parseBulkPlan(text)
    if (bulk) {
      const done = await run(bulk)
      const say = `Slotting in ${bulk.length} item${bulk.length === 1 ? '' : 's'}, exactly as written -- no model in the loop for this one.`
      const where = landed(done)
      setTurns((t) => [...t, { who: 'it', text: say, done, touched: where.keys, reply: { say, show: where.kinds.map((kind) => ({ kind })) } }])
      if (where.kinds.length) { setCanvas(where.kinds); setTouched(where.keys) }
      setBusy(false); setLive('')
      return say
    }
    /* What the app actually did goes back into the history with each answer
       (2026-10-04). It used to send only the model's own sentences, so a turn
       later it had no idea which rows it had really touched: "move it to the
       evening" and "no, I meant X" were guesses about its own past. */
    const history = turns.map((t) => ({
      role: (t.who === 'you' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.done?.length ? `${t.text}\n[App results: ${t.done.map((d) => `${d.ok ? '' : 'FAILED '}${d.text}${d.undone ? ' (he undid this)' : ''}`).join('; ')}]` : t.text,
    }))
    /* Every line any round ran, kept here with its undo and its actual-time
       prompt; the loop itself only needs ok/text. The rate-limit wait lives
       inside ask() now, per round, so a limit hit halfway through a job
       resumes it instead of re-running its first half. */
    const done: Done[] = []
    const out = await ask(text, brief, history, {
      run: async (acts) => { const d = await run(acts); done.push(...d); return d },
      find,
    }, setLive)
    if (out.ok) {
      /* WHAT CHANGED DECIDES THE CANVAS, not the model's choice of card. He
         asked for a task and the canvas stayed on the day while the task went
         to the list (his report, 2026-10-04): every change now opens the card
         it landed on, with its row marked. The model's own cards are for
         questions, where nothing moved. */
      const where = landed(done)
      const reply = where.kinds.length ? { ...out.reply, show: where.kinds.map((kind) => ({ kind })) } : out.reply
      setTurns((t) => [...t, { who: 'it', text: reply.say, reply, done: done.length ? done : undefined, touched: where.keys }])
      setTouched(where.keys)
      let kinds = reply.show.map((c) => c.kind)
      /* The brief ALWAYS draws the sky, whether or not the model remembered to
         name it. He asked for the weather to be visible, and that is not a
         thing to leave to whether a sentence came back with the right card in
         it. The app owns this card's numbers anyway. */
      if (text === MORNING.ask && !kinds.includes('weather')) kinds = ['weather', ...kinds]
      if (kinds.length) setCanvas(kinds.slice(0, 3))
      /* A change he cannot see is a change he will not believe. Anything that
         touched the day puts the day on the canvas unless it named its own. */
      else if (done.some((d) => d.ok)) setCanvas(['today'])
    } else {
      /* A 429 used to fall through to `out.detail`, which for a rate limit is
         Groq's raw body: an org id, a token count, a billing upsell link, all
         ending in "Ask again" on a request that was never unreadable. Two
         questions back to back after a card just wrote something is ordinary
         traffic, not a fault, and reads that way now. */
      /* Named for whichever provider is actually active (Settings' toggle),
         not hardcoded to Groq -- a Z.ai key rejected read as "That Groq key
         was rejected", which sends him to fix the wrong field. */
      const provider = PROVIDERS[getAiProvider()]
      setErr(
        out.reason === 'claude-down' ? (out.detail === 'off' ? 'JARVIS cannot reach Claude from this device.'
          : out.detail === 'mac-off' ? 'Your Mac is not answering.' : 'Claude did not answer.')
        : out.reason === 'no-key' ? `No ${provider.label} key yet.`
          : out.reason === 'rejected' ? `That ${provider.label} key was rejected.`
            : out.reason === 'offline' ? 'Could not reach the model.'
              : out.reason === 'rate-limit' ? 'Too many questions in the last minute.'
                : out.reason === 'too-big' ? `Too long for ${provider.label}'s free tier.`
                : out.detail ?? 'The answer came back unreadable.',
      )
      setErrHint(
        out.reason === 'claude-down' ? (out.detail === 'off' ? 'Sign in under Settings, Your account. Claude needs your login here, not a key.'
          : out.detail === 'mac-off' ? 'Wake the Mac and check the Claude helper is running. This device has no Gemini or Groq key to answer instead.'
          : 'Ask again. If it keeps happening, check the Claude helper on your Mac.')
        : out.reason === 'no-key' ? 'Add one in Settings. It stays on this device.'
          : out.reason === 'rejected' ? `Check it in Settings, or generate a new one at ${provider.getKeyUrl}.`
            : out.reason === 'model-gone' ? 'The model this app used was retired. This build already moved to its replacement, so reload the page.'
              : out.reason === 'offline' ? 'Check the connection and ask again.'
                : out.reason === 'rate-limit' ? (out.detail ? `Wait about ${out.detail}s and ask again.` : 'Wait a few seconds and ask again.')
                  : out.reason === 'too-big' ? 'Add a Gemini key in Settings (the voice key) and long requests go there.'
                  : 'Ask again, or rephrase it.',
      )
    }
    setBusy(false); setLive('')
    return out.ok ? out.reply.say : ''
  }

  return { brief, turns, setTurns, busy, err, errHint, canvas, setCanvas, touched, setTouched, live, send }
}
