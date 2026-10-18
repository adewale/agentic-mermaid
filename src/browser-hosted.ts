// Hosted editor: keep the empty editor independent of rendering engines.
// Feature modules are fetched when the corresponding operation is requested.
import { renderMermaidSVGWithReceiptAsync, renderMermaidSVGAsync } from './browser-lazy.ts'
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from './render-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, knownStyles, knownStyleDescriptors, getStyle } from './scene/style-registry.ts'
import { resolveEditorRenderOptions } from './editor-render-options.ts'
import { getSeriesColor, CHART_ACCENT_FALLBACK } from './xychart/colors.ts'
import type { AsciiRenderOptions } from './ascii/index.ts'
import type { RenderOptions } from './types.ts'

let verifier: typeof import('./agent/verify.ts').verifyMermaid | undefined

const adapter = {
  renderMermaidSVGAsync,
  async renderMermaidSVGWithReceipt(source: string, options: RenderOptions = {}) {
    const [artifact, verification] = await Promise.all([
      renderMermaidSVGWithReceiptAsync(source, options),
      import('./agent/verify.ts'),
    ])
    verifier = verification.verifyMermaid
    return artifact
  },
  verifyMermaid(...args: Parameters<NonNullable<typeof verifier>>) {
    if (!verifier) throw new Error('Render the diagram before verification')
    return verifier(...args)
  },
  async renderMermaidASCIIWithReceipt(source: string, options: AsciiRenderOptions = {}) {
    return (await import('./ascii/index.ts')).renderMermaidASCIIWithReceipt(source, options)
  },
  async renderMermaidUnicodeWithReceipt(source: string, options: AsciiRenderOptions = {}) {
    return (await import('./ascii/index.ts')).renderMermaidASCIIWithReceipt(source, { ...options, useAscii: false })
  },
  async renderMermaidPNGInBrowserWithReceipt(...args: Parameters<typeof import('./browser-png.ts').renderMermaidPNGInBrowserWithReceipt>) {
    return (await import('./browser-png.ts')).renderMermaidPNGInBrowserWithReceipt(...args)
  },
  SHARED_RENDER_OPTION_FIELDS,
  STYLE_COLOR_TOKEN_FIELDS: Object.freeze(Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS)),
  SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema(),
  validateSerializableRenderOptions,
  verifyNoExternalRefs,
  WARNING_TIER,
  WARNING_SEVERITY,
  knownStyles,
  knownStyleDescriptors,
  getStyle,
  getSeriesColor,
  CHART_ACCENT_FALLBACK,
  resolveEditorRenderOptions,
}

;(globalThis as unknown as { __mermaid: typeof adapter }).__mermaid = adapter
