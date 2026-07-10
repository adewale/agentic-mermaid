// Share-link encoding. New links compress the payload with native deflate-raw
// and carry a "deflate:" prefix; legacy plain-base64 hashes (old links, old
// bookmarks) stay decodable forever. encodeSource stays synchronous as the
// fallback for browsers without CompressionStream.
var HASH_DEFLATE_PREFIX = 'deflate:';

function encodeSource(src) {
  try { return btoa(unescape(encodeURIComponent(src))); } catch(e) { return ''; }
}
function decodeSourceLegacy(b64) {
  try { return decodeURIComponent(escape(atob(b64))); } catch(e) { return ''; }
}

function bytesToBase64Url(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(encoded) {
  var b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function encodeSourceCompressed(src) {
  if (typeof CompressionStream === 'undefined') return encodeSource(src);
  try {
    var stream = new Blob([src]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    var buffer = await new Response(stream).arrayBuffer();
    return HASH_DEFLATE_PREFIX + bytesToBase64Url(new Uint8Array(buffer));
  } catch(e) {
    return encodeSource(src);
  }
}

// Why the last hash decode produced nothing: 'unsupported' (deflate: link in a
// browser without DecompressionStream — never fall through to legacy decode,
// which would silently open the wrong content), 'corrupt' (truncated/damaged
// link), or null. init.js reads this to tell the recipient instead of
// silently showing their draft or the default diagram.
var hashDecodeFailure = null;

async function decodeSource(encoded) {
  hashDecodeFailure = null;
  if (encoded.indexOf(HASH_DEFLATE_PREFIX) === 0) {
    if (typeof DecompressionStream === 'undefined') {
      hashDecodeFailure = 'unsupported';
      return '';
    }
    try {
      var bytes = base64UrlToBytes(encoded.slice(HASH_DEFLATE_PREFIX.length));
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    } catch(e) {
      hashDecodeFailure = 'corrupt';
      return '';
    }
  }
  return decodeSourceLegacy(encoded);
}

function hasOwnConfig(config) {
  return !!config && typeof config === 'object' && Object.keys(config).length > 0;
}

async function getHashSource() {
  var hash = window.location.hash.slice(1);
  if (!hash) return null;
  var decoded = await decodeSource(hash);
  if (!decoded && !hashDecodeFailure) hashDecodeFailure = 'corrupt';
  try {
    var obj = JSON.parse(decoded);
    if (obj && obj.source) {
      if (obj.theme) { state.theme = obj.theme; }
      if (obj.style) { state.style = obj.style; }
      if (typeof obj.seed === 'number') { state.seed = obj.seed; }
      if (hasOwnConfig(obj.config)) { state.config = obj.config; }
      return obj.source;
    }
  } catch(e) {}
  return decoded || null;
}

function getQueryExampleId() {
  try { return new URLSearchParams(window.location.search).get('example') || ''; }
  catch(e) { return ''; }
}

var hashUpdateToken = 0;

function updateHash() {
  var obj = { source: editor.value };
  if (state.theme) obj.theme = state.theme;
  if (state.style && state.style !== 'crisp') obj.style = state.style;
  if (state.seed) obj.seed = state.seed;
  if (hasOwnConfig(state.config)) obj.config = state.config;
  // Compression is async; the token drops stale writes when edits overlap.
  var token = ++hashUpdateToken;
  return encodeSourceCompressed(JSON.stringify(obj)).then(function(encoded) {
    if (token !== hashUpdateToken) return;
    window.history.replaceState(null, '', window.location.pathname + '#' + encoded);
  });
}

// ── Draft autosave ────────────────────────────────────────────────────────────
// Source + per-diagram config survive refresh via localStorage, not only the
// URL hash (which updates after a successful render, so a never-valid diagram
// would otherwise be lost). Saved on every edit; restored in init.js only when
// the URL carries no #source and no ?example= param.
var DRAFT_STORAGE_KEY = 'bm-editor-draft';
var draftSaveTimer = null;

function saveEditorDraft() {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      source: editor.value,
      config: state.config,
      style: state.style !== 'crisp' ? state.style : undefined,
      seed: state.seed || undefined,
      savedAt: Date.now(),
    }));
  } catch(e) {}
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveEditorDraft, 400);
}

function readEditorDraft() {
  try {
    var draft = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || 'null');
    if (draft && typeof draft.source === 'string' && draft.source.trim()) return draft;
  } catch(e) {}
  return null;
}

function discardEditorDraft() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch(e) {}
}
