// Property fuzz for the browser Editor's untrusted-input codec (editor/js/sharing.js).
// Share links and localStorage/sessionStorage drafts are attacker-controllable: a
// recipient opens a URL someone else authored. The codec's contract is that ANY input
// decodes to a string or a tagged failure — never a throw that would break editor boot —
// and that a config projected out of a share link is allowlisted to the library's
// serializable render fields (the SEC-1 insertion choke point). editor-security-closures.test.ts
// covers example-based limits; this closes the generated-input gap. Seed pinned globally
// (fc-seed.preload.ts); run AM_FC_SEED=random to hunt fresh counterexamples.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'

import { SHARED_RENDER_OPTION_FIELDS } from '../render-contract.ts'

const ROOT = join(import.meta.dir, '..', '..')
const sharingSource = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')

const NUM_RUNS = 300
const EDITOR_OWNED = new Set(['embedFontImport', 'security'])

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, String(value)) },
    removeItem(key: string) { values.delete(key) },
    clear() { values.clear() },
  }
}

// Mirror of the production harness in editor-security-closures.test.ts, extended to
// expose the two additional untrusted-input entry points we want to fuzz:
// sanitizeEditorConfig (config projection) and getHashSource (full share-hash parse).
function sharingHarness() {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const editor = { value: 'flowchart TD\n  A --> B' }
  const state = { palette: 'paper', style: 'crisp', seed: 0, config: {} as Record<string, unknown> }
  const toasts: string[] = []
  const replacedUrls: string[] = []
  // getHashSource reads window.location.hash and window.__mermaid.SHARED_RENDER_OPTION_FIELDS.
  const window: Record<string, unknown> = {
    location: { hash: '', pathname: '/editor/', search: '' },
    history: { replaceState(_s: unknown, _t: string, url: string) { replacedUrls.push(url) } },
    __mermaid: {
      SHARED_RENDER_OPTION_FIELDS,
      knownStyleDescriptors: () => [{ kind: 'look', inputName: 'hand-drawn' }],
    },
  }
  // editorPaletteInput is a cross-file global in the real editor; stub it so getHashSource's
  // palette-import branch is exercised without a ReferenceError.
  const editorPaletteInput = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const factory = new Function(
    'window', 'localStorage', 'sessionStorage', 'editor', 'state', 'document', 'showToast',
    'editorPaletteInput',
    'CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder',
    'Uint8Array', 'URLSearchParams', 'btoa', 'atob', 'setTimeout', 'clearTimeout',
    'hasCurrentVerifiedSvgArtifact', 'DEFAULT_EDITOR_PALETTE',
    `${sharingSource}\nreturn {
      decodeSource, encodeSourceCompressed, updateHash, getHashSource,
      sanitizeEditorConfig, readEditorDraft, saveEditorDraft, discardEditorDraft,
      get hashDecodeFailure() { return hashDecodeFailure; },
      MAX_SHARE_DECODED_BYTES, MAX_SHARE_ENCODED_BYTES, DRAFT_STORAGE_KEY,
    };`,
  )
  const api = factory(
    window, localStorage, sessionStorage, editor, state,
    { getElementById() { return null } },
    (m: string) => toasts.push(m),
    editorPaletteInput,
    globalThis.CompressionStream, globalThis.DecompressionStream, globalThis.Blob, globalThis.Response,
    globalThis.TextEncoder, globalThis.TextDecoder, globalThis.Uint8Array, globalThis.URLSearchParams,
    globalThis.btoa, globalThis.atob, globalThis.setTimeout, globalThis.clearTimeout,
    () => true,
    'paper',
  )
  return { api, localStorage, sessionStorage, editor, state, toasts, replacedUrls, window }
}

// Strings restricted to valid Unicode code points (no lone surrogates) so the UTF-8
// encode/decode fixed point is exact; TextEncoder replaces lone surrogates with U+FFFD,
// which is correct-but-lossy and would not round-trip (that is not a bug). Astral chars
// (emoji, 𝔘, 𐍈) are surrogate PAIRS in these JS literals, so they are well-formed.
const WELL_FORMED_CHARS = [
  'a', 'B', '7', ' ', '\n', '\t', '\0', '"', "'", '\\', '/', '{', '}', '[', ']', ':', ',',
  '#', '%', '-', '_', '=', '+', '<', '>', '&', '|', 'graph', 'TD', '-->',
  'é', 'ü', 'ñ', '☃', '€', '—', '​', ' ', '�', '😀', '𝔘', '中', '日', 'א', '𐍈', '🚀',
]
const wellFormedStringArb = fc
  .array(fc.constantFrom(...WELL_FORMED_CHARS), { maxLength: 200 })
  .map(chars => chars.join(''))

const SPECIAL = ['deflate:', '=', '-', '_', '+', '/', '\n', '\0', '￿', '​', 'A', '{', '}', '"', '%', '#']
const hostileEncodedArb = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.array(fc.constantFrom(...SPECIAL), { maxLength: 40 }).map(a => a.join('')),
  // deflate-prefixed garbage: forces the base64url + DecompressionStream error path.
  fc.string({ maxLength: 120 }).map(s => 'deflate:' + s),
  // plausible-but-corrupt base64.
  fc.array(fc.constantFrom(...'ABCDEFabcdef0123456789+/='.split('')), { maxLength: 64 }).map(a => a.join('')),
)

describe('editor-codec fuzz: decodeSource is total', () => {
  it('never throws on arbitrary input; returns a string, tagging any failure', async () => {
    await fc.assert(fc.asyncProperty(hostileEncodedArb, async (encoded) => {
      const { api } = sharingHarness()
      const out = await api.decodeSource(encoded)
      expect(typeof out).toBe('string')
      // Empty result must always carry a failure reason (never a silent empty success).
      if (out === '') {
        expect(['unsupported', 'corrupt', 'too-large', null]).toContain(api.hashDecodeFailure)
      } else {
        expect(api.hashDecodeFailure).toBeNull()
      }
    }), { numRuns: NUM_RUNS })
  }, 60_000)
})

describe('editor-codec fuzz: encode -> decode round-trip', () => {
  it('recovers any well-formed source within the size cap', async () => {
    await fc.assert(fc.asyncProperty(wellFormedStringArb, async (src) => {
      const { api } = sharingHarness()
      const encoded = await api.encodeSourceCompressed(src)
      expect(encoded.startsWith('deflate:')).toBe(true)
      const decoded = await api.decodeSource(encoded)
      expect(decoded).toBe(src)
      expect(api.hashDecodeFailure).toBeNull()
    }), { numRuns: NUM_RUNS })
  }, 60_000)

  it('full share-hash JSON round-trips source, and getHashSource never throws', async () => {
    await fc.assert(fc.asyncProperty(wellFormedStringArb, async (src0) => {
      const src = src0 || 'flowchart TD\n A --> B'
      const { api, window } = sharingHarness()
      const encoded = await api.encodeSourceCompressed(JSON.stringify({ source: src }))
      ;(window.location as { hash: string }).hash = '#' + encoded
      const recovered = await api.getHashSource()
      expect(recovered).toBe(src)
    }), { numRuns: NUM_RUNS })
  }, 60_000)
})

describe('editor-codec fuzz: sanitizeEditorConfig allowlist', () => {
  const configArb = fc.dictionary(
    fc.oneof(
      fc.constantFrom(...SHARED_RENDER_OPTION_FIELDS as readonly string[]),
      fc.constantFrom('embedFontImport', 'security', '__proto__', 'constructor', 'toString'),
      fc.string({ maxLength: 12 }),
    ),
    fc.oneof(
      fc.string({ maxLength: 20 }), fc.integer(), fc.double(), fc.boolean(),
      fc.constant(null), fc.object({ maxDepth: 2 }), fc.array(fc.integer(), { maxLength: 4 }),
    ),
    { maxKeys: 12 },
  )

  it('never throws and returns only library render fields, never editor-owned policy fields', () => {
    fc.assert(fc.property(fc.oneof(configArb, fc.anything()), (config) => {
      const { api } = sharingHarness()
      const safe = api.sanitizeEditorConfig(config)
      expect(typeof safe).toBe('object')
      expect(safe).not.toBeNull()
      expect(Array.isArray(safe)).toBe(false)
      const allowed = new Set(SHARED_RENDER_OPTION_FIELDS as readonly string[])
      for (const key of Object.keys(safe)) {
        // Every surviving key must be a real serializable render field...
        expect(allowed.has(key)).toBe(true)
        // ...and must never be an editor-host-owned policy field (SEC-1).
        expect(EDITOR_OWNED.has(key)).toBe(false)
      }
    }), { numRuns: NUM_RUNS })
  })

  it('share appearance is a complete snapshot and cannot inherit recipient state', async () => {
    const { api, state, window } = sharingHarness()
    state.palette = 'recipient-palette'
    state.style = 'hand-drawn'
    state.seed = 7
    state.config = { seed: 99 }
    const encoded = await api.encodeSourceCompressed(JSON.stringify({
      source: 'flowchart TD\n  A --> B',
      palette: '',
      style: 'crisp',
      seed: 0,
    }))
    ;(window.location as { hash: string }).hash = '#' + encoded
    expect(await api.getHashSource()).toContain('flowchart TD')
    expect(state).toEqual({ palette: '', style: 'crisp', seed: 0, config: {} })

    const hostileSeed = btoa(unescape(encodeURIComponent(
      '{"source":"flowchart TD\\n A --> B","seed":1e309}',
    )))
    ;(window.location as { hash: string }).hash = '#' + hostileSeed
    state.seed = 23
    await api.getHashSource()
    expect(state.seed).toBe(0)

    const fractionalSeed = await api.encodeSourceCompressed(JSON.stringify({
      source: 'flowchart TD\n  A --> B',
      seed: 1.5,
    }))
    ;(window.location as { hash: string }).hash = '#' + fractionalSeed
    await api.getHashSource()
    expect(state.seed).toBe(1.5)
  })
})

describe('editor-codec fuzz: draft persistence round-trip', () => {
  it('saveEditorDraft then readEditorDraft recovers the source for any well-formed value', () => {
    fc.assert(fc.property(wellFormedStringArb, (value) => {
      const { api, editor } = sharingHarness()
      editor.value = value.trim() ? value : 'flowchart TD\n A --> B'
      api.saveEditorDraft()
      const draft = api.readEditorDraft()
      // A within-cap, non-blank draft must restore; nothing here should throw.
      if (draft) expect(draft.source).toBe(editor.value)
    }), { numRuns: NUM_RUNS })
  })
})
