import { activeCanvasFormat, hasCurrentVerifiedSvgArtifact } from './rendering.js';
import { cancelPreviewMotion } from './pan.js';
import { applyZoom, fitToView } from './zoom.js';
import { previewBody, previewInner } from './elements.js';
export var c4BoundaryViewId, c4BoundaryFrames, c4Navigation, c4BoundaryView, c4FitButton;


export function focusC4Boundary(id) {
  if (!hasCurrentVerifiedSvgArtifact()) return;
  var frame = c4BoundaryFrames.get(id);
  c4BoundaryViewId = frame ? id : '';
  c4BoundaryView.value = c4BoundaryViewId;
  if (typeof cancelPreviewMotion === 'function') cancelPreviewMotion();
  if (!frame) {
    fitToView();
    previewBody.scrollLeft = 0;
    previewBody.scrollTop = 0;
    return;
  }
  var box = frame.getBBox();
  if (!(box.width > 0 && box.height > 0)) return;
  var availableWidth = Math.max(1, previewBody.clientWidth - 64);
  var availableHeight = Math.max(1, previewBody.clientHeight - 64);
  applyZoom(Math.min(availableWidth / box.width, availableHeight / box.height));
  var rect = frame.getBoundingClientRect();
  var viewport = previewBody.getBoundingClientRect();
  previewBody.scrollLeft += rect.left + rect.width / 2 - viewport.left - previewBody.clientWidth / 2;
  previewBody.scrollTop += rect.top + rect.height / 2 - viewport.top - previewBody.clientHeight / 2;
}


export function refreshC4Navigation(refocus) {
  if (!c4Navigation || !c4BoundaryView) return;
  var available = hasCurrentVerifiedSvgArtifact();
  var svg = available ? previewInner.querySelector('svg') : null;
  c4BoundaryFrames.clear();
  if (svg) svg.querySelectorAll('g.c4-boundary[data-id]').forEach(function(frame) {
    c4BoundaryFrames.set(frame.getAttribute('data-id'), frame);
  });
  var whole = document.createElement('option');
  whole.value = '';
  whole.textContent = 'Whole diagram';
  c4BoundaryView.replaceChildren(whole);
  c4BoundaryFrames.forEach(function(frame, id) {
    var option = document.createElement('option');
    var text = frame.querySelector('text');
    var firstLine = text && text.querySelector('tspan');
    option.value = id;
    option.textContent = (firstLine || text || {}).textContent || id;
    c4BoundaryView.appendChild(option);
  });
  if (available && !c4BoundaryFrames.has(c4BoundaryViewId)) c4BoundaryViewId = '';
  c4BoundaryView.value = c4BoundaryViewId;
  c4Navigation.hidden = !c4BoundaryFrames.size || activeCanvasFormat() !== 'diagram';
  c4Navigation.parentElement.classList.toggle('has-c4-navigation', !c4Navigation.hidden);
  if (refocus && c4BoundaryViewId && !c4Navigation.hidden) focusC4Boundary(c4BoundaryViewId);
}

export function initialize() {
// A boundary view changes only the existing preview camera. The canonical
// artifact, source, interaction identities and export receipts stay intact.
c4BoundaryViewId = '';

c4BoundaryFrames = new Map();

c4Navigation = document.getElementById('c4-navigation');

c4BoundaryView = document.getElementById('c4-boundary-view');


if (c4BoundaryView) c4BoundaryView.addEventListener('change', function() { focusC4Boundary(c4BoundaryView.value); });

c4FitButton = document.getElementById('zoom-fit-btn');

if (c4FitButton) c4FitButton.addEventListener('click', function() {
  c4BoundaryViewId = '';
  if (c4BoundaryView) c4BoundaryView.value = '';
});
}
