/* Shared site helpers: shader-mark handles the logo; this file only wires
   copyable agent prompts/config snippets. The public site no longer has a
   global theme picker — diagram themes live in the editor. */
(function () {
  function initCopyButtons() {
    document.querySelectorAll('[data-copy-target], [data-copy-text]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inline = btn.getAttribute('data-copy-text');
        const id = btn.getAttribute('data-copy-target');
        const target = id ? document.getElementById(id) : null;
        const value = inline != null ? inline : (target ? target.textContent || '' : '');
        if (!value) return;
        const widget = btn.closest('[data-copy-widget]');
        const status = widget ? widget.querySelector('[role="status"]') : null;
        const name = btn.dataset.copyName || (widget && widget.dataset.copyName) || 'Snippet';
        copyText(value).then(() => {
          setCopyFeedback(btn, 'ok', { status, name });
        }).catch(() => {
          setCopyFeedback(btn, 'err', { status, name });
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

  /* Homepage style gallery: a prev/next cycler over pre-rendered panels.
     Markup ships as stacked labeled panels (first visible, rest hidden) so the
     content reads without JS; this wires the buttons, keeps exactly one panel
     visible, and mirrors the active label + editor link into the bar. Clicks
     only — no autoplay by design. */
  function initGallery() {
    document.querySelectorAll('[data-gallery]').forEach((card) => {
      const panels = Array.prototype.slice.call(card.querySelectorAll('[data-gallery-panel]'));
      const status = card.querySelector('[data-gallery-status]');
      const editorLink = card.querySelector('[data-gallery-editor-link]');
      const prev = card.querySelector('[data-gallery-prev]');
      const next = card.querySelector('[data-gallery-next]');
      if (panels.length < 2 || !status || !prev || !next) return;
      let index = 0;
      function select(nextIndex) {
        index = (nextIndex + panels.length) % panels.length;
        panels.forEach((panel, i) => { panel.hidden = i !== index; });
        status.textContent = panels[index].getAttribute('data-gallery-label') + ' (' + (index + 1) + '/' + panels.length + ')';
        if (editorLink) editorLink.setAttribute('href', panels[index].getAttribute('data-gallery-editor') || editorLink.getAttribute('href'));
      }
      prev.addEventListener('click', () => select(index - 1));
      next.addEventListener('click', () => select(index + 1));
      card.addEventListener('keydown', (e) => {
        if (e.target !== prev && e.target !== next) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); select(index - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); select(index + 1); }
      });
      card.classList.add('gallery-ready');
      select(0);
    });
  }

  function init() { initCopyButtons(); initTabs(); initGallery(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
