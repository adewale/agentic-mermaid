function encodeSource(src) {
  try { return btoa(unescape(encodeURIComponent(src))); } catch(e) { return ''; }
}
function decodeSource(b64) {
  try { return decodeURIComponent(escape(atob(b64))); } catch(e) { return ''; }
}

function hasOwnConfig(config) {
  return !!config && typeof config === 'object' && Object.keys(config).length > 0;
}

function getHashSource() {
  var hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    var obj = JSON.parse(decodeSource(hash));
    if (obj && obj.source) {
      if (obj.theme) { state.theme = obj.theme; }
      if (hasOwnConfig(obj.config)) { state.config = obj.config; }
      return obj.source;
    }
  } catch(e) {}
  return decodeSource(hash) || null;
}

function getQueryExampleId() {
  try { return new URLSearchParams(window.location.search).get('example') || ''; }
  catch(e) { return ''; }
}

function updateHash() {
  var obj = { source: editor.value };
  if (state.theme) obj.theme = state.theme;
  if (hasOwnConfig(state.config)) obj.config = state.config;
  window.history.replaceState(null, '', '#' + encodeSource(JSON.stringify(obj)));
}
