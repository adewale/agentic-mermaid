// Property fuzz for the MCP package surface: the JSON-RPC request router and
// the Code-Mode `execute` sandbox. These are the agent-facing entry points of
// the `agentic-mermaid-mcp` bin, and previously had only example-based tests.
// Contract under test: neither handler ever rejects — a malformed request or
// arbitrary code yields a structured JSON-RPC error / {ok:false} result, not an
// unhandled crash that would take down the stdio/HTTP server. Seed is pinned
// globally (fc-seed.preload.ts).
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { handleRequest } from '../mcp/server.ts'
import type { JsonRpcRequest } from '../mcp/server.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'

const NUM_RUNS = 120
const SANDBOX_RUNS = 80
// Async vm work per run; give the property loops headroom over the 5s default.
const LONG_TIMEOUT_MS = 60_000

const SPECIAL_CHARS = [
  '[', ']', '{', '}', '(', ')', '<', '>', '|', ':', ';', '-', '=',
  '.', ',', '!', '?', '@', '#', '$', '%', '^', '&', '*', '+', '~',
  '`', '"', "'", '\\', '/', '\n', '\r', '\t', ' ', '​', '￿',
]
const specialCharStringArb = fc
  .array(fc.constantFrom(...SPECIAL_CHARS), { maxLength: 60 })
  .map(chars => chars.join(''))

// Small pool of JS-ish snippets so the sandbox sees both parse failures and
// real evaluation paths, not only garbage that fails to compile.
const codeArb = fc.oneof(
  fc.string({ maxLength: 120 }),
  specialCharStringArb,
  fc.constantFrom(
    'return 1 + 1',
    'return mermaid.parseRegisteredMermaid("flowchart TD\\n A --> B")',
    'while (true) {}',            // must be cut off by the timeout, not hang
    'throw new Error("boom")',
    'undefined.x',
    'return globalThis',
    'return process.env',
    'return require("node:fs")',
  ),
)

const idArb = fc.oneof(fc.integer(), fc.string({ maxLength: 8 }), fc.constant(null), fc.constant(undefined))

// A grab-bag of params: undefined, arbitrary objects, and well-formed tool
// calls with hostile arguments.
const paramsArb = fc.oneof(
  fc.constant(undefined),
  fc.object({ maxDepth: 2 }),
  fc.record({ name: fc.string({ maxLength: 12 }) }),
  fc.record({ name: fc.constant('execute'), arguments: fc.record({ code: codeArb, timeoutMs: fc.constant(50) }) }),
  fc.record({ name: fc.constant('render_png'), arguments: fc.record({ source: specialCharStringArb }) }),
  fc.record({ name: fc.constant('describe'), arguments: fc.record({ source: specialCharStringArb }) }),
)

const methodArb = fc.oneof(
  fc.constantFrom('initialize', 'ping', 'tools/list', 'tools/call', 'prompts/list', 'resources/list', 'notifications/initialized'),
  fc.string({ maxLength: 16 }),
  specialCharStringArb,
)

const requestArb = fc.record({
  jsonrpc: fc.constant('2.0' as const),
  id: idArb,
  method: methodArb,
  params: paramsArb,
}, { requiredKeys: ['jsonrpc', 'method'] })

function assertWellFormedResponse(response: unknown, req: JsonRpcRequest): void {
  if (response === null) return // notifications legitimately produce no reply.
  expect(typeof response).toBe('object')
  const r = response as Record<string, unknown>
  expect(r.jsonrpc).toBe('2.0')
  expect(r.id).toEqual(req.id ?? null)
  // Exactly one of result / error must be present.
  const hasResult = 'result' in r
  const hasError = 'error' in r
  expect(hasResult !== hasError).toBe(true)
  if (hasError) {
    const err = r.error as { code?: unknown; message?: unknown }
    expect(typeof err.code).toBe('number')
    expect(typeof err.message).toBe('string')
  }
}

// ===========================================================================
// handleRequest — the JSON-RPC router.
// ===========================================================================

describe('mcp-surface fuzz: handleRequest', () => {
  it('never rejects and always returns null or a well-formed JSON-RPC response', async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, async (req) => {
        const response = await handleRequest(req as JsonRpcRequest)
        assertWellFormedResponse(response, req as JsonRpcRequest)
      }),
      { numRuns: NUM_RUNS },
    )
  }, LONG_TIMEOUT_MS)

  it('routes hostile execute payloads to a response, never a crash', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, codeArb, async (id, code) => {
        const req = {
          jsonrpc: '2.0' as const,
          id,
          method: 'tools/call',
          params: { name: 'execute', arguments: { code, timeoutMs: 50 } },
        }
        const response = await handleRequest(req as JsonRpcRequest)
        assertWellFormedResponse(response, req as JsonRpcRequest)
        // execute always yields a reply (not a notification), with tool content.
        expect(response).not.toBeNull()
        const result = (response as { result?: { content?: unknown; isError?: unknown } }).result
        expect(result).toBeDefined()
        expect(Array.isArray(result!.content)).toBe(true)
        expect(typeof result!.isError).toBe('boolean')
      }),
      { numRuns: NUM_RUNS },
    )
  }, LONG_TIMEOUT_MS)
})

// ===========================================================================
// executeInSandbox — the Code-Mode evaluator. Must always resolve to an
// {ok, error?} record; failures carry an error string; loops are timed out.
// ===========================================================================

describe('mcp-surface fuzz: executeInSandbox', () => {
  it('never rejects and returns a tagged {ok} result within the timeout', async () => {
    await fc.assert(
      fc.asyncProperty(codeArb, async (code) => {
        const result = await executeInSandbox(code, { timeoutMs: 100 })
        expect(result).toBeDefined()
        expect(typeof result.ok).toBe('boolean')
        if (!result.ok) {
          expect(typeof result.error).toBe('string')
        }
      }),
      { numRuns: SANDBOX_RUNS },
    )
  }, LONG_TIMEOUT_MS)
})
