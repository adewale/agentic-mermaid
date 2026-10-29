import type { EditorRasterResponse, EditorWorkerArtifact, PreviewWorkerRequest, PreviewWorkerResponse } from './browser-editor-protocol.ts'
import type { BrowserPngRasterResult } from './browser-png.ts'
import { detectBuiltinFamilyFromFirstLine, installBuiltinMutationHooks } from './agent/family-registry.ts'
import { normalizeMermaidRenderSource } from './mermaid-source.ts'
import { captureRenderOptions, capturedRenderBackend } from './render-contract.ts'
import { sharedRenderOptionsOf } from './shared-render-options.ts'
import { deferredDependency } from './layout/certification-error.ts'
import { VERIFIED_FAMILY_LOADERS } from './browser-lazy/generated/verified-loaders.ts'

const host = globalThis as unknown as { onmessage: (event: MessageEvent<PreviewWorkerRequest | EditorRasterResponse>) => void; postMessage: (response: PreviewWorkerResponse, transfer?: Transferable[]) => void }
let busy = false
let raster: { id: number; resolve: (result: BrowserPngRasterResult) => void; reject: (error: Error) => void } | undefined

class DependencyLoadError extends Error {
  constructor(cause: unknown) {
    super('Diagram code could not load. Check your connection and retry, or reload the editor.', { cause })
  }
}

async function loadDependency<T>(load: () => Promise<T>): Promise<T> {
  try { return await load() }
  catch (error) { throw new DependencyLoadError(error) }
}

async function execute(request: PreviewWorkerRequest): Promise<EditorWorkerArtifact> {
  const { source, options } = request
  const family = detectBuiltinFamilyFromFirstLine(normalizeMermaidRenderSource(source, options.mermaidConfig ?? {}).firstLine)
  if (family) await loadDependency(VERIFIED_FAMILY_LOADERS[family])
  const graphicalOptions = request.operation === 'ascii' || request.operation === 'unicode' ? sharedRenderOptionsOf(options) : options
  if (capturedRenderBackend(captureRenderOptions(graphicalOptions)) !== 'default') await loadDependency(() => import('./scene/builtin-backends.ts'))
  const loaded = new Set<() => Promise<void>>()
  for (;;) {
    try { return await executeLoaded(request) }
    catch (error) {
      const deferred = deferredDependency(error)
      if (!deferred || loaded.has(deferred.load) || loaded.size >= 4) throw error
      loaded.add(deferred.load)
      await loadDependency(deferred.load)
    }
  }
}

async function executeLoaded(request: PreviewWorkerRequest): Promise<EditorWorkerArtifact> {
  const { source, options } = request
  switch (request.operation) {
    case 'mutate': {
      const [{ applyOps }, { BUILTIN_AGENT_HOOKS }] = await loadDependency(() => Promise.all([import('./agent/apply.ts'), import('./agent/families-builtin.ts')]))
      const family = detectBuiltinFamilyFromFirstLine(normalizeMermaidRenderSource(source).firstLine)
      if (family) installBuiltinMutationHooks(family, BUILTIN_AGENT_HOOKS[family])
      return { mutation: applyOps({ source, ops: request.ops, mode: request.mode }) }
    }
    case 'preview': {
      const { renderAndVerifyMermaid } = await loadDependency(() => import('./agent/verify.ts'))
      const started = performance.now()
      const result = renderAndVerifyMermaid(source, { ...options, security: 'strict', embedFontImport: false })
      return { svg: result.svg, receipt: result.receipt,
        verification: { ok: result.verification.ok, warnings: result.verification.warnings, checks: result.verification.checks }, computeMs: performance.now() - started }
    }
    case 'ascii': case 'unicode': {
      const { renderMermaidASCIIWithReceipt } = await loadDependency(() => import('./ascii/index.ts'))
      const artifact = renderMermaidASCIIWithReceipt(source, { ...options, useAscii: request.operation === 'ascii' })
      return { text: artifact.text, receipt: artifact.receipt, terminalStyle: artifact.terminalStyle, outputPolicy: artifact.outputPolicy }
    }
    case 'png': {
      const { renderMermaidPNGInBrowserWithReceipt } = await loadDependency(() => import('./browser-png.ts'))
      return renderMermaidPNGInBrowserWithReceipt(source, options, request.output, (svg, context) => new Promise((resolve, reject) => {
        raster = { id: request.id, resolve, reject }
        try { host.postMessage({ id: request.id, kind: 'rasterize', svg, context }) }
        catch (error) { raster = undefined; reject(error) }
      }))
    }
    default: throw new Error('Unknown background operation')
  }
}

// The standalone entry initializes this module only inside its worker realm.
if (typeof window === 'undefined') host.onmessage = async ({ data: request }) => {
  if (!request || !Number.isSafeInteger(request.id) || request.id <= 0) return
  if ('kind' in request) {
    if (request.kind !== 'rasterized' || request.id !== raster?.id) return
    const pending = raster; raster = undefined
    if (request.ok) pending.resolve({ png: request.png })
    else pending.reject(new Error(request.error))
    return
  }
  if (busy) { host.postMessage({ id: request.id, ok: false, error: 'Background renderer is already processing an operation' }); return }
  busy = true
  try {
    if (typeof request.source !== 'string') throw new TypeError('Background rendering requires source text')
    const artifact = await execute(request)
    host.postMessage({ id: request.id, ok: true, artifact }, 'png' in artifact ? [artifact.png.buffer as ArrayBuffer] : [])
  } catch (error) {
    host.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error), ...(error instanceof DependencyLoadError ? { dependencyLoadFailed: true as const } : {}) })
  } finally { raster = undefined; busy = false }
}
