var cfgColors = { bg: '', fg: '', accent: '', line: '', muted: '', surface: '' };
var cfgFont = '';
var cfgPadding = 24;

var COLOR_PRESETS = [
  '#ffffff','#f5f5f5','#e0e0e0','#bdbdbd','#9e9e9e','#757575','#424242','#212121','#000000',
  '#f44336','#e91e63','#ff4081','#ff1744','#d50000',
  '#9c27b0','#673ab7','#3f51b5','#7c4dff','#aa00ff',
  '#2196f3','#03a9f4','#00bcd4','#1565c0','#2979ff','#0091ea',
  '#4caf50','#8bc34a','#009688','#00e676','#1b5e20',
  '#ffeb3b','#ffc107','#ff9800','#ff5722','#ff6d00',
  '#0f1117','#161b22','#1c2128','#0d1117','#1a1a2e','#16213e',
];

function readConfig() {
  // Preserve non-control render options restored from examples/share links
  // (notably Style + Palette stacks and xychart interactivity) while the
  // settings form owns only the visible color/font/layout fields.
  var cfg = Object.assign({}, state.config || {});
  Object.keys(cfgColors).forEach(function(key) {
    if (cfgColors[key]) cfg[key] = cfgColors[key];
    else delete cfg[key];
  });
  if (cfgFont) cfg.font = cfgFont;
  else delete cfg.font;
  if (cfgPadding !== 24) cfg.padding = cfgPadding;
  else delete cfg.padding;
  if (cfgEdgeStroke !== 1) cfg.editorEdgeStroke = cfgEdgeStroke;
  else delete cfg.editorEdgeStroke;
  if (cfgNodeStroke !== 1) cfg.editorNodeStroke = cfgNodeStroke;
  else delete cfg.editorNodeStroke;
  state.config = cfg;
  // Per-diagram config rides along in the autosaved draft and share URL.
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
  if (typeof updateHash === 'function') updateHash();
}

var THEME_COLOR_MAP = { bg: 'bg', fg: 'fg', accent: 'accent', line: 'line', muted: 'muted', surface: 'surface' };

function getThemeColor(key) {
  if (!state.theme || !THEMES[state.theme]) return null;
  return THEMES[state.theme][THEME_COLOR_MAP[key]] || null;
}

function updateColorUI(key) {
  var override = cfgColors[key];
  var themeVal = getThemeColor(key);
  var effective = override || themeVal;
  var label  = document.getElementById('cfg-' + key + '-label');
  var swatch = document.getElementById('cfg-' + key + '-swatch');
  var btn    = document.querySelector('.color-edit-btn[data-cfg="' + key + '"]');

  if (label) {
    label.textContent = override || (themeVal ? themeVal : '–');
    // Theme-inherited values read as secondary via italics plus a light fade,
    // but stay WCAG AA: 0.85 opacity on --fg2 over --control-bg is 5.1:1 on
    // the light chrome and 7.0:1 on the dark one (0.45 dimmed to ~2.1:1).
    label.style.opacity = override ? '1' : '0.85';
    label.style.fontStyle = override ? 'normal' : 'italic';
  }
  if (swatch) {
    swatch.style.background = effective || 'transparent';
    swatch.style.border = effective ? '1px solid rgba(0,0,0,0.15)' : '1px dashed var(--fg3)';
    swatch.style.opacity = override ? '1' : (themeVal ? '0.6' : '1');
  }
  if (btn) {
    var labelText = key.charAt(0).toUpperCase() + key.slice(1);
    btn.title = override ? 'Override: ' + override : (themeVal ? 'Theme default: ' + themeVal : 'Not set');
    btn.setAttribute('aria-label', 'Edit ' + labelText + ' color' + (effective ? ': ' + effective : ''));
  }
}

function refreshAllColorUIs() {
  Object.keys(cfgColors).forEach(function(k) { updateColorUI(k); });
}

function fontLabelForValue(value) {
  if (!value) return 'Default';
  var presets = typeof PRESET_FONTS !== 'undefined' ? PRESET_FONTS : [];
  for (var i = 0; i < presets.length; i++) if (presets[i].value === value) return presets[i].name;
  return value;
}

function clampStroke(raw) {
  var v = Math.max(0.25, Math.min(6, parseFloat(raw) || 1));
  return Math.round(v * 4) / 4;
}

function hydrateConfigControls(config) {
  config = (config && typeof config === 'object') ? config : {};
  Object.keys(cfgColors).forEach(function(key) {
    cfgColors[key] = typeof config[key] === 'string' ? config[key] : '';
  });
  cfgFont = typeof config.font === 'string' ? config.font : '';
  var parsedPadding = parseInt(config.padding, 10);
  cfgPadding = Number.isFinite(parsedPadding) ? Math.max(0, Math.min(120, parsedPadding)) : 24;
  cfgEdgeStroke = clampStroke(config.editorEdgeStroke);
  cfgNodeStroke = clampStroke(config.editorNodeStroke);
  if (typeof fontSelectLabel !== 'undefined' && fontSelectLabel) fontSelectLabel.textContent = fontLabelForValue(cfgFont);
  if (typeof paddingNum !== 'undefined' && paddingNum) paddingNum.value = cfgPadding;
  if (typeof paddingSlider !== 'undefined' && paddingSlider) paddingSlider.value = cfgPadding;
  if (typeof edgeStrokeNum !== 'undefined' && edgeStrokeNum) edgeStrokeNum.value = cfgEdgeStroke;
  if (typeof edgeStrokeSlider !== 'undefined' && edgeStrokeSlider) edgeStrokeSlider.value = cfgEdgeStroke;
  if (typeof nodeStrokeNum !== 'undefined' && nodeStrokeNum) nodeStrokeNum.value = cfgNodeStroke;
  if (typeof nodeStrokeSlider !== 'undefined' && nodeStrokeSlider) nodeStrokeSlider.value = cfgNodeStroke;
  refreshAllColorUIs();
}

refreshAllColorUIs();

var cfgEdgeStroke = 1;
var cfgNodeStroke = 1;

function applyStrokeOverrides(svgEl) {
  if (!svgEl) return;
  var defsEl = svgEl.querySelector('defs');

  function inDefs(el) {
    return defsEl && defsEl.contains(el);
  }

  if (cfgEdgeStroke !== 1) {
    var ew = String(cfgEdgeStroke);
    svgEl.querySelectorAll('line, path[fill="none"], polyline[fill="none"]').forEach(function(el) {
      if (!inDefs(el)) el.setAttribute('stroke-width', ew);
    });
    var arrowFactor = Math.sqrt(cfgEdgeStroke);
    svgEl.querySelectorAll('defs marker').forEach(function(marker) {
      var origW = parseFloat(marker.getAttribute('markerWidth')  || '8');
      var origH = parseFloat(marker.getAttribute('markerHeight') || '5');
      marker.setAttribute('viewBox', '0 0 ' + origW + ' ' + origH);
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth',  String(origW * arrowFactor));
      marker.setAttribute('markerHeight', String(origH * arrowFactor));
    });
  }

  if (cfgNodeStroke !== 1) {
    var nw = String(cfgNodeStroke);
    svgEl.querySelectorAll('rect, ellipse, circle, polygon').forEach(function(el) {
      if (!inDefs(el)) el.setAttribute('stroke-width', nw);
    });
  }
}

function makeStrokeSetter(numEl, sliderEl, getVal, setVal) {
  return function(raw) {
    var v = clampStroke(raw);
    setVal(v);
    numEl.value    = v;
    sliderEl.value = v;
    readConfig();
    var svgEl = previewInner.querySelector('svg');
    if (svgEl) applyStrokeOverrides(svgEl);
  };
}

var edgeStrokeNum    = document.getElementById('cfg-edge-stroke');
var edgeStrokeSlider = document.getElementById('cfg-edge-stroke-slider');
var nodeStrokeNum    = document.getElementById('cfg-node-stroke');
var nodeStrokeSlider = document.getElementById('cfg-node-stroke-slider');

var setEdgeStroke = makeStrokeSetter(edgeStrokeNum, edgeStrokeSlider,
  function() { return cfgEdgeStroke; },
  function(v) { cfgEdgeStroke = v; }
);
var setNodeStroke = makeStrokeSetter(nodeStrokeNum, nodeStrokeSlider,
  function() { return cfgNodeStroke; },
  function(v) { cfgNodeStroke = v; }
);

edgeStrokeNum.addEventListener('input',    function() { setEdgeStroke(edgeStrokeNum.value); });
edgeStrokeSlider.addEventListener('input', function() { setEdgeStroke(edgeStrokeSlider.value); });
nodeStrokeNum.addEventListener('input',    function() { setNodeStroke(nodeStrokeNum.value); });
nodeStrokeSlider.addEventListener('input', function() { setNodeStroke(nodeStrokeSlider.value); });

// Clear every override (colors, font, padding, strokes) back to the active
// theme's defaults. setPadding / fontSelectLabel live in font-picker.js, which
// loads later but shares scope; this only runs on click, by which point they
// are defined.
function resetConfig() {
  state.config = {};
  hydrateConfigControls(state.config);
  readConfig();
  if (typeof scheduleRender === 'function') scheduleRender(0);
  if (typeof showToast === 'function') showToast('Style reset to theme.');
}

var configResetBtn = document.getElementById('config-reset-btn');
if (configResetBtn) configResetBtn.addEventListener('click', resetConfig);

// Settings popover: use the same anchored panel grammar as Examples. It still
// brings Source forward on mobile because the config DOM lives in the left panel,
// but visually it is a topbar popover, not a separate mode.
var settingsBtn = document.getElementById('settings-btn');
var settingsCloseBtn = document.getElementById('settings-close-btn');
function positionSettingsPanel() {
  if (!configView || !settingsBtn) return;
  var rect = settingsBtn.getBoundingClientRect();
  var gutter = 12;
  var preferred = 360;
  var width = Math.min(preferred, window.innerWidth - gutter * 2);
  var left = Math.min(Math.max(gutter, rect.left), window.innerWidth - width - gutter);
  var top = rect.bottom + 8;
  var maxHeight = Math.max(260, window.innerHeight - top - gutter);
  configView.style.setProperty('--settings-left', Math.round(left) + 'px');
  configView.style.setProperty('--settings-top', Math.round(top) + 'px');
  configView.style.setProperty('--settings-width', Math.round(width) + 'px');
  configView.style.setProperty('--settings-max-height', Math.round(maxHeight) + 'px');
}

var settingsPopup = (settingsBtn && configView && typeof createPopupController === 'function')
  ? createPopupController({
      popup: configView,
      trigger: settingsBtn,
      className: 'visible',
      visibility: { manageTabStops: true, toggleTriggerClass: false },
      closeOnEscape: false,
      beforeOpen: function(meta) {
        // On mobile the source panel may be hidden (Preview view); the settings
        // DOM lives in it, so bring it forward before showing the fixed popover.
        if (typeof setMobilePanel === 'function') setMobilePanel('code');
        configView.hidden = false;
        positionSettingsPanel();
        refreshAllColorUIs();
      },
      afterOpen: function(meta) {
        settingsBtn.classList.add('active');
        settingsBtn.setAttribute('aria-pressed', 'true');
        if (meta && meta.focusFirst) {
          var first = configView.querySelector('button, input, [href], [tabindex]:not([tabindex="-1"])');
          if (first) first.focus({ preventScroll: false });
        }
      },
      afterClose: function() {
        settingsBtn.classList.remove('active');
        settingsBtn.setAttribute('aria-pressed', 'false');
        configView.hidden = true;
      },
      contains: function(target) {
        return !!(target.closest('#config-view') || target.closest('#settings-btn') || target.closest('#font-popup') || target.closest('#color-popup'));
      },
      repositionOnResize: true,
      position: positionSettingsPanel,
    })
  : { setOpen: function() {}, close: function() {}, isOpen: function() { return false; } };
function setSettingsOpen(open, meta) {
  settingsPopup.setOpen(open, meta || {});
}
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', function() { setSettingsOpen(false, { restoreFocus: true }); });
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape' || !configView || configView.hidden) return;
  // A picker popup inside settings (font / colour) owns Escape while it is open,
  // so let it close and restore its own focus before settings reacts.
  if (document.querySelector('#font-popup:not([inert]), #color-popup:not([inert])')) return;
  setSettingsOpen(false, { restoreFocus: true });
});
setSettingsOpen(false);
