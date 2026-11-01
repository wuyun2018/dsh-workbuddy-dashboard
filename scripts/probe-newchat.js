// Open a fresh conversation so the DSH conversation header (对话/上下文/编队) is
// on screen, then leave the page in that state (probe/screenshot helper).
(async function openConversation() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }
  var buttons = document.querySelectorAll('button,[role="button"],a,div[tabindex]')
  var clicked = null
  for (var i = 0; i < buttons.length; i += 1) {
    var text = (buttons[i].textContent || '').replace(/\s+/g, '')
    if (text !== '新会话' && text !== '新对话') continue
    buttons[i].click()
    clicked = text
    break
  }
  await sleep(1600)
  var labels = []
  var nodes = document.querySelectorAll('div,header,section,nav,span')
  for (var j = 0; j < nodes.length; j += 1) {
    var label = (nodes[j].textContent || '').trim()
    if (label === '对话' || label === '上下文' || label === '编队') labels.push(label)
  }
  return JSON.stringify({ clicked: clicked, labels: labels, url: location.href })
})()
