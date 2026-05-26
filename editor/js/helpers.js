function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function emptyPreviewHtml() {
  return '<div class="preview-placeholder" id="preview-placeholder">'
    + '<span class="placeholder-kicker">Blank canvas</span>'
    + '<strong class="placeholder-title">No diagram yet</strong>'
    + '<span class="placeholder-copy">Start typing Mermaid syntax, or load a preset to see SVG output.</span>'
    + '<div class="placeholder-actions">'
    + '<button class="placeholder-example-btn" type="button" data-action="load-example">Load an example</button>'
    + '<button class="placeholder-chip" type="button" data-example="flowchart-basic">Flowchart</button>'
    + '<button class="placeholder-chip" type="button" data-example="sequence-basic">Sequence</button>'
    + '<button class="placeholder-chip" type="button" data-example="styled-flowchart">Role styled</button>'
    + '</div>'
    + '</div>';
}

function formatRenderErrorHtml(err) {
  var detail = String(err || 'Unknown render error');
  var lineMatch = detail.match(/line\s+(\d+)(?:[^\d]+(?:col|column)\s+(\d+))?/i) || detail.match(/(\d+):(\d+)/);
  var location = lineMatch
    ? ' Check around line ' + lineMatch[1] + (lineMatch[2] ? ', column ' + lineMatch[2] : '') + '.'
    : '';
  return '<div class="preview-error" role="alert">'
    + '<strong class="preview-error-title">We could not render this diagram.</strong>'
    + '<span class="preview-error-copy">Check the diagram type, indentation, arrows, and labels.' + escHtml(location) + '</span>'
    + '<code class="preview-error-detail">' + escHtml(detail) + '</code>'
    + '</div>';
}
