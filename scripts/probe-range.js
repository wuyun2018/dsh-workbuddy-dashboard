// Range switch probe: flips the panel to the d3 range and waits for a refresh.
(async function probeRange() {
  var host = document.querySelector('[data-wb-dash="root"]');
  var root = host && host.shadowRoot;
  if (!root) return JSON.stringify({ error: 'panel missing' });
  var select = root.querySelector('.wb-select');
  var sub = root.querySelector('.wb-sub');
  var before = sub.textContent;
  select.value = 'd3';
  select.dispatchEvent(new Event('change'));
  await new Promise(function (resolve) { setTimeout(resolve, 4000); });
  var values = Array.prototype.map.call(select.options, function (option) { return option.value; });
  return JSON.stringify({
    options: values,
    before: before,
    after: sub.textContent,
    stored: localStorage.getItem('wb-dash:v1'),
    trendHead: root.querySelector('.wb-sec-head span') ? root.querySelector('.wb-sec-head span').textContent : ''
  });
})()
