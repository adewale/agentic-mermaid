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
  return 'Create or edit a Mermaid diagram with Agentic Mermaid.\n\n'
    + 'Task:\n<replace with the requested diagram goal or edit>\n\n'
    + 'Context:\n<include the facts, labels, relationships, and constraints the diagram should express>\n\n'
    + 'Detected family: ' + detected.family + '\n'
    + 'Expected trace: parseMermaid → ' + detected.narrower + ' → mutate(...) → verifyMermaid → serializeMermaid\n\n'
    + 'Mermaid source (for edits; leave blank for a new diagram):\n```mermaid\n'
    + (source || '')
    + '\n```\n\n'
    + 'Environment:\n'
    + '- Do not assume this repository is checked out. Use one local channel available to you: installed `agentic-mermaid/agent`, this repo\'s `./src/agent/index.ts`, the CLI (`am` or `bun run bin/am.ts`), or self-hosted MCP Code Mode.\n'
    + '- Do not call the website as a render API. If no local Agentic Mermaid channel is available, do not fabricate verification; return the best Mermaid source and say `not verified — Agentic Mermaid unavailable` with what you tried.\n'
    + '- Library imports, when available: `parseMermaid`, `verifyMermaid`, `serializeMermaid`, `mutate`, and `as*` helpers from `agentic-mermaid/agent`.\n\n'
    + 'Workflow:\n'
    + '1. For a new diagram, author Mermaid source directly from the supplied context, then parse it with `parseMermaid`.\n'
    + '2. For an existing diagram, parse it, narrow with the matching `as*` helper (`asFlowchart`, `asSequence`, `asGantt`, etc.), and prefer the smallest `mutate(...)` operation.\n'
    + '3. Mutation ops use a `kind` discriminator (for example `{ kind: "add_edge", from, to, label }`). Discover exact ops from local types, `am capabilities --json`, or `/capabilities.json` when present.\n'
    + '4. If no typed operation fits, make the smallest source-level edit and say `source-level fallback`.\n'
    + '5. Run `verifyMermaid` on the final diagram or source. If structural warnings remain after one mechanical fix attempt, return the warnings instead of guessing.\n'
    + '6. Return mode:\n'
    + '   - In chat, return exactly these sections: Updated Mermaid, Verification, Trace.\n'
    + '   - In MCP/Code Mode `execute(code)`, return an object with `{ source }` after verification, or `{ error, warnings }`; do not return prose from inside code.\n'
    + '7. In Updated Mermaid, include only the final Mermaid source in a ```mermaid fence. Do not return SVG, PNG, ASCII, or Unicode unless requested.\n'
    + '8. In Trace, name the local channel and exact calls/ops used: `parseMermaid`, the `as*` helper, `mutate({ kind: ... })`, `verifyMermaid`, and `serializeMermaid`; for new diagrams say `no mutate`.\n\n'
    + 'Do not modify project files unless the user explicitly asked you to change files.';
}

function copyAgentTask() {
  writeClipboardText(buildAgentTaskPrompt(), 'Agent task prompt copied!', 'Copy agent task failed.', copyAgentTaskBtn);
}

function clearEditor() {
  editor.value = '';
  setEditorErrorLine(0);
  if (typeof discardEditorDraft === 'function') discardEditorDraft();
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
// Topbar entry point for the same handoff (visible ≥1100px); copy feedback
// lands on the button that was actually clicked.
var agentPromptTopbarBtn = document.getElementById('agent-prompt-topbar-btn');
if (agentPromptTopbarBtn) agentPromptTopbarBtn.addEventListener('click', function() {
  writeClipboardText(buildAgentTaskPrompt(), 'Agent task prompt copied!', 'Copy agent task failed.', agentPromptTopbarBtn);
});

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
      ? 'Copy SVG markup'
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
    // Copy the rendered SVG markup — "Copy source" already lives in the export
    // dropdown, so the preview copy always copies what is on the canvas.
    var svgEl = previewInner.querySelector('svg');
    if (!svgEl) {
      setCopyFeedback(copyTextOutputBtn, 'err');
      showToast('Render a diagram before copying its SVG.');
      return;
    }
    writeClipboardText(new XMLSerializer().serializeToString(svgEl), 'SVG markup copied!', 'Copy SVG failed.', copyTextOutputBtn);
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

// Keyboard-shortcut cheat sheet — same popup contract as the other popovers:
// inert + aria-hidden when closed, Escape closes, focus returns to the opener.
var shortcutsBtn = document.getElementById('shortcuts-btn');
var shortcutsDialog = document.getElementById('shortcuts-dialog');
var shortcutsDialogClose = document.getElementById('shortcuts-dialog-close');

var shortcutsPopup = (shortcutsBtn && shortcutsDialog && typeof createPopupController === 'function')
  ? createPopupController({
      popup: shortcutsDialog,
      trigger: shortcutsBtn,
      visibility: { manageTabStops: true, toggleTriggerClass: false },
      afterOpen: function() {
        if (shortcutsDialogClose) shortcutsDialogClose.focus();
      },
    })
  : null;

if (shortcutsDialogClose) shortcutsDialogClose.addEventListener('click', function() {
  if (shortcutsPopup) shortcutsPopup.close({ source: 'close-button', restoreFocus: true });
});

document.addEventListener('keydown', function(e) {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || !shortcutsPopup) return;
  var target = e.target;
  var tag = target && target.tagName;
  // "?" is typed text inside the source editor and other fields; only treat it
  // as the cheat-sheet shortcut when focus is outside editable controls.
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || (target && target.isContentEditable)) return;
  e.preventDefault();
  shortcutsPopup.open({ source: 'keyboard' });
});
