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

  /* Channel tabs (home page). Markup ships as stacked labeled panels so the
     content reads without JS; this enhances it into a keyboard-operable ARIA
     tabset (arrow keys, Home/End) and lets CSS hide the per-panel labels. */
  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach((card) => {
      const tabs = Array.prototype.slice.call(card.querySelectorAll('[role="tab"]'));
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
      if (!tabs.length || panels.some((panel) => !panel)) return;
      function select(index, focus) {
        tabs.forEach((tab, i) => {
          tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
          tab.tabIndex = i === index ? 0 : -1;
          panels[i].hidden = i !== index;
        });
        if (focus) tabs[index].focus();
      }
      tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => select(i, false));
        tab.addEventListener('keydown', (e) => {
          const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (delta) { e.preventDefault(); select((i + delta + tabs.length) % tabs.length, true); return; }
          if (e.key === 'Home') { e.preventDefault(); select(0, true); }
          if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, true); }
        });
      });
      card.classList.add('tabs-ready');
      select(Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')), false);
    });
  }

  function init() { initCopyButtons(); initTabs(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
