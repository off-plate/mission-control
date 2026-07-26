/* Data for the Morning routine.
   - Tongue twisters: full sentences (never two-word fragments), split into two
     groups A and B that alternate day to day, with a date-driven rotation so the
     three shown are different every morning.
   - News: today's real EN + CZ AI-news paragraphs, written each morning by the
     GitHub Action into docs/data/morning.json and read at runtime. A neutral
     fallback covers the case where the file has not been generated yet. */

export interface Twister {
  lang: 'cs' | 'en'
  text: string
}

/* Group A and Group B. Each is a mix of Czech and English full sentences.
   Real, well-known tongue twisters, not fragments. */
const GROUP_A: Twister[] = [
  { lang: 'cs', text: 'Tři sta třicet tři stříbrných stříkaček stříkalo přes tři sta třicet tři stříbrných střech.' },
  { lang: 'en', text: 'Peter Piper picked a peck of pickled peppers; a peck of pickled peppers Peter Piper picked.' },
  { lang: 'cs', text: 'Šla Prokopka pro kopr, přiletěla vrána, hrr na ně, a Prokopka už kopr nedokopala.' },
  { lang: 'en', text: 'She sells seashells by the seashore, and the shells she sells are surely seashells for sure.' },
  { lang: 'cs', text: 'Naše lokomotiva se pomalu rozjížděla, rozháněla, rozeřvala a nakonec celá rozdrnčela.' },
  { lang: 'en', text: 'How much wood would a woodchuck chuck if a woodchuck could chuck wood all day long?' },
]

const GROUP_B: Twister[] = [
  { lang: 'cs', text: 'Kmotře Petře, nepřepepřete mi toho vepře, ať si toho přepepřeného vepře nemusíte sníst sám.' },
  { lang: 'en', text: 'Betty Botter bought some butter, but the butter was bitter, so she bought better butter to make the bitter butter better.' },
  { lang: 'cs', text: 'Byla jednou jedna vrána, prasklá vrátka vrátila, vzala vrátka do zobáčku a zpátky na vrata je vrátila.' },
  { lang: 'en', text: 'A proper copper coffee pot is the thing they say you ought to get for making proper coffee.' },
  { lang: 'cs', text: 'Rád rytíř řinčí řetězem, řinčí řetězem rád rytíř, a řinčí a řinčí a řinčí dál.' },
  { lang: 'en', text: 'Round the rugged rocks the ragged rascal ran, and he ran, and he ran, and he ran again.' },
]

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

/** Three full-sentence tongue twisters for the given day. Group A and B alternate
 *  by day; the window rotates so consecutive mornings never repeat the same set. */
export function twistersForDay(d = new Date()): { group: 'A' | 'B'; items: Twister[] } {
  const doy = dayOfYear(d)
  const group = doy % 2 === 0 ? 'A' : 'B'
  const pool = group === 'A' ? GROUP_A : GROUP_B
  const offset = Math.floor(doy / 2) % pool.length
  const items = [0, 1, 2].map((i) => pool[(offset + i) % pool.length])
  return { group, items }
}

export interface MorningNewsItem {
  text: string
  source: string
  url: string
}
export interface MorningNews {
  date: string
  en: MorningNewsItem
  cs: MorningNewsItem
}

/* Neutral, honest fallback used only if the morning file has not been generated.
   Deliberately evergreen, not a fake headline. */
export const FALLBACK_NEWS: MorningNews = {
  date: '',
  en: {
    text: 'Today’s fresh item has not been fetched yet. Read this aloud to warm up: clear speech is slow speech, so take each sentence at half the pace you think you need, and let every consonant land before you move to the next word.',
    source: 'warm-up',
    url: '',
  },
  cs: {
    text: 'Dnešní čerstvá zpráva se ještě nenačetla. Přečti nahlas na rozehřátí: mluv pomaleji, než ti přijde přirozené, a nech každou souhlásku doznít, než přejdeš k dalšímu slovu.',
    source: 'rozehřátí',
    url: '',
  },
}

/** Load today's news paragraphs written by the morning Action; fall back cleanly. */
export async function loadMorningNews(): Promise<MorningNews> {
  try {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
    const res = await fetch(`${base}data/morning.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error('no morning file')
    const data = (await res.json()) as MorningNews
    if (!data?.en?.text || !data?.cs?.text) throw new Error('malformed morning file')
    return data
  } catch {
    return FALLBACK_NEWS
  }
}
