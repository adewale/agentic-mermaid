var panBtn = document.getElementById('pan-btn');
var panActive = false;
var panStart = null;
var panPointerId = null;

function syncPanButton() {
  panBtn.classList.toggle('active', panActive);
  panBtn.setAttribute('aria-pressed', panActive ? 'true' : 'false');
  previewBody.classList.toggle('pan-mode', panActive);
}

panBtn.addEventListener('click', function() {
  panActive = !panActive;
  syncPanButton();
});
syncPanButton();

// Pointer events (not mouse events) so pan works with touch and pen too;
// pan-mode sets touch-action: none in CSS so touch drags reach us instead of
// triggering native scrolling.
previewBody.addEventListener('pointerdown', function(e) {
  var shouldPan = panActive || e.metaKey || e.ctrlKey;
  if (!shouldPan) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  panPointerId = e.pointerId;
  panStart = { x: e.clientX, y: e.clientY, sl: previewBody.scrollLeft, st: previewBody.scrollTop };
  previewBody.classList.add('panning');
  if (previewBody.setPointerCapture) {
    try { previewBody.setPointerCapture(e.pointerId); } catch(err) {}
  }
});

previewBody.addEventListener('pointermove', function(e) {
  if (!panStart || e.pointerId !== panPointerId) return;
  var dx = e.clientX - panStart.x;
  var dy = e.clientY - panStart.y;
  previewBody.scrollLeft = panStart.sl - dx;
  previewBody.scrollTop  = panStart.st  - dy;
});

function endPan(e) {
  if (!panStart || e.pointerId !== panPointerId) return;
  panStart = null;
  panPointerId = null;
  previewBody.classList.remove('panning');
}
previewBody.addEventListener('pointerup', endPan);
previewBody.addEventListener('pointercancel', endPan);

window.addEventListener('keydown', function(e) {
  if (e.metaKey || e.ctrlKey) previewBody.classList.add('cmd-pan');
});
window.addEventListener('keyup', function(e) {
  if (!e.metaKey && !e.ctrlKey) previewBody.classList.remove('cmd-pan');
});

previewBody.addEventListener('wheel', function(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  var factor = Math.pow(0.999, e.deltaY);
  var svgEl = previewInner.querySelector('svg');
  if (!svgEl) {
    applyZoom(state.zoom * factor);
    return;
  }
  // Anchor the zoom at the cursor: remember which diagram point sits under it,
  // apply the (clamped) zoom, then scroll so that point lands back under it.
  var before = svgEl.getBoundingClientRect();
  var px = (e.clientX - before.left) / (before.width || 1);
  var py = (e.clientY - before.top) / (before.height || 1);
  applyZoom(state.zoom * factor);
  var after = svgEl.getBoundingClientRect();
  previewBody.scrollLeft += (after.left + px * after.width) - e.clientX;
  previewBody.scrollTop  += (after.top + py * after.height) - e.clientY;
}, { passive: false });
