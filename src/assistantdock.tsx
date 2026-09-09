/* THE FLOATING ASSISTANT.

   His first correction (2026-09-08): the first pass moved Assistant into the
   dock as a plain shortcut, the same shape Focus already used -- one tap
   straight to the full page. Wrong half of the ask. He wanted what Note,
   Bills and Timeline already do: a SHORT tap opens a real quick-ask widget
   right here in the popup, and only a LONG PRESS goes to the full page.

   His second correction, same day, after that widget shipped text-first:
   the quick tap should be "primarily voice" -- he wants to talk to it, hands
   free, the way he would say "open up Big Time, show me what I have today"
   out loud rather than type it. So Talk is the one big thing this panel
   opens on, voice mode itself is the real, continuous kind (VoicePanel, the
   same loop the full page uses -- it keeps listening turn after turn, not
   one utterance and done), and it can act on the real app exactly like the
   full page can, workspace switch and all: "mark it done, took me fifteen
   minutes" logs that exact number through the same logActual path the
   manual follow-up button already uses, in one sentence, no second prompt.

   useAssistantThread and useVoiceGlue (assistantcore.tsx) are the real
   send()/voice logic, extracted untouched so this panel and the full page
   share one implementation, never a second copy that quietly drifts from
   the first. What stays page-only is the canvas cards and typed dictation --
   both still need a whole page to do properly, and a 560px popup showing a
   worse version of either is the mistake Bills' and Timeline's own panels
   were built to avoid repeating. Talk to it, read the small chat it leaves
   behind, act on the real app -- that is the whole quick version, and voice
   is the front door into it now, not a button buried in a footer. */

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { MORNING, SKILLS } from './assistant'
import { Mark, Speak, useAssistantThread, useVoiceGlue, VoicePanel } from './assistantcore'
import { voiceModeAvailable } from './voicemode'
import { ActualLog } from './plan'
import * as Icon from './icons'

export function AssistantChip() {
  // A conversation has no single glanceable fact the way a running timer or
  // a wallet balance does, so the collapsed chip is the same plain icon the
  // switch header inside the open panel already uses.
  return <Icon.Waveform size={22} />
}

export function AssistantPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { logActual } = useStore()
  const { turns, setTurns, busy, err, errHint, live, send: sendRaw } = useAssistantThread()
  const [q, setQ] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const foot = useRef<HTMLDivElement>(null)

  const send = (text: string, shown?: string) => sendRaw(text, shown).then((r) => { box.current?.focus(); return r })
  /* 0: never hang up on silence alone in here -- his ask (2026-09-08). The
     session runs until he closes the panel, holds for the full page, or
     presses Done on the voice panel itself. */
  const { voice, startVoice, runSkill, endVoice } = useVoiceGlue(send, () => setQ(''), () => box.current?.focus(), 0)

  /* NOT autofocused on open the way the full page's box is. There, typing is
     the default mode and the caret belongs in the box the moment it opens;
     here voice is the front door (his ask), and a focused textarea below the
     Talk button pulled the browser's own scroll-into-view along with it,
     opening the panel already scrolled past Talk and onto the fallback
     input -- the opposite of "primarily voice". The box still gets focus
     the moment he actually uses it: after a send, and after voice hangs up. */
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])

  const submit = (text: string, shown?: string) => {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    void send(t, shown)
  }

  const logTaskActual = (turnIndex: number, doneIndex: number, taskId: string, minutes: number) => {
    logActual(taskId, minutes)
    setTurns((prev) => prev.map((t, ti) => (ti !== turnIndex
      ? t
      : { ...t, done: t.done?.map((d, di) => (di !== doneIndex ? d : { ...d, text: `${d.text} — ${minutes}m`, needsActual: undefined })) }
    )))
  }

  const empty = turns.length === 0 && !busy && !err

  return (
    <div className="assistantdock-panel">
      <div className="assistantdock-head">
        <span className="assistantdock-switch">
          <Icon.Waveform size={16} />
          Assistant
        </span>
        {/* Same door-out shape Note's own panel uses: bright on purpose, so
           the one control that leaves this quick exchange behind for the
           real page is never mistaken for a quiet toggle. */}
        <button className="btn btn-primary dock-open-btn" onClick={() => onOpenFull?.()} title="Open in Assistant">
          <Icon.ExternalLink size={13} />
          Assistant
        </button>
        {dockControls}
      </div>
      <div className="assistantdock-body">
        {voice ? (
          <VoicePanel onExit={endVoice} />
        ) : empty ? (
          <div className="assistantdock-open">
            {/* Voice is the front door here, on his ask -- one tap and it is
               listening, the same continuous back-and-forth the full page's
               own voice mode runs, not a single-shot capture. Typing and the
               skill grid below are still there for a library or a quiet
               room, but they are the second choice, not the first. */}
            <button type="button" className="assistantdock-talk" onClick={() => void startVoice()} disabled={busy}>
              <Mark state="idle" size={56} />
              <span className="assistantdock-talk-label">Talk</span>
            </button>
            <div className="as-skills">
              <button className="as-brief" onClick={() => void runSkill(MORNING)}>
                <Icon.Waveform size={16} />
                {MORNING.label}
              </button>
              {SKILLS.map((k) => (
                <button className="as-brief" key={k.label} onClick={() => void runSkill(k)}>
                  <Icon.Waveform size={16} />
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="as-thread assistantdock-thread">
            {turns.map((t, i) => (
              <div className={`as-turn is-${t.who}`} key={i}>
                <p className="as-said">{t.text}</p>
                {t.done?.length ? (
                  <ul className="as-did">
                    {t.done.map((d, k) => (
                      <li className={d.ok ? 'is-ok' : 'is-no'} key={k}>
                        {d.ok ? null : <span className="as-did-head">Nothing changed, </span>}
                        {d.text}
                        {d.needsActual ? (
                          <ActualLog
                            est={d.needsActual.est}
                            onLog={(m) => logTaskActual(i, k, d.needsActual!.taskId, m)}
                            onSkip={() => logTaskActual(i, k, d.needsActual!.taskId, d.needsActual!.est)}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {t.who === 'it' && t.text.trim() ? (
                  <div className="as-pulled">
                    <Speak id={`dock-t${i}`} text={t.text} />
                  </div>
                ) : null}
                {t.reply?.next && t.reply.next.length > 0 && (
                  <div className="as-next">
                    {t.reply.next.map((n, k) => (
                      <button className="as-chip" key={k} onClick={() => submit(n)}>{n}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <p className="as-thinking" role="status">
                {live || 'Thinking'}
              </p>
            )}
            {err && (
              <div className="as-error">
                <p>{err}</p>
                {errHint && <p className="as-error-hint">{errHint}</p>}
              </div>
            )}
            <div ref={foot} />
          </div>
        )}
        {!voice && (
          <form
            className="as-ask assistantdock-ask"
            onSubmit={(e) => { e.preventDefault(); submit(q) }}
          >
            <textarea
              ref={box}
              className="as-input"
              value={q}
              rows={1}
              placeholder="Ask anything about your week"
              aria-label="Ask the assistant"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(q) } }}
            />
            {/* A row, not two more direct children of .as-ask: that class is
               a column flex (textarea stacked over its footer on the full
               page), so a voice button and Ask dropped straight in here each
               took the row's full width and stacked, one under the other --
               the squashed layout he flagged. .as-ask-foot is the same
               footer row the full page already wraps these in. */}
            <div className="as-ask-foot assistantdock-ask-foot">
              {voiceModeAvailable() && !empty && (
                <button
                  type="button" className="as-voice-btn" onClick={() => void startVoice()} disabled={busy}
                  aria-label="Talk"
                  title="Talk to it, and it talks back. It keeps listening until you are done."
                >
                  <Icon.Waveform size={15} />
                </button>
              )}
              <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Ask</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
