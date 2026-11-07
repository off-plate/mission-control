# mc-mcp: Mission Control as a Claude connector

A remote MCP server (Streamable HTTP) on a Supabase Edge Function. Claude on the web,
desktop, iOS and Android, and Claude Code, add the URL below as a custom connector and can
then read and operate Mission Control by talking.

    https://fhfempisopwsdkmvywbt.supabase.co/functions/v1/mc-mcp

## Sign-in
Supabase's OAuth 2.1 server (Authentication > OAuth Server: on, dynamic registration on,
authorization path `/oauth/consent`). The consent page lives in the jarvis-dashboard repo
(`app/oauth/consent/page.tsx`, the project's Site URL). It signs him in with the 8-digit code,
only accepts his email, and refuses any request whose return address is not Claude's own.
Every tool runs as HIM: the client is scoped to his token, so row-level security keeps it to his
rows. The library's service-role client is never used.

## Files
- `ops.ts`, `commit.ts`, `reg.ts`  shared: pure operations on the state blob, the compare-and-swap writer + safety stop, the registration layer
- `ops-<area>.ts` + `tools-<area>.ts`  one pair per area; `index.ts` registers them all (MODULES)
- tests: `tools/mcp-*-test.mjs` (each area, `mcp-all-test.mjs` registers everything together), kit in `tools/mcp-test-kit.mjs`

## Areas (101 tools)
- core: overview, day, tasks (add, change, finish, reopen, steps, delete), projects, notes (add, append, rewrite, tick, delete), browse
- growth: habits (every kind), routines, quit habits and slips, amounts/counts
- goals: goals, progress, milestones, repeat, tasks feeding goals, delete project, project tag/colour
- people: people and the Business prospects pipeline, contact log
- money: this cycle's bills, debts, transactions; mark paid, skip, expense, income (compass_* tables)
- planning: plan_day (many placements, all or nothing), day_capacity, log_task_time, log_focus, focus_stats, get_calendar
- library: note extras and folders, ideas board, prompts, gym goals
- focus: start_focus, stop_focus, pause_focus, resume_focus, extend_focus, start_break, get_focus_timer. Written into the synced `activeFocus` field (the same one src/pomodoro.tsx mirrors), so the timer shows on every device on its next sync, with no open app needed; stopping early logs the minutes worked

## Not here (each tool says so instead of guessing)
Editing or deleting recurring bills, debts and income; partial bill payments; deleting prospects; changing a goal's
timeframe; a few multi-row deletes the safety stop refuses (a person with several logged contacts, a project with many
tasks: use move or the app); AI task breakdown (Claude writes the steps itself with set_task_steps).

## Deploy
    export SUPABASE_ACCESS_TOKEN=$(cat ~/.config/mission-control/supabase-token)
    npx supabase@latest functions deploy mc-mcp --project-ref fhfempisopwsdkmvywbt --no-verify-jwt --use-api --yes
`--no-verify-jwt` is required: the gateway would reject the unauthenticated discovery request before
the OAuth middleware can answer it. The function verifies the token itself.
