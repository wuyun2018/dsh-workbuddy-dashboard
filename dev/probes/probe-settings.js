// Interaction probe (scripts/screenshot.mjs --eval-file).
// Opens the in-panel settings view, changes a few preferences and reports the
// resulting DOM state. The caller then re-reads /workbuddy/api/prefs to prove the
// changes were persisted and rebuilt the snapshot.
(function probe() {
  var host = document.querySelector('[data-wb-dash="root"]')
  if (!host) return JSON.stringify({ error: 'panel host missing' })
  var root = host.shadowRoot
  if (!root) return JSON.stringify({ error: 'shadow root missing' })
  var win = root.querySelector('.wb-win')
  var gear = null
  var buttons = root.querySelectorAll('.wb-btn')
  for (var i = 0; i < buttons.length; i += 1) {
    if (buttons[i].title === '设置') gear = buttons[i]
  }
  if (!gear) {
    var titles = []
    for (var t = 0; t < buttons.length; t += 1) titles.push(buttons[t].textContent + '|' + buttons[t].title)
    return JSON.stringify({ error: 'settings button missing', buttons: titles })
  }
  gear.click()

  function chipInput(id) {
    var inputs = root.querySelectorAll('.wb-chip input')
    for (var n = 0; n < inputs.length; n += 1) {
      if (inputs[n].getAttribute('data-id') === id) return inputs[n]
    }
    return null
  }

  // Turn the "错误数" KPI card on.
  var errors = chipInput('errors')
  if (errors && !errors.checked) errors.click()
  // Turn the "排程" panel off.
  var scheduler = chipInput('scheduler')
  if (scheduler && scheduler.checked) scheduler.click()

  var sliders = root.querySelectorAll('.wb-settings input[type="range"]')
  var opacity = sliders[0]
  if (opacity) {
    opacity.value = '70'
    opacity.dispatchEvent(new Event('input', { bubbles: true }))
  }
  var distance = sliders[1]

  var selects = root.querySelectorAll('.wb-settings select')
  var refresh = selects[0]
  if (refresh) {
    refresh.value = '30000'
    refresh.dispatchEvent(new Event('change', { bubbles: true }))
  }

  var dockButtons = root.querySelectorAll('.wb-docks .wb-btn')
  var dockLabels = []
  for (var d = 0; d < dockButtons.length; d += 1) dockLabels.push(dockButtons[d].textContent)
  if (dockButtons.length >= 4) dockButtons[3].click()

  var checked = []
  var all = root.querySelectorAll('.wb-chip input')
  for (var c = 0; c < all.length; c += 1) {
    if (all[c].checked) checked.push(all[c].getAttribute('data-id'))
  }
  var hints = []
  var hintNodes = root.querySelectorAll('.wb-settings .wb-hint')
  for (var h = 0; h < hintNodes.length; h += 1) hints.push(hintNodes[h].textContent)

  var rect = win.getBoundingClientRect()
  var store = null
  try {
    store = JSON.parse(localStorage.getItem('wb-dash:v1') || 'null')
  } catch (error) {
    store = String(error)
  }
  return JSON.stringify({
    settingsOpen: win.className.indexOf('settings') !== -1,
    checkedChips: checked,
    opacitySlider: opacity ? opacity.value : null,
    distanceSlider: distance ? distance.value : null,
    dockLabels: dockLabels,
    hints: hints,
    rect: { left: Math.round(rect.left), top: Math.round(rect.top) },
    bgAlpha: win.style.getPropertyValue('--wb-bg-a'),
    store: store
  })
})()
