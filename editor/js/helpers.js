function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function setDescendantTabStops(container, enabled) {
  if (!container) return;
  container.querySelectorAll('button, [href], input, select, textarea, [tabindex]').forEach(function(el) {
    if (enabled) {
      if (el.dataset.prevTabindex != null) {
        if (el.dataset.prevTabindex) el.setAttribute('tabindex', el.dataset.prevTabindex);
        else el.removeAttribute('tabindex');
        delete el.dataset.prevTabindex;
      } else {
        el.removeAttribute('tabindex');
      }
    } else {
      if (el.hasAttribute('tabindex')) el.dataset.prevTabindex = el.getAttribute('tabindex') || '';
      el.setAttribute('tabindex', '-1');
    }
  });
}

function setPopupVisibility(popup, trigger, open, opts) {
  if (!popup) return;
  opts = opts || {};
  var className = opts.className || 'open';
  popup.classList.toggle(className, open);
  popup.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (opts.inert !== false) popup.inert = !open;
  if (trigger) {
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    trigger.classList.toggle(className, open && opts.toggleTriggerClass !== false);
  }
  if (opts.manageTabStops) setDescendantTabStops(popup, open);
  if (open && opts.focusSelector) {
    var focusTarget = popup.querySelector(opts.focusSelector);
    if (focusTarget) focusTarget.focus(opts.focusPreventScroll ? { preventScroll: true } : undefined);
  }
}

var popupControllers = [];

function popupTrigger(opts) {
  return typeof opts.trigger === 'function' ? opts.trigger() : opts.trigger;
}

function createPopupController(opts) {
  opts = opts || {};
  var popup = opts.popup;
  var className = opts.className || 'open';
  var trigger = popupTrigger(opts);
  var controller;

  function isOpen() {
    return !!(popup && popup.classList.contains(className));
  }

  function setOpen(open, meta) {
    if (!popup) return;
    meta = meta || {};
    var currentTrigger = popupTrigger(opts);
    if (open && opts.closePeersOnOpen !== false) {
      popupControllers.forEach(function(other) {
        if (other !== controller && other.isOpen()) other.close({ source: 'peer' });
      });
    }
    if (open && typeof opts.beforeOpen === 'function') opts.beforeOpen(meta, currentTrigger);
    setPopupVisibility(popup, currentTrigger, open, Object.assign({ className: className }, opts.visibility || {}));
    if (open && typeof opts.afterOpen === 'function') opts.afterOpen(meta, currentTrigger);
    if (!open && typeof opts.afterClose === 'function') opts.afterClose(meta, currentTrigger);
    if (!open && meta.restoreFocus && opts.restoreFocus !== false && currentTrigger && typeof currentTrigger.focus === 'function') {
      currentTrigger.focus();
    }
  }

  function open(meta) { setOpen(true, meta); }
  function close(meta) { setOpen(false, meta); }
  function toggle(meta) { setOpen(!isOpen(), meta); }

  if (trigger && opts.triggerEvents !== false) {
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      toggle({ source: 'click' });
    });
    trigger.addEventListener('keydown', function(e) {
      var opens = e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ';
      if (!opens) return;
      e.preventDefault();
      open({ source: 'keyboard', focusFirst: true });
    });
  }

  if (opts.closeOnOutside !== false && typeof document !== 'undefined') {
    document.addEventListener('click', function(e) {
      if (!isOpen()) return;
      var currentTrigger = popupTrigger(opts);
      if (popup.contains(e.target)) return;
      if (currentTrigger && currentTrigger.contains && currentTrigger.contains(e.target)) return;
      if (typeof opts.contains === 'function' && opts.contains(e.target)) return;
      close({ source: 'outside' });
    });
  }

  if (opts.closeOnEscape !== false && typeof document !== 'undefined') {
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || !isOpen()) return;
      e.preventDefault();
      close({ source: 'escape', restoreFocus: true });
    });
  }

  if (opts.repositionOnResize && typeof window !== 'undefined') {
    window.addEventListener('resize', function() {
      if (isOpen() && typeof opts.position === 'function') opts.position();
    });
  }

  controller = { isOpen: isOpen, setOpen: setOpen, open: open, close: close, toggle: toggle };
  popupControllers.push(controller);
  return controller;
}

function createListboxPopupController(opts) {
  opts = opts || {};
  var popup = opts.popup;
  var trigger = popupTrigger(opts);
  var itemSelector = opts.itemSelector || '[role="option"]';
  var activeSelector = opts.activeSelector || '.active';

  function items() {
    return Array.prototype.slice.call(popup ? popup.querySelectorAll(itemSelector) : []);
  }

  function activeItem() {
    return popup && (popup.querySelector(activeSelector) || popup.querySelector(itemSelector));
  }

  function syncTabStops(open) {
    items().forEach(function(item) {
      item.tabIndex = open && item === activeItem() ? 0 : -1;
    });
  }

  function focusActive() {
    var active = activeItem();
    if (active) active.focus();
  }

  var controller = createPopupController(Object.assign({}, opts, {
    visibility: Object.assign({ manageTabStops: false }, opts.visibility || {}),
    afterOpen: function(meta, currentTrigger) {
      syncTabStops(true);
      if (opts.afterOpen) opts.afterOpen(meta, currentTrigger);
      if (meta && meta.focusFirst) focusActive();
    },
    afterClose: function(meta, currentTrigger) {
      syncTabStops(false);
      if (opts.afterClose) opts.afterClose(meta, currentTrigger);
    },
  }));

  if (popup) {
    popup.addEventListener('click', function(e) {
      var item = e.target.closest(itemSelector);
      if (!item || !popup.contains(item)) return;
      if (opts.onSelect) opts.onSelect(item, e);
      controller.close({ source: 'select' });
      if (trigger && opts.focusTriggerOnSelect !== false) trigger.focus();
    });
    popup.addEventListener('keydown', function(e) {
      var list = items();
      if (!list.length) return;
      var current = list.indexOf(document.activeElement);
      if (current < 0) current = Math.max(0, list.indexOf(activeItem()));
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        var next = current;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = list.length - 1;
        else next = (current + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list.forEach(function(item) { item.tabIndex = -1; });
        list[next].tabIndex = 0;
        list[next].focus();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (document.activeElement && popup.contains(document.activeElement)) document.activeElement.click();
      }
    });
  }

  controller.syncTabStops = syncTabStops;
  return controller;
}

function positionAnchoredPopup(popup, anchor, opts) {
  if (!popup || !anchor) return;
  opts = opts || {};
  var width = opts.width || popup.offsetWidth || 220;
  var gutter = opts.gutter || 8;
  var rect = anchor.getBoundingClientRect();
  var left = opts.align === 'left' ? rect.left : rect.right - width;
  left = Math.min(Math.max(gutter, left), window.innerWidth - width - gutter);
  var top = rect.bottom + (opts.offset || 6);
  if (opts.flip !== false && top + (opts.height || popup.offsetHeight || 320) > window.innerHeight - gutter) {
    top = Math.max(gutter, rect.top - (opts.height || popup.offsetHeight || 320) - (opts.offset || 6));
  }
  popup.style.left = Math.round(left) + 'px';
  popup.style.top = Math.round(top) + 'px';
}

function emptyPreviewHtml() {
  return '<div class="preview-placeholder" id="preview-placeholder">'
    + '<span class="placeholder-kicker">Blank canvas</span>'
    + '<strong class="placeholder-title">No diagram yet</strong>'
    + '<span class="placeholder-copy">Start typing Mermaid syntax, or load an example to see SVG, Unicode, and ASCII output.</span>'
    + '<div class="placeholder-actions">'
    + '<button class="placeholder-example-btn" type="button" data-action="load-example">Load an example</button>'
    + '<button class="placeholder-chip" type="button" data-example="flowchart-basic">Flowchart</button>'
    + '<button class="placeholder-chip" type="button" data-example="sequence-basic">Sequence</button>'
    + '<button class="placeholder-chip" type="button" data-example="quadrant-basic">Style + palette</button>'
    + '</div>'
    + '</div>';
}

// Parse errors and render errors name a source position in prose ("line 4" or
// "4:2"); extract it once so both the error card and the gutter highlight
// agree on the location.
function extractErrorLocation(detail) {
  var text = String(detail || '');
  var m = text.match(/line\s+(\d+)(?:[^\d]+(?:col|column)\s+(\d+))?/i) || text.match(/(\d+):(\d+)/);
  if (!m) return null;
  return { line: parseInt(m[1], 10), column: m[2] ? parseInt(m[2], 10) : 0 };
}

// The gutter paints this line red until the next successful render or edit
// clears it (updateLineNumbers reads it on every rebuild).
var editorErrorLine = 0;

function setEditorErrorLine(line) {
  var next = line > 0 ? line : 0;
  if (next === editorErrorLine) return;
  editorErrorLine = next;
  if (typeof updateLineNumbers === 'function') updateLineNumbers();
}

// Headers that are valid Mermaid but outside this renderer's supported
// families (the supported list is detectDiagramTypeFromFirstLine in
// src/mermaid-source.ts; unknown headers fall through to the flowchart parser,
// whose "Invalid mermaid header" would otherwise call valid Mermaid invalid).
// Keys are the lowercased first token of the header line.
var UNSUPPORTED_MERMAID_HEADERS = {
  mindmap: 'mindmap',
  gitgraph: 'gitGraph',
  c4context: 'C4Context',
  c4container: 'C4Container',
  c4component: 'C4Component',
  c4dynamic: 'C4Dynamic',
  c4deployment: 'C4Deployment',
  sankey: 'sankey-beta', 'sankey-beta': 'sankey-beta',
  requirement: 'requirementDiagram', requirementdiagram: 'requirementDiagram',
  kanban: 'kanban',
  block: 'block-beta', 'block-beta': 'block-beta',
  packet: 'packet-beta', 'packet-beta': 'packet-beta',
  zenuml: 'zenuml',
  radar: 'radar-beta', 'radar-beta': 'radar-beta',
  treemap: 'treemap-beta', 'treemap-beta': 'treemap-beta',
};

var SUPPORTED_FAMILY_LIST = 'flowchart / graph, stateDiagram-v2, sequenceDiagram, classDiagram, erDiagram, architecture-beta, timeline, journey, xychart-beta, pie, quadrantChart, and gantt';

function unsupportedFamilyFromError(detail) {
  var m = String(detail || '').match(/Invalid mermaid header: "([^"]*)"/);
  if (!m) return null;
  var token = (m[1].trim().match(/^[A-Za-z0-9-]+/) || [''])[0].toLowerCase();
  return UNSUPPORTED_MERMAID_HEADERS[token] || null;
}

function formatRenderErrorHtml(err) {
  var detail = String(err || 'Unknown render error');
  var family = unsupportedFamilyFromError(detail);
  if (family) {
    return '<div class="preview-error" role="alert">'
      + '<strong class="preview-error-title">' + escHtml(family) + ' is valid Mermaid, but this editor does not support it.</strong>'
      + '<span class="preview-error-copy">Supported families: ' + escHtml(SUPPORTED_FAMILY_LIST) + '.</span>'
      + '</div>';
  }
  var loc = extractErrorLocation(detail);
  var location = loc
    ? ' Check around line ' + loc.line + (loc.column ? ', column ' + loc.column : '') + '.'
    : '';
  return '<div class="preview-error" role="alert">'
    + '<strong class="preview-error-title">We could not render this diagram.</strong>'
    + '<span class="preview-error-copy">Check the diagram type, indentation, arrows, and labels.' + escHtml(location) + '</span>'
    + '<code class="preview-error-detail">' + escHtml(detail) + '</code>'
    + '</div>';
}
