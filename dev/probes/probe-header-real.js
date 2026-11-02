// Real-page check: compact card strip -> click to expand -> click cards to fold.
(async function probeHeaderReal() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }
  function rectOf(node) {
    var rect = node.getBoundingClientRect()
    return {
      l: Math.round(rect.left),
      t: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    }
  }
  function visible(node) {
    if (!node) return false
    var style = window.getComputedStyle(node)
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().height > 0
  }

  var trigger = document.querySelector('button[class*="newSession"]')
  if (trigger) {
    trigger.click()
    await sleep(2200)
  }

  var host = document.querySelector('[data-wb-dash="root"]')
  var view = host.shadowRoot
  var win = view.querySelector('.wb-win')
  var head = view.querySelector('.wb-head')
  var foot = view.querySelector('.wb-foot')
  var grid = view.querySelector('.wb-kpis')

  function snap() {
    var header = document.querySelector('header')
    return {
      cls: win.className,
      rect: rectOf(win),
      headShown: visible(head),
      footShown: visible(foot),
      kpiCount: view.querySelectorAll('.wb-kpi').length,
      headerRect: header ? rectOf(header) : null,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    }
  }

  var compact = snap()
  win.click()
  await sleep(560)
  var expanded = snap()
  grid.click()
  await sleep(560)
  var folded = snap()

  return JSON.stringify({
    compact: compact,
    expanded: expanded,
    folded: folded,
    sameAfterFold: JSON.stringify(folded.rect) === JSON.stringify(compact.rect)
  })
})()
