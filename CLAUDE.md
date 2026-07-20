# Mission Control

**WHAT:** Personal life command center. Widget dashboard with spaces (Personal, Work, Off-Plate), integrations, AI task breakdown + estimation, Time Saved ledger, coach walkthroughs.
**WHO:** Michael, single user. Phone (iPhone), MacBook, ultrawide.
**WHY:** One place to see and run everything, instead of eight apps and a foggy head.
**MUST:** Today-first, alert-by-exception, freshness badges, per-widget error isolation, no guilt mechanics, no secrets or real financial data in this public repo or bundle, no em dashes anywhere.
**DONE:** Phase 0 demo (mock data) live at off-plate.github.io/mission-control.
**ASK:** Before adding widgets or features beyond the plan; before any deploy beyond Pages.

## Release gate (non-negotiable)

Nothing gets deployed or shown to Michael as "ready" until the release team returns GO. Run the saved workflow `mission-control-release-gate` (Jarvis `.claude/workflows/`); it builds, runs `scripts/qa.mjs` (functional flows + full screenshot matrix into `.qa-shots/`), then a panel of `mc-release-critic` and `persona-michael` (Jarvis `.claude/agents/`) judges the build. Fix every high-severity finding and re-run until GO. This exists because the first demo shipped on self-QA alone and was rejected.

## Rules

- The founding plan and research live in `notes/` (gitignored, personal). Read `notes/PLAN.md` before structural changes.
- Design direction: "flight console on warm paper." Cabinet Grotesk + General Sans + JetBrains Mono (data only). Accent `#0B3D91` (flight blue), coral `#BD3A1C` strictly for exceptions, green strictly for progress you own, never for money owed. Light and dark both first-class. Jarvis DESIGN.md anti-slop canon applies in full.
- Layout truth is ORDER + size presets, never per-breakpoint coordinates. Phone (<640px) is a stacked reorder-only list by design; do not enable grid drag on touch.
- `npm run build` outputs to `docs/` for GitHub Pages with base `/mission-control/`. Keep the demo build free of network calls and secrets; the real backend (Netlify + Supabase) is a separate build profile, never this one.
- Mock data must stay obviously invented. No real creditor names, balances, or personal identifiers.
- This project's memory lives in Jarvis (`project_life_command_center`). Log meaningful decisions in Jarvis `decisions/log.md`.
