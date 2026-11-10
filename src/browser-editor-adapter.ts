// Engine-free editor facade. All rendering is owned by one persistent worker;
// DOM/font/Canvas capabilities remain explicit main-thread callbacks.
import { SHARED_RENDER_OPTION_FIELDS, sharedRenderOptionsJsonSchema, validateSerializableRenderOptions } from './render-option-contract.ts'
import { verifyNoExternalRefs } from './output-security.ts'
import type { ApplyOpsInput, OpEnvelope } from './agent/apply.ts'
import { WARNING_SEVERITY, WARNING_TIER } from './agent/types.ts'
import type { AsciiRenderOptions, RenderedAscii } from './ascii/index.ts'
import type { EditorWorkerArtifact, EditorWorkerOperation, PreviewArtifact } from './browser-editor-protocol.ts'
import { captureEditorOperation } from './browser-editor-snapshot.ts'
import type { BrowserPngRasterizer, RenderedBrowserPng } from './browser-png.ts'
import type { PreviewWorkerClient } from './browser-preview-client.ts'
import { PreviewRuntimeLoadError, PreviewSupersededError } from './browser-preview-errors.ts'
import { resolveAuthoredEditorOptions, type EditorRenderStateInput } from './editor-option-policy.ts'
import type { PortablePngOutputOptions } from './png-contract.ts'
import { STYLE_COLOR_TOKEN_DESCRIPTORS, getStyle, knownStyleDescriptors, knownStyles } from './scene/style-registry.ts'
import type { RenderOptions } from './types.ts'

export function createBrowserEditorAdapter(load: () => PreviewWorkerClient | Promise<PreviewWorkerClient>, onRuntimeStatus?: (available: boolean) => void) {
  let generation = 0, loaded: PreviewWorkerClient | undefined
  let fittingOptions: typeof resolveAuthoredEditorOptions | undefined, preparingOptions: Promise<void> | undefined
  async function execute<T extends EditorWorkerArtifact>(operation: EditorWorkerOperation, rasterize?: BrowserPngRasterizer): Promise<T> {
    const snapshot = captureEditorOperation(operation)
    const requested = generation
    try {
      const client = await load()
      loaded = client
      if (requested !== generation) throw new PreviewSupersededError()
      const artifact = await client.submit<T>(snapshot, rasterize)
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
      return execute<{ mutation: OpEnvelope }>({ operation: 'mutate', source, options: {}, ops, mode }).then(artifact => artifact.mutation)
    },
    renderMermaidSVGWithReceipt(source: string, options: RenderOptions = {}) {
      return execute<PreviewArtifact>({ operation: 'preview', source, options })
    },
    cancelPendingRender() { generation++; loaded?.invalidate() },
    renderMermaidASCIIWithReceipt(source: string, options: AsciiRenderOptions = {}) {
      return execute<RenderedAscii>({ operation: 'ascii', source, options })
    },
    renderMermaidUnicodeWithReceipt(source: string, options: AsciiRenderOptions = {}) {
      return execute<RenderedAscii>({ operation: 'unicode', source, options })
    },
    renderMermaidPNGInBrowserWithReceipt(source: string, options: RenderOptions, output: number | PortablePngOutputOptions, rasterize: BrowserPngRasterizer) {
      return execute<RenderedBrowserPng>({ operation: 'png', source, options, output }, rasterize)
    },
    SHARED_RENDER_OPTION_FIELDS,
    STYLE_COLOR_TOKEN_FIELDS: Object.freeze(Object.keys(STYLE_COLOR_TOKEN_DESCRIPTORS)),
    SHARED_RENDER_OPTIONS_JSON_SCHEMA: sharedRenderOptionsJsonSchema(),
    validateSerializableRenderOptions, verifyNoExternalRefs, WARNING_TIER, WARNING_SEVERITY, knownStyleDescriptors, knownStyles, getStyle,
  }
}
