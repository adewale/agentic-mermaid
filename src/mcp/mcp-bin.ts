#!/usr/bin/env node
// Published MCP server entrypoint (node-runnable). The Bun-based
// bin/agentic-mermaid-mcp.ts is kept for local development; tsup compiles this
// file to dist/agentic-mermaid-mcp.js for npm consumers.
import { runHttp, runStdio, type HttpMcpOptions } from './server.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string): boolean => args.includes(name)

if (has('--help') || has('-h')) {
  process.stdout.write(`agentic-mermaid-mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3000]\n\nOptions:\n  --transport stdio|http   Transport to run (default stdio). --http is an alias.\n  --host <host>            HTTP/SSE bind host (default 127.0.0.1).\n  --port <port>            HTTP/SSE bind port (default 3000, 0 = ephemeral).\n  --artifact-dir <dir>     Managed artifact directory for file/url outputs.\n  --public-url <url>       Public URL prefix for managed artifacts.\n  --max-artifact-bytes <n> Max artifact size (default 20MiB).\n  --artifact-ttl-ms <n>    Artifact cleanup TTL (default 1h).\n  --max-rpc-body-bytes <n> Max HTTP JSON-RPC body size (default 1MiB).\n  --auth-token <token>     Bearer token required for HTTP /rpc and /message.\n  --max-sandbox-timeout-ms <n> Max execute timeout (default 30000).\n`)
  process.exit(0)
}

function integerFlag(name: string, opts: { min: number; max?: number }): number | undefined {
  const raw = flag(name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < opts.min || (opts.max !== undefined && n > opts.max)) {
    throw new Error(`${name} must be an integer${opts.max === undefined ? ` >= ${opts.min}` : ` between ${opts.min} and ${opts.max}`}`)
  }
  return n
}

async function main(): Promise<void> {
  const transport = has('--http') ? 'http' : (flag('--transport') ?? 'stdio')
  const httpOptions: HttpMcpOptions = {
    host: flag('--host'),
    port: integerFlag('--port', { min: 0, max: 65535 }),
    artifactDir: flag('--artifact-dir'),
    publicUrl: flag('--public-url'),
    maxArtifactBytes: integerFlag('--max-artifact-bytes', { min: 1 }),
    artifactTtlMs: integerFlag('--artifact-ttl-ms', { min: 1 }),
    maxRpcBodyBytes: integerFlag('--max-rpc-body-bytes', { min: 1 }),
    authToken: flag('--auth-token'),
    maxSandboxTimeoutMs: integerFlag('--max-sandbox-timeout-ms', { min: 1 }),
  }
  if (transport === 'http') return await runHttp(httpOptions)
  if (transport === 'stdio') return await runStdio({ artifactDir: httpOptions.artifactDir, maxArtifactBytes: httpOptions.maxArtifactBytes, artifactTtlMs: httpOptions.artifactTtlMs })
  throw new Error(`unknown transport: ${transport}`)
}

main().catch(err => {
  process.stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
