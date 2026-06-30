function writeClipboardText(value, success, failure, sourceBtn) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    setCopyFeedback(sourceBtn, 'err');
    showToast(failure || 'Copy is not supported in this browser.');
    return;
  }
  navigator.clipboard.writeText(value).then(function() {
    setCopyFeedback(sourceBtn, 'ok');
    showToast(success || 'Copied!');
    if (typeof setExportDropdownOpen === 'function') setExportDropdownOpen(false, false);
  }).catch(function() {
    setCopyFeedback(sourceBtn, 'err');
    showToast(failure || 'Copy failed.');
  });
}

function copySource() {
  writeClipboardText(editor.value, 'Source copied!', 'Copy source failed.', copySourceBtn);
}

function mermaidBodyStart(source) {
  var text = String(source || '').replace(/^---[\s\S]*?---\s*/, '');
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.indexOf('%%') === 0) continue;
    return line;
  }
  return '';
}

function detectAgentFamily(source) {
  var first = mermaidBodyStart(source).toLowerCase();
  if (/^(graph|flowchart)\b/.test(first)) return { family: 'flowchart', narrower: 'asFlowchart' };
  if (/^statediagram(?:-v2)?\b/.test(first)) return { family: 'state', narrower: 'asState' };
  if (/^sequencediagram\b/.test(first)) return { family: 'sequence', narrower: 'asSequence' };
  if (/^timeline\b/.test(first)) return { family: 'timeline', narrower: 'asTimeline' };
  if (/^classdiagram\b/.test(first)) return { family: 'class', narrower: 'asClass' };
  if (/^erdiagram\b/.test(first)) return { family: 'er', narrower: 'asEr' };
  if (/^journey\b/.test(first)) return { family: 'journey', narrower: 'asJourney' };
  if (/^architecture\b/.test(first)) return { family: 'architecture', narrower: 'asArchitecture' };
  if (/^xychart(?:-beta)?\b/.test(first)) return { family: 'xychart', narrower: 'asXyChart' };
  if (/^pie\b/.test(first)) return { family: 'pie', narrower: 'asPie' };
  if (/^quadrantchart\b/.test(first)) return { family: 'quadrant', narrower: 'asQuadrant' };
  if (/^gantt\b/.test(first)) return { family: 'gantt', narrower: 'asGantt' };
  return { family: 'unknown', narrower: 'the matching as* helper' };
}

function buildAgentTaskPrompt() {
  var source = editor.value.trim();
  var detected = detectAgentFamily(source);
  return 'Use Agentic Mermaid locally.\n\n'
    + 'Task: Describe the diagram edit you want, then apply it to the Mermaid source below.\n\n'
    + 'Detected family: ' + detected.family + '\n'
    + 'Expected trace: parseMermaid → ' + detected.narrower + ' → mutate(...) → verifyMermaid → serializeMermaid\n\n'
    + 'Rules:\n'
    + '- Do not call the website as a render API.\n'
    + '- Parse with parseMermaid first.\n'
    + '- Use typed mutation ops when the family supports them; otherwise preserve source and ask before lossy edits.\n'
    + '- Run verifyMermaid before serialize, render, commit, or return.\n'
    + '- Return Mermaid source only after structural warnings are clear.\n\n'
    + 'Mermaid source:\n```mermaid\n'
    + (source || 'flowchart TD\n  A[Start] --> B[Edit me]')
    + '\n```';
}

function copyAgentTask() {
  writeClipboardText(buildAgentTaskPrompt(), 'Agent task prompt copied!', 'Copy agent task failed.', copyAgentTaskBtn);
}

function clearEditor() {
  editor.value = '';
  updateLineNumbers();
  updateCursorPos();
  previewInner.innerHTML = emptyPreviewHtml();
  if (typeof setTextOutputs === 'function') setTextOutputs('', '');
  statusText.textContent = 'Ready';
  statusText.className = '';
  renderTime.textContent = '';
  if (typeof resetVerifyPanel === 'function') resetVerifyPanel('Waiting for source');
  if (typeof updateExportAvailability === 'function') updateExportAvailability();
  if (typeof markActiveExample === 'function') markActiveExample('');
  window.history.replaceState(null, '', window.location.pathname);
  showToast('Started a blank diagram.');
}

var copySourceBtn = document.getElementById('copy-source-btn');
if (copySourceBtn) copySourceBtn.addEventListener('click', copySource);
var copyAgentTaskBtn = document.getElementById('copy-agent-prompt-btn');
if (copyAgentTaskBtn) copyAgentTaskBtn.addEventListener('click', copyAgentTask);

var currentCanvasFormat = 'diagram';
var CANVAS_FORMATS = ['diagram', 'unicode', 'ascii'];

// The preview shows one representation of the source at a time. Switching format
// swaps the canvas view, gates the zoom controls to the diagram, and retargets
// the copy button — so the same diagram is never on screen twice.
function selectCanvasFormat(fmt) {
  if (CANVAS_FORMATS.indexOf(fmt) < 0) fmt = 'diagram';
  currentCanvasFormat = fmt;
  document.querySelectorAll('[data-canvas-view]').forEach(function(el) {
    el.hidden = el.dataset.canvasView !== fmt;
  });
  document.querySelectorAll('[data-canvas-format]').forEach(function(btn) {
    var on = btn.dataset.canvasFormat === fmt;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  var zoomControls = document.getElementById('zoom-controls');
  if (zoomControls) zoomControls.hidden = fmt !== 'diagram';
  if (copyTextOutputBtn) {
    var label = fmt === 'diagram'
      ? 'Copy Mermaid source'
      : 'Copy ' + (fmt === 'ascii' ? 'ASCII' : 'Unicode') + ' output';
    copyTextOutputBtn.title = label;
    copyTextOutputBtn.setAttribute('aria-label', label);
  }
  if (fmt === 'unicode' && typeof fitUnicodeOutput === 'function') fitUnicodeOutput();
}

document.querySelectorAll('[data-canvas-format]').forEach(function(btn) {
  btn.addEventListener('click', function() { selectCanvasFormat(btn.dataset.canvasFormat); });
  btn.addEventListener('keydown', function(e) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    var btns = Array.prototype.slice.call(document.querySelectorAll('[data-canvas-format]'));
    var i = btns.indexOf(btn);
    var n = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    selectCanvasFormat(btns[n].dataset.canvasFormat);
    btns[n].focus();
  });
});

if (copyTextOutputBtn) copyTextOutputBtn.addEventListener('click', function() {
  if (currentCanvasFormat === 'diagram') {
    writeClipboardText(editor.value, 'Source copied!', 'Copy source failed.', copyTextOutputBtn);
    return;
  }
  var el = document.getElementById(currentCanvasFormat + '-output');
  var name = currentCanvasFormat === 'ascii' ? 'ASCII' : 'Unicode';
  writeClipboardText(el ? el.textContent : '', name + ' output copied!', 'Copy ' + name + ' failed.', copyTextOutputBtn);
});

document.addEventListener('click', function(e) {
  var clearBtn = e.target.closest('[data-action="clear-editor"]');
  if (!clearBtn) return;
  clearEditor();
  if (typeof setExamplesSidebarOpen === 'function') setExamplesSidebarOpen(false);
});
