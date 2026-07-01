var isResizing = false;
var resizeStartX = 0;
var resizeStartW = 0;

function isNarrowViewport() {
  return window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
}

function resizeBounds() {
  return {
    min: 280,
    max: Math.max(280, window.innerWidth * 0.75),
  };
}

function setPanelWidth(px) {
  if (isNarrowViewport()) {
    panelLeft.style.width = '';
    if (resizeHandle) resizeHandle.setAttribute('aria-disabled', 'true');
    return;
  }
  var bounds = resizeBounds();
  var newW = Math.max(bounds.min, Math.min(bounds.max, px));
  panelLeft.style.width = newW + 'px';
  if (resizeHandle) {
    resizeHandle.setAttribute('aria-disabled', 'false');
    resizeHandle.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
    resizeHandle.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
    resizeHandle.setAttribute('aria-valuenow', String(Math.round(newW)));
    resizeHandle.setAttribute('aria-valuetext', 'Source panel width ' + Math.round(newW) + ' pixels');
  }
}

function startResize(e) {
  isResizing = true;
  resizeStartX = e.clientX;
  resizeStartW = panelLeft.getBoundingClientRect().width;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  if (resizeHandle.setPointerCapture && e.pointerId != null) resizeHandle.setPointerCapture(e.pointerId);
}

function moveResize(e) {
  if (!isResizing) return;
  var dx = e.clientX - resizeStartX;
  setPanelWidth(resizeStartW + dx);
}

function endResize(e) {
  if (!isResizing) return;
  isResizing = false;
  resizeHandle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  if (resizeHandle.releasePointerCapture && e && e.pointerId != null) resizeHandle.releasePointerCapture(e.pointerId);
}

resizeHandle.addEventListener('pointerdown', function(e) {
  if (isNarrowViewport()) return;
  e.preventDefault();
  startResize(e);
});

document.addEventListener('pointermove', moveResize);
document.addEventListener('pointerup', endResize);
document.addEventListener('pointercancel', endResize);

resizeHandle.addEventListener('keydown', function(e) {
  if (isNarrowViewport()) return;
  var current = panelLeft.getBoundingClientRect().width;
  var bounds = resizeBounds();
  var next = current;
  if (e.key === 'ArrowLeft') next = current - (e.shiftKey ? 48 : 16);
  else if (e.key === 'ArrowRight') next = current + (e.shiftKey ? 48 : 16);
  else if (e.key === 'Home') next = bounds.min;
  else if (e.key === 'End') next = bounds.max;
  else return;
  e.preventDefault();
  setPanelWidth(next);
});

function syncResponsivePanelWidth() {
  if (isNarrowViewport()) {
    panelLeft.style.width = '';
    if (resizeHandle) resizeHandle.setAttribute('aria-disabled', 'true');
  } else {
    setPanelWidth(panelLeft.getBoundingClientRect().width || 420);
  }
}

if (typeof window !== 'undefined') window.addEventListener('resize', syncResponsivePanelWidth);
syncResponsivePanelWidth();
