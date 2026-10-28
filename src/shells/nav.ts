/* A phone asked for a classic page the Nothing app has its own version of
   (People, Notes, Calendar...): the app sends it there instead. Whoever asks
   leaves the view here, the mounted shell (or the one about to mount) takes it. */
let pending: string | null = null

export const openInShell = (view: string) => {
  pending = view
  window.dispatchEvent(new CustomEvent('mc:shell-open', { detail: view }))
}

export const takePending = () => { const v = pending; pending = null; return v }
