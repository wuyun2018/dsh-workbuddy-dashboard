// Leave the panel expanded in the conversation header (visual check / screenshot).
(async function probeExpandReal() {
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

  var trigger = document.querySelector('button[class*="newSession"]')
  if (trigger) {
    trigger.click()
    await sleep(2200)
  }

  var view = document.querySelector('[data-wb-dash="root"]').shadowRoot
  var win = view.querySelector('.wb-win')
  if (win.className.indexOf('minimal') !== -1) win.click()
  await sleep(700)

  return JSON.stringify({ cls: win.className, rect: rectOf(win) })
})()
