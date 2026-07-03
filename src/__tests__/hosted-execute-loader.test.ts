// Worker Loader glue for hosted execute (website/src/execute-loader.ts):
// isolate keying, the expression-first startup-probe fallback, limit plumbing,
// and failure mapping. The loader binding is a purpose-built fake recording
// every isolate request; real loader behavior is covered by website/e2e-mcp.sh.

import { describe, expect, test } from 'bun:test'
import { createLoaderExecute, deployTag, DYNAMIC_WORKER_COMPAT_DATE, MAX_RESULT_BYTES, readCapped, type WorkerLoaderBinding } from '../../website/src/execute-loader.ts'
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
    // version + harness hash + wrap variant + code hash
    expect(req.id).toBe(`exec-${await deployTag('HARNESS')}-e-${req.id.split('-').pop()}`)
    expect(req.id).toMatch(new RegExp(`^exec-v${pkg.version.replace(/\./g, '\\.')}-[0-9a-f]{16}-e-[0-9a-f]{64}$`))
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

  test('a changed harness produces different isolate ids for identical code', async () => {
    // Worker Loader contract: one ID must always map to the same WorkerCode.
    // A harness/SDK change without a package version bump must still move the
    // ID, or a warm isolate keeps serving the old code after a deploy.
    const { loader, requests } = makeLoader(() => okResponse({ ok: true, value: null, logs: [] }))
    await createLoaderExecute(loader, 'HARNESS-A')('1 + 1', 5000)
    await createLoaderExecute(loader, 'HARNESS-B')('1 + 1', 5000)
    expect(requests[0]!.id).not.toBe(requests[1]!.id)
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

  test('an empty isolate body is a malformed result, not a leaked JSON.parse error', async () => {
    // Guards the empty/non-JSON body path: a 200 with no body must not surface
    // a raw `Unexpected end of JSON input` through failure().
    const { loader } = makeLoader(() => new Response('', { headers: { 'content-type': 'application/json' } }))
    const execute = createLoaderExecute(loader, 'H')
    const result = await execute('1', 5000)
    expect(result).toEqual({ ok: false, error: 'sandbox returned a malformed result', logs: [] })
  })

  test('a non-JSON isolate body is a malformed result, not a leaked parse error', async () => {
    const { loader } = makeLoader(() => new Response('not json at all', { headers: { 'content-type': 'application/json' } }))
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

  test('a hung isolate fetch is cut off by the wall-clock backstop, not left pending', async () => {
    // cpuMs is the real budget in production; wrangler dev does not enforce it,
    // so a loader hang must still resolve the call via the Promise.race timer.
    // Deleting that race would leave this hanging forever (test times out) —
    // the test discriminates the backstop from a no-op. A tiny backstopMargin
    // keeps the wait sub-second.
    const loader: WorkerLoaderBinding = {
      get() {
        return { getEntrypoint() { return { fetch: () => new Promise<Response>(() => {}) } } }
      },
    }
    const execute = createLoaderExecute(loader, 'H', 20)
    const result = await execute('1 + 1', 30)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Script execution exceeded its 30ms CPU budget')
  })
})

describe('readCapped', () => {
  function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c)
        controller.close()
      },
    })
  }

  test('a null body reads as the empty string', async () => {
    expect(await readCapped(null, 10)).toBe('')
  })

  test('a body exactly at the cap is accepted; one byte over is rejected', async () => {
    const bytes = new Uint8Array(16).fill(0x61) // 16 × 'a'
    expect(await readCapped(streamOf([bytes]), 16)).toBe('a'.repeat(16))
    expect(await readCapped(streamOf([bytes]), 15)).toBeNull()
  })

  test('the cap counts bytes across chunk boundaries, not per chunk', async () => {
    // Two 10-byte chunks against a 15-byte cap must overrun (the naive per-chunk
    // check would let both through).
    const chunk = new Uint8Array(10).fill(0x62)
    expect(await readCapped(streamOf([chunk, chunk]), 15)).toBeNull()
  })

  test('a multi-byte UTF-8 char split across chunks decodes correctly', async () => {
    // '€' is E2 82 AC; split it across two chunks so decoding must join them.
    const euro = new TextEncoder().encode('€') // 3 bytes
    const a = euro.subarray(0, 1)
    const b = euro.subarray(1)
    expect(await readCapped(streamOf([a, b]), 10)).toBe('€')
  })
})
