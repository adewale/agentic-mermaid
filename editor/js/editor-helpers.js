function updateLineNumbers() {
  var lines = editor.value.split('\n').length;
  var html = '';
  for (var i = 1; i <= lines; i++) {
    // editorErrorLine (helpers.js) marks the line the last render error named.
    html += i === editorErrorLine ? '<span class="line-number-error">' + i + '</span>\n' : i + '\n';
  }
  lineNumbers.innerHTML = html;
}

function updateCursorPos() {
  var val = editor.value;
  var pos = editor.selectionStart;
  var lines = val.substring(0, pos).split('\n');
  var line = lines.length;
  var col  = lines[lines.length - 1].length + 1;
  cursorPos.textContent = 'Ln ' + line + ', Col ' + col;
}

editor.addEventListener('scroll', function() {
  lineNumbers.scrollTop = editor.scrollTop;
});

editor.addEventListener('input', function() {
  if (typeof markActiveExample === 'function') markActiveExample('');
  setEditorErrorLine(0);
  updateLineNumbers();
  updateCursorPos();
  scheduleRender();
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
});

editor.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    var start = editor.selectionStart;
    var end   = editor.selectionEnd;
    editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
    setEditorErrorLine(0);
    updateLineNumbers();
    scheduleRender();
    if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    return;
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    scheduleRender(0);
    return;
  }
});

editor.addEventListener('keyup', updateCursorPos);
editor.addEventListener('click', updateCursorPos);
