import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { useMundiOpus } from './mundiplayer'
import { MediaBadge, MediaChip, PomodoroInline } from './pomodoro'
import { NoteChip, NotePanel } from './notedock'
import { BillsChip, BillsPanel } from './billsdock'
import { TimelineChip, TimelinePanel } from './timelinedock'
import * as Icon from './icons'

/* Hover opens the dial now, on his instruction (2026-09-02) -- the same
   show/hide-with-a-grace-period pattern the header's nav row already uses
   (see useNavReveal in App.tsx), not a second thing to maintain. Hovering
   the FAB, the stack, an icon or a label all count as "still here": they're
   all plain flow children of one .dock, so a single enter/leave pair on the
   wrapper covers every one of them without the gap-in-the-hitbox problem
   the nav row hit once (that was an absolutely positioned child rendered
   outside its parent's own box; nothing here is). Leaving starts a one
   second timer, same as the nav row, before the close itself begins.

   Closing was a second gap he caught right after: the menu only ever had an
   entrance animation (dock-item-in, plays once on mount), so both a click on
   the X and the hover timer just unmounted it instantly -- no exit motion
   either way. He read the click as "having" one anyway because it's a
   direct action; the same snap after a full second of waiting read as
   broken. Fixed by routing both paths through closeMenu below, which holds
   the menu mounted with an .is-closing class (dock-item-out, the reverse of
   the entrance keyframe) for CLOSE_MS before the state actually flips to
   'closed' -- one real close animation, not two different behaviors. */
const HOVER_HIDE_MS = 1000
const CLOSE_MS = 200
// The entrance's own longest total (last item's delay + its duration,
// styles.css) -- how long the stack takes to fully finish opening.
const ENTER_MS = 340
// Reaching the full page: a normal click still opens the quick popup, and
// holding the same item down for HOLD_MS instead. Matches CSS
// .dock-item.is-holding's own transition-duration exactly (styles.css) --
// the one JS/CSS coupling in this file that's a literal, not a var(),
// since threading a CSS custom property through just to avoid one repeated
// number was the worse trade for something this small.
const HOLD_MS = 520

/* His pick (2026-09-03), from three options laid out for him: reaching a
   full page today costs a hover and TWO clicks -- one to open the item's
   quick popup, a second on the popup's own door-out button. A held press on
   the stack item itself jumps straight there instead, one hover and one
   press, while a normal click keeps opening the popup exactly as it always
   has. Chosen over the alternatives -- splitting the row into two targets
   (extending what Focus's row already does), or a small corner badge --
   because a hidden gesture, unlike those two, adds literally nothing new to
   look at on a menu that already works hard to stay small. The real cost of
   that choice is discoverability, so is-holding (styles.css) fills the
   label and avatar's border into the same accent color a hover already
   uses, timed to finish exactly when the hold does -- the one visible
   sign, the first time, that holding does something. */
function useHoldForFull(onFull: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const [holding, setHolding] = useState(false)
  const clear = () => { if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined } }
  useEffect(() => clear, [])
  const start = () => {
    fired.current = false
    clear()
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      fired.current = true
      setHolding(false)
      onFull()
    }, HOLD_MS)
    setHolding(true)
  }
  const cancel = () => { clear(); setHolding(false) }
  return {
    holding,
    handlers: {
      onMouseDown: start, onMouseUp: cancel, onMouseLeave: cancel,
      onTouchStart: start, onTouchEnd: cancel, onTouchCancel: cancel,
      // The hold already fired and navigated away by the time mouseup/
      // touchend would otherwise let a click through -- this is a backstop
      // for the rare case that DOM removal doesn't win the race, not the
      // primary guard (cancel() on mouseup already stops a normal click
      // from being treated as a hold).
      onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false } },
    },
  }
}

function useDockMenu() {
  const [mode, setMode] = useState<Mode>('closed')
  const [closing, setClosing] = useState(false)
  /* His second report (2026-09-03): canceling a close mid-collapse (hover
     back in before it finishes) played the WHOLE entrance a second time --
     "another animation going through, all the buttons kinda click." Cause:
     .is-closing switches .dock-item's animation-name to dock-item-out;
     removing that class on cancel reverts it to dock-item-in, and changing
     an element's animation-name restarts that animation from scratch even
     though dock-item-in had already played and finished once before the
     close attempt began -- confirmed directly by tracing animationstart
     events through exactly this sequence (open, leave past the grace
     period so the close actually starts, return mid-collapse): dock-item-in
     fired a second time for all three items, ~1.5s after the first.
     `entered` tracks whether THIS open's entrance has already finished --
     once true, .dock gets is-open instead of is-entering, which turns the
     item's animation off entirely, so there is nothing left for a
     cancelled close to revert BACK to. Reset only when mode actually
     leaves 'menu', so the next fresh open still gets the real entrance. */
  const [entered, setEntered] = useState(false)
  // Mirrors `mode` for the timers below to read synchronously -- they must
  // never act on a setState *updater's* side effect (React can invoke those
  // more than once), so reading current mode happens off this ref instead.
  const modeRef = useRef<Mode>('closed')
  useEffect(() => { modeRef.current = mode }, [mode])
  const timer = useRef<number | undefined>(undefined)
  const clear = () => { if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined } }
  useEffect(() => clear, [])

  useEffect(() => {
    if (mode !== 'menu') { setEntered(false); return }
    const id = window.setTimeout(() => setEntered(true), ENTER_MS)
    return () => window.clearTimeout(id)
  }, [mode])

  // Plays the collapse, then flips to 'closed' once it's done. Safe to call
  // more than once mid-animation (a second X click, or the hover timer
  // firing after a click already started it) -- it just restarts the same
  // wait, never stacks two.
  const closeMenu = () => {
    clear()
    setClosing(true)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setClosing(false)
      setMode('closed')
    }, CLOSE_MS)
  }
  // Any deliberate move to a different mode (a panel, or back open) cancels
  // whatever close was pending -- a stale timer firing later must not yank
  // a panel he already switched to back to 'closed'.
  const go = (next: Mode) => { clear(); setClosing(false); setMode(next) }

  const hover = {
    onMouseEnter: () => { clear(); setClosing(false); setMode((m) => (m === 'closed' ? 'menu' : m)) },
    onMouseLeave: () => {
      clear()
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        // Only the menu hover-closes, and only if it's still open by the
        // time this fires (a click may have moved it to a panel already).
        if (modeRef.current === 'menu') closeMenu()
      }, HOVER_HIDE_MS)
    },
  }

  return { mode, closing, entered, go, closeMenu, hover }
}

/* THE DOCK: a Material speed-dial FAB (his reference, 2026-09-01). Closed,
   one round button. Tapping it fans a labelled item out per tool, stacked
   upward -- Note on top, Focus closest to the corner, his order -- and the
   FAB itself becomes the X at the bottom of that stack; only the X closes
   it back down.

   Focus does not open anything, on his second correction of this same
   round: a first pass had it either auto-start a block on tap or open a
   content-sized popover, and neither was right -- "it's gonna live within
   that menu and be operated within that menu." Its row IS the control: the
   name, the live time, and a play/pause button sit right there, always,
   whenever the menu is open (see PomodoroInline in pomodoro.tsx). The
   circular icon next to it goes back to what it always did on the old pill
   -- opens the Focus history page -- since the timer itself has nothing
   left to open.

   Note and the player still open into the full-size face below (unchanged
   from earlier rounds) -- his word was only about Focus: "different story
   is for the notes... that's fine."

   Each tool still owns its own state and logic in its own file (usePomodoro,
   the notes store) and only hands this file what it needs to render.
   Rendered from inside PomodoroProvider (see pomodoro.tsx), which is what
   puts it inside both the Pomodoro context and the Store context it needs. */
type PanelFace = 'media' | 'note' | 'bills' | 'timeline'
type Mode = 'closed' | 'menu' | PanelFace

export function Dock() {
  const { page, setPage } = useStore()
  const mo = useMundiOpus()
  const { mode, closing, entered, go, closeMenu, hover } = useDockMenu()
  // Fixed, not looped over panels: hooks can't vary in count between
  // renders, and only Note, Bills and Timeline have a full page to hold
  // for -- the player has none (see PanelFace/Mode above), so it never
  // gets one.
  const noteHold = useHoldForFull(() => { setPage('notes'); go('closed') })
  const billsHold = useHoldForFull(() => { setPage('bills'); go('closed') })
  const timelineHold = useHoldForFull(() => { setPage('timeline'); go('closed') })
  const holdFor: Partial<Record<PanelFace, ReturnType<typeof useHoldForFull>>> = { note: noteHold, bills: billsHold, timeline: timelineHold }

  /* The Zone already shows the timer, the player and a place to write at
     full size. A second, smaller copy of the same facts in the corner is
     not a safety net, it is noise competing with the one thing the room
     exists to make dominant. */
  if (page === 'zone') return null

  /* Note on top, then Bills, then Timeline, Focus at the bottom, his order
     -- closest to the corner is the one he reaches for most. The player,
     when it exists at all, sits above both: rarest to need, so furthest
     from the thumb. Bills and Timeline both land here as compact
     read-mostly summaries, not their full pages -- see billsdock.tsx and
     timelinedock.tsx for why: hundreds of lines of sign-in, edit sheets,
     a canvas flywheel view and video reels are a much bigger, worse-
     fitting build for a 560px popup than a glanceable headline with a
     door out to the real page.

     Icons sized up across the row (2026-09-04): the chip circles are 56px
     and were carrying a 16-18px glyph, a lot of empty ring around not much
     ink. His ask was also for genuinely DIFFERENT, better icons via
     svgrepo -- couldn't do that part. svgrepo blocked every automated
     fetch (collection pages, the author page, individual icon pages, all
     429) while unrelated sites answered fine, so it reads as deliberate
     bot protection, not a fluke worth retrying. Icons.tsx's own header is
     also explicit that this file draws from exactly one source (Hicon
     Circular Interface Icons) on purpose -- "two exports that do the same
     job... is how a set stops being a set" -- so pulling in a different
     family to route around the block was the wrong fix even if it had
     worked. The two already-in-file icons that would have fit Timeline
     better (Hourglass, Clock) are both already spoken for elsewhere for a
     different meaning (a task's time estimate; the focus timer), so
     swapping either in here would have created the exact "one icon, two
     jobs" confusion that rule exists to prevent. Real icon research still
     needs svgrepo actually reachable -- next move there is his call. */
  const panels: { id: PanelFace; label: string; chip: React.ReactNode; switchIcon: React.ReactNode }[] = [
    ...(mo.started ? [{ id: 'media' as const, label: 'Player', chip: <MediaChip />, switchIcon: <Icon.Waveform size={17} /> }] : []),
    { id: 'note' as const, label: 'Note', chip: <NoteChip />, switchIcon: <Icon.Note size={17} /> },
    { id: 'bills' as const, label: 'Bills', chip: <BillsChip />, switchIcon: <Icon.Wallet size={17} /> },
    { id: 'timeline' as const, label: 'Timeline', chip: <TimelineChip />, switchIcon: <Icon.Rewind size={17} /> },
  ]

  if (mode === 'closed' || mode === 'menu') {
    // One <button> for the FAB/X across both states, always the wrapper's
    // last child -- his first flicker report. Two separate returns used to
    // put a plain <button className="dock-fab"> at position 0 when closed,
    // and, once open, an unrelated <div className="dock-menu"> at position 0
    // with the X as a brand NEW button at position 1: React reconciles
    // children by position, saw two different element types at 0, and
    // destroyed/recreated the FAB every single open or close even though it
    // never actually moves on screen. Removing a DOM node out from under a
    // resting cursor fires a native mouseout that bubbles as a React
    // mouseleave on .dock -- which the hover machinery reads as "he left" --
    // so opening or closing could silently reschedule (or cancel) a hover
    // timer no real mouse movement asked for. That's what the disappearing
    // first hover and the reopening mid-close both traced back to. Now the
    // menu is just an optional sibling ahead of one persistent button --
    // React patches its class/icon/handler in place, never touches the node.
    const open = mode === 'menu'
    return (
      <div
        className={`dock${closing ? ' is-closing' : entered ? ' is-open' : ''}`}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
      >
        {open && (
          <div className="dock-menu">
            {panels.map((t) => {
              const hold = holdFor[t.id]
              return (
                <button
                  key={t.id}
                  className={`dock-item${hold?.holding ? ' is-holding' : ''}`}
                  onClick={() => go(t.id)}
                  {...hold?.handlers}
                >
                  <span className="dock-item-label">{t.label}</span>
                  {/* The ring lives on this wrapper, not on .dock-item-avatar
                     itself -- the avatar's own overflow:hidden (there to
                     mask album art into the circle) was silently clipping
                     it away, invisible in a real browser despite every
                     computed style reading correctly. See the note on
                     .dock-item-avatar-ring in styles.css. */}
                  <span className="dock-item-avatar-ring">
                    <span className={`dock-item-avatar dock-item-avatar--${t.id}`}>{t.chip}</span>
                  </span>
                </button>
              )
            })}
            {/* Not a button: it holds two real controls of its own
                (play/pause, and the icon below), and a button can't nest
                inside a button -- see the same note on weekplan-bar in
                styles.css from an earlier fix of the identical mistake. */}
            <div className="dock-item dock-item--focus">
              <span className="dock-item-label dock-item-label--focus">
                <PomodoroInline />
              </span>
              <button className="dock-item-avatar dock-item-avatar--focus" onClick={() => setPage('focus')} aria-label="Open the focus history" title="Open Focus">
                <Icon.BarChart size={22} />
              </button>
            </div>
          </div>
        )}
        <button
          className={`dock-fab${open ? ' is-close' : ''}`}
          onClick={() => (open ? closeMenu() : go('menu'))}
          aria-label={open ? 'Close quick tools' : 'Open quick tools'}
        >
          {/* Both icons stay mounted always -- a second layer of the same
              node-identity bug the button itself just got fixed for. Even
              with one stable <button>, swapping which icon lives inside it
              (Plus vs Close, two different components) destroys and
              recreates an SVG sitting exactly where the cursor rests -- and
              proved by direct event tracing to fire a phantom mouseenter on
              .dock when the browser redoes hit-testing under that mutation.
              With mode='closed' already committed, that phantom read as "he
              just hovered back in" and reopened the menu a beat after it had
              correctly closed; the same mechanism firing a phantom leave
              right after a real hover-open explains his first report, the
              menu vanishing on an early hover with no real mouse movement to
              cause it. CSS opacity on two always-present icons swaps the
              glyph without ever touching the DOM under the pointer. */}
          <Icon.Plus size={22} className={`dock-fab-icon${open ? ' is-hidden' : ''}`} />
          <Icon.Close size={20} className={`dock-fab-icon${open ? '' : ' is-hidden'}`} />
        </button>
      </div>
    )
  }

  const other = panels.filter((t) => t.id !== mode)
  const switchButtons = (
    <>
      {/* Jumping straight to the other panel, not just back to the menu: the
          menu is one tap away, this is the one he'll reach for more. */}
      {other.map((t) => (
        <button key={t.id} className="dock-icon" onClick={() => go(t.id)} aria-label={`Switch to ${t.label}`} title={t.label}>
          {t.switchIcon}
        </button>
      ))}
      <button className="dock-icon" onClick={() => go('closed')} aria-label="Close" title="Close">
        <Icon.Close size={17} />
      </button>
    </>
  )

  /* Note builds its own single head row -- the switcher, new, open-in-Notes,
     and now these switch/close controls all together, on his correction
     (2026-09-01): a near-empty bar sitting above a full one read as two
     rows for one job. Media has no head row of its own to fold these into
     yet, so it keeps the standalone bar above it for now. */
  if (mode === 'note') {
    return (
      <div className="dock">
        <div className="dock-face">
          {/* His ask (2026-09-02): clicking through to the full Notes page
             should leave the dock behind, not sit open on the note he just
             left. go('closed') is the same plain close the panel's own X
             already uses -- no animation was ever built for closing a face,
             only for the speed-dial stack, so this stays consistent with
             that rather than inventing a second closing style. */}
          <NotePanel dockControls={switchButtons} onOpenFull={() => go('closed')} />
        </div>
      </div>
    )
  }

  /* Bills gets the same single-row head as Note, for the same reason --
     it's the same door-out button (see billsdock.tsx), so the same
     near-empty-bar-above-a-full-one problem would just repeat here. */
  if (mode === 'bills') {
    return (
      <div className="dock">
        <div className="dock-face">
          <BillsPanel dockControls={switchButtons} onOpenFull={() => go('closed')} />
        </div>
      </div>
    )
  }

  if (mode === 'timeline') {
    return (
      <div className="dock">
        <div className="dock-face">
          <TimelinePanel dockControls={switchButtons} onOpenFull={() => go('closed')} />
        </div>
      </div>
    )
  }

  return (
    <div className="dock">
      <div className="dock-face">
        <div className="dock-facebar">
          <span className="dock-facebar-grow" />
          {switchButtons}
        </div>
        <MediaBadge />
      </div>
    </div>
  )
}
