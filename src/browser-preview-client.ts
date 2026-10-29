import type { RenderOptions } from './types.ts'
import type { AsciiRenderOptions, RenderedAscii } from './ascii/index.ts'
import type { BrowserPngDiagnostic, BrowserPngRasterizer, BrowserPngRuntimeProvenance, RenderedBrowserPng } from './browser-png.ts'
import type { PortablePngOutputOptions } from './png-contract.ts'
import type { ApplyOpsInput, OpEnvelope } from './agent/apply.ts'
import type { EditorWorkerArtifact, EditorWorkerOperation, PreviewArtifact, PreviewWorkerRequest, PreviewWorkerResponse } from './browser-editor-protocol.ts'
import { assertBrowserPngByteBudget, browserRuntimeProvenance, intrinsicTypedArrayByteLength } from './browser-png-runtime.ts'
import { DIAGRAM_WORK_LIMITS } from './shared/diagram-limits.ts'
import { PreviewSupersededError, PreviewRuntimeLoadError } from './browser-preview-errors.ts'
export { PreviewSupersededError } from './browser-preview-errors.ts'
export type { PreviewArtifact, PreviewWorkerRequest, PreviewWorkerResponse } from './browser-editor-protocol.ts'

type PreviewWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>
interface Pending {
  request: PreviewWorkerRequest
  resolve: (artifact: EditorWorkerArtifact) => void
  reject: (error: Error) => void
  rasterize?: BrowserPngRasterizer
  rasterizing?: boolean
  superseded?: boolean
  rasterResult?: { diagnostics: readonly BrowserPngDiagnostic[]; runtime: BrowserPngRuntimeProvenance }
}

/** One active operation, one replaceable preview and at most four exports.
 * Monotonic request IDs order exports fairly with the newest pending preview.
 * PNG's main-thread Canvas callback stays inside the active transaction. */
export class PreviewWorkerClient {
  private worker?: PreviewWorker
  private active?: Pending
  private queued?: Pending
  private exports: Pending[] = []
  private timer?: ReturnType<typeof setTimeout>
  private nextId = 0

  constructor(private readonly createWorker: () => PreviewWorker, private readonly timeoutMs = 30_000) {}

  render(source: string, options: RenderOptions): Promise<PreviewArtifact> {
    return this.submit({ operation: 'preview', source, options })
  }

  renderText(source: string, options: AsciiRenderOptions, useAscii: boolean): Promise<RenderedAscii> {
    return this.submit({ operation: useAscii ? 'ascii' : 'unicode', source, options })
  }

  applyOps(source: string, ops: unknown, mode?: ApplyOpsInput['mode']): Promise<OpEnvelope> {
    return this.submit<{ mutation: OpEnvelope }>({ operation: 'mutate', source, options: {}, ops, mode }).then(artifact => artifact.mutation)
  }

  renderPng(source: string, options: RenderOptions, output: number | PortablePngOutputOptions, rasterize: BrowserPngRasterizer): Promise<RenderedBrowserPng> {
    return this.submit({ operation: 'png', source, options, output }, rasterize)
  }

  private submit<T extends EditorWorkerArtifact>(operation: EditorWorkerOperation, rasterize?: BrowserPngRasterizer): Promise<T> {
    return new Promise((resolve, reject) => {
      if (typeof operation.source !== 'string' || operation.source.length > DIAGRAM_WORK_LIMITS.sourceCharacters) throw new Error('Editor source must be a string within the diagram source budget')
      if (operation.operation === 'png' && typeof rasterize !== 'function') throw new TypeError('browser PNG rasterizer must be a function')
      const snapshot = structuredClone(operation)
      if (snapshot.operation === 'preview') this.cancelPending()
      else if (this.exports.length >= 4) throw new Error('Background export queue is full; wait for the current export')
      const pending: Pending = { request: { ...snapshot, id: ++this.nextId }, resolve: value => resolve(value as T), reject, rasterize }
      if (snapshot.operation === 'preview') this.queued = pending
      else this.exports.push(pending)
      this.drain()
    })
  }

  cancelPending(): void {
    this.queued?.reject(new PreviewSupersededError())
    this.queued = undefined
  }

  /** Source/config changes discard stale exports. Synchronous worker work may
   * finish, but a waiting Canvas callback cannot hold up the newest preview. */
  invalidate(): void {
    this.cancelPending()
    for (const pending of this.exports) pending.reject(new PreviewSupersededError())
    this.exports = []
    const active = this.active
    if (active && active.request.operation !== 'preview') {
      active.superseded = true
      // A font/Canvas callback may still be awaiting I/O. Reject its worker
      // continuation now so the newest preview does not wait for that I/O.
      if (active.rasterizing && !active.rasterResult) this.cancelRaster(active)
    }
  }

  dispose(error = new Error('Background renderer stopped')): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.worker?.terminate()
    this.worker = undefined
    this.active?.reject(error)
    this.queued?.reject(error)
    for (const pending of this.exports) pending.reject(error)
    this.active = this.queued = undefined
    this.exports = []
  }

  private drain(): void {
    if (this.active || (!this.queued && !this.exports.length)) return
    if (this.exports.length && (!this.queued || this.exports[0]!.request.id < this.queued.request.id)) this.active = this.exports.shift()
    else { this.active = this.queued; this.queued = undefined }
    try {
      if (!this.worker) {
        let worker: PreviewWorker
        try { worker = this.createWorker() }
        catch (error) { throw new PreviewRuntimeLoadError('Background renderer could not start; reload the editor to retry', { cause: error }) }
        this.worker = worker
        worker.onmessage = event => { if (worker === this.worker) this.receive(worker, event.data) }
        worker.onerror = event => { event.preventDefault(); if (worker === this.worker) this.dispose(new PreviewRuntimeLoadError('Background renderer failed to start or crashed; reload the editor to retry')) }
        worker.onmessageerror = () => { if (worker === this.worker) this.dispose(new Error('Background renderer returned an unreadable response')) }
      }
      this.timer = setTimeout(() => this.dispose(new Error('Background render exceeded 30 seconds; simplify the diagram and retry')), this.timeoutMs)
      this.worker.postMessage(this.active!.request)
    } catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))) }
  }

  private receive(worker: PreviewWorker, response: PreviewWorkerResponse): void {
    try {
      if (!response || typeof response !== 'object') throw new Error('Background renderer returned an unreadable response')
      const pending = this.active
      if (!pending || response.id !== pending.request.id) return
      if ('kind' in response) {
        if (response.kind !== 'rasterize' || pending.request.operation !== 'png' || pending.rasterizing || !pending.rasterize) throw new Error('Unexpected background raster request')
        pending.rasterizing = true
        if (pending.superseded) { this.cancelRaster(pending); return }
        void this.rasterize(worker, pending, response)
        return
      }
      if (response.ok !== true && response.ok !== false) throw new Error('Background renderer returned an unreadable response')
      // Failed imports poison the worker's module map even when an edit has
      // superseded the operation. Reset that state before draining queued work.
      if (!response.ok && response.dependencyLoadFailed) { worker.terminate(); this.worker = undefined }
      if (pending.superseded) {
        clearTimeout(this.timer); this.timer = undefined; this.active = undefined
        pending.reject(new PreviewSupersededError()); this.drain(); return
      }
      if (response.ok) {
        if (pending.request.operation === 'mutate') {
          if (!('mutation' in response.artifact) || typeof response.artifact.mutation?.ok !== 'boolean') throw new Error('Background editor returned an unreadable mutation result')
        } else {
          const expectedOutput = pending.request.operation === 'preview' ? 'svg' : pending.request.operation
          if (!('receipt' in response.artifact) || response.artifact.receipt?.output !== expectedOutput) throw new Error('Background renderer returned the wrong output receipt')
          if (pending.request.operation === 'png') {
            if (!pending.rasterResult || !('png' in response.artifact) || !(response.artifact.png instanceof Uint8Array)) throw new Error('Background PNG returned without a completed raster callback')
            response.artifact = Object.freeze({ ...response.artifact,
              diagnostics: Object.freeze([...response.artifact.diagnostics, ...pending.rasterResult.diagnostics]), runtime: pending.rasterResult.runtime })
          }
        }
      }
      clearTimeout(this.timer); this.timer = undefined
      this.active = undefined
      if (response.ok) pending.resolve(response.artifact)
      else pending.reject(response.dependencyLoadFailed ? new PreviewRuntimeLoadError(response.error) : new Error(response.error))
      this.drain()
    } catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))) }
  }

  private cancelRaster(pending: Pending): void {
    try { this.worker?.postMessage({ id: pending.request.id, kind: 'rasterized', ok: false, error: new PreviewSupersededError().message }) }
    catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))) }
  }

  private async rasterize(worker: PreviewWorker, pending: Pending, message: Extract<PreviewWorkerResponse, { kind: 'rasterize' }>): Promise<void> {
    try {
      // The callback receives its own context. It cannot raise the budget used
      // to admit its result, or mutate the worker's output policy/receipt.
      const result = await pending.rasterize!(message.svg, structuredClone(message.context))
      if (worker !== this.worker || pending !== this.active || pending.superseded) return
      const png = result?.png, diagnostics = result?.diagnostics, fontSources = result?.fontSources
      if (!(png instanceof Uint8Array)) throw new TypeError('browser PNG rasterizer must return Uint8Array bytes')
      assertBrowserPngByteBudget(png, message.context.rasterDimensions)
      const runtime = browserRuntimeProvenance(fontSources)
      // Never detach caller-owned buffers, invoke a subclass iterator/species,
      // or copy an oversized allocation into another realm. Transfer our copy.
      const copy = new Uint8Array(intrinsicTypedArrayByteLength(png))
      Uint8Array.prototype.set.call(copy, png)
      pending.rasterResult = { diagnostics: Object.freeze([...(diagnostics ?? [])]), runtime }
      if (worker !== this.worker || pending !== this.active || pending.superseded) return
      worker.postMessage({ id: pending.request.id, kind: 'rasterized', ok: true, png: copy }, [copy.buffer])
    } catch (error) {
      if (worker !== this.worker || pending !== this.active || pending.superseded) return
      try { worker.postMessage({ id: pending.request.id, kind: 'rasterized', ok: false, error: error instanceof Error ? error.message : String(error) }) }
      catch (failure) { this.dispose(failure instanceof Error ? failure : new Error(String(failure))) }
    }
  }
}
/** Each Blob URL is owned by one worker attempt, including failed starts. */
export function createPreviewWorker(url: string): Worker {
  let released = false
  const release = () => { if (!released && url.startsWith('blob:')) { released = true; URL.revokeObjectURL(url) } }
  let worker: Worker
  try { worker = new Worker(url, { type: 'module', name: 'agentic-mermaid-preview' }) }
  catch (error) { release(); throw error }
  if (url.startsWith('blob:')) {
    worker.addEventListener('message', release, { once: true })
    worker.addEventListener('error', release, { once: true })
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { release(); terminate() }
  }
  return worker
}
