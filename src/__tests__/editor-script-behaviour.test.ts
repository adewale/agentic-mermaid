/**
 * Behavioural contracts for the Editor's classic scripts, executed in-process
 * through browser-script-harness.ts. Each test drives the shipped script via
 * its real entry points (render-option resolution, the advanced-options Apply
 * button, the PNG export adapter boundary, the verify panel, storage access)
 * and asserts what a user or a downstream receipt would observe.
 *
 * The two lints at the end are deliberately structural: they encode security
 * invariants (no rendered SVG in an HTML-string sink; Web Storage reached only
 * through the guarded adapter) across every editor script, and each carries a
 * teeth check against a synthetic violation.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BROWSER_EDITOR_ADAPTER } from '../browser.ts'
import { resolveEditorRenderOptions } from '../editor-render-options.ts'
import { PNG_DEFAULT_SCALE } from '../png-contract.ts'
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from '../render-contract.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { WARNING_TIER } from '../agent/types.ts'
import { evaluateBrowserScript, FakeDocument, type FakeElement } from './browser-script-harness.ts'

const ROOT = join(import.meta.dir, '..', '..')
const EDITOR_JS = join(ROOT, 'editor', 'js')
const editorScript = (name: string) => readFileSync(join(EDITOR_JS, name), 'utf8')

function editorScriptFiles(dir = EDITOR_JS): Array<{ file: string; text: string }> {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return editorScriptFiles(path)
    return name.endsWith('.js') ? [{ file: relative(ROOT, path), text: readFileSync(path, 'utf8') }] : []
  })
}

function codeLines(text: string): string[] {
  return text.split('\n').map(line => line.replace(/\/\/.*$/, ''))
}

describe('editor render-option boundary', () => {
  const dependencies = {
    allowedFields: SHARED_RENDER_OPTION_FIELDS,
    validate: validateSerializableRenderOptions,
    resolvePaletteInput: (palette: unknown) => (palette === 'paper' ? 'paper' : ''),
  }

  test('hostile restored config cannot weaken strict security, embed font imports, or smuggle host fields', () => {
    const resolved = resolveEditorRenderOptions({
      palette: 'paper',
      style: 'crisp',
      config: {
        security: 'default',
        embedFontImport: true,
        bogusHostOption: '<script>window.__pwned = 1</script>',
        padding: 12,
        bg: '#ffffff',
      },
    }, dependencies) as Record<string, unknown>
    expect(resolved.security).toBe('strict')
    expect(resolved.embedFontImport).toBe(false)
    expect(resolved).not.toHaveProperty('bogusHostOption')
    expect(resolved).toMatchObject({ padding: 12, bg: '#ffffff', style: 'paper' })
    expect(resolved).not.toHaveProperty('seed')

    // Inherited properties are not own config and never cross the allowlist.
    const inherited = Object.create({ security: 'default', padding: 99 }) as Record<string, unknown>
    expect(resolveEditorRenderOptions({ config: inherited }, dependencies)).toEqual({ embedFontImport: false, security: 'strict' })
    // Non-object config shapes are ignored rather than trusted.
    for (const config of [null, 'security=default', ['security'], 42]) {
      expect(resolveEditorRenderOptions({ config }, dependencies)).toEqual({ embedFontImport: false, security: 'strict' })
    }
  })

  test('invalid allowlisted values are refused instead of rendered', () => {
    expect(() => resolveEditorRenderOptions({ config: { padding: 'huge' } }, dependencies))
      .toThrow('Invalid render options: render option "padding" must be a non-negative finite number')
    expect(() => resolveEditorRenderOptions({ config: { bg: 'url(https://attacker.invalid/x)' } }, dependencies))
      .toThrow(/"bg" must be a safe, non-fetching CSS paint/)
  })

  test('styled looks carry the shared seed while crisp stays unseeded', () => {
    expect(resolveEditorRenderOptions({ style: 'hand-drawn', seed: 7 }, dependencies)).toMatchObject({ style: 'hand-drawn', seed: 7 })
    expect(resolveEditorRenderOptions({ style: 'hand-drawn' }, dependencies)).toMatchObject({ style: 'hand-drawn', seed: 0 })
    expect(resolveEditorRenderOptions({ style: 'hand-drawn', seed: Number.NaN }, dependencies)).toMatchObject({ seed: 0 })
    expect(resolveEditorRenderOptions({ style: 'crisp', seed: 7 }, dependencies)).not.toHaveProperty('seed')
  })
})

describe('editor advanced options panel', () => {
  function configPanel() {
    const document = new FakeDocument()
    const input = document.element('textarea', { id: 'cfg-advanced-options' })
    const apply = document.element('button', { id: 'cfg-advanced-apply' })
    const schema = document.element('p', { id: 'cfg-advanced-schema' })
    const status = document.element('p', { id: 'cfg-advanced-status' })
    const state = { palette: '', config: { padding: 30 } as Record<string, unknown> }
    const renders: number[] = []
    evaluateBrowserScript(editorScript('config-panel.js'), {
      document,
      // The exact object the global bundle installs on window.__mermaid.
      window: { __mermaid: BROWSER_EDITOR_ADAPTER, innerWidth: 1280, innerHeight: 900, addEventListener() {} },
      state,
      editorPaletteColors: () => null,
      scheduleRender: (delay: number) => { renders.push(delay) },
      configView: null,
    }, 'null')
    return { input, apply, schema, status, state, renders }
  }

  test('advertises exactly the canonical generated option schema', () => {
    const { schema } = configPanel()
    const fields = Object.keys(sharedRenderOptionsJsonSchema().properties as Record<string, unknown>)
    expect(schema.textContent).toBe(`${fields.length} canonical fields: ${fields.join(', ')}`)
  })

  test('malformed JSON and canonically invalid options show diagnostics and change nothing', () => {
    const { input, apply, status, state, renders } = configPanel()
    input.value = '{ "padding": '
    apply.click()
    expect(status.textContent).toStartWith('Invalid JSON: ')
    expect(status.classList.contains('is-error')).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')

    for (const candidate of [{ padding: -5 }, { bogusHostOption: true }, { bg: 'url(https://attacker.invalid/x)' }]) {
      input.value = JSON.stringify(candidate)
      apply.click()
      const expected = validateSerializableRenderOptions(candidate).join('; ')
      expect(expected.length).toBeGreaterThan(0)
      expect({ candidate, status: status.textContent }).toEqual({ candidate, status: expected })
      expect(status.classList.contains('is-error')).toBe(true)
    }
    expect(state.config).toEqual({ padding: 30 })
    expect(renders).toEqual([])
  })

  test('valid options become the render config and schedule an immediate render', () => {
    const { input, apply, status, state, renders } = configPanel()
    input.value = JSON.stringify({ padding: 24, bg: '#ffffff' })
    apply.click()
    expect(state.config).toEqual({ padding: 24, bg: '#ffffff' })
    expect(status.textContent).toBe('Applied 2 canonical options.')
    expect(status.classList.contains('is-ok')).toBe(true)
    expect(status.classList.contains('is-error')).toBe(false)
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(renders).toContain(0)
  })
})

interface ExportApi {
  currentPngOutputOptions(): Record<string, unknown>
  embeddedFontCss(svg: FakeElement): Promise<{ css: string; diagnostics: Array<Record<string, unknown>>; fontSources: string[] }>
  serializeCanonicalSvg(svg: string): Promise<{ svg: string; diagnostics: unknown[]; fontSources: string[] }>
  canonicalBrowserPng(output: Record<string, unknown>): Promise<unknown>
  exportPNG(): void
  exportSVG(): void
  copyPNG(): void
  setRenderRequestVersion(version: number): void
}

class FakeFontFaceRule {
  constructor(readonly family: string, readonly url: string) {}
  get cssText() { return `@font-face { font-family: "${this.family}"; src: url("${this.url}") format("truetype"); }` }
  readonly style = { getPropertyValue: (name: string) => (name === 'font-family' ? `"${this.family}"` : '') }
}

function exportHarness(options: {
  defaultScale?: string
  verified?: boolean
  adapter?: (...args: unknown[]) => Promise<unknown>
  fetch?: (url: string) => Promise<Response>
} = {}) {
  const document = new FakeDocument()
  const pills = document.element('div', { id: 'size-pills', 'data-default-scale': options.defaultScale ?? String(PNG_DEFAULT_SCALE) })
  const pill = (scale: number) => document.element('button', { class: 'size-pill', 'data-scale': String(scale) }, pills)
  const scalePills = [1, PNG_DEFAULT_SCALE, 4].map(pill)
  for (const id of ['export-dropdown', 'export-main-btn', 'export-chevron-btn', 'export-png-btn', 'export-svg-btn', 'copy-png-btn', 'copy-link-btn']) {
    document.element('button', { id })
  }
  const control = (tag: string, id: string, value: string) => Object.assign(document.element(tag, { id }), { value })
  const fitMode = control('select', 'png-fit-mode', 'scale')
  const fitValue = control('input', 'png-fit-value', '1024')
  const backgroundMode = control('select', 'png-background-mode', 'artifact')
  const backgroundColor = control('input', 'png-background-color', '#ffffff')
  const previewInner = document.element('div', { id: 'preview-inner' })
  previewInner.dataset.sharedRequestDigest = 'digest-current'
  const editor = { value: 'flowchart TD\n  A --> B' }
  const toasts: string[] = []
  const adapterCalls: unknown[][] = []
  const fetched: string[] = []
  const adapter = options.adapter ?? (async () => ({ png: new Uint8Array([1]), diagnostics: [], receipt: { output: 'png', sharedRequestDigest: 'digest-current' } }))
  const api = evaluateBrowserScript<ExportApi>(`var renderRequestVersion = 1;\n${editorScript('export.js')}`, {
    document,
    window: { __mermaid: { verifyNoExternalRefs } },
    createPopupController: () => ({ setOpen() {}, isOpen: () => false }),
    hasCurrentVerifiedSvgArtifact: () => options.verified !== false,
    currentEditorSource: () => editor.value.trim(),
    previewInner,
    buildOptions: () => ({ security: 'strict', embedFontImport: false }),
    renderMermaidPngInBrowserWithReceipt: (...args: unknown[]) => { adapterCalls.push(args); return adapter(...args) },
    lastRenderedSvgArtifact: null,
    showToast: (message: string) => { toasts.push(message) },
    setCopyFeedback: () => {},
    updateHash: () => Promise.resolve(false),
    writeClipboardText: () => {},
    navigator: { clipboard: { write: () => Promise.reject(new Error('clipboard must not be reached')) } },
    ClipboardItem: class {},
    fetch: (url: string) => { fetched.push(url); return (options.fetch ?? (() => Promise.reject(new Error('offline'))))(url) },
    CSSFontFaceRule: FakeFontFaceRule,
    DOMParser: class {
      parseFromString(markup: string) {
        const root = document.createElementNS('http://www.w3.org/2000/svg', markup.trimStart().startsWith('<svg') ? 'svg' : 'div')
        return { querySelector: () => null, documentElement: root }
      }
    },
    XMLSerializer: class { serializeToString(node: FakeElement) { return `<${node.localName}>${node.textContent}</${node.localName}>` } },
  }, `{
    currentPngOutputOptions, embeddedFontCss, serializeCanonicalSvg, canonicalBrowserPng,
    exportPNG, exportSVG, copyPNG,
    setRenderRequestVersion: function(version) { renderRequestVersion = version; },
  }`)
  return { api, document, pills, scalePills, fitMode, fitValue, backgroundMode, backgroundColor, previewInner, editor, toasts, adapterCalls, fetched }
}

describe('editor PNG export contract', () => {
  test('the default scale is the generated control value, and scale pills replace it', () => {
    expect(exportHarness().api.currentPngOutputOptions()).toEqual({ scale: PNG_DEFAULT_SCALE })
    // A non-default generated value proves the scale is read, not assumed.
    const three = exportHarness({ defaultScale: '3' })
    expect(three.api.currentPngOutputOptions()).toEqual({ scale: 3 })
    three.scalePills[2]!.click()
    expect(three.api.currentPngOutputOptions()).toEqual({ scale: 4 })
    expect(three.scalePills.map(p => p.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    expect(() => exportHarness({ defaultScale: 'large' })).toThrow('Invalid canonical PNG default scale')
    expect(() => exportHarness({ defaultScale: '0' })).toThrow('Invalid canonical PNG default scale')
  })

  test('fit and background controls produce canonical portable output options', () => {
    const { api, fitMode, fitValue, backgroundMode, backgroundColor } = exportHarness()
    fitMode.value = 'width'
    fitValue.value = '800'
    backgroundMode.value = 'explicit'
    backgroundColor.value = '#102030'
    expect(api.currentPngOutputOptions()).toEqual({ scale: PNG_DEFAULT_SCALE, fitTo: { width: 800 }, background: '#102030' })
    fitMode.value = 'height'
    expect(api.currentPngOutputOptions()).toMatchObject({ fitTo: { height: 800 } })
    for (const invalid of ['0', '-1', '12.5', 'wide']) {
      fitValue.value = invalid
      expect(() => api.currentPngOutputOptions()).toThrow('PNG fit size must be a positive integer number of pixels')
    }
  })

  test('PNG export goes through the canonical browser adapter with the current request', async () => {
    const { api, adapterCalls, toasts } = exportHarness()
    api.exportPNG()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(adapterCalls).toHaveLength(1)
    const [source, options, output, rasterize] = adapterCalls[0]!
    expect({ source, options, output }).toEqual({
      source: 'flowchart TD\n  A --> B',
      options: { security: 'strict', embedFontImport: false },
      output: { scale: PNG_DEFAULT_SCALE },
    })
    expect(typeof rasterize).toBe('function')
    expect(toasts).toEqual(['PNG saved.'])
  })

  test('a font that cannot be fetched becomes a diagnostic with unavailable font provenance', async () => {
    const svg = new FakeDocument().createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.setProperty('--font', "'Caveat', cursive")
    const failing = exportHarness()
    failing.document.styleSheets = [
      { cssRules: [new FakeFontFaceRule('Caveat', '/fonts/Caveat.ttf'), new FakeFontFaceRule('Unused', '/fonts/Unused.ttf')] },
      { get cssRules() { throw new Error('cross-origin stylesheet') } },
    ]
    const failed = await failing.api.embeddedFontCss(svg)
    expect(failing.fetched).toEqual(['https://agentic-mermaid.test/fonts/Caveat.ttf'])
    expect(failed.css).toBe('')
    expect(failed.fontSources).toEqual(['unavailable'])
    expect(failed.diagnostics).toEqual([{
      code: 'EDITOR_FONT_FETCH_FAILED',
      resource: 'https://agentic-mermaid.test/fonts/Caveat.ttf',
      message: 'Could not embed font resource https://agentic-mermaid.test/fonts/Caveat.ttf: offline',
    }])

    const embedding = exportHarness({ fetch: async () => new Response(new Uint8Array([0, 1, 2, 3])) })
    embedding.document.styleSheets = failing.document.styleSheets
    const embedded = await embedding.api.embeddedFontCss(svg)
    expect(embedded.diagnostics).toEqual([])
    expect(embedded.css).toContain('url(data:font/ttf;base64,AAECAw==)')
    // Canvas cannot prove which fallback bytes were used, so browser
    // provenance always retains the unavailable marker alongside embedding.
    expect(embedded.fontSources).toEqual(['embedded-data-uri', 'unavailable'])
  })

  test('SVG export refuses renderer output with external or active references', () => {
    const { api } = exportHarness()
    expect(() => api.serializeCanonicalSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>'))
      .toThrow('Unsafe SVG export: inline-event-handler')
    expect(() => api.serializeCanonicalSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.invalid/x.png"/></svg>'))
      .toThrow(/Unsafe SVG export: .*attacker\.invalid/)
  })

  test('PNG bytes whose receipt does not match the current preview request are refused', async () => {
    const receipt = (overrides: Record<string, unknown> = {}) => ({ png: new Uint8Array([1]), diagnostics: [], receipt: { output: 'png', sharedRequestDigest: 'digest-current', ...overrides } })
    await expect(exportHarness({ adapter: async () => receipt() }).api.canonicalBrowserPng({ scale: 2 })).resolves.toMatchObject({ receipt: { sharedRequestDigest: 'digest-current' } })

    const stale = exportHarness({ adapter: async () => receipt({ sharedRequestDigest: 'digest-older' }) })
    await expect(stale.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('PNG bytes and preview receipt do not describe the same render request')

    const nonPng = exportHarness({ adapter: async () => receipt({ output: 'svg' }) })
    await expect(nonPng.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('PNG export returned a non-PNG receipt')

    const unverifiedPreview = exportHarness()
    delete unverifiedPreview.previewInner.dataset.sharedRequestDigest
    await expect(unverifiedPreview.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('do not describe the same render request')

    let previewChanged: ReturnType<typeof exportHarness> | undefined
    previewChanged = exportHarness({ adapter: async () => { previewChanged!.previewInner.dataset.sharedRequestDigest = 'digest-rerendered'; return receipt() } })
    await expect(previewChanged.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('do not describe the same render request')

    let versionBumped: ReturnType<typeof exportHarness> | undefined
    versionBumped = exportHarness({ adapter: async () => { versionBumped!.api.setRenderRequestVersion(2); return receipt() } })
    await expect(versionBumped.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('Diagram changed while PNG export was rendering; try again.')

    let sourceEdited: ReturnType<typeof exportHarness> | undefined
    sourceEdited = exportHarness({ adapter: async () => { sourceEdited!.editor.value = 'flowchart TD\n  A --> C'; return receipt() } })
    await expect(sourceEdited.api.canonicalBrowserPng({ scale: 2 })).rejects.toThrow('Diagram changed while PNG export was rendering; try again.')
  })

  test('export and copy commit points do nothing without a current verified artifact', async () => {
    const { api, adapterCalls, toasts } = exportHarness({ verified: false })
    api.exportPNG()
    api.exportSVG()
    api.copyPNG()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(adapterCalls).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('editor verify panel', () => {
  function verifyPanel(verifyMermaid: (source: string, options: unknown) => unknown) {
    const document = new FakeDocument()
    const element = (id: string) => document.element('div', { id })
    const nodes = {
      verifySummary: element('verify-summary'),
      verifyTierStructural: element('verify-tier-structural'),
      verifyTierGeometric: element('verify-tier-geometric'),
      verifyTierLint: element('verify-tier-lint'),
      verifyStructural: element('verify-structural'),
      verifyGeometric: element('verify-geometric'),
      verifyLint: element('verify-lint'),
      verifyDetailsBtn: element('verify-details-btn'),
      verifyDetails: element('verify-details'),
      verifyDetailsList: element('verify-details-list'),
    }
    const api = evaluateBrowserScript<{ updateVerifyPanel(source: string, options: unknown): unknown }>(
      `${editorScript('helpers.js')}\n${editorScript('rendering.js')}`,
      { document, window: {}, verifyMermaid, ...nodes },
      '{ updateVerifyPanel }',
    )
    return { api, nodes }
  }

  test('every canonical warning code is counted in its canonical tier', () => {
    const observed: Record<string, string> = {}
    for (const code of Object.keys(WARNING_TIER)) {
      const { api, nodes } = verifyPanel(() => ({ ok: true, warnings: [{ code }] }))
      api.updateVerifyPanel('flowchart TD\n  A --> B', {})
      const counted = [
        nodes.verifyStructural.textContent === '1 warning' ? 'structural' : null,
        nodes.verifyGeometric.textContent === '1 advisory' ? 'geometric' : null,
        nodes.verifyLint.textContent === '1 note' ? 'lint' : null,
      ].filter(Boolean)
      observed[code] = counted.length === 1 ? counted[0]! : `ambiguous:${counted.join('+')}`
    }
    expect(observed).toEqual({ ...WARNING_TIER })
  })

  test('only a verified result with no warnings is reported as clean', () => {
    const clean = verifyPanel(() => ({ ok: true, warnings: [] }))
    clean.api.updateVerifyPanel('flowchart TD\n  A --> B', {})
    expect(clean.nodes.verifySummary.textContent).toBe('Verified: no warnings')
    const blocked = verifyPanel(() => ({ ok: false, warnings: [{ code: 'RENDER_FAILED' }] }))
    blocked.api.updateVerifyPanel('flowchart TD', {})
    expect(blocked.nodes.verifySummary.textContent).toBe('Fix structural warnings before export')
    expect(blocked.nodes.verifyTierStructural.classList.contains('err')).toBe(true)
  })
})

describe('editor storage adapter', () => {
  test('guarded accessors and draft persistence survive Storage that throws on every call', () => {
    const denied = new Proxy({}, { get() { throw new DOMException('storage denied', 'SecurityError') } })
    const toasts: string[] = []
    const api = evaluateBrowserScript<Record<string, (...args: unknown[]) => unknown>>(editorScript('sharing.js'), {
      window: { location: { hash: '', pathname: '/editor/', search: '' }, history: { replaceState() {} }, __mermaid: {} },
      localStorage: denied,
      sessionStorage: denied,
      editor: { value: 'flowchart TD\n  A --> B' },
      state: { palette: 'paper', style: 'crisp', seed: 0, config: {} },
      document: { getElementById: () => null },
      showToast: (message: string) => { toasts.push(message) },
      DEFAULT_EDITOR_PALETTE: 'paper',
    }, '{ safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove, saveEditorDraft, readEditorDraft, discardEditorDraft }')
    expect(api.safeLocalStorageGet!('bm-editor-dark')).toBeNull()
    expect(api.safeLocalStorageSet!('bm-editor-dark', 'true')).toBe(false)
    expect(api.safeLocalStorageRemove!('bm-editor-dark')).toBe(false)
    expect(() => api.saveEditorDraft!()).not.toThrow()
    expect(api.readEditorDraft!()).toBeNull()
    expect(() => api.discardEditorDraft!()).not.toThrow()
    expect(toasts).toEqual([])
  })
})

// ── Security lints over every editor script ──────────────────────────────────

const HTML_STRING_SINK = /\.(?:innerHTML|outerHTML)\s*\+?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(|\bcreateContextualFragment\s*\(|\bsrcdoc\s*=/

function svgHtmlSinkFindings(files: Array<{ file: string; text: string }>): string[] {
  return files.flatMap(({ file, text }) => codeLines(text).flatMap((line, index) => {
    const findings: string[] = []
    const sink = line.match(HTML_STRING_SINK)
    if (sink && /svg/i.test(line.slice(sink.index! + sink[0].length))) findings.push(`${file}:${index + 1}: rendered SVG reaches an HTML-string sink`)
    if (/\bparseFromString\s*\(/.test(line) && !/['"]image\/svg\+xml['"]/.test(line)) findings.push(`${file}:${index + 1}: DOMParser must parse SVG as image/svg+xml`)
    return findings
  }))
}

const STORAGE_ADAPTER = 'editor/js/sharing.js'

function unguardedStorageFindings(files: Array<{ file: string; text: string }>): string[] {
  return files.flatMap(({ file, text }) => codeLines(text).flatMap((line, index) => {
    if (!/\b(?:localStorage|sessionStorage)\b/.test(line)) return []
    // The adapter itself may touch Storage only inside a same-line try block.
    if (file === STORAGE_ADAPTER && /\btry\s*\{/.test(line)) return []
    return [`${file}:${index + 1}: ${line.trim()}`]
  }))
}

describe('editor security lints', () => {
  test('rendered SVG never reaches an HTML-string sink in any editor script', () => {
    expect(svgHtmlSinkFindings(editorScriptFiles())).toEqual([])
    // Teeth: each banned shape is caught.
    expect(svgHtmlSinkFindings([{ file: 'x.js', text: [
      'previewInner.innerHTML = svg;',
      'target.insertAdjacentHTML("beforeend", rendered.svg);',
      'var parsed = new DOMParser().parseFromString(svg, "text/html");',
      'previewInner.innerHTML = emptyPreviewHtml(); // svg in a comment is fine',
    ].join('\n') }])).toEqual([
      'x.js:1: rendered SVG reaches an HTML-string sink',
      'x.js:2: rendered SVG reaches an HTML-string sink',
      'x.js:3: DOMParser must parse SVG as image/svg+xml',
    ])
  })

  test('editor scripts reach Web Storage only through the guarded adapter', () => {
    expect(unguardedStorageFindings(editorScriptFiles())).toEqual([])
    expect(unguardedStorageFindings([
      { file: 'editor/js/dark-mode.js', text: 'var stored = localStorage.getItem("bm-editor-dark");' },
      { file: STORAGE_ADAPTER, text: 'function leak() { return sessionStorage.getItem(DRAFT_STORAGE_KEY); }\n  try { return localStorage.getItem(key); } catch (e) { return null; }' },
    ])).toEqual([
      'editor/js/dark-mode.js:1: var stored = localStorage.getItem("bm-editor-dark");',
      `${STORAGE_ADAPTER}:1: function leak() { return sessionStorage.getItem(DRAFT_STORAGE_KEY); }`,
    ])
  })
})
