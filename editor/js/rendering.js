var renderTimer = null;

function scheduleRender(delay) {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(doRender, delay ?? 300);
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  var v = hex.trim();
  if (v[0] === "#") v = v.slice(1);
  if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  if (v.length !== 6) return null;
  var n = parseInt(v, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function applyThemeToPage(themeKey) {
  var root = document.documentElement;
  if (themeKey && THEMES[themeKey]) {
    var t = THEMES[themeKey];
    root.style.setProperty("--t-bg", t.bg);
    root.style.setProperty("--t-fg", t.fg);
    root.style.setProperty("--t-accent", t.accent || "#3b82f6");
  } else {
    // Default — reset to light/dark base
    root.style.setProperty("--t-bg", isDark ? "#18181B" : "#FFFFFF");
    root.style.setProperty("--t-fg", isDark ? "#FAFAFA" : "#27272A");
    root.style.setProperty("--t-accent", isDark ? "#60a5fa" : "#3b82f6");
  }
  // Update shadow RGB
  var fg = root.style.getPropertyValue("--t-fg").trim() || "#27272A";
  var rgb = hexToRgb(fg);
  if (rgb) {
    root.style.setProperty(
      "--foreground-rgb",
      rgb.r + ", " + rgb.g + ", " + rgb.b,
    );
    var bgRgb = hexToRgb(root.style.getPropertyValue("--t-bg").trim());
    var brightness = bgRgb
      ? (bgRgb.r * 299 + bgRgb.g * 587 + bgRgb.b * 114) / 1000
      : 255;
    var dark = brightness < 140;
    root.style.setProperty("--shadow-border-opacity", dark ? "0.15" : "0.08");
    root.style.setProperty("--shadow-blur-opacity", dark ? "0.12" : "0.06");
  }
}

function buildOptions() {
  var opts = {};
  if (state.theme && THEMES[state.theme]) {
    var t = THEMES[state.theme];
    opts.bg = t.bg;
    opts.fg = t.fg;
    if (t.line) opts.line = t.line;
    if (t.accent) opts.accent = t.accent;
    if (t.muted) opts.muted = t.muted;
    if (t.surface) opts.surface = t.surface;
    if (t.border) opts.border = t.border;
  }
  return Object.assign(opts, state.config);
}

async function doRender() {
  var source = editor.value.trim();
  if (!source) {
    previewInner.innerHTML = emptyPreviewHtml();
    statusText.textContent = "Ready";
    statusText.className = "";
    statusDot.className = "status-dot";
    renderTime.textContent = "";
    return;
  }

  spinner.classList.add("visible");
  var t0 = performance.now();

  try {
    var svg = await renderMermaid(source, buildOptions());
    var ms = (performance.now() - t0).toFixed(0);
    previewInner.innerHTML = svg;
    var svgEl = previewInner.querySelector("svg");
    applyStrokeOverrides(svgEl);
    applyZoom(state.zoom);
    statusText.textContent = "OK";
    statusText.className = "status-ok";
    statusDot.className = "status-dot ok";
    renderTime.textContent = "Rendered in " + ms + "ms";
    updateHash();
  } catch (err) {
    var ms = (performance.now() - t0).toFixed(0);
    previewInner.innerHTML =
      '<div class="preview-error">' + escHtml(String(err)) + "</div>";
    statusText.textContent = "Error";
    statusText.className = "status-err";
    statusDot.className = "status-dot err";
    renderTime.textContent = "";
  } finally {
    spinner.classList.remove("visible");
  }
}
