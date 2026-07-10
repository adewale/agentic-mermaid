import { runCli } from './index.ts'

/** Route the package-name binary's registry command to the existing MCP CLI. */
export async function runAmCli(argv: string[]): Promise<number> {
  if (argv[0] === 'mcp') {
    const { runMcpCli } = await import('../mcp/mcp-cli.ts')
    return runMcpCli(argv.slice(1))
  }
  return runCli(argv)
}
