import { SourceRenderProcess } from './source-render-process.ts'
import type { SourceToolName } from './source-tools.ts'
import { SOURCE_TOOL_QUEUE_LIMIT, SOURCE_TOOL_TIMEOUT_MS } from './source-worker-limits.ts'
export { SOURCE_TOOL_TIMEOUT_MS, SOURCE_TOOL_HEAP_MB } from './source-worker-limits.ts'

type Payload = { ok: boolean } & Record<string, unknown>
const failure = (code: string, message: string): Payload => ({ ok: false, error: { code, message } })
interface Job {
  name: SourceToolName
  args: Record<string, unknown>
  finish(payload: Payload): void
}
const queue: Job[] = []
let active: Job | undefined
let renderer: SourceRenderProcess | undefined
let starting = false
let retiring = false
let bundledNodeSource: Promise<string> | undefined
declare const __AM_NODE_WORKER_SOURCE__: string

async function rendererSource(): Promise<string | URL> {
  if (typeof __AM_NODE_WORKER_SOURCE__ === 'string') return __AM_NODE_WORKER_SOURCE__
  if (!import.meta.url.endsWith('.ts')) return new URL('./source-worker.js', import.meta.url)
  // Only repository source execution needs a build. Published packages launch
  // their existing JS entry; standalone binaries embed it at build time.
  const helper = new URL('../../scripts/build/bundle-source-worker.ts', import.meta.url).href
  return bundledNodeSource ??= import(helper).then(module => module.bundleNodeSourceWorker()).catch(error => { bundledNodeSource = undefined; throw error })
}

function pump(): void {
  if (active || starting || retiring || queue.length === 0) return
  if (renderer) {
    active = queue.shift()!
    renderer.ref()
    renderer.postMessage({ name: active.name, args: active.args })
    return
  }
  starting = true
  void rendererSource().then(source => {
    starting = false
    if (!queue.length) return
    const child = new SourceRenderProcess(source)
    renderer = child
    child.on('message', (payload: Payload) => {
      if (renderer !== child || retiring) return
      const job = active
      active = undefined
      if ((payload.error as { code?: string } | undefined)?.code === 'RENDER_LIMIT_UNAVAILABLE') retire()
      else child.unref()
      job?.finish(payload)
      pump()
    })
    child.on('error', (error: Error & { code?: string }) => {
      if (renderer !== child) return
      const job = active
      active = undefined
      retire()
      const unavailable = error.code === 'ENOENT' || error.code === 'NODE_RUNTIME_UNSUPPORTED'
      job?.finish(failure(unavailable ? 'WORKER_RUNTIME_UNAVAILABLE' : 'RENDER_WORKER_FAILED', unavailable ? 'Capped MCP rendering requires Node 22 or later on PATH' : 'Rendering process failed'))
    })
    child.on('exit', (_code: number | null, signal: string | null) => {
      if (renderer !== child) return
      const job = active
      active = undefined
      renderer = undefined
      retiring = false
      job?.finish(failure(signal === 'SIGABRT' ? 'RENDER_MEMORY_LIMIT' : 'RENDER_WORKER_FAILED', signal === 'SIGABRT' ? 'Rendering process aborted at its heap limit' : 'Rendering process exited without a result'))
      pump()
    })
    pump()
  }, () => {
    starting = false
    queue.shift()?.finish(failure('RENDER_WORKER_FAILED', 'Could not prepare rendering process'))
    pump()
  })
}

function retire(): void {
  if (!renderer || retiring) return
  retiring = true
  renderer.terminate()
  // The slot remains occupied until exit, including after cancellation.
}

export interface SourceToolExecutionOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/** One warm renderer and at most 32 waiting calls. The deadline includes queue
 * and startup time; cancelling a waiting call never interrupts another call. */
export function runSourceToolIsolated(name: SourceToolName, args: Record<string, unknown>, options: SourceToolExecutionOptions = {}): Promise<Payload> {
  return new Promise(resolve => {
    if (options.signal?.aborted) { resolve(failure('RENDER_CANCELLED', 'Operation cancelled')); return }
    if (queue.length >= SOURCE_TOOL_QUEUE_LIMIT) { resolve(failure('RENDER_BUSY', 'Rendering queue is full; retry later')); return }
    let settled = false
    const job: Job = { name, args, finish(payload) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      const index = queue.indexOf(job)
      if (index >= 0) queue.splice(index, 1)
      if (active === job) { active = undefined; retire() }
      resolve(payload)
    } }
    const abort = () => job.finish(failure('RENDER_CANCELLED', 'Operation cancelled'))
    const timeoutMs = options.timeoutMs ?? SOURCE_TOOL_TIMEOUT_MS
    const timer = setTimeout(() => job.finish(failure('RENDER_TIMEOUT', `Operation exceeded ${timeoutMs}ms`)), timeoutMs)
    options.signal?.addEventListener('abort', abort, { once: true })
    queue.push(job)
    pump()
  })
}
