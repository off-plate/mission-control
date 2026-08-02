/* The vision board: the one page allowed off the house style. Everything else
   in the app is the machine; this is the reason the machine exists. A wall of
   words, numbers and images with no repeating rhythm, meant to be LOOKED at,
   not operated. This is his real wall now, not a demo.

   Two rules kept from the canon. No real financial figures, because the bundle
   is public. And firm, never cruel: the wall pushes, it does not shame. He is
   already hard enough on himself, and a wall that shames gets avoided like
   everything else he avoids, which would make it worthless.

   The five kinds and what each is for, so this stays coherent as it grows:
     statement  the heavy ones. What is actually at stake, said plainly.
     quote      borrowed words, only where someone said it better than we can.
     number     one figure he can act on or measure himself against.
     image      a photograph, placed by the Jarvis wall-image skill.
     rule       a standing order. Imperative, present tense, nothing to
                interpret. These are the only cards in a loud colour because
                on a wall meant to be felt, they are the ones to be obeyed. */

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

/* Written to LAND, not to decorate: his own stakes, said plainly. Deliberately
   long, because the point of a wall is that you scroll it and keep finding
   things, and a short one gets memorised and stops working by the third visit.
   Ordered so no two cards of the same kind sit together for long. */
const WALL: Card[] = [
  { kind: 'statement', text: 'She doesn\u2019t need promises. She needs to see it.', size: 'xl' },
  { kind: 'image', src: art('#4a68b8', '#1a2440'), photo: 'calm-desk', caption: 'the calm desk, every morning' },
  { kind: 'number', value: '500', label: 'stairmaster floors. The body keeps the score.' },
  { kind: 'quote', text: 'Nobody is coming. Good. You\u2019re already here.' },
  { kind: 'statement', text: 'You were never lazy. You were scared. Scared is a thing you can fix.', size: 'xl' },
  { kind: 'image', src: art('#5a6b7d', '#1b2530'), photo: 'family-field', caption: 'what all of it is for' },
  { kind: 'rule', text: 'Open it the day it arrives' },
  { kind: 'image', src: art('#c2603a', '#3d1f12'), photo: 'liguria', caption: 'Liguria, August. Earned, not escaped to.' },
  { kind: 'quote', text: 'We suffer more often in imagination than in reality.', by: 'Seneca' },
  { kind: 'rule', text: 'Bed by midnight' },
  { kind: 'statement', text: 'The mailbox stopped being scary the day you started opening it.', size: 'lg' },
  { kind: 'number', value: '+2.5', label: 'kg on the bench every week. The bar does not care how you slept.' },
  { kind: 'image', src: art('#2e8a6e', '#123126'), photo: 'corner-night', caption: 'the Corner, built at night' },
  { kind: 'quote', text: 'You do not rise to the level of your goals. You fall to the level of your systems.', by: 'James Clear' },
  { kind: 'statement', text: 'Nobody is coming to fix this. Good. You would not have respected it if they had.', size: 'lg' },
  { kind: 'image', src: art('#6b6355', '#241f18'), photo: 'prague-dawn', caption: 'Prague, before it wakes up' },
  { kind: 'number', value: '1h', label: 'of real focus, every day. That is the whole trick.' },
  { kind: 'rule', text: 'Datov\u00e1 schr\u00e1nka, every Sunday' },
  { kind: 'statement', text: 'The 2 AM version of you is not owed your company.', size: 'lg' },
  { kind: 'image', src: art('#7a6a52', '#241d12'), photo: 'old-photo', caption: 'the ones who came before you' },
  { kind: 'quote', text: 'Kdo chce, hled\u00e1 zp\u016fsob. Kdo nechce, hled\u00e1 d\u016fvod.', by: '\u010cesk\u00e9 p\u0159\u00edslov\u00ed' },
  { kind: 'image', src: art('#b8912e', '#33260c'), photo: 'challenger', caption: 'the Challenger, kept, not sold' },
  { kind: 'number', value: '180', label: 'grams of protein. Every day, not most days.' },
  { kind: 'image', src: art('#4a4a52', '#16161c'), photo: 'the-bar', caption: 'chalk, then the set' },
  { kind: 'statement', text: 'Your future kids will only ever meet the man you are building now.', size: 'xl' },
  { kind: 'rule', text: 'Hardest call before 11:00' },
  { kind: 'image', src: art('#b8862e', '#33260c'), photo: 'golden-field', caption: 'summer, the kind you remember' },
  { kind: 'quote', text: 'The most important conversations you will ever have are the ones you have with yourself.', by: 'David Goggins' },
  { kind: 'statement', text: 'You are the first one in this family to open every letter.', size: 'lg' },
  { kind: 'number', value: '00:00', label: 'Lights out. Tomorrow is decided the night before, every time.' },
  { kind: 'rule', text: 'One task, then the next' },
  { kind: 'image', src: art('#7a5cc4', '#241a42'), photo: 'gym-six', caption: 'the gym at six' },
  { kind: 'quote', text: 'Hard choices, easy life. Easy choices, hard life.', by: 'Jerzy Gregorek' },
  { kind: 'statement', text: 'In ten years this is the year you will point at.', size: 'xl' },
  { kind: 'image', src: art('#c2703a', '#3d2012'), photo: 'her', caption: 'her. The whole reason.' },
  { kind: 'number', value: '0', label: 'letters unopened. Zero. That is what control feels like.' },
  { kind: 'rule', text: 'Tell her the real number' },
  { kind: 'statement', text: 'The man who fixes this is the same man who avoided it. That is the entire point.', size: 'lg' },
  { kind: 'quote', text: 'Beyond a certain point there is no return. That point has to be reached.', by: 'Franz Kafka' },
  { kind: 'image', src: art('#8a7040', '#2a2114'), photo: 'prague-night', caption: 'the long way home' },
  { kind: 'number', value: '10', label: 'days on the Ligurian coast in August. Booked, not dreamed about.' },
  { kind: 'statement', text: 'Off-Plate exists because you kept the evening promises nobody checked.', size: 'lg' },
  { kind: 'rule', text: 'No 2 AM sessions' },
  { kind: 'image', src: art('#c08a30', '#2e2210'), photo: 'windows-lit', caption: 'everyone is up late building something' },
  { kind: 'quote', text: 'The world breaks everyone, and afterward many are strong at the broken places.', by: 'Ernest Hemingway' },
  { kind: 'statement', text: 'Your kids will inherit your habits long before they inherit anything else.', size: 'xl' },
  { kind: 'number', value: '+5', label: 'kg off the floor every Saturday. Small, relentless, unarguable.' },
  { kind: 'rule', text: 'Phone stays out of the first ten minutes' },
  { kind: 'statement', text: 'The boy who wanted the loud car grew up and kept it. Keep the rest too.', size: 'lg' },
  { kind: 'quote', text: 'Discipline equals freedom.', by: 'Jocko Willink' },
  { kind: 'number', value: '2400', label: 'kcal. The quiet number that decides all the loud ones.' },
  { kind: 'image', src: art('#a8813c', '#2b2110'), photo: 'late-desk', caption: 'the desk at 23:00, not 02:00' },
  { kind: 'statement', text: 'A calm man is not a man without problems. He is a man who wrote them down.', size: 'lg' },
  { kind: 'rule', text: 'If it takes two minutes, it happens now' },
  { kind: 'quote', text: 'First say to yourself what you would be, then do what you have to do.', by: 'Epictetus' },
  { kind: 'statement', text: 'Nobody sees the Tuesday. The Tuesday is the whole thing.', size: 'xl' },
  { kind: 'image', src: art('#8f3f2a', '#2b120c'), photo: 'red-car', caption: 'your father\u2019s era. Your turn now.' },
  { kind: 'number', value: '5', label: 'iron days, Monday to Friday. Saturday only if you want it.' },
  { kind: 'rule', text: 'Log the set before you rest' },
  { kind: 'statement', text: 'One day she will say we got through that, and she will mean you.', size: 'xl' },
  { kind: 'quote', text: 'When we are no longer able to change a situation, we are challenged to change ourselves.', by: 'Viktor Frankl' },
  { kind: 'statement', text: 'It did not arrive in one day and it will not leave in one day. Show up anyway.', size: 'lg' },
  { kind: 'number', value: '7', label: 'days between you and the next Sunday check. That is the whole system.' },
  { kind: 'rule', text: 'Finish what is open before starting what is new' },
  { kind: 'statement', text: 'Stop waiting to feel ready. Ready is something you feel afterwards.', size: 'lg' },
  { kind: 'quote', text: 'You are in danger of living a life so comfortable and soft that you will die without ever realizing your true potential.', by: 'David Goggins' },
  { kind: 'number', value: '4', label: 'spaces, one life. Personal, Big Time, Off-Plate, the Corner.' },
  { kind: 'statement', text: 'There is a version of this life where money is boring. It is closer than it feels.', size: 'lg' },
  { kind: 'rule', text: 'Write it down or it did not happen' },
  { kind: 'quote', text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', by: 'Marcus Aurelius' },
  { kind: 'statement', text: 'Every hard thing you have finished started as a thing you did not want to start.', size: 'lg' },
  { kind: 'rule', text: 'Eat before you train, not after' },
  { kind: 'statement', text: 'You have already done the hardest part, which was starting to look.', size: 'xl' },
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
        {WALL.map((c, i) => {
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
    </div>
  )
}
