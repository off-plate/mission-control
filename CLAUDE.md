# Mission Control

**WHAT:** Personal life command center. Widget dashboard with spaces (Personal, Work, Off-Plate), integrations, AI task breakdown + estimation, Time Saved ledger, coach walkthroughs.
**WHO:** Michael, single user. Phone (iPhone), MacBook, ultrawide.
**WHY:** One place to see and run everything, instead of eight apps and a foggy head.
**MUST:** Today-first, alert-by-exception, freshness badges, per-widget error isolation, no guilt mechanics, no secrets or real financial data in this public repo or bundle, no em dashes anywhere.
**DONE:** Live at off-plate.github.io/mission-control with his own data, real AI (Groq), on-device OCR, and sync behind a login.
**ASK:** Before adding widgets or features beyond the plan; before any deploy beyond Pages.

## Release gate (non-negotiable)

Nothing gets deployed or shown to Michael as "ready" until the release team returns GO. Run the saved workflow `mission-control-release-gate` (Jarvis `.claude/workflows/`); it builds, runs `scripts/qa.mjs` (functional flows + full screenshot matrix into `.qa-shots/`), then a panel of `mc-release-critic` and `persona-michael` (Jarvis `.claude/agents/`) judges the build. Fix every high-severity finding and re-run until GO. This exists because the first demo shipped on self-QA alone and was rejected.

## Rules

- The founding plan and research live in `notes/` (gitignored, personal). Read `notes/PLAN.md` before structural changes.
- Design direction: "flight console on warm paper." **Two typefaces only**, as he asked: Bricolage Grotesque (display) and Instrument Sans (body). `--font-mono` is an alias of the body face, not a third font; JetBrains Mono was removed on his instruction and must not come back. `.mono` now means tabular numerals, not a different family.
- **The Zone is the one exception to the two rules around it, on his explicit
  instruction** (2026-08-10: "completely differentiated... any kind of fonts,
  colors, doesn't matter... this is also one of the few pages that can have
  dark backgrounds... surprise me"). It is a deep-water room with its own
  local `--z-*` tokens, and it loads two extra faces from Fontshare: Array for
  the countdown read-out and Technor for everything around it. Both are scoped
  to that page. Do not "fix" either back to the app defaults, and do not let
  them leak onto any other page.
- **Light only.** There is no dark mode and no `data-theme` anywhere in the CSS. Do not write docs, tokens or review notes that assume one; if dark mode is ever wanted, it is a project, not an afterthought. The Zone being dark is not a theme: it repaints itself on one page, it does not switch one.
- **No subtitles anywhere.** Jarvis DESIGN.md's hard rule applies in full: no line under a page title, section heading or card title, no eyebrow, no cadence label beside a title that implies it. Do not add a `sub`/`note`/`description` prop to a heading component. The only thing allowed under a heading is a fact that appears nowhere else and that he can act on.
- Jarvis DESIGN.md anti-slop canon applies, EXCEPT the color system is a deliberate documented expansion: see `COLOR.md`. Semantic roles: accent = interactive and the active space's identity (**Personal burnt orange `#d1502a`, Work navy `#1d4e79`, Off-Plate gold `#8a6410`**), coral `--alert` = urgent/debt, amber `--warn` = at-risk, green `--progress` = yours/progress (never debt), info-slate = plain data, plus muted category dots. Read COLOR.md before touching any color; keep its discipline or it becomes slop.
- Layout truth is ORDER + size presets, never per-breakpoint coordinates. Phone (<640px) is a stacked reorder-only list by design; do not enable grid drag on touch.
- `npm run build` outputs to `docs/` for GitHub Pages with base `/mission-control/`. Keep the demo build free of network calls and secrets; the real backend (Netlify + Supabase) is a separate build profile, never this one.
- The app holds his real life now, so the old "mock data must stay obviously invented" rule is about what ships in the repo, not what he types: no real creditor names, balances or personal identifiers in `src/mock.ts` or anywhere else committed.
- **Nothing that reaches Supabase may be readable without a session.** The anon key ships inside the page, so an open anon RLS policy means public data; that shipped once and was fixed on 2026-07-27. Every `mc_state` row is owned and scoped to `auth.uid()`. Sign-in is an 8-digit emailed code (the shared project's template is Compass's and sends a code, not a link). The Groq key lives in localStorage only and is never synced.
- Playwright checks must run against `?noremote`, which disables Supabase entirely, so a test can never touch his live data.
- This project's memory lives in Jarvis (`project_life_command_center`). Log meaningful decisions in Jarvis `decisions/log.md`.
