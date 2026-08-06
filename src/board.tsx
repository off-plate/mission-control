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

import { useLayoutEffect, useRef } from 'react'

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
export const WALL: Card[] = [
  { kind: 'image', src: art('#5a5f66', '#14161a'), photo: 'amg-gtr', caption: 'AMG GT R' },
  { kind: 'statement', text: 'She doesn’t need promises. She needs to see it.', size: 'xl' },
  { kind: 'number', value: '226', label: 'kilometres in one Ironman day. Swim, then bike, then run, and nothing stops in between.' },
  { kind: 'image', src: art('#8a3a2a', '#2a0f0a'), photo: 'aventador-sv', caption: 'Aventador SV' },
  { kind: 'statement', text: 'You were never lazy. You were scared. Scared is a thing you can fix.', size: 'xl' },
  { kind: 'rule', text: 'Do it anyway' },
  { kind: 'quote', text: 'We suffer more often in imagination than in reality.', by: 'Seneca' },
  { kind: 'image', src: art('#4f5358', '#15171a'), photo: 'gle63s', caption: 'GLE 63 S Coupé' },
  { kind: 'statement', text: 'You will not feel like it. That was never part of the deal.', size: 'xl' },
  { kind: 'number', value: '100', label: 'kilometres on your own legs. There is no metaphor in that number.' },
  { kind: 'rule', text: 'Open it the day it arrives' },
  { kind: 'quote', text: 'You do not rise to the level of your goals. You fall to the level of your systems.', by: 'James Clear' },
  { kind: 'image', src: art('#6f7c84', '#161a1e'), photo: 'villa', caption: 'the house, eventually' },
  { kind: 'statement', text: 'The kid who watched those games wanted exactly this. He is still watching.', size: 'xl' },
  { kind: 'number', value: '42.2', label: 'the marathon that starts when you are already empty. That is the point of it.' },
  { kind: 'rule', text: 'Bed by midnight' },
  { kind: 'statement', text: 'You were never short on ability. You were short on permission. Nobody else is going to sign it.', size: 'lg' },
  { kind: 'image', src: art('#8a7856', '#241d12'), photo: 'workspace', caption: 'the room you build it in' },
  { kind: 'quote', text: 'Kdo chce, hledá způsob. Kdo nechce, hledá důvod.', by: 'České přísloví' },
  { kind: 'number', value: '17', label: 'hours to get it done. Nobody will ask how you looked at hour twelve.' },
  { kind: 'statement', text: 'The 2 AM version of you is not owed your company.', size: 'lg' },
  { kind: 'rule', text: 'Train on the days you least want to' },
  { kind: 'quote', text: 'At dawn, when you have trouble getting out of bed, tell yourself: I have to go to work as a human being.', by: 'Marcus Aurelius' },
  { kind: 'image', src: art('#3a3d42', '#141518'), photo: 'diamond-gym', caption: 'Diamond Gym' },
  { kind: 'statement', text: 'Every year you talked yourself out of it is a year you do not get back. Today is not one of them.', size: 'xl' },
  { kind: 'number', value: '3.8', label: 'kilometres of open water before the day has even started.' },
  { kind: 'rule', text: 'Hardest call before 11:00' },
  { kind: 'statement', text: 'Your future kids will only ever meet the man you are building now.', size: 'xl' },
  { kind: 'quote', text: 'The most important conversations you will ever have are the ones you have with yourself.', by: 'David Goggins' },
  { kind: 'image', src: art('#4a4a52', '#16161c'), photo: 'zyzz', caption: 'Zyzz' },
  { kind: 'number', value: '180', label: 'kilometres on the bike, and the marathon is still waiting at the end of it.' },
  { kind: 'rule', text: 'One task, then the next' },
  { kind: 'statement', text: 'The fear was never about the weight. It was about finding out what you can actually do.', size: 'lg' },
  { kind: 'quote', text: 'Hard choices, easy life. Easy choices, hard life.', by: 'Jerzy Gregorek' },
  { kind: 'statement', text: 'In ten years this is the year you will point at.', size: 'xl' },
  { kind: 'number', value: '1', label: 'the rep that counts is the one after the one you wanted to quit on.' },
  { kind: 'image', src: art('#6a5a4a', '#1c1712'), photo: 'noel-deyzel', caption: 'Noel Deyzel' },
  { kind: 'rule', text: 'Log the set before you rest' },
  { kind: 'statement', text: 'Nobody is coming to fix this. Good. You would not have respected it if they had.', size: 'lg' },
  { kind: 'quote', text: 'Beyond a certain point there is no return. That point has to be reached.', by: 'Franz Kafka' },
  { kind: 'number', value: '0', label: 'people are coming to carry you over that line.' },
  { kind: 'statement', text: 'You have spent your whole life negotiating with your own head. Stop taking its calls.', size: 'lg' },
  { kind: 'rule', text: 'Phone stays out of the first ten minutes' },
  { kind: 'quote', text: 'Motivation is crap. Motivation comes and goes.', by: 'David Goggins' },
  { kind: 'image', src: art('#7d6a58', '#241c14'), photo: 'newborn', caption: 'the day you carry him out' },
  { kind: 'statement', text: 'Off-Plate exists because you kept the evening promises nobody checked.', size: 'lg' },
  { kind: 'number', value: '3', label: 'the hours nobody sees. They are the ones that decide it.' },
  { kind: 'rule', text: 'No 2 AM sessions' },
  { kind: 'quote', text: 'The world breaks everyone, and afterward many are strong at the broken places.', by: 'Ernest Hemingway' },
  { kind: 'statement', text: 'Your kids will inherit your habits long before they inherit anything else.', size: 'xl' },
  { kind: 'rule', text: 'Tell her the truth, early' },
  { kind: 'statement', text: 'The boy who wanted the loud car grew up and kept it. Keep the rest too.', size: 'lg' },
  { kind: 'quote', text: 'Discipline equals freedom.', by: 'Jocko Willink' },
  { kind: 'image', src: art('#a8813c', '#2b2110'), photo: 'late-desk', caption: 'the desk at 23:00, not 02:00' },
  { kind: 'number', value: '2', label: 'people have to believe this before it happens. You first, then her.' },
  { kind: 'statement', text: 'A calm man is not a man without problems. He is a man who wrote them down.', size: 'lg' },
  { kind: 'rule', text: 'If it takes two minutes, it happens now' },
  { kind: 'quote', text: 'First say to yourself what you would be, then do what you have to do.', by: 'Epictetus' },
  { kind: 'statement', text: 'Nobody sees the Tuesday. The Tuesday is the whole thing.', size: 'xl' },
  { kind: 'number', value: '365', label: 'days between wanting this and having done it. Day one is whichever one you pick.' },
  { kind: 'statement', text: 'You are the first one in this family to open every letter.', size: 'lg' },
  { kind: 'rule', text: 'Finish what is open before starting what is new' },
  { kind: 'statement', text: 'One day she will say we got through that, and she will mean you.', size: 'xl' },
  { kind: 'image', src: art('#2a2f38', '#0e1116'), photo: 'one-light', caption: 'one light still on' },
  { kind: 'quote', text: 'When we are no longer able to change a situation, we are challenged to change ourselves.', by: 'Viktor Frankl' },
  { kind: 'statement', text: 'None of this got here overnight. None of it leaves overnight either. Show up tomorrow, then do it again.', size: 'lg' },
  { kind: 'number', value: '10', label: 'years from now you will have either the story or the excuse.' },
  { kind: 'rule', text: 'Write it down or it did not happen' },
  { kind: 'statement', text: 'Stop waiting to feel ready. Ready is something you feel afterwards.', size: 'lg' },
  { kind: 'quote', text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', by: 'Marcus Aurelius' },
  { kind: 'statement', text: 'The man who fixes this is the same man who avoided it. That is the entire point.', size: 'lg' },
  { kind: 'rule', text: 'Eat before you train, not after' },
  { kind: 'statement', text: 'Every hard thing you have finished started as a thing you did not want to start.', size: 'lg' },
  { kind: 'quote', text: 'You are in danger of living a life so comfortable and soft that you will die without ever realizing your true potential.', by: 'David Goggins' },
  { kind: 'statement', text: 'There is a version of this life where money is boring. It is closer than it feels.', size: 'lg' },
  { kind: 'statement', text: 'You already did the hardest part. You looked.', size: 'xl' },
]

/** The site is served from a sub path on Pages, so every wall file has to be
 *  asked for relative to that base and not from the domain root. */
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

/* What the browser is told a card measures, so it can pick the right file off
 *  the srcset before layout. Expressed in vw rather than px because the grid
 *  columns are 1fr and stretch: a px hint would be a lie at most widths.
 *  A wide card covers two columns and a phone edge to edge, so it asks for
 *  roughly double. */
const SIZES_TALL = '(max-width: 700px) 50vw, (min-width: 1900px) 15vw, 25vw'
const SIZES_WIDE = '(max-width: 700px) 100vw, (min-width: 1900px) 30vw, 50vw'

/** Row height of the masonry grid, in px. Small enough that a card's real
 *  height rounds up to something indistinguishable from the height itself. */
const ROW = 4
/** The gap under a card, in the same units the row span is counted in. */
const GUTTER = 18

/* Why the wall is a grid and not CSS columns any more: in a multi-column
   layout an item spans one column or all of them, never two, so a landscape
   photograph had no way to be wider than a line of text. It sat in a 300px
   column as a strip. This is the ordinary fix: a grid with very short rows,
   where each card measures itself and claims however many rows it needs, and
   a wide photograph also claims two columns. Dense packing backfills the holes
   that the two-wide cards leave behind. */
function useMasonry(count: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const wall = ref.current
    if (!wall) return
    const fit = () => {
      for (const el of Array.from(wall.children) as HTMLElement[]) {
        /* offsetHeight, not getBoundingClientRect: every card carries a rotate
           and the rect is the turned bounding box, which is taller than the
           space the card actually occupies. That gap compounded down the
           column into a visible drift. */
        const h = el.offsetHeight
        if (h) el.style.gridRowEnd = `span ${Math.ceil((h + GUTTER) / ROW)}`
      }
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    /* One observer over all the cards: a photograph that arrives late, a font
       that swaps, or a window that changes width all resize a card, and each
       of those needs the span recomputed. */
    const ro = new ResizeObserver(fit)
    Array.from(wall.children).forEach((c) => ro.observe(c))
    ro.observe(wall)
    return () => ro.disconnect()
  }, [count])
  return ref
}

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
      className={`bcard b-image${img.wide ? ' is-wide' : ''}`}
      style={{ ...style, backgroundImage: `url("${img.lqip}")` }}
    >
      <img
        src={BASE + img.src}
        srcSet={srcset}
        sizes={img.wide ? SIZES_WIDE : SIZES_TALL}
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
  const wall = useMasonry(WALL.length)
  return (
    <div className="board-page">
      <header className="board-head">
        <h1>The wall</h1>
      </header>
      <div className="board-wall" ref={wall}>
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
