/* Icon set: Hicon Circular Interface Icons by hicon, MIT licensed, from svgrepo.com.
   Full licence text in `LICENSES.md`. Every icon is 24x24, stroked, and inherits
   `currentColor`, which is why colour lives entirely in CSS and never in here.

   ONE icon, ONE meaning, defined ONCE. Before adding a component, check that the
   meaning is not already here under another name: two exports that do the same job
   for Michael are the same icon, and the second one is how a set stops being a set.

   `filled` exists for the transport controls only. They were filled shapes before
   this set arrived and an outlined play triangle at 13px reads as an empty box, so
   the geometry comes from Hicon and the weight stays where it was.

   One deliberate exception, at the bottom of this file: the Dock* icons are
   Tabler (MIT), his explicit call (2026-09-04) after svgrepo blocked every
   automated request that day. Scoped to the floating dock alone -- see the
   comment down there before reaching for a third source. */
import type { ReactNode } from 'react'

/* Hicon draws its glyphs with wildly uneven padding: measured on the real paths,
   the ink ran from 35% of the 24 box (check) to 83% (settings). At one `size`
   that made a tick less than half the size of a gear, which is why the set read
   as "very small" in some places and fine in others.

   Every icon therefore carries a fit: scale its ink to 19.7 of 24 and centre it.
   Computed once from the measured bounding boxes, not eyeballed. If an icon is
   added, measure it the same way rather than guessing a fit. */
type Fit = { k: number; x: number; y: number }

export type IconProps = {
  /** Rendered square, in px. Match the text it sits beside, not a global default. */
  size?: number
  strokeWidth?: number
  /** Fill the shape instead of stroking it. Transport controls only. */
  filled?: boolean
  className?: string
  /** Only set this when the icon is the sole label of its control. */
  title?: string
}

function make(body: ReactNode, dfltSize: number, fit: Fit, dfltStroke = 2) {
  return function Icon({ size = dfltSize, strokeWidth = dfltStroke, filled, className, title }: IconProps) {
    const w = filled ? strokeWidth * 0.9 : strokeWidth
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        /* Divided by the fit scale, because the transform below multiplies it
           straight back up. Every icon renders at the same true stroke. */
        strokeWidth={w / fit.k}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
      >
        {title ? <title>{title}</title> : null}
        <g transform={`translate(${fit.x} ${fit.y}) scale(${fit.k})`}>{body}</g>
      </svg>
    )
  }
}

/* hicon: menu */
export const Menu = make(<><line x1="5" y1="18" x2="19" y2="18"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="5" y1="8" x2="19" y2="8"/></>, 16, { k: 1.4071, x: -4.886, y: -6.293 })
/* hicon: star */
/* hicon: file-text */
export const Note = make(<><path d="M12.4615 4V9C12.4615 9.55228 12.9093 10 13.4615 10H18M12.4615 4L7 4C6.44772 4 6 4.44772 6 5V19C6 19.5523 6.44772 20 7 20H17C17.5523 20 18 19.5523 18 19V10M12.4615 4L18 10"/><line x1="10" y1="14" x2="14" y2="14"/><line x1="10" y1="11" x2="11" y2="11"/><line x1="10" y1="17" x2="14" y2="17"/></>, 16, { k: 1.2312, x: -2.775, y: -2.775 })
/* hicon: rotate-acw */
export const Rewind = make(<><path d="M5.06697 5.91046L5.65392 1.99997"/><path d="M5.06697 5.91046L8.80751 7.19296"/><path d="M3 12.0609C3 17.0314 7.02944 21.0609 12 21.0609C16.9706 21.0609 21 17.0314 21 12.0609C21 7.09029 16.9706 3.06085 12 3.06085C9.92877 3.06085 8.02095 3.76052 6.5 4.9364"/></>, 16, { k: 1.0336, x: -0.403, y: 0.083 })
/* hicon: settings */
export const Settings = make(<><circle r="2" transform="matrix(-1 0 0 1 12 12)"/><path d="M20 10C21.1046 10 22 10.8954 22 12C22 13.1046 21.1046 14 20 14"/><path d="M4 10C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14"/><path d="M17.732 17.9282C18.2843 18.8848 17.9566 20.108 17 20.6603C16.0434 21.2126 14.8202 20.8848 14.2679 19.9282"/><path d="M9.73205 4.07178C9.17976 3.11519 7.95658 2.78744 6.99999 3.33973C6.04341 3.89201 5.71566 5.11519 6.26794 6.07178"/><path d="M20 13.9999C19 13.9999 17.7484 14.0434 17.1962 15C16.6439 15.9566 17 16.5 17.5 17.5"/><path d="M6.50002 6.5C7.00002 7.5 7.35615 8.04343 6.80386 9.00002C6.25158 9.9566 5.00001 10 4.00001 10"/><path d="M14.2679 4.07177C14.8202 3.11519 16.0434 2.78744 17 3.33972C17.9566 3.89201 18.2843 5.11519 17.732 6.07177"/><path d="M6.26792 17.9282C5.71564 18.8848 6.04339 20.108 6.99997 20.6603C7.95656 21.2126 9.17974 20.8848 9.73203 19.9282"/><path d="M17.732 6.07185C17.232 6.93787 16.6439 8.0435 17.1962 9.00009C17.7485 9.95667 18.3971 9.91994 19.5131 9.98694"/><path d="M4.48686 14.0131C5.60289 14.0801 6.25158 14.0434 6.80387 15C7.35615 15.9566 6.76796 17.0622 6.26796 17.9282"/><path d="M9.73201 4.07179C10.232 4.93781 10.8955 5.99995 12 5.99995C13.1046 5.99995 13.3971 5.41985 14.0132 4.48682"/><path d="M9.98688 19.5131C10.6029 18.5801 10.8955 18 12 18C13.1046 18 13.768 19.0622 14.268 19.9282"/></>, 16, { k: 0.985, x: 0.18, y: 0.18 })
/* hicon: more-horizontal */
export const More = make(<><path d="M17.005 11.995L17.005 12.005"/><path d="M12.005 11.995L12.005 12.005"/><path d="M7.005 11.995L7.005 12.005"/></>, 16, { k: 1.97, x: -11.66, y: -11.63 }, 3)
/* hicon: external-link */
export const ExternalLink = make(<><line x1="10.8492" y1="13.0606" x2="19.435" y2="4.47485"/><path d="M19.7886 4.12134L20.1421 8.01042"/><path d="M19.7886 4.12134L15.8995 3.76778"/><path d="M18 13.1465V17.6465C18 19.3033 16.6569 20.6465 15 20.6465H6C4.34315 20.6465 3 19.3033 3 17.6465V8.64648C3 6.98963 4.34315 5.64648 6 5.64648H10.5"/></>, 16, { k: 1.1494, x: -1.298, y: -2.034 })
/* hicon: video */
export const Video = make(<><rect x="4" y="8" width="11" height="8" rx="1"/><path d="M15 11.2L20 8V16L15 12.8V11.2Z"/><path d="M11.1 7H11"/></>, 16, { k: 1.2312, x: -2.775, y: -2.159 })
/* hicon: compass */
export const Compass = make(<><path d="M13.5921 13.5L16.5 7.5L10.5 10.4079"/><path d="M10.4079 10.5L7.5 16.5L13.5 13.5921"/><rect x="3" y="3" width="18" height="18" rx="9"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: zap-on */
export const Bolt = make(<><path d="M12.0933 10.7226L20.2542 13.8051L7.2411 21.3182L11.1782 14.1376"/><path d="M11.201 14.1243L3.55392 9.87915L16.5671 2.36601L12.0933 10.7225"/></>, 16, { k: 1.0396, x: -0.371, y: -0.314 })
/* hicon: clock-1 */
export const Clock = make(<><rect x="3" y="3" width="18" height="18" rx="9"/><line x1="12" y1="11" x2="12" y2="8"/><path d="M12 12L12 6.5"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: home */
export const Home = make(<><path d="M4 8.65714L12 3L20 8.65714V21H4V8.65714Z"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: heart */
/* hicon: folder */
export const Folder = make(<><path d="M3 7C3 5.89543 3.89543 5 5 5H7.72525C8.46646 5 9.10464 5.52318 9.25 6.25V6.25C9.39536 6.97682 10.0335 7.5 10.7748 7.5H19C20.1046 7.5 21 8.39543 21 9.5V17.5C21 18.6046 20.1046 19.5 19 19.5H5C3.89543 19.5 3 18.6046 3 17.5V7Z"/></>, 16, { k: 1.0944, x: -1.133, y: -1.407 })
/* hicon: folder-add */
export const FolderAdd = make(<><path d="M3 7C3 5.89543 3.89543 5 5 5H7.72525C8.46646 5 9.10464 5.52318 9.25 6.25V6.25C9.39536 6.97682 10.0335 7.5 10.7748 7.5H19C20.1046 7.5 21 8.39543 21 9.5V17.5C21 18.6046 20.1046 19.5 19 19.5H5C3.89543 19.5 3 18.6046 3 17.5V7Z"/><path d="M14.5 13.5L9.5 13.5"/><path d="M12 11L12 16"/></>, 16, { k: 1.0944, x: -1.133, y: -1.407 })
/* hicon: list */
export const List = make(<><line x1="20" y1="7" x2="8" y2="7"/><line x1="20" y1="12" x2="8" y2="12"/><line x1="20" y1="17" x2="8" y2="17"/><path d="M4 7L4 7.01"/><path d="M4 12L4 12.01"/><path d="M4 17L4 17.01"/></>, 16, { k: 1.2312, x: -2.775, y: -2.781 })
/* hicon: check-square-1 */
export const Checklist = make(<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M15.5 10L11 14.5"/><path d="M9 12.5L11 14.5"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: minus */
export const Divider = make(<><path d="M6 12H18"/></>, 16, { k: 1.6417, x: -7.7, y: -7.7 })
/* hicon: lens */
export const Search = make(<><path d="M19.9604 11.4802C19.9604 13.8094 19.0227 15.9176 17.5019 17.4512C16.9332 18.0247 16.2834 18.5173 15.5716 18.9102C14.3594 19.5793 12.9658 19.9604 11.4802 19.9604C6.79672 19.9604 3 16.1637 3 11.4802C3 6.79672 6.79672 3 11.4802 3C16.1637 3 19.9604 6.79672 19.9604 11.4802Z"/><path d="M18.1553 18.1553L21.8871 21.8871"/></>, 16, { k: 1.0429, x: -0.979, y: -0.979 })
/* hicon: plus */
export const Plus = make(<><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></>, 16, { k: 1.6417, x: -7.7, y: -7.7 })
/* hicon: chevron-left */
export const ChevronLeft = make(<><path d="M10 12.4L14.5 17.8"/><path d="M10 12.4L14.5 7.00006"/></>, 16, { k: 1.8241, x: -10.345, y: -10.619 })
/* hicon: chevron-right */
export const ChevronRight = make(<><path d="M14.5 12.4L10 17.8"/><path d="M14.5 12.4L10 7.00006"/></>, 16, { k: 1.8241, x: -10.345, y: -10.619 })
/* hicon: chevron-down */
export const ChevronDown = make(<><path d="M12.25 14.6499L17.6499 10.1499"/><path d="M12.25 14.6499L6.85002 10.1499"/></>, 16, { k: 1.8241, x: -10.345, y: -10.619 })
/* hicon: play */
export const Play = make(<><path d="M17.3125 12L7.6875 19L7.6875 5L17.3125 12Z"/></>, 16, { k: 1.4071, x: -5.596, y: -4.886 })
/* hicon: pause */
export const Pause = make(<><rect x="4" y="4" width="6" height="16"/><rect x="14" y="4" width="6" height="16"/></>, 16, { k: 1.2312, x: -2.775, y: -2.775 })
/* hicon: skip-back */
export const SkipBack = make(<><path d="M8.49999 12L18.2778 19.1111L18.2778 4.88889L8.49999 12Z"/><line x1="0.888889" y1="-0.888889" x2="15.1111" y2="-0.888889" transform="matrix(-4.37114e-08 1 1 4.37114e-08 6.72223 4)"/></>, 16, { k: 1.3854, x: -4.694, y: -4.624 })
/* hicon: skip-next */
export const SkipNext = make(<><path d="M15.5 12L5.72222 19.1111L5.72222 4.88889L15.5 12Z"/><line x1="18.1667" y1="4.88889" x2="18.1667" y2="19.1111"/></>, 16, { k: 1.3854, x: -4.541, y: -4.624 })
/* hicon: shuffle */
export const Shuffle = make(<><path d="M20.5 4.99997C12.7218 4.99997 12 19.1213 5.12133 19.1213"/><path d="M21.4932 4.86951L19.32 8.11408"/><path d="M21.4932 4.86951L18.6937 2.14686"/><path d="M20.5 17.6029C17.9314 17.6029 16.1323 16.0629 14.6269 14.0001M5.12133 3.48165C7.88893 3.48165 9.65985 5.76762 11.2947 8.50006"/><path d="M21.4932 17.7334L19.32 14.4888"/><path d="M21.4932 17.7334L18.6937 20.456"/></>, 16, { k: 1.0759, x: -2.315, y: -0.163 })
/* hicon: repeat */
export const Repeat = make(<><path d="M21 13V11.6C21 8.50721 18.4928 6 15.4 6H4"/><path d="M3 6L6.59998 10"/><path d="M3 6L6.59998 2"/><path d="M3 11V12.4C3 15.4928 5.50721 18 8.6 18H20"/><path d="M21 18L17.4 14"/><path d="M21 18L17.4 22"/></>, 16, { k: 0.985, x: 0.18, y: 0.18 })
/* hicon: sliders-1 */
export const Sliders = make(<><line x1="3" y1="16" x2="7" y2="16"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="17" y1="8" x2="21" y2="8"/><path d="M12 4L12 9M12 20L12 15"/><path d="M19 4L19 5M19 20L19 11"/><path d="M5 4L5 13M5 20L5 19"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: square */
export const Square = make(<><rect x="4" y="4" width="16" height="16"/></>, 16, { k: 1.2312, x: -2.775, y: -2.775 })
/* Four bars at speech heights: sound, not a bar chart. BarChart already means
   data and this means audio, so they stay two icons. Ink 6-18 across, 5-19
   down, so k = 19.7/14 like the other tall glyphs. */
export const Waveform = make(<><line x1="6" y1="9" x2="6" y2="15"/><line x1="10" y1="5" x2="10" y2="19"/><line x1="14" y1="7" x2="14" y2="17"/><line x1="18" y1="10" x2="18" y2="14"/></>, 16, { k: 1.4071, x: -4.886, y: -4.886 })
/* Not from Hicon: the set has no target/reticle glyph, so this one is hand
   drawn to the same rule as the rest -- centred, same fit as the other
   circle-based icons (Clock, Compass), stroke only, no fill. Two rings read
   as a target without needing a third element to say what it means. */
export const Focus = make(<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* ---- weather ----
   Drawn to match this set rather than pulled from a weather pack: same 24 box,
   same stroke, same measured fit, so they sit beside Mic and Waveform without
   looking borrowed. One glyph per condition GROUP, because a brief does not
   need to split light drizzle from moderate drizzle. */
/* sun */
export const Sun = make(<><circle cx="12" cy="12" r="4.5"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/></>, 16, { k: 1.1588, x: -1.906, y: -1.906 })
/* cloud */
export const Cloud = make(<><path d="M7 18h9.5a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18Z"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* sun behind cloud */
export const CloudSun = make(<><circle cx="8.5" cy="8" r="3"/><path d="M8.5 3v1.6M3.5 8h1.6M5 4.5l1.1 1.1M12 4.5l-1.1 1.1"/><path d="M10 18.5h7.5a3.5 3.5 0 0 0 .2-7 4.8 4.8 0 0 0-9.1 1.1A3 3 0 0 0 10 18.5Z"/></>, 16, { k: 1.0368, x: -0.442, y: 0.854 })
/* rain */
export const Rain = make(<><path d="M7 15h9.5a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 15Z"/><path d="M8.5 18v3M12 18.5v2.5M15.5 18v3"/></>, 16, { k: 1.0944, x: -1.133, y: -1.681 })
/* snow */
export const Snow = make(<><path d="M7 15h9.5a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 15Z"/><path d="M9 19h.01M12 20.5h.01M15 19h.01M10.5 21h.01M13.5 21h.01"/></>, 16, { k: 1.0944, x: -1.133, y: -1.681 })
/* fog */
export const Fog = make(<><path d="M7 14h9.5a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14Z"/><path d="M5 17.5h14M7 20.5h10"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* storm */
export const Storm = make(<><path d="M7 14h9.5a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14Z"/><path d="M13 16.5l-3 4h3.5l-2.5 3.5"/></>, 16, { k: 1.0944, x: -1.133, y: -1.954 })
/* hicon: mic. Fit measured like the rest: ink runs 5.5-18.5 across and 3-21
   down, so k = 19.7/18 and the offsets centre that box. */
export const Mic = make(<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: x */
export const Close = make(<><path d="M19 5L5 19"/><path d="M5 5L19 19"/></>, 16, { k: 1.4071, x: -4.886, y: -4.886 })
/* hicon: check */
export const Check = make(<><path d="M15.5 8.99999L9.41421 15.0858"/><path d="M7 13.0858L9.41422 15.0858"/></>, 16, { k: 2.3176, x: -14.074, y: -15.916 })
/* hicon: check-circle-1 */
export const CheckRing = make(<><path d="M15.5 10L11 14.5"/><path d="M9 12.5L11 14.5"/><rect x="3" y="3" width="18" height="18" rx="9"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: eye */
export const Eye = make(<><circle cx="12" cy="12" r="2"/><path d="M3 12C5.36586 14.7393 8.31328 17 12 17C15.6867 17 18.6341 14.7393 21 12"/><path d="M21 12C18.6341 9.53466 15.6867 7 12 7C8.31328 7 5.36586 9.53466 3 12"/></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })
/* hicon: coffee */
export const Cup = make(<><rect x="5" y="11" width="12" height="10"/><path d="M12.5 8C10.7679 8 14.2321 4 12.5 4"/><path d="M8.5 8C6.76795 8 10.2321 4 8.5 4"/><path d="M21 15.5C21 16.8807 19.8807 18 18.5 18C17.1193 18 17 16.8807 17 15.5C17 14.1193 17.1193 13 18.5 13C19.8807 13 21 14.1193 21 15.5Z"/></>, 16, { k: 1.1588, x: -3.065, y: -2.485 })
/* hicon: flag */
export const Flag = make(<><path d="M6 5.84406C6 5.05034 6.90404 4.53696 7.63209 4.85309C9.0023 5.44805 10.9748 6.01377 12.5 5.26923C14.5558 4.26565 17.4244 5.64267 18.5352 6.26305C18.8305 6.42799 19 6.74249 19 7.08074V13.0283C19 13.8471 18.0293 14.3735 17.2778 14.0484C15.9944 13.4932 14.1807 13.0275 12.5 13.7308C10.1037 14.7334 7.43704 13.3598 6.42261 12.7387C6.15074 12.5722 6 12.2731 6 11.9544V5.84406Z"/><line x1="6" y1="6" x2="6" y2="19"/></>, 16, { k: 1.3834, x: -5.293, y: -4.435 })
/* hicon: bar-chart-1 */
export const BarChart = make(<><path d="M12 4L12 20"/><path d="M17 9L17 20"/><path d="M7 9L7 20"/></>, 16, { k: 1.2312, x: -2.775, y: -2.775 })
/* hicon: hourglass-top */
export const Hourglass = make(<><path d="M12 9H11M16.5 18V17.1056C16.5 16.7107 16.3831 16.3247 16.1641 15.9962L14.2996 13.1994C13.8221 12.4831 13.8565 11.5417 14.385 10.8621L16.5787 8.04167C16.8518 7.6906 17 7.25854 17 6.81379V5.70711C17 5.25435 16.8201 4.82015 16.5 4.5C16.1799 4.17986 15.7456 4 15.2929 4L7.70711 4C7.25435 4 6.82014 4.17986 6.5 4.5C6.17986 4.82014 6 5.25435 6 5.70711L6 6.81378C6 7.25854 6.14824 7.6906 6.4213 8.04167L8.61499 10.8621C9.14351 11.5417 9.17791 12.4831 8.70039 13.1994L6.8359 15.9962C6.61687 16.3247 6.5 16.7107 6.5 17.1056L6.5 18C6.5 19.1046 7.39543 20 8.5 20H14.5C15.6046 20 16.5 19.1046 16.5 18Z"/></>, 16, { k: 1.2312, x: -2.159, y: -2.775 })
/* hicon: trash-1 */
/* hicon: edit */
export const Edit = make(<><path d="M14.767 5.01352L17.5484 7.88824L7.48685 17.623L3.94013 18.2717L4.70549 14.7483L14.767 5.01352Z"/></>, 16, { k: 1.4475, x: -3.553, y: -4.848 })

/* ------------------------------------------------------------------
   House glyphs. Hicon has no icon for any of these five meanings, and a
   near-miss from the set would say the wrong thing, so they stay hand-drawn
   and live here rather than inside the page that happens to use them.
   Drop one the moment a real equivalent exists.
   ------------------------------------------------------------------ */

/* A table. Hicon's closest are `grid` and `layout`, which both read as a
   page layout, not a table you type into. */
export const Table = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 10v10" /></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })

/* Add a row / add a column. Nothing in Hicon is about table structure. */
export const TableRowAdd = make(<><rect x="3" y="4" width="18" height="8" rx="1.6" /><path d="M12 15v6M9 18h6" /></>, 16, { k: 1.0944, x: -1.133, y: -1.681 })
export const TableColAdd = make(<><rect x="4" y="3" width="8" height="18" rx="1.6" /><path d="M18 9v6M15 12h6" /></>, 16, { k: 1.0944, x: -1.681, y: -1.133 })

/* A launcher: four app tiles. Hicon's `grid`/`layout` (see Table, above) are
   the likely real equivalent but svgrepo was rate-limiting when this was
   added, so this is a placeholder in the same house-glyph shape. Swap it for
   the sourced Hicon path the next time anyone is in here. */
export const AppsGrid = make(<><rect x="3" y="3" width="8" height="8" rx="1.6" /><rect x="13" y="3" width="8" height="8" rx="1.6" /><rect x="3" y="13" width="8" height="8" rx="1.6" /><rect x="13" y="13" width="8" height="8" rx="1.6" /></>, 16, { k: 1.0944, x: -1.133, y: -1.133 })

/* Clear formatting. The Tx glyph is the convention every editor uses and
   Hicon has no eraser, so borrowing `x` alone would lose the meaning. */
export const ClearFormat = make(<><path d="M6 5h13M9.5 5L7 19M14 12l6 7M20 12l-6 7" /></>, 16, { k: 1.4071, x: -6.293, y: -4.886 })

/* THE DOCK'S OWN FOUR, an explicit exception to the one-set rule above, on
   his instruction (2026-09-04). svgrepo -- where every other icon in this
   file comes from -- blocked every automated request that day (HTTP 429 on
   the homepage itself, not just a specific page), confirmed a second time
   before this was written: not a fluke worth working around inside Hicon.
   Asked him directly rather than quietly reaching for a different family
   on my own judgment; his answer was "any other library... doesn't matter
   if commercial or not." These four are Tabler Icons (MIT licensed,
   github.com/tabler/tabler-icons, fetched straight from its raw source),
   picked specifically for Note, Bills, Timeline and Focus in the floating
   dock and nowhere else -- the rest of the app keeps reading Hicon
   unchanged. Already properly proportioned in their own 24x24 box by
   Tabler's own convention, so fit is the identity transform, not
   measured the way Hicon's own uneven padding required above. */
export const DockNote = make(<><path d="M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14" /><path d="M9 7l6 0" /><path d="M9 11l6 0" /><path d="M9 15l4 0" /></>, 16, { k: 1, x: 0, y: 0 })
export const DockWallet = make(<><path d="M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12" /><path d="M20 12v4h-4a2 2 0 0 1 0 -4h4" /></>, 16, { k: 1, x: 0, y: 0 })
export const DockHistory = make(<><path d="M12 8l0 4l2 2" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></>, 16, { k: 1, x: 0, y: 0 })
export const DockChartBar = make(<><path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6" /><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10" /><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14" /><path d="M4 20h14" /></>, 16, { k: 1, x: 0, y: 0 })

/* The drag grip. Not an icon: a texture that says "this row moves", which is
   why it is dots on a 6x16 field rather than anything on the 24 grid. */
export function Grip({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 6 16" width="6" height="16" className={className} aria-hidden="true">
      <circle cx="1.5" cy="4" r="1" /><circle cx="4.5" cy="4" r="1" />
      <circle cx="1.5" cy="8" r="1" /><circle cx="4.5" cy="8" r="1" />
      <circle cx="1.5" cy="12" r="1" /><circle cx="4.5" cy="12" r="1" />
    </svg>
  )
}
