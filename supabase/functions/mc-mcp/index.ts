// Mission Control as a Claude connector (MCP over Streamable HTTP).
//
// Claude (web, desktop, mobile, Claude Code) adds this URL as a custom connector:
//   https://<project>.supabase.co/functions/v1/mc-mcp
// and signs in through Supabase's OAuth server (consent page: /oauth/consent on the
// dashboard site). Every tool runs as HIM: the client below is scoped to his token,
// so the database's own row-level rules keep it to his data. The service-role client
// the library also offers (supabaseAdmin) is never touched here.
//
// Deployed with --no-verify-jwt: the gateway would otherwise reject the unauthenticated
// discovery request before withOAuthProtectedResource can answer it. withSupabase
// verifies the token itself, against the project's signing keys.
//
// The tools live in tools-<area>.ts, each exporting register(r). Add a module: import it
// below and add it to MODULES.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@1'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1'
import { z } from 'npm:zod@^4.3.6'

import { makeReg } from './reg.ts'
import { register as core } from './tools-core.ts'

const MODULES = [core]

const INSTRUCTIONS = `This is Michael's Mission Control: his personal life dashboard (tasks, habits, routines, goals, notes, people, bills).
- Start with get_overview or get_day. Dates are YYYY-MM-DD in Prague time; times are HH:MM, 24 hour.
- Name a task, note, habit, person or anything else only by an id or title you read from a list or lookup. Ids are exact; titles must match one row or the tool refuses and lists the candidates.
- A change tool changes his real data and returns what it did. Never claim something changed unless the tool said so.
- Work (the "work" space) is his job at Big Time. Everything else is "personal". Off-Plate and Michael's Corner are projects inside personal.
- When a tool refuses, read why and tell him; do not retry with guessed ids.`

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase({ auth: 'user' })],
    async (req, { supabase, userClaims }) => {
      const uid = userClaims?.id
      if (!uid) return new Response('Unauthorized', { status: 401 })
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: 'mission-control', version: '0.2.0' }, { instructions: INSTRUCTIONS })
        const r = makeReg({ server, z, db: supabase, uid })
        for (const register of MODULES) register(r)
        return server
      }, { onerror: (error: unknown) => console.error('MCP request failed', error instanceof Error ? error.message : String(error)) })
      return handler.fetch(req)
    },
  ),
)
