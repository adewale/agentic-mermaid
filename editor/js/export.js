var exportScale = 4;
var exportDropdown = document.getElementById('export-dropdown');
var exportMainBtn = document.getElementById('export-main-btn');
var exportChevronBtn = document.getElementById('export-chevron-btn');
var exportRequiresSvgButtons = [
  exportMainBtn,
  document.getElementById('export-png-btn'),
  document.getElementById('export-svg-btn'),
  document.getElementById('copy-png-btn'),
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

exportMainBtn.addEventListener('click', function() {
  exportPNG();
});

document.getElementById('size-pills').addEventListener('click', function(e) {
  var pill = e.target.closest('.size-pill');
  if (!pill) return;
  exportScale = parseInt(pill.dataset.scale, 10);
  document.querySelectorAll('.size-pill').forEach(function(p) {
    var on = p === pill;
    p.classList.toggle('active', on);
    p.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
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

function svgToPngBlob(svgEl, scale, cb, onError) {
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
  img.onerror = function() {
    URL.revokeObjectURL(url);
    if (onError) onError();
    else showToast('PNG export failed.');
  };
  img.src = url;
}

function exportPNG() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  svgToPngBlob(svgEl, exportScale, function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'diagram.png'; a.click();
    URL.revokeObjectURL(url);
    showToast('PNG saved (' + exportScale + '×).');
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
  showToast('SVG saved.');
  setExportDropdownOpen(false, false);
}

// Copy PNG hands the clipboard a promise immediately so the write stays
// inside the user-activation window while the PNG encodes off-thread.
var copyPngBtn = document.getElementById('copy-png-btn');

function copyPNG() {
  var svgEl = getSvgEl(); if (!svgEl) return;
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
    setCopyFeedback(copyPngBtn, 'err');
    showToast('Copying images is not supported in this browser.');
    return;
  }
  var blobPromise = new Promise(function(resolve, reject) {
    svgToPngBlob(svgEl, exportScale, function(blob) {
      if (blob) resolve(blob);
      else reject(new Error('PNG encode failed'));
    }, function() { reject(new Error('PNG encode failed')); });
  });
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]).then(function() {
    setCopyFeedback(copyPngBtn, 'ok');
    showToast('PNG copied (' + exportScale + '×).');
    setExportDropdownOpen(false, false);
  }).catch(function() {
    setCopyFeedback(copyPngBtn, 'err');
    showToast('Copy PNG failed.');
  });
}

function copyURL(sourceBtn) {
  // updateHash compresses asynchronously; wait so the copied URL is current.
  Promise.resolve(updateHash()).then(function() {
    writeClipboardText(window.location.href, 'Share link copied.', 'Copy link failed.', sourceBtn);
  });
}

var copyLinkBtn = document.getElementById('copy-link-btn');

document.getElementById('export-png-btn').addEventListener('click', exportPNG);
document.getElementById('export-svg-btn').addEventListener('click', exportSVG);
if (copyPngBtn) copyPngBtn.addEventListener('click', copyPNG);
copyLinkBtn.addEventListener('click', function() { copyURL(copyLinkBtn); });
updateExportAvailability();

document.addEventListener('keydown', function(e) {
  // Fires even while focus is in the source textarea — where users spend most
  // of their time — and preempts the browser's own Save dialog.
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (e.shiftKey) exportSVG();
  else exportPNG();
});
