function writeClipboardText(value, success, failure, sourceBtn) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    setCopyFeedback(sourceBtn, 'err');
    showToast(failure || 'Copy is not supported in this browser.');
    return;
  }
  navigator.clipboard.writeText(value).then(function() {
    setCopyFeedback(sourceBtn, 'ok');
    showToast(success || 'Copied.');
    if (typeof setExportDropdownOpen === 'function') setExportDropdownOpen(false, false);
  }).catch(function() {
    setCopyFeedback(sourceBtn, 'err');
    showToast(failure || 'Copy failed.');
  });
}

function copySource() {
  writeClipboardText(editor.value, 'Source copied.', 'Copy source failed.', copySourceBtn);
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
  if (fmt !== 'diagram' && typeof ensureTextOutputs === 'function') ensureTextOutputs();
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
    writeClipboardText(new XMLSerializer().serializeToString(svgEl), 'SVG markup copied.', 'Copy SVG failed.', copyTextOutputBtn);
    return;
  }
  var el = document.getElementById(currentCanvasFormat + '-output');
  var name = currentCanvasFormat === 'ascii' ? 'ASCII' : 'Unicode';
  writeClipboardText(el ? el.textContent : '', name + ' output copied.', 'Copy ' + name + ' failed.', copyTextOutputBtn);
});

document.addEventListener('click', function(e) {
  var clearBtn = e.target.closest('[data-action="clear-editor"]');
  if (!clearBtn) return;
  clearEditor();
  if (typeof setExamplesSidebarOpen === 'function') setExamplesSidebarOpen(false);
});

// Keyboard-shortcut cheat sheet — reachable only via the "?" key (there is no
// topbar button). Same popup contract as the other popovers: inert +
// aria-hidden when closed, Escape or a scrim click closes, focus returns to
// wherever it was when "?" was pressed.
var shortcutsDialog = document.getElementById('shortcuts-dialog');
var shortcutsDialogClose = document.getElementById('shortcuts-dialog-close');
var shortcutsReturnFocus = null;

var shortcutsPopup = (shortcutsDialog && typeof createPopupController === 'function')
  ? createPopupController({
      popup: shortcutsDialog,
      visibility: { manageTabStops: true },
      afterOpen: function() {
        if (shortcutsDialogClose) shortcutsDialogClose.focus();
      },
      afterClose: function() {
        if (shortcutsReturnFocus && typeof shortcutsReturnFocus.focus === 'function') shortcutsReturnFocus.focus();
        shortcutsReturnFocus = null;
      },
    })
  : null;

if (shortcutsDialogClose) shortcutsDialogClose.addEventListener('click', function() {
  if (shortcutsPopup) shortcutsPopup.close({ source: 'close-button' });
});

// Click on the scrim (outside the panel) closes, like a modal backdrop.
if (shortcutsDialog) shortcutsDialog.addEventListener('click', function(e) {
  if (e.target === shortcutsDialog && shortcutsPopup) shortcutsPopup.close({ source: 'backdrop' });
});

document.addEventListener('keydown', function(e) {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || !shortcutsPopup) return;
  var target = e.target;
  var tag = target && target.tagName;
  // "?" is typed text inside the source editor and other fields; only treat it
  // as the cheat-sheet shortcut when focus is outside editable controls.
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || (target && target.isContentEditable)) return;
  e.preventDefault();
  shortcutsReturnFocus = document.activeElement;
  shortcutsPopup.open({ source: 'keyboard' });
});
