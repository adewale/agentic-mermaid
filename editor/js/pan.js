var panBtn = document.getElementById('pan-btn');
var panActive = false;
var panStart = null;
var panPointerId = null;
var panTracker = EditorMotion.makeVelocityTracker();
var panDecay = null;
var activePanPointers = Object.create(null);
var pinchState = null;

function syncPanButton() {
  panBtn.classList.toggle('active', panActive);
  panBtn.setAttribute('aria-pressed', panActive ? 'true' : 'false');
  previewBody.classList.toggle('pan-mode', panActive);
}

function cancelPanMomentum() {
  if (!panDecay) return;
  panDecay.cancel();
  panDecay = null;
}

function cancelPreviewMotion() {
  cancelPanMomentum();
  if (typeof cancelZoomMotion === 'function') cancelZoomMotion();
}

function pointerValues() {
  return Object.keys(activePanPointers).map(function(id) { return activePanPointers[id]; });
}

function setPointer(event) {
  activePanPointers[event.pointerId] = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
}

function shouldPan(event) {
  return panActive || event.metaKey || event.ctrlKey;
}

function beginSinglePan(pointer) {
  panPointerId = pointer.id;
  panStart = { x: pointer.x, y: pointer.y, sl: previewBody.scrollLeft, st: previewBody.scrollTop };
  pinchState = null;
  panTracker.reset();
  panTracker.push(performance.now(), pointer.x, pointer.y);
  previewBody.classList.add('panning');
}

function beginPinch() {
  var points = pointerValues();
  if (points.length !== 2) return;
  var dx = points[1].x - points[0].x;
  var dy = points[1].y - points[0].y;
  var distance = Math.max(1, Math.hypot(dx, dy));
  pinchState = {
    ids: [points[0].id, points[1].id],
    distance: distance,
    midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
    zoom: getPresentationZoom(),
    sl: previewBody.scrollLeft,
    st: previewBody.scrollTop,
  };
  panStart = null;
  panPointerId = null;
  previewBody.classList.add('panning');
}

function updatePinch() {
  if (!pinchState) return;
  var first = activePanPointers[pinchState.ids[0]];
  var second = activePanPointers[pinchState.ids[1]];
  if (!first || !second) return;
  var dx = second.x - first.x;
  var dy = second.y - first.y;
  var distance = Math.max(1, Math.hypot(dx, dy));
  var midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  var nextZoom = constrainZoom(pinchState.zoom * distance / pinchState.distance);
  setPresentationZoom(nextZoom, midpoint);
  previewBody.scrollLeft = pinchState.sl - (midpoint.x - pinchState.midpoint.x);
  previewBody.scrollTop = pinchState.st - (midpoint.y - pinchState.midpoint.y);
}

function beginMomentum() {
  var velocity = panTracker.get();
  if (Math.hypot(velocity.vx, velocity.vy) < 50) return;
  cancelPanMomentum();
  panDecay = EditorMotion.decay2d({
    vx: velocity.vx,
    vy: velocity.vy,
    rate: 0.998,
    onFrame: function(dx, dy) {
      var beforeLeft = previewBody.scrollLeft;
      var beforeTop = previewBody.scrollTop;
      // Dragging right reveals content to the left; preserve that sign for coast.
      previewBody.scrollLeft -= dx;
      previewBody.scrollTop -= dy;
      var movedX = previewBody.scrollLeft !== beforeLeft;
      var movedY = previewBody.scrollTop !== beforeTop;
      return movedX || movedY;
    },
    onDone: function() { panDecay = null; },
  });
}

panBtn.addEventListener('click', function() {
  panActive = !panActive;
  syncPanButton();
});
syncPanButton();

previewBody.addEventListener('pointerdown', function(event) {
  // A coast is always grabbable, even when the next pointerdown is not itself
  // eligible to begin pan mode (for example after releasing Cmd/Ctrl).
  cancelPanMomentum();
  if (!shouldPan(event)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  cancelPreviewMotion();
  setPointer(event);
  if (previewBody.setPointerCapture) {
    try { previewBody.setPointerCapture(event.pointerId); } catch (err) {}
  }
  var points = pointerValues();
  if (points.length === 1) beginSinglePan(points[0]);
  else if (points.length === 2) beginPinch();
});

previewBody.addEventListener('pointermove', function(event) {
  if (!activePanPointers[event.pointerId]) return;
  setPointer(event);
  if (pinchState) {
    updatePinch();
    return;
  }
  if (!panStart || event.pointerId !== panPointerId) return;
  var dx = event.clientX - panStart.x;
  var dy = event.clientY - panStart.y;
  previewBody.scrollLeft = panStart.sl - dx;
  previewBody.scrollTop = panStart.st - dy;
  panTracker.push(performance.now(), event.clientX, event.clientY);
});

function endPan(event, cancelled) {
  if (!activePanPointers[event.pointerId]) return;
  var wasPinching = !!pinchState;
  delete activePanPointers[event.pointerId];
  var remaining = pointerValues();

  if (wasPinching) {
    if (remaining.length === 1) beginSinglePan(remaining[0]);
    else {
      pinchState = null;
      panStart = null;
      panPointerId = null;
      previewBody.classList.remove('panning');
      commitPresentationZoom(getPresentationZoom());
    }
    return;
  }

  if (event.pointerId !== panPointerId) return;
  panStart = null;
  panPointerId = null;
  previewBody.classList.remove('panning');
  if (!cancelled && !EditorMotion.reduced()) beginMomentum();
}
previewBody.addEventListener('pointerup', function(event) { endPan(event, false); });
previewBody.addEventListener('pointercancel', function(event) { endPan(event, true); });

window.addEventListener('keydown', function(event) {
  if (event.metaKey || event.ctrlKey) previewBody.classList.add('cmd-pan');
});
window.addEventListener('keyup', function(event) {
  if (!event.metaKey && !event.ctrlKey) previewBody.classList.remove('cmd-pan');
});

previewBody.addEventListener('wheel', function(event) {
  cancelPanMomentum();
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  var factor = Math.pow(0.999, event.deltaY);
  queueWheelZoom(getPresentationZoom() * factor, { x: event.clientX, y: event.clientY });
}, { passive: false });
