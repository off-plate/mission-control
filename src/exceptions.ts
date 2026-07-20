import type { SpaceId } from './types'

export { SPACE_LABELS, MOCK_AGENDA } from './mock'

export interface ExceptionItem {
  id: string
  text: string
  when: string
  action?: 'coach' | 'add-task'
  coachId?: string
  actionLabel?: string
  task?: { title: string; estimateMin: number }
}

function daysToFriday(): number {
  const day = new Date().getDay() // Sun=0..Sat=6
  return ((5 - day) + 7) % 7 || 7
}

const PERSONAL: ExceptionItem[] = [
  { id: 'x1', text: 'Installment 2 400 Kč due Friday. Not sent yet.', when: `in ${daysToFriday()} days`, action: 'add-task', actionLabel: 'Add the transfer to today', task: { title: 'Send the 2 400 Kč installment', estimateMin: 5 } },
  { id: 'x2', text: 'Datová schránka unchecked for 8 days. Sunday rule slipped.', when: '8 days', action: 'coach', coachId: 'datova-schranka' },
]

const OFFPLATE: ExceptionItem[] = [
  { id: 'x3', text: 'Workshop lead from Thursday still has no reply.', when: '3 days', action: 'coach', coachId: 'chase-supplier', actionLabel: 'Draft the follow-up' },
]

export function MOCK_EXCEPTIONS_FOR(space: SpaceId | string): ExceptionItem[] {
  if (space === 'personal') return PERSONAL
  if (space === 'offplate') return OFFPLATE
  return []
}
