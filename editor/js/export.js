var exportScale = 4;
var exportDropdown = document.getElementById('export-dropdown');
var exportMainBtn = document.getElementById('export-main-btn');
var exportChevronBtn = document.getElementById('export-chevron-btn');
var exportRequiresSvgButtons = [
  exportMainBtn,
  document.getElementById('export-png-btn'),
  document.getElementById('export-svg-btn'),
  document.getElementById('copy-svg-btn'),
  document.getElementById('copy-image-btn'),
].filter(Boolean);

function hasRenderedSvg() {
  return previewInner.querySelector('svg') !== null;
}

function updateExportAvailability() {
  var enabled = hasRenderedSvg();
  exportRequiresSvgButtons.forEach(function(btn) {
    btn.disabled = !enabled;
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  });
}

var exportPopup = createPopupController({
  popup: exportDropdown,
  trigger: exportChevronBtn,
  visibility: { toggleTriggerClass: false },
  beforeOpen: updateExportAvailability,
  afterOpen: function(meta) {
    if (meta && meta.focusFirst) {
      var first = exportDropdown.querySelector('button:not(:disabled)');
      if (first) first.focus();
    }
  },
  contains: function(target) { return !!target.closest('#export-wrap'); },
});

function setExportDropdownOpen(open, focusFirst) {
  exportPopup.setOpen(open, { focusFirst: !!focusFirst });
}

exportDropdown.querySelectorAll('button').forEach(function(btn) { btn.setAttribute('role', 'menuitem'); });
exportMainBtn.addEventListener('click', function() {
  exportPNG();
});

document.getElementById('size-pills').addEventListener('click', function(e) {
  var pill = e.target.closest('.size-pill');
  if (!pill) return;
  exportScale = parseInt(pill.dataset.scale, 10);
  document.querySelectorAll('.size-pill').forEach(function(p) { p.classList.remove('active'); });
  pill.classList.add('active');
});

function getSvgEl() {
  var el = previewInner.querySelector('svg');
  if (!el) {
    showToast('Load or write a diagram before exporting.');
    updateExportAvailability();
    return null;
  }
  return el;
}

function serializeSvg(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}

function svgToPngBlob(svgEl, scale, cb) {
  var serialized = serializeSvg(svgEl);
  var svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  var url = URL.createObjectURL(svgBlob);
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement('canvas');
    var w = img.naturalWidth  || svgEl.viewBox.baseVal.width  || 800;
    var h = img.naturalHeight || svgEl.viewBox.baseVal.height || 600;
    canvas.width  = w * scale;
    canvas.height = h * scale;
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(cb, 'image/png');
  };
  img.onerror = function() { URL.revokeObjectURL(url); showToast('PNG export failed.'); };
  img.src = url;
}

function exportPNG() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  svgToPngBlob(svgEl, exportScale, function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'diagram.png'; a.click();
    URL.revokeObjectURL(url);
    showToast('PNG saved (' + exportScale + 'x)');
    setExportDropdownOpen(false, false);
  });
}

function exportSVG() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  var data = serializeSvg(svgEl);
  var blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'diagram.svg'; a.click();
  URL.revokeObjectURL(url);
  showToast('SVG saved!');
  setExportDropdownOpen(false, false);
}

function copySVG() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  writeClipboardText(serializeSvg(svgEl), 'SVG copied to clipboard!', 'Copy SVG failed.', document.getElementById('copy-svg-btn'));
}

function copyImage() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  svgToPngBlob(svgEl, exportScale, function(blob) {
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function() {
        setCopyFeedback(document.getElementById('copy-image-btn'), 'ok');
        showToast('Image copied to clipboard!');
        setExportDropdownOpen(false, false);
      }).catch(function() {
        setCopyFeedback(document.getElementById('copy-image-btn'), 'err');
        showToast('Copy PNG failed.');
      });
    } catch(e) { setCopyFeedback(document.getElementById('copy-image-btn'), 'err'); showToast('Copy not supported in this browser.'); }
  });
}

function copyURL() {
  updateHash();
  writeClipboardText(window.location.href, 'URL copied to clipboard!', 'Copy link failed.', document.getElementById('copy-link-btn'));
}

document.getElementById('export-png-btn').addEventListener('click', exportPNG);
document.getElementById('export-svg-btn').addEventListener('click', exportSVG);
document.getElementById('copy-svg-btn').addEventListener('click', copySVG);
document.getElementById('copy-image-btn').addEventListener('click', copyImage);
document.getElementById('copy-link-btn').addEventListener('click', copyURL);
updateExportAvailability();

document.addEventListener('keydown', function(e) {
  if (e.target === editor) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); exportPNG(); }
  if ((e.metaKey || e.ctrlKey) &&  e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); exportSVG(); }
});
