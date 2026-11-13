// Live MCP discovery and era contracts. Exact prose and generated schemas belong
// to their owning behavioral tests, not a second checked-in copy of the surface.
import { describe, expect, test } from 'bun:test'
import { handleRequest, HTTP_SSE_PROTOCOL_VERSIONS, LOCAL_TOOLS } from '../mcp/server.ts'
import { handleHostedRequest, HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import type { McpToolDefinition } from '../mcp/tool-surface.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import pkg from '../../package.json'

const INITIALIZE: JsonRpcRequest = {
  jsonrpc: '2.0', id: 0, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'surface-test', version: '0' } },
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'surface-test', version: '0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}
const modernRequest = (id: number, method: string, params: Record<string, unknown> = {}): JsonRpcRequest =>
  ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: MODERN_META } })

const MODERN_CALLS: Array<{ label: string; request: JsonRpcRequest; error?: boolean }> = [
  { label: 'server-discover', request: modernRequest(20, 'server/discover') },
  { label: 'tools-list', request: modernRequest(21, 'tools/list') },
  { label: 'describe', request: modernRequest(22, 'tools/call', { name: 'describe', arguments: { source: 'flowchart TD\n A --> B' } }) },
  { label: 'initialize-is-unknown', request: modernRequest(23, 'initialize'), error: true },
  { label: 'missing-capabilities', request: { jsonrpc: '2.0', id: 24, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }, error: true },
  { label: 'no-client-info', request: { jsonrpc: '2.0', id: 25, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } } },
]

type Surface = {
  name: string
  tools: McpToolDefinition[]
  dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse | null>
}
const SURFACES: Surface[] = [
  { name: 'local', tools: LOCAL_TOOLS, dispatch: handleRequest },
  { name: 'hosted', tools: HOSTED_TOOLS, dispatch: request => handleHostedRequest(request, { async execute() { return { ok: true, value: 42, logs: [] } } }) },
]

describe('MCP live response contracts', () => {
  for (const surface of SURFACES) {
    test(`${surface.name} reports the installed version and serves its registered tool definitions`, async () => {
      const initialized = await surface.dispatch(INITIALIZE)
      expect(initialized?.error).toBeUndefined()
      expect((initialized?.result as { serverInfo: { version: string } }).serverInfo.version).toBe(pkg.version)
      const listed = await surface.dispatch({ jsonrpc: '2.0', id: 30, method: 'tools/list' })
      expect(listed?.error).toBeUndefined()
      expect((listed?.result as { tools: McpToolDefinition[] }).tools).toEqual(surface.tools)
    })

    for (const { label, request, error } of MODERN_CALLS) {
      test(`${surface.name} keeps modern ${label} in its selected protocol era`, async () => {
        const response = await surface.dispatch(request)
        expect(response?.id).toBe(request.id!)
        if (error) {
          expect(typeof response?.error?.code).toBe('number')
          expect(response?.result).toBeUndefined()
        } else {
          expect(response?.error).toBeUndefined()
          expect((response?.result as { resultType: string }).resultType).toBe('complete')
        }
      })
    }
  }

  test.each(['server/discover', 'tools/list'])('local HTTP/SSE refuses modern %s and reports its supported revision', async method => {
    const response = await handleRequest(modernRequest(31, method), {}, { supportedVersions: HTTP_SSE_PROTOCOL_VERSIONS })
    expect(response?.error?.code).toBe(-32022)
    expect((response?.error?.data as { supported: string[] }).supported).toEqual(['2024-11-05'])
  })
})
