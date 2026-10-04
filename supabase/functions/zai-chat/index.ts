/* The Z.ai relay.

   Z.ai answers a browser's request with a CORS error: confirmed live
   (2026-09-08) against his real key from his real browser, DevTools open,
   the actual "completions" request marked red with "CORS error" in the
   Network panel, its own preflight already having passed. The preflight
   succeeding and the real request still being blocked means Z.ai's server
   never sends back access-control-allow-origin at all -- not a header this
   app got wrong, a choice made entirely on their end, and a browser cannot
   route around that no matter what the request looks like. Groq and Gemini
   were both checked for exactly this before this app ever relied on either;
   Z.ai was the one provider added without that check, because there was no
   way to make it without his own key in his own browser. This function does
   the fetch server-to-server instead, where CORS never applies.

   SIGNED-IN CALLERS ONLY (2026-10-04). It used to run with the JWT check
   off so a pasted key alone was enough, which made it an open relay: anyone
   could stream their own Z.ai traffic through his project. Now it asks for
   his Supabase session on Authorization (see _shared/owner.ts for why the
   platform's own JWT check is not enough), and his Z.ai key rides in
   x-zai-key, forwarded upstream untouched, never read, logged or stored.

   Streamed straight through both ways: the browser sent stream:true expects
   SSE back, and buffering the whole reply here just to re-emit it would
   trade the live-typing effect for nothing.

   Deploy (JWT check ON, the default):
     supabase functions deploy zai-chat */

import { isOwner } from '../_shared/owner.ts'

const ALLOW = [
  'https://off-plate.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ALLOW.includes(origin) ? origin : ALLOW[0],
  'access-control-allow-headers': 'authorization, x-zai-key, apikey, x-client-info, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'vary': 'origin',
})

const ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions'

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return new Response('POST only.', { status: 405, headers: cors(origin) })

  if (!(await isOwner(req))) return new Response('Not allowed.', { status: 401, headers: cors(origin) })
  const key = req.headers.get('x-zai-key')
  if (!key) return new Response('No key.', { status: 401, headers: cors(origin) })

  try {
    const upstream = await fetch(ZAI_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: req.body,
      // Required by fetch when the request carries a streamed body.
      // @ts-expect-error Deno's fetch accepts this; the DOM lib types do not know it.
      duplex: 'half',
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors(origin), 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    return new Response(
      `Could not reach Z.ai: ${e instanceof Error ? e.message : 'unreachable'}`,
      { status: 502, headers: { ...cors(origin), 'content-type': 'text/plain' } },
    )
  }
})
