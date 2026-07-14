// Share-link encoding. New links compress the payload with native deflate-raw
// and carry a "deflate:" prefix; legacy plain-base64 hashes (old links, old
// bookmarks) stay decodable forever. encodeSource stays synchronous as the
// fallback for browsers without CompressionStream.
var HASH_DEFLATE_PREFIX = 'deflate:';
// These caps are deliberately expressed in UTF-8 bytes, not JavaScript string
// length.  A share URL is already an unsuitable transport for diagrams this
// large; the decoded cap also bounds compression bombs before they can occupy
// an unbounded amount of browser memory.  The encoded allowance is large
// enough for the base64 expansion of any accepted uncompressed payload.
var MAX_SHARE_DECODED_BYTES = 256 * 1024;
var MAX_SHARE_ENCODED_BYTES = 384 * 1024;
var MAX_DRAFT_BYTES = 256 * 1024;

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function limitError(kind) {
  var error = new Error(kind + ' exceeds the editor size limit');
  error.code = 'too-large';
  return error;
}

function encodeSource(src) {
  try { return btoa(unescape(encodeURIComponent(src))); } catch(e) { return ''; }
}

function bytesToBase64Url(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(encoded) {
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error('Invalid base64url payload');
  }
  var b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64ToUtf8(encoded) {
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('Invalid base64 payload');
  }
  var bin = atob(encoded);
  if (bin.length > MAX_SHARE_DECODED_BYTES) throw limitError('Decoded share link');
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function readUtf8StreamWithLimit(stream, byteLimit) {
  var reader = stream.getReader();
  var decoder = new TextDecoder('utf-8', { fatal: true });
  var chunks = [];
  var bytesRead = 0;
  try {
    while (true) {
      var part = await reader.read();
      if (part.done) break;
      bytesRead += part.value.byteLength;
      if (bytesRead > byteLimit) {
        try { await reader.cancel('decoded payload exceeds limit'); } catch(e) {}
        throw limitError('Decoded share link');
      }
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    try { reader.releaseLock(); } catch(e) {}
  }
}

async function encodeSourceCompressed(src) {
  if (utf8ByteLength(src) > MAX_SHARE_DECODED_BYTES) {
    throw limitError('Share link source');
  }
  if (typeof CompressionStream === 'undefined') {
    var legacy = encodeSource(src);
    if (!legacy || utf8ByteLength(legacy) > MAX_SHARE_ENCODED_BYTES) throw limitError('Encoded share link');
    return legacy;
  }
  try {
    var stream = new Blob([src]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    var buffer = await new Response(stream).arrayBuffer();
    var encoded = HASH_DEFLATE_PREFIX + bytesToBase64Url(new Uint8Array(buffer));
    if (utf8ByteLength(encoded) > MAX_SHARE_ENCODED_BYTES) throw limitError('Encoded share link');
    return encoded;
  } catch(e) {
    if (e && e.code === 'too-large') throw e;
    var fallback = encodeSource(src);
    if (!fallback || utf8ByteLength(fallback) > MAX_SHARE_ENCODED_BYTES) {
      throw limitError('Encoded share link');
    }
    return fallback;
  }
}

// Why the last hash decode produced nothing: 'unsupported' (deflate: link in a
// browser without DecompressionStream — never fall through to legacy decode,
// which would silently open the wrong content), 'corrupt' (truncated/damaged
// link), 'too-large' (encoded or expanded payload exceeded a hard cap), or
// null. init.js reads this to tell the recipient instead of
// silently showing their draft or the default diagram.
var hashDecodeFailure = null;

async function decodeSource(encoded) {
  hashDecodeFailure = null;
  if (utf8ByteLength(encoded) > MAX_SHARE_ENCODED_BYTES) {
    hashDecodeFailure = 'too-large';
    return '';
  }
  if (encoded.indexOf(HASH_DEFLATE_PREFIX) === 0) {
    if (typeof DecompressionStream === 'undefined') {
      hashDecodeFailure = 'unsupported';
      return '';
    }
    try {
      var bytes = base64UrlToBytes(encoded.slice(HASH_DEFLATE_PREFIX.length));
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await readUtf8StreamWithLimit(stream, MAX_SHARE_DECODED_BYTES);
    } catch(e) {
      hashDecodeFailure = e && e.code === 'too-large' ? 'too-large' : 'corrupt';
      return '';
    }
  }
  try {
    return base64ToUtf8(encoded);
  } catch(e) {
    hashDecodeFailure = e && e.code === 'too-large' ? 'too-large' : 'corrupt';
    return '';
  }
}

function sanitizeEditorConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  // Share hashes and localStorage are untrusted inputs. Project the browser
  // API's canonical serializable field manifest instead of maintaining a
  // second editor schema; buildOptions validates this same projection and
  // enforces the editor-owned strict security/font policy.
  var allowed = new Set(
    (window.__mermaid && window.__mermaid.SHARED_RENDER_OPTION_FIELDS) || []
  );
  // The editor host owns these two policy fields unconditionally. Do not keep
  // ignored copies in drafts/share links or feed hostile values into the
  // portable options validator before buildOptions pins the host policy.
  var editorOwned = new Set(["embedFontImport", "security"]);
  var safe = {};
  Object.keys(config).forEach(function(key) {
    if (!allowed.has(key) || editorOwned.has(key)) return;
    var value = config[key];
    if (value === undefined || typeof value === 'function') return;
    try { safe[key] = JSON.parse(JSON.stringify(value)); } catch(e) {}
  });
  return safe;
}

function sanitizeEditorStyle(style) {
  // The editor picker owns a named style, never an inline record. Full custom
  // style data may still travel through validated config.style.
  return typeof style === 'string' ? style : '';
}

function hasOwnConfig(config) {
  return !!config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).length > 0;
}

async function getHashSource() {
  var hash = window.location.hash.slice(1);
  if (!hash) return null;
  var decoded = await decodeSource(hash);
  if (!decoded && !hashDecodeFailure) hashDecodeFailure = 'corrupt';
  try {
    var obj = JSON.parse(decoded);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (typeof obj.source !== 'string' || !obj.source) {
        hashDecodeFailure = 'corrupt';
        return null;
      }
      var sharedPalette = obj.palette || obj.theme;
      if (sharedPalette) {
        var importedPalette = editorPaletteInput(sharedPalette);
        if (importedPalette) state.palette = importedPalette;
      }
      var importedStyle = sanitizeEditorStyle(obj.style);
      if (importedStyle) { state.style = importedStyle; }
      if (typeof obj.seed === 'number') { state.seed = obj.seed; }
      if (hasOwnConfig(obj.config)) { state.config = sanitizeEditorConfig(obj.config); }
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
  if (state.palette) obj.palette = state.palette;
  if (state.style && state.style !== 'crisp') obj.style = state.style;
  if (state.seed) obj.seed = state.seed;
  if (hasOwnConfig(state.config)) obj.config = state.config;
  // Compression is async; the token drops stale writes when edits overlap.
  var token = ++hashUpdateToken;
  return encodeSourceCompressed(JSON.stringify(obj)).then(function(encoded) {
    if (token !== hashUpdateToken) return;
    window.history.replaceState(null, '', window.location.pathname + '#' + encoded);
  }).catch(function(error) {
    if (token !== hashUpdateToken) return;
    // Never leave an older, valid hash in place for newer content it does not
    // represent.  A stale URL is more dangerous than no share URL at all.
    window.history.replaceState(null, '', window.location.pathname);
    if (error && error.code === 'too-large' && typeof showToast === 'function') {
      showToast('This diagram is too large for a share URL. Export or copy the source instead.');
    }
  });
}

// ── Draft autosave ────────────────────────────────────────────────────────────
// Source + per-diagram config survive refresh through the user's visible
// persistence choice: localStorage for compatibility, or sessionStorage for a
// private tab-only draft.  The URL hash updates only after a successful render,
// so autosave still protects a never-valid diagram. Restored in init.js only
// when the URL carries no #source and no ?example= param.
var DRAFT_STORAGE_KEY = 'bm-editor-draft';
var DRAFT_MODE_STORAGE_KEY = 'bm-editor-draft-mode';
var DRAFT_MODE_PERSISTENT = 'persistent';
var DRAFT_MODE_SESSION = 'session';
var draftSaveTimer = null;
var draftRestoreFailure = null;
var draftSaveLimitNotified = false;

function storedDraftMode() {
  try {
    return localStorage.getItem(DRAFT_MODE_STORAGE_KEY) === DRAFT_MODE_SESSION
      ? DRAFT_MODE_SESSION
      : DRAFT_MODE_PERSISTENT;
  } catch(e) {
    // If persistent storage itself is unavailable, retain drafts only for the
    // current tab rather than silently weakening the user's privacy.
    return DRAFT_MODE_SESSION;
  }
}

var draftStorageMode = storedDraftMode();

function storageForDraftMode(mode) {
  try { return mode === DRAFT_MODE_SESSION ? sessionStorage : localStorage; }
  catch(e) { return null; }
}

function removeDraftFrom(storage) {
  try { if (storage) storage.removeItem(DRAFT_STORAGE_KEY); } catch(e) {}
}

// Honour a previously selected private mode before any restore occurs.  The
// mode preference contains no diagram content and may remain in localStorage;
// the source/config payload may not.
if (draftStorageMode === DRAFT_MODE_SESSION) removeDraftFrom(storageForDraftMode(DRAFT_MODE_PERSISTENT));

function updateDraftPrivacyControl() {
  var button = document.getElementById('draft-privacy-btn');
  if (!button) return;
  var privateMode = draftStorageMode === DRAFT_MODE_SESSION;
  button.textContent = privateMode ? 'Autosave: private' : 'Autosave: this browser';
  button.setAttribute('aria-pressed', privateMode ? 'true' : 'false');
  button.setAttribute('aria-label', privateMode
    ? 'Private autosave is on. Draft content is kept only for this tab session. Select to allow persistent browser autosave.'
    : 'Persistent autosave is on. Draft content is stored in plaintext in this browser. Select for private session-only autosave.');
  button.title = privateMode
    ? 'Private: draft content is kept only for this tab session'
    : 'Draft content is stored in plaintext in this browser; select for private mode';
}

function setDraftStorageMode(mode) {
  var next = mode === DRAFT_MODE_SESSION ? DRAFT_MODE_SESSION : DRAFT_MODE_PERSISTENT;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  // Never leave a second copy behind when the user changes privacy scope.
  removeDraftFrom(storageForDraftMode(DRAFT_MODE_PERSISTENT));
  removeDraftFrom(storageForDraftMode(DRAFT_MODE_SESSION));
  draftStorageMode = next;
  try {
    if (next === DRAFT_MODE_SESSION) localStorage.setItem(DRAFT_MODE_STORAGE_KEY, DRAFT_MODE_SESSION);
    else localStorage.removeItem(DRAFT_MODE_STORAGE_KEY);
  } catch(e) {}
  updateDraftPrivacyControl();
  saveEditorDraft();
  // Do not immediately replace the more important size-limit warning emitted
  // by saveEditorDraft(); the button already reflects the successful mode
  // change even when this particular draft cannot be stored.
  if (!draftSaveLimitNotified && typeof showToast === 'function') {
    showToast(next === DRAFT_MODE_SESSION
      ? 'Private autosave enabled. Draft content now stays in this tab session.'
      : 'Persistent autosave enabled. Draft content is stored in this browser until cleared.');
  }
}

function toggleDraftStorageMode() {
  setDraftStorageMode(draftStorageMode === DRAFT_MODE_SESSION ? DRAFT_MODE_PERSISTENT : DRAFT_MODE_SESSION);
}

function saveEditorDraft() {
  var storage = storageForDraftMode(draftStorageMode);
  if (!storage) return;
  try {
    if (!editor || !editor.value || !editor.value.trim()) {
      removeDraftFrom(storage);
      draftSaveLimitNotified = false;
      return;
    }
    var serialized = JSON.stringify({
      source: editor.value,
      config: state.config,
      style: state.style !== 'crisp' ? state.style : undefined,
      seed: state.seed || undefined,
      savedAt: Date.now(),
    });
    if (utf8ByteLength(serialized) > MAX_DRAFT_BYTES) {
      removeDraftFrom(storage);
      if (!draftSaveLimitNotified && typeof showToast === 'function') {
        showToast('This diagram is too large for browser autosave. Export or copy the source to keep it.');
      }
      draftSaveLimitNotified = true;
      return;
    }
    storage.setItem(DRAFT_STORAGE_KEY, serialized);
    draftSaveLimitNotified = false;
  } catch(e) {
    // A quota/security failure must not leave an older draft masquerading as
    // the current one on the next visit.
    removeDraftFrom(storage);
  }
}

function scheduleDraftSave() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveEditorDraft, 400);
}

function readEditorDraft() {
  draftRestoreFailure = null;
  var storage = storageForDraftMode(draftStorageMode);
  if (!storage) return null;
  try {
    var raw = storage.getItem(DRAFT_STORAGE_KEY) || '';
    if (!raw) return null;
    if (utf8ByteLength(raw) > MAX_DRAFT_BYTES) {
      removeDraftFrom(storage);
      draftRestoreFailure = 'too-large';
      return null;
    }
    var draft = JSON.parse(raw);
    if (draft && typeof draft.source === 'string' && draft.source.trim()) return draft;
    removeDraftFrom(storage);
    draftRestoreFailure = 'corrupt';
  } catch(e) {
    removeDraftFrom(storage);
    draftRestoreFailure = 'corrupt';
  }
  return null;
}

function discardEditorDraft() {
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  removeDraftFrom(storageForDraftMode(DRAFT_MODE_PERSISTENT));
  removeDraftFrom(storageForDraftMode(DRAFT_MODE_SESSION));
}
