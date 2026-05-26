var isDark = localStorage.getItem("bm-editor-dark") === "true";

var AUTO_DARK_DIAGRAM_THEME = "salmon-dark";
var AUTO_LIGHT_DIAGRAM_THEME = DEFAULT_EDITOR_THEME;

var diagramThemeIsAuto = true;

function applyColorMode(dark, force) {
  isDark = dark;
  var darkLightBtn = document.getElementById("dark-light-btn");
  if (darkLightBtn) {
    darkLightBtn.classList.toggle("is-dark", dark);
    darkLightBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  localStorage.setItem("bm-editor-dark", dark ? "true" : "false");

  if (diagramThemeIsAuto || force) {
    var autoTheme = dark ? AUTO_DARK_DIAGRAM_THEME : AUTO_LIGHT_DIAGRAM_THEME;
    state.theme = autoTheme;
    diagramThemeIsAuto = true;
  }
  // Update all page colors via :root inline styles
  applyThemeToPage(state.theme);
  // These may not exist yet during initial load — guarded calls
  if (typeof updateThemeButton === "function") updateThemeButton();
  if (typeof refreshAllColorUIs === "function") refreshAllColorUIs();
  if (typeof scheduleRender === "function") scheduleRender(0);
}

document
  .getElementById("dark-light-btn")
  .addEventListener("click", function () {
    applyColorMode(!isDark, true);
  });
