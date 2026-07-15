import { describe, expect, test } from 'bun:test'

import {
  handleHostedRequest,
  type ExecuteResult,
  type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import { handleRequest } from '../mcp/server.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { EXTERNAL_FAMILY_DESCRIBE_UNAVAILABLE_CODE } from '../mcp/describe-payload.ts'
import {
  type ExternalFamilyId,
  type FamilyDescriptor,
} from '../agent/families.ts'
import { registerFamily } from '../agent/family-registration.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { toFinite } from '../agent/types.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'

const FAMILY = 'family:test/mcp-forward' as ExternalFamilyId
const HEADER = 'mcpForwardDiagram'
const SOURCE = `${HEADER}\n  opaque payload`
const EVIDENCE = 'src/__tests__/extension-family-mcp-parity.test.ts'

function descriptor(onVerify: () => void = () => {}): FamilyDescriptor {
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id: FAMILY,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'extension-mcp-parity-test', source: 'test', reference: EVIDENCE },
    }),
    id: FAMILY,
    label: 'MCP Forward',
    example: SOURCE,
    headers: [HEADER],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === HEADER.toLowerCase(),
    semanticRoles: [],
    semanticChannels: [],
    scenePrimitiveEvidence: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'native', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'native', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    verify: () => { onVerify(); return [] },
    layout: () => ({ width: 120, height: 40 }),
    projectPositioned: () => ({
      version: 1,
      nodes: [{
        id: 'extension-node',
        x: toFinite(8),
        y: toFinite(8),
        w: toFinite(104),
        h: toFinite(24),
        shape: 'rectangle',
        label: 'MCP Forward',
      }],
      edges: [],
      groups: [],
      bounds: { w: toFinite(120), h: toFinite(40) },
    }),
    renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><text x="8" y="24">MCP Forward</text></svg>',
  }
}

function call(name: string, args: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

function payloadOf(response: JsonRpcResponse | null): Record<string, unknown> {
  const result = response?.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined
  const text = result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('MCP response did not contain a textual payload')
  const payload: unknown = JSON.parse(text)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('MCP textual payload was not a JSON object')
  }
  return { ...payload, isError: result?.isError === true }
}

function hostedContext(): HostedMcpContext {
  return {
    async execute(): Promise<ExecuteResult> {
      return { ok: true, value: null, logs: [] }
    },
  }
}

describe('registered external family MCP parity', () => {
  test('registered parse JSON survives the public synthesize/serialize pipe', () => {
    const unregister = registerFamily(descriptor())
    try {
      const parsed = parseRegisteredMermaid(SOURCE)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const expected = serializeMermaid(parsed.value)
      const payload = JSON.parse(JSON.stringify(parsed.value))
      const synthesized = synthesizeFromGraph(payload)
      expect(synthesized.ok).toBe(true)
      if (!synthesized.ok) return
      expect(String(synthesized.value.kind)).toBe(FAMILY)
      expect(serializeMermaid(synthesized.value)).toBe(expected)
    } finally {
      unregister()
    }
  })

  test('hosted direct verify executes the installed descriptor instead of the closed compatibility parser', async () => {
    let verifyCalls = 0
    const unregister = registerFamily(descriptor(() => { verifyCalls++ }))
    verifyCalls = 0
    try {
      const payload = payloadOf(await handleHostedRequest(call('verify', { source: SOURCE }), hostedContext()))
      expect(payload).toMatchObject({
        ok: true,
        isError: false,
        family: FAMILY,
        warnings: [],
        layout: { bounds: { w: 120, h: 40 }, nodes: 1, edges: 0 },
      })
      expect(payload.summary).toContain(FAMILY)
      expect(payload.summary).toContain('semantic description is unavailable')
      expect(JSON.stringify(payload)).not.toContain('EXTENSION_PARSE_REQUIRES_OPEN_ENVELOPE')
      expect(verifyCalls).toBe(1)
    } finally {
      unregister()
    }
  })

  test('hosted and local describe return one stable unavailable capability diagnostic', async () => {
    const unregister = registerFamily(descriptor())
    try {
      for (const format of ['text', 'json', 'facts'] as const) {
        const responses = [
          payloadOf(await handleHostedRequest(call('describe', { source: SOURCE, format }), hostedContext())),
          payloadOf(await handleRequest(call('describe', { source: SOURCE, format }))),
        ]
        for (const payload of responses) {
          expect(payload).toMatchObject({
            ok: false,
            isError: true,
            family: FAMILY,
            error: {
              code: EXTERNAL_FAMILY_DESCRIBE_UNAVAILABLE_CODE,
              capability: 'describe',
              family: FAMILY,
            },
          })
          expect((payload.error as Record<string, unknown>).message).toContain('FamilyDescriptor v1')
          expect(JSON.stringify(payload)).not.toContain('EXTENSION_PARSE_REQUIRES_OPEN_ENVELOPE')
        }
      }
    } finally {
      unregister()
    }
  })
})
