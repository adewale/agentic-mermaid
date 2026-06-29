var isDark = localStorage.getItem("bm-editor-dark") === "true";

var diagramThemeIsAuto = true;

function applyColorMode(dark, force) {
  isDark = dark;
  var darkLightBtn = document.getElementById("dark-light-btn");
  if (darkLightBtn) {
    darkLightBtn.classList.toggle("is-dark", dark);
    darkLightBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  localStorage.setItem("bm-editor-dark", dark ? "true" : "false");

  // Page chrome follows the site Paper/Dusk palette. The diagram theme is controlled
  // separately by the dropdown so color mode does not silently rewrite diagrams.
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
