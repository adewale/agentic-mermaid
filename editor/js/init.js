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
    themeBtnSwatch.style.background = "";
    themeBtnSwatch.style.display = "none";
  }
  // Update active state in dropdown
  themeMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
    item.classList.toggle("active", item.dataset.theme === key);
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

// Toggle dropdown
themeDropdownBtn.addEventListener("click", function (e) {
  e.stopPropagation();
  var isOpen = themeMenu.classList.toggle("open");
  themeDropdownBtn.classList.toggle("open", isOpen);
});

// Click item
themeMenu.addEventListener("click", function (e) {
  var item = e.target.closest(".theme-dropdown-item");
  if (!item) return;
  setTheme(item.dataset.theme || "");
  themeMenu.classList.remove("open");
  themeDropdownBtn.classList.remove("open");
});

// Close on outside click
document.addEventListener("click", function (e) {
  if (!document.getElementById("theme-dropdown-wrap").contains(e.target)) {
    themeMenu.classList.remove("open");
    themeDropdownBtn.classList.remove("open");
  }
});

// Store label data for lookup
themeMenu.querySelectorAll(".theme-dropdown-item").forEach(function (item) {
  var key = item.dataset.theme || "";
  themeDropdownBtn.setAttribute("data-label-" + key, item.textContent.trim());
});

// Apply initial dark/light mode (must happen after all DOM refs + functions are ready)
applyColorMode(isDark);

// Restore saved theme
var savedTheme = localStorage.getItem("bm-editor-theme") || "";
if (savedTheme && THEMES[savedTheme]) {
  state.theme = savedTheme;
  diagramThemeIsAuto = false;
}
applyThemeToPage(state.theme);
updateThemeButton();

// Load from URL hash or use default
var DEFAULT_SOURCE =
  "graph TD\n  A[Start] --> B{Decision?}\n  B -->|Yes| C[Do the thing]\n  B -->|No| D[Skip it]\n  C --> E[End]\n  D --> E";

var hashSource = getHashSource();
if (hashSource) {
  editor.value = hashSource;
  applyThemeToPage(state.theme);
  updateThemeButton();
  refreshAllColorUIs();
} else {
  editor.value = DEFAULT_SOURCE;
}

updateLineNumbers();
scheduleRender(0);
