// The MCP reserved error sub-range, policed.
//
// `2026-07-28` partitions the JSON-RPC implementation-defined range and makes
// the rules normative: "-32020 to -32099 — reserved for the MCP specification.
// Error codes in this sub-range are defined exclusively by the MCP
// specification … Implementations MUST NOT emit any code from this sub-range
// that is not defined by this specification and MUST use defined codes only
// with their specified meanings." It also retires two codes outright:
// implementations of this revision MUST NOT emit -32002 (resource not found,
// replaced by -32602) or -32042 (URL elicitation required, 2025-11-25 only).
//
// Two of the three codes this revision defines are ours to emit. The third,
// -32021 (MissingRequiredClientCapability), is conditional on "processing a
// request requires a capability the client did not include" — and every tool we
// expose is a pure function of its arguments, needing no sampling, elicitation,
// or roots. So it is unreachable by construction, and emitting it anyway would
// breach the "defined codes only with their specified meanings" rule.
//
// The static sweep is the real guard: it fails the moment any production source
// grows a literal in the sub-range that is not on the allowlist, which is how a
// stray -32002 or a well-meaning -32021 would arrive. The live assertions keep
// the sweep from being vacuous by proving the two allowed codes really are the
// ones the server emits.

import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  handleHostedRequest, SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import {
  HEADER_MISMATCH, META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '../mcp/protocol-versions.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'

const ROOT = join(import.meta.dir, '../..')
const MODERN = '2026-07-28'

/** Codes this implementation is permitted to emit from the MCP reserved sub-range. */
const ALLOWED = new Set([HEADER_MISMATCH, UNSUPPORTED_PROTOCOL_VERSION])
/** Codes the spec retires for this revision, plus the one we cannot reach. */
const FORBIDDEN = {
  '-32002': 'resource not found, replaced by -32602',
  '-32021': 'MissingRequiredClientCapability — unreachable, no tool needs a client capability',
  '-32042': 'URL elicitation required, 2025-11-25 only',
}

// The spec partitions -32000..-32099 into a legacy half and a reserved half, and
// the rules differ, so the sweeps do too. Standard JSON-RPC codes (-32600,
// -32602, -32700 …) have a non-zero fourth character and match neither.
/** -32020..-32099: "defined exclusively by the MCP specification". MUST NOT stray. */
const RESERVED_RANGE = /-320[2-9]\d/g
/** -32000..-32019: legacy. "New implementations SHOULD NOT use codes from this sub-range at all." */
const LEGACY_RANGE = /-320[01]\d/g

/**
 * Comments are documentation, not emission — this very file's rationale names
 * -32021 and -32002, and a guard that failed on its own explanation would push
 * the next person to delete the explanation. Let the TypeScript compiler remove
 * comments lexically; regex stripping cannot distinguish a comment from `//`
 * inside a string or regular expression and can hide executable code after it.
 */
function stripComments(text: string): string {
  return ts.transpileModule(text, {
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
}

let cachedProductionSources: { rel: string; code: string }[] | undefined

const PRODUCTION_SOURCE_PATTERNS = [
  'src/**/*.ts',
  'bin/**/*.ts',
  'editor/**/*.ts',
  'website/**/*.ts',
  'scripts/**/*.ts',
]

const NON_PRODUCTION_SOURCE_PREFIXES = [
  'scripts/characterization/',
  'scripts/pr-assets/',
  'scripts/research/',
  'scripts/sketch-prototype/',
]

function isProductionSource(rel: string): boolean {
  if (rel.includes('/__tests__/') || rel.endsWith('.test.ts') || rel.endsWith('.spec.ts')) return false
  return !NON_PRODUCTION_SOURCE_PREFIXES.some(prefix => rel.startsWith(prefix))
}

function productionSources(): { rel: string; code: string }[] {
  if (cachedProductionSources) return cachedProductionSources
  const files: { rel: string; code: string }[] = []
  for (const pattern of PRODUCTION_SOURCE_PATTERNS) {
    for (const rel of new Glob(pattern).scanSync(ROOT)) {
      if (!isProductionSource(rel)) continue
      files.push({ rel, code: stripComments(readFileSync(join(ROOT, rel), 'utf8')) })
    }
  }
  cachedProductionSources = files
  return files
}

describe('MCP reserved error-code range', () => {
  test('no production source emits an unallowed code from the reserved sub-range', () => {
    const offenders: string[] = []
    for (const { rel, code } of productionSources()) {
      for (const match of code.match(RESERVED_RANGE) ?? []) {
        if (!ALLOWED.has(Number(match))) offenders.push(`${rel}: ${match}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test.each(Object.entries(FORBIDDEN))('%s never appears in executable source (%s)', code => {
    const hits = productionSources().filter(f => f.code.includes(code)).map(f => f.rel)
    expect(hits).toEqual([])
  })

  // The legacy half is a SHOULD NOT rather than a MUST NOT, and we used to sit
  // on the wrong side of it: five transport-level rejections (origin, method,
  // content-type, two body-size paths) answered with -32000. They are gone —
  // every one of those paths refuses BEFORE a JSON-RPC request is parsed, so it
  // now answers without a JSON-RPC envelope at all and needs no code. Nothing
  // in the legacy sub-range should ever reappear.
  test('no production source uses the legacy sub-range', () => {
    const byFile = new Map<string, number>()
    for (const { rel, code } of productionSources()) {
      const hits = (code.match(LEGACY_RANGE) ?? []).length
      if (hits > 0) byFile.set(rel, hits)
    }
    expect(Object.fromEntries(byFile)).toEqual({})
  })

  test('the sweeps are not vacuous, and do not overlap', () => {
    // If either regex silently stopped matching, every test above would pass by
    // finding nothing at all.
    expect('const x = -32021'.match(RESERVED_RANGE)).toEqual(['-32021'])
    expect('const x = -32042'.match(RESERVED_RANGE)).toEqual(['-32042'])
    expect('const x = -32002'.match(LEGACY_RANGE)).toEqual(['-32002'])
    expect('const x = -32000'.match(LEGACY_RANGE)).toEqual(['-32000'])
    // The halves are disjoint, and neither sweeps up standard JSON-RPC codes.
    expect('const x = -32002'.match(RESERVED_RANGE)).toBeNull()
    expect('const x = -32021'.match(LEGACY_RANGE)).toBeNull()
    for (const std of ['-32600', '-32601', '-32602', '-32603', '-32700']) {
      expect(std.match(RESERVED_RANGE)).toBeNull()
      expect(std.match(LEGACY_RANGE)).toBeNull()
    }
  })

  test('the production sweep includes shipped entrypoints but excludes test and proof trees', () => {
    const scanned = productionSources().map(source => source.rel)
    expect(scanned).toContain('bin/agentic-mermaid-mcp.ts')
    expect(scanned).toContain('website/build.ts')
    expect(scanned).not.toContain('src/__tests__/mcp-reserved-error-codes.test.ts')
    expect(scanned).not.toContain('scripts/pr-assets/artifact-receipt.ts')
    expect(scanned.some(rel => rel.startsWith('eval/'))).toBeFalse()
  })

  test('stripComments removes documentation but keeps code and URLs intact', () => {
    expect(stripComments('// mentions -32021\nconst a = 1')).not.toContain('-32021')
    expect(stripComments('/** doc -32002 */\nconst a = 1')).not.toContain('-32002')
    expect(stripComments("const u = 'https://x.dev/mcp'")).toContain('https://x.dev/mcp')
    expect(stripComments('const code = -32020 // trailing note')).toContain('-32020')
    expect(stripComments('const marker = "//"; const code = -32021')).toContain('-32021')
  })
})

describe('the allowed codes are the ones actually emitted', () => {
  const context = (): HostedMcpContext => ({ async execute() { return { ok: true, value: 42, logs: [] } } })

  test('an unsupported protocol version yields -32022 with the supported list', async () => {
    const handler = createMcpHandler({ hosted: { context: context() } } as never)
    const response = await handler(new Request('https://agentic-mermaid.dev/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'mcp-protocol-version': '1999-01-01' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))
    const body = await response.json() as { error: { code: number; data: { supported: string[] } } }
    expect(body.error.code).toBe(UNSUPPORTED_PROTOCOL_VERSION)
    expect(body.error.data.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS])
  })

  test('a malformed modern request yields standard INVALID_PARAMS, not a reserved code', async () => {
    // The spec routes missing required `_meta` fields to -32602, NOT to a code
    // in the reserved sub-range — the distinction this file exists to hold.
    const request: JsonRpcRequest = {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
      params: { _meta: { [META_PROTOCOL_VERSION]: MODERN } },
    }
    const response = await handleHostedRequest(request, context())
    expect(response?.error?.code).toBe(-32602)
  })

  test('a well-formed modern request emits no error code at all', async () => {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
      params: { _meta: { [META_PROTOCOL_VERSION]: MODERN, [META_CLIENT_CAPABILITIES]: {} } },
    }
    const response = await handleHostedRequest(request, context())
    expect(response?.error).toBeUndefined()
  })
})
