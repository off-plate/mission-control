/* A light tap of the Taptic Engine, for the moments that commit something: a
   task done, a habit ticked, an amount logged, a slip owned.

   iOS gives a web page no vibration API. Since Safari 18 a switch-style
   checkbox ticks the Taptic Engine when it flips, and a click on its label
   flips it, so a hidden one is the tap. Android has navigator.vibrate. A
   desktop has neither, and this does nothing there. */
let label: HTMLLabelElement | null = null

export function haptic() {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number) => boolean }
    if (typeof nav.vibrate === 'function') { nav.vibrate(8); return }
    if (!matchMedia('(pointer: coarse)').matches) return
    if (!label) {
      label = document.createElement('label')
      label.setAttribute('aria-hidden', 'true')
      label.style.cssText = 'position:fixed;left:-20px;top:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      label.appendChild(input)
      document.body.appendChild(label)
    }
    label.click()
  } catch { /* no haptics here, and nothing else depends on them */ }
}
