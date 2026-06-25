/* Theme switcher — like the GitHub Pages one (named palettes with swatches),
   but a single quiet trigger that opens a smooth dropdown, with the whole page
   colour-crossfading on change (transitions live in styles.css).

   Carries every renderer theme. Each entry is { id, name, sw (swatch = bg),
   dark }. `dark` drives data-scheme, which the brand/scheme layer in styles.css
   uses to frame the diagram and the code panel — the logo and the grain texture
   stay constant regardless. The list is grouped light / dark in the menu. */
(function () {
  const THEMES = [
    // brand default
    { id: 'paper',             name: 'Paper',              sw: '#F5F0E4', dark: false, brand: true },
    // light
    { id: 'pine-light',        name: 'Pine Light',         sw: '#F4F8F6', dark: false },
    { id: 'zinc-light',        name: 'Zinc Light',         sw: '#FFFFFF', dark: false },
    { id: 'github-light',      name: 'GitHub Light',       sw: '#FFFFFF', dark: false },
    { id: 'solarized-light',   name: 'Solarized Light',    sw: '#FDF6E3', dark: false },
    { id: 'catppuccin-latte',  name: 'Catppuccin Latte',   sw: '#EFF1F5', dark: false },
    { id: 'nord-light',        name: 'Nord Light',         sw: '#ECEFF4', dark: false },
    { id: 'tokyo-night-light', name: 'Tokyo Night Light',  sw: '#D5D6DB', dark: false },
    { id: 'salmon',            name: 'Salmon',             sw: '#FFFBF5', dark: false },
    { id: 'tufte',             name: 'Tufte',              sw: '#FFFFF8', dark: false },
    // dark
    { id: 'paper-dark',        name: 'Paper Dark',         sw: '#16130D', dark: true },
    { id: 'pine-dark',         name: 'Pine Dark',          sw: '#0F1512', dark: true },
    { id: 'zinc-dark',         name: 'Zinc Dark',          sw: '#18181B', dark: true },
    { id: 'github-dark',       name: 'GitHub Dark',        sw: '#0D1117', dark: true },
    { id: 'tokyo-night',       name: 'Tokyo Night',        sw: '#1A1B26', dark: true },
    { id: 'tokyo-night-storm', name: 'Tokyo Night Storm',  sw: '#24283B', dark: true },
    { id: 'catppuccin-mocha',  name: 'Catppuccin Mocha',   sw: '#1E1E2E', dark: true },
    { id: 'nord',              name: 'Nord',               sw: '#2E3440', dark: true },
    { id: 'dracula',           name: 'Dracula',            sw: '#282A36', dark: true },
    { id: 'solarized-dark',    name: 'Solarized Dark',     sw: '#002B36', dark: true },
    { id: 'one-dark',          name: 'One Dark',           sw: '#282C34', dark: true },
    { id: 'salmon-dark',       name: 'Salmon Dark',        sw: '#1F1008', dark: true },
    { id: 'tufte-dark',        name: 'Tufte Dark',         sw: '#1C1C1A', dark: true },
  ];
  const KEY = 'am-theme';
  const byId = (id) => THEMES.find((x) => x.id === id) || THEMES[0];
  const current = () => document.documentElement.getAttribute('data-theme') || 'paper';

  let sync = () => {};

  const reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // mobile browser chrome (address bar, notch) tracks the active theme's bg
  function syncMeta() {
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (!bg) return;
      let m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
      m.content = bg;
    } catch (e) {}
  }

  function setTheme(id) {
    const html = document.documentElement;
    const t = byId(id);
    if (t.brand) html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', t.id);
    html.setAttribute('data-scheme', t.dark ? 'dark' : 'light');
    try { localStorage.setItem(KEY, t.id); } catch (e) {}
    syncMeta();
    sync();
  }

  // Wrap the swap in a click-origin ripple where View Transitions exist; else
  // fall back to the CSS crossfade. Reduced motion gets an honest instant swap.
  function apply(id, origin) {
    if (!document.startViewTransition || reduceMQ.matches) { setTheme(id); return; }
    let x = origin && origin.x != null ? origin.x : null;
    let y = origin && origin.y != null ? origin.y : null;
    if (x == null) {
      const b = document.querySelector('.theme-btn');
      if (b) { const r = b.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
      else { x = window.innerWidth / 2; y = window.innerHeight / 2; }
    }
    const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const vt = document.startViewTransition(() => setTheme(id));
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  }

  function init() {
    const sw = document.querySelector('.theme-switch');
    if (!sw) return;
    const btn = sw.querySelector('.theme-btn');
    const menu = sw.querySelector('.theme-menu');
    const btnSw = btn.querySelector('.sw');
    const btnName = btn.querySelector('.name');

    // group label, then the items it heads
    let lastGroup = null;
    const items = [];
    THEMES.forEach((t) => {
      const group = t.brand ? 'Brand' : (t.dark ? 'Dark' : 'Light');
      if (group !== lastGroup) {
        const h = document.createElement('div');
        h.className = 'theme-group';
        h.textContent = group;
        menu.appendChild(h);
        lastGroup = group;
      }
      const it = document.createElement('button');
      it.className = 'theme-item';
      it.type = 'button';
      it.dataset.id = t.id;
      it.innerHTML = '<span class="sw" style="background:' + t.sw + '"></span><span class="lbl">' + t.name + '</span><span class="ck">✓</span>';
      it.addEventListener('click', (e) => { apply(t.id, { x: e.clientX, y: e.clientY }); close(); });
      menu.appendChild(it);
      items.push(it);
    });

    sync = function () {
      const t = byId(current());
      btnSw.style.background = t.sw;
      if (btnName) btnName.textContent = t.name;
      items.forEach((it) => it.classList.toggle('active', it.dataset.id === t.id));
    };

    function open() {
      sw.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      const on = menu.querySelector('.theme-item.active');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function close() { sw.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); sw.classList.contains('open') ? close() : open(); });
    document.addEventListener('click', (e) => { if (!sw.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // self-heal a stale/unknown stored id (e.g. an earlier naming) → fall to Pine
    if (THEMES.some((t) => t.id === current())) { sync(); syncMeta(); }
    else setTheme('paper');
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
