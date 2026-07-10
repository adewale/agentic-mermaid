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

// ── Export font embedding ─────────────────────────────────────────────────────
// The preview loads the self-hosted faces (Caveat, DejaVu Sans, …) through the
// page's @font-face rules, but a downloaded SVG opened elsewhere — and the
// <img> that rasterizes it for PNG export, which loads no external resources
// at all — cannot reach /fonts/. serializeSvg therefore inlines every hosted
// face the diagram actually uses as a data: URI @font-face inside the SVG, so
// SVG and PNG exports keep the preview's fonts. (The 'Inter' default ships no
// font file; preview and export both use the system fallback stack for it.)
var fontDataUriCache = {};

function svgFontFamilies(svgEl) {
  var families = {};
  function add(list) {
    // Unwrap var(--font, 'Fallback') before splitting the family stack.
    String(list || '').replace(/var\(--font\s*,\s*([^)]*)\)/g, '$1').split(',').forEach(function(f) {
      f = f.trim().replace(/^['"]|['"]$/g, '');
      if (f) families[f.toLowerCase()] = true;
    });
  }
  add(svgEl.style.getPropertyValue('--font'));
  svgEl.querySelectorAll('[font-family]').forEach(function(el) { add(el.getAttribute('font-family')); });
  svgEl.querySelectorAll('style').forEach(function(styleEl) {
    (String(styleEl.textContent || '').match(/font-family:[^;{}]+/g) || []).forEach(function(decl) {
      add(decl.slice('font-family:'.length));
    });
  });
  return families;
}

function pageFontFaceRules() {
  var rules = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var cssRules;
    try { cssRules = document.styleSheets[i].cssRules; } catch (e) { continue; } // cross-origin sheet
    for (var j = 0; cssRules && j < cssRules.length; j++) {
      if (cssRules[j] instanceof CSSFontFaceRule) rules.push(cssRules[j]);
    }
  }
  return rules;
}

function fetchFontDataUri(url) {
  if (!fontDataUriCache[url]) {
    var mime = /\.woff2(\?|$)/i.test(url) ? 'font/woff2'
      : /\.woff(\?|$)/i.test(url) ? 'font/woff'
      : /\.otf(\?|$)/i.test(url) ? 'font/otf'
      : 'font/ttf';
    fontDataUriCache[url] = fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('font fetch failed: ' + url);
        return res.arrayBuffer();
      })
      .then(function(buffer) {
        var bytes = new Uint8Array(buffer);
        var bin = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return 'data:' + mime + ';base64,' + btoa(bin);
      })
      .catch(function() {
        delete fontDataUriCache[url]; // retry on the next export
        return '';
      });
  }
  return fontDataUriCache[url];
}

function fontFaceRuleToDataUriCss(rule) {
  var cssText = rule.cssText;
  var m = cssText.match(/url\((['"]?)([^'")]+)\1\)/);
  if (!m) return Promise.resolve('');
  var url = new URL(m[2], document.baseURI).href;
  if (url.indexOf('data:') === 0) return Promise.resolve(cssText);
  return fetchFontDataUri(url).then(function(dataUri) {
    return dataUri ? cssText.replace(m[0], 'url(' + dataUri + ')') : '';
  });
}

function embeddedFontCss(svgEl) {
  var used = svgFontFamilies(svgEl);
  var matching = pageFontFaceRules().filter(function(rule) {
    var family = String(rule.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '');
    return !!used[family.toLowerCase()];
  });
  return Promise.all(matching.map(fontFaceRuleToDataUriCss)).then(function(parts) {
    return parts.filter(Boolean).join('\n');
  });
}

function serializeSvg(svgEl) {
  return embeddedFontCss(svgEl).then(function(fontCss) {
    if (!fontCss) return new XMLSerializer().serializeToString(svgEl);
    var clone = svgEl.cloneNode(true);
    var styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = '\n' + fontCss + '\n';
    clone.insertBefore(styleEl, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  });
}

function svgToPngBlob(svgEl, scale, cb, onError) {
  serializeSvg(svgEl).then(function(serialized) {
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
  });
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
  serializeSvg(svgEl).then(function(data) {
    var blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'diagram.svg'; a.click();
    URL.revokeObjectURL(url);
    showToast('SVG saved.');
    setExportDropdownOpen(false, false);
  });
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
