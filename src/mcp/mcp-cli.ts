import { runHttp, runStdio, type HttpMcpOptions } from './server.ts'

export const MCP_CLI_HELP = `agentic-mermaid-mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3000]

Options:
  --transport stdio|http         Transport to run (default stdio).
  --host <host>                  HTTP/SSE bind host (default 127.0.0.1).
  --port <port>                  HTTP/SSE bind port (default 3000, 0 = ephemeral).
  --artifact-dir <dir>           Managed artifact directory for file/url outputs.
  --public-url <url>             Public artifact prefix; its origin is allowed by HTTP/SSE.
  --max-artifact-bytes <n>       Maximum bytes in one artifact (default 20MiB).
  --max-artifact-total-bytes <n> Aggregate managed artifact bytes (default 200MiB).
  --max-artifacts <n>            Maximum managed artifact count (default 1000).
  --artifact-ttl-ms <n>          Artifact cleanup TTL (default 1h).
  --max-rpc-body-bytes <n>       Max HTTP JSON-RPC body size (default 1MiB).
  --auth-token <token>           Bearer token required for every non-health HTTP route.
  --max-sandbox-timeout-ms <n>   Max execute timeout (default 30000).
  --help                         Show this help.
`

export interface McpCliIo {
  stdout?: Pick<typeof process.stdout, 'write'>
  stderr?: Pick<typeof process.stderr, 'write'>
}

type McpFlagSpec =
  | { readonly kind: 'boolean'; readonly applicability: 'both' }
  | { readonly kind: 'string'; readonly applicability: 'both' | 'http' }
  | { readonly kind: 'integer'; readonly applicability: 'both' | 'http'; readonly min: number; readonly max?: number }

export const MCP_FLAG_SPECS = Object.freeze({
  help: { kind: 'boolean', applicability: 'both' },
  transport: { kind: 'string', applicability: 'both' },
  host: { kind: 'string', applicability: 'http' },
  port: { kind: 'integer', applicability: 'http', min: 0, max: 65535 },
  'artifact-dir': { kind: 'string', applicability: 'both' },
  'public-url': { kind: 'string', applicability: 'http' },
  'max-artifact-bytes': { kind: 'integer', applicability: 'both', min: 1 },
  'max-artifact-total-bytes': { kind: 'integer', applicability: 'both', min: 1 },
  'max-artifacts': { kind: 'integer', applicability: 'both', min: 1 },
  'artifact-ttl-ms': { kind: 'integer', applicability: 'both', min: 1 },
  'max-rpc-body-bytes': { kind: 'integer', applicability: 'http', min: 1 },
  'auth-token': { kind: 'string', applicability: 'http' },
  'max-sandbox-timeout-ms': { kind: 'integer', applicability: 'both', min: 1 },
} as const satisfies Readonly<Record<string, McpFlagSpec>>)

type ParsedMcpFlags = Readonly<Record<string, string | true>>

function parseMcpFlags(argv: readonly string[]): ParsedMcpFlags {
  const flags: Record<string, string | true> = {}
  for (let index = 0; index < argv.length; index++) {
    let token = argv[index]!
    if (token === '-h') token = '--help'
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`)
    const equals = token.indexOf('=')
    const name = token.slice(2, equals < 0 ? undefined : equals)
    const spec = (MCP_FLAG_SPECS as Readonly<Record<string, McpFlagSpec>>)[name]
    if (!spec) throw new Error(`unknown option: --${name}`)
    if (Object.hasOwn(flags, name)) throw new Error(`duplicate flag: --${name}`)
    const inline = equals < 0 ? undefined : token.slice(equals + 1)
    if (spec.kind === 'boolean') {
      if (inline !== undefined) throw new Error(`--${name} does not accept a value`)
      flags[name] = true
      continue
    }
    const value = inline ?? argv[++index]
    if (value === undefined || value.length === 0 || value.startsWith('-')) {
      throw new Error(`--${name} requires a value`)
    }
    flags[name] = value
  }
  return Object.freeze(flags)
}

function stringFlag(flags: ParsedMcpFlags, name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

function integerFlag(flags: ParsedMcpFlags, name: keyof typeof MCP_FLAG_SPECS): number | undefined {
  const raw = stringFlag(flags, name)
  if (raw === undefined) return undefined
  const candidate = MCP_FLAG_SPECS[name]
  if (candidate.kind !== 'integer') throw new Error(`internal MCP flag authority mismatch for --${name}`)
  const spec = candidate as Extract<McpFlagSpec, { kind: 'integer' }>
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < spec.min || (spec.max !== undefined && value > spec.max)) {
    throw new Error(`--${name} must be an integer${spec.max === undefined ? ` >= ${spec.min}` : ` between ${spec.min} and ${spec.max}`}`)
  }
  return value
}

export function parseMcpCliOptions(argv: readonly string[]): { transport: 'stdio' | 'http'; httpOptions: HttpMcpOptions } {
  const flags = parseMcpFlags(argv)
  const explicitTransport = stringFlag(flags, 'transport')
  if (explicitTransport !== undefined && explicitTransport !== 'stdio' && explicitTransport !== 'http') {
    throw new Error(`unknown transport: ${explicitTransport}`)
  }
  const transport: 'stdio' | 'http' = explicitTransport === 'http' ? 'http' : 'stdio'
  if (transport === 'stdio') {
    const invalid = Object.keys(flags).filter(name => MCP_FLAG_SPECS[name as keyof typeof MCP_FLAG_SPECS]?.applicability === 'http')
    if (invalid.length > 0) throw new Error(`${invalid.map(name => `--${name}`).join(', ')} ${invalid.length === 1 ? 'is' : 'are'} valid only with HTTP transport`)
  }
  return {
    transport,
    httpOptions: {
      host: stringFlag(flags, 'host'),
      port: integerFlag(flags, 'port'),
      artifactDir: stringFlag(flags, 'artifact-dir'),
      publicUrl: stringFlag(flags, 'public-url'),
      maxArtifactBytes: integerFlag(flags, 'max-artifact-bytes'),
      maxArtifactTotalBytes: integerFlag(flags, 'max-artifact-total-bytes'),
      maxArtifacts: integerFlag(flags, 'max-artifacts'),
      artifactTtlMs: integerFlag(flags, 'artifact-ttl-ms'),
      maxRpcBodyBytes: integerFlag(flags, 'max-rpc-body-bytes'),
      authToken: stringFlag(flags, 'auth-token'),
      maxSandboxTimeoutMs: integerFlag(flags, 'max-sandbox-timeout-ms'),
    },
  }
}

export async function runMcpCli(argv: readonly string[] = process.argv.slice(2), io: McpCliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      stdout.write(MCP_CLI_HELP)
      return 0
    }
    const { transport, httpOptions } = parseMcpCliOptions(argv)
    if (transport === 'http') {
      await runHttp(httpOptions)
      return 0
    }
    await runStdio({
      artifactDir: httpOptions.artifactDir,
      maxArtifactBytes: httpOptions.maxArtifactBytes,
      maxArtifactTotalBytes: httpOptions.maxArtifactTotalBytes,
      maxArtifacts: httpOptions.maxArtifacts,
      artifactTtlMs: httpOptions.artifactTtlMs,
      maxSandboxTimeoutMs: httpOptions.maxSandboxTimeoutMs,
    })
    return 0
  } catch (err) {
    stderr.write(`agentic-mermaid-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
