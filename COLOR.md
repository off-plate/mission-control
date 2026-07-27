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

- **Personal** → burnt orange `#d1502a` (base)
- **Work** → navy `#1d4e79`
- **Off-Plate** → gold / ochre `#8a6410`

Set via `data-space` on `<html>`. The app is light only: there is no dark mode and no `data-theme`, so nothing here is theme-qualified. All three accents hit WCAG AA on `--bg` and `--surface`.

## Priority when roles collide on one element

`danger (coral) > interactive (accent) > at-risk (amber) > category identity`. A card shows one colored signal at a time; the rest is neutral.

## Don'ts (these are how it becomes slop)

- No category hue at full saturation, and none near the interactive accent's saturation.
- No category color on backgrounds, buttons, or large fills. Dots/edges/small pills only.
- No green anywhere near debt or owed money, and never as a category.
- No fifth functional color. More color comes from the muted category set, never the functional set.
- No purple/indigo/violet, no gradients, no glass. Richness = many quiet hues on warm paper, the opposite aesthetic.
