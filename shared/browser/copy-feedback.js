(function (global) {
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); }
    finally { area.remove(); }
    return Promise.resolve();
  }

  function copyFeedbackLabel(btn) {
    if (!btn) return null;
    return btn.querySelector('.export-item-label') || btn.querySelector('span:last-child') || btn;
  }

  function setCopyFeedback(btn, state, opts) {
    if (!btn) return;
    opts = opts || {};
    var label = copyFeedbackLabel(btn);
    var updateLabel = opts.updateLabel !== false && !!label;
    if (updateLabel && !btn.dataset.copyOriginalLabel) btn.dataset.copyOriginalLabel = label.textContent || '';
    if (opts.preserveWidth !== false && updateLabel && !btn.style.minWidth) {
      btn.style.minWidth = Math.ceil(btn.getBoundingClientRect().width) + 'px';
    }
    btn.dataset.copyState = state;
    if (updateLabel) label.textContent = state === 'ok' ? (opts.okLabel || 'Copied') : (opts.errLabel || 'Copy failed');
    if (opts.status) {
      var name = opts.name || 'Snippet';
      opts.status.textContent = state === 'ok'
        ? name + ' copied to clipboard.'
        : 'Copy failed. Select the ' + name + ' and copy manually.';
    }
    global.clearTimeout(btn._copyFeedbackTimer);
    btn._copyFeedbackTimer = global.setTimeout(function () {
      if (updateLabel) label.textContent = btn.dataset.copyOriginalLabel || '';
      if (opts.status) opts.status.textContent = '';
      delete btn.dataset.copyState;
      delete btn.dataset.copyOriginalLabel;
      if (opts.preserveWidth !== false) btn.style.minWidth = '';
    }, opts.duration || 1800);
  }

  global.copyText = copyText;
  global.copyFeedbackLabel = copyFeedbackLabel;
  global.setCopyFeedback = setCopyFeedback;
})(globalThis);
