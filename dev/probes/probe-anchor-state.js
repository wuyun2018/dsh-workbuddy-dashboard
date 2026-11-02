/**
 * Probe: exercise the anchored modes with realistic clicks and report geometry.
 *
 *   node scripts/screenshot.mjs <url> <out.png> --eval-file dev/probes/probe-anchor-state.js
 *
 * It measures the resting compact row, expands it by clicking a card, folds it
 * again by clicking the title row (the case users hit first), then folds from a
 * section background and checks that clicking a real control does NOT fold.
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
  const snap = (tag) => ({
    tag,
    cls: String(win.className || '').replace(/\s+/g, ' ').trim(),
    rect: box(win),
    cards: shadow.querySelectorAll('.wb-kpi').length,
    head: Math.round(shadow.querySelector('.wb-head').getBoundingClientRect().height),
    foot: Math.round(shadow.querySelector('.wb-foot').getBoundingClientRect().height),
    expanded: shadow.querySelector('.wb-win').className.indexOf('minimal') === -1,
  })
  const center = (node) => {
    const rect = node.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  // Click what is actually painted at that point, walking into the shadow tree.
  const clickAt = (x, y) => {
    let target = null
    try {
      if (typeof shadow.elementFromPoint === 'function') target = shadow.elementFromPoint(x, y)
    } catch (error) {
      target = null
    }
    if (!target) {
      const rect = win.getBoundingClientRect()
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      target = inside ? win : null
    }
    if (!target) return 'miss'
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y }))
    const cls = String(target.className || '')
    return (target.tagName || '?').toLowerCase() + (cls ? '.' + cls.split(' ')[0] : '')
  }
  const clickNode = (node) => {
    const point = center(node)
    return clickAt(point.x, point.y)
  }

  const out = []
  out.push(snap('rest'))

  const card = shadow.querySelector('.wb-kpi')
  out.push({ hit: card ? clickNode(card) : 'no-card' })
  await sleep(360)
  out.push(snap('afterCardClick'))

  const head = shadow.querySelector('.wb-head')
  out.push({ hit: clickNode(head) })
  await sleep(360)
  out.push(snap('afterHeadClick'))

  const cardAgain = shadow.querySelector('.wb-kpi')
  out.push({ hit: cardAgain ? clickNode(cardAgain) : 'no-card' })
  await sleep(360)
  out.push(snap('expandedAgain'))

  const section = shadow.querySelector('.wb-sec')
  if (section) {
    const rect = section.getBoundingClientRect()
    out.push({ hit: clickAt(rect.left + 10, rect.top + 10) })
    await sleep(360)
    out.push(snap('afterSectionClick'))
  }

  // A control click must not fold the panel.
  const cardThird = shadow.querySelector('.wb-kpi')
  if (cardThird) clickNode(cardThird)
  await sleep(360)
  const control = shadow.querySelector('.wb-head .wb-btn')
  if (control) {
    out.push({ hit: clickNode(control) })
    await sleep(360)
    out.push(snap('afterRefreshClick'))
  }
  return out
})()
