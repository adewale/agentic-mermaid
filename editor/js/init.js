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

var themeMenuPopup = createPopupController({
  popup: themeMenu,
  trigger: themeDropdownBtn,
  visibility: { manageTabStops: false },
  afterOpen: function(meta) {
    syncThemeMenuTabStops(true);
    if (meta && meta.focusFirst) {
      var active = themeMenu.querySelector(".theme-dropdown-item.active") || themeMenu.querySelector(".theme-dropdown-item");
      if (active) active.focus();
    }
  },
  afterClose: function() { syncThemeMenuTabStops(false); },
  contains: function(target) { return !!target.closest("#theme-dropdown-wrap"); },
});

function syncThemeMenuTabStops(open) {
  themeMenu.querySelectorAll(".theme-dropdown-item").forEach(function(item) {
    var active = item.classList.contains("active");
    item.tabIndex = open && active ? 0 : -1;
  });
}

function setThemeMenuOpen(open, focusActive) {
  themeMenuPopup.setOpen(open, { focusFirst: !!focusActive });
}

// Click item
themeMenu.addEventListener("click", function (e) {
  var item = e.target.closest(".theme-dropdown-item");
  if (!item) return;
  setTheme(item.dataset.theme || "");
  setThemeMenuOpen(false, false);
  themeDropdownBtn.focus();
});

themeMenu.addEventListener("keydown", function(e) {
  var items = Array.prototype.slice.call(themeMenu.querySelectorAll(".theme-dropdown-item"));
  var current = document.activeElement && document.activeElement.classList.contains("theme-dropdown-item") ? document.activeElement : null;
  var index = Math.max(0, items.indexOf(current));
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    var next = index;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else next = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].tabIndex = 0;
    items[next].focus();
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (current) current.click();
  }
});

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

var hashSource = getHashSource();
var queryExampleId = getQueryExampleId();
var loadedInitialExample = false;
if (hashSource) {
  editor.value = hashSource;
  applyThemeToPage(state.theme);
  updateThemeButton();
  refreshAllColorUIs();
} else if (queryExampleId && typeof loadEditorExample === 'function' && findEditorExample(queryExampleId)) {
  loadEditorExample(queryExampleId);
  loadedInitialExample = true;
} else {
  editor.value = DEFAULT_SOURCE;
}

if (!loadedInitialExample) {
  updateLineNumbers();
  scheduleRender(0);
}
