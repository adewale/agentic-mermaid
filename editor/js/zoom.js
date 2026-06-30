function getSvgNaturalSize(svgEl) {
  var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height };
  var w = parseFloat(svgEl.getAttribute('width'))  || svgEl.getBoundingClientRect().width  || 400;
  var h = parseFloat(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect().height || 300;
  return { w: w, h: h };
}

function applyZoom(z) {
  state.zoom = Math.max(0.1, Math.min(8, z));
  var svgEl = previewInner.querySelector('svg');
  if (svgEl) {
    var nat = getSvgNaturalSize(svgEl);
    svgEl.style.width  = (nat.w * state.zoom) + 'px';
    svgEl.style.height = (nat.h * state.zoom) + 'px';
    svgEl.style.transform = '';
  }
  zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
}

document.getElementById('zoom-in-btn').addEventListener('click', function() {
  applyZoom(state.zoom * 1.25);
});
document.getElementById('zoom-out-btn').addEventListener('click', function() {
  applyZoom(state.zoom / 1.25);
});
function fitToView() {
  var svgEl = previewInner.querySelector('svg');
  if (!svgEl || !previewBody) { applyZoom(1); return; }
  var nat = getSvgNaturalSize(svgEl);
  var cs = getComputedStyle(previewBody);
  var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  var availW = previewBody.clientWidth - padX - 8;
  var availH = previewBody.clientHeight - padY - 8;
  if (availW <= 0 || availH <= 0 || nat.w <= 0 || nat.h <= 0) { applyZoom(1); return; }
  // Shrink to fit; never enlarge a small diagram past its natural size.
  applyZoom(Math.min(availW / nat.w, availH / nat.h, 1));
}

document.getElementById('zoom-fit-btn').addEventListener('click', fitToView);
