// Bind the hosted MCP handler to a local port for out-of-process client
// probes (scripts/interop/probe-python.py, probe-go/). Same seams as the
// in-process interop tests: real tool core and transport, fake execute (the
// Worker Loader needs workerd), no cache. Prints the URL on stdout and serves
// until killed.

import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../../src/mcp/hosted-server.ts'

const context: HostedMcpContext = {
  async execute(code) {
    return { ok: true, value: `interop-ran:${code.length}`, logs: [] }
  },
}
const handler = createMcpHandler({ context, cacheVersion: 'interop-probe', onEvent: () => {} })
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.INTEROP_PORT ?? 0), fetch: request => handler(request) })
console.log(`http://127.0.0.1:${server.port}/mcp`)
