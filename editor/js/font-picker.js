var PRESET_FONTS = (typeof EDITOR_PRESET_FONTS !== 'undefined' && Array.isArray(EDITOR_PRESET_FONTS))
  ? EDITOR_PRESET_FONTS
  : [
    { name: 'System UI', value: 'system-ui', group: 'System' },
    { name: 'Arial', value: 'Arial', group: 'System' },
    { name: 'Georgia', value: 'Georgia', group: 'System' },
    { name: 'Courier New', value: 'Courier New', group: 'System' },
  ];

var fontPopup     = document.getElementById('font-popup');
var fontSearch    = document.getElementById('font-search');
var fontList      = document.getElementById('font-list');
var fontSelectBtn = document.getElementById('font-select-btn');
var fontSelectLabel = document.getElementById('font-select-label');

function buildFontList(query) {
  var q = (query || '').toLowerCase();
  var filtered = PRESET_FONTS.filter(function(f) {
    return !q || f.name.toLowerCase().includes(q) || f.value.toLowerCase().includes(q);
  });

  var groups = {};
  filtered.forEach(function(f) {
    if (!groups[f.group]) groups[f.group] = [];
    groups[f.group].push(f);
  });

  fontList.innerHTML = '';

  var browserFonts = [];
  try {
    document.fonts.forEach(function(ff) {
      var n = ff.family.replace(/['"]/g, '');
      if (!q || n.toLowerCase().includes(q)) browserFonts.push(n);
    });
    browserFonts = [...new Set(browserFonts)].sort();
  } catch(e) {}

  Object.keys(groups).forEach(function(group) {
    var label = document.createElement('div');
    label.className = 'font-section-label';
    label.textContent = group;
    fontList.appendChild(label);
    groups[group].forEach(function(f) { appendFontItem(f.name, f.value); });
  });

  if (browserFonts.length) {
    var label = document.createElement('div');
    label.className = 'font-section-label';
    label.textContent = 'Loaded in browser';
    fontList.appendChild(label);
    browserFonts.forEach(function(name) {
      appendFontItem(name, name);
    });
  }
}

function appendFontItem(name, value) {
  var item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', cfgFont === value ? 'true' : 'false');
  item.className = 'font-item' + (cfgFont === value ? ' active' : '');
  var previewSpan = document.createElement('span');
  previewSpan.className = 'font-item-preview';
  previewSpan.style.fontFamily = value + ', sans-serif';
  previewSpan.textContent = 'Aa';
  var nameSpan = document.createElement('span');
  nameSpan.className = 'font-item-name';
  nameSpan.textContent = name;
  item.appendChild(previewSpan);
  item.appendChild(nameSpan);
  item.addEventListener('click', function() {
    cfgFont = value;
    fontSelectLabel.textContent = name;
    closeFontPopup();
    readConfig();
    scheduleRender(0);
    fontSelectBtn.focus();
  });
  fontList.appendChild(item);
}

var fontPopupController = createPopupController({
  popup: fontPopup,
  trigger: fontSelectBtn,
  closePeersOnOpen: false,
  visualClose: true,
  visibility: { focusSelector: '#font-search' },
  beforeOpen: function() {
    // The colour picker is the one peer sharing the nested tier (both skip the
    // global peer-close so they don't dismiss the settings panel). Close it
    // here, or the two pickers contest the same z-index and DOM order decides
    // which paints on top — not the one that was opened last and holds focus.
    if (typeof closeColorPopup === 'function') closeColorPopup(false);
    buildFontList('');
    fontSearch.value = '';
    positionAnchoredPopup(fontPopup, fontSelectBtn, { width: 220, height: 320 });
  },
  contains: function(target) {
    return !!(target.closest('#font-popup') || target.closest('#font-select-btn'));
  },
  repositionOnResize: true,
  position: function() { positionAnchoredPopup(fontPopup, fontSelectBtn, { width: 220, height: 320 }); },
});

function openFontPopup() {
  fontPopupController.open({ focusFirst: true });
}

function closeFontPopup(restoreFocus) {
  fontPopupController.close({ restoreFocus: !!restoreFocus });
}

fontSearch.addEventListener('input', function() {
  buildFontList(fontSearch.value);
});

var paddingNum    = document.getElementById('cfg-padding');
var paddingSlider = document.getElementById('cfg-padding-slider');

function setPadding(val) {
  val = Math.max(0, Math.min(120, parseInt(val, 10) || 0));
  cfgPadding = val;
  paddingNum.value    = val;
  paddingSlider.value = val;
  readConfig();
  scheduleRender(200);
}

paddingNum.addEventListener('input', function() { setPadding(paddingNum.value); });
paddingSlider.addEventListener('input', function() { setPadding(paddingSlider.value); });
