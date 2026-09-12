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
   redistributed -- not a public mirror of anyone's content.

   REBUILT 2026-09-12. His report: reels he had checked and confirmed public
   -- playable in a fresh anonymous browser window, no login wall -- still
   answered 422 here. Measured directly against one of his exact links: the
   plain page fetch this used to scrape gets a 200 with NO video anywhere in
   it (no og:video, no video_url, nothing) and login/consent markers instead.
   That is Instagram showing a logged-out server a wall it does not show a
   logged-out BROWSER, which runs enough of the page's own JS to bootstrap an
   anonymous session Instagram is willing to answer. A static fetch has no way
   to reproduce that.

   So there are now two tries, in order:

   1. LOGGED IN, if IG_SESSIONID is set. The one path that is not a guess: his
      own account's session, the same one every real download tool uses,
      talking to the private mobile API, which returns structured video
      URLs rather than something scraped out of a page's markup. The
      shortcode is decoded to Instagram's own numeric media id locally --
      it is a straight base64-alphabet sum, no request needed, verified
      against a real reel (Dc_mhjBTvno -> 3981070026731878888, confirmed
      against Instagram's own oEmbed answer for that same reel).

   2. THE OLD SCRAPE, as a fallback with no cost to keep: some reels answer it
      without a login at all, and it costs nothing to try before giving up.

   A session cookie is not the shortcut it looks like: it is his account
   watching, so if his sessionid ever gets throttled or logged out elsewhere
   this goes back to attempt 2's success rate. It also expires on its own
   timeline and needs re-pasting occasionally -- there is no way around that
   from a server with no browser to keep it alive.

   Deploy:
     supabase functions deploy reel-fetch
     supabase secrets set IG_SESSIONID="<value of the sessionid cookie>"
   The bucket is created on first call if it doesn't exist yet -- no manual
   dashboard step. IG_SESSIONID is optional; without it, only attempt 2 runs,
   same as before this rebuild. */

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
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IG_APP_ID = '936619743392459' // the web client's own id, sent to every visitor, not a secret

const CODE = /instagram\.com\/(?:reel|reels|p)\/([\w-]+)/i

/** Instagram's shortcode is base64-in-its-own-alphabet over the numeric media
 *  id -- no request needed to go from one to the other. Verified against a
 *  real reel (2026-09-12): decoding "Dc_mhjBTvno" this way gives exactly the
 *  media_id Instagram's own oEmbed endpoint reports for that same reel. */
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function shortcodeToMediaId(code: string): string {
  let n = 0n
  for (const ch of code) {
    const i = IG_ALPHABET.indexOf(ch)
    if (i < 0) continue // a post shortcode can carry characters (rare) outside the run of media chars
    n = n * 64n + BigInt(i)
  }
  return n.toString()
}

/** Attempt 1: his own logged-in session, the private mobile API. Returns the
 *  best video URL, or null if the session could not answer for this media
 *  (expired, throttled, or the post genuinely has no video). */
async function fetchWithSession(code: string, sessionId: string): Promise<string | null> {
  const mediaId = shortcodeToMediaId(code)
  const res = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
    headers: {
      'user-agent': UA_MOBILE,
      'x-ig-app-id': IG_APP_ID,
      cookie: `sessionid=${sessionId}`,
    },
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null) as { items?: { video_versions?: { url: string }[] }[] } | null
  const versions = data?.items?.[0]?.video_versions
  return versions?.[0]?.url ?? null
}

/** Attempt 2, the previous whole implementation: the embed page, scraped for
 *  whichever of two markup shapes it answered with. Kept because it costs
 *  nothing to try and some public reels do answer it. */
function extractVideoUrl(html: string): string | null {
  const meta = html.match(/<meta property="og:video(?::secure_url)?" content="([^"]+)"/i)
  if (meta) return meta[1].replace(/&amp;/g, '&')
  const embedded = html.match(/\\?"video_url\\?":\\?"(.+?)\\?"/i)
  if (embedded) return embedded[1].replace(/\\+\//g, '/').replace(/\\u0026/g, '&')
  return null
}
async function fetchLoggedOut(code: string): Promise<string | null> {
  const page = await fetch(`https://www.instagram.com/reel/${code}/embed/captioned/`, {
    headers: { 'user-agent': UA_MOBILE, 'accept-language': 'en-US,en;q=0.9' },
  })
  if (!page.ok) return null
  return extractVideoUrl(await page.text())
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

  const sessionId = Deno.env.get('IG_SESSIONID')

  try {
    let videoUrl: string | null = null
    let via: 'session' | 'logged-out' | null = null

    if (sessionId) {
      videoUrl = await fetchWithSession(code, sessionId).catch(() => null)
      if (videoUrl) via = 'session'
    }
    if (!videoUrl) {
      videoUrl = await fetchLoggedOut(code).catch(() => null)
      if (videoUrl) via = 'logged-out'
    }

    if (!videoUrl) {
      /* What actually happens, measured against a real reel he confirmed was
         public (2026-09-12): a 200 with no video anywhere in it and
         login/consent markers, which a fresh browser does not get shown for
         the same link. Never blamed on the reel itself. */
      const message = sessionId
        ? "Instagram would not hand over the video, even signed in. The session may have expired -- paste a fresh sessionid -- or this one genuinely has no video."
        : "Instagram serves a logged-out fetch a page with no video on it, even for reels that play fine in a browser. Signing in (IG_SESSIONID) fixes most of these; it'll try again next time this screen opens otherwise."
      return json({ ok: false, message }, 422, origin)
    }

    const video = await fetch(videoUrl, { headers: { 'user-agent': UA_MOBILE } })
    if (!video.ok || !video.body) return json({ ok: false, message: 'The video file itself would not load' }, 502, origin)
    const bytes = await video.arrayBuffer()

    await db.storage.createBucket(BUCKET, { public: true }).catch(() => { /* already exists */ })
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true })
    if (error) return json({ ok: false, message: `Could not save it: ${error.message}` }, 500, origin)

    return json({ ok: true, fileUrl: publicUrl, via }, 200, origin)
  } catch (e) {
    return json({ ok: false, message: e instanceof Error ? e.message : 'Unreachable' }, 502, origin)
  }
})
