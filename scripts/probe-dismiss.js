// Dismisses the harness first-run dialog so documentation screenshots stay clean.
(function dismissDialog() {
  var clicked = [];
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i += 1) {
    var text = (buttons[i].textContent || '').trim();
    if (text === '继续' || text === 'Continue') {
      buttons[i].click();
      clicked.push(text);
    }
  }
  return JSON.stringify({ clicked: clicked });
})()
