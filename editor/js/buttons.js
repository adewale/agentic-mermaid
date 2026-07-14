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
  // Same guard as loadEditorExample: clearing discards the autosaved draft too.
  if (typeof editorHasUnsavedWork === 'function' && editorHasUnsavedWork()
      && !window.confirm('Start a blank diagram? Your current edits (and the autosaved draft) will be discarded.')) {
    return;
  }
  editor.value = '';
  setEditorErrorLine(0);
  if (typeof discardEditorDraft === 'function') discardEditorDraft();
  updateLineNumbers();
  updateCursorPos();
  previewInner.innerHTML = emptyPreviewHtml();
  delete previewInner.dataset.sharedRequestDigest;
  delete previewInner.dataset.renderRequestDigest;
  delete previewInner.dataset.appearanceDigest;
  lastRenderedSvgArtifact = null;
  if (typeof markTextOutputsDirty === 'function') markTextOutputsDirty();
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
    // Copy the canonical receipt-bearing artifact, never a DOM serialization
    // that extensions or browser tooling may have mutated after insertion.
    if (typeof hasCurrentVerifiedSvgArtifact !== 'function' || !hasCurrentVerifiedSvgArtifact()) {
      setCopyFeedback(copyTextOutputBtn, 'err');
      showToast('Render and verify a diagram before copying its SVG.');
      return;
    }
    writeClipboardText(lastRenderedSvgArtifact.svg, 'SVG markup copied.', 'Copy SVG failed.', copyTextOutputBtn);
    return;
  }
  var name = currentCanvasFormat === 'ascii' ? 'ASCII' : 'Unicode';
  if (typeof hasCurrentVerifiedSvgArtifact !== 'function' || !hasCurrentVerifiedSvgArtifact()) {
    setCopyFeedback(copyTextOutputBtn, 'err');
    showToast('Render and verify a diagram before copying its ' + name + ' output.');
    return;
  }
  var artifact = lastRenderedTextArtifacts && lastRenderedTextArtifacts[currentCanvasFormat];
  if (artifact && artifact.receipt.sharedRequestDigest !== previewInner.dataset.sharedRequestDigest) {
    setCopyFeedback(copyTextOutputBtn, 'err');
    showToast(name + ' output no longer matches the current diagram.');
    return;
  }
  // Oversize/error panes carry an explanatory string but no render artifact;
  // preserve the historical ability to copy that message.
  var el = document.getElementById(currentCanvasFormat + '-output');
  var value = artifact ? artifact.text : (el ? el.textContent : '');
  writeClipboardText(value, name + ' output copied.', 'Copy ' + name + ' failed.', copyTextOutputBtn);
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
var shortcutsInertSiblings = [];
var shortcutsHomeParent = shortcutsDialog && shortcutsDialog.parentNode;
var shortcutsHomeNextSibling = shortcutsDialog && shortcutsDialog.nextSibling;
var shortcutsExitTail = null;
var shortcutsExitTimer = null;

function portalShortcutsDialog() {
  if (shortcutsDialog && shortcutsDialog.parentNode !== document.body) document.body.appendChild(shortcutsDialog);
}

function restoreShortcutsDialog() {
  if (!shortcutsDialog || !shortcutsHomeParent || shortcutsDialog.parentNode === shortcutsHomeParent) return;
  shortcutsHomeParent.insertBefore(shortcutsDialog, shortcutsHomeNextSibling);
}

function clearShortcutsExitTail() {
  if (shortcutsExitTimer) clearTimeout(shortcutsExitTimer);
  shortcutsExitTimer = null;
  if (shortcutsExitTail && shortcutsExitTail.parentNode) shortcutsExitTail.parentNode.removeChild(shortcutsExitTail);
  shortcutsExitTail = null;
}

function createShortcutsExitTail() {
  if (!shortcutsDialog || (typeof EditorMotion !== 'undefined' && EditorMotion.reduced())) return;
  clearShortcutsExitTail();
  var tail = shortcutsDialog.cloneNode(true);
  tail.removeAttribute('id');
  tail.removeAttribute('aria-modal');
  tail.removeAttribute('aria-labelledby');
  tail.setAttribute('aria-hidden', 'true');
  tail.inert = true;
  tail.querySelectorAll('[id]').forEach(function(node) { node.removeAttribute('id'); });
  tail.style.pointerEvents = 'none';
  document.body.appendChild(tail);
  shortcutsExitTail = tail;
  shortcutsExitTimer = setTimeout(clearShortcutsExitTail, 90);
}

function shortcutsReturnTarget(target) {
  var fallback = null;
  for (var node = target; node && node !== document.body; node = node.parentElement) {
    if (!node.id) continue;
    var trigger = document.querySelector('[aria-controls="' + node.id + '"]');
    if (trigger && !trigger.closest('[inert]')) fallback = trigger;
  }
  return fallback || target;
}

function setShortcutsBackgroundInert(open) {
  if (!shortcutsDialog) return;
  if (open) {
    shortcutsInertSiblings = [];
    Array.prototype.forEach.call(document.body.children, function(child) {
      if (child === shortcutsDialog) return;
      shortcutsInertSiblings.push({ element: child, inert: child.inert });
      child.inert = true;
    });
    return;
  }
  shortcutsInertSiblings.forEach(function(entry) { entry.element.inert = entry.inert; });
  shortcutsInertSiblings = [];
}

function shortcutsFocusable() {
  if (!shortcutsDialog) return [];
  return Array.prototype.slice.call(shortcutsDialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(function(el) { return !el.disabled && el.offsetParent !== null; });
}

function trapShortcutsFocus(e) {
  if (!shortcutsPopup || !shortcutsPopup.isOpen() || e.key !== 'Tab') return;
  var focusable = shortcutsFocusable();
  if (!focusable.length) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  if (!shortcutsDialog.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

var shortcutsPopup = (shortcutsDialog && typeof createPopupController === 'function')
  ? createPopupController({
      popup: shortcutsDialog,
      visualClose: true,
      visibility: { manageTabStops: true },
      afterOpen: function() {
        clearShortcutsExitTail();
        portalShortcutsDialog();
        setShortcutsBackgroundInert(true);
        document.addEventListener('keydown', trapShortcutsFocus, true);
        if (shortcutsDialogClose) shortcutsDialogClose.focus();
      },
      afterClose: function() {
        createShortcutsExitTail();
        clearPopupClosing(shortcutsDialog);
        restoreShortcutsDialog();
        setShortcutsBackgroundInert(false);
        document.removeEventListener('keydown', trapShortcutsFocus, true);
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
  shortcutsReturnFocus = shortcutsReturnTarget(document.activeElement);
  shortcutsPopup.open({ source: 'keyboard' });
});
