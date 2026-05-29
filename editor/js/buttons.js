function copySource() {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('Copy source is not supported in this browser.');
    return;
  }
  navigator.clipboard.writeText(editor.value).then(function() {
    showToast('Source copied!');
    var dropdown = document.getElementById('export-dropdown');
    if (dropdown) dropdown.classList.remove('open');
  }).catch(function() {
    showToast('Copy source failed.');
  });
}

function clearEditor() {
  editor.value = '';
  updateLineNumbers();
  updateCursorPos();
  previewInner.innerHTML = emptyPreviewHtml();
  statusText.textContent = 'Ready';
  statusText.className = '';
  renderTime.textContent = '';
  if (typeof updateExportAvailability === 'function') updateExportAvailability();
  if (typeof markActiveExample === 'function') markActiveExample('');
  window.history.replaceState(null, '', window.location.pathname);
  showToast('Started a blank diagram.');
}

var copySourceBtn = document.getElementById('copy-source-btn');
if (copySourceBtn) copySourceBtn.addEventListener('click', copySource);

document.addEventListener('click', function(e) {
  var clearBtn = e.target.closest('[data-action="clear-editor"]');
  if (!clearBtn) return;
  clearEditor();
  if (typeof setExamplesSidebarOpen === 'function') setExamplesSidebarOpen(false);
});
