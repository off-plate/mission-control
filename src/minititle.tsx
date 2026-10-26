import { useEffect, useState, type RefObject } from 'react'

/* iOS large titles (2026-10-26): on a phone, once the page's big title has
   scrolled up under the header, its name appears small in the middle of the
   header, the way Settings and Notes do it. Scrolling back down hands it back.
   It reads the title from the page's own band, so no page has to say it twice. */
export function MiniTitle({ page, stick }: { page: string; stick: RefObject<HTMLElement | null> }) {
  const [label, setLabel] = useState('')
  const [on, setOn] = useState(false)
  useEffect(() => {
    setOn(false)
    if (!matchMedia('(max-width: 639px)').matches) return
    let io: IntersectionObserver | null = null
    let tries = 0, timer = 0
    const hook = () => {
      const h = document.querySelector<HTMLElement>('main .band h1')
      if (!h) { if (tries++ < 20) timer = window.setTimeout(hook, 100); return }
      setLabel((h.innerText || h.textContent || '').split('\n')[0].trim())
      const top = Math.round(stick.current?.getBoundingClientRect().height ?? 56)
      io = new IntersectionObserver(([e]) => setOn(!e.isIntersecting && e.boundingClientRect.top < top), { rootMargin: `-${top}px 0px 0px 0px` })
      io.observe(h)
    }
    timer = window.setTimeout(hook, 30)
    return () => { window.clearTimeout(timer); io?.disconnect() }
  }, [page, stick])
  /* The header is clear at the top of a page and turns to frosted glass once
     content scrolls under it, instead of carrying a shadow at all times. */
  useEffect(() => {
    const el = stick.current
    if (!el) return
    const on = () => el.classList.toggle('is-under', window.scrollY > 2)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [stick])
  return <span className={`topbar-mini${on ? ' is-on' : ''}`} aria-hidden="true">{label}</span>
}
