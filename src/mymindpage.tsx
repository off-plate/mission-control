/* MyMind (2026-10-28): everything he shares into Mission Control, kept in one
   grid. A link, a photo or a piece of text arrives from the iPhone share sheet
   (Scriptable), the Chrome extension, or is pasted/dropped right here.

   Same rules as Bills: its own table, its own sign-in gate, and nothing in the
   big app-state blob. Previews are private files; signed links are fetched only
   for the cards on screen. Delete moves to trash for 30 days, then goes. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BillsSignIn, useCompassAccount } from './billspage'
import { Sheet } from './modals'
import { Band, Select } from './ui'
import {
  callFunction, deleteMyMind, mymindImageUrls, readMyMind, SUPABASE_ENABLED, updateMyMind, type MyMindRow,
} from './supabase'

const TRASH_DAYS = 30
const PAGE = 48

type Sort = 'newest' | 'oldest' | 'source' | 'title'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest first' }, { id: 'oldest', label: 'Oldest first' },
  { id: 'source', label: 'Source A to Z' }, { id: 'title', label: 'Title A to Z' },
]

type Filter = 'all' | 'instagram' | 'youtube' | 'web' | 'photos' | 'text' | 'trash'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'instagram', label: 'Instagram' }, { id: 'youtube', label: 'YouTube' },
  { id: 'web', label: 'Web' }, { id: 'photos', label: 'Photos' }, { id: 'text', label: 'Text' }, { id: 'trash', label: 'Trash' },
]

const isInstagram = (r: MyMindRow) => /(^|\.)instagram\.com$/.test(r.site)
const isYouTube = (r: MyMindRow) => /youtube\.com$|^youtu\.be$/.test(r.site)

function matches(r: MyMindRow, f: Filter): boolean {
  if (f === 'trash') return !!r.trashed_at
  if (r.trashed_at) return false
  if (f === 'instagram') return isInstagram(r)
  if (f === 'youtube') return isYouTube(r)
  if (f === 'web') return r.kind === 'link' && !isInstagram(r) && !isYouTube(r)
  if (f === 'photos') return r.kind === 'image'
  if (f === 'text') return r.kind === 'text'
  return true
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })
}

/** A photo from paste or drop, shrunk to a 1600 px JPEG before it travels. */
async function shrink(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the image'))), 'image/jpeg', 0.82))
  return await new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => rej(new Error('Could not read the image'))
    fr.readAsDataURL(blob)
  })
}

async function saveToMyMind(body: Record<string, unknown>): Promise<{ ok: boolean; title?: string; duplicate?: boolean; error?: string }> {
  const r = await callFunction('mymind', { method: 'POST', body: { op: 'save', via: 'MyMind page', ...body } })
  if (r.ok) return r.data as { ok: boolean; title?: string; duplicate?: boolean; error?: string }
  return { ok: false, error: r.reason === 'signed-out' ? 'Sign in first' : r.message || 'Could not reach MyMind' }
}

export function MyMindPage() {
  const signedIn = useCompassAccount()
  const [rows, setRows] = useState<MyMindRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [shown, setShown] = useState(PAGE)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const asked = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const all = await readMyMind()
      if (!all) return
      /* Trash older than 30 days is gone for good. */
      const cutoff = Date.now() - TRASH_DAYS * 86400000
      const stale = all.filter((r) => r.trashed_at && new Date(r.trashed_at).getTime() < cutoff)
      for (const r of stale) { try { await deleteMyMind(r) } catch { /* try again next time */ } }
      setRows(all.filter((r) => !stale.includes(r)))
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
  }, [])
  useEffect(() => { if (signedIn) void load(); else setRows(null) }, [signedIn, load])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = (rows ?? []).filter((r) => matches(r, filter) && (!needle ||
      `${r.title} ${r.site} ${r.description} ${r.note} ${r.body}`.toLowerCase().includes(needle)))
    const byDate = (a: MyMindRow, b: MyMindRow) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
    const text = (r: MyMindRow, k: 'site' | 'title') => (r[k] || r.title || r.site).toLowerCase()
    if (sort === 'oldest') out.sort(byDate)
    else if (sort === 'source') out.sort((a, b) => text(a, 'site').localeCompare(text(b, 'site')) || byDate(b, a))
    else if (sort === 'title') out.sort((a, b) => text(a, 'title').localeCompare(text(b, 'title')))
    else out.sort((a, b) => byDate(b, a))
    return out
  }, [rows, filter, q, sort])
  useEffect(() => { setShown(PAGE) }, [filter, q, sort])
  const visible = list.slice(0, shown)

  /* Signed preview links for just the cards on screen. */
  useEffect(() => {
    const need = visible.map((r) => r.image_path).filter((p): p is string => !!p && !asked.current.has(p))
    if (!need.length) return
    need.forEach((p) => asked.current.add(p))
    void mymindImageUrls(need).then((m) => setUrls((u) => ({ ...u, ...m })))
  }, [visible])

  const flash = (t: string) => { setStatus(t); window.setTimeout(() => setStatus((s) => (s === t ? null : s)), 3200) }

  const addLink = useCallback(async (text: string) => {
    const v = text.trim()
    if (!v) return
    flash('Saving...')
    const isUrl = /^https?:\/\//i.test(v)
    const r = await saveToMyMind(isUrl ? { url: v } : { text: v })
    if (!r.ok) { flash(r.error ?? 'Could not save'); return }
    flash(r.duplicate ? 'Already saved, moved to the top' : 'Saved')
    await load()
  }, [load])

  const addFile = useCallback(async (f: Blob) => {
    flash('Saving photo...')
    try {
      const r = await saveToMyMind({ image_b64: await shrink(f) })
      if (!r.ok) { flash(r.error ?? 'Could not save'); return }
      flash('Saved'); await load()
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not save') }
  }, [load])

  /* Paste anywhere on the page (not into a field): a copied link, text or image. */
  useEffect(() => {
    if (!signedIn) return
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const img = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (img) { e.preventDefault(); void addFile(img); return }
      const txt = e.clipboardData?.getData('text')
      if (txt?.trim()) { e.preventDefault(); void addLink(txt) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [signedIn, addFile, addLink])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'))
    if (f) { void addFile(f); return }
    const u = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    if (u) void addLink(u.split('\n')[0])
  }

  if (!SUPABASE_ENABLED) return <div className="page mm-page"><div className="mm-empty">Sync is off in this build, so MyMind has nothing to read.</div></div>
  if (signedIn === null) return <div className="page mm-page" />
  if (!signedIn) return <div className="page bills-page"><BillsSignIn /></div>

  const current = open ? (rows ?? []).find((r) => r.id === open) ?? null : null
  const count = (rows ?? []).filter((r) => !r.trashed_at).length

  return (
    <div className={`page mm-page${drag ? ' is-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <Band title="MyMind" metrics={rows ? [{ v: String(count), k: 'saved' }] : undefined} />

      <div className="mm-tools">
        <input className="mm-field" type="search" placeholder="Search what you saved" aria-label="Search MyMind" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="mm-field" type="url" inputMode="url" placeholder="Paste a link and press Enter" aria-label="Save a link"
          value={adding} onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { void addLink(adding); setAdding('') } }} />
        <Select className="mm-sort" ariaLabel="Sort by" value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} />
      </div>
      <div className="mm-chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} className={`mm-chip${filter === f.id ? ' is-on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      {status && <div className="mm-status" role="status">{status}</div>}

      {error && <div className="mm-empty">Could not load MyMind: {error}</div>}
      {!error && !rows && <div className="mm-empty">Loading...</div>}
      {rows && !list.length && !error && (
        <div className="mm-empty">{q ? 'Nothing matches. Try fewer words.' : filter === 'trash' ? 'Trash is empty.' : 'Nothing here yet. Share a link from your phone, or paste one on this page.'}</div>
      )}

      <div className="mm-grid">
        {visible.map((r) => (
          <button key={r.id} className="mm-card" onClick={() => setOpen(r.id)}>
            {r.image_path && urls[r.image_path]
              ? <img className="mm-img" src={urls[r.image_path]} alt="" loading="lazy" />
              : <div className={`mm-img mm-ph${r.kind === 'text' ? ' is-text' : ''}`}>{r.kind === 'text' ? r.body.slice(0, 120) : r.site || 'Photo'}</div>}
            <div className="mm-tx">
              <div className="mm-tt">{r.title || r.site}</div>
              <div className="mm-mt">{r.kind === 'link' ? r.site : r.kind === 'image' ? 'Photo' : 'Text'} / {ago(r.created_at)}</div>
            </div>
          </button>
        ))}
      </div>
      {list.length > shown && <button className="btn mm-more" onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown})</button>}

      {current && (
        <Sheet title="MyMind" onClose={() => setOpen(null)}>
          <Detail row={current} url={current.image_path ? urls[current.image_path] : undefined}
            onChange={(patch) => setRows((rs) => (rs ?? []).map((r) => (r.id === current.id ? { ...r, ...patch } : r)))}
            onGone={() => { setRows((rs) => (rs ?? []).filter((r) => r.id !== current.id)); setOpen(null) }}
            onError={flash} />
        </Sheet>
      )}
    </div>
  )
}

function Detail({ row, url, onChange, onGone, onError }: {
  row: MyMindRow; url?: string; onChange: (p: Partial<MyMindRow>) => void; onGone: () => void; onError: (m: string) => void
}) {
  const [note, setNote] = useState(row.note)
  const [sure, setSure] = useState(false)
  const run = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { onError(e instanceof Error ? e.message : 'Something went wrong') } }
  return (
    <div className="mm-detail">
      <div className="mm-actions">
        {row.url && <a className="btn btn-primary" href={row.url} target="_blank" rel="noreferrer">Open original</a>}
        {row.url && <button className="btn" onClick={() => void navigator.clipboard?.writeText(row.url!).then(() => onError('Link copied'))}>Copy link</button>}
        {!row.trashed_at && !sure && <button className="btn mm-danger" onClick={() => setSure(true)}>Move to trash</button>}
        {!row.trashed_at && sure && <button className="btn mm-danger is-sure" onClick={() => void run(async () => { const t = new Date().toISOString(); await updateMyMind(row.id, { trashed_at: t }); onChange({ trashed_at: t }); onGone() })}>Yes, trash it (kept {TRASH_DAYS} days)</button>}
        {row.trashed_at && <button className="btn btn-primary" onClick={() => void run(async () => { await updateMyMind(row.id, { trashed_at: null }); onChange({ trashed_at: null }); onGone() })}>Restore</button>}
        {row.trashed_at && !sure && <button className="btn mm-danger" onClick={() => setSure(true)}>Delete forever</button>}
        {row.trashed_at && sure && <button className="btn mm-danger is-sure" onClick={() => void run(async () => { await deleteMyMind(row); onGone() })}>Yes, delete forever</button>}
      </div>
      {url && (row.url
        ? <a className="mm-biglink" href={row.url} target="_blank" rel="noreferrer" aria-label="Open original"><img className="mm-big" src={url} alt="" /></a>
        : <img className="mm-big" src={url} alt="" />)}
      <h3 className="mm-dt">{row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.title || row.site}</a> : (row.title || row.site)}</h3>
      <div className="mm-mt">{row.kind === 'link' ? row.site : row.kind === 'image' ? 'Photo' : 'Text'} / saved {ago(row.created_at)}{row.via ? ` / via ${row.via}` : ''}</div>
      {row.kind === 'text' && <p className="mm-body">{row.body}</p>}
      {row.kind === 'link' && row.description && <p className="mm-body">{row.description}</p>}
      <label className="mm-lab" htmlFor="mm-note">Note</label>
      <textarea id="mm-note" className="mm-field mm-ta" rows={3} placeholder="Why you saved it" value={note} onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note !== row.note) void run(async () => { await updateMyMind(row.id, { note }); onChange({ note }) }) }} />
    </div>
  )
}
