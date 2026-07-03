// A stored choice wins; with no stored preference the editor follows the OS
// (and keeps following it until the user toggles explicitly).
var darkSchemeQuery = window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;
var storedColorMode = localStorage.getItem("bm-editor-dark");
var isDark = storedColorMode === null
  ? !!(darkSchemeQuery && darkSchemeQuery.matches)
  : storedColorMode === "true";

var diagramThemeIsAuto = true;

function applyColorMode(dark, force) {
  isDark = dark;
  var darkLightBtn = document.getElementById("dark-light-btn");
  if (darkLightBtn) {
    darkLightBtn.classList.toggle("is-dark", dark);
    darkLightBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  // Persist only explicit choices so a system-derived default keeps tracking
  // prefers-color-scheme instead of freezing on first load.
  if (force) localStorage.setItem("bm-editor-dark", dark ? "true" : "false");

  // Page chrome follows the Kiln brand (Stone/Charcoal + Pine). The diagram theme
  // is controlled separately by the dropdown so color mode does not silently
  // rewrite diagrams.
  applyThemeToPage(state.theme);
  // These may not exist yet during initial load – guarded calls
  if (typeof updateThemeButton === "function") updateThemeButton();
  if (typeof refreshAllColorUIs === "function") refreshAllColorUIs();
  if (typeof scheduleRender === "function") scheduleRender(0);
}

document
  .getElementById("dark-light-btn")
  .addEventListener("click", function () {
    applyColorMode(!isDark, true);
  });

if (darkSchemeQuery && typeof darkSchemeQuery.addEventListener === "function") {
  darkSchemeQuery.addEventListener("change", function (e) {
    if (localStorage.getItem("bm-editor-dark") === null) applyColorMode(e.matches);
  });
}
