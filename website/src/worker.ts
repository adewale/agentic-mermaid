// Website Worker: static assets on Cloudflare's asset path, plus the hosted
// MCP endpoint at /mcp (stateless Streamable HTTP; see mcp-handler.ts).

import { renderMermaidPNGWasm } from './png-wasm.ts'
import executeHarness from './generated/execute-harness.js.txt'
import { DEPLOY_VERSION } from './generated/deploy-version.ts'
import { createWebsiteWorker } from './worker-core.ts'

export default createWebsiteWorker({
  executeHarness,
  renderPng: renderMermaidPNGWasm,
  deployVersion: DEPLOY_VERSION,
})
