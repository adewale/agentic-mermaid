var renderTimer = null;
var autoFitPending = true;

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
  root.setAttribute("data-scheme", isDark ? "dark" : "light");

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
  // Direct writes invalidate any pending lazy render — the panes now show
  // exactly what the caller asked for (placeholder or error copy).
  pendingTextSource = null;
  textRenderedFor.unicode = null;
  textRenderedFor.ascii = null;
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

// Verify-clear moment: when a tier goes from carrying warnings to Clear after
// an edit, pulse a `tier-cleared` class on the chip for ~1s so CSS can animate
// the transition. Counts of -1 mean "unknown" (initial load / reset), which
// never pulses.
var lastVerifyTierCounts = { structural: -1, geometric: -1, lint: -1 };

function markTierCleared(el, tier, count) {
  var prev = lastVerifyTierCounts[tier];
  lastVerifyTierCounts[tier] = count;
  if (!el || count !== 0 || prev <= 0) return;
  el.classList.remove("tier-cleared");
  void el.offsetWidth; // restart the animation if the class was still applied
  el.classList.add("tier-cleared");
  setTimeout(function() { el.classList.remove("tier-cleared"); }, 1000);
}

function resetVerifyTierCounts() {
  lastVerifyTierCounts.structural = -1;
  lastVerifyTierCounts.geometric = -1;
  lastVerifyTierCounts.lint = -1;
}

function resetVerifyPanel(summary) {
  if (verifySummary) verifySummary.textContent = summary || "Waiting for source";
  setVerifyTier(verifyTierStructural, verifyStructural, "idle", "Not run");
  setVerifyTier(verifyTierGeometric, verifyGeometric, "idle", "Not run");
  setVerifyTier(verifyTierLint, verifyLint, "idle", "Not run");
  resetVerifyTierCounts();
  updateVerifyDetails([]);
}

// Each verify warning is a typed object ({ code, ...fields }); render the
// non-code fields as "key value" prose so the disclosure stays honest to the
// structured payload without hardcoding per-code copy.
function describeVerifyWarning(w) {
  if (!w || typeof w !== "object") return "";
  if (w.message) return String(w.message);
  var parts = [];
  Object.keys(w).forEach(function(key) {
    if (key === "code" || key === "message" || key === "line" || key === "lines") return;
    var value = w[key];
    if (value == null) return;
    if (typeof value === "object") {
      try { value = JSON.stringify(value); } catch (err) { return; }
    }
    parts.push(key + " " + value);
  });
  return parts.join(", ");
}

function verifyWarningLocation(w) {
  if (!w) return "";
  if (typeof w.line === "number") return "line " + w.line;
  if (Array.isArray(w.lines) && w.lines.length) {
    return "line" + (w.lines.length === 1 ? " " : "s ") + w.lines.join(", ");
  }
  return "";
}

function setVerifyDetailsOpen(open) {
  if (!verifyDetailsBtn || !verifyDetails) return;
  verifyDetails.hidden = !open;
  verifyDetailsBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

// The disclosure lists each warning's stable code (linked to its docs page),
// prose, and source location. The collapsed tier counts stay the default view.
function updateVerifyDetails(warnings) {
  if (!verifyDetailsBtn || !verifyDetailsList) return;
  if (!warnings.length) {
    verifyDetailsBtn.hidden = true;
    verifyDetailsList.innerHTML = "";
    setVerifyDetailsOpen(false);
    return;
  }
  verifyDetailsBtn.hidden = false;
  verifyDetailsBtn.textContent = "Details (" + warnings.length + ")";
  verifyDetailsList.innerHTML = warnings.map(function(w) {
    var code = String((w && w.code) || "UNKNOWN");
    var tier = VERIFY_TIER_BY_CODE[code] || "lint";
    var message = describeVerifyWarning(w);
    var location = verifyWarningLocation(w);
    return '<li class="verify-detail ' + escAttr(tier) + '">'
      + '<a class="verify-detail-code" href="/warnings/' + escAttr(code) + '/" target="_blank" rel="noopener">' + escHtml(code) + '</a>'
      + (message ? '<span class="verify-detail-message">' + escHtml(message) + '</span>' : '')
      + (location ? '<span class="verify-detail-location">' + escHtml(location) + '</span>' : '')
      + '</li>';
  }).join("");
}

if (verifyDetailsBtn) {
  verifyDetailsBtn.addEventListener("click", function() {
    setVerifyDetailsOpen(verifyDetails.hidden);
  });
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
    updateVerifyDetails(warnings);
    var structuralState = counts.structural ? (result.ok ? "warn" : "err") : "ok";
    setVerifyTier(verifyTierStructural, verifyStructural, structuralState, counts.structural ? counts.structural + " warning" + (counts.structural === 1 ? "" : "s") : "Clear");
    setVerifyTier(verifyTierGeometric, verifyGeometric, counts.geometric ? "warn" : "ok", counts.geometric ? counts.geometric + " advisory" + (counts.geometric === 1 ? "" : " warnings") : "Clear");
    setVerifyTier(verifyTierLint, verifyLint, counts.lint ? "warn" : "ok", counts.lint ? counts.lint + " note" + (counts.lint === 1 ? "" : "s") : "Clear");
    markTierCleared(verifyTierStructural, "structural", counts.structural);
    markTierCleared(verifyTierGeometric, "geometric", counts.geometric);
    markTierCleared(verifyTierLint, "lint", counts.lint);
    if (verifySummary) {
      if (result.ok && warnings.length === 0) verifySummary.textContent = "Verified: no warnings";
      else if (result.ok) verifySummary.textContent = "Verified with review notes";
      else verifySummary.textContent = "Fix structural warnings before export";
    }
  } catch (err) {
    if (verifySummary) verifySummary.textContent = "Verify failed";
    setVerifyTier(verifyTierStructural, verifyStructural, "err", "Fix source first");
    setVerifyTier(verifyTierGeometric, verifyGeometric, "idle", "Not run");
    setVerifyTier(verifyTierLint, verifyLint, "idle", "Not run");
    updateVerifyDetails([]);
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
    if (!wrap.clientWidth) return; // hidden (not the active canvas) — fit when shown
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

// Text outputs render lazily. renderMermaidAscii is synchronous, so rendering
// both formats eagerly after every SVG render froze the whole tab on large
// pastes; instead doRender records the source and only the format whose canvas
// view is actually visible renders. The `hidden` attribute on the
// [data-canvas-view] wrappers (toggled by selectCanvasFormat in buttons.js) is
// the view state; a MutationObserver below renders stale output on view switch.
// ~300 statement lines ≈ 1.5s of synchronous layout per format (measured on a
// linear flowchart chain) — past that the pane shows a structured too-large
// message instead of freezing the tab.
var TEXT_RENDER_MAX_LINES = 300;
var pendingTextSource = null;
var textRenderedFor = { unicode: null, ascii: null };

function countSourceLines(source) {
  var lines = String(source || "").split("\n");
  var n = 0;
  for (var i = 0; i < lines.length; i++) if (lines[i].trim()) n++;
  return n;
}

function textViewWrap(format) {
  return document.getElementById(format + "-output-wrap");
}

function renderTextOutput(format) {
  var source = pendingTextSource;
  if (source == null || !renderMermaidAscii) return;
  if (textRenderedFor[format] === source) return;
  var el = format === "ascii" ? asciiOutput : unicodeOutput;
  if (!el) return;
  textRenderedFor[format] = source;
  var lines = countSourceLines(source);
  if (lines > TEXT_RENDER_MAX_LINES) {
    el.textContent = "Diagram too large for text rendering (" + lines + " lines > " + TEXT_RENDER_MAX_LINES + " line limit). The SVG preview is still available; for text output use the CLI: am render diagram.mmd --format " + format + ".";
    return;
  }
  try {
    var opts = Object.assign({}, buildOptions(), { colorMode: "none", useAscii: format === "ascii" });
    if (format === "unicode") unicodeOutput.style.fontSize = '';
    el.textContent = renderMermaidAscii(source, opts);
    if (format === "unicode") fitUnicodeOutput();
  } catch (err) {
    el.textContent = "Text output failed: " + String(err || "unknown error");
  }
}

function renderTextOutputs(source) {
  pendingTextSource = source;
  textRenderedFor.unicode = null;
  textRenderedFor.ascii = null;
  ["unicode", "ascii"].forEach(function(format) {
    var wrap = textViewWrap(format);
    if (wrap && !wrap.hidden) renderTextOutput(format);
  });
}

["unicode", "ascii"].forEach(function(format) {
  var wrap = textViewWrap(format);
  if (!wrap || typeof MutationObserver === "undefined") return;
  new MutationObserver(function() {
    if (!wrap.hidden) renderTextOutput(format);
  }).observe(wrap, { attributes: true, attributeFilter: ["hidden"] });
});

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
    if (autoFitPending && typeof fitToView === 'function') { fitToView(); autoFitPending = false; }
    setEditorErrorLine(0);
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
    var errorLoc = extractErrorLocation(String(err || ""));
    setEditorErrorLine(errorLoc ? errorLoc.line : 0);
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
