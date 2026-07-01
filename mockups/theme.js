/* Shared site helpers: shader-mark handles the logo; this file only wires
   copyable agent prompts/config snippets. The public site no longer has a
   global theme picker — diagram themes live in the editor. */
(function () {
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); }
    finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  function setCopyState(btn, state, original) {
    const label = state === 'ok' ? 'Copied' : 'Copy failed';
    btn.dataset.copyState = state;
    const text = btn.querySelector('span:last-child');
    if (text) text.textContent = label;
    else btn.textContent = label;
    const widget = btn.closest('[data-copy-widget]');
    const status = widget ? widget.querySelector('[role="status"]') : null;
    const name = btn.dataset.copyName || (widget && widget.dataset.copyName) || 'Snippet';
    if (status) status.textContent = state === 'ok' ? name + ' copied to clipboard.' : 'Copy failed. Select the ' + name + ' and copy manually.';
    window.setTimeout(() => {
      delete btn.dataset.copyState;
      if (text) text.textContent = original;
      else btn.textContent = original;
      if (status) status.textContent = '';
    }, 1800);
  }

  function initCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-copy-target');
        const target = id ? document.getElementById(id) : null;
        if (!target) return;
        const text = btn.querySelector('span:last-child');
        const original = text ? text.textContent : btn.textContent;
        copyText(target.textContent || '').then(() => {
          setCopyState(btn, 'ok', original);
        }).catch(() => {
          setCopyState(btn, 'err', original);
        });
      });
    });
  }

  if (document.readyState !== 'loading') initCopyButtons();
  else document.addEventListener('DOMContentLoaded', initCopyButtons);
})();
