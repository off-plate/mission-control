import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_SPACES,
  MOCK_HABITS,
  MOCK_LEDGER,
  MOCK_TASKS,
  WIDGET_DEFS,
} from './mock'
import type { Habit, LedgerEntry, SizeKey, SpaceId, Task, WidgetInstance, WidgetType } from './types'

const STORAGE_KEY = 'mission-control-demo-v1'

interface PersistedState {
  version: 1
  spaces: Record<SpaceId, WidgetInstance[]>
  tasks: Task[]
  habits: Habit[]
  ledger: LedgerEntry[]
}

interface Store extends PersistedState {
  space: SpaceId
  setSpace: (s: SpaceId) => void
  theme: 'light' | 'dark'
  toggleTheme: () => void
  editing: boolean
  setEditing: (v: boolean) => void

  reorderSpace: (space: SpaceId, order: string[]) => void
  resizeWidget: (space: SpaceId, id: string, size: SizeKey) => void
  removeWidget: (space: SpaceId, id: string) => void
  addWidget: (space: SpaceId, type: WidgetType) => void
  moveWidget: (space: SpaceId, id: string, dir: -1 | 1) => void

  toggleTask: (id: string) => void
  logActual: (id: string, actualMin: number) => void
  toggleHabit: (id: string) => void
  addTasks: (tasks: Task[]) => void

  savedMin: number
  accuracyPct: number
  resetDemo: () => void
}

const Ctx = createContext<Store | null>(null)

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PersistedState
    return p.version === 1 ? p : null
  } catch {
    return null
  }
}

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let uid = 100

export function StoreProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadPersisted, [])
  const [spaces, setSpaces] = useState(persisted?.spaces ?? DEFAULT_SPACES)
  const [tasks, setTasks] = useState(persisted?.tasks ?? MOCK_TASKS)
  const [habits, setHabits] = useState(persisted?.habits ?? MOCK_HABITS)
  const [ledger, setLedger] = useState(persisted?.ledger ?? MOCK_LEDGER)
  const [space, setSpace] = useState<SpaceId>('personal')
  const [editing, setEditing] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(systemTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const state: PersistedState = { version: 1, spaces, tasks, habits, ledger }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* demo only; the real app persists to Supabase */
    }
  }, [spaces, tasks, habits, ledger])

  const savedMin = ledger.reduce((acc, e) => acc + Math.max(0, e.estimateMin - e.actualMin), 0)
  const accuracyPct = Math.round(
    (ledger.filter((e) => Math.abs(e.actualMin - e.estimateMin) <= e.estimateMin * 0.25).length /
      Math.max(1, ledger.length)) * 100,
  )

  const value: Store = {
    version: 1,
    spaces, tasks, habits, ledger,
    space, setSpace,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    editing, setEditing,

    reorderSpace: (sp, order) =>
      setSpaces((prev) => {
        const byId = new Map(prev[sp].map((w) => [w.id, w]))
        const next = order.map((id) => byId.get(id)).filter(Boolean) as WidgetInstance[]
        for (const w of prev[sp]) if (!order.includes(w.id)) next.push(w)
        return { ...prev, [sp]: next }
      }),

    resizeWidget: (sp, id, size) =>
      setSpaces((prev) => ({
        ...prev,
        [sp]: prev[sp].map((w) => (w.id === id ? { ...w, size } : w)),
      })),

    removeWidget: (sp, id) =>
      setSpaces((prev) => ({ ...prev, [sp]: prev[sp].filter((w) => w.id !== id) })),

    addWidget: (sp, type) =>
      setSpaces((prev) => ({
        ...prev,
        [sp]: [...prev[sp], { id: `${type}-${++uid}`, type, size: WIDGET_DEFS[type].defaultSize }],
      })),

    moveWidget: (sp, id, dir) =>
      setSpaces((prev) => {
        const list = [...prev[sp]]
        const i = list.findIndex((w) => w.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return prev
        ;[list[i], list[j]] = [list[j], list[i]]
        return { ...prev, [sp]: list }
      }),

    toggleTask: (id) =>
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),

    logActual: (id, actualMin) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: true, actualMin } : t)))
      const t = tasks.find((x) => x.id === id)
      if (t && t.actualMin === undefined) {
        setLedger((prev) => [
          { id: `l-${++uid}`, title: t.title, estimateMin: t.estimateMin, actualMin, when: 'now' },
          ...prev,
        ])
      }
    },

    toggleHabit: (id) =>
      setHabits((prev) => prev.map((h) => (h.id === id ? { ...h, done: !h.done } : h))),

    addTasks: (ts) => setTasks((prev) => [...ts, ...prev]),

    savedMin,
    accuracyPct,
    resetDemo: () => {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
      location.reload()
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside provider')
  return s
}
