function getSvgNaturalSize(svgEl) {
  var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  var w = parseFloat(svgEl.getAttribute('width')) || svgEl.getBoundingClientRect().width || 400;
  var h = parseFloat(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect().height || 300;
  return { w: w, h: h };
}

var presentationZoom = state.zoom;
var zoomTarget = state.zoom;
var zoomSpring = null;
var zoomCommitTimer = null;

function constrainZoom(value) {
  return Math.max(0.1, Math.min(8, value));
}

function zoomAnchor(anchor) {
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) return anchor;
  var rect = previewBody.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function preserveZoomAnchor(svgEl, anchor, mutate) {
  var point = zoomAnchor(anchor);
  var before = svgEl.getBoundingClientRect();
  var x = (point.x - before.left) / (before.width || 1);
  var y = (point.y - before.top) / (before.height || 1);
  mutate();
  var after = svgEl.getBoundingClientRect();
  previewBody.scrollLeft += (after.left + x * after.width) - point.x;
  previewBody.scrollTop += (after.top + y * after.height) - point.y;
}

function getPresentationZoom() {
  return presentationZoom;
}

function setPresentationZoom(value, anchor) {
  presentationZoom = constrainZoom(value);
  var svgEl = previewInner.querySelector('svg');
  if (!svgEl) {
    zoomLabel.textContent = Math.round(presentationZoom * 100) + '%';
    return presentationZoom;
  }
  preserveZoomAnchor(svgEl, anchor, function() {
    svgEl.style.transformOrigin = 'top left';
    svgEl.style.transform = 'scale(' + (presentationZoom / state.zoom) + ')';
  });
  zoomLabel.textContent = Math.round(presentationZoom * 100) + '%';
  return presentationZoom;
}

function clearZoomTimers() {
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  zoomCommitTimer = null;
}

function commitPresentationZoom(value, anchor) {
  clearZoomTimers();
  var target = constrainZoom(value == null ? presentationZoom : value);
  var svgEl = previewInner.querySelector('svg');
  state.zoom = target;
  presentationZoom = target;
  zoomTarget = target;
  if (svgEl) {
    preserveZoomAnchor(svgEl, anchor, function() {
      var nat = getSvgNaturalSize(svgEl);
      svgEl.style.width = (nat.w * target) + 'px';
      svgEl.style.height = (nat.h * target) + 'px';
      svgEl.style.transform = '';
      svgEl.style.transformOrigin = '';
    });
  }
  zoomLabel.textContent = Math.round(target * 100) + '%';
  return target;
}

function cancelZoomMotion(commit) {
  if (zoomSpring) {
    zoomSpring.cancel();
    zoomSpring = null;
  }
  clearZoomTimers();
  if (commit !== false && Math.abs(presentationZoom - state.zoom) > 0.0001) commitPresentationZoom(presentationZoom);
}

function applyZoom(value, anchor) {
  cancelZoomMotion(false);
  return commitPresentationZoom(value, anchor);
}

function animateZoomTo(value, anchor) {
  var target = constrainZoom(value);
  zoomTarget = target;
  if (EditorMotion.reduced()) return applyZoom(target, anchor);
  var velocity = zoomSpring ? zoomSpring.getState().velocity : 0;
  if (zoomSpring) zoomSpring.cancel();
  clearZoomTimers();
  var start = presentationZoom;
  zoomSpring = EditorMotion.springTo({
    from: start,
    to: target,
    velocity: velocity,
    response: 0.3,
    onFrame: function(next) { setPresentationZoom(next, anchor); },
    onDone: function() {
      zoomSpring = null;
      commitPresentationZoom(target, anchor);
    },
  });
}

function queueWheelZoom(value, anchor) {
  zoomTarget = constrainZoom(value);
  if (zoomSpring) {
    zoomSpring.cancel();
    zoomSpring = null;
  }
  setPresentationZoom(zoomTarget, anchor);
  clearZoomTimers();
  zoomCommitTimer = setTimeout(function() {
    zoomCommitTimer = null;
    commitPresentationZoom(presentationZoom, anchor);
  }, 120);
}

document.getElementById('zoom-in-btn').addEventListener('click', function() {
  animateZoomTo(zoomTarget * 1.25);
});
document.getElementById('zoom-out-btn').addEventListener('click', function() {
  animateZoomTo(zoomTarget / 1.25);
});
zoomLabel.addEventListener('click', function() {
  animateZoomTo(1);
});

function fitToView(animate) {
  var svgEl = previewInner.querySelector('svg');
  if (!svgEl || !previewBody) { applyZoom(1); return; }
  var nat = getSvgNaturalSize(svgEl);
  var cs = getComputedStyle(previewBody);
  var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  var availW = previewBody.clientWidth - padX - 8;
  var availH = previewBody.clientHeight - padY - 8;
  if (availW <= 0 || availH <= 0 || nat.w <= 0 || nat.h <= 0) { applyZoom(1); return; }
  var target = Math.min(availW / nat.w, availH / nat.h, 1);
  if (animate) animateZoomTo(target);
  else applyZoom(target);
}

document.getElementById('zoom-fit-btn').addEventListener('click', function() { fitToView(true); });
