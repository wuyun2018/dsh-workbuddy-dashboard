// Open a conversation and report where the header strip and the panel landed.
(async function openChat() {
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
  if (!trigger) {
    var buttons = document.querySelectorAll('button')
    for (var i = 0; i < buttons.length; i += 1) {
      if ((buttons[i].textContent || '').indexOf('新会话') === 0) {
        trigger = buttons[i]
        break
      }
    }
  }
  var clicked = false
  if (trigger) {
    trigger.click()
    clicked = true
  }
  await sleep(2600)

  var labels = []
  var nodes = document.querySelectorAll('*')
  for (var j = 0; j < nodes.length; j += 1) {
    var text = (nodes[j].textContent || '').trim()
    if (text !== '对话' && text !== '上下文' && text !== '编队') continue
    labels.push({ text: text, rect: rectOf(nodes[j]) })
  }

  var header = document.querySelector('header')
  var win = document.querySelector('[data-wb-dash="root"]').shadowRoot.querySelector('.wb-win')
  return JSON.stringify({
    clicked: clicked,
    url: location.href,
    header: header
      ? { cls: String(header.className).slice(0, 90), rect: rectOf(header) }
      : null,
    labels: labels.slice(0, 6),
    panel: { cls: win.className, rect: rectOf(win) },
    viewport: { w: window.innerWidth, h: window.innerHeight }
  })
})()
