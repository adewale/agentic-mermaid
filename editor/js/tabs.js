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

function selectLeftPanel(panel, focusButton) {
  setLeftPanelMode(panel);
  setMobilePanel(panel);
  if (focusButton) {
    var btn = document.querySelector('[data-left-panel="' + panel + '"]');
    if (btn) btn.focus();
  }
}

function selectMobilePanel(panel, focusButton) {
  if (panel === 'code' || panel === 'config') setLeftPanelMode(panel);
  setMobilePanel(panel);
  if (focusButton) {
    var btn = document.querySelector('[data-mobile-panel="' + panel + '"]');
    if (btn) btn.focus();
  }
}

function moveWithinSegmentedControl(button, direction) {
  var group = button.closest('[data-segmented-control]');
  if (!group) return;
  var buttons = Array.prototype.slice.call(group.querySelectorAll('button'));
  var index = buttons.indexOf(button);
  var nextIndex = index;
  if (direction === 'Home') nextIndex = 0;
  else if (direction === 'End') nextIndex = buttons.length - 1;
  else nextIndex = (index + (direction === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  var next = buttons[nextIndex];
  if (!next) return;
  if (next.dataset.leftPanel) selectLeftPanel(next.dataset.leftPanel, true);
  else if (next.dataset.mobilePanel) selectMobilePanel(next.dataset.mobilePanel, true);
}

function attachSegmentedControl(selector, selectFn) {
  document.querySelectorAll(selector).forEach(function(button) {
    button.addEventListener('click', function() { selectFn(button.dataset.leftPanel || button.dataset.mobilePanel, false); });
    button.addEventListener('keydown', function(e) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      moveWithinSegmentedControl(button, e.key);
    });
  });
}

attachSegmentedControl('[data-left-panel]', selectLeftPanel);
attachSegmentedControl('[data-mobile-panel]', selectMobilePanel);
setLeftPanelMode('code');
setMobilePanel('code');
