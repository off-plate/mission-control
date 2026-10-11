/* IDEAS / PROMPTS. One header button, two faces (his ask, 2026-10-04): general
   ideas on the sticky board, and prompts for the next Claude session. The page
   title is the switch, both words at heading size, the open one in ink and the
   other faded, with a short line under the open one that slides across. Picked
   from three options in claude.ai/artifact/Kvu4M8cySS4avUZmEURxGk.

   The header button opens whichever face he used last, and Prompts whenever
   the window is open and something is waiting (the dot says so). */
import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { usePromptWindow } from './promptwindow'

type Face = 'ideas' | 'prompts'
const KEY = 'mc-ideas-face'
let slideFrom: Face | null = null

export function lastFace(): Face {
  try { return localStorage.getItem(KEY) === 'prompts' ? 'prompts' : 'ideas' } catch { return 'ideas' }
}

/** True while Claude's window is open and at least one prompt is unsent. */
export function usePromptsReady(): boolean {
  const { prompts } = useStore()
  const waiting = prompts.filter((p) => !p.sentAt).length
  return usePromptWindow(waiting).state === 'open' && waiting > 0
}

/** Each word carries its own count on both faces, so flipping moves nothing
 *  but the line, and a number never reads as the other face's. */
export function IdeasSwitch({ face }: { face: Face }) {
  const { setPage, ideaBoard, prompts } = useStore()
  const ideasN = ideaBoard.filter((c) => !c.doneAt).length
  const promptsN = prompts.filter((p) => !p.sentAt).length
  const ready = usePromptsReady()
  const box = useRef<HTMLSpanElement>(null)
  const [line, setLine] = useState<{ x: number; w: number } | null>(null)

  useLayoutEffect(() => {
    try { localStorage.setItem(KEY, face) } catch { /* private mode */ }
    const at = (sel: string) => {
      const b = box.current?.querySelector<HTMLElement>(`${sel} .ips-w`)
      return b ? { x: (b.parentElement as HTMLElement).offsetLeft + b.offsetLeft, w: b.offsetWidth } : null
    }
    const measure = () => { const l = at('[aria-pressed="true"]'); if (l) setLine(l) }
    /* Each face is its own page, so the switch remounts. When he got here by
       the switch, start the line under the word he left and let it travel. */
    if (slideFrom && slideFrom !== face) {
      setLine(at('[aria-pressed="false"]'))
      requestAnimationFrame(() => requestAnimationFrame(measure))
    } else measure()
    slideFrom = null
    void document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [face])

  const pick = (f: Face) => { if (f !== face) { slideFrom = face; setPage(f) } }
  return (
    <span className="ips" ref={box} role="group" aria-label="Ideas or Prompts">
      <button type="button" aria-pressed={face === 'ideas'} onClick={() => pick('ideas')}><span className="ips-w">Ideas</span><span className="ips-n">{ideasN}</span></button>
      <button type="button" aria-pressed={face === 'prompts'} onClick={() => pick('prompts')}>
        <span className="ips-w">Prompts</span>
        <span className="ips-n">{promptsN}</span>
        {ready && <i className="ips-dot" aria-label="Claude window open, prompts waiting" />}
      </button>
      {line && <i className="ips-line" aria-hidden="true" style={{ width: line.w, transform: `translateX(${line.x}px)` }} />}
    </span>
  )
}
