/* PROJECT HASHTAGS (his ask, 2026-10-25). Every project answers to a hashtag,
   so filing a task is typing `#offplate` while writing it instead of opening
   a folder first. A tag is the project's handle, not a second store: the task
   still carries one projectId, and the hashtag is drawn from the project, so
   retagging a project retags every task on screen at once.

   Only a `#` at the start of a word counts. A URL's fragment
   (icloud.com/shortcuts/...#x) is never a tag, and neither is C#. */
import type { Project } from './types'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The default tag is the whole name, squashed: "Michael's Corner" ->
 *  "michaelscorner", "Masér" -> "maser". Never initials (his correction,
 *  2026-10-25: a hashtag is the project's name, not a shortcut). Diacritics
 *  dropped so Czech names are typeable on any keyboard. */
export function slugTag(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'project'
}

/** A tag he types himself keeps his own - and _ ("dodge-fixes"). */
export function cleanTag(want: string): string {
  return fold(want).replace(/^#+/, '').replace(/[^a-z0-9_-]+/g, '').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40)
}

/** Which of the six tag tones a project wears (his ask, 2026-10-25: tell
 *  tasks apart at a glance by their hashtag's colour). Handed out in project
 *  order, so the first six projects never share one. */
export const TAG_TONES = 6
export const toneOf = (p: Project, projects: Project[]): number => {
  const i = projects.findIndex((x) => x.id === p.id)
  return (i < 0 ? 0 : i) % TAG_TONES
}

/** A project's tag, without the `#`. Unset means "follow the name". */
export const tagOf = (p: Pick<Project, 'name' | 'tag'>): string => p.tag || slugTag(p.name)

/** What the user may type after `#`: letters in any script, digits, - and _. */
const TAG_CHAR = /[\p{L}\p{N}_-]/u

/** The hashtag being typed at the caret, if any: where its `#` sits and what
 *  follows it so far. */
export function activeTag(text: string, caret: number): { start: number; query: string } | null {
  let i = caret
  while (i > 0 && TAG_CHAR.test(text[i - 1])) i--
  if (i === 0 || text[i - 1] !== '#') return null
  const hash = i - 1
  if (hash > 0 && !/\s/.test(text[hash - 1])) return null
  return { start: hash, query: text.slice(i, caret) }
}

/** Projects that fit what has been typed so far, best first: tag prefix, then
 *  a word of the name, then anywhere in the tag. Empty query lists them all. */
export function matchProjects(query: string, projects: Project[]): Project[] {
  const q = fold(query).replace(/[^a-z0-9]/g, '')
  if (!q) return projects
  const rank = (p: Project) => {
    const tag = tagOf(p).replace(/[-_]/g, '')
    const words = fold(p.name).replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
    if (tag.startsWith(q)) return 0
    if (words.some((w) => w.startsWith(q))) return 1
    if (tag.includes(q)) return 2
    return -1
  }
  return projects
    .map((p, i) => ({ p, i, r: rank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p)
}

const HASHTAGS = /(^|\s)#([\p{L}\p{N}_-]+)/gu

/** Pulls the project hashtag out of a typed title. The first tag that names a
 *  project wins and is removed from the words (the row draws it from the
 *  project, so a retag can never leave a stale one behind). A hashtag that
 *  names no project stays in the title as plain text, the way Notes keeps
 *  its own tags. */
export function takeTag(text: string, projects: Project[]): { title: string; project?: Project } {
  let found: Project | undefined
  const title = text.replace(HASHTAGS, (whole, lead: string, word: string) => {
    if (found) return whole
    const hit = projects.find((p) => tagOf(p) === fold(word))
    if (!hit) return whole
    found = hit
    return lead
  })
  return { title: title.replace(/\s{2,}/g, ' ').trim(), project: found }
}

/** A tag no other project already answers to: "home" then "home2". `own`
 *  means he typed it, so his - and _ stay; otherwise it comes from a name. */
export function freeTag(want: string, projects: Project[], except?: string, own = false): string {
  const base = (own ? cleanTag(want) : '') || slugTag(want)
  const taken = new Set(projects.filter((p) => p.id !== except).map(tagOf))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}
