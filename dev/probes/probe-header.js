// Verify the header anchor (scripts/screenshot.mjs --eval-file).
//
// Checks the resting state (cards only, centred inside the conversation header),
// clicks the card row to confirm the rest of the panel appears, and clicks again
// to confirm it folds back. Everything is reported as JSON for the caller.
(async function probeHeader() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }

  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host) return JSON.stringify({ error: 'panel host missing' })
  var root = host.shadowRoot
  if (!root) return JSON.stringify({ error: 'shadow root missing' })
  var win = root.querySelector('.wb-win')
  if (!win) return JSON.stringify({ error: 'panel window missing' })

  var LABELS = ['对话', '上下文', '编队']

  function band() {
    var vp = window.innerWidth
    var nodes = document.querySelectorAll('div,header,section,nav')
    var pick = null
    for (var i = 0; i < nodes.length; i += 1) {
      var rect = nodes[i].getBoundingClientRect()
      if (rect.height < 20 || rect.height > 92) continue
      if (rect.width < 320 || rect.top > 160) continue
      var text = (nodes[i].textContent || '').replace(/\s+/g, '')
      if (text.indexOf('对话') === -1) continue
      if (text.indexOf('上下文') === -1 && text.indexOf('编队') === -1) continue
      if (rect.right < vp - 240) continue
      var area = rect.width * rect.height
      if (!pick || area < pick.area) pick = { node: nodes[i], rect: rect, area: area }
    }
    if (!pick) return null
    var tabsRight = pick.rect.left + 8
    var inner = pick.node.querySelectorAll('*')
    for (var j = 0; j < inner.length; j += 1) {
      if (LABELS.indexOf((inner[j].textContent || '').trim()) === -1) continue
      var box = inner[j].getBoundingClientRect()
      if (box.width && box.right > tabsRight) tabsRight = box.right
    }
    var left = Math.max(8, tabsRight + 14)
    var right = Math.max(left + 80, Math.min(pick.rect.right, vp) - 14)
    return { left: left, right: right, top: pick.rect.top, height: pick.rect.height }
  }

  function snap(name) {
    var rect = win.getBoundingClientRect()
    var head = root.querySelector('.wb-head')
    var foot = root.querySelector('.wb-foot')
    var grid = root.querySelector('.wb-kpis')
    return {
      name: name,
      cls: win.className,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      },
      headShown: head ? getComputedStyle(head).display !== 'none' : null,
      footShown: foot ? getComputedStyle(foot).display !== 'none' : null,
      kpiCount: grid ? grid.querySelectorAll('.wb-kpi').length : 0,
      title: (root.querySelector('.wb-title') || {}).textContent || ''
    }
  }

  var area = band()
  if (!area) {
    // The app opens on its home screen, which has no conversation tabs. Start a
    // conversation so the header this panel anchors to actually exists.
    var clickable = document.querySelectorAll('button,[role="button"],a,div[tabindex]')
    for (var c = 0; c < clickable.length; c += 1) {
      var text = (clickable[c].textContent || '').replace(/\s+/g, '')
      if (text !== '新会话' && text !== '新对话') continue
      clickable[c].click()
      break
    }
    await sleep(2200)
    area = band()
  }
  var compact = snap('compact')
  var centerDelta = area
    ? Math.round(compact.rect.left + compact.rect.w / 2 - (area.left + area.right) / 2)
    : null

  win.click()
  await sleep(460)
  var expanded = snap('expanded')

  var grid = root.querySelector('.wb-kpis')
  if (grid && expanded.headShown) grid.click()
  await sleep(460)
  var folded = snap('folded')

  return JSON.stringify({
    band: area
      ? {
          left: Math.round(area.left),
          right: Math.round(area.right),
          top: Math.round(area.top),
          height: Math.round(area.height)
        }
      : null,
    centerDelta: centerDelta,
    compact: compact,
    expanded: expanded,
    folded: folded
  })
})()
