/* The helmet.

   Drawn here rather than pulled from an icon set, for the reason DESIGN.md
   gives and for one more: no icon library has this, and the ones that do have
   a "robot" would put a cartoon in the header.

   Deliberately a GEOMETRIC READING of a faceplate rather than a copy of
   anybody's artwork: a tapered shell, a raised brow, a jaw vent, and two lit
   eye slots. It reads as the helmet at 18px, which is the only size it is ever
   drawn at, and it owes nothing to a frame of film.

   The eyes light when the mode is on. That is the whole interaction: the icon
   is the state, so the button needs no second indicator. */
export function Helmet({ lit }: { lit: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="helmet">
      {/* The shell: wider at the brow, tapering to the chin. */}
      <path
        d="M5.4 4.2 C5.4 3.4 6 2.9 6.8 2.9 H17.2 C18 2.9 18.6 3.4 18.6 4.2 V11.4 C18.6 15.3 16.6 18.6 13.5 20.6 C12.6 21.2 11.4 21.2 10.5 20.6 C7.4 18.6 5.4 15.3 5.4 11.4 Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
      {/* The brow, the one line that makes it a faceplate and not an egg. */}
      <path d="M5.4 8.5 H18.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Jaw vents. */}
      <path d="M9.6 17.4 H14.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
      {/* The eyes. Angled, and lit when the mode is on. */}
      <path
        d="M7.8 11.4 L10.6 10.6 L10.6 12.7 L7.8 13.2 Z M16.2 11.4 L13.4 10.6 L13.4 12.7 L16.2 13.2 Z"
        fill={lit ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
        className={lit ? 'helmet-eyes lit' : 'helmet-eyes'}
      />
    </svg>
  )
}
