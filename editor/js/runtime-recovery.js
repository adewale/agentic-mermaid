var reloadEditorButton = document.getElementById('reload-editor');
window.addEventListener('mermaid-runtime-status', function(event) {
  if (runtimeRecovery) runtimeRecovery.hidden = event.detail !== false;
});
if (reloadEditorButton) reloadEditorButton.addEventListener('click', async function() {
  reloadEditorButton.disabled = true;
  try {
    // A failed render leaves the URL pointing at older verified content.
    // Preserve current edits directly; browser storage may be unavailable.
    for (;;) {
      if (!editor.value.trim()) {
        runtimeRecovery.hidden = true;
        reloadEditorButton.disabled = false;
        return;
      }
      var snapshot = JSON.stringify(currentEditorShareState());
      var encoded = await encodeSourceCompressed(snapshot);
      if (snapshot !== JSON.stringify(currentEditorShareState())) continue;
      ++hashUpdateToken;
      window.history.replaceState(null, '', window.location.pathname + '#' + encoded);
      window.location.reload();
      return;
    }
  } catch (error) {
    showToast('Could not preserve this diagram for reload. Copy or export the source first.');
    reloadEditorButton.disabled = false;
  }
});
