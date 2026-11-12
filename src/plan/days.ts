import { dayPlus } from '../weekgrid'

export const prevDay = (): string => dayPlus(-1)

/** 'Friday, 28 August', for the title of the day panel. He asked (2026-08-28)
 *  for the date OUT of the day switcher's own header and onto the page title
 *  instead, in words rather than the switcher's short numerals. */

export const longDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** 'Today', 'Tomorrow', or 'Fri': the word for a pill in the day switcher. */

export const offsetWord = (n: number): string => {
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  const [y, m, d] = dayPlus(n).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' })
}

/** The date under the word, blank for Today/Tomorrow where the word already
 *  says enough and a number under it would be noise. */

export const offsetDate = (n: number): string => {
  if (n <= 1) return ''
  const [, , d] = dayPlus(n).split('-')
  return String(Number(d))
}
