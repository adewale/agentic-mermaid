// A prescriptive syntax error: say WHAT is wrong AND how to fix it — the
// expected form plus a copyable example (and, when known, the valid identifiers
// in scope) — so a caller, especially a smaller model driving the hosted MCP,
// can correct from the message alone instead of trial-and-error. The render-path
// parsers throw it as a MermaidSyntaxError, which `verifyMermaid` attributes to
// the authored source (RENDER_FAILED with `origin: 'source'`) and flattens into
// the warning's `reason` string, so the prescriptive text rides straight
// through to the agent. Message shape mirrors the architecture edge errors:
//   `<what> — expected <expectedForm>, e.g. <example>[ (known: a, b, c)]`
export class MermaidSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MermaidSyntaxError'
  }
}

export function syntaxError(detail: {
  what: string
  expectedForm: string
  example: string
  known?: readonly string[]
}): MermaidSyntaxError {
  const known = detail.known && detail.known.length > 0 ? ` (known: ${detail.known.join(', ')})` : ''
  return new MermaidSyntaxError(`${detail.what} — expected ${detail.expectedForm}, e.g. ${detail.example}${known}`)
}
