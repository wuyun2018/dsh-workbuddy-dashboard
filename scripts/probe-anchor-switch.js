/**
 * Probe: switch the anchor position from inside the settings view (the real user
 * path) and record the geometry the panel takes after each switch.
 *
 *   node scripts/screenshot.mjs <url> <out.png> --eval-file scripts/probe-anchor-switch.js
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
  const shot = (tag) => ({ tag, cls: String(win.className).replace(/\s+/g, ' ').trim(), rect: box(win) })
  const clickNode = (node) => {
    if (!node) return 'missing'
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
  const chipInput = (id) => {
    const inputs = shadow.querySelectorAll('.wb-chip input')
    for (let i = 0; i < inputs.length; i += 1) {
      if (inputs[i].getAttribute('data-id') === id) return inputs[i]
    }
    return null
  }
  const gear = () => {
    const buttons = Array.prototype.slice.call(shadow.querySelectorAll('.wb-head .wb-btn'))
    return buttons.filter((node) => node.textContent.trim() === '⚙')[0]
  }

  const out = []
  if (String(win.className).indexOf('minimal') !== -1) {
    clickNode(shadow.querySelector('.wb-kpi'))
    await sleep(340)
  }
  clickNode(gear())
  await sleep(420)
  out.push(shot('settings-open'))

  const modes = ['bottom-left', 'bottom-right', 'header', 'float']
  for (const mode of modes) {
    const input = chipInput('anchor-' + mode)
    if (!input) {
      out.push({ mode: mode, error: 'chip missing' })
      continue
    }
    input.click()
    await sleep(420)
    out.push(shot('after-' + mode))
    if (String(win.className).indexOf('settings') === -1) {
      // Switching to float closes nothing, but be safe: reopen settings.
      clickNode(gear())
      await sleep(360)
    }
  }

  // Back to the compact row and exercise the fold path once more.
  const back = Array.prototype.slice.call(shadow.querySelectorAll('.wb-btn')).filter((node) => node.textContent.indexOf('返回') !== -1)[0]
  if (back) clickNode(back)
  await sleep(420)
  out.push(shot('after-exit-settings'))
  clickNode(shadow.querySelector('.wb-kpi'))
  await sleep(420)
  out.push(shot('after-card-click'))
  const head = shadow.querySelector('.wb-head')
  if (head) {
    const rect = head.getBoundingClientRect()
    // Aim at the title text, not at the select in the middle of the row.
    let target = null
    try {
      if (typeof shadow.elementFromPoint === 'function') target = shadow.elementFromPoint(rect.left + 46, rect.top + rect.height / 2)
    } catch (error) {
      target = null
    }
    if (!target) target = shadow.querySelector('.wb-title') || head
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  }
  await sleep(420)
  out.push(shot('after-title-click'))
  return out
})()
