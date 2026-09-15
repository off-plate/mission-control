/* THE FLOATING IDEAS GLANCE. The dock panel answers one question: "I just had
   one, where does it go?" So the panel is a single line he can type or talk
   into, and it lands on the board in the next free spot. Arranging them is
   the board's job, where there is room to.

   The sticky palette and the dictation button live here too, because the board
   page is lazy and the dock is not: the board imports them from here rather
   than the other way round. */
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import {
  cancel as cancelDictation, dictateState, dictationAvailable, dictationEngine,
  subscribe, toggle as toggleDictation, type DictateState,
} from './dictation'
import { nextIdeaSpot } from './store/ideaboard'
import * as Icon from './icons'

/* Paper, not UI colour: a sticky keeps its own colour and dark ink in every
   theme, the way a real one looks the same in a dark room and a light one. */
export const IDEA_COLORS: { id: string; bg: string; label: string }[] = [
  { id: 'amber', bg: '#f6e3b0', label: 'Amber' },
  { id: 'coral', bg: '#f3cbbd', label: 'Coral' },
  { id: 'green', bg: '#d3e2c3', label: 'Green' },
  { id: 'blue', bg: '#c8d8e8', label: 'Blue' },
  { id: 'clay', bg: '#e6d5c2', label: 'Clay' },
]
export const ideaBg = (id: string): string => (IDEA_COLORS.find((c) => c.id === id) ?? IDEA_COLORS[0]).bg

function useDictate(): DictateState {
  const [s, setS] = useState<DictateState>(dictateState())
  useEffect(() => subscribe(() => setS(dictateState())), [])
  return s
}

/** Dictation is one microphone for the whole app. A form with more than one
 *  field has to know which of its fields holds it, so the words go into the
 *  box he tapped and the button that is lit is the one he pressed. */
export function useFieldDictation<K extends string>() {
  const state = useDictate()
  const [owner, setOwner] = useState<K | null>(null)
  const ownerRef = useRef<K | null>(null)
  ownerRef.current = owner
  useEffect(() => { if (state === 'idle') setOwner(null) }, [state])
  /* Leaving the form with the mic open must not keep writing into a box that
     no longer exists. Only if this form was the one holding it. */
  useEffect(() => () => { if (ownerRef.current) cancelDictation() }, [])
  const start = (field: K, current: string, onText: (t: string) => void): void => {
    if (owner && owner !== field && state !== 'idle') cancelDictation()
    setOwner(field)
    toggleDictation(current, onText)
  }
  const stopAll = (): void => { if (ownerRef.current && dictateState() !== 'idle') cancelDictation() }
  return { state, owner, start, stopAll }
}

export function MicButton({ on, busy, label, onClick }: { on: boolean; busy: boolean; label: string; onClick: () => void }) {
  if (!dictationAvailable()) return null
  const title = on
    ? (busy ? 'Writing it out' : 'Listening. Tap to stop')
    : dictationEngine() === 'whisper' ? `${label} (Groq Whisper)` : label
  return (
    <button
      type="button"
      className={`ib-mic${on ? ' is-on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? 'Stop dictating' : label}
      title={title}
    >
      <Icon.Mic size={16} />
    </button>
  )
}

export function IdeasChip() {
  return <Icon.DockBulb size={22} />
}

export function IdeasPanel({ dockControls, onOpenFull }: { dockControls?: ReactNode; onOpenFull?: () => void }) {
  const { setPage, ideaBoard, addIdeaCard } = useStore()
  const [title, setTitle] = useState('')
  const [added, setAdded] = useState<string | null>(null)
  const dict = useFieldDictation<'title'>()
  const recent = [...ideaBoard].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)

  const open = () => { dict.stopAll(); setPage('ideas'); onOpenFull?.() }
  const add = () => {
    const t = title.trim()
    if (!t) return
    dict.stopAll()
    addIdeaCard({ title: t, ...nextIdeaSpot(ideaBoard) })
    setTitle('')
    setAdded(t)
  }

  return (
    <div className="billsdock-panel">
      <div className="billsdock-head">
        <span className="billsdock-title">Ideas</span>
        <button className="btn btn-primary dock-open-btn" onClick={open} title="Open the Ideas board">
          <Icon.ExternalLink size={13} />
          Board
        </button>
        {dockControls}
      </div>
      <div className="billsdock-body">
        <form className="wldock-ask" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input
            className="wldock-input"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setAdded(null) }}
            placeholder="What’s the idea?"
            aria-label="Idea name"
            maxLength={140}
          />
          <MicButton
            on={dict.owner === 'title'}
            busy={dict.state === 'transcribing'}
            label="Dictate the idea"
            onClick={() => dict.start('title', title, (t) => { setTitle(t); setAdded(null) })}
          />
          <button className="wldock-go" type="submit" disabled={!title.trim()}>Add</button>
        </form>
        {added && <p className="wldock-note">On the board: {added}</p>}

        {recent.length > 0 && (
          <div className="wldock-recent">
            {recent.map((c) => (
              <button key={c.id} className="wldock-row" onClick={open} title={c.title}>
                <i className="ibd-dot" style={{ background: ideaBg(c.color) }} aria-hidden="true" />
                <span>{c.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
