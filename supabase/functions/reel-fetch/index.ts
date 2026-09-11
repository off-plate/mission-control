/* The reel downloader.

   The reel library plays YouTube and Vimeo straight through their own
   players, but a pasted Instagram link is a page, not a video: the CDN file
   behind it needs an Instagram-looking request to find, and the browser
   can't make one (CORS, and the app's own origin gets no video back anyway).
   So this fetches it server-side, once, and hands back a file the app's own
   Storage serves forever after -- the same shape as the calendar proxy, just
   with a save step in the middle.

   ONE DOWNLOAD PER REEL. The result is cached in Storage by shortcode, and
   the app remembers the mapping in its own synced state, so pasting the same
   Reel on a second device is a lookup, not a second fetch.

   This is a personal reel library, watched by one signed-in account, never
   redistributed -- not a public mirror of anyone's content. It still reads
   pages Instagram would rather you not scrape, which is why it has no
   ambition beyond that: no bulk crawling, no profile scraping, one URL in,
   one file out, and a clean failure the moment the markup stops matching.

   Deploy:
     supabase functions deploy reel-fetch
   The bucket is created on first call if it doesn't exist yet -- no manual
   dashboard step. */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOW = [
  'https://off-plate.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ALLOW.includes(origin) ? origin : ALLOW[0],
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
  'vary': 'origin',
})

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'content-type': 'application/json; charset=utf-8' } })

const BUCKET = 'mc-reel-cache'
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const CODE = /instagram\.com\/(?:reel|reels|p)\/([\w-]+)/i

/** Instagram serves the video URL two ways depending on which markup answers:
 *  a plain `og:video` meta tag on some responses, or a `video_url` string
 *  buried in the embed page's own JSON-in-a-JS-string blob on others -- and
 *  on that blob, verified against a real reel (2026-09-11), the quotes and
 *  slashes are escaped an extra layer deep (`\"video_url\":\"https:\\/\\/...`)
 *  because the JSON was itself embedded as a string literal. Both are tried,
 *  in the order they're most often present, before giving up -- guessing a
 *  third pattern that has never been seen would be inventing a URL. */
function extractVideoUrl(html: string): string | null {
  const meta = html.match(/<meta property="og:video(?::secure_url)?" content="([^"]+)"/i)
  if (meta) return meta[1].replace(/&amp;/g, '&')
  const embedded = html.match(/\\?"video_url\\?":\\?"(.+?)\\?"/i)
  if (embedded) return embedded[1].replace(/\\+\//g, '/').replace(/\\u0026/g, '&')
  return null
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
  if (req.method !== 'POST') return json({ ok: false, message: 'POST only' }, 405, origin)

  let url: string
  try {
    const body = await req.json()
    url = String(body.url ?? '')
  } catch {
    return json({ ok: false, message: 'Bad request body' }, 400, origin)
  }

  const code = url.match(CODE)?.[1]
  if (!code) return json({ ok: false, message: 'Not an Instagram reel or post link' }, 400, origin)

  const supaUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supaUrl || !serviceKey) return json({ ok: false, message: 'Function is not configured' }, 503, origin)
  const db = createClient(supaUrl, serviceKey)

  const path = `${code}.mp4`
  const publicUrl = `${supaUrl}/storage/v1/object/public/${BUCKET}/${path}`

  // Already fetched by an earlier device or an earlier paste of the same link.
  const head = await fetch(publicUrl, { method: 'HEAD' })
  if (head.ok) return json({ ok: true, fileUrl: publicUrl }, 200, origin)

  try {
    // The embed page is the one that reliably answers without a login wall.
    const page = await fetch(`https://www.instagram.com/reel/${code}/embed/captioned/`, {
      headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    })
    if (!page.ok) return json({ ok: false, message: `Instagram answered ${page.status}` }, 502, origin)
    const html = await page.text()
    const videoUrl = extractVideoUrl(html)
    /* Confirmed 2026-09-12 against a real public reel: Instagram can withhold
       the video from a plain fetch on a post that is neither private nor
       deleted -- most often over the track's music rights. So this is never
       said to be a broken link, only that this attempt did not get one. */
    if (!videoUrl) return json({ ok: false, message: "Instagram didn't hand over the video for this link. Often the track's music rights, not the reel being private." }, 422, origin)

    const video = await fetch(videoUrl, { headers: { 'user-agent': UA } })
    if (!video.ok || !video.body) return json({ ok: false, message: 'The video file itself would not load' }, 502, origin)
    const bytes = await video.arrayBuffer()

    await db.storage.createBucket(BUCKET, { public: true }).catch(() => { /* already exists */ })
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true })
    if (error) return json({ ok: false, message: `Could not save it: ${error.message}` }, 500, origin)

    return json({ ok: true, fileUrl: publicUrl }, 200, origin)
  } catch (e) {
    return json({ ok: false, message: e instanceof Error ? e.message : 'Unreachable' }, 502, origin)
  }
})
