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

/** How many of each language you get every morning. */
export const PER_LANG = 3

/* Two groups that alternate day to day, and each group keeps Czech and English
   in separate pools. Drawing from each pool independently is what guarantees
   three of each, every morning, instead of three from a mixed bag. Every pool
   holds more than it needs so the window can rotate. */
const GROUP_A_CS: string[] = [
  'Tři sta třicet tři stříbrných stříkaček stříkalo přes tři sta třicet tři stříbrných střech.',
  'Šla Prokopka pro kopr, přiletěla vrána, hrr na ně, a Prokopka už kopr nedokopala.',
  'Naše lokomotiva se pomalu rozjížděla, rozháněla, rozeřvala a nakonec celá rozdrnčela.',
  'Strč prst skrz krk a nezakoktej se přitom ani jednou, ani podruhé, ani potřetí.',
  'Pštros s pštrosicí a s pštrosáčaty šli do pštrosárny, protože tam na ně čekala pštrosí snídaně.',
  'Od poklopu ku poklopu Kyklop kouli koulí, a když ji dokoulí, tak si od té koule oddechne.',
]
const GROUP_A_EN: string[] = [
  'Peter Piper picked a peck of pickled peppers; a peck of pickled peppers Peter Piper picked.',
  'She sells seashells by the seashore, and the shells she sells are surely seashells for sure.',
  'How much wood would a woodchuck chuck if a woodchuck could chuck wood all day long?',
  'Six slippery snails slid slowly seaward down the slick and slimy slope beside the harbour.',
  'Which witch switched the Swiss wristwatches while the watchmaker watched them being switched?',
  'Fresh French fried fly fritters are frying in the fryer that sits beside the freezer.',
]

const GROUP_B_CS: string[] = [
  'Kmotře Petře, nepřepepřete mi toho vepře, ať si toho přepepřeného vepře nemusíte sníst sám.',
  'Byla jednou jedna vrána, prasklá vrátka vrátila, vzala vrátka do zobáčku a zpátky na vrata je vrátila.',
  'Rád rytíř řinčí řetězem, řinčí řetězem rád rytíř, a řinčí a řinčí a řinčí dál.',
  'Nenaolejuje-li tě Julie, naolejuji tě já, protože naolejovaný člověk klouže po světě lépe.',
  'Petr Fletcher flétnu leštil, pilně leštil Petr Fletcher flétnu, dokud se ta flétna neleskla.',
  'Zaželezilo-li se železo, či nezaželezilo se železo, to je otázka pro každého kováře.',
]
const GROUP_B_EN: string[] = [
  'Betty Botter bought some butter, but the butter was bitter, so she bought better butter to make the bitter butter better.',
  'A proper copper coffee pot is the thing they say you ought to get for making proper coffee.',
  'Round the rugged rocks the ragged rascal ran, and he ran, and he ran, and he ran again.',
  'Red lorry, yellow lorry, red lorry, yellow lorry, said the driver rather wearily to himself.',
  'I scream, you scream, we all scream for ice cream on a hot and sticky summer afternoon.',
  'The thirty-three thieves thought that they thrilled the throne throughout Thursday evening.',
]

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

/** Rotate a window of `n` out of a pool, moved along by the day. */
function window(pool: string[], offset: number, n: number, lang: 'cs' | 'en'): Twister[] {
  return Array.from({ length: n }, (_, i) => ({ lang, text: pool[(offset + i) % pool.length] }))
}

/**
 * Today's tongue twisters: three Czech and three English, always. Group A and B
 * alternate day to day and the window rotates within each pool, so consecutive
 * mornings never hand you the same six.
 */
export function twistersForDay(d = new Date()): { group: 'A' | 'B'; cs: Twister[]; en: Twister[]; items: Twister[] } {
  const doy = dayOfYear(d)
  const group = doy % 2 === 0 ? 'A' : 'B'
  const [csPool, enPool] = group === 'A' ? [GROUP_A_CS, GROUP_A_EN] : [GROUP_B_CS, GROUP_B_EN]
  const step = Math.floor(doy / 2)
  const cs = window(csPool, step % csPool.length, PER_LANG, 'cs')
  // Offset the English window differently so the two languages do not move in lockstep.
  const en = window(enPool, (step * 2) % enPool.length, PER_LANG, 'en')
  return { group, cs, en, items: [...cs, ...en] }
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
