/* What the Ideas board shares with anything else that captures an idea: the
   sticky palette and the dictation button. The dock's quick-add left with
   Ideas' dock item (2026-09-15); the board is reached from the top right. */
import { useEffect, useRef, useState } from 'react'
import {
  cancel as cancelDictation, dictateState, dictationAvailable, dictationEngine,
  subscribe, toggle as toggleDictation, type DictateState,
} from './dictation'
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
