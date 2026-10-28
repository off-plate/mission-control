/* MyMind's door (2026-10-28).

   One operation, `save`: a link, a photo or a piece of text goes into mc_mymind,
   with a preview image copied into the private `mymind` bucket (Instagram image
   links are signed and expire, so the bytes have to live here).

   Two callers, either is enough:
     - the iPhone Scriptable script and the Chrome extension, sending
       MC_MYMIND_SECRET as x-mymind-secret. A separate key from the task and widget
       ones. Deployed with --no-verify-jwt; the secret is the gate.
     - the MyMind page, as him (isOwner), for pasted links and images.

   Reading is not here: the page reads the table itself under row level security.
   Body: {op:'save', url?, title?, description?, text?, note?, via?,
          image_b64?: base64 JPEG, image_url?: string}
   Rotate the key with `supabase secrets set MC_MYMIND_SECRET=...`. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWNER_EMAIL, isOwner } from '../_shared/owner.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const TRACKING = /^(utm_.*|igsh|igshid|fbclid|gclid|si|feature|ref|ref_src|mc_cid|mc_eid|_hsenc|_hsmi|s|t)$/i

/** The link without tracking, and the key two saves of the same page share. */
export function cleanUrl(raw: string): { url: string; key: string } | null {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  const drop: string[] = []
  u.searchParams.forEach((_, k) => { if (TRACKING.test(k)) drop.push(k) })
  drop.forEach((k) => u.searchParams.delete(k))
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const path = u.pathname.replace(/\/+$/, '')
  const qs = u.searchParams.toString()
  return { url: u.toString(), key: host + path + (qs ? '?' + qs : '') }
}

const PRIVATE_HOST = /^(localhost|.*\.local|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1)/i

function decode(s: string) {
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
}

function meta(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  const v = tag?.match(/content=(["'])([\s\S]*?)\1/i)?.[2]
  return v ? decode(v).trim() : ''
}

interface Found { title: string; description: string; image: string; site: string }

/** Best effort: a page that will not answer just saves with its address. */
async function readPage(url: string): Promise<Found> {
  const out: Found = { title: '', description: '', image: '', site: new URL(url).hostname.replace(/^www\./, '') }
  const u = new URL(url)
  if (PRIVATE_HOST.test(u.hostname)) return out
  try {
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(6000) })
      if (r.ok) { const j = await r.json(); out.title = j.title ?? ''; out.image = j.thumbnail_url ?? ''; out.description = j.author_name ?? '' }
      return out
    }
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(7000) })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('html')) return out
    const html = (await r.text()).slice(0, 400_000)
    out.title = meta(html, 'og:title') || meta(html, 'twitter:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
    out.description = meta(html, 'og:description') || meta(html, 'description')
    const img = meta(html, 'og:image') || meta(html, 'twitter:image')
    if (img) { try { out.image = new URL(img, url).toString() } catch { /* ignore */ } }
    const site = meta(html, 'og:site_name'); if (site) out.site = site
  } catch { /* unreachable page */ }
  return out
}

/** Instagram titles read `Name on Instagram: "caption"`; the caption is the useful part. */
function tidyTitle(title: string, site: string): string {
  let t = title
  const ig = t.match(/on Instagram:\s*["“]([\s\S]*?)["”]?\s*$/i)
  if (ig) t = ig[1]
  t = t.replace(/(\s+#[\p{L}\p{N}_]+)+\s*$/u, '').replace(/\s+/g, ' ').trim()
  if (t.length > 120) t = t.slice(0, 117).replace(/\s+\S*$/, '') + '...'
  return t || site
}


async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const u = new URL(url)
    if (PRIVATE_HOST.test(u.hostname)) return null
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return null
    const b = new Uint8Array(await r.arrayBuffer())
    return b.length > 0 && b.length <= 4_000_000 ? b : null
  } catch { return null }
}

function fromB64(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/^data:[^,]*,/, ''))
    const b = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i)
    return b.length > 0 && b.length <= 4_000_000 ? b : null
  } catch { return null }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-mymind-secret, authorization', 'access-control-allow-methods': 'POST' } })
  }
  const SECRET = Deno.env.get('MC_MYMIND_SECRET') ?? ''
  const bySecret = !!SECRET && sameSecret(req.headers.get('x-mymind-secret') ?? '', SECRET)
  if (req.method !== 'POST' || !OWNER_EMAIL || !(bySecret || (await isOwner(req)))) return json({ ok: false, error: 'Not allowed' }, 401)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ ok: false, error: 'Send JSON' }, 400) }
  if (body.op !== 'save') return json({ ok: false, error: 'op must be save' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: users } = await sb.auth.admin.listUsers()
  const owner = users?.users.find((u) => u.email === OWNER_EMAIL)
  if (!owner) return json({ ok: false, error: 'No account' }, 500)

  const via = str(body.via, 40)
  const note = str(body.note, 2000)
  const text = str(body.text, 20000)
  const rawUrl = str(body.url, 2000)
  const cleaned = rawUrl ? cleanUrl(rawUrl) : null
  if (rawUrl && !cleaned) return json({ ok: false, error: 'That is not a web link' }, 400)

  let image = typeof body.image_b64 === 'string' ? fromB64(body.image_b64) : null
  if (typeof body.image_b64 === 'string' && !image) return json({ ok: false, error: 'The photo is too large or unreadable' }, 400)

  /* A repeat save of the same page brings it back to the top. If it never got a preview, this one tries
     again (`refresh: true` does only that, keeping its place; the import uses it). */
  if (cleaned && !text) {
    const { data: dup } = await sb.from('mc_mymind').select('id,title,image_path').eq('owner', owner.id).eq('url_key', cleaned.key).maybeSingle()
    if (dup) {
      const patch: Record<string, unknown> = body.refresh ? {} : { created_at: new Date().toISOString(), trashed_at: null }
      const site0 = new URL(cleaned.url).hostname.replace(/^www\./, '')
      if (!dup.image_path || !dup.title) {
        const f = await readPage(cleaned.url)
        const img = image ?? (!dup.image_path && f.image ? await fetchImage(f.image) : null)
        if (img && !dup.image_path) {
          const path = `${owner.id}/${dup.id}.jpg`
          const up = await sb.storage.from('mymind').upload(path, img, { contentType: 'image/jpeg', upsert: true })
          if (!up.error) patch.image_path = path
        }
        if (!dup.title && f.title) patch.title = tidyTitle(f.title, site0)
      }
      if (Object.keys(patch).length) await sb.from('mc_mymind').update(patch).eq('id', dup.id)
      return json({ ok: true, id: dup.id, title: (patch.title as string) ?? dup.title, duplicate: true, preview: !!(patch.image_path ?? dup.image_path) })
    }
  }

  let title = str(body.title, 300)
  let description = str(body.description, 1000)
  let site = ''
  let imageUrl = str(body.image_url, 2000)
  if (cleaned && !text) {
    site = new URL(cleaned.url).hostname.replace(/^www\./, '')
    if (!title || (!image && !imageUrl)) {
      const f = await readPage(cleaned.url)
      title = title || f.title
      description = description || f.description
      imageUrl = imageUrl || f.image
      site = f.site || site
    }
    title = tidyTitle(title, site)
  } else if (text) {
    title = title || text.replace(/\s+/g, ' ').slice(0, 90)
    if (cleaned) site = new URL(cleaned.url).hostname.replace(/^www\./, '')
  } else if (image) {
    title = title || 'Photo'
  } else return json({ ok: false, error: 'Nothing to save' }, 400)

  if (!image && imageUrl) image = await fetchImage(imageUrl)

  const id = crypto.randomUUID()
  let image_path: string | null = null
  if (image) {
    const path = `${owner.id}/${id}.jpg`
    const up = await sb.storage.from('mymind').upload(path, image, { contentType: 'image/jpeg', upsert: true })
    if (!up.error) image_path = path
  }

  const kind = text ? 'text' : cleaned ? 'link' : 'image'
  const { error } = await sb.from('mc_mymind').insert({
    id, owner: owner.id, kind, url: cleaned?.url ?? null, url_key: kind === 'link' ? cleaned!.key : null,
    title, site, description, body: kind === 'text' ? text : '', note, image_path, via,
  })
  if (error) return json({ ok: false, error: 'Could not save it' }, 500)
  return json({ ok: true, id, title, preview: !!image_path })
})
