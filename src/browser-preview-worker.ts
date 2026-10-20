import type { EditorRasterResponse, EditorWorkerArtifact, PreviewWorkerRequest, PreviewWorkerResponse } from './browser-editor-protocol.ts'
import type { BrowserPngRasterResult } from './browser-png.ts'
import './scene/builtin-backends.ts'
import { renderAndVerifyMermaid } from './agent/verify.ts'

const host = globalThis as unknown as { onmessage: (event: MessageEvent<PreviewWorkerRequest | EditorRasterResponse>) => void; postMessage: (response: PreviewWorkerResponse, transfer?: Transferable[]) => void }
let busy = false
let raster: { id: number; resolve: (result: BrowserPngRasterResult) => void; reject: (error: Error) => void } | undefined

async function execute(request: PreviewWorkerRequest): Promise<EditorWorkerArtifact> {
  const { source, options } = request
  switch (request.operation) {
    case 'preview': {
      const started = performance.now()
      const result = renderAndVerifyMermaid(source, { ...options, security: 'strict', embedFontImport: false })
      return { svg: result.svg, receipt: result.receipt,
        verification: { ok: result.verification.ok, warnings: result.verification.warnings, checks: result.verification.checks }, computeMs: performance.now() - started }
    }
    case 'ascii': case 'unicode': {
      const { renderMermaidASCIIWithReceipt } = await import('./ascii/index.ts')
      const artifact = renderMermaidASCIIWithReceipt(source, { ...options, useAscii: request.operation === 'ascii' })
      return { text: artifact.text, receipt: artifact.receipt, terminalStyle: artifact.terminalStyle, outputPolicy: artifact.outputPolicy }
    }
    case 'png': {
      const { renderMermaidPNGInBrowserWithReceipt } = await import('./browser-png.ts')
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
    host.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally { raster = undefined; busy = false }
}
