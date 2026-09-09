/* THE APP'S SHARED TYPES, split by domain (2026-09-09) -- this used to be one
   1,331-line types.ts holding 58 exports across 14+ unrelated domains, with
   the same everything-touches-this-file blast radius as store.tsx.

   This file is a barrel only: every real declaration lives in one of the
   domain files below, and every external `from './types'` import keeps
   working unchanged, because TypeScript and Vite both resolve that specifier
   to this index.ts automatically. Nothing outside this directory had to
   change.

   Dependency order, so a future addition knows which way an import may run:
   core -> contacts (standalone)
   core -> habits (needs SpaceId, TimeSlot)
   core, habits -> goals (needs HabitDef etc. for goalCurrent)
   core, goals -> tasks (needs GoalTimeframe for Task.horizon)
   core -> notes
   core, tasks -> coach (needs TaskCategory)
   core, tasks -> misc (needs TaskCategory, PageId)
   Never the other direction -- core imports nothing, habits never imports
   goals/tasks, goals never imports tasks. Keeping it one-way is what keeps
   eight files from becoming one cycle. */
export * from './core'
export * from './tasks'
export * from './contacts'
export * from './habits'
export * from './goals'
export * from './notes'
export * from './coach'
export * from './misc'
