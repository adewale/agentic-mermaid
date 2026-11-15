import { COLOR_PRESETS, cfgColors, readConfig, updateColorUI } from './config-panel.js';
import { createPopupController, positionAnchoredPopup } from './helpers.js';
import { closeFontPopup } from './font-picker.js';
import { scheduleRender } from './rendering.js';
export var colorPopup, colorNative, colorHexInput, activeColorKey, activeColorAnchor, paletteEl, colorPopupController;


export function openColorPopup(key, anchorEl) {
  activeColorKey = key;
  activeColorAnchor = anchorEl;
  var labels = { bg:'Background', fg:'Foreground', accent:'Accent', line:'Line', muted:'Muted', surface:'Surface' };
  document.getElementById('color-popup-title').textContent = labels[key] || key;

  var val = cfgColors[key] || '#ffffff';
  colorHexInput.value = cfgColors[key] || '';
  if (/^#[0-9a-fA-F]{6}$/.test(val)) colorNative.value = val;

  colorPopupController.open({ focusFirst: true });
}


export function setActiveColor(hex) {
  if (!activeColorKey) return;
  cfgColors[activeColorKey] = hex;
  colorHexInput.value = hex;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) colorNative.value = hex;
  updateColorUI(activeColorKey);
  readConfig();
  scheduleRender(200);
}


export function closeColorPopup(restoreFocus) {
  colorPopupController.close({ restoreFocus: !!restoreFocus });
}

export function initialize() {
colorPopup = document.getElementById('color-popup');

colorNative = document.getElementById('color-native-input');

colorHexInput = document.getElementById('color-hex-input');

activeColorKey = null;

activeColorAnchor = null;


paletteEl = document.getElementById('color-palette');

COLOR_PRESETS.forEach(function(hex) {
  var btn = document.createElement('button');
  btn.className = 'color-swatch-btn';
  btn.style.background = hex;
  btn.title = hex;
  btn.setAttribute('aria-label', 'Use ' + hex);
  btn.addEventListener('click', function() {
    setActiveColor(hex);
  });
  paletteEl.appendChild(btn);
});


colorPopupController = createPopupController({
  popup: colorPopup,
  trigger: function() { return activeColorAnchor; },
  closePeersOnOpen: false,
  visualClose: true,
  triggerEvents: false,
  visibility: { focusSelector: '#color-hex-input' },
  beforeOpen: function() {
    // Mirror of the font picker's beforeOpen: the two nested pickers share the
    // --z-popover-nested tier, so whichever opens closes the other rather than
    // letting DOM order decide which paints on top.
    if (typeof closeFontPopup === 'function') closeFontPopup(false);
    positionAnchoredPopup(colorPopup, activeColorAnchor, { width: 240, height: 400 });
  },
  afterOpen: function() {
    document.querySelectorAll('.color-edit-btn').forEach(function(btn) { btn.setAttribute('aria-expanded', btn === activeColorAnchor ? 'true' : 'false'); });
    colorHexInput.select();
  },
  afterClose: function() {
    document.querySelectorAll('.color-edit-btn').forEach(function(btn) { btn.setAttribute('aria-expanded', 'false'); });
    activeColorKey = null;
    activeColorAnchor = null;
  },
  contains: function(target) {
    return !!(target.closest('#color-popup') || target.closest('.color-edit-btn'));
  },
  repositionOnResize: true,
  position: function() { positionAnchoredPopup(colorPopup, activeColorAnchor, { width: 240, height: 400 }); },
});


document.querySelectorAll('.color-edit-btn').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var key = btn.dataset.cfg;
    if (colorPopup.classList.contains('open') && activeColorKey === key) {
      closeColorPopup(false); return;
    }
    openColorPopup(key, btn);
  });
});


document.getElementById('color-popup-close').addEventListener('click', function() { closeColorPopup(true); });


document.getElementById('color-clear-btn').addEventListener('click', function() {
  if (!activeColorKey) return;
  cfgColors[activeColorKey] = '';
  colorHexInput.value = '';
  updateColorUI(activeColorKey);
  readConfig();
  scheduleRender(200);
});


colorNative.addEventListener('input', function() {
  setActiveColor(colorNative.value);
});


colorHexInput.addEventListener('input', function() {
  var val = colorHexInput.value.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    colorNative.value = val;
    cfgColors[activeColorKey] = val;
    updateColorUI(activeColorKey);
    readConfig();
    scheduleRender(400);
  }
});
}
