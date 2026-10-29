document.querySelectorAll('[data-edit-demo]').forEach(function(demo) {
  var buttons = demo.querySelectorAll('[data-edit-state]');
  var panels = demo.querySelectorAll('[data-edit-panel]');
  var status = demo.querySelector('[role="status"]');
  buttons.forEach(function(button) {
    button.addEventListener('click', function() {
      var selected = button.dataset.editState;
      buttons.forEach(function(control) { control.setAttribute('aria-pressed', control === button ? 'true' : 'false'); });
      panels.forEach(function(panel) { panel.hidden = panel.dataset.editPanel !== selected; });
      status.textContent = selected === '1' ? status.dataset.afterStatus : status.dataset.beforeStatus;
    });
  });
});
