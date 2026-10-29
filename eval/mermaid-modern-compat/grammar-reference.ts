import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { GrammarReferencePreparation, GrammarReferenceReply, GrammarReferenceRequest } from './grammar-types.ts'
import { wireLine } from './reference.ts'

interface WireReply {
  id: number
  value?: unknown
  error?: string
}

/** Actual upstream grammars in a separate Node/jsdom process; dialect selection stays within the prepared family. */
export function startGrammarReference(
  referenceDir: string,
  upstreamDir: string,
): {
  prepare(family: string, validSeed: string): Promise<GrammarReferencePreparation>
  parse(family: string, source: string): Promise<GrammarReferenceReply>
  /** Same selected upstream parse without observation hooks, for instrumentation controls. */
  control(family: string, source: string): Promise<GrammarReferenceReply>
  parseMany(requests: readonly GrammarReferenceRequest[]): Promise<GrammarReferenceReply[]>
  close(): void
} {
  const child = spawn('node', ['--experimental-import-meta-resolve', join(dirname(fileURLToPath(import.meta.url)), 'grammar-reference-worker.mjs'), referenceDir, upstreamDir], { stdio: ['pipe', 'pipe', 'pipe'] })
  let nextId = 1,
    stderr = '',
    stopped: Error | undefined
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  function stop(error: Error): void {
    stopped ??= error
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(stopped)
    }
    pending.clear()
  }
  child.stderr.on('data', chunk => {
    stderr = (stderr + String(chunk)).slice(-8000)
  })
  child.on('error', error => stop(error))
  child.stdin.on('error', error => stop(error))
  child.on('exit', code => stop(new Error(`Grammar reference exited ${code}: ${stderr}`)))
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    const prefix = '\u0001modern-grammar\u0001'
    if (!line.startsWith(prefix)) return
    try {
      const reply = JSON.parse(line.slice(prefix.length)) as WireReply
      const request = pending.get(reply.id)
      if (!request) return
      pending.delete(reply.id)
      clearTimeout(request.timer)
      if (reply.error) request.reject(new Error(reply.error))
      else request.resolve(reply.value)
    } catch (error) {
      stop(error as Error)
    }
  })
  function send<T>(operation: string, payload: unknown): Promise<T> {
    if (stopped) return Promise.reject(stopped)
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop(new Error(`Grammar reference timed out on ${operation}: ${stderr}`))
        child.kill()
      }, 120_000)
      pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      child.stdin.write(wireLine({ id, operation, payload }))
    })
  }
  return {
    prepare: (family, source) => send('prepare', { family, source }),
    parse: (family, source) => send('parse', { family, source }),
    control: (family, source) => send('parse', { family, source, unobserved: true }),
    parseMany: requests => send('parseMany', requests),
    close() {
      stop(new Error('Grammar reference closed'))
      child.stdin.end()
      child.kill()
    },
  }
}
