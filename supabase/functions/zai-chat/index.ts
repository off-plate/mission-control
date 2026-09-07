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

   NO SECRET LIVES HERE, unlike calendar's. The Authorization header a caller
   sends IS their own Z.ai key, forwarded through untouched -- never read,
   never logged, never stored -- so this holds nothing worth protecting with
   the platform's JWT check, and turning that check off is what lets the
   assistant keep working exactly as it always has: paste a key in Settings,
   no Supabase account required. A public URL that only ever relays a key the
   caller already had to supply is not the same risk calendar's setup note
   warns about.

   Streamed straight through both ways: the browser sent stream:true expects
   SSE back, and buffering the whole reply here just to re-emit it would
   trade the live-typing effect for nothing.

   Deploy:
     supabase functions deploy zai-chat --no-verify-jwt */

const ALLOW = [
  'https://off-plate.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ALLOW.includes(origin) ? origin : ALLOW[0],
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'vary': 'origin',
})

const ZAI_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions'

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return new Response('POST only.', { status: 405, headers: cors(origin) })

  const auth = req.headers.get('authorization')
  if (!auth) return new Response('No key.', { status: 401, headers: cors(origin) })

  try {
    const upstream = await fetch(ZAI_ENDPOINT, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
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
