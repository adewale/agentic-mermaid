import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { EXIT_INTERNAL, EXIT_TIMEOUT } from './exit-codes.ts'

declare const __AM_STANDALONE__: boolean

/** Commands that parse and lay out a diagram. Layout runs synchronously and
 * cannot be interrupted in-process, so these run in a child process the CLI
 * terminates at the deadline. */
export const DEADLINE_COMMANDS: ReadonlySet<string> = new Set(['render', 'verify', 'mutate', 'describe', 'preview', 'render-markdown'])

/** Long enough for any diagram the work budgets admit on ordinary hardware,
 * short enough that a pathological input cannot hold an agent loop for
 * minutes (D2's CLI uses the same default). */
export const DEFAULT_CLI_TIMEOUT_SECONDS = 120

/** The largest delay a JavaScript timer can wait. */
const MAX_TIMEOUT_SECONDS = Math.floor(0x7fffffff / 1000)

/** Set in the child the deadline supervisor starts, which then runs the
 * command in-process. */
export const CLI_DEADLINE_CHILD_ENV = 'AM_CLI_DEADLINE_CHILD'

/** The deadline for a prepared command in milliseconds, undefined for none,
 * or the argument error to report. `--watch` keeps running by design and
 * takes no deadline. */
export function cliDeadlineMs(command: string, timeout: string | undefined, watch: boolean): number | undefined | { error: string } {
  let seconds = DEFAULT_CLI_TIMEOUT_SECONDS
  if (timeout !== undefined) {
    seconds = /^\s*$/.test(timeout) ? Number.NaN : Number(timeout)
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_TIMEOUT_SECONDS) {
      return { error: `am ${command} --timeout expects seconds from 0 (no limit) to ${MAX_TIMEOUT_SECONDS}` }
    }
    if (watch && seconds > 0) return { error: 'am render --timeout is not valid with --watch' }
  }
  if (!DEADLINE_COMMANDS.has(command) || watch || seconds === 0) return undefined
  return Math.max(1, Math.round(seconds * 1000))
}

/** Rerun this invocation in a child process with inherited stdio and
 * terminate it at the deadline. Output the child already wrote stays written. */
export function runCliWithDeadline(argv: readonly string[], command: string, timeoutMs: number, json: boolean): Promise<number> {
  const standalone = typeof __AM_STANDALONE__ !== 'undefined' && __AM_STANDALONE__
  // Compiled Bun programs reexecute themselves; script runs pass their entry.
  const entry = standalone || !process.argv[1] ? [] : [...process.execArgv, process.argv[1]]
  return new Promise(resolve => {
    let timedOut = false
    const child = spawn(process.execPath, [...entry, ...argv], {
      stdio: 'inherit',
      env: { ...process.env, [CLI_DEADLINE_CHILD_ENV]: '1' },
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', error => {
      clearTimeout(timer)
      process.stderr.write(`am ${command}: could not start the deadline-supervised process: ${error.message}\n`)
      resolve(EXIT_INTERNAL)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        const seconds = timeoutMs / 1000
        const message = `am ${command} exceeded its ${seconds}s deadline and was stopped; raise --timeout, or pass --timeout 0 for no limit`
        if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: 'RENDER_TIMEOUT', message } }) + '\n')
        process.stderr.write(`Error: RENDER_TIMEOUT: ${message}\n`)
        resolve(EXIT_TIMEOUT)
        return
      }
      resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : EXIT_INTERNAL))
    })
  })
}
