document.getElementById('copy-source-btn').addEventListener('click', function() {
  navigator.clipboard.writeText(editor.value).then(function() { showToast('Source copied!'); });
});

document.getElementById('clear-btn').addEventListener('click', function() {
  editor.value = '';
  updateLineNumbers();
  previewInner.innerHTML = emptyPreviewHtml();
  statusText.textContent = 'Ready';
  statusText.className = '';
  renderTime.textContent = '';
  if (typeof updateExportAvailability === 'function') updateExportAvailability();
  window.history.replaceState(null, '', window.location.pathname);
});
