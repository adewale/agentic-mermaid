import { parseArgs, flagEnabled, FLAG_SPECS, COMMAND_FLAGS, COMMAND_POSITIONALS, type ParsedArgs } from './args.ts'
import { GLOBAL_USAGE, COMMAND_HELP } from './help.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { EXIT_OK, EXIT_ARG_ERROR } from './exit-codes.ts'

export interface PreparedCli { args: ParsedArgs & { command: string }; json: boolean }

/** An invalid invocation (flag value, flag combination, op JSON) detected by a
 * command after preflight. Commands throw it; the CLI failure boundary reports
 * it exactly like a preflight argument error. */
export class CliArgumentError extends Error {}

/** The one argument-error report: human text on stderr and, under --json, the
 * {ok:false,error:{code:'ARG'}} envelope on stdout; exit 2. */
export function reportArgumentError(message: string, json: boolean): number {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: 'ARG', message } }) + '\n')
  process.stderr.write(`${message}\n`)
  return EXIT_ARG_ERROR
}

export function preflightCli(argv: string[]): { exitCode: number } | PreparedCli {
  const args = parseArgs(argv)
  const json = flagEnabled(args, 'json')
  const argError = (message: string): number => reportArgumentError(message, json)
  if (args.errors.length > 0) return { exitCode: argError(args.errors.join(' ')) }
  if (flagEnabled(args, 'agent-instructions')) {
    process.stdout.write(AGENT_INSTRUCTIONS)
    return { exitCode: EXIT_OK }
  }
  if (flagEnabled(args, 'help') && !args.command) {
    process.stdout.write(GLOBAL_USAGE)
    return { exitCode: EXIT_OK }
  }
  if (!args.command) {
    process.stdout.write(GLOBAL_USAGE)
    return { exitCode: EXIT_ARG_ERROR }
  }
  if (flagEnabled(args, 'help')) {
    process.stdout.write((COMMAND_HELP[args.command] ?? GLOBAL_USAGE) + '\n')
    return { exitCode: EXIT_OK }
  }
  // Unknown flags are ERRORS, not silently-swallowed no-ops (probe-confirmed
  // bug class: `--gantt-toady 2024-01-05` used to exit 0 with no marker and no
  // complaint). FLAG_SPECS is the single source of truth for what exists.
  const unknownFlags = Object.keys(args.flags).filter(name => !(name in FLAG_SPECS))
  if (unknownFlags.length > 0) {
    const message = `Unknown flag${unknownFlags.length > 1 ? 's' : ''}: ${unknownFlags.map(f => `--${f}`).join(', ')}. Run \`am --help\` or \`am ${args.command} --help\` for the flag list.`
    return { exitCode: argError(message) }
  }
  const missingValues = Object.entries(args.flags)
    .filter(([name, value]) => FLAG_SPECS[name]?.arg && (typeof value !== 'string' || value.length === 0))
    .map(([name]) => name)
  if (missingValues.length > 0) {
    return { exitCode: argError(`Flag${missingValues.length > 1 ? 's' : ''} ${missingValues.map(name => `--${name}`).join(', ')} require${missingValues.length === 1 ? 's' : ''} a value.`) }
  }
  const allowed = new Set(COMMAND_FLAGS[args.command as keyof typeof COMMAND_FLAGS] ?? ['help'])
  const inapplicable = Object.keys(args.flags).filter(name => !allowed.has(name))
  if (inapplicable.length > 0) {
    return { exitCode: argError(`Flag${inapplicable.length > 1 ? 's' : ''} ${inapplicable.map(name => `--${name}`).join(', ')} ${inapplicable.length > 1 ? 'are' : 'is'} not valid for am ${args.command}.`) }
  }
  const positionalContract = COMMAND_POSITIONALS[args.command as keyof typeof COMMAND_POSITIONALS]
  if (positionalContract && (args.positional.length < positionalContract.min || args.positional.length > positionalContract.max)) {
    return { exitCode: argError(`am ${args.command} accepts ${positionalContract.max === 0 ? 'no positional arguments' : `at most ${positionalContract.max} positional input${positionalContract.max === 1 ? '' : 's'}`}; received ${args.positional.length}.`) }
  }
  return { args: args as PreparedCli['args'], json }
}
