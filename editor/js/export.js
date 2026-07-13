var exportScale = 4;
var lastRenderedPngArtifact = null;
var lastRenderedSvgExportProjection = null;
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
  return !!lastRenderedSvgArtifact
    && previewInner.querySelector('svg') !== null
    && previewInner.dataset.sharedRequestDigest === lastRenderedSvgArtifact.receipt.sharedRequestDigest;
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
  visualClose: true,
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
      .catch(function(error) {
        delete fontDataUriCache[url]; // retry on the next export
        throw error;
      });
  }
  return fontDataUriCache[url];
}

function fontFaceRuleToDataUriCss(rule) {
  var cssText = rule.cssText;
  var m = cssText.match(/url\((['"]?)([^'")]+)\1\)/);
  if (!m) return Promise.resolve({ css: '', diagnostics: [] });
  var url = new URL(m[2], document.baseURI).href;
  if (url.indexOf('data:') === 0) return Promise.resolve({ css: cssText, diagnostics: [] });
  return fetchFontDataUri(url).then(function(dataUri) {
    return { css: cssText.replace(m[0], 'url(' + dataUri + ')'), diagnostics: [] };
  }).catch(function(error) {
    return {
      css: '',
      diagnostics: [{
        code: 'EDITOR_FONT_FETCH_FAILED',
        resource: url,
        message: 'Could not embed font resource ' + url + ': ' + (error && error.message ? error.message : String(error)),
      }],
    };
  });
}

function embeddedFontCss(svgEl) {
  var used = svgFontFamilies(svgEl);
  var matching = pageFontFaceRules().filter(function(rule) {
    var family = String(rule.style.getPropertyValue('font-family') || '').trim().replace(/^['"]|['"]$/g, '');
    return !!used[family.toLowerCase()];
  });
  return Promise.all(matching.map(fontFaceRuleToDataUriCss)).then(function(parts) {
    var css = parts.map(function(part) { return part.css; }).filter(Boolean).join('\n');
    var diagnostics = parts.reduce(function(all, part) { return all.concat(part.diagnostics); }, []);
    var fontSources = [];
    if (css) fontSources.push('embedded-data-uri');
    if (!css || diagnostics.length > 0) fontSources.push('unavailable');
    return {
      css: css,
      diagnostics: diagnostics,
      fontSources: fontSources,
    };
  });
}

function serializeSvgArtifact(svgEl) {
  return embeddedFontCss(svgEl).then(function(fontCss) {
    var clone = svgEl.cloneNode(true);
    if (fontCss.css) {
      var styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleEl.textContent = '\n' + fontCss.css + '\n';
      clone.insertBefore(styleEl, clone.firstChild);
    }
    return {
      svg: new XMLSerializer().serializeToString(clone),
      diagnostics: fontCss.diagnostics,
      fontSources: fontCss.fontSources,
    };
  });
}

function parseCanonicalExportSvg(svg) {
  if (window.__mermaid && typeof window.__mermaid.verifyNoExternalRefs === 'function') {
    var verification = window.__mermaid.verifyNoExternalRefs(svg);
    if (!verification.ok) throw new Error('Unsafe SVG export: ' + verification.refs.join(', '));
  }
  var parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || !parsed.documentElement || parsed.documentElement.localName !== 'svg') {
    throw new Error('Renderer returned malformed SVG for export');
  }
  return document.importNode(parsed.documentElement, true);
}

function serializeCanonicalSvg(svg) {
  return serializeSvgArtifact(parseCanonicalExportSvg(svg));
}

function rasterizeCanonicalSvg(svg, context) {
  var svgEl = parseCanonicalExportSvg(svg);
  return serializeSvgArtifact(svgEl).then(function(serialized) {
    return new Promise(function(resolve, reject) {
      var svgBlob = new Blob([serialized.svg], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var w = img.naturalWidth || svgEl.viewBox.baseVal.width || 800;
        var h = img.naturalHeight || svgEl.viewBox.baseVal.height || 600;
        canvas.width = Math.max(1, Math.ceil(w * context.scale));
        canvas.height = Math.max(1, Math.ceil(h * context.scale));
        var ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Browser PNG canvas context is unavailable'));
          return;
        }
        ctx.scale(context.scale, context.scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(blob) {
          if (!blob) {
            reject(new Error('Browser PNG encoder returned no bytes'));
            return;
          }
          blob.arrayBuffer().then(function(buffer) {
            resolve({
              png: new Uint8Array(buffer),
              diagnostics: serialized.diagnostics,
              fontSources: serialized.fontSources,
            });
          }, reject);
        }, 'image/png');
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error('Browser PNG rasterizer could not decode the secured SVG'));
      };
      img.src = url;
    });
  });
}

function canonicalBrowserPng(scale) {
  if (typeof renderMermaidPngInBrowserWithReceipt !== 'function') {
    return Promise.reject(new Error('Canonical browser PNG adapter is unavailable'));
  }
  var source = currentEditorSource();
  var requestVersion = renderRequestVersion;
  var previewDigest = previewInner.dataset.sharedRequestDigest;
  var options = buildOptions();
  return renderMermaidPngInBrowserWithReceipt(source, options, scale, rasterizeCanonicalSvg).then(function(artifact) {
    if (renderRequestVersion !== requestVersion || currentEditorSource() !== source) {
      throw new Error('Diagram changed while PNG export was rendering; try again.');
    }
    if (artifact.receipt.output !== 'png') throw new Error('PNG export returned a non-PNG receipt');
    if (!previewDigest || previewInner.dataset.sharedRequestDigest !== previewDigest || artifact.receipt.sharedRequestDigest !== previewDigest) {
      throw new Error('PNG bytes and preview receipt do not describe the same render request');
    }
    lastRenderedPngArtifact = artifact;
    return artifact;
  });
}

function reportExportDiagnostics(diagnostics, action) {
  if (!diagnostics || diagnostics.length === 0) return false;
  showToast(action + ' with ' + diagnostics.length + ' font warning' + (diagnostics.length === 1 ? '' : 's') + ': ' + diagnostics[0].message);
  return true;
}

function exportPNG() {
  if (!hasRenderedSvg()) return;
  canonicalBrowserPng(exportScale).then(function(artifact) {
    var blob = new Blob([artifact.png], { type: 'image/png' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'diagram.png'; a.click();
    URL.revokeObjectURL(url);
    if (!reportExportDiagnostics(artifact.diagnostics, 'PNG saved')) showToast('PNG saved (' + exportScale + '×).');
    setExportDropdownOpen(false, false);
  }).catch(function(error) {
    showToast('PNG export failed: ' + (error && error.message ? error.message : String(error)));
  });
}

function exportSVG() {
  if (!lastRenderedSvgArtifact) return;
  var artifact = lastRenderedSvgArtifact;
  var requestVersion = renderRequestVersion;
  var previewDigest = previewInner.dataset.sharedRequestDigest;
  serializeCanonicalSvg(artifact.svg).then(function(projected) {
    if (renderRequestVersion !== requestVersion || lastRenderedSvgArtifact !== artifact
        || !previewDigest || previewInner.dataset.sharedRequestDigest !== previewDigest
        || artifact.receipt.sharedRequestDigest !== previewDigest) {
      throw new Error('SVG bytes and preview receipt no longer match');
    }
    lastRenderedSvgExportProjection = { svg: projected.svg, receipt: artifact.receipt, diagnostics: projected.diagnostics };
    var blob = new Blob([projected.svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'diagram.svg'; a.click();
    URL.revokeObjectURL(url);
    if (!reportExportDiagnostics(projected.diagnostics, 'SVG saved')) showToast('SVG saved.');
    setExportDropdownOpen(false, false);
  }).catch(function(error) {
    showToast('SVG export failed: ' + (error && error.message ? error.message : String(error)));
  });
}

// Copy PNG hands the clipboard a promise immediately so the write stays
// inside the user-activation window while the PNG encodes off-thread.
var copyPngBtn = document.getElementById('copy-png-btn');

function copyPNG() {
  if (!hasRenderedSvg()) return;
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
    setCopyFeedback(copyPngBtn, 'err');
    showToast('Copying images is not supported in this browser.');
    return;
  }
  var copyDiagnostics = [];
  var blobPromise = canonicalBrowserPng(exportScale).then(function(artifact) {
    copyDiagnostics = artifact.diagnostics;
    return new Blob([artifact.png], { type: 'image/png' });
  });
  navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]).then(function() {
    setCopyFeedback(copyPngBtn, 'ok');
    if (!reportExportDiagnostics(copyDiagnostics, 'PNG copied')) showToast('PNG copied (' + exportScale + '×).');
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
