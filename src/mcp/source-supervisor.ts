import { Worker } from 'node:worker_threads'
import {
  SOURCE_TOOL_EXIT_FAILED, SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE, SOURCE_TOOL_EXIT_MEMORY,
  SOURCE_TOOL_MEMORY_BYTES, SOURCE_TOOL_MEMORY_POLL_MS, SOURCE_TOOL_REQUEST_BYTES, SOURCE_TOOL_RESULT_BYTES,
} from './source-worker-limits.ts'
import type { SourceToolReply, SourceToolRequest } from './source-tool-message.ts'
import { registeredEmbeddedFontResourceFiles } from '../agent/embedded-font-registry.ts'

declare const __AM_STANDALONE__: boolean

export function runSourceSupervisor(): void {
  if (!process.send) throw new Error('Rendering supervisor requires a parent IPC channel')
  let worker: Worker | undefined
  let stopped = false
  let monitor: ReturnType<typeof setInterval> | undefined
  const stop = (code: number): never => {
    stopped = true
    clearInterval(monitor)
    process.exit(code)
  }
  const send = (message: object) => {
    if (stopped) return
    try { process.send!(message, error => { if (error) stop(SOURCE_TOOL_EXIT_FAILED) }) }
    catch { stop(SOURCE_TOOL_EXIT_FAILED) }
  }
  process.on('disconnect', () => stop(0))
  process.once('message', (initial: { type: string; worker?: string; memoryBudgetBytes?: number }) => {
    if (initial.type !== 'initialize') stop(SOURCE_TOOL_EXIT_FAILED)
    const budget = initial.memoryBudgetBytes ?? SOURCE_TOOL_MEMORY_BYTES
    if (!Number.isSafeInteger(budget) || budget <= 0 || budget > SOURCE_TOOL_MEMORY_BYTES) stop(SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE)
    const checkMemory = () => {
      try { if (process.memoryUsage.rss() > budget) stop(SOURCE_TOOL_EXIT_MEMORY) }
      catch { stop(SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE) }
    }
    // Sampling observes the whole process, including native buffers. It is a
    // best-effort budget; a busy event loop or an allocation can overshoot it.
    checkMemory()
    monitor = setInterval(checkMemory, SOURCE_TOOL_MEMORY_POLL_MS)
    const standalone = typeof __AM_STANDALONE__ !== 'undefined' && __AM_STANDALONE__
    try {
      // Bun compiles additional entries under their project-relative .js path.
      // The compiled CLI's import.meta.url names the executable at that root.
      // A standalone host's embedded PNG fonts are registered in this thread;
      // the renderer thread has its own module state.
      const options = { execArgv: [], workerData: { embeddedFonts: registeredEmbeddedFontResourceFiles() } }
      worker = initial.worker ? new Worker(new URL(initial.worker), options)
        : standalone ? new Worker(new URL('./src/mcp/source-worker.js', import.meta.url), options)
        : new Worker(new URL(import.meta.url.endsWith('.ts') ? './source-worker.ts' : './source-worker.js', import.meta.url), options)
    }
    catch { stop(SOURCE_TOOL_EXIT_FAILED) }
    worker!.on('error', (error: Error & { code?: string }) => stop(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? SOURCE_TOOL_EXIT_MEMORY : SOURCE_TOOL_EXIT_FAILED))
    worker!.on('exit', () => { if (!stopped) stop(SOURCE_TOOL_EXIT_FAILED) })
    worker!.on('message', (message: SourceToolReply | { type: 'ready'; heapLimitBytes?: number } | { type: 'unavailable' }) => {
      if (message.type === 'unavailable') stop(SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE)
      checkMemory()
      if (message.type === 'result') {
        if (typeof message.json !== 'string' || Buffer.byteLength(message.json) > SOURCE_TOOL_RESULT_BYTES) stop(SOURCE_TOOL_EXIT_FAILED)
      }
      send(message)
    })
    process.on('message', (message: SourceToolRequest) => {
      if (stopped) return
      if (message.type !== 'request' || !Number.isSafeInteger(message.id) || typeof message.json !== 'string' || Buffer.byteLength(message.json) > SOURCE_TOOL_REQUEST_BYTES) stop(SOURCE_TOOL_EXIT_FAILED)
      try { worker!.postMessage(message) } catch { stop(SOURCE_TOOL_EXIT_FAILED) }
    })
  })
  send({ type: 'bootstrap' })
}

// A script entry for both installed Node/Bun packages and repository Bun runs.
// The standalone CLI imports this function for its internal child mode.
if (process.send) runSourceSupervisor()
