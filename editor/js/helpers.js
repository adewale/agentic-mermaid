function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function emptyPreviewHtml() {
  return '<div class="preview-placeholder" id="preview-placeholder">'
    + '<span>Start typing to render your diagram</span>'
    + '<button class="placeholder-example-btn" type="button" data-action="load-example">Load an example</button>'
    + '</div>';
}
