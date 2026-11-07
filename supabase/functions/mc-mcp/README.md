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
- `ops.ts`    every operation as a pure function on the state blob (a port of src/store/*.ts)
- `commit.ts` compare-and-swap writer + safety stop (never writes over a save it did not see)
- `index.ts`  the MCP server and the tool list
- test: `node tools/mcp-ops-test.mjs` (includes the app's real merge engine)

## Tools (v1)
Read: get_overview, get_day, list_tasks, list_projects, list_habits, list_notes, get_note, browse.
Write: add_task, update_task, complete_task, reopen_task, set_task_steps, delete_task, add_project,
rename_project, add_note, append_to_note, replace_note, set_note_done, delete_note, tick_habit.

## Not here yet (the tool says so instead of guessing)
Focus timer (client-side state), the time a task took, quit / measured / gated / routine-linked
habits, routines, goals progress, people and prospects writes, bills (compass_* tables), gym,
prompts, the ideas board.

## Deploy
    export SUPABASE_ACCESS_TOKEN=$(cat ~/.config/mission-control/supabase-token)
    npx supabase@latest functions deploy mc-mcp --project-ref fhfempisopwsdkmvywbt --no-verify-jwt --use-api --yes
`--no-verify-jwt` is required: the gateway would reject the unauthenticated discovery request before
the OAuth middleware can answer it. The function verifies the token itself.
