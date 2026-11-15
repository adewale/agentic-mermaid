export var editor, lineNumbers, previewInner, previewBody, statusText, statusDot, cursorPos, renderTime, zoomLabel, spinner, unicodeOutput, asciiOutput, copyTextOutputBtn, runtimeRecovery, verifySummary, verifyTierStructural, verifyTierGeometric, verifyTierLint, verifyStructural, verifyGeometric, verifyLint, verifyDetailsBtn, verifyDetails, verifyDetailsList, toast, themeMenu, panelLeft, resizeHandle, editorView, configView;

export function initialize() {
editor = document.getElementById("code-editor");

lineNumbers = document.getElementById("line-numbers");

previewInner = document.getElementById("preview-inner");

previewBody = document.getElementById("preview-body");

statusText = document.getElementById("status-text");

statusDot = document.getElementById("status-dot");

cursorPos = document.getElementById("cursor-pos");

renderTime = document.getElementById("render-time");

zoomLabel = document.getElementById("zoom-label");

spinner = document.getElementById("render-spinner");

unicodeOutput = document.getElementById("unicode-output");

asciiOutput = document.getElementById("ascii-output");

copyTextOutputBtn = document.getElementById("copy-text-output-btn");

runtimeRecovery = document.getElementById('runtime-recovery');

verifySummary = document.getElementById("verify-summary");

verifyTierStructural = document.getElementById("verify-tier-structural");

verifyTierGeometric = document.getElementById("verify-tier-geometric");

verifyTierLint = document.getElementById("verify-tier-lint");

verifyStructural = document.getElementById("verify-structural");

verifyGeometric = document.getElementById("verify-geometric");

verifyLint = document.getElementById("verify-lint");

verifyDetailsBtn = document.getElementById("verify-details-btn");

verifyDetails = document.getElementById("verify-details");

verifyDetailsList = document.getElementById("verify-details-list");

toast = document.getElementById("toast");

themeMenu = document.getElementById("theme-dropdown-menu");

panelLeft = document.getElementById("panel-left");

resizeHandle = document.getElementById("resize-handle");

editorView = document.getElementById("editor-view");

configView = document.getElementById("config-view");
}
