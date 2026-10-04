/* ASSISTANT LOG. Split out of store.tsx (2026-09-10). What voice dictation
   once created (a task, a goal, a "done"). The dictation actions that wrote
   it were never called and went 2026-10-04; the log stays because it is his
   synced data. */
import { useState } from 'react'
import type { AssistantEntry } from '../types'

export interface AssistantSlice {
  assistantLog: AssistantEntry[]
  setAssistantLog: (next: AssistantEntry[]) => void
}

export function useAssistantSlice(persisted: { assistantLog?: AssistantEntry[] } | null): AssistantSlice {
  const [assistantLog, setAssistantLog] = useState<AssistantEntry[]>(persisted?.assistantLog ?? [])
  return { assistantLog, setAssistantLog }
}
