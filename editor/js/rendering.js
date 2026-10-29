import { ui } from './context.js';
import { asciiOutput, editor, previewBody, previewInner, renderTime, runtimeRecovery, spinner, statusDot, statusText, unicodeOutput, verifyDetails, verifyDetailsBtn, verifyDetailsList, verifyGeometric, verifyLint, verifyStructural, verifySummary, verifyTierGeometric, verifyTierLint, verifyTierStructural } from './elements.js';
import { updateExportAvailability } from './export.js';
import { refreshC4Navigation } from './c4-navigation.js';
import { refreshDiagramTools } from './diagram-tools.js';
import { EditorMotion } from './motion.js';
import { isDark } from './dark-mode.js';
import { editorPaletteColors, editorPaletteInput, renderMermaidAsciiWithReceipt, renderMermaidUnicodeWithReceipt, renderMermaidWithReceipt, state, verifyMermaid, verifyNoExternalRefs } from './state.js';
import { currentCanvasFormat } from './buttons.js';
import { emptyPreviewHtml, escAttr, escHtml, extractErrorLocation, formatRenderErrorHtml, setEditorErrorLine } from './helpers.js';
import { cancelPreviewMotion } from './pan.js';
import { applyZoom, fitToView } from './zoom.js';
import { updateHash } from './sharing.js';
export var renderTimer, renderSpinnerTimer, renderRequestVersion, lastSuccessfulUiMs, autoFitPending, lastRenderedSvgSource, lastRenderedTextArtifacts, textOutputCacheKey, VERIFY_TIER_BY_CODE, VERIFY_SEVERITY_BY_CODE, lastVerifyTierCounts, TEXT_RENDER_MAX_LINES;
var paneWidthObserver, lastPaneWidth, lastPaneFitKey, paneFitPresentationPending;


export function currentEditorSource() {
  return editor.value.trim();
}


export function isCurrentRender(version, source) {
  return version === renderRequestVersion && currentEditorSource() === source;
}


export function hasCurrentVerifiedSvgArtifact() {
  return !!ui.lastRenderedSvgArtifact
    && lastRenderedSvgSource === currentEditorSource()
    && previewInner.querySelector('svg') !== null
    && previewInner.dataset.sharedRequestDigest === ui.lastRenderedSvgArtifact.receipt.sharedRequestDigest
    && (!state.fitLabelsToPane || !ui.lastRenderedSvgOptions || JSON.stringify(ui.lastRenderedSvgOptions) === JSON.stringify(buildOptions()));
}


export function clearRenderSpinner() {
  if (renderSpinnerTimer) clearTimeout(renderSpinnerTimer);
  renderSpinnerTimer = null;
  spinner.classList.remove("visible");
}


export function invalidateRenderedArtifacts() {
  ui.lastRenderedSvgArtifact = null;
  ui.lastRenderedSvgOptions = null;
  lastRenderedSvgSource = null;
  markTextOutputsDirty();
  delete previewInner.dataset.sharedRequestDigest;
  delete previewInner.dataset.renderRequestDigest;
  delete previewInner.dataset.appearanceDigest;
  if (typeof updateExportAvailability === "function") updateExportAvailability();
  if (typeof refreshC4Navigation === "function") refreshC4Navigation();
  if (typeof refreshDiagramTools === "function") refreshDiagramTools();
}


export function scheduleRender(delay) {
  var version = ++renderRequestVersion;
  if (typeof window.__mermaid.cancelPendingRender === 'function') window.__mermaid.cancelPendingRender();
  if (renderTimer) clearTimeout(renderTimer);
  if (!state.fitLabelsToPane) paneFitPresentationPending = true;
  lastPaneFitKey = state.fitLabelsToPane ? paneFitKey() : null;
  // Keep the old picture visible until its replacement is ready, but revoke
  // its authority immediately. Source, Style, theme, or config changes must
  // never leave stale export buttons or receipts live during the debounce.
  invalidateRenderedArtifacts();
  clearRenderSpinner();
  var nextDelay = delay == null ? EditorMotion.adaptiveRenderDelay(lastSuccessfulUiMs) : delay;
  renderTimer = setTimeout(function() {
    renderTimer = null;
    doRender(version);
  }, nextDelay);
}


export function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  var v = hex.trim();
  if (v[0] === "#") v = v.slice(1);
  if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
  if (v.length !== 6) return null;
  var n = parseInt(v, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}


export function chromeThemeColors() {
  // App-shell chrome: the Kiln brand — a warm-neutral Stone (light) / Charcoal
  // (dark) ground with the independent Pine accent, NOT the terracotta of the
  // "paper" diagram theme. Both triplets live in editor/css/variables.css
  // (:root light, [data-scheme="dark"] Charcoal); the light one also mirrors
  // :root in website/source/assets/styles.css, whose shell is light-only.
  // chrome-token-lockstep.test.ts pins all of it. Pine accent clears WCAG AA
  // on both grounds (5.7:1 on Stone, 8.7:1 on Charcoal).
  return isDark
    ? { bg: "#17130D", fg: "#EBE7E0", accent: "#6FC2A2" }
    : { bg: "#F8F4F0", fg: "#26201B", accent: "#1B6E52" };
}


export function applyThemeToPage(themeKey) {
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
    var themeColors = editorPaletteColors(themeKey) || { bg: "#FFFFFF", fg: "#27272A" };
    var overrides = (typeof state !== "undefined" && state.config) || {};
    var roles = (window.__mermaid && window.__mermaid.STYLE_COLOR_TOKEN_FIELDS) || [];
    for (var i = 0; i < roles.length; i++) {
      var value = overrides[roles[i]] || themeColors[roles[i]];
      if (value) svgEl.style.setProperty("--" + roles[i], value);
      else svgEl.style.removeProperty("--" + roles[i]);
    }
  }
}


export function buildOptions() {
  // Share hashes are attacker-controlled. Resolve them through the same pure
  // production boundary imported by build/tests, then keep strict SVG parsing
  // at the insertion sink below as the second line of defence.
  return window.__mermaid.resolveEditorRenderOptions(Object.assign({}, state, {
    source: currentEditorSource(),
    paneWidth: state.fitLabelsToPane ? availablePaneWidth() : undefined,
  }), {
    allowedFields: window.__mermaid.SHARED_RENDER_OPTION_FIELDS || [],
    validate: window.__mermaid.validateSerializableRenderOptions,
    resolvePaletteInput: editorPaletteInput,
  });
}


export function availablePaneWidth() {
  if (typeof previewBody === 'undefined' || !previewBody || !previewBody.clientWidth) return lastPaneWidth;
  var style = getComputedStyle(previewBody);
  var width = Math.floor(previewBody.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
  if (width > 0) lastPaneWidth = width;
  return lastPaneWidth;
}


function paneFitKey() {
  try {
    var options = buildOptions();
    return JSON.stringify([options.pie && options.pie.maxWidth, options.radar && options.radar.maxWidth]);
  } catch (error) { return null; } // Ordinary rendering owns invalid-config diagnostics.
}


export function refreshPaneFitting() {
  if (!state.fitLabelsToPane) return;
  var key = paneFitKey();
  if (key !== lastPaneFitKey) scheduleRender();
}


export function insertStrictRenderedSvg(svg) {
  if (window.__mermaid && typeof window.__mermaid.verifyNoExternalRefs === "function") {
    var verification = window.__mermaid.verifyNoExternalRefs(svg);
    if (!verification.ok) throw new Error("Unsafe SVG output: " + verification.refs.join(", "));
  }
  var parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror") || !parsed.documentElement || parsed.documentElement.localName !== "svg") {
    throw new Error("Renderer returned malformed SVG");
  }
  previewInner.replaceChildren(document.importNode(parsed.documentElement, true));
}


export function setTextOutputs(unicode, ascii) {
  if (unicodeOutput) {
    unicodeOutput.style.fontSize = '';
    unicodeOutput.textContent = unicode || "Select Unicode to render text output.";
  }
  if (asciiOutput) asciiOutput.textContent = ascii || "Select ASCII to render text output.";
}


export function clearTextOutputReceipts() {
  lastRenderedTextArtifacts.unicode = null;
  lastRenderedTextArtifacts.ascii = null;
  ["unicode", "ascii"].forEach(function(format) {
    delete previewInner.dataset[format + "SharedRequestDigest"];
    delete previewInner.dataset[format + "RenderRequestDigest"];
    delete previewInner.dataset[format + "AppearanceDigest"];
  });
}


export function retainTextOutputArtifact(format, artifact) {
  if (!artifact || !artifact.receipt) throw new Error(format + " renderer returned no receipt");
  if (artifact.receipt.output !== format) throw new Error(format + " renderer returned a " + artifact.receipt.output + " receipt");
  if (!hasCurrentVerifiedSvgArtifact()) {
    throw new Error(format + " output requires a current verified SVG preview");
  }
  if (artifact.receipt.sharedRequestDigest !== ui.lastRenderedSvgArtifact.receipt.sharedRequestDigest) {
    throw new Error(format + " output and SVG preview do not describe the same render request");
  }
  if (artifact.receipt.appearanceDigest !== ui.lastRenderedSvgArtifact.receipt.appearanceDigest) {
    throw new Error(format + " output and SVG preview do not describe the same appearance");
  }
  lastRenderedTextArtifacts[format] = artifact;
  previewInner.dataset[format + "SharedRequestDigest"] = artifact.receipt.sharedRequestDigest;
  previewInner.dataset[format + "RenderRequestDigest"] = artifact.receipt.requestDigest;
  previewInner.dataset[format + "AppearanceDigest"] = artifact.receipt.appearanceDigest;
}


export function textOutputKey(source) {
  return source + "\n" + JSON.stringify(ui.lastRenderedSvgOptions || buildOptions());
}


export function activeCanvasFormat() {
  return typeof currentCanvasFormat === "string" ? currentCanvasFormat : "diagram";
}


export function markTextOutputsDirty() {
  textOutputCacheKey = "";
  clearTextOutputReceipts();
}


export function setVerifyTier(el, labelEl, stateName, text) {
  if (!el || !labelEl) return;
  el.classList.remove("ok", "warn", "err", "idle");
  el.classList.add(stateName);
  labelEl.textContent = text;
}


export function markTierCleared(el, tier, count) {
  var prev = lastVerifyTierCounts[tier];
  lastVerifyTierCounts[tier] = count;
  if (!el || count !== 0 || prev <= 0) return;
  el.classList.remove("tier-cleared");
  void el.offsetWidth; // restart the animation if the class was still applied
  el.classList.add("tier-cleared");
  setTimeout(function() { el.classList.remove("tier-cleared"); }, 1000);
}


export function resetVerifyTierCounts() {
  lastVerifyTierCounts.structural = -1;
  lastVerifyTierCounts.geometric = -1;
  lastVerifyTierCounts.lint = -1;
}


export function resetVerifyPanel(summary) {
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
export function describeVerifyWarning(w) {
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


export function verifyWarningLocation(w) {
  if (!w) return "";
  if (typeof w.line === "number") return "line " + w.line;
  if (Array.isArray(w.lines) && w.lines.length) {
    return "line" + (w.lines.length === 1 ? " " : "s ") + w.lines.join(", ");
  }
  return "";
}


export function setVerifyDetailsOpen(open) {
  if (!verifyDetailsBtn || !verifyDetails) return;
  verifyDetails.hidden = !open;
  verifyDetailsBtn.setAttribute("aria-expanded", open ? "true" : "false");
}


// The disclosure lists each warning's stable code (linked to its docs page),
// prose, and source location. The collapsed tier counts stay the default view.
export function updateVerifyDetails(warnings) {
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


export function updateVerifyPanel(source, renderOptions, providedResult) {
  if (!verifyMermaid && !providedResult) {
    resetVerifyPanel("Verify unavailable in this build");
    return null;
  }
  try {
    var result = providedResult || verifyMermaid(source, { renderOptions: renderOptions });
    var warnings = result && Array.isArray(result.warnings) ? result.warnings : [];
    var counts = { structural: 0, geometric: 0, lint: 0 };
    var errors = { structural: 0, geometric: 0, lint: 0 };
    warnings.forEach(function(w) {
      var tier = VERIFY_TIER_BY_CODE[w && w.code] || "lint";
      counts[tier]++;
      if (VERIFY_SEVERITY_BY_CODE[w && w.code] === "error") errors[tier]++;
    });
    updateVerifyDetails(warnings);
    var structuralState = counts.structural ? (errors.structural ? "err" : "warn") : "ok";
    setVerifyTier(verifyTierStructural, verifyStructural, structuralState, counts.structural ? counts.structural + " warning" + (counts.structural === 1 ? "" : "s") : "Clear");
    setVerifyTier(verifyTierGeometric, verifyGeometric, counts.geometric ? (errors.geometric ? "err" : "warn") : "ok", errors.geometric ? errors.geometric + " error" + (errors.geometric === 1 ? "" : "s") : counts.geometric ? counts.geometric + " advisory" + (counts.geometric === 1 ? "" : " warnings") : "Clear");
    setVerifyTier(verifyTierLint, verifyLint, counts.lint ? (errors.lint ? "err" : "warn") : "ok", errors.lint ? errors.lint + " error" + (errors.lint === 1 ? "" : "s") : counts.lint ? counts.lint + " note" + (counts.lint === 1 ? "" : "s") : "Clear");
    markTierCleared(verifyTierStructural, "structural", counts.structural);
    markTierCleared(verifyTierGeometric, "geometric", counts.geometric);
    markTierCleared(verifyTierLint, "lint", counts.lint);
    if (verifySummary) {
      if (result.ok && warnings.length === 0) verifySummary.textContent = "Render checks passed: no warnings";
      else if (result.ok) verifySummary.textContent = "Verified with review notes";
      else verifySummary.textContent = "Fix verification errors before export";
    }
    return result;
  } catch (err) {
    if (verifySummary) verifySummary.textContent = "Verify failed";
    setVerifyTier(verifyTierStructural, verifyStructural, "err", "Fix source first");
    setVerifyTier(verifyTierGeometric, verifyGeometric, "idle", "Not run");
    setVerifyTier(verifyTierLint, verifyLint, "idle", "Not run");
    updateVerifyDetails([]);
    return null;
  }
}


export function fitUnicodeOutput() {
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


export function countSourceLines(source) {
  var lines = String(source || "").split("\n");
  var n = 0;
  for (var i = 0; i < lines.length; i++) if (lines[i].trim()) n++;
  return n;
}


export async function renderTextOutputs(source) {
  if (!renderMermaidAsciiWithReceipt || !renderMermaidUnicodeWithReceipt) return;
  if (!hasCurrentVerifiedSvgArtifact()) {
    markTextOutputsDirty();
    setTextOutputs("Render and verify the diagram to see Unicode output.", "Render and verify the diagram to see ASCII output.");
    return;
  }
  var key = textOutputKey(source);
  var svgArtifactAtStart = ui.lastRenderedSvgArtifact;
  if (textOutputCacheKey === key) {
    if (activeCanvasFormat() === "unicode") fitUnicodeOutput();
    return;
  }
  var lines = countSourceLines(source);
  if (lines > TEXT_RENDER_MAX_LINES) {
    textOutputCacheKey = key;
    var tooLarge = function(format) {
      return "Diagram too large for text rendering (" + lines + " lines > " + TEXT_RENDER_MAX_LINES + " line limit). The SVG preview is still available; for text output use the CLI: am render diagram.mmd --format " + format + ".";
    };
    setTextOutputs(tooLarge("unicode"), tooLarge("ascii"));
    return;
  }
  try {
    var opts = Object.assign({}, ui.lastRenderedSvgOptions || buildOptions(), { colorMode: "none" });
    var artifacts = await Promise.all([
      renderMermaidUnicodeWithReceipt(source, opts),
      renderMermaidAsciiWithReceipt(source, Object.assign({}, opts, { useAscii: true }))
    ]);
    if (source !== currentEditorSource() || ui.lastRenderedSvgArtifact !== svgArtifactAtStart) return;
    var unicodeArtifact = artifacts[0];
    var asciiArtifact = artifacts[1];
    retainTextOutputArtifact("unicode", unicodeArtifact);
    retainTextOutputArtifact("ascii", asciiArtifact);
    setTextOutputs(
      unicodeArtifact.text,
      asciiArtifact.text,
    );
    textOutputCacheKey = key;
    if (activeCanvasFormat() === "unicode") fitUnicodeOutput();
  } catch (err) {
    if (source !== currentEditorSource() || ui.lastRenderedSvgArtifact !== svgArtifactAtStart) return;
    textOutputCacheKey = "";
    clearTextOutputReceipts();
    setTextOutputs("Text output failed: " + String(err || "unknown error"), "Text output failed: " + String(err || "unknown error"));
  }
}


export function ensureTextOutputs(source) {
  source = source || editor.value.trim();
  if (!source || !hasCurrentVerifiedSvgArtifact()) {
    markTextOutputsDirty();
    setTextOutputs(
      source ? "Render and verify the diagram to see Unicode output." : "",
      source ? "Render and verify the diagram to see ASCII output." : "",
    );
    return;
  }
  renderTextOutputs(source);
}


export async function doRender(version) {
  if (typeof version !== "number") version = ++renderRequestVersion;
  if (typeof cancelPreviewMotion === 'function') cancelPreviewMotion();
  clearRenderSpinner();
  var source = currentEditorSource();
  if (!source) {
    paneFitPresentationPending = true;
    if (runtimeRecovery) runtimeRecovery.hidden = true;
    if (!isCurrentRender(version, source)) return;
    previewInner.innerHTML = emptyPreviewHtml();
    markTextOutputsDirty();
    setTextOutputs("", "");
    statusText.textContent = "Ready";
    statusText.className = "";
    statusDot.className = "status-dot";
    renderTime.textContent = "";
    delete previewInner.dataset.sharedRequestDigest;
    delete previewInner.dataset.renderRequestDigest;
    delete previewInner.dataset.appearanceDigest;
    ui.lastRenderedSvgArtifact = null;
    resetVerifyPanel("Waiting for source");
    if (typeof updateExportAvailability === "function") updateExportAvailability();
    if (typeof refreshC4Navigation === "function") refreshC4Navigation();
  if (typeof refreshDiagramTools === "function") refreshDiagramTools();
    return;
  }

  var t0 = performance.now();
  renderSpinnerTimer = setTimeout(function() {
    if (version === renderRequestVersion) spinner.classList.add("visible");
  }, 250);

  try {
    if (state.fitLabelsToPane && typeof window.__mermaid.prepareEditorRenderOptions === 'function') {
      await window.__mermaid.prepareEditorRenderOptions(state);
      if (!isCurrentRender(version, source)) return;
    }
    var renderOptions = buildOptions();
    lastPaneFitKey = state.fitLabelsToPane ? paneFitKey() : null;
    var rendered = await Promise.resolve(renderMermaidWithReceipt(source, renderOptions));
    var commitStarted = performance.now();
    var svg = rendered.svg;
    if (!isCurrentRender(version, source) || JSON.stringify(renderOptions) !== JSON.stringify(buildOptions())) return;
    var svgSafety = verifyNoExternalRefs(svg);
    if (!svgSafety.ok) throw new Error("Unsafe SVG output blocked: " + svgSafety.refs.join(", "));
    insertStrictRenderedSvg(svg);
    var familyId = rendered.receipt.executionDecision && rendered.receipt.executionDecision.family.id;
    var fittingPane = state.fitLabelsToPane && (familyId === 'family:pie' || familyId === 'family:radar');
    if (!fittingPane) paneFitPresentationPending = true;
    else if (paneFitPresentationPending) {
      state.zoom = 1;
      autoFitPending = false;
      paneFitPresentationPending = false;
    }
    applyZoom(state.zoom);
    if (autoFitPending && typeof fitToView === 'function') { fitToView(); autoFitPending = false; }
    setEditorErrorLine(0);
    var verification = updateVerifyPanel(source, renderOptions, rendered.verification);
    var renderMs = performance.now() - t0;
    // Worker, queue and startup time do not block input. The bounded worker
    // queue limits background work; debounce follows the remaining UI cost.
    lastSuccessfulUiMs = Number.isFinite(rendered.computeMs) ? performance.now() - commitStarted : renderMs;
    renderTime.textContent = "Rendered and verified in " + renderMs.toFixed(0) + "ms";
    markTextOutputsDirty();
    if (verification && verification.ok) {
      ui.lastRenderedSvgArtifact = rendered;
      ui.lastRenderedSvgOptions = renderOptions;
      lastRenderedSvgSource = source;
      previewInner.dataset.sharedRequestDigest = rendered.receipt.sharedRequestDigest;
      previewInner.dataset.renderRequestDigest = rendered.receipt.requestDigest;
      previewInner.dataset.appearanceDigest = rendered.receipt.appearanceDigest;
      statusText.textContent = "OK";
      statusText.className = "status-ok";
      statusDot.className = "status-dot ok";
      if (activeCanvasFormat() !== "diagram") renderTextOutputs(source);
    } else {
      ui.lastRenderedSvgArtifact = null;
      lastRenderedSvgSource = null;
      delete previewInner.dataset.sharedRequestDigest;
      delete previewInner.dataset.renderRequestDigest;
      delete previewInner.dataset.appearanceDigest;
      setTextOutputs("", "");
      statusText.textContent = verification ? "Needs fixes" : "Verify error";
      statusText.className = "status-err";
      statusDot.className = "status-dot err";
    }
    if (typeof updateExportAvailability === "function") updateExportAvailability();
    if (typeof refreshC4Navigation === "function") refreshC4Navigation(true);
    if (typeof refreshDiagramTools === "function") refreshDiagramTools();
    if (verification && verification.ok) updateHash();
  } catch (err) {
    if (!isCurrentRender(version, source)) return;
    var ms = (performance.now() - t0).toFixed(0);
    previewInner.innerHTML = formatRenderErrorHtml(err);
    delete previewInner.dataset.sharedRequestDigest;
    delete previewInner.dataset.renderRequestDigest;
    delete previewInner.dataset.appearanceDigest;
    ui.lastRenderedSvgArtifact = null;
    lastRenderedSvgSource = null;
    var errorLoc = extractErrorLocation(String(err || ""));
    setEditorErrorLine(errorLoc ? errorLoc.line : 0);
    statusText.textContent = "Error";
    statusText.className = "status-err";
    statusDot.className = "status-dot err";
    renderTime.textContent = "Failed in " + ms + "ms";
    markTextOutputsDirty();
    if (err && err.name === 'PreviewRuntimeLoadError') {
      resetVerifyPanel("Editor code unavailable; verification not run");
      setTextOutputs("Retry or reload the editor to see Unicode output.", "Retry or reload the editor to see ASCII output.");
    } else {
      resetVerifyPanel("Parse or render failed");
      setVerifyTier(verifyTierStructural, verifyStructural, "err", "Fix source first");
      setTextOutputs("Fix the render error to see Unicode output.", "Fix the render error to see ASCII output.");
    }
    if (typeof updateExportAvailability === "function") updateExportAvailability();
    if (typeof refreshC4Navigation === "function") refreshC4Navigation();
  if (typeof refreshDiagramTools === "function") refreshDiagramTools();
  } finally {
    if (version === renderRequestVersion) clearRenderSpinner();
  }
}

export function initialize() {
renderTimer = null;

renderSpinnerTimer = null;

renderRequestVersion = 0;

lastSuccessfulUiMs = null;

autoFitPending = true;

// Exact canonical artifact inserted into the preview. Export adapters derive
// from this record/source, never from a host-mutated preview DOM.
ui.lastRenderedSvgArtifact = null;
ui.lastRenderedSvgOptions = null;
lastPaneWidth = undefined;
lastPaneFitKey = null;
paneFitPresentationPending = true;
if (paneWidthObserver) paneWidthObserver.disconnect();
if (typeof previewBody !== 'undefined' && previewBody && typeof ResizeObserver !== 'undefined') {
  paneWidthObserver = new ResizeObserver(refreshPaneFitting);
  paneWidthObserver.observe(previewBody);
} else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', refreshPaneFitting);
}

lastRenderedSvgSource = null;

// Text views and their copy/export action retain the same receipt-bearing
// artifacts as SVG/PNG instead of reducing them to strings at render time.
lastRenderedTextArtifacts = { unicode: null, ascii: null };


textOutputCacheKey = "";


VERIFY_TIER_BY_CODE = (window.__mermaid && window.__mermaid.WARNING_TIER) || {};

VERIFY_SEVERITY_BY_CODE = (window.__mermaid && window.__mermaid.WARNING_SEVERITY) || {};


// Verify-clear moment: when a tier goes from carrying warnings to Clear after
// an edit, pulse a `tier-cleared` class on the chip for ~1s so CSS can animate
// the transition. Counts of -1 mean "unknown" (initial load / reset), which
// never pulses.
lastVerifyTierCounts = { structural: -1, geometric: -1, lint: -1 };


if (verifyDetailsBtn) {
  verifyDetailsBtn.addEventListener("click", function() {
    setVerifyDetailsOpen(verifyDetails.hidden);
  });
}


// Text outputs render lazily: doRender only marks them dirty, and they render
// when a text canvas view is actually active (doRender's activeCanvasFormat
// check, or buttons.js calling ensureTextOutputs on view switch). Past the
// line cap the pane shows a structured too-large message instead of running
// the receipt-bearing terminal renderer synchronously on a huge diagram.
TEXT_RENDER_MAX_LINES = 300;
}
