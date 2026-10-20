// Hosted editor: keep the empty editor independent of rendering engines.
// Feature modules are fetched when the corresponding operation is requested.
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from './render-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, knownStyleDescriptors } from './scene/style-registry.ts'
import { resolveEditorRenderOptions } from './editor-render-options.ts'
import type { AsciiRenderOptions } from './ascii/index.ts'
import type { RenderOptions } from './types.ts'

let previewClient: typeof import('./browser-preview-client.ts') | undefined
let loadingPreview: Promise<typeof import('./browser-preview-client.ts')> | undefined
let previewGeneration = 0

async function renderEditorPreview(source: string, options: RenderOptions = {}) {
  const generation = previewGeneration
  const snapshot = structuredClone(options)
  const client = await (loadingPreview ??= import('./browser-preview-client.ts').then(module => previewClient = module).catch(error => { loadingPreview = undefined; throw error }))
  if (generation !== previewGeneration) throw new client.PreviewSupersededError()
  return client.renderEditorPreview(source, snapshot)
}

function cancelPendingEditorPreview() {
  previewGeneration++
  previewClient?.cancelPendingEditorPreview()
}

const adapter = {
  renderMermaidSVGWithReceipt: renderEditorPreview,
  cancelPendingRender: cancelPendingEditorPreview,
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
  knownStyleDescriptors,
  resolveEditorRenderOptions,
}

;(globalThis as unknown as { __mermaid: typeof adapter }).__mermaid = adapter
