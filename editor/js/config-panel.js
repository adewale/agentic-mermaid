import { ui } from './context.js';
import { editorPaletteColors, state } from './state.js';
import { scheduleRender } from './rendering.js';
import { safeLocalStorageGet, safeLocalStorageSet, scheduleDraftSave, updateHash } from './sharing.js';
import { PRESET_FONTS, fontSelectLabel, paddingNum, paddingSlider } from './font-picker.js';
import { showToast } from './toast.js';
import { configView } from './elements.js';
import { createPopupController } from './helpers.js';
import { setMobilePanel } from './tabs.js';
export var cfgColors, advancedOptionsInput, advancedOptionsApply, advancedOptionsSchema, advancedOptionsStatus, COLOR_PRESETS, THEME_COLOR_MAP, configResetBtn, settingsBtn, settingsCloseBtn, settingsPopup;


export function canonicalAdvancedSchema() {
  var schema = window.__mermaid && window.__mermaid.SHARED_RENDER_OPTIONS_JSON_SCHEMA;
  return schema && schema.properties && typeof schema.properties === 'object' ? schema : { properties: {} };
}


export function setAdvancedOptionsStatus(message, kind) {
  if (!advancedOptionsStatus) return;
  advancedOptionsStatus.textContent = message || '';
  advancedOptionsStatus.classList.toggle('is-error', kind === 'error');
  advancedOptionsStatus.classList.toggle('is-ok', kind === 'ok');
}


export function syncAdvancedOptionsEditor(config) {
  if (!advancedOptionsInput) return;
  advancedOptionsInput.value = JSON.stringify(config || {}, null, 2);
  advancedOptionsInput.setAttribute('aria-invalid', 'false');
}


export function applyAdvancedOptionsJson() {
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


export function readConfig() {
  // Preserve non-control render options restored from examples/share links
  // (notably Style + Palette stacks and xychart interactivity) while the
  // settings form owns only the visible color/font/layout fields.
  var cfg = Object.assign({}, state.config || {});
  Object.keys(cfgColors).forEach(function(key) {
    if (cfgColors[key]) cfg[key] = cfgColors[key];
    else delete cfg[key];
  });
  if (ui.cfgFont) cfg.font = ui.cfgFont;
  else delete cfg.font;
  if (ui.cfgPadding !== 40) cfg.padding = ui.cfgPadding;
  else delete cfg.padding;
  state.config = cfg;
  syncAdvancedOptionsEditor(state.config);
  // Per-diagram config rides along in the autosaved draft and share URL.
  if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
  if (typeof updateHash === 'function') updateHash();
}


export function getThemeColor(key) {
  var colors = editorPaletteColors(state.palette);
  return colors ? colors[THEME_COLOR_MAP[key]] || null : null;
}


export function updateColorUI(key) {
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


export function refreshAllColorUIs() {
  Object.keys(cfgColors).forEach(function(k) { updateColorUI(k); });
}


export function fontLabelForValue(value) {
  if (!value) return 'Default';
  var presets = typeof PRESET_FONTS !== 'undefined' ? PRESET_FONTS : [];
  for (var i = 0; i < presets.length; i++) if (presets[i].value === value) return presets[i].name;
  return value;
}


export function hydrateConfigControls(config) {
  config = (config && typeof config === 'object') ? config : {};
  Object.keys(cfgColors).forEach(function(key) {
    cfgColors[key] = typeof config[key] === 'string' ? config[key] : '';
  });
  ui.cfgFont = typeof config.font === 'string' ? config.font : '';
  var parsedPadding = Number(config.padding);
  ui.cfgPadding = Number.isFinite(parsedPadding) ? parsedPadding : 40;
  if (typeof fontSelectLabel !== 'undefined' && fontSelectLabel) fontSelectLabel.textContent = fontLabelForValue(ui.cfgFont);
  if (typeof paddingNum !== 'undefined' && paddingNum) paddingNum.value = ui.cfgPadding;
  if (typeof paddingSlider !== 'undefined' && paddingSlider) paddingSlider.value = ui.cfgPadding;
  refreshAllColorUIs();
  syncAdvancedOptionsEditor(config);
}


// Clear every override (colors, font, padding) back to the active
// theme's defaults. Font-picker state is initialized before these controls
// can be clicked; live imports preserve the current font and padding values.
export function resetConfig() {
  state.config = {};
  hydrateConfigControls(state.config);
  readConfig();
  if (typeof scheduleRender === 'function') scheduleRender(0);
  if (typeof showToast === 'function') showToast('Style reset to theme.');
}

export function positionSettingsPanel() {
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

export function setSettingsOpen(open, meta) {
  settingsPopup.setOpen(open, meta || {});
}

export function initialize() {
cfgColors = { bg: '', fg: '', accent: '', line: '', muted: '', surface: '' };

ui.cfgFont = '';

// Must match the library's default padding (src/layout/geometry.ts DEFAULTS.padding / the
// render-contract `padding` schema default). This value is both the control's display default
// and the "unset" sentinel below, so a mismatch made the control show a value the renderer did
// not use and made the real default unreachable.
ui.cfgPadding = 40;

advancedOptionsInput = document.getElementById('cfg-advanced-options');

advancedOptionsApply = document.getElementById('cfg-advanced-apply');

advancedOptionsSchema = document.getElementById('cfg-advanced-schema');

advancedOptionsStatus = document.getElementById('cfg-advanced-status');

var fitLabelsControl = document.getElementById('cfg-fit-labels');
if (fitLabelsControl) {
  state.fitLabelsToPane = safeLocalStorageGet('bm-editor-fit-labels') === 'true';
  fitLabelsControl.checked = state.fitLabelsToPane;
  fitLabelsControl.addEventListener('change', function() {
    state.fitLabelsToPane = fitLabelsControl.checked;
    safeLocalStorageSet('bm-editor-fit-labels', String(state.fitLabelsToPane));
    scheduleRender(0);
  });
}


(function initializeAdvancedOptionsSchema() {
  var fields = Object.keys(canonicalAdvancedSchema().properties);
  if (advancedOptionsSchema) {
    advancedOptionsSchema.textContent = fields.length + ' canonical fields: ' + fields.join(', ');
    advancedOptionsSchema.title = fields.join(', ');
  }
  if (advancedOptionsApply) advancedOptionsApply.addEventListener('click', applyAdvancedOptionsJson);
})();


COLOR_PRESETS = [
  '#ffffff','#f5f5f5','#e0e0e0','#bdbdbd','#9e9e9e','#757575','#424242','#212121','#000000',
  '#f44336','#e91e63','#ff4081','#ff1744','#d50000',
  '#9c27b0','#673ab7','#3f51b5','#7c4dff','#aa00ff',
  '#2196f3','#03a9f4','#00bcd4','#1565c0','#2979ff','#0091ea',
  '#4caf50','#8bc34a','#009688','#00e676','#1b5e20',
  '#ffeb3b','#ffc107','#ff9800','#ff5722','#ff6d00',
  '#0f1117','#161b22','#1c2128','#0d1117','#1a1a2e','#16213e',
];


THEME_COLOR_MAP = { bg: 'bg', fg: 'fg', accent: 'accent', line: 'line', muted: 'muted', surface: 'surface' };


refreshAllColorUIs();


configResetBtn = document.getElementById('config-reset-btn');

if (configResetBtn) configResetBtn.addEventListener('click', resetConfig);


// Settings popover: use the same anchored panel grammar as Examples. It still
// brings Source forward on mobile because the config DOM lives in the left panel,
// but visually it is a topbar popover, not a separate mode.
settingsBtn = document.getElementById('settings-btn');

settingsCloseBtn = document.getElementById('settings-close-btn');


settingsPopup = (settingsBtn && configView && typeof createPopupController === 'function')
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

if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', function() { setSettingsOpen(false, { restoreFocus: true }); });

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape' || !configView || configView.hidden) return;
  // A picker popup inside settings (font / colour) owns Escape while it is open,
  // so let it close and restore its own focus before settings reacts.
  if (document.querySelector('#font-popup:not([inert]), #color-popup:not([inert])')) return;
  setSettingsOpen(false, { restoreFocus: true });
});

setSettingsOpen(false);
}
