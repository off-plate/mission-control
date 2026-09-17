/* Which name day belongs to someone, from the first word of their name.
   Diacritics and case are ignored, so "Ondrej" finds Ondřej, and the common
   Czech short forms are mapped to the name they come from. Anything this
   cannot find, he names himself on the person's card. */
import { NAME_DAYS } from './namedays-data'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const BY_NAME = new Map<string, { name: string; day: string }>()
for (const [day, names] of Object.entries(NAME_DAYS)) {
  for (const name of names) if (!BY_NAME.has(fold(name))) BY_NAME.set(fold(name), { name, day })
}
export const ALL_NAMES: string[] = [...new Set(Object.values(NAME_DAYS).flat())].sort((a, b) => a.localeCompare(b, 'cs'))

/* Short form to the calendar name. Only forms that point one way. */
const SHORT: Record<string, string> = {
  honza: 'Jan', jenda: 'Jan', kuba: 'Jakub', ondra: 'Ondřej', pepa: 'Josef', franta: 'František',
  tonda: 'Antonín', vlada: 'Vladimír', standa: 'Stanislav', jirka: 'Jiří', jarda: 'Jaroslav',
  mira: 'Miroslav', vojta: 'Vojtěch', filda: 'Filip', kaja: 'Karel', tom: 'Tomáš', tomik: 'Tomáš',
  vasek: 'Václav', venca: 'Václav', lukin: 'Lukáš', martas: 'Martin', mates: 'Matěj', ota: 'Otakar',
  veru: 'Veronika', verca: 'Veronika', verunka: 'Veronika', terka: 'Tereza', klarka: 'Klára',
  katka: 'Kateřina', kata: 'Kateřina', bara: 'Barbora', barca: 'Barbora', anca: 'Anna', anicka: 'Anna',
  lucka: 'Lucie', zuzka: 'Zuzana', kristynka: 'Kristýna', nikca: 'Nikola', janca: 'Jana', janicka: 'Jana',
  majda: 'Magdaléna', madla: 'Magdaléna', marus: 'Marie', maruska: 'Marie', evca: 'Eva', evicka: 'Eva',
  hanka: 'Hana', hanca: 'Hana', dasa: 'Dagmar', misa: 'Michal',
  elis: 'Eliška', eli: 'Eliška', simca: 'Simona', lenka: 'Lenka', petka: 'Petra', jitka: 'Jitka',
}

export type NameDay = { name: string; day: string }

/** The calendar name and its MM-DD, or null. `asName` is his own override. */
export function nameDayFor(fullName: string, asName?: string): NameDay | null {
  const pick = (w: string) => {
    const key = fold(w)
    return BY_NAME.get(key) ?? (SHORT[key] ? BY_NAME.get(fold(SHORT[key])) : undefined) ?? null
  }
  if (asName && asName.trim()) return pick(asName)
  const first = fullName.trim().split(/\s+/)[0] ?? ''
  return first ? pick(first) : null
}

/** Days from `today` (YYYY-MM-DD) to the next time `mmdd` comes round; 0 is today.
 *  29 February falls on 28 February in years without it. */
export function daysUntil(mmdd: string, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number)
  const [m, d] = mmdd.split('-').map(Number)
  const t = Date.UTC(ty, tm - 1, td)
  const on = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    return Date.UTC(y, m - 1, m === 2 && d === 29 && !leap ? 28 : d)
  }
  const next = on(ty) >= t ? on(ty) : on(ty + 1)
  return Math.round((next - t) / 86_400_000)
}
