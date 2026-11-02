// Drag the panel header so its left edge lands 12 px short of the right edge,
// i.e. inside the default 24 px snap threshold. Expectation: the panel snaps
// flush (rightGap 0) and the dock is remembered.
(function probe() {
  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host) return JSON.stringify({ error: 'panel host missing' })
  var root = host.shadowRoot
  if (!root) return JSON.stringify({ error: 'shadow root missing' })
  var win = root.querySelector('.wb-win')
  var head = root.querySelector('.wb-head')
  if (!win || !head) return JSON.stringify({ error: 'panel nodes missing' })

  var before = win.getBoundingClientRect()
  var grabX = 60
  var grabY = 14
  var dx = before.left + grabX - before.left
  // Target: right edge 12 px away from the viewport edge.
  var targetLeft = window.innerWidth - before.width - 12
  var targetClientX = targetLeft + grabX

  function fire(type, x, y) {
    head.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 7,
        pointerType: 'mouse',
        isPrimary: true
      })
    )
  }

  fire('pointerdown', before.left + grabX, before.top + grabY)
  fire('pointermove', before.left + grabX + 80, before.top + grabY + 60)
  fire('pointermove', targetClientX, before.top + grabY + 60)
  fire('pointerup', targetClientX, before.top + grabY + 60)

  var after = win.getBoundingClientRect()
  var store = null
  try {
    store = JSON.parse(localStorage.getItem('wb-dash:v1') || 'null')
  } catch (error) {
    store = String(error)
  }
  return JSON.stringify({
    vw: window.innerWidth,
    targetGap: 12,
    threshold: 24,
    dx: dx,
    rightGap: Math.round(window.innerWidth - after.right),
    bottomGap: Math.round(window.innerHeight - after.bottom),
    cls: win.className,
    store: store
  })
})()
