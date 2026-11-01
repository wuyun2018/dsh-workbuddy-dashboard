// Diagnostics: what is clickable in the DSH sidebar? (probe/screenshot helper)
(function dumpSidebar() {
  var out = []
  var nodes = document.querySelectorAll('button,[role="button"],[role="treeitem"],[role="link"],a,li,div')
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i]
    var rect = node.getBoundingClientRect()
    if (rect.left > 270 || rect.width < 60 || rect.height < 16 || rect.height > 52) continue
    if (rect.top < 0 || rect.top > window.innerHeight) continue
    var text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 40) continue
    out.push({
      tag: node.tagName,
      role: node.getAttribute('role') || '',
      cls: String(node.className).slice(0, 40),
      text: text,
      rect: { l: Math.round(rect.left), t: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }
    })
    if (out.length >= 40) break
  }
  return JSON.stringify(out)
})()
