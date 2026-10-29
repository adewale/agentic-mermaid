import { editorModuleScript } from './helpers/editor-module-harness.ts'
/**
 * Behavioural contracts for the Editor's modules, executed in-process
 * through browser-script-harness.ts. Each test drives the shipped script via
 * its real entry points (render-option resolution, the advanced-options Apply
 * button, the PNG export adapter boundary, the verify panel, storage access)
 * and asserts what a user or a downstream receipt would observe.
 *
 * Live SVG insertion is exercised by editor-site-interactions.e2e.test.ts;
 * this suite covers export admission and failure-tolerant storage behavior.
 */
import { describe, expect, test } from 'bun:test'
import { BROWSER_EDITOR_ADAPTER } from '../browser.ts'
import { resolveEditorRenderOptions } from '../editor-render-options.ts'
import { PNG_DEFAULT_SCALE } from '../png-contract.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from '../render-contract.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { WARNING_TIER } from '../agent/types.ts'
import { evaluateBrowserScript, FakeDocument, manualTimers, type FakeElement } from './browser-script-harness.ts'

const moduleScripts = new Map(await Promise.all(['font-picker.js', 'config-panel.js', 'export.js', 'helpers.js', 'rendering.js', 'sharing.js'].map(async name => [name, await editorModuleScript(name)] as const)))
const editorScript = (name: string) => moduleScripts.get(name)!

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

  test('pane fitting is opt-in, family-specific and subordinate to authored budgets', () => {
    const host = { fitLabelsToPane: true, paneWidth: 360.9 }
    for (const [family, source] of [['pie', '---\ntitle: Example\n---\npie title Team\n"Done": 2'], ['radar', '%% comment\nradar-beta\naxis a,b,c']] as const) {
      expect(resolveEditorRenderOptions({ ...host, source }, dependencies)).toHaveProperty(`${family}.maxWidth`, 360)
      expect(resolveEditorRenderOptions({ ...host, source, fitLabelsToPane: false }, dependencies)).not.toHaveProperty(family)
      const config = { [family]: { maxWidth: 640 } }
      expect(resolveEditorRenderOptions({ ...host, source, config }, dependencies)).toHaveProperty(`${family}.maxWidth`, 640)
      expect(config).toEqual({ [family]: { maxWidth: 640 } })
    }
    expect(resolveEditorRenderOptions({ ...host, source: 'flowchart TD\nA-->B' }, dependencies)).not.toHaveProperty('pie')
    expect(resolveEditorRenderOptions({ ...host, source: 'flowchart TD\nA-->B' }, dependencies)).not.toHaveProperty('radar')
    for (const paneWidth of [0, Number.NaN, Infinity]) {
      expect(resolveEditorRenderOptions({ ...host, source: 'pie', paneWidth }, dependencies)).not.toHaveProperty('pie')
    }
  })
})

describe('editor generated font catalog consumer', () => {
  test('hosted, system and loaded fonts retain labels, filtering, selection and render behavior', () => {
    const hosted = [...new Set(HOSTED_FONT_RESOURCES.map(font => font.family))]
      .map(family => ({ name: family, value: family, group: 'Self-hosted' }))
    const catalog = [...hosted,
      { name: 'System UI', value: 'system-ui', group: 'System' },
      { name: 'Arial', value: 'Arial', group: 'System' },
      { name: 'Georgia', value: 'Georgia', group: 'System' },
      { name: 'Courier New', value: 'Courier New', group: 'System' },
    ]
    const document = Object.assign(new FakeDocument(), {
      fonts: new Set([{ family: '"Browser Family"' }, { family: '"Browser Family"' }]),
    })
    for (const id of ['font-popup', 'font-search', 'font-list', 'font-select-btn', 'font-select-label', 'cfg-padding', 'cfg-padding-slider']) {
      document.element(id === 'font-select-btn' ? 'button' : 'div', { id })
    }
    const list = document.getElementById('font-list')!
    Object.defineProperty(list, 'innerHTML', { set: () => list.replaceChildren() })
    const applied: string[] = [], renders: number[] = []
    let closes = 0
    const picker = evaluateBrowserScript<{ openFontPopup(): void; readonly font: string }>(editorScript('font-picker.js'), {
      document,
      EDITOR_PRESET_FONTS: catalog,
      cfgFont: hosted[0]!.value,
      createPopupController: (options: { beforeOpen(): void }) => ({
        open: () => options.beforeOpen(), close: () => { closes++ },
      }),
      positionAnchoredPopup: () => {},
      readConfig: () => applied.push(picker.font),
      scheduleRender: (delay: number) => renders.push(delay),
    }, '({ openFontPopup, get font() { return cfgFont } })')
    picker.openFontPopup()
    const items = list.querySelectorAll('.font-item')
    expect(items.map(item => item.querySelector('.font-item-name')!.textContent))
      .toEqual([...catalog.map(font => font.name), 'Browser Family'])
    expect(list.querySelectorAll('.font-section-label').map(label => label.textContent))
      .toEqual(['Self-hosted', 'System', 'Loaded in browser'])
    for (const [index, font] of catalog.entries()) {
      expect(items[index]!.getAttribute('role')).toBe('option')
      expect(items[index]!.getAttribute('aria-selected')).toBe(String(index === 0))
      expect(items[index]!.querySelector('.font-item-preview')!.style.fontFamily).toBe(`${font.value}, sans-serif`)
    }
    items[catalog.findIndex(font => font.value === 'system-ui')]!.click()
    expect(picker.font).toBe('system-ui')
    expect(document.getElementById('font-select-label')!.textContent).toBe('System UI')
    expect(document.activeElement).toBe(document.getElementById('font-select-btn'))
    const search = document.getElementById('font-search')!
    search.value = 'courier'
    search.dispatch('input')
    expect(list.querySelectorAll('.font-item-name').map(item => item.textContent)).toEqual(['Courier New'])
    list.querySelector('.font-item')!.click()
    expect(picker.font).toBe('Courier New')
    expect(applied).toEqual(['system-ui', 'Courier New'])
    expect(renders).toEqual([0, 0])
    expect(closes).toBe(2)
  })
})

describe('editor advanced options panel', () => {
  function configPanel() {
    const document = new FakeDocument()
    const input = document.element('textarea', { id: 'cfg-advanced-options' })
    const apply = document.element('button', { id: 'cfg-advanced-apply' })
    const schema = document.element('p', { id: 'cfg-advanced-schema' })
    const status = document.element('p', { id: 'cfg-advanced-status' })
    const fitLabels = Object.assign(document.element('input', { id: 'cfg-fit-labels' }), { checked: false })
    const state = { palette: '', config: { padding: 30 } as Record<string, unknown>, fitLabelsToPane: false }
    const renders: number[] = []
    const saved: unknown[][] = []
    evaluateBrowserScript(editorScript('config-panel.js'), {
      document,
      // The exact object the global bundle installs on window.__mermaid.
      window: { __mermaid: BROWSER_EDITOR_ADAPTER, innerWidth: 1280, innerHeight: 900, addEventListener() {} },
      state,
      editorPaletteColors: () => null,
      scheduleRender: (delay: number) => { renders.push(delay) },
      safeLocalStorageGet: () => null,
      safeLocalStorageSet: (...args: unknown[]) => { saved.push(args) },
      configView: null,
    }, 'null')
    return { input, apply, schema, status, state, renders, fitLabels, saved }
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

  test('pane fitting is a local preference without persisting derived render options', () => {
    const { state, fitLabels, renders, saved } = configPanel()
    expect(fitLabels.checked).toBe(false)
    fitLabels.checked = true
    fitLabels.dispatch('change')
    expect(state.fitLabelsToPane).toBe(true)
    expect(state.config).toEqual({ padding: 30 })
    expect(saved).toEqual([['bm-editor-fit-labels', 'true']])
    expect(renders).toEqual([0])
  })
})

describe('editor pane fitting lifecycle', () => {
  function panePreview(source = 'pie title Delivery\n"Completed across the organisation": 6\n"Remaining": 4', config = {}, prepare?: () => Promise<void>) {
    const document = new FakeDocument()
    const node = (id: string) => document.element('div', { id })
    const previewInner = node('preview-inner'), previewBody = node('preview-body')
    const timers = manualTimers()
    let width = 464, resized: () => void = () => {}, cancelled = 0
    previewBody.layout = () => ({ width })
    const state = { config, fitLabelsToPane: true, style: 'crisp', zoom: 1 }
    const zooms: number[] = [], automaticFits: number[] = []
    const editor = { value: source }
    const requests: Array<{ options: unknown; resolve(value: unknown): void }> = []
    let requestStarted!: () => void
    const firstRequest = new Promise<void>(resolve => { requestStarted = resolve })
    const api = evaluateBrowserScript<{
      scheduleRender(delay?: number): void; doRender(version?: number): Promise<void>
      buildOptions(): Record<string, unknown>; hasCurrentVerifiedSvgArtifact(): boolean
      readonly renderRequestVersion: number
    }>(editorScript('rendering.js'), {
      document, state, editor, previewInner, previewBody,
      window: { __mermaid: { ...BROWSER_EDITOR_ADAPTER, prepareEditorRenderOptions: prepare, cancelPendingRender: () => { cancelled++ } } },
      getComputedStyle: () => ({ paddingLeft: '32px', paddingRight: '32px' }),
      ResizeObserver: class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} },
      ...timers,
      statusText: node('status-text'), statusDot: node('status-dot'), renderTime: node('render-time'), spinner: node('spinner'),
      EditorMotion: { adaptiveRenderDelay: () => 100 },
      editorPaletteInput: () => '', cancelPreviewMotion() {}, applyZoom: (zoom: number) => { zooms.push(zoom) }, fitToView: () => { automaticFits.push(1) }, setEditorErrorLine() {},
      updateExportAvailability() {}, refreshC4Navigation() {}, refreshDiagramTools() {}, updateHash() {},
      verifyNoExternalRefs: () => ({ ok: true, refs: [] }),
      renderMermaidWithReceipt: (_source: string, options: unknown) => new Promise(resolve => { requests.push({ options, resolve }); requestStarted() }),
      DOMParser: class { parseFromString() { return { documentElement: document.createElementNS('', 'svg'), querySelector: () => null } } },
    }, '({ scheduleRender, doRender, buildOptions, hasCurrentVerifiedSvgArtifact, get renderRequestVersion() { return renderRequestVersion } })')
    const artifact = (digest: string, family = 'pie') => ({ svg: '<svg/>', receipt: { sharedRequestDigest: digest, requestDigest: digest, appearanceDigest: digest, executionDecision: { family: { id: `family:${family}` } } }, verification: { ok: true, warnings: [] } })
    return { api, state, editor, previewInner, requests, firstRequest, timers, artifact, zooms, automaticFits, cancelled: () => cancelled, resize: (next: number) => { width = next; resized() }, changeWidth: (next: number) => { width = next } }
  }

  test('fitting waits for its option loader and drops a source superseded during loading', async () => {
    let ready!: () => void
    const preparation = new Promise<void>(resolve => { ready = resolve })
    const pane = panePreview(undefined, {}, () => preparation)
    const stale = pane.api.doRender()
    expect(pane.requests).toHaveLength(0)
    pane.editor.value = 'pie title Current\n"Done": 2\n"Remaining": 1'
    pane.api.scheduleRender(0)
    ready()
    await stale
    expect(pane.requests).toHaveLength(0)
    const current = pane.api.doRender(pane.api.renderRequestVersion)
    await pane.firstRequest
    expect(pane.requests).toHaveLength(1)
    expect(pane.requests[0]!.options).toHaveProperty('pie.maxWidth', 400)
    pane.requests[0]!.resolve(pane.artifact('current'))
    await current
    expect(pane.api.hasCurrentVerifiedSvgArtifact()).toBe(true)
  })

  test('pane resizing revokes stale export authority immediately, coalesces work and rejects a pending preview', async () => {
    const pane = panePreview()
    const first = pane.api.doRender()
    pane.requests[0]!.resolve(pane.artifact('first'))
    await first
    expect(pane.requests[0]!.options).toHaveProperty('pie.maxWidth', 400)
    expect(pane.api.hasCurrentVerifiedSvgArtifact()).toBe(true)
    // Even before ResizeObserver delivers its notification, exports refuse a
    // preview whose geometry no longer describes the effective request.
    pane.changeWidth(424)
    expect(pane.api.hasCurrentVerifiedSvgArtifact()).toBe(false)
    pane.resize(424)
    expect(pane.previewInner.dataset.sharedRequestDigest).toBeUndefined()
    expect(pane.timers.pending()).toBe(1)
    const pending = pane.api.doRender(pane.api.renderRequestVersion)
    pane.resize(404)
    pane.resize(384)
    expect(pane.timers.pending()).toBe(1)
    expect(pane.cancelled()).toBe(3)
    pane.requests[1]!.resolve(pane.artifact('stale'))
    await pending
    expect(pane.previewInner.dataset.sharedRequestDigest).toBeUndefined()
    const current = pane.api.doRender(pane.api.renderRequestVersion)
    expect(pane.requests[2]!.options).toHaveProperty('pie.maxWidth', 320)
    pane.requests[2]!.resolve(pane.artifact('current'))
    await current
    expect(pane.previewInner.dataset.sharedRequestDigest).toBe('current')
    expect(pane.api.hasCurrentVerifiedSvgArtifact()).toBe(true)
  })

  test('unchanged effective budgets, explicit budgets and other families do not queue resize renders', () => {
    for (const pane of [panePreview(), panePreview('pie\n"A":1', { pie: { maxWidth: 640 } }), panePreview('flowchart TD\nA-->B')]) {
      pane.api.scheduleRender(0)
      pane.timers.flush()
      const version = pane.api.renderRequestVersion
      pane.resize(pane.api.buildOptions().pie && !(pane.state.config as { pie?: unknown }).pie ? 464 : 384)
      expect(pane.api.renderRequestVersion).toBe(version)
      expect(pane.cancelled()).toBe(1)
      pane.requests[0]!.resolve(pane.artifact('done'))
    }
  })

  test('activating pane fitting starts applicable views at full size and retains later deliberate zoom', async () => {
    const pane = panePreview()
    pane.state.zoom = 0.4 // Restored preference must also defeat initial automatic shrinking.
    async function render(family: string) {
      const job = pane.api.doRender()
      pane.requests.at(-1)!.resolve(pane.artifact(String(pane.requests.length), family))
      await job
    }
    await render('pie')
    expect(pane.zooms).toEqual([1])
    expect(pane.automaticFits).toEqual([])
    pane.state.zoom = 0.7
    pane.resize(404)
    await render('pie')
    expect(pane.zooms.at(-1)).toBe(0.7)
    // Leaving the applicable families then returning activates fitting anew.
    pane.editor.value = 'flowchart TD\nA-->B'
    await render('flowchart')
    pane.state.zoom = 0.3
    pane.editor.value = 'radar-beta\naxis a,b,c\ncurve x{1,2,3}'
    await render('radar')
    expect(pane.zooms.at(-1)).toBe(1)
    // Turning the preference off and back on also resets a deliberate zoom.
    pane.state.zoom = 0.6
    pane.state.fitLabelsToPane = false
    pane.api.scheduleRender()
    pane.state.fitLabelsToPane = true
    pane.api.scheduleRender()
    await render('radar')
    expect(pane.zooms.at(-1)).toBe(1)
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
  svgArtifact?: { svg: string; receipt: { sharedRequestDigest: string } }
  previewOptions?: Record<string, unknown>
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
  const downloads: Blob[] = []
  const revokedUrls: string[] = []
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
    lastRenderedSvgArtifact: options.svgArtifact ?? null,
    lastRenderedSvgOptions: options.previewOptions ?? null,
    URL: class extends URL {
      static createObjectURL(blob: Blob) { downloads.push(blob); return `blob:export-${downloads.length}` }
      static revokeObjectURL(url: string) { revokedUrls.push(url) }
    },
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
  return { api, document, pills, scalePills, fitMode, fitValue, backgroundMode, backgroundColor, previewInner, editor, toasts, adapterCalls, fetched, downloads, revokedUrls }
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

  test('PNG export retains the exact pane budget used by the verified preview', async () => {
    const previewOptions = { security: 'strict', embedFontImport: false, pie: { maxWidth: 360 } }
    const { api, adapterCalls } = exportHarness({ previewOptions })
    await api.canonicalBrowserPng({ scale: 2 })
    expect(adapterCalls[0]![1]).toEqual(previewOptions)
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

  test.each([false, true])('SVG download commits only while its preview receipt remains current (stale: %s)', async (stale) => {
    const { api, previewInner, downloads, revokedUrls, toasts } = exportHarness({
      svgArtifact: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', receipt: { sharedRequestDigest: 'digest-current' } },
    })
    api.exportSVG()
    if (stale) previewInner.dataset.sharedRequestDigest = 'digest-rerendered'
    await new Promise(resolve => setTimeout(resolve, 0))
    if (stale) {
      expect(downloads).toEqual([])
      expect(revokedUrls).toEqual([])
      expect(toasts).toEqual(['SVG export failed: SVG bytes and preview receipt no longer match'])
    } else {
      expect(downloads).toHaveLength(1)
      expect(downloads[0]!.type).toBe('image/svg+xml;charset=utf-8')
      expect(await downloads[0]!.text()).toBe('<svg></svg>')
      expect(revokedUrls).toEqual(['blob:export-1'])
      expect(toasts).toEqual(['SVG saved.'])
    }
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
    const api = evaluateBrowserScript<{ updateVerifyPanel(source: string, options: unknown, result?: unknown): unknown }>(
      `${editorScript('helpers.js')}\n${editorScript('rendering.js')}`,
      { document, window: { __mermaid: BROWSER_EDITOR_ADAPTER }, verifyMermaid, ...nodes },
      '{ updateVerifyPanel }',
    )
    return { api, nodes }
  }

  test('uses the preview verification without running a second verification on the UI thread', () => {
    let calls = 0
    const { api, nodes } = verifyPanel(() => { calls++; return { ok: false, warnings: [{ code: 'RENDER_FAILED' }] } })
    api.updateVerifyPanel('flowchart TD\n  A --> B', {}, { ok: true, warnings: [] })
    expect(calls).toBe(0)
    expect(nodes.verifySummary.textContent).toBe('Render checks passed: no warnings')
  })

  test('every canonical warning code is counted in its canonical tier', () => {
    const observed: Record<string, string> = {}
    for (const code of Object.keys(WARNING_TIER)) {
      const { api, nodes } = verifyPanel(() => ({ ok: true, warnings: [{ code }] }))
      api.updateVerifyPanel('flowchart TD\n  A --> B', {})
      const counted = [
        nodes.verifyStructural.textContent === '1 warning' ? 'structural' : null,
        ['1 advisory', '1 error'].includes(nodes.verifyGeometric.textContent) ? 'geometric' : null,
        ['1 note', '1 error'].includes(nodes.verifyLint.textContent) ? 'lint' : null,
      ].filter(Boolean)
      observed[code] = counted.length === 1 ? counted[0]! : `ambiguous:${counted.join('+')}`
    }
    expect(observed).toEqual({ ...WARNING_TIER })
  })

  test('only a verified result with no warnings is reported as clean', () => {
    const clean = verifyPanel(() => ({ ok: true, warnings: [] }))
    clean.api.updateVerifyPanel('flowchart TD\n  A --> B', {})
    expect(clean.nodes.verifySummary.textContent).toBe('Render checks passed: no warnings')
    const blocked = verifyPanel(() => ({ ok: false, warnings: [{ code: 'RENDER_FAILED' }] }))
    blocked.api.updateVerifyPanel('flowchart TD', {})
    expect(blocked.nodes.verifySummary.textContent).toBe('Fix verification errors before export')
    expect(blocked.nodes.verifyTierStructural.classList.contains('err')).toBe(true)
    const occluded = verifyPanel(() => ({ ok: false, warnings: [{ code: 'CONTENT_OCCLUDED', target: 'c4-rel-1', feature: 'marker', message: 'Arrow is covered' }] }))
    occluded.api.updateVerifyPanel('C4Context', {})
    expect(occluded.nodes.verifySummary.textContent).toBe('Fix verification errors before export')
    expect(occluded.nodes.verifyStructural.textContent).toBe('Clear')
    expect(occluded.nodes.verifyGeometric.textContent).toBe('1 error')
    expect(occluded.nodes.verifyTierGeometric.classList.contains('err')).toBe(true)
  })
})

describe('editor storage adapter', () => {
  test.each(['access', 'operation'] as const)('draft persistence survives denied storage %s', failure => {
    const deny = () => { throw new DOMException('storage denied', 'SecurityError') }
    const denied = failure === 'access'
      ? new Proxy({}, { get: deny })
      : { getItem: deny, setItem: deny, removeItem: deny }
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
