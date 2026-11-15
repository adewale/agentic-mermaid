import { createSettlement } from '../shared/settlement.ts'
import { SourceRenderProcess } from './source-render-process.ts'
import { sourceToolMessage, type LocalSourceToolName, type SourceToolReply, type SourceToolRequest } from './source-tool-message.ts'
import { SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE, SOURCE_TOOL_EXIT_MEMORY, SOURCE_TOOL_QUEUE_BYTES, SOURCE_TOOL_QUEUE_LIMIT, SOURCE_TOOL_REQUEST_BYTES, SOURCE_TOOL_TIMEOUT_MS } from './source-worker-limits.ts'

export { SOURCE_TOOL_HEAP_MB,SOURCE_TOOL_TIMEOUT_MS } from './source-worker-limits.ts'

type Payload = { ok: boolean } & Record<string, unknown>
const failure = (code: string, message: string): Payload => ({ ok: false, error: { code, message } })
export interface RenderProcess {
  on(event: string, listener: (...args: any[]) => void): unknown
  postMessage(message: SourceToolRequest): void
  terminate(): void
  ref(): void
  unref(): void
}
interface Job {
  bytes: number
  id: number
  json: string
  deadline: number
  timeoutMs: number
  finish(payload: Payload): void
}
export interface SourceToolExecutionOptions { signal?: AbortSignal; timeoutMs?: number }

/** One warm renderer and at most 32 waiting calls sharing 16 MiB of serialized
 * payloads. The active call retains its own request budget. Deadlines include queue and
 * startup; a timed-out/cancelled generation remains retired until it closes. */
export class SourceToolExecutor {
  private readonly queue: Job[] = []
  private active: Job | undefined
  private renderer: RenderProcess | undefined
  private retiring = false
  private nextId = 0
  private queuedBytes = 0
  private readonly createRenderer: () => RenderProcess

  constructor(createRenderer: () => RenderProcess = () => new SourceRenderProcess()) { this.createRenderer = createRenderer }

  run(name: LocalSourceToolName, args: Record<string, unknown>, options: SourceToolExecutionOptions = {}): Promise<Payload> {
    return new Promise(resolve => {
      const signal = options.signal
      if (signal?.aborted) { resolve(failure('RENDER_CANCELLED', 'Operation cancelled')); return }
      if (this.queue.length >= SOURCE_TOOL_QUEUE_LIMIT) { resolve(failure('RENDER_BUSY', 'Rendering queue is full; retry later')); return }
      let json: string
      try { json = sourceToolMessage({ name, args }, SOURCE_TOOL_REQUEST_BYTES) }
      catch { resolve(failure('RENDER_REQUEST_LIMIT', 'Rendering request exceeds the process message budget or is not JSON')); return }
      const bytes = Buffer.byteLength(json)
      const timeoutMs = options.timeoutMs ?? SOURCE_TOOL_TIMEOUT_MS
      // Serialization and option access may run getters/toJSON which submit or
      // cancel other calls. Commit admission only against their resulting state.
      const admissionFailure = (): Payload | undefined => {
        if (signal?.aborted) return failure('RENDER_CANCELLED', 'Operation cancelled')
        if (this.queue.length >= SOURCE_TOOL_QUEUE_LIMIT) return failure('RENDER_BUSY', 'Rendering queue is full; retry later')
        if (this.queuedBytes + bytes > SOURCE_TOOL_QUEUE_BYTES) return failure('RENDER_BUSY', 'Rendering queue payload budget is full; retry later')
        return undefined
      }
      const refused = admissionFailure()
      if (refused) { resolve(refused); return }
      const completion = createSettlement<Payload>(resolve)
      const job: Job = { bytes, id: ++this.nextId, json, deadline: Date.now() + timeoutMs, timeoutMs, finish: payload => { completion.finish(payload) } }
      completion.onCleanup(() => {
        const index = this.queue.indexOf(job)
        if (index >= 0) { this.queue.splice(index, 1); this.queuedBytes -= job.bytes }
        if (this.active === job) { this.active = undefined; this.retire() }
      })
      const abort = () => job.finish(failure('RENDER_CANCELLED', 'Operation cancelled'))
      const timer = setTimeout(() => this.timeout(job), timeoutMs)
      completion.onCleanup(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort) })
      signal?.addEventListener('abort', abort, { once: true })
      if (!completion.pending) return
      // A host-provided signal can also reenter while registering its listener.
      const afterListening = admissionFailure()
      if (afterListening) { job.finish(afterListening); return }
      this.queuedBytes += bytes
      this.queue.push(job)
      this.pump()
    })
  }

  private timeout(job: Job): void { job.finish(failure('RENDER_TIMEOUT', `Operation exceeded ${job.timeoutMs}ms`)) }

  private retire(): void {
    if (!this.renderer || this.retiring) return
    this.retiring = true
    this.renderer.terminate()
  }

  private pump(): void {
    if (this.active || this.retiring || !this.queue.length) return
    const job = this.queue.shift()!
    this.queuedBytes -= job.bytes
    if (Date.now() >= job.deadline) { this.timeout(job); this.pump(); return }
    if (!this.renderer) {
      let child: RenderProcess
      try { child = this.createRenderer() }
      catch { job.finish(failure('RENDER_WORKER_FAILED', 'Could not start rendering process')); this.pump(); return }
      this.renderer = child
      child.on('message', (message: SourceToolReply) => {
        const job = this.active
        if (this.renderer !== child || this.retiring || !job || message.type !== 'result' || message.id !== job.id) return
        // Timer delivery can be delayed by a busy parent event loop. Enforce
        // the deadline at receipt as well, before accepting a late success.
        if (Date.now() >= job.deadline) { this.timeout(job); return }
        let payload: Payload
        try {
          payload = JSON.parse(message.json)
          if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.ok !== 'boolean') throw new Error('Invalid rendering response shape')
        } catch { this.active = undefined; this.retire(); job.finish(failure('RENDER_WORKER_FAILED', 'Invalid rendering response')); return }
        if (Date.now() >= job.deadline) { this.timeout(job); return }
        this.active = undefined
        child.unref()
        job.finish(payload)
        this.pump()
      })
      child.on('error', () => {
        if (this.renderer !== child) return
        const job = this.active
        this.active = undefined
        this.retire()
        job?.finish(failure('RENDER_WORKER_FAILED', 'Could not start or communicate with rendering process'))
      })
      child.on('exit', (code: number | null) => {
        if (this.renderer !== child) return
        const job = this.active
        this.active = undefined
        this.renderer = undefined
        this.retiring = false
        job?.finish(failure(code === SOURCE_TOOL_EXIT_MEMORY ? 'RENDER_MEMORY_LIMIT' : code === SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE ? 'RENDER_LIMIT_UNAVAILABLE' : 'RENDER_WORKER_FAILED', code === SOURCE_TOOL_EXIT_MEMORY ? 'Rendering exceeded its memory budget' : code === SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE ? 'The runtime cannot enforce the rendering resource policy' : 'Rendering process exited without a result'))
        this.pump()
      })
    }
    this.active = job
    this.renderer.ref()
    try { this.renderer.postMessage({ type: 'request', id: job.id, json: job.json }) }
    catch { this.active = undefined; this.retire(); job.finish(failure('RENDER_WORKER_FAILED', 'Could not send rendering request')) }
  }
}

const executor = new SourceToolExecutor()
export function runSourceToolIsolated(name: LocalSourceToolName, args: Record<string, unknown>, options?: SourceToolExecutionOptions): Promise<Payload> { return executor.run(name, args, options) }
