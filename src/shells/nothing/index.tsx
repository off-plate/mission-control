import { useEffect, useRef } from 'react'
import { useShellBridge } from '../bridge'
import type { SkinId } from '../../skins'
import { takePending } from '../nav'
import { mountNothing, type NothingHandle } from './shell.js'
import css from './nothing.css?inline'

/* The Nothing phone shell, full screen, in a shadow root so its CSS and the
   classic app's never meet. Lazy-loaded from App.tsx: Classic pays nothing. */
export default function NothingShell({ skin, hidden = false }: { skin: SkinId; hidden?: boolean }) {
  const { mc, api } = useShellBridge(skin)
  const host = useRef<HTMLDivElement>(null)
  const shell = useRef<NothingHandle | null>(null)
  useEffect(() => {
    const el = host.current!
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${css}</style>`
    el.dataset.theme = mc.theme
    shell.current = mountNothing(el, api, mc)
    document.documentElement.classList.add('nshell-on')
    const go = (id: string | null) => { if (id) shell.current?.go(id) }
    go(takePending())
    const on = (e: Event) => { go((e as CustomEvent<string>).detail); takePending() }
    window.addEventListener('mc:shell-open', on)
    return () => {
      window.removeEventListener('mc:shell-open', on)
      shell.current?.unmount(); shell.current = null; document.documentElement.classList.remove('nshell-on')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* Hidden behind a classic page: no redraws, and the classic dock and undo bar come back; showing again catches up. */
  useEffect(() => { document.documentElement.classList.toggle('nshell-on', !hidden); if (!hidden) { shell.current?.shown(); shell.current?.update(mc) } }, [mc, hidden])
  return <div ref={host} className="nshell" style={hidden ? { display: 'none' } : undefined} />
}
