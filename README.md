# Mission Control

One place to see and run your life. A personal command center with two spaces (Personal and Work, with an All view over both), a plan with honest time estimates, habits, goals and quits, notes, a focus timer, and an AI assistant.

**Live:** https://off-plate.github.io/mission-control/

The whole state is one JSON blob. localStorage is the primary store, so the app works offline; signing in with an emailed code mirrors it to Supabase, scoped to the signed-in account, and devices merge row by row (`src/sync-merge.ts`). AI runs on your own keys (Groq, or Z.ai through the `zai-chat` relay), kept in localStorage and never synced.

## Product laws

1. Today-first: the primary screen answers "what needs my attention today"
2. Alert-by-exception: quiet areas stay quiet
3. Freshness is first-class: stale data looks stale
4. One dead source degrades one part, never the page
5. Under 2 minutes of daily interaction, no guilt mechanics
6. Every number gets context or gets cut

## Stack

Vite + React + TypeScript, with `@supabase/supabase-js` as the only other runtime dependency. Edge functions (calendar proxy, health sync, reel fetch, Z.ai relay) live in `supabase/functions` and are deployed separately from the site.

## Develop

```bash
npm install
npm run dev                # local dev server
npm run build              # type-check + build to docs/ (served by GitHub Pages)
node scripts/qa.mjs        # functional QA and screenshot matrix, against ?noremote
node tools/sync-test.mjs   # offline sync state machine
```
