/* Supabase Edge Function: task breakdown + time estimate.

   Why this exists as a function and not in the app: mission-control is a PUBLIC
   repo served as static files, so anything in the bundle is public. An API key
   in the client would be readable by anyone. The key lives here, in Supabase
   secrets, and the browser only ever talks to this endpoint.

   Deploy:
     supabase secrets set GROQ_API_KEY=<your key>
     supabase functions deploy breakdown --no-verify-jwt
*/

const MODEL = 'llama-3.3-70b-versatile'

const SYSTEM = `You break a personal task into the concrete steps it actually takes, and estimate each one.

Rules:
- 3 to 6 steps. Fewer if the task is genuinely small.
- Each step is a physical action he can start, not a category. "Find the contract number" not "Preparation".
- The FIRST step must be tiny and frictionless, the thing that gets him moving when he is avoiding it.
- Estimate each step in minutes, realistically, for someone who is not in flow yet.
- Czech context: Datova schranka, VZP, splatkovy kalendar, Fakturoid are normal parts of his admin.
- Answer in the same language the task was written in.
- No preamble, no encouragement, no em dashes.

Return ONLY JSON: {"steps":[{"title":"...","why":"optional short reason","estimateMin":10}]}`

Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const key = Deno.env.get('GROQ_API_KEY')
    if (!key) return new Response(JSON.stringify({ error: 'no-key' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } })

    const { title, category } = await req.json()
    if (!title || typeof title !== 'string') {
      return new Response(JSON.stringify({ error: 'no-title' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Task: ${title}\nKind of work: ${category ?? 'unknown'}` },
        ],
      }),
    })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'upstream', status: res.status }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}')
    const steps = (parsed.steps ?? [])
      .filter((s: { title?: string }) => typeof s?.title === 'string' && s.title.trim())
      .slice(0, 8)
      .map((s: { title: string; why?: string; estimateMin?: number }) => ({
        title: s.title.trim(),
        why: typeof s.why === 'string' && s.why.trim() ? s.why.trim() : undefined,
        estimateMin: Math.max(1, Math.round(Number(s.estimateMin) || 10)),
      }))

    return new Response(JSON.stringify({ steps }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
