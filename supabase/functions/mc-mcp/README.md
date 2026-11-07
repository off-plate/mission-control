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

## Areas (156 tools)
- core: overview, day, tasks (add, change, finish, reopen, steps, delete), projects, notes, browse
- tasks: bulk add / complete / reopen / update / delete, up to 60 at a time, all or nothing
- growth: habits (every kind), routines, quit habits and slips, amounts, bulk tick, the daily review
- goals: goals (all fields incl. timeframe), progress, milestones, repeat, end-of-period rollover, tasks feeding goals, delete project, tag/colour
- people: people, links between people, contacts, and the Business prospects pipeline (stage, notes, links, next step, replies, delete)
- money: the whole Bills page: this cycle, recurring bills, one-offs, income, debts, ledger transactions, partial and past-cycle payments, end cycle (compass_* tables)
- planning: plan_day (many placements, all or nothing), day_capacity, log_task_time, log_focus, focus_stats, get_calendar
- reminders: lists, reminders with a time, flags and repeats, ticking a repeating one creates the next, bulk add/complete
- library: note extras and folders, ideas board, prompts, gym goals
- focus: start, stop, pause, resume, extend, break, status. Written into the synced `activeFocus` field (the one src/pomodoro.tsx mirrors), so the timer shows on every device on its next sync, no open app needed; stopping early logs the minutes worked

## Safety
Writes are compare-and-swap with a stop that refuses an operation removing more rows than it declared (`allowShrink`
is how a cascade, such as deleting a person with their contacts, declares its exact size). Anything destructive is
annotated destructive so Claude asks first. Tools refuse only where the app itself has no such operation, the value is
derived, or the request is ambiguous; they say why.

## Deploy
    export SUPABASE_ACCESS_TOKEN=$(cat ~/.config/mission-control/supabase-token)
    npx supabase@latest functions deploy mc-mcp --project-ref fhfempisopwsdkmvywbt --no-verify-jwt --use-api --yes
`--no-verify-jwt` is required: the gateway would reject the unauthenticated discovery request before
the OAuth middleware can answer it. The function verifies the token itself.
