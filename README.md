# Mission Control

One place to see and run your life. A personal command center with spaces (Personal, Work, Off-Plate), a widget grid you can rearrange and resize, AI task breakdown with honest time estimates, a Time Saved ledger, and a coach for uncomfortable conversations.

**Live demo:** https://off-plate.github.io/mission-control/

This is the Phase 0 demo build. Everything on the page is mock data; no accounts are connected and nothing is stored outside your browser's localStorage. The real build syncs TickTick, Trello, Jira, Gmail, Google Calendar and more into Supabase, with all tokens server-side.

## Product laws

1. Today-first: the primary screen answers "what needs my attention today"
2. Alert-by-exception: quiet areas stay quiet
3. Freshness is first-class: stale data looks stale
4. One dead source degrades one widget, never the page
5. Under 2 minutes of daily interaction, no guilt mechanics
6. Every number gets context or gets cut

## Stack

Vite + React + TypeScript, react-grid-layout v2, no other runtime dependencies. Widget sizes follow iOS-style presets (S, M, T, L, XL) on a square cell grid; one canonical layout order is stored and every breakpoint derives from it. Phone gets a stacked reorder-only view, ultrawide gets a capped centered canvas.

## Develop

```bash
npm install
npm run dev     # local dev server
npm run build   # type-check + build to docs/ (served by GitHub Pages)
```
