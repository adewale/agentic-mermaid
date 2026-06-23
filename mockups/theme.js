/* Theme switcher — like the GitHub Pages one (named palettes with swatches),
   but a single quiet trigger that opens a smooth dropdown, with the whole page
   colour-crossfading on change (transitions live in styles.css). */
(function () {
  const THEMES = [
    { id: 'pine', name: 'Pine', sw: '#0F1512' },
    { id: 'paper', name: 'Paper', sw: '#F5F7F6' },
    { id: 'nord', name: 'Nord', sw: '#2E3440' },
    { id: 'dracula', name: 'Dracula', sw: '#282A36' },
    { id: 'solarized', name: 'Solarized', sw: '#FDF6E3' },
    { id: 'github', name: 'GitHub', sw: '#0D1117' },
  ];
  const KEY = 'am-theme';
  const current = () => document.documentElement.getAttribute('data-theme') || 'pine';

  let sync = () => {};

  function apply(id) {
    const html = document.documentElement;
    if (id === 'pine') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    sync();
  }

  function init() {
    const sw = document.querySelector('.theme-switch');
    if (!sw) return;
    const btn = sw.querySelector('.theme-btn');
    const menu = sw.querySelector('.theme-menu');
    const btnSw = btn.querySelector('.sw');
    const btnName = btn.querySelector('.name');

    const items = THEMES.map((t) => {
      const it = document.createElement('button');
      it.className = 'theme-item';
      it.type = 'button';
      it.dataset.id = t.id;
      it.innerHTML = '<span class="sw" style="background:' + t.sw + '"></span><span class="lbl">' + t.name + '</span><span class="ck">✓</span>';
      it.addEventListener('click', () => { apply(t.id); close(); });
      menu.appendChild(it);
      return it;
    });

    sync = function () {
      const id = current();
      const t = THEMES.find((x) => x.id === id) || THEMES[0];
      btnSw.style.background = t.sw;
      if (btnName) btnName.textContent = t.name;
      items.forEach((it) => it.classList.toggle('active', it.dataset.id === id));
    };

    function open() { sw.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    function close() { sw.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); sw.classList.contains('open') ? close() : open(); });
    document.addEventListener('click', (e) => { if (!sw.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    sync();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
