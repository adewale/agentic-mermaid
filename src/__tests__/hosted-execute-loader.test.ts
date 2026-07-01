// Worker Loader glue for hosted execute (website/src/execute-loader.ts):
// isolate keying, the expression-first startup-probe fallback, limit plumbing,
// and failure mapping. The loader binding is a purpose-built fake recording
// every isolate request; real loader behavior is covered by website/e2e-mcp.sh.

import { describe, expect, test } from 'bun:test'
import { createLoaderExecute, DYNAMIC_WORKER_COMPAT_DATE, MAX_RESULT_BYTES, type WorkerLoaderBinding } from '../../website/src/execute-loader.ts'
import pkg from '../../package.json'

interface IsolateRequest { id: string; modules: Record<string, string>; globalOutbound: unknown; limits?: { cpuMs?: number; subRequests?: number } }

/** Fake loader: `respond` decides what each isolate start does. */
function makeLoader(respond: (req: IsolateRequest) => Response | Error): { loader: WorkerLoaderBinding; requests: IsolateRequest[] } {
  const requests: IsolateRequest[] = []
  const loader: WorkerLoaderBinding = {
    get(id, getCode) {
      return {
        getEntrypoint(_name, options) {
          return {
            async fetch() {
              const code = await getCode()
              const req: IsolateRequest = { id, modules: code.modules as Record<string, string>, globalOutbound: code.globalOutbound, limits: options?.limits }
              requests.push(req)
              const out = respond(req)
              if (out instanceof Error) throw out
              return out
            },
          }
        },
      }
    },
  }
  return { loader, requests }
}

const okResponse = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })

describe('hosted execute loader glue', () => {
  test('expression-form isolate wins when it starts; code is hash-keyed with no network and no env', async () => {
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: 2, logs: [] }))
    const execute = createLoaderExecute(loader, 'HARNESS')
    const result = await execute('1 + 1', 5000)
    expect(result).toEqual({ ok: true, value: 2, logs: [] })
    expect(requests).toHaveLength(1)
    const req = requests[0]!
    expect(req.id).toStartWith(`exec-v${pkg.version}-e-`)
    expect(req.id).toMatch(/-[0-9a-f]{64}$/)
    expect(req.globalOutbound).toBeNull()
    expect(req.limits).toEqual({ cpuMs: 5000, subRequests: 0 })
    expect(req.modules['harness.js']).toBe('HARNESS')
    expect(req.modules['user.js']).toContain('return (')
  })

  test('identical code produces identical isolate ids; different code differs', async () => {
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: null, logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    await execute('1 + 1', 5000)
    await execute('1 + 1', 5000)
    await execute('2 + 2', 5000)
    expect(requests[0]!.id).toBe(requests[1]!.id)
    expect(requests[2]!.id).not.toBe(requests[0]!.id)
  })

  test('a SyntaxError startup failure falls back to the statement-form isolate', async () => {
    const { loader, requests } = makeLoader(req =>
      req.id.includes('-e-')
        ? new Error("Failed to start Worker:\nUncaught SyntaxError: Unexpected token 'const'\n  at user.js:1")
        : okResponse({ ok: true, value: 42, logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('const x = 42; return x', 5000)
    expect(result).toEqual({ ok: true, value: 42, logs: [] })
    expect(requests.map(r => r.id.includes('-e-') ? 'e' : 's')).toEqual(['e', 's'])
    expect(requests[1]!.modules['user.js']).not.toContain('return (')
  })

  test('a double SyntaxError reports the statement attempt message, stripped of the startup preamble', async () => {
    const { loader } = makeLoader(() => new Error("Failed to start Worker:\nUncaught SyntaxError: Unexpected token ')'\n  at user.js:1"))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('return ) === (', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe("Unexpected token ')'")
  })

  test('non-syntax loader failures do not trigger the statement fallback', async () => {
    const { loader, requests } = makeLoader(() => new Error('internal error; loader unavailable'))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1 + 1', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('loader unavailable')
    expect(requests).toHaveLength(1)
  })

  test('cpu-limit exceptions map to the CPU-budget error', async () => {
    const { loader } = makeLoader(() => new Error('Worker exceeded CPU time limit.'))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('for(let i=0;i<1e9;i++){}', 250)
    expect(result).toEqual({ ok: false, error: 'Script execution exceeded its 250ms CPU budget', logs: [] })
  })

  test('oversized sandbox results are bounded', async () => {
    const { loader } = makeLoader(() => okResponse({ ok: true, value: 'x'.repeat(MAX_RESULT_BYTES), logs: [] }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('return big', 5000)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('exceeded')
    expect(result.error).toContain('bytes')
  })

  test('malformed sandbox payloads degrade to a structured error', async () => {
    const { loader } = makeLoader(() => okResponse({ unexpected: true }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned a malformed result', logs: [] })
  })

  test('non-OK sandbox responses degrade to a structured error', async () => {
    const { loader } = makeLoader(() => new Response('nope', { status: 500 }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned HTTP 500', logs: [] })
  })

  test('the isolate compatibility date matches the parent wrangler config', async () => {
    const wrangler = await Bun.file(new URL('../../website/wrangler.jsonc', import.meta.url).pathname).text()
    expect(wrangler).toContain(`"compatibility_date": "${DYNAMIC_WORKER_COMPAT_DATE}"`)
  })
})
