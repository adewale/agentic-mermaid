// A prescriptive syntax error: say WHAT is wrong AND how to fix it — the
// expected form plus a copyable example (and, when known, the valid identifiers
// in scope) — so a caller, especially a smaller model driving the hosted MCP,
// can correct from the message alone instead of trial-and-error. The render-path
// parsers throw plain Errors that `verifyMermaid` flattens into the RENDER_FAILED
// warning's `reason` string, so the prescriptive text rides straight through to
// the agent. Message shape mirrors the architecture edge errors:
//   `<what> — expected <expectedForm>, e.g. <example>[ (known: a, b, c)]`
export function syntaxError(detail: {
  what: string
  expectedForm: string
  example: string
  known?: readonly string[]
}): Error {
  const known = detail.known && detail.known.length > 0 ? ` (known: ${detail.known.join(', ')})` : ''
  return new Error(`${detail.what} — expected ${detail.expectedForm}, e.g. ${detail.example}${known}`)
}
