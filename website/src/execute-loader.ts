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
import type { ExecuteResult, HostedExecuteTelemetry } from '../../src/mcp/hosted-server.ts'
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
    || /\bUnexpected token\b/i.test(message)
    || /\bInvalid or unexpected token\b/i.test(message)
    || /\bUnexpected end of input\b/i.test(message)
    || /\bUnexpected strict mode reserved word\b/i.test(message)
}

// Extra wall-clock margin over the isolate's cpuMs budget before the parent
// gives up on a hung fetch. Overridable for tests (a hung fake loader would
// otherwise force a multi-second wait).
export const DEFAULT_BACKSTOP_MARGIN_MS = 1_500

export function createLoaderExecute(loader: WorkerLoaderBinding, harnessSource: string, backstopMarginMs: number = DEFAULT_BACKSTOP_MARGIN_MS): (code: string, timeoutMs: number, onTelemetry?: (telemetry: HostedExecuteTelemetry) => void) => Promise<ExecuteResult> {
  const tag = deployTag(harnessSource)
  return async (code, timeoutMs, onTelemetry) => {
    const complete = (result: ExecuteResult, loaderAttempts: 1 | 2): ExecuteResult => {
      onTelemetry?.({ loaderAttempts })
      return result
    }
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
      // (wrangler dev) and for loader hangs, so /mcp always answers. Clear the
      // timer once the race settles so a winning fetch leaves no dangling timer.
      let timer: ReturnType<typeof setTimeout> | undefined
      let response: Response
      try {
        response = await Promise.race([
          entrypoint.fetch('https://execute.internal/', { method: 'POST' }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`execute exceeded its ${timeoutMs}ms CPU budget`)), timeoutMs + backstopMarginMs) }),
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
      if (!response.ok) return { ok: false, error: `sandbox returned HTTP ${response.status}`, logs: [] }
      // Outputs are bounded like inputs, without buffering past the cap: the
      // harness also caps logs/results at the source, so this is the backstop
      // against a harness bug or a hand-rolled oversized response.
      const text = await readCapped(response.body, MAX_RESULT_BYTES)
      if (text === null) {
        return { ok: false, error: `sandbox result exceeded ${MAX_RESULT_BYTES} bytes; reduce console output or returned data`, logs: [] }
      }
      // An empty or non-JSON body is a malformed isolate response, not a syntax
      // error in the agent's code — route it to the clean malformed-result
      // message instead of leaking a raw JSON.parse error through failure().
      if (text === '') return { ok: false, error: 'sandbox returned a malformed result', logs: [] }
      let result: ExecuteResult
      try {
        result = JSON.parse(text) as ExecuteResult
      } catch {
        return { ok: false, error: 'sandbox returned a malformed result', logs: [] }
      }
      if (typeof result?.ok !== 'boolean') return { ok: false, error: 'sandbox returned a malformed result', logs: [] }
      return result
    }

    const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
    try {
      return complete(await attempt('e', expr), 1)
    } catch (exprError) {
      if (!isSyntaxStartupFailure(errorMessage(exprError))) {
        return complete(failure(errorMessage(exprError), timeoutMs), 1)
      }
      try {
        return complete(await attempt('s', stmt), 2)
      } catch (stmtError) {
        return complete(failure(errorMessage(stmtError), timeoutMs), 2)
      }
    }
  }
}

function failure(message: string, timeoutMs: number): ExecuteResult {
  const lines = message.split('\n')
  const primary = lines.find(line => isSyntaxStartupFailure(line)) ?? lines[0]!
  const clean = primary.replace(/^Uncaught\s+/, '').replace(/\b(?:user|harness)\.js:\d+(?::\d+)?\b/g, '<sandbox>')
  // The loader surfaces a cpuMs overrun as a thrown exception on the call.
  if (/cpu|exceeded|limit/i.test(clean) && !/SyntaxError/i.test(clean)) {
    return { ok: false, error: `Script execution exceeded its ${timeoutMs}ms CPU budget`, logs: [] }
  }
  // Strip workerd's startup preamble so syntax errors read like the sandbox's.
  // Production Worker Loader sometimes omits the `SyntaxError:` prefix and
  // throws the parser message directly, e.g. `Unexpected token 'const'`.
  if (isSyntaxStartupFailure(clean)) {
    const syntax = clean.match(/SyntaxError:\s*(.*)/)
    return { ok: false, error: syntax?.[1] ?? clean, logs: [] }
  }
  return { ok: false, error: `sandbox error: ${clean}`, logs: [] }
}
