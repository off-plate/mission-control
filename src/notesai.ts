/* /help inside a note, through the same Groq key Break It Down already asks
   for in Settings (ai.ts). One command for the three things he asked for:
   drafting new text, tightening what is already there, and looking
   something up. groq/compound-mini decides which, and can reach for its own
   built-in web_search tool when the answer depends on something current or
   specific rather than something it already knows.

   Groq does not document the response shape a tool call leaves behind (no
   separate citations field to read), so sourcing is asked for in the
   answer itself: end with a line reading exactly "Sources:" and a link per
   page actually read, only when the web was actually used. That is also
   the more honest contract: nothing here is real unless the model says so
   in words, not a field this code has to trust blindly. */

import { detectLang, getAiKey, groq, stripReasoning } from './ai'

const MODEL = 'groq/compound-mini'

export type HelpResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'no-key' | 'bad-key' | 'rate-limit' | 'failed' }

function systemFor(lang: 'cs' | 'en'): string {
  return `You help him write inside a personal note. He triggers you by typing "/help <request>" on its own line inside the note; that line is his instruction to you, never content to keep.

Three things this can mean. Decide which from the instruction:
- Write: draft new text for the note.
- Polish: tighten or improve text already in the note, only when he is clearly pointing at something already there.
- Search: look something up. Use the web_search tool whenever the answer depends on something current, specific, or that you are not already sure of.

Rules:
- Reply with ONLY what replaces the /help line. No preamble ("Sure, here's..."), no describing what you did, no closing offer of more help.
- Write in ${lang === 'cs' ? 'CZECH' : 'ENGLISH'}, matching the rest of the note.
- Plain prose, with markdown bullets or a heading only where they genuinely help. No em dashes: commas or periods instead.
- Never invent a fact, a number, or a source. If you are not sure, say one honest sentence about that instead of guessing.
- If, and only if, you used the web to answer, end with a line reading exactly "Sources:" followed by one bare URL per page you actually read, one per line, name and all: "Oat milk basics: https://...". This note's markdown only auto-links a bare URL, not [text](url), so a link written any other way would show as dead text. Skip the whole line when you did not search.`
}

export async function helpWithNote(instruction: string, noteSoFar: string): Promise<HelpResult> {
  const key = getAiKey()
  if (!key) return { ok: false, reason: 'no-key' }
  try {
    const res = await groq({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemFor(detectLang(instruction || noteSoFar)) },
        { role: 'user', content: `Note so far, as markdown (may still include the /help line itself; that line is the instruction below, not content):\n\n${noteSoFar}\n\nHis instruction: ${instruction}` },
      ],
    }, key)
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'bad-key' }
    if (res.status === 429) return { ok: false, reason: 'rate-limit' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const data = await res.json()
    const text = stripReasoning(data.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'failed' }
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
