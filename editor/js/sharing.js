// Share-link encoding uses one canonical deflate-raw payload.
var HASH_DEFLATE_PREFIX = 'deflate:';
// These caps are deliberately expressed in UTF-8 bytes, not JavaScript string
// length.  A share URL is already an unsuitable transport for diagrams this
// large; the decoded cap also bounds compression bombs before they can occupy
// an unbounded amount of browser memory.  The encoded allowance is large
// enough for the base64 expansion of any accepted uncompressed payload.
var MAX_SHARE_DECODED_BYTES = 256 * 1024;
var MAX_SHARE_ENCODED_BYTES = 384 * 1024;
var MAX_DRAFT_BYTES = 256 * 1024;

// Browser privacy settings and embedded contexts may expose Storage but throw
// on every operation. Chrome preferences must never make the editor fail boot.
function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch (error) { return null; }
}

function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (error) { return false; }
}

function safeLocalStorageRemove(key) {
  try { localStorage.removeItem(key); return true; } catch (error) { return false; }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function limitError(kind) {
  var error = new Error(kind + ' exceeds the editor size limit');
  error.code = 'too-large';
  return error;
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
    var unsupported = new Error('CompressionStream is unavailable');
    unsupported.code = 'unsupported';
    throw unsupported;
  }
  try {
    var stream = new Blob([src]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    var buffer = await new Response(stream).arrayBuffer();
    var encoded = HASH_DEFLATE_PREFIX + bytesToBase64Url(new Uint8Array(buffer));
    if (utf8ByteLength(encoded) > MAX_SHARE_ENCODED_BYTES) throw limitError('Encoded share link');
    return encoded;
  } catch(e) {
    if (e && e.code === 'too-large') throw e;
    throw e;
  }
}

// Why the last hash decode produced nothing: 'unsupported' (deflate: link in a
// browser without DecompressionStream — never reinterpret the bytes through
// another encoding, which could silently open the wrong content), 'corrupt' (truncated/damaged
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
  hashDecodeFailure = 'corrupt';
  return '';
}

function sanitizeEditorConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  // Share hashes and browser storage are untrusted inputs. Project the browser
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
  if (style === 'crisp') return style;
  var descriptorReader = window.__mermaid && window.__mermaid.knownStyleDescriptors;
  if (typeof style !== 'string' || typeof descriptorReader !== 'function') return '';
  var descriptors = descriptorReader();
  return descriptors.some(function(descriptor) {
    return descriptor && descriptor.kind === 'look' && descriptor.inputName === style;
  }) ? style : '';
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
      // A share payload is a complete per-diagram snapshot. Reset omitted
      // appearance fields before projection so recipient browser preferences cannot
      // silently alter crisp/default links.
      state.palette = DEFAULT_EDITOR_PALETTE;
      state.style = 'crisp';
      state.seed = 0;
      state.config = {};
      var hasPalette = Object.prototype.hasOwnProperty.call(obj, 'palette');
      var sharedPalette = obj.palette;
      if (hasPalette) {
        if (sharedPalette === '') state.palette = '';
        else {
          var importedPalette = editorPaletteInput(sharedPalette);
          if (importedPalette) state.palette = importedPalette;
        }
      }
      var importedStyle = sanitizeEditorStyle(obj.style);
      if (importedStyle) { state.style = importedStyle; }
      if (typeof obj.seed === 'number' && Number.isFinite(obj.seed)) { state.seed = obj.seed; }
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
  if (typeof hasCurrentVerifiedSvgArtifact !== 'function' || !hasCurrentVerifiedSvgArtifact()) {
    if (typeof showToast === 'function') showToast('Render and verify this diagram before copying a share link.');
    return Promise.resolve(false);
  }
  var source = editor.value;
  var obj = {
    source: source,
    palette: state.palette || '',
    style: state.style || 'crisp',
    seed: typeof state.seed === 'number' && Number.isFinite(state.seed) ? state.seed : 0,
  };
  if (hasOwnConfig(state.config)) obj.config = state.config;
  // Compression is async; the token drops stale writes when edits overlap.
  var token = ++hashUpdateToken;
  return encodeSourceCompressed(JSON.stringify(obj)).then(function(encoded) {
    if (token !== hashUpdateToken
      || typeof hasCurrentVerifiedSvgArtifact !== 'function'
      || !hasCurrentVerifiedSvgArtifact()
      || editor.value !== source) return false;
    window.history.replaceState(null, '', window.location.pathname + '#' + encoded);
    return true;
  }).catch(function(error) {
    if (token !== hashUpdateToken) return false;
    // Never leave an older, valid hash in place for newer content it does not
    // represent.  A stale URL is more dangerous than no share URL at all.
    window.history.replaceState(null, '', window.location.pathname);
    if (typeof showToast === 'function') {
      if (error && error.code === 'too-large') {
        showToast('This diagram is too large for a share URL. Export or copy the source instead.');
      } else if (error && error.code === 'unsupported') {
        showToast('This browser cannot create compressed share links (missing CompressionStream). Export or copy the source instead.');
      }
    }
    return false;
  });
}

// ── Draft autosave ────────────────────────────────────────────────────────────
// Source + per-diagram config survive refresh within the current tab through
// sessionStorage. The URL hash updates only after a successful render,
// so autosave still protects a never-valid diagram. Restored in init.js only
// when the URL carries no #source and no ?example= param.
var DRAFT_STORAGE_KEY = 'bm-editor-draft';
var draftSaveTimer = null;
var draftRestoreFailure = null;
var draftSaveLimitNotified = false;

function draftStorage() {
  try { return sessionStorage; }
  catch(e) { return null; }
}

function removeDraftFrom(storage) {
  try { if (storage) storage.removeItem(DRAFT_STORAGE_KEY); } catch(e) {}
}

// Discard stale persistent drafts without reading or restoring them.
safeLocalStorageRemove(DRAFT_STORAGE_KEY);

function saveEditorDraft() {
  safeLocalStorageRemove(DRAFT_STORAGE_KEY);
  var storage = draftStorage();
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
  var storage = draftStorage();
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
  removeDraftFrom(draftStorage());
  safeLocalStorageRemove(DRAFT_STORAGE_KEY);
}
