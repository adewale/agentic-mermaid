// Real-client compatibility tests: the reference MCP client SDK
// (@modelcontextprotocol/sdk) drives both servers through the actual
// lifecycle — initialize → tools/list → tools/call → notifications — so
// compatibility is observed against a client we did not write, not asserted
// from our own reading of the spec (docs/project/mcp-client-interop-verification-plan.md).
//
// Complementary, not a replacement: the per-clause conformance matrix
// (forced old versions, malformed frames, batch rules, CORS edges) lives in
// hosted-mcp-http.test.ts — the SDK cannot be told to send those. This file
// proves the default path a well-behaved real client takes actually works.

import { afterAll, describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import { HOSTED_MCP_SERVER_NAME, HOSTED_TOOLS, SUPPORTED_PROTOCOL_VERSIONS, type HostedMcpContext } from '../mcp/hosted-server.ts'
import { LOCAL_TOOLS } from '../mcp/server.ts'

const FLOW = 'flowchart LR\n  A --> B'
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Poll until `condition` holds; the SDK opens its GET stream asynchronously
 * after the initialized notification, so the 405 exchange needs a wait that
 * is deterministic-in-outcome rather than a fixed sleep. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) return false
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return true
}

describe('hosted /mcp driven by the reference Streamable HTTP client', () => {
  // The only fake is the execute seam that needs workerd (same seam as
  // hosted-mcp-http.test.ts); every pure tool runs the real pipeline.
  const executeCalls: string[] = []
  const context: HostedMcpContext = {
    async execute(code) {
      executeCalls.push(code)
      return { ok: true, value: 'interop-ran', logs: [] }
    },
  }
  const handler = createMcpHandler({ context, cacheVersion: 'interop-test', onEvent: () => {} })
  // Bind the function-shaped handler to a real ephemeral socket: the SDK
  // transport speaks to a URL, and a real HTTP round trip is the point.
  const served: Array<{ method: string; status: number }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async request => {
      const response = await handler(request)
      served.push({ method: request.method, status: response.status })
      return response
    },
  })
  const url = new URL(`http://127.0.0.1:${server.port}/mcp`)
  afterAll(() => { server.stop(true) })

  test('full stateless lifecycle: initialize, list, call, notification, ping', async () => {
    const clientErrors: Error[] = []
    const client = new Client({ name: 'agentic-mermaid-interop-test', version: '0.0.0' })
    client.onerror = error => { clientErrors.push(error) }
    const transport = new StreamableHTTPClientTransport(url)
    try {
      // connect() performs initialize + the initialized notification.
      await client.connect(transport)

      // Sessionless operation accepted: the server never issued Mcp-Session-Id.
      expect(transport.sessionId).toBeUndefined()

      // The SDK offered its latest version; the server echoes a member of its
      // supported set (assert membership, not a hardcoded string — SDK bumps
      // must not break this test; the downgrade acceptance IS the assertion).
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(transport.protocolVersion ?? '(none negotiated)')
      expect(client.getServerVersion()?.name).toBe(HOSTED_MCP_SERVER_NAME)
      expect(client.getInstructions()).toContain('stateless')

      // The advertised surface deserializes through the SDK's schema and
      // matches the hosted tool set exactly.
      const { tools } = await client.listTools()
      expect(new Set(tools.map(tool => tool.name))).toEqual(new Set(HOSTED_TOOLS.map(tool => tool.name)))

      // A real render round-trips: SDK-framed arguments through the real
      // parse→layout→render pipeline, back out as SDK-validated content.
      const rendered = await client.callTool({ name: 'render_svg', arguments: { source: FLOW } })
      const renderedText = (rendered.content as Array<{ type: string; text?: string }>)[0]?.text ?? ''
      expect(renderedText).toContain('<svg')

      // The execute seam received the code exactly as the client framed it.
      const executed = await client.callTool({ name: 'execute', arguments: { code: 'return 1 + 41' } })
      expect(executeCalls).toContain('return 1 + 41')
      expect(JSON.stringify(executed.content)).toContain('interop-ran')

      await client.ping()

      // The transport opened its GET stream after the initialized
      // notification; the stateless server answered 405 and the SDK treated
      // that as "no server stream", not an error. Wait for the exchange, then
      // require that nothing surfaced through onerror.
      expect(await waitFor(() => served.some(entry => entry.method === 'GET' && entry.status === 405))).toBe(true)
      expect(clientErrors).toEqual([])
    } finally {
      await client.close()
    }
  })

  test('a second client connects fresh with no server-side session to resume', async () => {
    // Statelessness consequence a real client depends on: a brand-new client
    // against the same server needs no session continuity to operate.
    const client = new Client({ name: 'agentic-mermaid-interop-second', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(url)
    try {
      await client.connect(transport)
      expect(transport.sessionId).toBeUndefined()
      const described = await client.callTool({ name: 'describe', arguments: { source: FLOW } })
      expect(JSON.stringify(described.content)).toContain('flowchart')
    } finally {
      await client.close()
    }
  })
})

describe('local stdio server driven by the reference stdio client', () => {
  test('spawns the bin, negotiates the pinned version, and drives the 4-tool surface', async () => {
    const client = new Client({ name: 'agentic-mermaid-interop-stdio', version: '0.0.0' })
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'src/mcp/mcp-bin.ts'],
      cwd: REPO_ROOT,
      stderr: 'ignore',
    })
    // StdioClientTransport does not implement setProtocolVersion; the Client
    // calls it only when present, so an instance property captures the
    // negotiated version without touching SDK internals.
    let negotiated: string | undefined
    ;(transport as unknown as { setProtocolVersion: (version: string) => void }).setProtocolVersion = version => { negotiated = version }
    try {
      await client.connect(transport)

      // src/mcp/server.ts pins PROTOCOL_VERSION = '2024-11-05'. If a future
      // SDK drops that version from its supported window, connect() itself
      // fails here — which is the signal to modernize the local server (#186).
      expect(negotiated).toBe('2024-11-05')

      const { tools } = await client.listTools()
      expect(new Set(tools.map(tool => tool.name))).toEqual(new Set(LOCAL_TOOLS.map(tool => tool.name)))

      // Code Mode executes in the real node:vm sandbox end to end.
      const executed = await client.callTool({ name: 'execute', arguments: { code: 'return 1 + 41' } })
      const executedText = (executed.content as Array<{ type: string; text?: string }>)[0]?.text ?? ''
      expect(JSON.parse(executedText)).toMatchObject({ value: 42 })

      const described = await client.callTool({ name: 'describe', arguments: { source: FLOW } })
      expect(JSON.stringify(described.content)).toContain('flowchart')
    } finally {
      await client.close() // reaps the subprocess
    }
  })
})
