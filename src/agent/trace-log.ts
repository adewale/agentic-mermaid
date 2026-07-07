// Shared OBSERVED tool-use sink. When the AM_TRACE_LOG env var names a file,
// every agent-facing entry point — the `am` CLI, the library functions
// (verifyMermaid / mutate / buildMermaid / …), and the hosted MCP verify/mutate/
// build tools — appends one `{verb}` JSON line here. The agent-usage eval reads
// this to grade traceOk from the calls an agent ACTUALLY made, regardless of
// which channel it drove, instead of inferring tool use from its Trace prose
// (see eval/agent-usage/RUNBOOK.md).
//
// Portability: this module is bundled for the browser (the website editor runs
// the library), so it must NOT statically import `node:fs`. It reaches fs at
// runtime via `process.getBuiltinModule` — absent in browsers/Workers, so it
// degrades to a no-op there. Logging is best-effort and never throws into the
// caller: a diagram operation must never fail because its trace line couldn't
// be written.

type AppendFn = (path: string, data: string) => void

let appendFn: AppendFn | null | undefined // undefined = not yet probed

function resolveAppend(): AppendFn | null {
  if (appendFn !== undefined) return appendFn
  appendFn = null
  try {
    const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process
    const fs = proc?.getBuiltinModule?.('node:fs') as { appendFileSync?: AppendFn } | undefined
    if (typeof fs?.appendFileSync === 'function') appendFn = fs.appendFileSync
  } catch { /* no node fs available (browser / Worker) */ }
  return appendFn
}

/**
 * Append `{verb}` (or `{verb, ok}`) to $AM_TRACE_LOG if set. No-op when unset or
 * off-node. Pass `ok` for verbs whose outcome is meaningful (mutate/build): an
 * `{ok:false}` line records a FAILED op attempt, so the eval can measure a run's
 * error rate from observed failures rather than inferring retries from call
 * counts. Verbs with no natural pass/fail (verify, capabilities) omit it.
 */
export function logToolInvocation(verb: string, ok?: boolean): void {
  const path = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.AM_TRACE_LOG
  if (!path) return
  const record = ok === undefined ? { verb } : { verb, ok }
  try { resolveAppend()?.(path, JSON.stringify(record) + '\n') } catch { /* best-effort */ }
}
