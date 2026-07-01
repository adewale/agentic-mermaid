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
    if (open) {
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

function copyFeedbackLabel(btn) {
  if (!btn) return null;
  return btn.querySelector('.export-item-label') || btn.querySelector('span:last-child') || btn;
}

function setCopyFeedback(btn, state) {
  if (!btn) return;
  var label = copyFeedbackLabel(btn);
  if (!label) return;
  if (!btn.dataset.copyOriginalLabel) btn.dataset.copyOriginalLabel = label.textContent || '';
  btn.dataset.copyState = state;
  label.textContent = state === 'ok' ? 'Copied' : 'Copy failed';
  window.clearTimeout(btn._copyFeedbackTimer);
  btn._copyFeedbackTimer = window.setTimeout(function() {
    label.textContent = btn.dataset.copyOriginalLabel || '';
    delete btn.dataset.copyState;
    delete btn.dataset.copyOriginalLabel;
  }, 1800);
}

function emptyPreviewHtml() {
  return '<div class="preview-placeholder" id="preview-placeholder">'
    + '<span class="placeholder-kicker">Blank canvas</span>'
    + '<strong class="placeholder-title">No diagram yet</strong>'
    + '<span class="placeholder-copy">Start typing Mermaid syntax, or load a preset to see SVG, Unicode, and ASCII output.</span>'
    + '<div class="placeholder-actions">'
    + '<button class="placeholder-example-btn" type="button" data-action="load-example">Load an example</button>'
    + '<button class="placeholder-chip" type="button" data-example="flowchart-basic">Flowchart</button>'
    + '<button class="placeholder-chip" type="button" data-example="sequence-basic">Sequence</button>'
    + '<button class="placeholder-chip" type="button" data-example="styled-flowchart">Role styled</button>'
    + '</div>'
    + '</div>';
}

function formatRenderErrorHtml(err) {
  var detail = String(err || 'Unknown render error');
  var lineMatch = detail.match(/line\s+(\d+)(?:[^\d]+(?:col|column)\s+(\d+))?/i) || detail.match(/(\d+):(\d+)/);
  var location = lineMatch
    ? ' Check around line ' + lineMatch[1] + (lineMatch[2] ? ', column ' + lineMatch[2] : '') + '.'
    : '';
  return '<div class="preview-error" role="alert">'
    + '<strong class="preview-error-title">We could not render this diagram.</strong>'
    + '<span class="preview-error-copy">Check the diagram type, indentation, arrows, and labels.' + escHtml(location) + '</span>'
    + '<code class="preview-error-detail">' + escHtml(detail) + '</code>'
    + '</div>';
}
