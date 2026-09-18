/* Where a new person lands on the molecule, shared between the People page's
   own "+" (people.tsx) and the assistant's addPerson action -- one person
   added by dictation and one added by hand land the same way, on the same
   ring, never a duplicate placement rule that could drift from the real one. */
import type { Person, PersonTier } from './types'

/** Each circle's own radius -- the UI's TIERS table (people.tsx) also carries
 *  label/dot-size/bond-thickness for rendering, which the assistant never
 *  needs; this is only the number placement actually depends on. */
export const TIER_RADIUS: Record<PersonTier, number> = {
  core: 150, close: 255, friends: 355, business: 450, wider: 545, distant: 640,
}

/** How often he wants to be in touch, by circle, when nothing else says
 *  otherwise -- the same defaults the People page's own tier picker uses. */
export const TIER_CADENCE: Record<PersonTier, number> = {
  core: 7, close: 14, friends: 30, business: 30, wider: 90, distant: 365,
}

/** The same names the People page's own tier picker shows -- used by the
 *  assistant to name a circle back to him in a sentence. */
export const TIER_LABEL: Record<PersonTier, string> = {
  core: 'inner circle', close: 'close', friends: 'friends', business: 'business', wider: 'wider circle', distant: 'distant',
}

/** The widest free gap on that tier's ring, so a newcomer never lands on top
 *  of someone already there. */
export function nextPersonSlot(people: Person[], tier: PersonTier): { x: number; y: number } {
  const r = TIER_RADIUS[tier]
  const angles = people.filter((p) => p.tier === tier).map((p) => Math.atan2(p.y, p.x)).sort((a, b) => a - b)
  let a = -Math.PI / 2
  let best = -1
  angles.forEach((cur, i) => {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2
    if (next - cur > best) { best = next - cur; a = cur + (next - cur) / 2 }
  })
  return { x: Math.cos(a) * r, y: Math.sin(a) * r }
}
