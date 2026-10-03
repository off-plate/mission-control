/* PROMPTS. The backlog of things to say to Claude once the usage window is
   open again. Its own synced collection, merged row by row like notes. Deleting
   buries the row so a device that has not heard cannot bring it back. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { PromptItem, PromptKind } from '../types'
import { newId } from './shared'

export type PromptInput = { project: string; session: string; kind: PromptKind; text: string }
type PromptPatch = Partial<Pick<PromptItem, 'project' | 'session' | 'kind' | 'text'>>

export interface PromptsSlice {
  prompts: PromptItem[]
  setPrompts: (next: PromptItem[]) => void
  addPrompt: (p: PromptInput) => string
  updatePrompt: (id: string, patch: PromptPatch) => void
  /** Mark it sent, or put it back in the queue. */
  setPromptSent: (id: string, sent: boolean) => void
  deletePrompt: (id: string) => void
}

export function usePromptsSlice(
  persisted: { prompts?: PromptItem[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): PromptsSlice {
  const { armUndo, bury, digUp } = deps
  const [prompts, setPrompts] = useState<PromptItem[]>(persisted?.prompts ?? [])

  const addPrompt = (p: PromptInput): string => {
    const id = newId('prompt')
    const now = Date.now()
    setPrompts((prev) => [...prev, {
      id, project: p.project.trim() || 'General', session: p.session.trim() || 'General', kind: p.kind,
      text: p.text.trim(), createdAt: now, updatedAt: now,
    }])
    return id
  }

  const updatePrompt = (id: string, patch: PromptPatch): void => setPrompts((prev) => prev.map((x) => (x.id === id
    ? {
      ...x, ...patch,
      ...(patch.project !== undefined ? { project: patch.project.trim() || 'General' } : {}),
      ...(patch.session !== undefined ? { session: patch.session.trim() || 'General' } : {}),
      updatedAt: Date.now(),
    }
    : x)))

  const setPromptSent = (id: string, sent: boolean): void => setPrompts((prev) => prev.map((x) => {
    if (x.id !== id) return x
    const { sentAt: _drop, ...rest } = x
    return { ...rest, ...(sent ? { sentAt: Date.now() } : {}), updatedAt: Date.now() }
  }))

  const deletePrompt = (id: string): void => {
    const before = prompts
    setPrompts((prev) => prev.filter((x) => x.id !== id))
    bury(rowKey('prompts', { id }))
    armUndo('Prompt deleted', () => { setPrompts(before); digUp(rowKey('prompts', { id })) })
  }

  return { prompts, setPrompts, addPrompt, updatePrompt, setPromptSent, deletePrompt }
}
