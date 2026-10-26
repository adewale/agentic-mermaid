import { ui } from './context.js';
import { activeCanvasFormat, currentEditorSource, hasCurrentVerifiedSvgArtifact, scheduleRender } from './rendering.js';
import { applyZoom } from './zoom.js';
import { previewBody, previewInner } from './elements.js';
import { state } from './state.js';
export var diagramTools, kanbanWrapLabel, kanbanWrap, kanbanWrapNote, packetFieldLabel, packetFieldSelect, packetFieldDetails, packetFields, packetSelectedField, diagramToolsSource, diagramToolsFamily, kanbanPreviousWidth, kanbanPreviousZoom, kanbanPendingZoom, kanbanResizeFrame;


export function packetFieldDescription(field) {
  return field.label + ': bits ' + field.start + '–' + field.end + ' (' + (field.end - field.start + 1) + ' bits); '
    + 'byte offsets ' + Math.floor(field.start / 8) + '–' + Math.floor(field.end / 8)
    + ', starting at bit ' + (field.start % 8) + ' of the first byte. Offsets are zero-based.';
}


export function inspectPacketField(id) {
  var field = packetFields.get(id);
  packetSelectedField = field ? id : '';
  packetFieldSelect.value = packetSelectedField;
  packetFieldDetails.textContent = field ? packetFieldDescription(field) : 'Select a field to inspect its bit range and byte offsets.';
  packetFields.forEach(function(item, key) {
    item.fragments.forEach(function(fragment) {
      if (key === packetSelectedField) fragment.setAttribute('data-packet-inspected', 'true');
      else fragment.removeAttribute('data-packet-inspected');
    });
  });
}


export function refreshDiagramTools() {
  var available = hasCurrentVerifiedSvgArtifact();
  if (available) {
    diagramToolsSource = currentEditorSource();
    var execution = ui.lastRenderedSvgArtifact.receipt.executionDecision;
    diagramToolsFamily = execution ? execution.family.id.split(':').pop() : '';
  } else if (diagramToolsSource !== currentEditorSource()) {
    diagramToolsFamily = '';
  }
  var graphical = activeCanvasFormat() === 'diagram';
  var board = diagramToolsFamily === 'kanban';
  if (available && board && kanbanPendingZoom !== undefined) {
    applyZoom(kanbanPendingZoom);
    kanbanPendingZoom = undefined;
  }
  kanbanWrapLabel.hidden = !board;
  kanbanWrapNote.hidden = !board || !kanbanWrap.checked;
  packetFieldLabel.hidden = !available || diagramToolsFamily !== 'packet';
  packetFieldSelect.hidden = packetFieldLabel.hidden;
  packetFieldDetails.hidden = packetFieldLabel.hidden;
  diagramTools.hidden = !graphical || (!board && packetFieldLabel.hidden);
  diagramTools.parentElement.classList.toggle('has-diagram-tools', !diagramTools.hidden);
  if (packetFieldLabel.hidden) { packetFields.clear(); return; }
  var svg = previewInner.querySelector('svg');
  packetFields.clear();
  svg.querySelectorAll('g[data-field-id][data-start][data-end][data-field-label]').forEach(function(fragment) {
    var id = fragment.getAttribute('data-field-id'), start = Number(fragment.getAttribute('data-start')), end = Number(fragment.getAttribute('data-end'));
    var field = packetFields.get(id);
    if (!field) {
      field = { label: fragment.getAttribute('data-field-label'), start: start, end: end, fragments: [] };
      packetFields.set(id, field);
    }
    field.start = Math.min(field.start, start);
    field.end = Math.max(field.end, end);
    field.fragments.push(fragment);
  });
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a field';
  packetFieldSelect.replaceChildren(placeholder);
  packetFields.forEach(function(field, id) {
    var option = document.createElement('option');
    option.value = id;
    option.textContent = field.label + ' (' + field.start + '–' + field.end + ')';
    packetFieldSelect.appendChild(option);
    field.fragments.forEach(function(fragment, index) {
      fragment.setAttribute('role', 'button');
      fragment.setAttribute('aria-label', packetFieldDescription(field));
      // One tab stop per authored field, even when it crosses many rows.
      if (index === 0) fragment.setAttribute('tabindex', '0');
    });
  });
  inspectPacketField(packetSelectedField);
}


export function updateKanbanPreviewWidth() {
  if (!kanbanWrap.checked || diagramToolsFamily !== 'kanban') return;
  var width = Math.max(208, Math.floor(previewBody.clientWidth - 32));
  state.config = state.config || {};
  var current = state.config.kanban || {};
  if (current.maxWidth === width) return;
  state.config.kanban = Object.assign({}, current, { maxWidth: width });
  scheduleRender(0);
}

export function initialize() {
// Preview-only inspection never becomes the canonical SVG export. Board
// wrapping, in contrast, is an explicit render option retained in its receipt.
diagramTools = document.createElement('div');

diagramTools.className = 'diagram-tools';

diagramTools.hidden = true;

kanbanWrapLabel = document.createElement('label');

kanbanWrapLabel.hidden = true;

kanbanWrap = document.createElement('input');

kanbanWrap.type = 'checkbox';

kanbanWrap.id = 'kanban-wrap';

kanbanWrapLabel.append(kanbanWrap, document.createTextNode('Wrap board to preview width'));

kanbanWrapNote = document.createElement('span');

kanbanWrapNote.textContent = 'Exports use this width.';

kanbanWrapNote.id = 'kanban-wrap-note';

kanbanWrap.setAttribute('aria-describedby', kanbanWrapNote.id);

packetFieldLabel = document.createElement('label');

packetFieldLabel.textContent = 'Packet field ';

packetFieldLabel.htmlFor = 'packet-field-select';

packetFieldSelect = document.createElement('select');

packetFieldSelect.id = 'packet-field-select';

packetFieldSelect.setAttribute('aria-describedby', 'packet-field-details');

packetFieldDetails = document.createElement('output');

packetFieldDetails.id = 'packet-field-details';

packetFieldDetails.setAttribute('role', 'status');

packetFieldDetails.setAttribute('aria-live', 'polite');

diagramTools.append(kanbanWrapLabel, kanbanWrapNote, packetFieldLabel, packetFieldSelect, packetFieldDetails);

document.querySelector('.preview-footer').prepend(diagramTools);

packetFields = new Map();

packetSelectedField = '';

diagramToolsSource = '';

diagramToolsFamily = '';

kanbanPreviousWidth = undefined;

kanbanPreviousZoom = undefined;

kanbanPendingZoom = undefined;

kanbanResizeFrame = 0;


kanbanWrap.addEventListener('change', function() {
  if (kanbanWrap.checked) {
    kanbanPreviousWidth = state.config.kanban && state.config.kanban.maxWidth;
    kanbanPreviousZoom = state.zoom;
    kanbanPendingZoom = 1;
    updateKanbanPreviewWidth();
  } else {
    kanbanPendingZoom = kanbanPreviousZoom;
    var config = Object.assign({}, state.config.kanban || {});
    if (kanbanPreviousWidth === undefined) delete config.maxWidth;
    else config.maxWidth = kanbanPreviousWidth;
    if (Object.keys(config).length) state.config.kanban = config;
    else delete state.config.kanban;
    scheduleRender(0);
  }
  refreshDiagramTools();
});

if (typeof ResizeObserver === 'function') new ResizeObserver(function() {
  // ResizeObserver only schedules work. Rendering inside its delivery would
  // change the observed layout again before the browser completes the frame.
  if (!kanbanWrap.checked || kanbanResizeFrame) return;
  kanbanResizeFrame = requestAnimationFrame(function() {
    kanbanResizeFrame = 0;
    updateKanbanPreviewWidth();
  });
}).observe(previewBody);

packetFieldSelect.addEventListener('change', function() { inspectPacketField(packetFieldSelect.value); });

['click', 'focusin', 'keydown'].forEach(function(type) {
  previewInner.addEventListener(type, function(event) {
    if (!hasCurrentVerifiedSvgArtifact() || !(event.target instanceof Element)) return;
    var fragment = event.target.closest('g[data-field-id]');
    if (!fragment || !packetFields.has(fragment.getAttribute('data-field-id'))) return;
    if (type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (type === 'keydown') event.preventDefault();
    inspectPacketField(fragment.getAttribute('data-field-id'));
  });
});

// Format switches and the blank-canvas action do not render a new artifact.
new MutationObserver(function() { refreshDiagramTools(); }).observe(previewInner, { childList: true, attributes: true, attributeFilter: ['hidden'] });
}
