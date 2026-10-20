import type { RenderOptions } from './types.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { VerifyResult } from './agent/types.ts'

export interface PreviewArtifact {
  svg: string
  receipt: RenderRequestReceipt
  verification: Pick<VerifyResult, 'ok' | 'warnings'>
  computeMs: number
}
export interface PreviewWorkerRequest { id: number; source: string; options: RenderOptions }
export type PreviewWorkerResponse = { id: number; ok: true; artifact: PreviewArtifact } | { id: number; ok: false; error: string }
type PreviewWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>
interface Pending {
  request: PreviewWorkerRequest
  resolve: (artifact: PreviewArtifact) => void
  reject: (error: Error) => void
}

export class PreviewSupersededError extends Error {
  constructor() { super('A newer preview replaced this request'); this.name = 'PreviewSupersededError' }
}

/** One active request and one replaceable pending edit. Errors fail closed;
 * the next edit can create a fresh worker after a crash or timeout. */
export class PreviewWorkerClient {
  private worker?: PreviewWorker
  private active?: Pending
  private queued?: Pending
  private timer?: ReturnType<typeof setTimeout>
  private nextId = 0

  constructor(private readonly createWorker: () => PreviewWorker, private readonly timeoutMs = 30_000) {}

  render(source: string, options: RenderOptions): Promise<PreviewArtifact> {
    return new Promise((resolve, reject) => {
      this.cancelPending()
      this.queued = { request: { id: ++this.nextId, source, options: structuredClone(options) }, resolve, reject }
      this.drain()
    })
  }

  cancelPending(): void {
    this.queued?.reject(new PreviewSupersededError())
    this.queued = undefined
  }

  dispose(error = new Error('Background renderer stopped')): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.worker?.terminate()
    this.worker = undefined
    this.active?.reject(error)
    this.queued?.reject(error)
    this.active = this.queued = undefined
  }

  private drain(): void {
    if (this.active || !this.queued) return
    this.active = this.queued
    this.queued = undefined
    try {
      if (!this.worker) {
        const worker = this.createWorker()
        this.worker = worker
        worker.onmessage = event => {
          if (worker !== this.worker) return
          const response = event.data as PreviewWorkerResponse
          if (!response || response.id !== this.active?.request.id) return
          clearTimeout(this.timer)
          this.timer = undefined
          const pending = this.active!
          this.active = undefined
          if (response.ok) pending.resolve(response.artifact)
          else pending.reject(new Error(response.error))
          this.drain()
        }
        worker.onerror = event => { event.preventDefault(); if (worker === this.worker) this.dispose(new Error('Background renderer failed to start or crashed; edit again to retry')) }
        worker.onmessageerror = () => { if (worker === this.worker) this.dispose(new Error('Background renderer returned an unreadable response')) }
      }
      this.timer = setTimeout(() => this.dispose(new Error('Background render exceeded 30 seconds; simplify the diagram and retry')), this.timeoutMs)
      this.worker.postMessage(this.active.request)
    } catch (error) {
      this.dispose(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

declare const AM_PREVIEW_WORKER_URL: string
const client = new PreviewWorkerClient(() => {
  const url = AM_PREVIEW_WORKER_URL
  const worker = new Worker(url, { type: 'module', name: 'agentic-mermaid-preview' })
  if (url.startsWith('blob:')) {
    const release = () => URL.revokeObjectURL(url)
    worker.addEventListener('message', release, { once: true })
    worker.addEventListener('error', release, { once: true })
  }
  return worker
})
export const renderEditorPreview = (source: string, options: RenderOptions = {}): Promise<PreviewArtifact> => client.render(source, options)
export const cancelPendingEditorPreview = (): void => client.cancelPending()
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => client.dispose())
