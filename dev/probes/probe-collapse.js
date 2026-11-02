// Interaction probe executed inside the harness page (see scripts/screenshot.mjs).
// Clicks the collapse button of the injected panel and reports its state.
(function probe() {
  var host = document.querySelector('[data-wb-dash="root"]');
  if (!host) return JSON.stringify({ error: 'panel host missing' });
  var root = host.shadowRoot;
  if (!root) return JSON.stringify({ error: 'shadow root missing' });
  var win = root.querySelector('.wb-win');
  var buttons = root.querySelectorAll('.wb-btn');
  var before = win.className;
  buttons[1].click();
  return JSON.stringify({
    buttons: buttons.length,
    before: before,
    after: win.className,
    stored: localStorage.getItem('wb-dash:v1')
  });
})()
