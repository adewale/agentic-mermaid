// Engine-free editor facade. All rendering is owned by one persistent worker;
// DOM/font/Canvas capabilities remain explicit main-thread callbacks.
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from './render-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, knownStyleDescriptors, knownStyles, getStyle } from './scene/style-registry.ts'
import { resolveEditorRenderOptions } from './editor-render-options.ts'
import { PreviewSupersededError } from './browser-preview-errors.ts'
import type { PreviewWorkerClient } from './browser-preview-client.ts'
import type { AsciiRenderOptions } from './ascii/index.ts'
import type { RenderOptions } from './types.ts'
import type { BrowserPngRasterizer } from './browser-png.ts'
import type { PortablePngOutputOptions } from './png-contract.ts'

export function createBrowserEditorAdapter(load: () => PreviewWorkerClient | Promise<PreviewWorkerClient>) {
  let generation = 0, loaded: PreviewWorkerClient | undefined
  async function execute<T>(operation: (client: PreviewWorkerClient) => Promise<T>): Promise<T> {
    const requested = generation
    const client = await load()
    loaded = client
    if (requested !== generation) throw new PreviewSupersededError()
    return operation(client)
  }
  return {
    renderMermaidSVGWithReceipt(source: string, options: RenderOptions = {}) {
      const snapshot = structuredClone(options)
      return execute(client => client.render(source, snapshot))
    },
    cancelPendingRender() { generation++; loaded?.invalidate() },
    renderMermaidASCIIWithReceipt(source: string, options: AsciiRenderOptions = {}) {
      const snapshot = structuredClone(options)
      return execute(client => client.renderText(source, snapshot, true))
    },
    renderMermaidUnicodeWithReceipt(source: string, options: AsciiRenderOptions = {}) {
      const snapshot = structuredClone(options)
      return execute(client => client.renderText(source, snapshot, false))
    },
    renderMermaidPNGInBrowserWithReceipt(source: string, options: RenderOptions, output: number | PortablePngOutputOptions, rasterize: BrowserPngRasterizer) {
      const snapshot = structuredClone({ options, output })
      return execute(client => client.renderPng(source, snapshot.options, snapshot.output, rasterize))
    },
    SHARED_RENDER_OPTION_FIELDS,
    STYLE_COLOR_TOKEN_FIELDS: Object.freeze(Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS)),
    SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema(),
    validateSerializableRenderOptions, verifyNoExternalRefs, WARNING_TIER, WARNING_SEVERITY, knownStyleDescriptors, knownStyles, getStyle, resolveEditorRenderOptions,
  }
}
