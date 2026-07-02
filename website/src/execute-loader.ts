// Dynamic Worker glue for hosted Code Mode `execute`.
//
// Semantics contract (matching the local vm sandbox): expression-form wrap
// wins whenever it parses; otherwise the statement-form wrap runs. workerd
// compiles every module in an isolate eagerly at startup, so "does the
// expression wrap parse?" is answered by attempting to start the
// expression-form isolate — a SyntaxError startup failure falls back to a
// statement-form isolate. Statement-form code therefore costs one failed
// isolate attempt; identical repeat requests are absorbed by the /mcp
// response cache before reaching the loader at all.
//
// Isolates are keyed by wrap variant + a hash of the code + a hash of the
// harness itself: the Worker Loader contract is that one ID always maps to
// the same WorkerCode, so a harness/SDK change must produce new IDs even
// when the package version does not move (otherwise a warm isolate keeps
// serving the old code after a deploy). The isolate gets no bindings, no
// network (`globalOutbound: null`), and a CPU budget.

import { userModuleSources, MAX_RESULT_BYTES } from '../../src/mcp/harness-runtime.ts'
import type { ExecuteResult } from '../../src/mcp/hosted-server.ts'
import pkg from '../../package.json'

// Keep in sync with wrangler.jsonc `compatibility_date`: the isolate should
// see the same runtime semantics as the Worker that spawned it.
export const DYNAMIC_WORKER_COMPAT_DATE = '2026-06-27'

export { MAX_RESULT_BYTES }

interface DynamicWorkerCode {
  compatibilityDate: string
  mainModule: string
  modules: Record<string, string>
  globalOutbound?: null
  env?: Record<string, unknown>
}
interface DynamicWorkerLimits { cpuMs?: number; subRequests?: number }
interface DynamicWorkerEntrypoint { fetch(input: string | Request, init?: RequestInit): Promise<Response> }
interface WorkerStub { getEntrypoint(name?: string | null, options?: { limits?: DynamicWorkerLimits }): DynamicWorkerEntrypoint }
export interface WorkerLoaderBinding { get(id: string, getCode: () => Promise<DynamicWorkerCode>): WorkerStub }

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Identifies the deployed compute: package version + harness-content hash.
 * Used in isolate IDs and as the /mcp response-cache version so both
 * invalidate when the harness/SDK changes without a version bump.
 */
export async function deployTag(harnessSource: string): Promise<string> {
  return `v${pkg.version}-${(await sha256Hex(harnessSource)).slice(0, 16)}`
}

/** Read a body with a hard byte cap, cancelling the stream on overrun. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}

function isSyntaxStartupFailure(message: string): boolean {
  return /SyntaxError/i.test(message)
}

export function createLoaderExecute(loader: WorkerLoaderBinding, harnessSource: string): (code: string, timeoutMs: number) => Promise<ExecuteResult> {
  const tag = deployTag(harnessSource)
  return async (code, timeoutMs) => {
    const hash = await sha256Hex(code)
    const idBase = `exec-${await tag}`
    const { expr, stmt } = userModuleSources(code)

    const attempt = async (variant: 'e' | 's', userModule: string): Promise<ExecuteResult> => {
      const stub = loader.get(`${idBase}-${variant}-${hash}`, async () => ({
        compatibilityDate: DYNAMIC_WORKER_COMPAT_DATE,
        mainModule: 'harness.js',
        modules: { 'harness.js': harnessSource, 'user.js': userModule },
        globalOutbound: null,
        env: {},
      }))
      const entrypoint = stub.getEntrypoint(null, { limits: { cpuMs: timeoutMs, subRequests: 0 } })
      // cpuMs is the real budget (enforced in production); the wall-clock race
      // is a backstop for environments that don't enforce isolate limits
      // (wrangler dev) and for loader hangs, so /mcp always answers.
      const response = await Promise.race([
        entrypoint.fetch('https://execute.internal/', { method: 'POST' }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`execute exceeded its ${timeoutMs}ms CPU budget`)), timeoutMs + 1_500)),
      ])
      if (!response.ok) return { ok: false, error: `sandbox returned HTTP ${response.status}`, logs: [] }
      // Outputs are bounded like inputs, without buffering past the cap: the
      // harness also caps logs/results at the source, so this is the backstop
      // against a harness bug or a hand-rolled oversized response.
      const text = await readCapped(response.body, MAX_RESULT_BYTES)
      if (text === null) {
        return { ok: false, error: `sandbox result exceeded ${MAX_RESULT_BYTES} bytes; reduce console output or returned data`, logs: [] }
      }
      const result = JSON.parse(text) as ExecuteResult
      if (typeof result?.ok !== 'boolean') return { ok: false, error: 'sandbox returned a malformed result', logs: [] }
      return result
    }

    const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
    try {
      return await attempt('e', expr)
    } catch (exprError) {
      if (!isSyntaxStartupFailure(errorMessage(exprError))) {
        return failure(errorMessage(exprError), timeoutMs)
      }
      try {
        return await attempt('s', stmt)
      } catch (stmtError) {
        return failure(errorMessage(stmtError), timeoutMs)
      }
    }
  }
}

function failure(message: string, timeoutMs: number): ExecuteResult {
  // The loader surfaces a cpuMs overrun as a thrown exception on the call.
  if (/cpu|exceeded|limit/i.test(message) && !/SyntaxError/i.test(message)) {
    return { ok: false, error: `Script execution exceeded its ${timeoutMs}ms CPU budget`, logs: [] }
  }
  // Strip workerd's startup preamble so syntax errors read like the sandbox's.
  const syntax = message.match(/SyntaxError:\s*(.*)/)
  if (syntax) return { ok: false, error: syntax[1]!.split('\n')[0]!, logs: [] }
  return { ok: false, error: `sandbox error: ${message}`, logs: [] }
}
