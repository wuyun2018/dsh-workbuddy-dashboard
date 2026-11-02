// Read-only probe (scripts/screenshot.mjs --eval-file): opens the settings view
// and reports its size, without touching any preference. Used for documentation
// screenshots.
(function probe() {
  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host) return JSON.stringify({ error: 'panel host missing' })
  var root = host.shadowRoot
  var win = root.querySelector('.wb-win')
  var buttons = root.querySelectorAll('.wb-btn')
  for (var i = 0; i < buttons.length; i += 1) {
    if (buttons[i].title === '设置') {
      buttons[i].click()
      break
    }
  }
  var view = root.querySelector('.wb-settings')
  var rect = win.getBoundingClientRect()
  return JSON.stringify({
    settingsOpen: win.className.indexOf('settings') !== -1,
    viewHeight: view ? Math.round(view.getBoundingClientRect().height) : null,
    scrollHeight: view ? view.scrollHeight : null,
    winRect: { left: Math.round(rect.left), top: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
  })
})()
