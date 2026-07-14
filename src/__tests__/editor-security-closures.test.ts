import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const sharingSource = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, String(value)) },
    removeItem(key: string) { values.delete(key) },
    clear() { values.clear() },
  }
}

function sharingHarness(options: { decompression?: typeof DecompressionStream | undefined; verified?: boolean } = {}) {
  const localStorage = memoryStorage()
  const sessionStorage = memoryStorage()
  const editor = { value: 'flowchart TD\n  A --> B' }
  const state = { palette: 'paper', style: 'crisp', seed: 0, config: {} as Record<string, unknown> }
  const toasts: string[] = []
  const replacedUrls: string[] = []
  const window = {
    location: { hash: '', pathname: '/editor/', search: '' },
    history: { replaceState(_state: unknown, _title: string, url: string) { replacedUrls.push(url) } },
    __mermaid: {
      knownStyleDescriptors: () => [
        { kind: 'look', inputName: 'hand-drawn' },
        { kind: 'palette', inputName: 'paper' },
      ],
    },
  }
  const factory = new Function(
    'window', 'localStorage', 'sessionStorage', 'editor', 'state', 'document', 'showToast',
    'CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder',
    'Uint8Array', 'URLSearchParams', 'btoa', 'atob', 'setTimeout', 'clearTimeout',
    'hasCurrentVerifiedSvgArtifact', 'DEFAULT_EDITOR_PALETTE',
    `${sharingSource}\nreturn {
      decodeSource,
      encodeSourceCompressed,
      updateHash,
      readEditorDraft,
      saveEditorDraft,
      discardEditorDraft,
      setDraftStorageMode,
      get hashDecodeFailure() { return hashDecodeFailure; },
      get draftRestoreFailure() { return draftRestoreFailure; },
      get draftStorageMode() { return draftStorageMode; },
      MAX_SHARE_DECODED_BYTES,
      MAX_SHARE_ENCODED_BYTES,
      MAX_DRAFT_BYTES,
      DRAFT_STORAGE_KEY,
      DRAFT_MODE_STORAGE_KEY,
      sanitizeEditorStyle,
    };`,
  )
  const api = factory(
    window,
    localStorage,
    sessionStorage,
    editor,
    state,
    { getElementById() { return null } },
    (message: string) => toasts.push(message),
    globalThis.CompressionStream,
    Object.prototype.hasOwnProperty.call(options, 'decompression') ? options.decompression : globalThis.DecompressionStream,
    globalThis.Blob,
    globalThis.Response,
    globalThis.TextEncoder,
    globalThis.TextDecoder,
    globalThis.Uint8Array,
    globalThis.URLSearchParams,
    globalThis.btoa,
    globalThis.atob,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    () => options.verified !== false,
    'paper',
  )
  return { api, localStorage, sessionStorage, editor, state, toasts, replacedUrls }
}

describe('editor share-link resource limits', () => {
  test('new share links emit Palette vocabulary while legacy theme links remain decodable', async () => {
    const { api, replacedUrls } = sharingHarness()
    await api.updateHash()
    const encoded = replacedUrls.at(-1)!.split('#')[1]!
    const payload = JSON.parse(await api.decodeSource(encoded))
    expect(payload).toMatchObject({ palette: 'paper' })
    expect(payload).not.toHaveProperty('theme')
  })

  test('round-trips accepted compressed payloads and reports corrupt input', async () => {
    const { api } = sharingHarness()
    const source = JSON.stringify({ source: 'flowchart TD\n  Alpha --> Beta', config: { bg: '#fff' } })
    const encoded = await api.encodeSourceCompressed(source)
    expect(encoded).toStartWith('deflate:')
    expect(await api.decodeSource(encoded)).toBe(source)
    expect(api.hashDecodeFailure).toBeNull()

    expect(await api.decodeSource('deflate:not-valid-***')).toBe('')
    expect(api.hashDecodeFailure).toBe('corrupt')
  })

  test('rejects an oversized encoded hash before base64 decoding', async () => {
    const { api } = sharingHarness()
    expect(await api.decodeSource('A'.repeat(api.MAX_SHARE_ENCODED_BYTES + 1))).toBe('')
    expect(api.hashDecodeFailure).toBe('too-large')
  })

  test('stream-aborts a compact decompression bomb at the decoded byte cap', async () => {
    const { api } = sharingHarness()
    const expanded = Buffer.from('x'.repeat(api.MAX_SHARE_DECODED_BYTES + 1))
    const encoded = 'deflate:' + deflateRawSync(expanded).toString('base64url')
    expect(encoded.length).toBeLessThan(1_000)
    expect(await api.decodeSource(encoded)).toBe('')
    expect(api.hashDecodeFailure).toBe('too-large')
  })

  test('does not reinterpret deflate links when DecompressionStream is missing', async () => {
    const normal = sharingHarness()
    const encoded = await normal.api.encodeSourceCompressed('{"source":"flowchart TD\\nA --> B"}')
    const unsupported = sharingHarness({ decompression: undefined })
    expect(await unsupported.api.decodeSource(encoded)).toBe('')
    expect(unsupported.api.hashDecodeFailure).toBe('unsupported')
  })

  test('a too-large edit clears a stale share URL instead of misrepresenting the source', async () => {
    const { api, editor, replacedUrls, toasts } = sharingHarness()
    editor.value = 'x'.repeat(api.MAX_SHARE_DECODED_BYTES + 1)
    await api.updateHash()
    expect(replacedUrls.at(-1)).toBe('/editor/')
    expect(toasts).toContain('This diagram is too large for a share URL. Export or copy the source instead.')
  })

  test('share links require a current verified artifact and styles use the registered look roster', async () => {
    const { api, replacedUrls, toasts } = sharingHarness({ verified: false })
    expect(await api.updateHash()).toBe(false)
    expect(replacedUrls).toEqual([])
    expect(toasts).toContain('Render and verify this diagram before copying a share link.')

    expect(api.sanitizeEditorStyle('crisp')).toBe('crisp')
    expect(api.sanitizeEditorStyle('hand-drawn')).toBe('hand-drawn')
    expect(api.sanitizeEditorStyle('paper')).toBe('')
    expect(api.sanitizeEditorStyle('future-unregistered-look')).toBe('')
  })
})

describe('editor bounded, explicit draft persistence', () => {
  test('oversized drafts are cleared before JSON.parse', () => {
    const { api, localStorage } = sharingHarness()
    localStorage.setItem(api.DRAFT_STORAGE_KEY, 'x'.repeat(api.MAX_DRAFT_BYTES + 1))
    expect(api.readEditorDraft()).toBeNull()
    expect(api.draftRestoreFailure).toBe('too-large')
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
  })

  test('private mode removes the persistent copy and writes only to session storage', () => {
    const { api, localStorage, sessionStorage, editor } = sharingHarness()
    api.saveEditorDraft()
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toContain('flowchart TD')
    expect(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()

    api.setDraftStorageMode('session')
    expect(api.draftStorageMode).toBe('session')
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(api.DRAFT_MODE_STORAGE_KEY)).toBe('session')
    expect(JSON.parse(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)!)).toMatchObject({ source: editor.value })

    api.discardEditorDraft()
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
  })

  test('oversized current drafts fail visibly and cannot leave a stale restore', () => {
    const { api, localStorage, editor, toasts } = sharingHarness()
    editor.value = 'flowchart TD\n  Small --> Draft'
    api.saveEditorDraft()
    editor.value = 'x'.repeat(api.MAX_DRAFT_BYTES + 1)
    api.saveEditorDraft()
    expect(localStorage.getItem(api.DRAFT_STORAGE_KEY)).toBeNull()
    expect(toasts).toContain('This diagram is too large for browser autosave. Export or copy the source to keep it.')
  })
})

describe('editor SEC-1 insertion choke point', () => {
  test('restored options are allowlisted and strict policy cannot be weakened', () => {
    const rendering = readFileSync(join(ROOT, 'editor/js/rendering.js'), 'utf8')
    expect(rendering).toContain('SHARED_RENDER_OPTION_FIELDS')
    expect(rendering).toContain('validateSerializableRenderOptions(config)')
    expect(rendering).toContain('opts.embedFontImport = false')
    expect(rendering).toContain('opts.security = "strict"')
    expect(sharingSource).toContain('new Set(["embedFontImport", "security"])')
    expect(sharingSource).toContain('!allowed.has(key) || editorOwned.has(key)')
  })

  test('SVG insertion verifies, parses, and imports a single SVG node without an HTML sink', () => {
    const rendering = readFileSync(join(ROOT, 'editor/js/rendering.js'), 'utf8')
    const insertion = rendering.match(/function insertStrictRenderedSvg\(svg\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(insertion).toContain('verifyNoExternalRefs(svg)')
    expect(insertion).toContain('new DOMParser().parseFromString(svg, "image/svg+xml")')
    expect(insertion).toContain('parsed.querySelector("parsererror")')
    expect(insertion).toContain('previewInner.replaceChildren(document.importNode(parsed.documentElement, true))')
    expect(insertion).not.toMatch(/innerHTML\s*=\s*svg/)
  })

  test('advanced options use canonical generated schema and validator with visible diagnostics', () => {
    const browser = readFileSync(join(ROOT, 'src/browser.ts'), 'utf8')
    const config = readFileSync(join(ROOT, 'editor/js/config-panel.js'), 'utf8')
    const html = readFileSync(join(ROOT, 'editor/html/left-panel.html'), 'utf8')
    expect(browser).toContain('SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema()')
    expect(config).toContain('SHARED_RENDER_OPTIONS_JSON_SCHEMA')
    expect(config).toContain('validateSerializableRenderOptions')
    expect(config).toContain('applyAdvancedOptionsJson')
    expect(config).toContain("setAdvancedOptionsStatus(problems.join('; '), 'error')")
    expect(html).toContain('id="cfg-advanced-options"')
    expect(html).toContain('id="cfg-advanced-status"')
  })

  test('PNG export uses the canonical browser request/receipt adapter and reports font failures', () => {
    const exporting = readFileSync(join(ROOT, 'editor/js/export.js'), 'utf8')
    const rendering = readFileSync(join(ROOT, 'editor/js/rendering.js'), 'utf8')
    expect(exporting).toContain('renderMermaidPngInBrowserWithReceipt(source, options, outputOptions, rasterizeCanonicalSvg)')
    expect(exporting).toContain("var pngScaleControls = document.getElementById('size-pills')")
    expect(exporting).toContain('var exportScale = Number(pngScaleControls.dataset.defaultScale)')
    expect(exporting).not.toMatch(/var exportScale = \d/)
    const topbar = readFileSync(join(ROOT, 'editor/html/topbar.html'), 'utf8')
    expect(topbar).toContain('data-default-scale="{{PNG_DEFAULT_SCALE}}"')
    expect(topbar).toContain('{{PNG_SCALE_ITEMS}}')
    expect(exporting).toContain('function currentPngOutputOptions()')
    expect(exporting).toContain('output.fitTo =')
    expect(exporting).toContain('output.background = pngBackgroundColor.value')
    expect(exporting).toContain('context.rasterDimensions.width')
    expect(exporting).toContain('context.rasterBackground')
    expect(exporting).toContain("artifact.receipt.output !== 'png'")
    expect(exporting).toContain('artifact.receipt.sharedRequestDigest !== previewDigest')
    expect(exporting).toContain('renderRequestVersion !== requestVersion')
    expect(exporting).not.toContain('expectedSharedDigest')
    expect(exporting).toContain("code: 'EDITOR_FONT_FETCH_FAILED'")
    expect(exporting).toContain("fontSources.push('embedded-data-uri')")
    expect(exporting).toContain("fontSources.push('unavailable')")
    expect(exporting).toContain('browser/system')
    expect(exporting).toContain('fontSources: serialized.fontSources')
    expect(exporting).not.toContain('function svgToPngBlob')
    expect(rendering).toContain('lastRenderedSvgArtifact = rendered')
    expect(rendering).toContain('invalidateRenderedArtifacts()')
    expect(rendering).not.toContain('ensurePreviewSvgAccessibility')
  })

  test('Editor commit points require verification and canonical receipt-bearing artifacts', () => {
    const rendering = readFileSync(join(ROOT, 'editor/js/rendering.js'), 'utf8')
    const exporting = readFileSync(join(ROOT, 'editor/js/export.js'), 'utf8')
    const buttons = readFileSync(join(ROOT, 'editor/js/buttons.js'), 'utf8')
    expect(rendering).toContain('verifyMermaid(source, { renderOptions: renderOptions })')
    expect(rendering).toContain('if (verification && verification.ok)')
    expect(rendering).toContain('function hasCurrentVerifiedSvgArtifact()')
    expect(rendering).toContain('lastRenderedSvgSource === currentEditorSource()')
    expect(rendering).toContain('RENDER_FAILED: "structural"')
    expect(rendering).toContain('ROUTE_SELF_LOOP_OCCUPANCY: "geometric"')
    expect(exporting).toContain("typeof hasCurrentVerifiedSvgArtifact === 'function'")
    expect(buttons).toContain('writeClipboardText(lastRenderedSvgArtifact.svg')
    expect(buttons).not.toContain('new XMLSerializer().serializeToString(svgEl)')
    expect(rendering).toContain('state.style !== "crisp" && opts.seed === undefined')
    expect(rendering).toContain('INEFFECTIVE_CONFIG: "lint"')
    expect(rendering).toContain('if (!hasCurrentVerifiedSvgArtifact())')
    expect(exporting).toContain('if (!hasRenderedSvg()) return;')
    const sharing = readFileSync(join(ROOT, 'editor/js/sharing.js'), 'utf8')
    const darkMode = readFileSync(join(ROOT, 'editor/js/dark-mode.js'), 'utf8')
    const init = readFileSync(join(ROOT, 'editor/js/init.js'), 'utf8')
    expect(sharing).toContain('function safeLocalStorageGet(key)')
    expect(darkMode).not.toMatch(/\blocalStorage\.(?:getItem|setItem|removeItem)/)
    expect(init).not.toMatch(/\blocalStorage\.(?:getItem|setItem|removeItem)/)
  })
})
