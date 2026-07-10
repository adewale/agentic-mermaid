var toastTimer = null;
var toastReplacementTimer = null;
var toastRemaining = 0;
var toastStartedAt = 0;
var toastPaused = false;
var TOAST_DURATION = 2500;

function clearToastTimer() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}

function hideToast() {
  clearToastTimer();
  toast.classList.remove('show');
  toast.classList.remove('replacing');
  toast.tabIndex = -1;
  toastPaused = false;
  toastRemaining = 0;
}

function scheduleToastDismissal() {
  clearToastTimer();
  if (toastPaused || toastRemaining <= 0) return;
  toastStartedAt = performance.now();
  toastTimer = setTimeout(hideToast, toastRemaining);
}

function pauseToast() {
  if (!toast.classList.contains('show') || toastPaused) return;
  toastRemaining = Math.max(0, toastRemaining - (performance.now() - toastStartedAt));
  toastPaused = true;
  clearToastTimer();
}

function resumeToast() {
  if (!toast.classList.contains('show') || !toastPaused) return;
  toastPaused = false;
  scheduleToastDismissal();
}

function presentToast(message) {
  // Replacing text must preserve a reader's active hover/focus pause; the
  // replacement itself does not emit a new pointerenter/focusin event.
  var remainsPaused = toast.matches(':hover, :focus-within');
  toast.textContent = message;
  toast.classList.remove('replacing');
  toast.classList.add('show');
  toast.tabIndex = 0;
  toastRemaining = TOAST_DURATION;
  toastPaused = remainsPaused;
  if (!toastPaused) scheduleToastDismissal();
}

function showToast(message) {
  if (toastReplacementTimer) clearTimeout(toastReplacementTimer);
  if (toast.classList.contains('show')) {
    clearToastTimer();
    toast.classList.add('replacing');
    toastReplacementTimer = setTimeout(function() {
      toastReplacementTimer = null;
      presentToast(message);
    }, 80);
    return;
  }
  presentToast(message);
}

toast.addEventListener('pointerenter', pauseToast);
toast.addEventListener('pointerleave', resumeToast);
toast.addEventListener('focusin', pauseToast);
toast.addEventListener('focusout', function(event) {
  if (!toast.contains(event.relatedTarget)) resumeToast();
});
