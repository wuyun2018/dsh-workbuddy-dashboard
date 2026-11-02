// Open the header panel and leave it open (screenshot helper).
(async function expandPanel() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }
  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host || !host.shadowRoot) return JSON.stringify({ error: 'panel host missing' })
  var win = host.shadowRoot.querySelector('.wb-win')
  win.click()
  await sleep(520)
  var rect = win.getBoundingClientRect()
  return JSON.stringify({
    cls: win.className,
    rect: {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    }
  })
})()
