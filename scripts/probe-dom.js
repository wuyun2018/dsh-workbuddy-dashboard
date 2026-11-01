// Diagnostics: what does the DSH conversation header look like in the DOM?
(async function dumpHeaderDom() {
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms)
    })
  }
  function snippet(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48)
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

  var labels = []
  var all = document.querySelectorAll('*')
  for (var i = 0; i < all.length; i += 1) {
    var text = (all[i].textContent || '').trim()
    if (text !== '对话' && text !== '上下文' && text !== '编队') continue
    labels.push({ text: text, tag: all[i].tagName, cls: String(all[i].className).slice(0, 60), rect: rectOf(all[i]) })
  }

  var strips = []
  var nodes = document.querySelectorAll('div,header,section,nav')
  for (var j = 0; j < nodes.length; j += 1) {
    var rect = nodes[j].getBoundingClientRect()
    if (rect.height > 100 || rect.width < 300 || rect.top > 200) continue
    strips.push({
      tag: nodes[j].tagName,
      cls: String(nodes[j].className).slice(0, 70),
      rect: rectOf(nodes[j]),
      text: snippet(nodes[j])
    })
  }

  var compact = document.querySelector('[data-wb-dash="root"]').shadowRoot.querySelector('.wb-win')
  return JSON.stringify({
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    labels: labels.slice(0, 8),
    strips: strips.slice(0, 14),
    panelRect: rectOf(compact)
  })
})()
