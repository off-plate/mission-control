import type { SpaceId, TaskCategory } from './core'

/** The factual look at an avoided thing: what it is, what it takes, what ignoring it costs. */
export interface CoachFacts {
  avoiding: string
  steps: string
  cost: string
}

/** A common avoided thing, pre-drafted so Coach can start from a real example. */
export interface CoachScenario {
  id: string
  title: string
  tag: string
  blurb: string
  facts: CoachFacts
  firstStep: string
  firstStepMin: number
  category: TaskCategory
}

/** A thing you actually faced: the facts you named, the first step you took, and,
 *  once you check back, whether you did it and how it really felt. */
export interface CoachSession {
  id: string
  /** Profile the loop was opened in (older sessions have none and show everywhere). */
  space?: SpaceId
  title: string
  facts: CoachFacts
  firstStep: string
  taskId: string | null
  when: string
  status: 'open' | 'closed'
  didIt?: boolean
  felt?: 'easier' | 'as-feared' | 'harder'
  reflection?: string
}

