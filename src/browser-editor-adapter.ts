// Engine-free editor facade. All rendering is owned by one persistent worker;
// DOM/font/Canvas capabilities remain explicit main-thread callbacks.
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from './render-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, knownStyleDescriptors, knownStyles, getStyle } from './scene/style-registry.ts'
import { resolveAuthoredEditorOptions, type EditorRenderStateInput } from './editor-option-policy.ts'
import { PreviewSupersededError, PreviewRuntimeLoadError } from './browser-preview-errors.ts'
import type { PreviewWorkerClient } from './browser-preview-client.ts'
import type { AsciiRenderOptions } from './ascii/index.ts'
import type { RenderOptions } from './types.ts'
import type { BrowserPngRasterizer } from './browser-png.ts'
import type { PortablePngOutputOptions } from './png-contract.ts'
import type { ApplyOpsInput } from './agent/apply.ts'

export function createBrowserEditorAdapter(load: () => PreviewWorkerClient | Promise<PreviewWorkerClient>, onRuntimeStatus?: (available: boolean) => void) {
  let generation = 0, loaded: PreviewWorkerClient | undefined
  let fittingOptions: typeof resolveAuthoredEditorOptions | undefined, preparingOptions: Promise<void> | undefined
  async function execute<T>(operation: (client: PreviewWorkerClient) => Promise<T>): Promise<T> {
    const requested = generation
    try {
      const client = await load()
      loaded = client
      if (requested !== generation) throw new PreviewSupersededError()
      const artifact = await operation(client)
      if (requested === generation) onRuntimeStatus?.(true)
      return artifact
    } catch (error) {
      if (requested === generation && error instanceof PreviewRuntimeLoadError) onRuntimeStatus?.(false)
      throw error
    }
  }
  return {
    prepareEditorRenderOptions(state: EditorRenderStateInput) {
      if (!state.fitLabelsToPane) return
      const requested = generation
      return (preparingOptions ??= import('./editor-render-options.ts').then(module => { fittingOptions = module.resolveEditorRenderOptions }).catch(error => {
        preparingOptions = undefined
        throw new PreviewRuntimeLoadError('Label-fitting support could not load; reload the editor to retry', { cause: error })
      })).catch(error => {
        if (requested === generation) onRuntimeStatus?.(false)
        throw error
      })
    },
    resolveEditorRenderOptions: (...args: Parameters<typeof resolveAuthoredEditorOptions>) => (fittingOptions ?? resolveAuthoredEditorOptions)(...args),
    applyOps(source: string, ops: unknown, mode?: ApplyOpsInput['mode']) {
      const snapshot = structuredClone(ops)
      return execute(client => client.applyOps(source, snapshot, mode))
    },
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
    validateSerializableRenderOptions, verifyNoExternalRefs, WARNING_TIER, WARNING_SEVERITY, knownStyleDescriptors, knownStyles, getStyle,
  }
}
