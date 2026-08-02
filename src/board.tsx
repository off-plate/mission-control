/* The vision board: the one page allowed off the house style. Everything else
   in the app is the machine; this is the reason the machine exists. A wall of
   words, numbers and images with no repeating rhythm, meant to be LOOKED at,
   not operated. Demo content for now; it becomes his to fill once the design
   is agreed. The one hard rule kept from the canon: no real financial figures,
   because the bundle is public. */

import { wallImage } from './wall-images'

const TILT = [-2, 1.5, -1, 2, -1.5, 1, -2.5, 0.5]

/** Abstract image stand-ins, generated inline so nothing external loads and
 *  nothing can 404. Real photos replace these when he brings them. */
const art = (a: string, b: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><defs><radialGradient id="g" cx="28%" cy="22%" r="110%"><stop offset="0%" stop-color="${a}"/><stop offset="55%" stop-color="${b}"/><stop offset="100%" stop-color="#0c0c10"/></radialGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.1"/></feComponentTransfer></filter></defs><rect width="640" height="800" fill="url(#g)"/><rect width="640" height="800" filter="url(#n)"/></svg>`,
  )}`

type Card =
  | { kind: 'statement'; text: string; size?: 'xl' | 'lg' }
  | { kind: 'quote'; text: string; by?: string }
  | { kind: 'number'; value: string; label: string }
  /** `photo` names a key in the generated manifest, put there by the Jarvis
   *  wall-image skill. `src` is the inline stand-in used until a real
   *  photograph replaces it. A card with a photo key that is not in the
   *  manifest falls back to its stand-in rather than rendering a broken
   *  image, so removing a file can never leave a hole in the wall. */
  | { kind: 'image'; src: string; caption?: string; photo?: string }
  | { kind: 'rule'; text: string }

/* Demo copy written to LAND, not to decorate: his own stakes, said plainly.
   Firm, never cruel; the wall pushes, it does not shame. */
const DEMO: Card[] = [
  { kind: 'statement', text: 'She doesn\u2019t need promises. She needs to see it.', size: 'xl' },
  { kind: 'image', src: art('#4a68b8', '#1a2440'), caption: 'the calm desk, every morning' },
  { kind: 'number', value: '500', label: 'stairmaster floors. The body keeps the score.' },
  { kind: 'quote', text: 'Nobody is coming. Good. You\u2019re already here.' },
  { kind: 'image', src: art('#c2603a', '#3d1f12'), caption: 'Liguria, August. Earned, not escaped to.' },
  { kind: 'rule', text: 'Bed by midnight' },
  { kind: 'statement', text: 'The mailbox stopped being scary the day you started opening it.', size: 'lg' },
  { kind: 'image', src: art('#2e8a6e', '#123126'), caption: 'the Corner, built at night' },
  { kind: 'quote', text: 'You do not rise to the level of your goals. You fall to the level of your systems.', by: 'James Clear' },
  { kind: 'number', value: '1h', label: 'of real focus, every day. That is the whole trick.' },
  { kind: 'statement', text: 'The 2 AM version of you is not owed your company.', size: 'lg' },
  { kind: 'image', src: art('#b8912e', '#33260c'), caption: 'the Challenger, kept, not sold' },
  { kind: 'statement', text: 'Your future kids will only ever meet the man you are building now.', size: 'xl' },
  { kind: 'rule', text: 'One task, then the next' },
  { kind: 'quote', text: 'Hard choices, easy life. Easy choices, hard life.', by: 'Jerzy Gregorek' },
  { kind: 'image', src: art('#7a5cc4', '#241a42'), caption: 'the gym at six' },
  { kind: 'number', value: '0', label: 'letters unopened. Zero. That is what control feels like.' },
  { kind: 'statement', text: 'Off-Plate exists because you kept the evening promises nobody checked.', size: 'lg' },
]

/** The site is served from a sub path on Pages, so every wall file has to be
 *  asked for relative to that base and not from the domain root. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

/* What the browser is told a wall column measures, so it can pick the right
 *  width off the srcset before layout. These mirror styles.css exactly: 420px
 *  columns above 1900, 160px on a phone, 300px in between. */
const WALL_SIZES = '(min-width: 1900px) 420px, (max-width: 700px) 160px, 300px'

/** One photograph. Two WebP widths, its own height reserved up front, and the
 *  24px blur standing in until the file lands. Everything below the first
 *  screen loads only when it is scrolled to. */
function Photo({
  card, style, eager,
}: {
  card: Extract<Card, { kind: 'image' }>
  style: React.CSSProperties
  eager: boolean
}) {
  const img = card.photo ? wallImage(card.photo) : undefined
  if (!img) {
    return (
      <figure className="bcard b-image" style={style}>
        <img src={card.src} alt={card.caption ?? ''} loading="lazy" decoding="async" />
        {card.caption && <figcaption className="mono">{card.caption}</figcaption>}
      </figure>
    )
  }
  const srcset = img.srcset.split(', ').map((part) => BASE + part).join(', ')
  return (
    <figure
      className="bcard b-image"
      style={{ ...style, backgroundImage: `url("${img.lqip}")` }}
    >
      <img
        src={BASE + img.src}
        srcSet={srcset}
        sizes={WALL_SIZES}
        width={img.w}
        height={img.h}
        alt={card.caption ?? ''}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
      />
      {card.caption && <figcaption className="mono">{card.caption}</figcaption>}
    </figure>
  )
}

export function BoardPage() {
  /* Only what is on screen at the top loads straight away. Everything after
     the second photograph waits for the scroll, which is what keeps a wall of
     photographs off the first paint. */
  let shown = 0
  return (
    <div className="board-page">
      <header className="board-head">
        <h1>The wall</h1>
      </header>
      <div className="board-wall">
        {DEMO.map((c, i) => {
          const tilt = TILT[i % TILT.length]
          const style = { ['--tilt' as string]: `${tilt}deg` } as React.CSSProperties
          if (c.kind === 'image') {
            shown += 1
            return <Photo card={c} style={style} eager={shown <= 2} key={i} />
          }
          if (c.kind === 'quote') {
            return (
              <blockquote className="bcard b-quote" style={style} key={i}>
                <p>“{c.text}”</p>
                {c.by && <cite className="mono">{c.by}</cite>}
              </blockquote>
            )
          }
          if (c.kind === 'number') {
            return (
              <div className="bcard b-number" style={style} key={i}>
                <span className="bn mono">{c.value}</span>
                <span className="bl">{c.label}</span>
              </div>
            )
          }
          if (c.kind === 'rule') {
            return <div className="bcard b-rule" style={style} key={i}><span>{c.text}</span></div>
          }
          return (
            <div className={`bcard b-statement s-${c.size ?? 'lg'}`} style={style} key={i}>
              {c.text}
            </div>
          )
        })}
      </div>
      <p className="board-foot mono">demo wall · your own images, words and numbers replace these once the design is approved</p>
    </div>
  )
}
