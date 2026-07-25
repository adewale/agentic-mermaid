// MCP response-corpus characterization: a recorded snapshot of what the local
// and hosted servers actually put on the wire, so that ANY drift in the
// agent-facing surface is caught rather than only the parts a hand-written
// assertion happens to look at.
//
// Why this exists alongside the behavioural MCP suites: those pin the tool
// ROSTER (hosted-mcp.test.ts asserts the exact 9 names) and spot-check
// individual schema properties, but tool descriptions, the server instructions
// string, annotations, and full input schemas were unpinned. Those strings are
// the prompt an agent actually reads — a reworded description or a quietly
// added schema property changes how every client behaves and would otherwise
// reach production unobserved.
//
// Regenerate after an INTENTIONAL surface change:
//   UPDATE_MCP_CORPUS=1 bun test src/__tests__/mcp-response-corpus.test.ts
// The baseline lives under testdata/, so the [approve-goldens] golden-drift
// review applies (scripts/ci/golden-drift.ts, GOLDEN_DIR).
//
// Fidelity, stated honestly: descriptions, instructions, annotations, and
// handshake fields are recorded VERBATIM. Input schemas are recorded as a
// SHA-256 over the canonical JSON plus a recursive property/type projection —
// the hash detects any change at all, the projection makes the common case (a
// property added, removed, or retyped) readable in the diff without committing
// the ~58KB shared RenderOptions schema four times over. Render payload bytes
// are hashed for the same reason; their exact bytes are already owned by the
// styled-output and PNG contract goldens.
//
// The reported server version is normalized to <package-version>: it tracks
// package.json by design (MCP_SERVER_VERSION = PACKAGE_VERSION), and baking the
// literal in would make every release bump a golden diff. A separate assertion
// below pins the binding itself.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { handleRequest, LOCAL_TOOLS } from '../mcp/server.ts'
import {
  handleHostedRequest, HOSTED_TOOLS, SUPPORTED_PROTOCOL_VERSIONS,
  type ExecuteResult, type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import { MCP_SERVER_VERSION, type McpToolDefinition } from '../mcp/tool-surface.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { PNG_WASM_RUNTIME } from '../png-contract.ts'
import pkg from '../../package.json'

const BASELINE = join(import.meta.dir, 'testdata', 'mcp-response-corpus.json')
const UPDATE = process.env.UPDATE_MCP_CORPUS === '1'
const VERSION_PLACEHOLDER = '<package-version>'

// The hosted seams (a Dynamic Worker isolate and resvg-wasm in production) are
// fakes here, matching hosted-mcp.test.ts. No corpus entry calls them: the
// corpus records the surface, not the isolate.
const TEST_PNG_RECEIPT = {
  version: 2, output: 'png', sharedRequestDigest: 'test-shared', requestDigest: 'test-request',
  appearanceDigest: 'test-appearance', capabilityDecision: { version: 1, accepted: true, resolutions: [] },
} as const

function hostedContext(): HostedMcpContext {
  return {
    async execute(): Promise<ExecuteResult> { return { ok: true, value: 42, logs: [] } },
    async renderPng() {
      return { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), warnings: [], receipt: TEST_PNG_RECEIPT, runtime: PNG_WASM_RUNTIME }
    },
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Stable key order so an unrelated property reordering is not a diff. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Recursive property/type projection: enough to read a schema change in the
 *  diff, small enough not to commit the shared RenderOptions schema verbatim. */
function schemaShape(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return typeof schema
  const s = schema as Record<string, unknown>
  const shape: Record<string, unknown> = {}
  if (typeof s.type === 'string') shape.type = s.type
  if (s.additionalProperties === false) shape.additionalProperties = false
  if (Array.isArray(s.required)) shape.required = [...s.required].sort()
  if (Array.isArray(s.enum)) shape.enum = s.enum
  if (typeof s.$ref === 'string') shape.$ref = s.$ref
  const properties = s.properties as Record<string, unknown> | undefined
  if (properties && depth < 2) {
    shape.properties = Object.fromEntries(
      Object.keys(properties).sort().map(key => [key, schemaShape(properties[key], depth + 1)]))
  } else if (properties) {
    shape.propertyNames = Object.keys(properties).sort()
  }
  return shape
}

function toolEntry(tool: McpToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations ?? null,
    inputSchemaSha256: sha256(canonicalJson(tool.inputSchema)),
    inputSchemaShape: schemaShape(tool.inputSchema),
  }
}

/** Normalize the reported package version out of any recorded string. */
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.split(pkg.version).join(VERSION_PLACEHOLDER)
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalize(v)]))
  }
  return value
}

/** Record a tool-call payload: full text when small enough to read in a diff,
 *  hash + length when it is render output whose bytes other goldens own. */
function recordPayload(response: JsonRpcResponse | null): unknown {
  if (response === null) return { notification: true }
  if (response.error) return normalize({ error: response.error })
  const result = response.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined
  if (!result?.content) return normalize({ result })
  const text = result.content[0]?.text ?? ''
  const body = text.length <= 2000
    ? { text: normalize(text) }
    : { textSha256: sha256(text), textLength: text.length }
  return { isError: result.isError ?? null, ...body }
}

// Deterministic requests exercised against BOTH surfaces where the tool exists.
// Error shapes are corpus entries too: an agent's recovery path depends on the
// exact message, and those were previously unpinned.
const FLOW = 'flowchart TD\n  A[Start] --> B{OK?}'
const SHARED_CALLS: Array<{ label: string; request: JsonRpcRequest }> = [
  { label: 'describe/text', request: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe', arguments: { source: FLOW } } } },
  { label: 'describe/facts', request: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'describe', arguments: { source: FLOW, format: 'facts' } } } },
  { label: 'describe_sdk/flowchart-signatures', request: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'describe_sdk', arguments: { family: 'flowchart', detail: 'signatures' } } } },
  { label: 'error/unknown-tool', request: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } } },
  { label: 'error/unknown-method', request: { jsonrpc: '2.0', id: 5, method: 'no/such/method' } },
  { label: 'error/malformed-envelope', request: { jsonrpc: '1.0', id: 6, method: 'tools/list' } as unknown as JsonRpcRequest },
  { label: 'error/describe-missing-source', request: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'describe', arguments: {} } } },
  { label: 'error/describe-unknown-argument', request: { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'describe', arguments: { source: FLOW, nope: 1 } } } },
  { label: 'prompts/list', request: { jsonrpc: '2.0', id: 9, method: 'prompts/list' } },
  { label: 'resources/list', request: { jsonrpc: '2.0', id: 10, method: 'resources/list' } },
]

// Hosted-only tools (the local server routes these through execute instead).
const HOSTED_ONLY_CALLS: Array<{ label: string; request: JsonRpcRequest }> = [
  { label: 'verify/flowchart', request: { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'verify', arguments: { source: FLOW } } } },
  { label: 'mutate/add-class', request: { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'mutate', arguments: { source: 'classDiagram\n  class Animal', ops: [{ kind: 'add_class', id: 'Dog' }] } } } },
  { label: 'build/class-from-blank', request: { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'build', arguments: { family: 'class', ops: [{ kind: 'add_class', id: 'Duck' }] } } } },
  { label: 'error/mutate-invalid-op', request: { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'mutate', arguments: { source: 'classDiagram\n  class Animal', ops: [{ kind: 'not_an_op' }] } } } },
  { label: 'render_svg/flowchart', request: { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'render_svg', arguments: { source: FLOW } } } },
  { label: 'render_ascii/flowchart', request: { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'render_ascii', arguments: { source: FLOW } } } },
]

const INITIALIZE: JsonRpcRequest = {
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'corpus', version: '0' } },
}

async function buildCorpus() {
  const local: Record<string, unknown> = {
    initialize: normalize((await handleRequest(INITIALIZE))?.result),
    tools: LOCAL_TOOLS.map(toolEntry),
    calls: {} as Record<string, unknown>,
  }
  for (const { label, request } of SHARED_CALLS) {
    (local.calls as Record<string, unknown>)[label] = recordPayload(await handleRequest(request))
  }

  const context = hostedContext()
  const hosted: Record<string, unknown> = {
    initialize: normalize((await handleHostedRequest(INITIALIZE, context))?.result),
    supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    tools: HOSTED_TOOLS.map(toolEntry),
    calls: {} as Record<string, unknown>,
  }
  for (const { label, request } of [...SHARED_CALLS, ...HOSTED_ONLY_CALLS]) {
    (hosted.calls as Record<string, unknown>)[label] = recordPayload(await handleHostedRequest(request, context))
  }

  return { local, hosted }
}

describe('MCP response corpus', () => {
  test('matches the recorded surface for both servers', async () => {
    const corpus = await buildCorpus()
    if (UPDATE) {
      writeFileSync(BASELINE, `${JSON.stringify(corpus, null, 2)}\n`)
      return
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
    // Compare surface-by-surface so a failure names the drifting server, and
    // tool-by-tool so it names the drifting tool instead of dumping both trees.
    for (const surface of ['local', 'hosted'] as const) {
      const actual = corpus[surface] as Record<string, any>
      const expected = baseline[surface] as Record<string, any>
      expect({ surface, initialize: actual.initialize }).toEqual({ surface, initialize: expected.initialize })
      expect({ surface, tools: actual.tools.map((t: any) => t.name) })
        .toEqual({ surface, tools: expected.tools.map((t: any) => t.name) })
      for (const [index, tool] of actual.tools.entries()) {
        expect({ surface, tool: tool.name, ...tool }).toEqual({ surface, tool: tool.name, ...expected.tools[index] })
      }
      for (const label of Object.keys(actual.calls)) {
        expect({ surface, label, payload: actual.calls[label] })
          .toEqual({ surface, label, payload: expected.calls[label] })
      }
      expect({ surface, labels: Object.keys(actual.calls).sort() })
        .toEqual({ surface, labels: Object.keys(expected.calls).sort() })
    }
    expect(corpus.hosted.supportedProtocolVersions).toEqual(baseline.hosted.supportedProtocolVersions)
  })

  test('the recorded version placeholder still tracks package.json', () => {
    // The corpus normalizes the reported version away, so this is what keeps
    // the release identity gate honest for the surface the corpus covers.
    expect(MCP_SERVER_VERSION).toBe(pkg.version)
  })

  test('every registered tool on both surfaces is represented', async () => {
    const corpus = await buildCorpus()
    expect((corpus.local.tools as Array<{ name: string }>).map(t => t.name)).toEqual(LOCAL_TOOLS.map(t => t.name))
    expect((corpus.hosted.tools as Array<{ name: string }>).map(t => t.name)).toEqual(HOSTED_TOOLS.map(t => t.name))
  })
})
