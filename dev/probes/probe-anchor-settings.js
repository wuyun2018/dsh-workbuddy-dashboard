/**
 * Probe: open the in-panel settings view and report the position picker.
 *
 *   node scripts/screenshot.mjs <url> <out.png> --eval-file dev/probes/probe-anchor-settings.js
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const host = document.querySelector('[data-wb-dash="root"]')
  if (!host || !host.shadowRoot) return { error: 'panel host missing' }
  const shadow = host.shadowRoot
  const win = shadow.querySelector('.wb-win')
  if (!win) return { error: 'panel window missing' }

  const box = (node) => {
    const rect = node.getBoundingClientRect()
    return { l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
  }
  const clickNode = (node) => {
    const rect = node.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    let target = null
    try {
      if (typeof shadow.elementFromPoint === 'function') target = shadow.elementFromPoint(x, y)
    } catch (error) {
      target = null
    }
    if (!target) target = node
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y }))
    return String(target.className || target.tagName || '')
  }

  if (String(win.className).indexOf('minimal') !== -1) {
    const card = shadow.querySelector('.wb-kpi')
    if (card) clickNode(card)
    await sleep(340)
  }
  const buttons = Array.prototype.slice.call(shadow.querySelectorAll('.wb-head .wb-btn'))
  const gear = buttons.filter((node) => node.textContent.trim() === '⚙')[0]
  if (!gear) return { error: 'settings button missing', buttons: buttons.map((n) => n.textContent) }
  clickNode(gear)
  await sleep(420)

  const sections = Array.prototype.slice.call(shadow.querySelectorAll('.wb-set-sec')).map((node) => {
    const title = node.querySelector('.wb-set-title')
    return {
      title: title ? title.textContent.replace(/\s+/g, ' ').trim() : '',
      chips: Array.prototype.slice.call(node.querySelectorAll('.wb-chip')).map((chip) => ({
        label: chip.textContent.trim(),
        on: chip.classList.contains('on'),
      })),
    }
  })
  const place = Array.prototype.slice.call(shadow.querySelectorAll('.wb-set-sec')).filter((node) => {
    const title = node.querySelector('.wb-set-title')
    return title && title.textContent.indexOf('位置') !== -1
  })[0]
  if (place && place.scrollIntoView) place.scrollIntoView({ block: 'start' })
  await sleep(240)
  return { cls: String(win.className), rect: box(win), sections: sections }
})()
