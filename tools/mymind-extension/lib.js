/* Shared by the popup and the service worker. The key lives in chrome.storage.local, set on the options page. */
const MM_API = 'https://fhfempisopwsdkmvywbt.supabase.co/functions/v1/mymind'

async function mmKey() { return (await chrome.storage.local.get('key')).key || '' }

async function mmSend(body) {
  const key = await mmKey()
  if (!key) return { ok: false, error: 'No key yet. Open the extension options and paste it.', needsKey: true }
  try {
    const r = await fetch(MM_API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mymind-secret': key }, body: JSON.stringify({ op: 'save', via: 'Chrome', ...body }) })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) return { ok: false, error: 'The key was rejected. Paste it again in the options.', needsKey: true }
    return j.ok ? j : { ok: false, error: j.error || 'Could not save' }
  } catch { return { ok: false, error: 'No connection, nothing was saved.' } }
}

/* What the page itself says about itself: better than anything a server can fetch, and it works behind a login. */
function mmReadPage() {
  const m = (p) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content?.trim() || ''
  const abs = (u) => { try { return u ? new URL(u, location.href).toString() : '' } catch { return '' } }
  return {
    title: m('og:title') || document.title || '',
    description: m('og:description') || m('description'),
    image: abs(m('og:image') || m('twitter:image')),
    selection: String(getSelection() || '').trim(),
    url: location.href,
  }
}

async function mmPageInfo(tabId) {
  try { return (await chrome.scripting.executeScript({ target: { tabId }, func: mmReadPage }))[0].result }
  catch { return null }  // chrome:// pages and the web store cannot be read
}

/* The page's preview picture, fetched here (so it works behind a login), or its address if that fails. */
async function mmPreview(p) {
  if (!p?.image) return {}
  try { return { image_b64: await mmImageToB64(p.image) } } catch { return { image_url: p.image } }
}

/* A picture from the page: fetched here, shrunk to 1600 px, sent as a JPEG. */
async function mmImageToB64(src) {
  const blob = await (await fetch(src)).blob()
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  const bytes = new Uint8Array(await out.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
