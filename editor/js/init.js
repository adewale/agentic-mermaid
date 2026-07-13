// Theme dropdown logic
var themeBtnLabel = document.getElementById("theme-btn-label");
var themeBtnSwatch = document.getElementById("theme-btn-swatch");
var themeDropdownBtn = document.getElementById("theme-dropdown-btn");

function updateThemeButton() {
  var key = state.theme;
  if (key && THEMES[key]) {
    themeBtnLabel.textContent =
      themeDropdownBtn.getAttribute("data-label-" + key) || key;
    themeBtnSwatch.style.background = THEMES[key].bg;
    themeBtnSwatch.style.display = "";
  } else {
    themeBtnLabel.textContent = "Default";
    // Keep the ringed swatch visible (CSS supplies a neutral fill) — on mobile
    // the swatch is the entire control, so hiding it left a blank button.
    themeBtnSwatch.style.background = "";
    themeBtnSwatch.style.display = "";
  }
  // Update active state in dropdown
  themeMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
    var active = item.dataset.theme === key;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
    item.tabIndex = themeMenu.classList.contains("open") && active ? 0 : -1;
  });
}

function setTheme(key) {
  state.theme = key;
  diagramThemeIsAuto = false;
  if (key) {
    localStorage.setItem("bm-editor-theme", key);
  } else {
    localStorage.removeItem("bm-editor-theme");
  }
  applyThemeToPage(key);
  updateThemeButton();
  refreshAllColorUIs();
  scheduleRender(0);
}

var themeMenuPopup = createListboxPopupController({
  popup: themeMenu,
  trigger: themeDropdownBtn,
  itemSelector: '.theme-dropdown-item',
  activeSelector: '.theme-dropdown-item.active',
  visualClose: true,
  contains: function(target) { return !!target.closest("#theme-dropdown-wrap"); },
  onSelect: function(item) { setTheme(item.dataset.theme || ""); },
});

function setThemeMenuOpen(open, focusActive) {
  themeMenuPopup.setOpen(open, { focusFirst: !!focusActive });
}

// Store label data for lookup
themeMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
  var key = item.dataset.theme || "";
  themeDropdownBtn.setAttribute("data-label-" + key, item.textContent.trim());
});

// Apply initial dark/light mode (must happen after all DOM refs + functions are ready)
applyColorMode(isDark);

// Restore saved theme, otherwise start on the brand Paper theme so the editor
// opens with the same diagram palette the public site renders.
var savedTheme = localStorage.getItem("bm-editor-theme") || "";
if (savedTheme && THEMES[savedTheme]) {
  state.theme = savedTheme;
  diagramThemeIsAuto = false;
} else if (!state.theme || !THEMES[state.theme]) {
  state.theme = DEFAULT_EDITOR_THEME;
  diagramThemeIsAuto = true;
}
applyThemeToPage(state.theme);
updateThemeButton();
setThemeMenuOpen(false, false);

// ── Style dropdown (renderer treatment — hand-drawn, watercolor, …) ─────────
// Mirrors the Palette dropdown: style picks mark treatment, palette picks
// colors; buildOptions stacks them (palette colors win by render precedence).
var styleBtnLabel = document.getElementById("style-btn-label");
var styleDropdownBtn = document.getElementById("style-dropdown-btn");
var styleMenu = document.getElementById("style-dropdown-menu");

function updateStyleButton() {
  var key = state.style || "crisp";
  styleBtnLabel.textContent =
    styleDropdownBtn.getAttribute("data-label-" + key) || key;
  styleMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
    var active = (item.dataset.style || "crisp") === key;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
    item.tabIndex = styleMenu.classList.contains("open") && active ? 0 : -1;
  });
}

function setStyle(key) {
  state.style = key || "crisp";
  if (state.style !== "crisp") {
    localStorage.setItem("bm-editor-style", state.style);
  } else {
    localStorage.removeItem("bm-editor-style");
  }
  updateStyleButton();
  scheduleRender(0);
}

var styleMenuPopup = createListboxPopupController({
  popup: styleMenu,
  trigger: styleDropdownBtn,
  itemSelector: '.theme-dropdown-item',
  activeSelector: '.theme-dropdown-item.active',
  visualClose: true,
  contains: function(target) { return !!target.closest("#style-dropdown-wrap"); },
  onSelect: function(item) { setStyle(item.dataset.style || "crisp"); },
});

function setStyleMenuOpen(open, focusActive) {
  styleMenuPopup.setOpen(open, { focusFirst: !!focusActive });
}

styleMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
  var key = item.dataset.style || "crisp";
  styleDropdownBtn.setAttribute("data-label-" + key, item.textContent.trim());
});

var savedStyle = localStorage.getItem("bm-editor-style") || "";
if (savedStyle) state.style = savedStyle;
updateStyleButton();
setStyleMenuOpen(false, false);

// Load from URL hash or start on an on-brand default so the editor opens with
// the loop already working (a rendered diagram, verify results, and on-demand
// text outputs) instead of five empty states. The default is the product's own
// parse -> verify -> serialize loop.
var DEFAULT_SOURCE = [
  "flowchart TD",
  "  A[Parse source] --> B[Narrow intent]",
  "  B --> C[Mutate one node]",
  "  C --> D{Verify}",
  "  D -- ok --> E[Serialize]",
  "  D -- warnings --> B",
].join("\n");

// Draft restore notice: polite, transient, with an explicit way to discard.
var draftNotice = document.getElementById("draft-notice");
var draftDiscardBtn = document.getElementById("draft-discard-btn");
var draftPrivacyBtn = document.getElementById("draft-privacy-btn");
var draftNoticeTimer = null;

function hideDraftNotice() {
  if (draftNoticeTimer) clearTimeout(draftNoticeTimer);
  draftNoticeTimer = null;
  if (draftNotice) draftNotice.hidden = true;
}

function showDraftRestoredNotice() {
  if (!draftNotice) return;
  draftNotice.hidden = false;
  if (draftNoticeTimer) clearTimeout(draftNoticeTimer);
  draftNoticeTimer = setTimeout(hideDraftNotice, 8000);
}

function discardRestoredDraft() {
  if (typeof discardEditorDraft === "function") discardEditorDraft();
  hideDraftNotice();
  editor.value = DEFAULT_SOURCE;
  state.config = {};
  setEditorErrorLine(0);
  refreshAllColorUIs();
  updateLineNumbers();
  updateCursorPos();
  scheduleRender(0);
  showToast("Draft discarded.");
}

if (draftDiscardBtn) draftDiscardBtn.addEventListener("click", discardRestoredDraft);
if (draftPrivacyBtn) draftPrivacyBtn.addEventListener("click", function() {
  if (typeof toggleDraftStorageMode === "function") toggleDraftStorageMode();
});
if (typeof updateDraftPrivacyControl === "function") updateDraftPrivacyControl();

function shouldOpenEmptyEditor() {
  try {
    var value = new URLSearchParams(window.location.search).get('empty');
    return value === '1' || value === 'true';
  } catch(e) { return false; }
}

// getHashSource decodes compressed share links asynchronously, so the initial
// source pick runs in an async IIFE; nothing below in this file depends on it.
(async function initializeEditorSource() {
  var hashSource = await getHashSource();
  // A share link that exists but cannot be decoded must say so — silently
  // showing the recipient their old draft or the default diagram would let
  // them believe they are looking at what was shared.
  if (!hashSource && typeof hashDecodeFailure === 'string' && hashDecodeFailure && typeof showToast === 'function') {
    showToast(hashDecodeFailure === 'unsupported'
      ? 'This share link needs a newer browser to open (missing DecompressionStream). Nothing was loaded.'
      : hashDecodeFailure === 'too-large'
        ? 'This share link is too large to open safely. Nothing was loaded.'
        : 'This share link could not be decoded (truncated or damaged). Nothing was loaded.');
  }
  var queryExampleId = getQueryExampleId();
  var queryEmptyEditor = shouldOpenEmptyEditor();
  var loadedInitialExample = false;
  if (hashSource) {
    editor.value = hashSource;
    applyThemeToPage(state.theme);
    updateThemeButton();
    updateStyleButton();
    if (typeof hydrateConfigControls === 'function') hydrateConfigControls(state.config);
    else refreshAllColorUIs();
  } else if (hashDecodeFailure) {
    // Fail closed: a broken shared URL must never be replaced by a local draft,
    // query example, or plausible-looking default.  Clear the unopenable URL so
    // the next edit starts a new share state rather than retrying it.
    editor.value = '';
    state.config = {};
    if (typeof hydrateConfigControls === 'function') hydrateConfigControls(state.config);
    else refreshAllColorUIs();
    window.history.replaceState(null, '', window.location.pathname);
  } else if (queryExampleId && typeof loadEditorExample === 'function' && findEditorExample(queryExampleId)) {
    loadEditorExample(queryExampleId);
    loadedInitialExample = true;
  } else if (queryEmptyEditor) {
    editor.value = '';
    state.config = {};
    if (typeof hydrateConfigControls === 'function') hydrateConfigControls(state.config);
    else refreshAllColorUIs();
  } else {
    // No shared source or explicit blank-start request in the URL: restore the autosaved draft if one exists.
    var draft = typeof readEditorDraft === 'function' ? readEditorDraft() : null;
    if (draft) {
      editor.value = draft.source;
      if (hasOwnConfig(draft.config)) state.config = sanitizeEditorConfig(draft.config);
      var draftStyle = sanitizeEditorStyle(draft.style);
      if (draftStyle) state.style = draftStyle;
      if (typeof draft.seed === 'number') state.seed = draft.seed;
      updateStyleButton();
      if (typeof hydrateConfigControls === 'function') hydrateConfigControls(state.config);
      else refreshAllColorUIs();
      showDraftRestoredNotice();
      // A restored draft means a returning editor: on mobile, put Source (and
      // the draft notice) back on screen instead of the first-run Preview.
      if (typeof setMobilePanel === 'function' && document.body.dataset.mobilePanel === 'preview') {
        setMobilePanel('code');
      }
    } else {
      editor.value = DEFAULT_SOURCE;
      if (typeof draftRestoreFailure === 'string' && draftRestoreFailure && typeof showToast === 'function') {
        showToast(draftRestoreFailure === 'too-large'
          ? 'A saved draft was too large to restore safely and was cleared.'
          : 'A saved draft was corrupt and was cleared.');
      }
    }
  }

  if (!loadedInitialExample) {
    updateLineNumbers();
    scheduleRender(0);
  }
})();
