var selectedExampleId = '';

function cloneEditorConfig(config) {
  return config ? JSON.parse(JSON.stringify(config)) : {};
}

function findEditorExample(id) {
  for (var i = 0; i < EDITOR_EXAMPLES.length; i++) {
    if (EDITOR_EXAMPLES[i].id === id) return EDITOR_EXAMPLES[i];
  }
  return null;
}

function exampleGroups() {
  var groups = [];
  var groupMap = {};
  EDITOR_EXAMPLES.forEach(function(example) {
    var category = example.category || 'Examples';
    if (!groupMap[category]) {
      groupMap[category] = { category: category, examples: [] };
      groups.push(groupMap[category]);
    }
    groupMap[category].examples.push(example);
  });
  return groups;
}

function exampleGlyph(example) {
  var type = example.diagramType || 'Example';
  var glyphs = {
    Flowchart: 'F',
    State: 'S',
    Architecture: 'A',
    Sequence: 'Q',
    Class: 'C',
    ER: 'ER',
    Timeline: 'T',
    Journey: 'J',
    'XY Chart': 'XY',
    Pie: 'P',
    Quadrant: '4Q',
    Gantt: 'G',
  };
  return glyphs[type] || type.slice(0, 2).toUpperCase();
}

function renderExamplePaletteHtml() {
  var examplesHtml = exampleGroups().map(function(group) {
    return '<section class="example-category">'
      + '<div class="example-category-title">' + escHtml(group.category) + '</div>'
      + '<div class="example-category-grid">'
      + group.examples.map(function(example) {
        return '<button class="example-dropdown-item" type="button" role="menuitem" data-example="' + escAttr(example.id) + '" data-diagram="' + escAttr(example.diagramType || '') + '" title="' + escAttr(example.description || example.label) + '">'
          + '<span class="example-item-title"><span class="example-item-glyph" aria-hidden="true">' + escHtml(exampleGlyph(example)) + '</span>' + escHtml(example.label) + '</span>'
          + '<span class="example-item-description">' + escHtml(example.description || '') + '</span>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }).join('');

  return examplesHtml
    + '<div class="example-menu-footer">'
    + '<button class="example-clear-btn" type="button" data-action="clear-editor">New blank diagram</button>'
    + '</div>';
}

function renderExamplePalettes() {
  if (examplesSidebarList) examplesSidebarList.innerHTML = renderExamplePaletteHtml();
}

function markActiveExample(id) {
  selectedExampleId = id || '';
  document.querySelectorAll('.example-dropdown-item').forEach(function(item) {
    item.classList.toggle('active', item.dataset.example === selectedExampleId);
  });
}

function loadEditorExample(id) {
  var example = findEditorExample(id);
  if (!example) return;

  editor.value = example.source.trim();
  state.config = cloneEditorConfig(example.options);
  if (typeof hydrateConfigControls === 'function') hydrateConfigControls(state.config);
  markActiveExample(example.id);
  if (typeof setEditorErrorLine === 'function') setEditorErrorLine(0);
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();

  // Examples are source/config presets only; keep the user's selected theme.
  if (typeof applyThemeToPage === 'function') applyThemeToPage(state.theme);
  if (typeof updateThemeButton === 'function') updateThemeButton();

  updateLineNumbers();
  updateCursorPos();
  scheduleRender(0);
  updateHash();
  showToast('Loaded ' + example.label + '.');
}

var examplesSidebar = document.getElementById('examples-sidebar');
var examplesSidebarBtn = document.getElementById('examples-sidebar-btn');
var examplesSidebarClose = document.getElementById('examples-sidebar-close');
var examplesSidebarList = document.getElementById('examples-sidebar-list');

function positionExamplesSidebar() {
  if (!examplesSidebar || !examplesSidebarBtn) return;
  var rect = examplesSidebarBtn.getBoundingClientRect();
  var gutter = 12;
  var preferred = 360;
  var width = Math.min(preferred, window.innerWidth - gutter * 2);
  var left = Math.min(Math.max(gutter, rect.left), window.innerWidth - width - gutter);
  var top = rect.bottom + 8;
  var maxHeight = Math.max(260, window.innerHeight - top - gutter);
  examplesSidebar.style.setProperty('--examples-left', Math.round(left) + 'px');
  examplesSidebar.style.setProperty('--examples-top', Math.round(top) + 'px');
  examplesSidebar.style.setProperty('--examples-width', Math.round(width) + 'px');
  examplesSidebar.style.setProperty('--examples-max-height', Math.round(maxHeight) + 'px');
}

var examplesPopup = typeof createPopupController === 'function' ? createPopupController({
  popup: examplesSidebar,
  trigger: examplesSidebarBtn,
  visibility: { manageTabStops: true, toggleTriggerClass: false },
  beforeOpen: positionExamplesSidebar,
  afterOpen: function(meta) {
    if (examplesSidebarBtn) {
      examplesSidebarBtn.classList.add('active');
      examplesSidebarBtn.setAttribute('aria-pressed', 'true');
    }
    if (meta && meta.focusFirst && examplesSidebarList) {
      var activeItem = examplesSidebarList.querySelector('.example-dropdown-item.active') || examplesSidebarList.querySelector('.example-dropdown-item');
      if (activeItem) activeItem.focus({ preventScroll: false });
    }
  },
  afterClose: function() {
    if (examplesSidebarBtn) {
      examplesSidebarBtn.classList.remove('active');
      examplesSidebarBtn.setAttribute('aria-pressed', 'false');
    }
  },
  contains: function(target) {
    return !!(target.closest('#examples-sidebar') || target.closest('#examples-sidebar-btn'));
  },
  repositionOnResize: true,
  position: positionExamplesSidebar,
}) : { setOpen: function() {} };

function setExamplesSidebarOpen(open, meta) {
  examplesPopup.setOpen(open, meta || {});
}

function openExamplesSidebar() {
  setExamplesSidebarOpen(true, { focusFirst: true });
}

renderExamplePalettes();
setExamplesSidebarOpen(false);

if (examplesSidebarClose) {
  examplesSidebarClose.addEventListener('click', function() {
    setExamplesSidebarOpen(false, { restoreFocus: true });
  });
}

if (examplesSidebarList) {
  examplesSidebarList.addEventListener('click', function(e) {
    var item = e.target.closest('.example-dropdown-item');
    if (!item) return;
    loadEditorExample(item.dataset.example || '');
    setExamplesSidebarOpen(false);
  });
}

document.addEventListener('click', function(e) {
  var starter = e.target.closest('.placeholder-chip[data-example]');
  if (starter) {
    loadEditorExample(starter.dataset.example || '');
    return;
  }
  if (e.target.closest('[data-action="load-example"]')) {
    openExamplesSidebar();
    return;
  }
});
