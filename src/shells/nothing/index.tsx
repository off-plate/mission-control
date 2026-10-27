import { useEffect, useRef } from 'react'
import { useShellBridge } from '../bridge'
import type { SkinId } from '../../skins'
import { mountNothing, type NothingHandle } from './shell.js'
import css from './nothing.css?inline'

/* The Nothing phone shell, full screen, in a shadow root so its CSS and the
   classic app's never meet. Lazy-loaded from App.tsx: Classic pays nothing. */
export default function NothingShell({ skin }: { skin: SkinId }) {
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
    return () => { shell.current?.unmount(); shell.current = null; document.documentElement.classList.remove('nshell-on') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { shell.current?.update(mc) }, [mc])
  return <div ref={host} className="nshell" />
}
