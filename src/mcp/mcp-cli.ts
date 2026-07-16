import { runHttp, runStdio, type HttpMcpOptions } from './server.ts'

export const MCP_CLI_HELP = `agentic-mermaid-mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3000]

Options:
  --transport stdio|http   Transport to run (default stdio).
  --host <host>            HTTP/SSE bind host (default 127.0.0.1).
  --port <port>            HTTP/SSE bind port (default 3000, 0 = ephemeral).
  --artifact-dir <dir>     Managed artifact directory for file/url outputs.
  --public-url <url>       Public artifact prefix; its origin is allowed by HTTP/SSE.
  --max-artifact-bytes <n> Max artifact size (default 20MiB).
  --artifact-ttl-ms <n>    Artifact cleanup TTL (default 1h).
  --max-rpc-body-bytes <n> Max HTTP JSON-RPC body size (default 1MiB).
  --auth-token <token>     Bearer token required for every non-health HTTP route.
  --max-sandbox-timeout-ms <n> Max execute timeout (default 30000).
`

export interface McpCliIo {
  stdout?: Pick<typeof process.stdout, 'write'>
  stderr?: Pick<typeof process.stderr, 'write'>
}

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function has(args: readonly string[], name: string): boolean {
  return args.includes(name)
}

const MCP_VALUE_FLAGS = new Set([
  '--transport',
  '--host',
  '--port',
  '--artifact-dir',
  '--public-url',
  '--max-artifact-bytes',
  '--artifact-ttl-ms',
  '--max-rpc-body-bytes',
  '--auth-token',
  '--max-sandbox-timeout-ms',
])

function validateArgs(args: readonly string[]): void {
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--help' || arg === '-h') continue
    if (!MCP_VALUE_FLAGS.has(arg)) throw new Error(`unknown option: ${arg}`)
    if (seen.has(arg)) throw new Error(`${arg} may be provided only once`)
    seen.add(arg)
    const value = args[i + 1]
    if (value === undefined || value.startsWith('-')) throw new Error(`${arg} requires a value`)
    i++
  }
}

function integerFlag(args: readonly string[], name: string, opts: { min: number; max?: number }): number | undefined {
  const raw = flag(args, name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < opts.min || (opts.max !== undefined && n > opts.max)) {
    throw new Error(`${name} must be an integer${opts.max === undefined ? ` >= ${opts.min}` : ` between ${opts.min} and ${opts.max}`}`)
  }
  return n
}

export function parseMcpCliOptions(argv: readonly string[]): { transport: string; httpOptions: HttpMcpOptions } {
  validateArgs(argv)
  const transport = flag(argv, '--transport') ?? 'stdio'
  return {
    transport,
    httpOptions: {
      host: flag(argv, '--host'),
      port: integerFlag(argv, '--port', { min: 0, max: 65535 }),
      artifactDir: flag(argv, '--artifact-dir'),
      publicUrl: flag(argv, '--public-url'),
      maxArtifactBytes: integerFlag(argv, '--max-artifact-bytes', { min: 1 }),
      artifactTtlMs: integerFlag(argv, '--artifact-ttl-ms', { min: 1 }),
      maxRpcBodyBytes: integerFlag(argv, '--max-rpc-body-bytes', { min: 1 }),
      authToken: flag(argv, '--auth-token'),
      maxSandboxTimeoutMs: integerFlag(argv, '--max-sandbox-timeout-ms', { min: 1 }),
    },
  }
}

export async function runMcpCli(argv: readonly string[] = process.argv.slice(2), io: McpCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  try {
    if (has(argv, '--help') || has(argv, '-h')) {
      stdout.write(MCP_CLI_HELP)
      return 0
    }
    const { transport, httpOptions } = parseMcpCliOptions(argv)
    if (transport === 'http') {
      await runHttp(httpOptions)
      return 0
    }
    if (transport === 'stdio') {
      await runStdio({ artifactDir: httpOptions.artifactDir, maxArtifactBytes: httpOptions.maxArtifactBytes, artifactTtlMs: httpOptions.artifactTtlMs })
      return 0
    }
    throw new Error(`unknown transport: ${transport}`)
  } catch (err) {
    stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
