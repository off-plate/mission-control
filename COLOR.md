# Mission Control — Semantic Color System

Color here is **meaning, not decoration**. Michael asked for "a bit more color so it doesn't feel blunt, change colors to what's important, what's interactive, what's just informative." This is the answer, built from how Linear, Stripe, Superhuman, Notion, Sunsama and Copilot use color (research 2026-07-20, summary in notes/).

This file is a **deliberate, project-specific expansion** of the global Jarvis DESIGN.md "one accent color max" default. The project wins. The discipline that keeps it from becoming AI slop is below; follow it or the whole thing collapses into a rainbow.

## The core rule

**Saturation is the interactivity signal.** Exactly one hue at full saturation on any surface, and it always means "you can act here." Everything informative is either neutral or a *muted* version of a hue. If it is not the saturated accent, it is not clickable.

## Two layers

### 1. Functional layer (fixed meaning everywhere, never decorative)

| Role | Token | Means | Where |
|---|---|---|---|
| **Interactive** | `--accent` | you can click/tap/act; also the active space's identity | buttons, links, active tab, focus ring, active space pill, first-move label, "next event" time, next agenda time, sparklines, `est-chip:hover` |
| **Urgent / danger** | `--alert` (coral) | overdue, not sent, action needed, past deadline, debt figures, stale data | alert chips + dots, "not sent" / "action needed" tags, total-debt-remaining, negative deltas, drifting-badly. **Never a button.** |
| **At-risk / warning** | `--warn` (amber) | approaching, pending, drifting-but-not-failed | "waiting" / "pending" payment tags, "DRIFTING" goal badge, warn progress bars. Second alert tier below coral. |
| **Positive / progress** | `--progress` (green) | money you have, done, on track, agreed, streak, net time saved | safe-to-spend, checked habits, done rows, "on track", "agreed", positive deltas. **Reserved — never on debt/owed, never a category, never decoration.** |
| **Informative** | `--info` (cool slate) | plain data, so information reads as information | timestamps/freshness, est chips, source tags, mono meta, "scheduled" tag, next-event value |
| **Neutral** | `--ink` / `--muted` / `--faint` / `--hairline` | structure, chrome, body text | most of the UI; carries hierarchy via a surface ladder + hairlines, not color |

### 2. Categorical layer (identity only, muted, dots only)

One quiet, low-saturation hue per task category, shown **only as an 8px dot** at the row start. Never a fill, never a button, never green, never the accent's saturation.

| Category | Token | Hue |
|---|---|---|
| call | `--cat-call` | clay |
| admin | `--cat-admin` | slate blue (desaturated, ≠ interactive blue) |
| deep | `--cat-deep` | warm brown |
| quick | `--cat-quick` | dusty teal |

## Per-space accent identity

The interactive accent changes per space, so switching rooms visibly changes the room (Sunsama's color-by-channel, on the interactive layer):

- **All** → red `#D71921` (his call, 2026-10-28: one palette across the Nothing phone app and the classic desktop), hover fill `#B8141C`, text partner `#C4151D`
- **Personal** → emerald `#00874A`, hover fill `#006B3A`, text partner `#00733F`
- **Work** → cobalt `#2453E6`, hover fill `#1D44C2`, text partner `#2453E6`

All three are dark fills, so the text on an accent fill is white: the token `--a-on-accent` (`#FFFFFF`), used wherever a rule fills with the accent. The dark rooms keep dark text on their own bright accent (HUD cyan, the Jar pages' lime) by setting `--a-on-accent` in their token blocks. White on each fill is 5.2, 4.6 and 6.1 to 1; each text partner is above 4.5 on `--bg`, `--surface` and `--surface-2`.

Known tension: the All accent is red, and `--alert` (coral, urgent and debt) is a brick red. Buttons are saturated red, alerts are the darker coral: keep alerts to text, dots and outlines, never a filled button, so the two stay apart.

Set via `data-space` on `<html>`. The app is light only: there is no dark mode and no `data-theme`, so nothing here is theme-qualified. All three accents hit WCAG AA on `--bg` and `--surface`.

## Priority when roles collide on one element

`danger (coral) > interactive (accent) > at-risk (amber) > category identity`. A card shows one colored signal at a time; the rest is neutral.

## Don'ts (these are how it becomes slop)

- No category hue at full saturation, and none near the interactive accent's saturation.
- No category color on backgrounds, buttons, or large fills. Dots/edges/small pills only.
- No green anywhere near debt or owed money, and never as a category.
- No fifth functional color. More color comes from the muted category set, never the functional set.
- No purple/indigo/violet, no gradients, no glass. Richness = many quiet hues on warm paper, the opposite aesthetic.

## The deliberately dark surfaces

The app's own pages (Today, Plan, Habits & Goals, Calendar, Goals) are light
only — no `data-theme`, no light/dark toggle on the main chrome. That said,
by 2026-09 there are five surfaces that ARE dark on purpose, each its own
documented, scoped exception. Do not "fix" any of them back to the light
palette, and do not treat any one of them as precedent for making some OTHER
surface dark — each earned its own case:

- **The Wall (Why's)** — a dark poster wall with its own highlight colour,
  the original exception here: deliberate art direction, meant to feel like
  a different room.
- **The Zone** — its own `--z-*` tokens, always dark regardless of theme.
- **Timeline** — its own `--tl-*` tokens (`styles.css`), always dark. Its
  faint-label tone (`--tl-faint`) failed WCAG AA against its own background
  (~2.5:1) until fixed 2026-09-04 — a reminder that "dark surface" still
  owes every text token a real contrast check against ITS OWN background,
  not the light palette's.
- **Today's `.troom` slab** — a dark card inset into the otherwise-light
  Today page.
- **HUD mode** (`.shell.is-hud`, toggled via the helmet icon, persisted in
  `localStorage['mc:hud']`) — a real, separate opt-in dark skin that remaps
  color tokens app-wide. Any component that pairs `background: var(--a-accent)`
  with `color: var(--a-ink)` needs an explicit `.shell.is-hud` override to
  `#04141A` (see `styles.css` around `.shell.is-hud .btn-primary`) — `--a-ink`
  is redefined pale for HUD's own FAB icon, so without that override an
  active-state fill silently goes near-invisible (~1.5:1), which is exactly
  what happened to the active nav tab and the active Habits/Goals toggle
  until fixed 2026-09-04.

## Project tag tones (2026-10-25)

A task's `#hashtag` is coloured by its project so related tasks can be spotted
at a glance (his ask). Six quiet text tones, `.tt0` to `.tt5` in styles.css:
denim, teal, rust, bronze, wine, slate. Text only, never a fill or a border,
each at 4.5:1 or better on the card. None is green, coral, amber or violet, so
a tag never borrows a functional meaning. Folders keep their workspace colour.
