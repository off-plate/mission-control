/* REELS FROM A FOLDER ON HIS OWN MACHINE.

   His instruction (2026-09-12): "I'm not gonna be uploading it to Supabase...
   make it understand the local folder". Instagram will not hand a video to a
   server, and he is not going to keep feeding files to one, so the app reads
   the clips off his disk instead.

   A page cannot open a path. `file:///Users/...` from an https page is refused
   by every browser and always will be. What IS allowed is the File System
   Access API: he picks a folder once, the browser hands back a handle, and the
   handle can be kept so the choice survives a reload. That is as close to
   "point it at a folder" as a web page is ever given.

   Chrome and Edge have it. Safari and Firefox do not, and there is no polyfill
   worth the name -- so `canPickFolder()` is checked before the control is
   offered rather than failing in his hands. */

const DB = 'mc-local-reels'
const STORE = 'handles'
const KEY = 'reel-folder'

export const VIDEO = /\.(mp4|webm|mov|m4v)$/i

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any

export function canPickFolder(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => ok(req.result)
    req.onerror = () => no(req.error)
  })
}

/** The handle survives a reload; the PERMISSION may not, and the two are
 *  separate questions. A stored handle with a revoked permission is why this
 *  always re-asks rather than assuming. */
async function put(handle: DirHandle | null): Promise<void> {
  const db = await open()
  await new Promise<void>((ok, no) => {
    const tx = db.transaction(STORE, 'readwrite')
    if (handle) tx.objectStore(STORE).put(handle, KEY)
    else tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => ok()
    tx.onerror = () => no(tx.error)
  })
  db.close()
}

async function get(): Promise<DirHandle | null> {
  try {
    const db = await open()
    const handle = await new Promise<DirHandle | null>((ok, no) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => ok(req.result ?? null)
      req.onerror = () => no(req.error)
    })
    db.close()
    return handle
  } catch { return null }
}

async function allowed(handle: DirHandle, ask: boolean): Promise<boolean> {
  try {
    const opts = { mode: 'read' as const }
    if ((await handle.queryPermission?.(opts)) === 'granted') return true
    if (!ask) return false
    return (await handle.requestPermission?.(opts)) === 'granted'
  } catch { return false }
}

export interface LocalReel {
  /** Blob URL for this session. Revoked when the folder is re-read. */
  url: string
  name: string
}

let live: LocalReel[] = []

function revoke(): void {
  for (const r of live) URL.revokeObjectURL(r.url)
  live = []
}

async function readFolder(handle: DirHandle): Promise<LocalReel[]> {
  const out: LocalReel[] = []
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !VIDEO.test(name)) continue
    try {
      const file = await entry.getFile()
      out.push({ url: URL.createObjectURL(file), name })
    } catch { /* a file that vanished between listing and opening */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export type FolderState =
  | { status: 'unsupported' }
  | { status: 'none' }
  | { status: 'needs-permission'; name: string }
  | { status: 'ready'; name: string; reels: LocalReel[] }

/** Re-open the folder he already chose, without a prompt. Returns
 *  'needs-permission' rather than asking, because a browser only grants this
 *  off a real click and a page load is not one. */
export async function restoreFolder(): Promise<FolderState> {
  if (!canPickFolder()) return { status: 'unsupported' }
  const handle = await get()
  if (!handle) return { status: 'none' }
  if (!(await allowed(handle, false))) return { status: 'needs-permission', name: handle.name }
  revoke()
  live = await readFolder(handle)
  return { status: 'ready', name: handle.name, reels: live }
}

/** Ask for the folder. Must be called from a click. */
export async function pickFolder(): Promise<FolderState> {
  if (!canPickFolder()) return { status: 'unsupported' }
  try {
    const handle = await (window as any).showDirectoryPicker({ id: 'mc-reels', mode: 'read' })
    if (!(await allowed(handle, true))) return { status: 'needs-permission', name: handle.name }
    await put(handle)
    revoke()
    live = await readFolder(handle)
    return { status: 'ready', name: handle.name, reels: live }
  } catch {
    /* He closed the picker. Not an error, and not a reason to forget the
       folder he already had. */
    return await restoreFolder()
  }
}

/** Grant on an existing handle, from a click. */
export async function grantFolder(): Promise<FolderState> {
  const handle = await get()
  if (!handle) return { status: 'none' }
  if (!(await allowed(handle, true))) return { status: 'needs-permission', name: handle.name }
  revoke()
  live = await readFolder(handle)
  return { status: 'ready', name: handle.name, reels: live }
}

export async function forgetFolder(): Promise<FolderState> {
  revoke()
  await put(null)
  return { status: 'none' }
}
