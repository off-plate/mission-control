import { useEffect } from 'react'
import { useStore } from './context'

/* The bar that lets a delete be taken back. It sits above the tab bar on the
   phone and clear of the Pomodoro badge on the desktop, and it goes away by
   itself after ten seconds, which is long enough to notice and act. */
export function UndoToast() {
  const { undoable, undoDelete, dismissUndo } = useStore()
  useEffect(() => {
    if (!undoable) return
    const t = window.setTimeout(dismissUndo, 10000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoable?.id])
  if (!undoable) return null
  return (
    <div className="undo-bar" role="status">
      <span className="undo-what">{undoable.label}</span>
      <button className="undo-do" onClick={undoDelete}>Undo</button>
      <button className="undo-x" onClick={dismissUndo} aria-label="Dismiss">✕</button>
    </div>
  )
}
