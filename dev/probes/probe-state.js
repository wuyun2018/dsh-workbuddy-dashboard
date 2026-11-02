// Read-only probe (scripts/screenshot.mjs --eval-file): closes the settings view
// when it is open and reports what the dashboard currently renders, so persisted
// preferences can be verified through a fresh page load.
(function probe() {
  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host) return JSON.stringify({ error: 'panel host missing' })
  var root = host.shadowRoot
  if (!root) return JSON.stringify({ error: 'shadow root missing' })
  var win = root.querySelector('.wb-win')

  if (win.className.indexOf('settings') !== -1) {
    var buttons = root.querySelectorAll('.wb-btn')
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].textContent === '← 返回') {
        buttons[i].click()
        break
      }
    }
  }

  function texts(selector) {
    var nodes = root.querySelectorAll(selector)
    var out = []
    for (var n = 0; n < nodes.length; n += 1) out.push(nodes[n].textContent)
    return out
  }

  var kpiLabels = texts('.wb-kpi-label')
  var sections = []
  var secNodes = root.querySelectorAll('.wb-content .wb-sec')
  for (var s = 0; s < secNodes.length; s += 1) {
    var titleNode = secNodes[s].querySelector('.wb-sec-head b')
    sections.push(titleNode ? titleNode.textContent : '(hidden)')
  }
  var store = null
  try {
    store = JSON.parse(localStorage.getItem('wb-dash:v1') || 'null')
  } catch (error) {
    store = String(error)
  }
  var rect = win.getBoundingClientRect()
  return JSON.stringify({
    settingsOpen: win.className.indexOf('settings') !== -1,
    kpiCount: kpiLabels.length,
    kpiLabels: kpiLabels,
    sections: sections,
    bgAlpha: win.style.getPropertyValue('--wb-bg-a'),
    cls: win.className,
    rect: { left: Math.round(rect.left), top: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
    foot: (root.querySelector('.wb-foot') || {}).textContent,
    store: store
  })
})()
