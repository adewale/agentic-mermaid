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

/** Append `{verb}` to $AM_TRACE_LOG if set. No-op when unset or off-node. */
export function logToolInvocation(verb: string): void {
  const path = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.AM_TRACE_LOG
  if (!path) return
  try { resolveAppend()?.(path, JSON.stringify({ verb }) + '\n') } catch { /* best-effort */ }
}
