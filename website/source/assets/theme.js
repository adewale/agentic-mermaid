/* Shared site helpers: shader-mark handles the logo; this file only wires
   copyable agent prompts/config snippets. The public site no longer has a
   global theme picker — diagram themes live in the editor. */
(function () {
  function initNavigation() {
    document.querySelectorAll('.masthead').forEach((header) => {
      const toggle = header.querySelector('.nav-toggle');
      const navigation = header.querySelector('#site-navigation');
      if (!toggle || !navigation || !window.matchMedia) return;
      const mobile = window.matchMedia('(max-width: 640px)');

      function setOpen(open, focusToggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
        navigation.hidden = !open;
        if (focusToggle) toggle.focus();
      }

      function syncViewport() {
        if (mobile.matches) {
          toggle.hidden = false;
          header.dataset.navReady = 'true';
          setOpen(false, false);
        } else {
          delete header.dataset.navReady;
          toggle.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', 'Open navigation');
          navigation.hidden = false;
        }
      }

      toggle.addEventListener('click', () => {
        setOpen(toggle.getAttribute('aria-expanded') !== 'true', false);
      });
      navigation.addEventListener('click', (event) => {
        if (mobile.matches && event.target instanceof Element && event.target.closest('a')) setOpen(false, false);
      });
      document.addEventListener('pointerdown', (event) => {
        if (mobile.matches && toggle.getAttribute('aria-expanded') === 'true' && !header.contains(event.target)) {
          setOpen(false, false);
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && mobile.matches && toggle.getAttribute('aria-expanded') === 'true') {
          setOpen(false, true);
        }
      });
      mobile.addEventListener?.('change', syncViewport);
      syncViewport();
    });
  }

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

  function initMotionStrips() {
    document.querySelectorAll('[data-motion-strip]').forEach((strip) => {
      const track = strip.querySelector('.dz-motion-track');
      if (!track) return;
      let offset = 0;
      let pointer = null;
      let start = 0;
      let origin = 0;
      let velocity = 0;
      let last = null;
      let coast = 0;
      const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const min = () => Math.min(0, strip.clientWidth - track.scrollWidth);
      const paint = () => { offset = Math.max(min(), Math.min(0, offset)); track.style.transform = `translateX(${offset}px)`; };
      const stop = () => { if (coast) cancelAnimationFrame(coast); coast = 0; };
      const beginCoast = () => {
        if (reduced() || Math.abs(velocity) < 50) return;
        let previous = performance.now();
        const frame = (now) => {
          const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
          velocity *= Math.pow(0.998, dt * 1000);
          if (Math.abs(velocity) < 4) { coast = 0; return; }
          const before = offset;
          offset += velocity * dt;
          paint();
          if (offset === before) { coast = 0; return; }
          coast = requestAnimationFrame(frame);
        };
        coast = requestAnimationFrame(frame);
      };
      strip.addEventListener('pointerdown', (event) => {
        stop(); pointer = event.pointerId; start = event.clientX; origin = offset; velocity = 0; last = { x: event.clientX, t: performance.now() };
        strip.setPointerCapture?.(pointer); strip.classList.add('dragging'); event.preventDefault();
      });
      strip.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointer) return;
        offset = origin + event.clientX - start;
        const now = performance.now();
        const dt = Math.max(1, now - last.t);
        velocity = (event.clientX - last.x) / dt * 1000;
        last = { x: event.clientX, t: now };
        paint();
      });
      const end = (event, cancelled) => {
        if (event.pointerId !== pointer) return;
        // A stationary hold is not a fling. Keep the last direct-manipulation
        // velocity only while it is recent enough to describe the release.
        if (last && performance.now() - last.t > 100) velocity = 0;
        pointer = null; strip.classList.remove('dragging');
        if (!cancelled) beginCoast();
      };
      strip.addEventListener('pointerup', (event) => end(event, false));
      strip.addEventListener('pointercancel', (event) => end(event, true));
      strip.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 120 : 40;
        if (event.key === 'ArrowLeft') { stop(); offset += step; paint(); event.preventDefault(); }
        if (event.key === 'ArrowRight') { stop(); offset -= step; paint(); event.preventDefault(); }
      });
      window.addEventListener('resize', paint);
      paint();
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


  function init() { initNavigation(); initCopyButtons(); initTabs(); initGallery(); initMotionStrips(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
