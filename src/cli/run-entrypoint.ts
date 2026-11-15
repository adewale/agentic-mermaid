import { preflightCli } from './preflight.ts'
import { CLI_DEADLINE_CHILD_ENV, runCliWithDeadline } from './deadline.ts'

/** Route the package-name binary's registry command to the existing MCP CLI. */
export async function runAmCli(argv: string[]): Promise<number> {
  if (argv[0] === 'mcp') {
    const { runMcpCli } = await import('../mcp/mcp-cli.ts')
    return runMcpCli(argv.slice(1))
  }
  const prepared = preflightCli(argv)
  if ('exitCode' in prepared) return prepared.exitCode
  // Layout cannot be interrupted in-process: a command with a deadline runs
  // in a child this process terminates when the deadline passes.
  if (prepared.deadlineMs !== undefined && !process.env[CLI_DEADLINE_CHILD_ENV]) {
    return runCliWithDeadline(argv, prepared.args.command, prepared.deadlineMs, prepared.json)
  }
  const { runPreparedCli } = await import('./index.ts')
  return runPreparedCli(prepared)
}
