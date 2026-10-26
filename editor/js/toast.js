import { toast } from './elements.js';
export var toastTimer, toastReplacementTimer, toastRemaining, toastStartedAt, toastPaused, TOAST_DURATION;


export function clearToastTimer() {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}


export function hideToast() {
  clearToastTimer();
  toast.classList.remove('show');
  toast.classList.remove('replacing');
  toast.tabIndex = -1;
  toastPaused = false;
  toastRemaining = 0;
}


export function scheduleToastDismissal() {
  clearToastTimer();
  if (toastPaused || toastRemaining <= 0) return;
  toastStartedAt = performance.now();
  toastTimer = setTimeout(hideToast, toastRemaining);
}


export function pauseToast() {
  if (!toast.classList.contains('show') || toastPaused) return;
  toastRemaining = Math.max(0, toastRemaining - (performance.now() - toastStartedAt));
  toastPaused = true;
  clearToastTimer();
}


export function resumeToast() {
  if (!toast.classList.contains('show') || !toastPaused) return;
  toastPaused = false;
  scheduleToastDismissal();
}


export function presentToast(message) {
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


export function showToast(message) {
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

export function initialize() {
toastTimer = null;

toastReplacementTimer = null;

toastRemaining = 0;

toastStartedAt = 0;

toastPaused = false;

TOAST_DURATION = 2500;


toast.addEventListener('pointerenter', pauseToast);

toast.addEventListener('pointerleave', resumeToast);

toast.addEventListener('focusin', pauseToast);

toast.addEventListener('focusout', function(event) {
  if (!toast.contains(event.relatedTarget)) resumeToast();
});
}
