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

function chromeThemeColors() {
  // Paper (light) / Dusk (dark) — the exact brand triplets the public site
  // ships as its chrome. Keep these in lockstep with the site's [data-theme]
  // "dusk" block and the :root Paper defaults in mockups/styles.css.
  return isDark
    ? { bg: "#2A2521", fg: "#E9DFCC", accent: "#CC8A57" }
    : { bg: "#F5F0E4", fg: "#221E16", accent: "#9A4A24" };
}

function applyThemeToPage(themeKey) {
  var root = document.documentElement;
  var chrome = chromeThemeColors();
  root.style.setProperty("--t-bg", chrome.bg);
  root.style.setProperty("--t-fg", chrome.fg);
  root.style.setProperty("--t-accent", chrome.accent);
  root.style.setProperty("color-scheme", isDark ? "dark" : "light");

  // Update shadow RGB
  var fg = root.style.getPropertyValue("--t-fg").trim() || chrome.fg;
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

  // Patch the live preview SVG's CSS variables immediately. The SVG carries
  // the previous theme's --bg baked into its inline style, and the scheduled
  // re-render is async – without this, the diagram flashes the old theme
  // background (white, when leaving a light theme) on the new page colors.
  // For Default (no theme) the renderer falls back to DEFAULTS from
  // src/theme.ts (#FFFFFF / #27272A), so patch to those values.
  var svgEl =
    typeof previewInner !== "undefined" && previewInner
      ? previewInner.querySelector("svg")
      : null;
  if (svgEl) {
    var themeColors =
      themeKey && THEMES[themeKey]
        ? THEMES[themeKey]
        : { bg: "#FFFFFF", fg: "#27272A" };
    var overrides = (typeof state !== "undefined" && state.config) || {};
    var roles = ["bg", "fg", "line", "accent", "muted", "surface", "border"];
    for (var i = 0; i < roles.length; i++) {
      var value = overrides[roles[i]] || themeColors[roles[i]];
      if (value) svgEl.style.setProperty("--" + roles[i], value);
      else svgEl.style.removeProperty("--" + roles[i]);
    }
  }
}

function buildOptions() {
  var opts = { embedFontImport: false };
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

function setTextOutputs(unicode, ascii) {
  if (unicodeOutput) {
    unicodeOutput.style.fontSize = '';
    unicodeOutput.textContent = unicode || "Render a valid diagram to see Unicode output.";
  }
  if (asciiOutput) asciiOutput.textContent = ascii || "Render a valid diagram to see ASCII output.";
}

var VERIFY_TIER_BY_CODE = {
  EMPTY_DIAGRAM: "structural",
  EDGE_MISANCHORED: "structural",
  OFF_CANVAS: "structural",
  GROUP_BREACH: "structural",
  UNKNOWN_SHAPE: "structural",
  LABEL_OVERFLOW: "structural",
  UNRESOLVABLE_SCHEDULE: "structural",
  NODE_OVERLAP: "geometric",
  ROUTE_SELF_CROSS: "geometric",
  ROUTE_HITCH: "geometric",
  ROUTE_UNEXPLAINED_BEND: "geometric",
  ROUTE_LABEL_ON_SHARED_TRUNK: "geometric",
  ROUTE_CONTAINER_MISANCHOR: "geometric",
  ROUTE_SHAPE_MISANCHOR: "geometric",
  ROUTE_STALE_AFTER_NODE_MOVE: "geometric",
  DUPLICATE_EDGE: "lint",
  UNREACHABLE_NODE: "lint",
  DECISION_BRANCH_UNLABELED: "lint",
  COMMENT_DROPPED: "lint",
  UNSUPPORTED_SYNTAX: "lint",
  CONTENT_DROPPED_ON_ROUNDTRIP: "lint",
};

function setVerifyTier(el, labelEl, stateName, text) {
  if (!el || !labelEl) return;
  el.classList.remove("ok", "warn", "err", "idle");
  el.classList.add(stateName);
  labelEl.textContent = text;
}

function resetVerifyPanel(summary) {
  if (verifySummary) verifySummary.textContent = summary || "Waiting for source";
  setVerifyTier(verifyTierStructural, verifyStructural, "idle", "Not run");
  setVerifyTier(verifyTierGeometric, verifyGeometric, "idle", "Not run");
  setVerifyTier(verifyTierLint, verifyLint, "idle", "Not run");
}

function updateVerifyPanel(source) {
  if (!verifyMermaid) {
    resetVerifyPanel("Verify unavailable in this build");
    return;
  }
  try {
    var result = verifyMermaid(source);
    var warnings = result && Array.isArray(result.warnings) ? result.warnings : [];
    var counts = { structural: 0, geometric: 0, lint: 0 };
    warnings.forEach(function(w) {
      var tier = VERIFY_TIER_BY_CODE[w && w.code] || "lint";
      counts[tier]++;
    });
    var structuralState = counts.structural ? (result.ok ? "warn" : "err") : "ok";
    setVerifyTier(verifyTierStructural, verifyStructural, structuralState, counts.structural ? counts.structural + " warning" + (counts.structural === 1 ? "" : "s") : "Clear");
    setVerifyTier(verifyTierGeometric, verifyGeometric, counts.geometric ? "warn" : "ok", counts.geometric ? counts.geometric + " advisory" + (counts.geometric === 1 ? "" : " warnings") : "Clear");
    setVerifyTier(verifyTierLint, verifyLint, counts.lint ? "warn" : "ok", counts.lint ? counts.lint + " note" + (counts.lint === 1 ? "" : "s") : "Clear");
    if (verifySummary) {
      if (result.ok && warnings.length === 0) verifySummary.textContent = "Verified: safe to export";
      else if (result.ok) verifySummary.textContent = "Verified with review notes";
      else verifySummary.textContent = "Fix structural warnings before export";
    }
  } catch (err) {
    if (verifySummary) verifySummary.textContent = "Verify failed";
    setVerifyTier(verifyTierStructural, verifyStructural, "err", "Fix source first");
    setVerifyTier(verifyTierGeometric, verifyGeometric, "idle", "Not run");
    setVerifyTier(verifyTierLint, verifyLint, "idle", "Not run");
  }
}

function ensurePreviewSvgAccessibility(svgEl, source) {
  if (!svgEl) return;
  var title = svgEl.querySelector('title');
  var desc = svgEl.querySelector('desc');
  if (!title) {
    title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.id = 'preview-svg-title';
    var first = (source || '').trim().split(/\n/)[0] || 'Mermaid diagram';
    title.textContent = 'Rendered ' + first.replace(/[^a-z0-9 _-]/gi, ' ').trim() + ' diagram';
    svgEl.insertBefore(title, svgEl.firstChild);
  } else if (!title.id) {
    title.id = 'preview-svg-title';
  }
  if (!desc) {
    desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
    desc.id = 'preview-svg-desc';
    desc.textContent = 'Preview generated locally from the Mermaid source editor. Verify status and text output are shown below.';
    title.insertAdjacentElement('afterend', desc);
  } else if (!desc.id) {
    desc.id = 'preview-svg-desc';
  }
  svgEl.setAttribute('role', 'img');
  svgEl.setAttribute('aria-labelledby', title.id + ' ' + desc.id);
}

function fitUnicodeOutput() {
  if (!unicodeOutput) return;
  var wrap = document.getElementById('unicode-output-wrap');
  if (!wrap) return;
  unicodeOutput.style.fontSize = '';
  window.requestAnimationFrame(function() {
    var cs = getComputedStyle(wrap);
    var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var available = Math.max(96, wrap.clientWidth - pad - 4);
    var needed = unicodeOutput.scrollWidth;
    var base = parseFloat(getComputedStyle(unicodeOutput).fontSize) || 12;
    if (needed > available) {
      var next = Math.max(6.5, Math.floor((base * available / needed * 0.98) * 10) / 10);
      unicodeOutput.style.fontSize = next + 'px';
    }
  });
}

function renderTextOutputs(source) {
  if (!renderMermaidAscii) return;
  try {
    var opts = Object.assign({}, buildOptions(), { colorMode: "none" });
    setTextOutputs(
      renderMermaidAscii(source, Object.assign({}, opts, { useAscii: false })),
      renderMermaidAscii(source, Object.assign({}, opts, { useAscii: true })),
    );
    fitUnicodeOutput();
  } catch (err) {
    setTextOutputs("Text output failed: " + String(err || "unknown error"), "Text output failed: " + String(err || "unknown error"));
  }
}

async function doRender() {
  var source = editor.value.trim();
  if (!source) {
    previewInner.innerHTML = emptyPreviewHtml();
    setTextOutputs("", "");
    statusText.textContent = "Ready";
    statusText.className = "";
    statusDot.className = "status-dot";
    renderTime.textContent = "";
    resetVerifyPanel("Waiting for source");
    if (typeof updateExportAvailability === "function") updateExportAvailability();
    return;
  }

  spinner.classList.add("visible");
  var t0 = performance.now();

  try {
    var svg = await renderMermaid(source, buildOptions());
    var ms = (performance.now() - t0).toFixed(0);
    previewInner.innerHTML = svg;
    var svgEl = previewInner.querySelector("svg");
    ensurePreviewSvgAccessibility(svgEl, source);
    applyStrokeOverrides(svgEl);
    applyZoom(state.zoom);
    statusText.textContent = "OK";
    statusText.className = "status-ok";
    statusDot.className = "status-dot ok";
    renderTime.textContent = "Rendered in " + ms + "ms";
    updateVerifyPanel(source);
    renderTextOutputs(source);
    if (typeof updateExportAvailability === "function") updateExportAvailability();
    updateHash();
  } catch (err) {
    var ms = (performance.now() - t0).toFixed(0);
    previewInner.innerHTML = formatRenderErrorHtml(err);
    statusText.textContent = "Error";
    statusText.className = "status-err";
    statusDot.className = "status-dot err";
    renderTime.textContent = "Failed in " + ms + "ms";
    resetVerifyPanel("Parse or render failed");
    setVerifyTier(verifyTierStructural, verifyStructural, "err", "Fix source first");
    setTextOutputs("Fix the render error to see Unicode output.", "Fix the render error to see ASCII output.");
    if (typeof updateExportAvailability === "function") updateExportAvailability();
  } finally {
    spinner.classList.remove("visible");
  }
}
