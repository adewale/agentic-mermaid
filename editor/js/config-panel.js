var cfgColors = { bg: '', fg: '', accent: '', line: '', muted: '', surface: '' };
var cfgFont = '';
var cfgPadding = 24;
var advancedOptionsInput = document.getElementById('cfg-advanced-options');
var advancedOptionsApply = document.getElementById('cfg-advanced-apply');
var advancedOptionsSchema = document.getElementById('cfg-advanced-schema');
var advancedOptionsStatus = document.getElementById('cfg-advanced-status');

function canonicalAdvancedSchema() {
  var schema = window.__mermaid && window.__mermaid.SHARED_RENDER_OPTIONS_JSON_SCHEMA;
  return schema && schema.properties && typeof schema.properties === 'object' ? schema : { properties: {} };
}

function setAdvancedOptionsStatus(message, kind) {
  if (!advancedOptionsStatus) return;
  advancedOptionsStatus.textContent = message || '';
  advancedOptionsStatus.classList.toggle('is-error', kind === 'error');
  advancedOptionsStatus.classList.toggle('is-ok', kind === 'ok');
}

function syncAdvancedOptionsEditor(config) {
  if (!advancedOptionsInput) return;
  advancedOptionsInput.value = JSON.stringify(config || {}, null, 2);
  advancedOptionsInput.setAttribute('aria-invalid', 'false');
}

function applyAdvancedOptionsJson() {
  if (!advancedOptionsInput) return false;
  var parsed;
  try {
    parsed = JSON.parse(advancedOptionsInput.value || '{}');
  } catch (error) {
    advancedOptionsInput.setAttribute('aria-invalid', 'true');
    setAdvancedOptionsStatus('Invalid JSON: ' + (error && error.message ? error.message : String(error)), 'error');
    return false;
  }
  var validator = window.__mermaid && window.__mermaid.validateSerializableRenderOptions;
  var problems = typeof validator === 'function' ? validator(parsed) : ['Canonical RenderOptions validator is unavailable.'];
  if (problems.length) {
    advancedOptionsInput.setAttribute('aria-invalid', 'true');
    setAdvancedOptionsStatus(problems.join('; '), 'error');
    return false;
  }
  state.config = parsed;
  hydrateConfigControls(state.config);
  readConfig();
  if (typeof scheduleRender === 'function') scheduleRender(0);
  setAdvancedOptionsStatus('Applied ' + Object.keys(parsed).length + ' canonical option' + (Object.keys(parsed).length === 1 ? '' : 's') + '.', 'ok');
  return true;
}

(function initializeAdvancedOptionsSchema() {
  var fields = Object.keys(canonicalAdvancedSchema().properties);
  if (advancedOptionsSchema) {
    advancedOptionsSchema.textContent = fields.length + ' canonical fields: ' + fields.join(', ');
    advancedOptionsSchema.title = fields.join(', ');
  }
  if (advancedOptionsApply) advancedOptionsApply.addEventListener('click', applyAdvancedOptionsJson);
})();

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
  state.config = cfg;
  syncAdvancedOptionsEditor(state.config);
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

function hydrateConfigControls(config) {
  config = (config && typeof config === 'object') ? config : {};
  Object.keys(cfgColors).forEach(function(key) {
    cfgColors[key] = typeof config[key] === 'string' ? config[key] : '';
  });
  cfgFont = typeof config.font === 'string' ? config.font : '';
  var parsedPadding = Number(config.padding);
  cfgPadding = Number.isFinite(parsedPadding) ? parsedPadding : 24;
  if (typeof fontSelectLabel !== 'undefined' && fontSelectLabel) fontSelectLabel.textContent = fontLabelForValue(cfgFont);
  if (typeof paddingNum !== 'undefined' && paddingNum) paddingNum.value = cfgPadding;
  if (typeof paddingSlider !== 'undefined' && paddingSlider) paddingSlider.value = cfgPadding;
  refreshAllColorUIs();
  syncAdvancedOptionsEditor(config);
}

refreshAllColorUIs();

// Clear every override (colors, font, padding) back to the active
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
