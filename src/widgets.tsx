/* A pasted URL is an address, not prose: shown raw it swallowed two lines of a
   task title. Wherever free text renders, links collapse to a short clickable
   host/path and the words around them stay words. */
const URL_RE = /https?:\/\/[^\s<>"')]+/g

function shortUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    const path = seg ? `/${seg}` : ''
    const s = `${u.hostname.replace(/^www\./, '')}${path}`
    return s.length > 34 ? `${s.slice(0, 33)}…` : `${s}${u.pathname.split('/').filter(Boolean).length > 1 ? '/…' : ''}`
  } catch { return raw.length > 34 ? `${raw.slice(0, 33)}…` : raw }
}

export function Linkify({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const url = m[0]
    parts.push(
      <a
        key={at} className="txt-link" href={url} target="_blank" rel="noreferrer" title={url}
        /* The row underneath has its own ideas about clicks and drags; opening
           a link must not toggle, drag or expand anything. */
        onClick={(e) => e.stopPropagation()}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        {shortUrl(url)}
      </a>,
    )
    last = at + url.length
  }
  if (parts.length === 0) return <>{text}</>
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
