import { ui } from './context.js';
import { safeLocalStorageGet, safeLocalStorageSet } from './sharing.js';
import { applyThemeToPage, scheduleRender } from './rendering.js';
import { state } from './state.js';
import { updateThemeButton } from './init.js';
import { refreshAllColorUIs } from './config-panel.js';
export var darkSchemeQuery, storedColorMode, isDark;


export function applyColorMode(dark, force) {
  isDark = dark;
  var darkLightBtn = document.getElementById("dark-light-btn");
  if (darkLightBtn) {
    darkLightBtn.classList.toggle("is-dark", dark);
    darkLightBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  // Persist only explicit choices so a system-derived default keeps tracking
  // prefers-color-scheme instead of freezing on first load.
  if (force) safeLocalStorageSet("bm-editor-dark", dark ? "true" : "false");

  // Page chrome follows the Kiln brand (Stone/Charcoal + Pine). The diagram theme
  // is controlled separately by the dropdown so color mode does not silently
  // rewrite diagrams.
  applyThemeToPage(state.palette);
  // These may not exist yet during initial load – guarded calls
  if (typeof updateThemeButton === "function") updateThemeButton();
  if (typeof refreshAllColorUIs === "function") refreshAllColorUIs();
  if (typeof scheduleRender === "function") scheduleRender(0);
}

export function initialize() {
// A stored choice wins; with no stored preference the editor follows the OS
// (and keeps following it until the user toggles explicitly).
darkSchemeQuery = window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

storedColorMode = safeLocalStorageGet("bm-editor-dark");

isDark = storedColorMode === null
  ? !!(darkSchemeQuery && darkSchemeQuery.matches)
  : storedColorMode === "true";


ui.diagramThemeIsAuto = true;


document
  .getElementById("dark-light-btn")
  .addEventListener("click", function () {
    applyColorMode(!isDark, true);
  });


if (darkSchemeQuery && typeof darkSchemeQuery.addEventListener === "function") {
  darkSchemeQuery.addEventListener("change", function (e) {
    if (safeLocalStorageGet("bm-editor-dark") === null) applyColorMode(e.matches);
  });
}
}
