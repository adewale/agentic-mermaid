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
var copyAgentTaskBtn = document.getElementById('copy-agent-task-btn');
if (copyAgentTaskBtn) copyAgentTaskBtn.addEventListener('click', copyAgentTask);

function selectTextOutput(kind) {
  var unicodeWrap = document.getElementById('unicode-output-wrap');
  var asciiWrap = document.getElementById('ascii-output-wrap');
  var unicodeTab = document.getElementById('unicode-output-tab');
  var asciiTab = document.getElementById('ascii-output-tab');
  var showAscii = kind === 'ascii';
  if (unicodeWrap) { unicodeWrap.hidden = showAscii; unicodeWrap.classList.toggle('active', !showAscii); }
  if (asciiWrap) { asciiWrap.hidden = !showAscii; asciiWrap.classList.toggle('active', showAscii); }
  if (unicodeTab) { unicodeTab.classList.toggle('active', !showAscii); unicodeTab.setAttribute('aria-selected', showAscii ? 'false' : 'true'); unicodeTab.tabIndex = showAscii ? -1 : 0; }
  if (asciiTab) { asciiTab.classList.toggle('active', showAscii); asciiTab.setAttribute('aria-selected', showAscii ? 'true' : 'false'); asciiTab.tabIndex = showAscii ? 0 : -1; }
  if (!showAscii && typeof fitUnicodeOutput === 'function') fitUnicodeOutput();
}

document.querySelectorAll('[data-output-tab]').forEach(function(btn) {
  btn.addEventListener('click', function() { selectTextOutput(btn.dataset.outputTab); });
  btn.addEventListener('keydown', function(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var next = btn.dataset.outputTab === 'ascii' ? 'unicode' : 'ascii';
    selectTextOutput(next);
    var nextBtn = document.querySelector('[data-output-tab="' + next + '"]');
    if (nextBtn) nextBtn.focus();
  });
});

if (copyTextOutputBtn) copyTextOutputBtn.addEventListener('click', function() {
  var active = document.querySelector('.text-output.active code');
  var value = active ? active.textContent : '';
  writeClipboardText(value || '', 'Text output copied!', 'Copy text output failed.', copyTextOutputBtn);
});

document.addEventListener('click', function(e) {
  var clearBtn = e.target.closest('[data-action="clear-editor"]');
  if (!clearBtn) return;
  clearEditor();
  if (typeof setExamplesSidebarOpen === 'function') setExamplesSidebarOpen(false);
});
