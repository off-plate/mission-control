/* THE GYM GOALS on the Health page. Deleting buries the row like every other
   deletion, so a device that hasn't heard about it yet can't merge it back. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { GymGoal } from '../types'
import { newId } from './shared'

export type GymGoalInput = Pick<GymGoal, 'name' | 'goal' | 'unit' | 'metric'> & Partial<Pick<GymGoal, 'exerciseName' | 'current' | 'note' | 'lowerIsBetter'>>
type GymGoalPatch = Partial<Pick<GymGoal, 'name' | 'current' | 'goal' | 'unit' | 'metric' | 'exerciseName' | 'note' | 'lowerIsBetter'>>

export interface GymSlice {
  gymGoals: GymGoal[]
  setGymGoals: (next: GymGoal[]) => void
  addGymGoal: (g: GymGoalInput) => string
  updateGymGoal: (id: string, patch: GymGoalPatch) => void
  deleteGymGoal: (id: string) => void
}

export function useGymSlice(
  persisted: { gymGoals?: GymGoal[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): GymSlice {
  const { armUndo, bury, digUp } = deps
  const [gymGoals, setGymGoals] = useState<GymGoal[]>(persisted?.gymGoals ?? [])

  const addGymGoal = (g: GymGoalInput): string => {
    const id = newId('gymgoal')
    const now = Date.now()
    setGymGoals((prev) => [...prev, { id, ...g, name: g.name.trim(), unit: g.unit.trim(), createdAt: now, updatedAt: now }])
    return id
  }

  const updateGymGoal = (id: string, patch: GymGoalPatch): void =>
    setGymGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g)))

  const deleteGymGoal = (id: string): void => {
    const before = gymGoals
    setGymGoals((prev) => prev.filter((g) => g.id !== id))
    bury(rowKey('gymGoals', { id }))
    armUndo('Goal removed', () => { setGymGoals(before); digUp(rowKey('gymGoals', { id })) })
  }

  return { gymGoals, setGymGoals, addGymGoal, updateGymGoal, deleteGymGoal }
}
