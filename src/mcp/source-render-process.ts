import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { SOURCE_TOOL_CHILD_ARG, SOURCE_TOOL_MEMORY_BYTES, SOURCE_TOOL_NODE_FLAGS } from './source-worker-limits.ts'
import type { SourceToolRequest } from './source-tool-message.ts'

declare const __AM_STANDALONE__: boolean

export interface SourceRenderProcessOptions {
  executable?: string
  supervisor?: URL
  worker?: URL
  memoryBudgetBytes?: number
  nodeFlags?: readonly string[]
}

/** The current runtime starts a supervisor and worker. Compiled Bun programs
 * reexecute themselves; installed/source runs pass their actual script entry. */
export class SourceRenderProcess extends EventEmitter {
  private readonly child: ChildProcess
  private ready = false
  private closed = false
  private readonly pending: SourceToolRequest[] = []

  constructor(options: SourceRenderProcessOptions = {}) {
    super()
    this.on('error', () => {})
    const standalone = typeof __AM_STANDALONE__ !== 'undefined' && __AM_STANDALONE__
    const supervisor = options.supervisor ?? new URL(import.meta.url.endsWith('.ts') ? './source-supervisor.ts' : './source-supervisor.js', import.meta.url)
    const args = standalone ? [SOURCE_TOOL_CHILD_ARG] : [fileURLToPath(supervisor)]
    const flags = process.versions.bun ? [] : [...(options.nodeFlags ?? SOURCE_TOOL_NODE_FLAGS)]
    this.child = spawn(options.executable ?? process.execPath, [...flags, ...args], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', env: { ...process.env, NODE_OPTIONS: '' },
    })
    const shutdown = () => { this.ref(); this.terminate() }
    process.once('beforeExit', shutdown)
    this.child.on('message', (message: any) => {
      if (this.closed) return
      if (message.type === 'bootstrap') this.send({ type: 'initialize', worker: options.worker?.href, memoryBudgetBytes: options.memoryBudgetBytes ?? SOURCE_TOOL_MEMORY_BYTES })
      else if (message.type === 'ready') {
        this.ready = true
        this.emit('ready', message)
        for (const queued of this.pending.splice(0)) this.send(queued)
      } else this.emit('message', message)
    })
    this.child.on('error', error => this.emit('error', error))
    // Failed spawns emit close without exit. Release their occupied slot too.
    this.child.once('close', (code, signal) => {
      this.closed = true
      this.pending.length = 0
      process.removeListener('beforeExit', shutdown)
      this.emit('exit', code, signal)
    })
  }

  postMessage(message: SourceToolRequest): void {
    if (this.closed) throw new Error('Rendering process is closed')
    if (!this.ready) this.pending.push(message)
    else this.send(message)
  }
  terminate(): void { this.child.kill('SIGKILL') }
  ref(): void { this.child.ref(); (this.child.channel as { ref?: () => void } | undefined)?.ref?.() }
  unref(): void { (this.child.channel as { unref?: () => void } | undefined)?.unref?.(); this.child.unref() }

  private send(message: object): void {
    try { this.child.send(message, error => { if (error && !this.closed) this.emit('error', error) }) }
    catch (error) { this.emit('error', error) }
  }
}
