var isDark = localStorage.getItem("bm-editor-dark") === "true";
var iconMoon = document.getElementById("icon-moon");
var iconSun = document.getElementById("icon-sun");

var AUTO_DARK_DIAGRAM_THEME = "salmon-dark";
var AUTO_LIGHT_DIAGRAM_THEME = DEFAULT_EDITOR_THEME;

var diagramThemeIsAuto = true;

function applyColorMode(dark, force) {
  isDark = dark;
  // Toggle icon visibility
  if (dark) {
    iconMoon.style.display = "none";
    iconSun.style.display = "";
  } else {
    iconMoon.style.display = "";
    iconSun.style.display = "none";
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
