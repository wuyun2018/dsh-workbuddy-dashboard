/**
 * Probe: verify the anchored panel against a real DSH instance.
 *
 *   node scripts/screenshot.mjs "<url with token>" <out.png> --size 1920x1027 \
 *     --eval-file scripts/probe-real-anchor.js
 *
 * Reports the conversation header box, the tab labels, and the panel geometry in
 * the resting / expanded / folded states. It opens a conversation first when the
 * app is sitting on the sessionless home screen.
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
  const headers = () => Array.prototype.slice.call(document.querySelectorAll('header')).map((node) => ({
    cls: String(node.className || '').slice(0, 70),
    rect: box(node),
  }))
  const tabs = () => Array.prototype.slice.call(document.querySelectorAll('*')).filter((node) => {
    const text = (node.textContent || '').trim()
    return text === '对话' || text === '上下文' || text === '编队'
  }).map((node) => ({ text: (node.textContent || '').trim(), rect: box(node), tag: node.tagName.toLowerCase() }))
  const panel = () => ({
    cls: String(win.className).replace(/\s+/g, ' ').trim(),
    rect: box(win),
    head: Math.round(shadow.querySelector('.wb-head').getBoundingClientRect().height),
    foot: Math.round(shadow.querySelector('.wb-foot').getBoundingClientRect().height),
    cards: shadow.querySelectorAll('.wb-kpi').length,
  })
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
    return String(target.className || target.tagName || '').slice(0, 40)
  }

  const out = { before: { headers: headers(), tabs: tabs(), panel: panel() } }
  const newChat = document.querySelector('button[class*="newSession"]')
  if (newChat) {
    newChat.click()
    await sleep(2800)
  }
  out.afterNewChat = { headers: headers(), tabs: tabs(), panel: panel() }

  out.hitCard = clickNode(shadow.querySelector('.wb-kpi'))
  await sleep(420)
  out.expanded = panel()

  const head = shadow.querySelector('.wb-head')
  if (head) {
    const rect = head.getBoundingClientRect()
    let target = null
    try {
      if (typeof shadow.elementFromPoint === 'function') target = shadow.elementFromPoint(rect.left + 46, rect.top + rect.height / 2)
    } catch (error) {
      target = null
    }
    out.hitTitle = target ? String(target.className || target.tagName).slice(0, 40) : 'fallback'
    ;(target || shadow.querySelector('.wb-title') || head).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
  }
  await sleep(420)
  out.folded = panel()
  return out
})()
