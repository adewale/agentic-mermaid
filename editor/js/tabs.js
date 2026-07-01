var currentLeftPanel = 'code';
var currentMobilePanel = 'code';

function setMobilePanel(panel) {
  currentMobilePanel = panel;
  document.body.dataset.mobilePanel = panel;
  syncModeButtons();
}

function setLeftPanelMode(panel) {
  currentLeftPanel = panel === 'config' ? 'config' : 'code';
  if (currentLeftPanel === 'code') {
    editorView.hidden = false;
    editorView.style.display = 'flex';
    configView.hidden = true;
    configView.classList.remove('visible');
    configView.setAttribute('aria-hidden', 'true');
    editorView.setAttribute('aria-hidden', 'false');
  } else {
    editorView.hidden = true;
    editorView.style.display = 'none';
    configView.hidden = false;
    configView.classList.add('visible');
    configView.setAttribute('aria-hidden', 'false');
    editorView.setAttribute('aria-hidden', 'true');
    refreshAllColorUIs();
  }
  syncModeButtons();
}

function syncModeButtons() {
  document.querySelectorAll('[data-left-panel]').forEach(function(btn) {
    var active = btn.dataset.leftPanel === currentLeftPanel;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-mobile-panel]').forEach(function(btn) {
    var active = btn.dataset.mobilePanel === currentMobilePanel;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function activateModeButton(button, focusButton) {
  // Source/Style carry data-left-panel (+ data-mobile-panel); Preview carries
  // only data-mobile-panel. One handler drives both the desktop left-panel tab
  // and the mobile whole-view switch from the same adaptive control.
  var left = button.dataset.leftPanel;
  var mobile = button.dataset.mobilePanel || left;
  if (left) setLeftPanelMode(left);
  else if (mobile === 'code' || mobile === 'config') setLeftPanelMode(mobile);
  if (mobile) setMobilePanel(mobile);
  if (focusButton) button.focus();
}

function visibleSegmentButtons(group) {
  // offsetParent is null for display:none buttons (e.g. Preview on desktop),
  // so arrow-key nav only cycles the options actually on screen.
  return Array.prototype.slice.call(group.querySelectorAll('.mode-option')).filter(function(b) {
    return b.offsetParent !== null;
  });
}

function moveWithinSegmentedControl(button, direction) {
  var group = button.closest('[data-segmented-control]');
  if (!group) return;
  var buttons = visibleSegmentButtons(group);
  var index = buttons.indexOf(button);
  if (index < 0) return;
  var nextIndex = index;
  if (direction === 'Home') nextIndex = 0;
  else if (direction === 'End') nextIndex = buttons.length - 1;
  else nextIndex = (index + (direction === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  var next = buttons[nextIndex];
  if (next) activateModeButton(next, true);
}

document.querySelectorAll('[data-segmented-control] .mode-option').forEach(function(button) {
  button.addEventListener('click', function() { activateModeButton(button, false); });
  button.addEventListener('keydown', function(e) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    moveWithinSegmentedControl(button, e.key);
  });
});

setLeftPanelMode('code');
setMobilePanel('code');
