/* THE FLOATING ASSISTANT.

   His correction (2026-09-08), twice over: the first pass moved Assistant
   into the dock as a plain shortcut, the same shape Focus already used --
   one tap straight to the full page. That was the wrong half of the ask. He
   wanted what Note, Bills and Timeline already do: a SHORT tap opens a real
   quick-ask widget right here in the popup, and only a LONG PRESS goes to
   the full page. "Long functionality fully" was the other half -- not a
   thinned-out copy of asking a question, the actual thing, rate-limit
   retries and provider-named errors and all.

   That is why this file exists rather than a smaller one: useAssistantThread
   (assistantpage.tsx) is the real send() logic, extracted untouched so this
   panel and the full page share the exact same behavior, never a second copy
   that quietly drifts from the first. What this panel does NOT carry is
   voice mode and the canvas cards -- both take a whole page to do properly,
   and a 560px popup showing a worse version of either is the identical
   mistake Bills' and Timeline's own panels were built to avoid making. Ask,
   read the answer, hear it, act on it, follow up -- that is the whole quick
   version, and it is genuinely all of it, not a preview of it. */

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { MORNING, SKILLS } from './assistant'
import { Mark, Speak, useAssistantThread } from './assistantcore'
import { ActualLog } from './pages1'
import * as Icon from './icons'

export function AssistantChip() {
  // A conversation has no single glanceable fact the way a running timer or
  // a wallet balance does, so the collapsed chip is the same plain icon the
  // switch header inside the open panel already uses.
  return <Icon.Waveform size={22} />
}

export function AssistantPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { logActual } = useStore()
  const { turns, setTurns, busy, err, errHint, live, send } = useAssistantThread()
  const [q, setQ] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const foot = useRef<HTMLDivElement>(null)

  useEffect(() => { box.current?.focus() }, [])
  useEffect(() => { foot.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns, busy])

  const submit = (text: string, shown?: string) => {
    const t = text.trim()
    if (!t || busy) return
    setQ('')
    void send(t, shown).then(() => box.current?.focus())
  }

  const logTaskActual = (turnIndex: number, doneIndex: number, taskId: string, minutes: number) => {
    logActual(taskId, minutes)
    setTurns((prev) => prev.map((t, ti) => (ti !== turnIndex
      ? t
      : { ...t, done: t.done?.map((d, di) => (di !== doneIndex ? d : { ...d, text: `${d.text} — ${minutes}m`, needsActual: undefined })) }
    )))
  }

  const empty = turns.length === 0

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
        {empty ? (
          <div className="assistantdock-open">
            <Mark state="idle" size={56} />
            <div className="as-skills">
              <button className="as-brief" onClick={() => submit(MORNING.ask, MORNING.label)}>
                <Icon.Waveform size={16} />
                {MORNING.label}
              </button>
              {SKILLS.map((k) => (
                <button className="as-brief" key={k.label} onClick={() => submit(k.ask, k.label)}>
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
          <button className="btn btn-primary as-send" disabled={busy || !q.trim()}>Ask</button>
        </form>
      </div>
    </div>
  )
}
