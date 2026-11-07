// A prescriptive syntax error: say WHAT is wrong AND how to fix it — the
// expected form plus a copyable example (and, when known, the valid identifiers
// in scope) — so a caller, especially a smaller model driving the hosted MCP,
// can correct from the message alone instead of trial-and-error. The render-path
// parsers throw it as a MermaidSyntaxError, which `verifyMermaid` attributes to
// the authored source (RENDER_FAILED with `origin: 'source'`) and flattens into
// the warning's `reason` string, so the prescriptive text rides straight
// through to the agent. Message shape mirrors the architecture edge errors:
//   `<what> — expected <expectedForm>, e.g. <example>[ (known: a, b, c)]`
export interface MermaidSyntaxErrorLocation {
  /** One-based position in the source supplied to the parser. */
  line?: number
  column?: number
  diagramType?: string
}

// Only parser-owned coordinates belong here. Generic Error.line/column can
// contain JavaScript stack positions under Bun.
export class LocatedParserError extends Error {
  readonly line?: number
  readonly column?: number
  readonly diagramType?: string

  constructor(message: string, location: MermaidSyntaxErrorLocation = {}) {
    super(message)
    this.line = location.line
    this.column = location.column
    this.diagramType = location.diagramType
  }
}

export class MermaidSyntaxError extends LocatedParserError {
  readonly code = 'MERMAID_SYNTAX_ERROR'
  constructor(message: string, location: MermaidSyntaxErrorLocation = {}) {
    super(message, location)
    this.name = 'MermaidSyntaxError'
  }
}

/** Add producer-owned coordinates without losing a specialized error class. */
export function locateSyntaxError(error: unknown, location: MermaidSyntaxErrorLocation): MermaidSyntaxError {
  if (error instanceof MermaidSyntaxError) {
    for (const key of ['line', 'column', 'diagramType'] as const) {
      if (error[key] === undefined && location[key] !== undefined) Object.defineProperty(error, key, { value: location[key], enumerable: true, configurable: true })
    }
    return error
  }
  return new MermaidSyntaxError(error instanceof Error ? error.message : String(error), location)
}

export function syntaxError(detail: {
  what: string
  expectedForm: string
  example: string
  known?: readonly string[]
  location?: MermaidSyntaxErrorLocation
}): MermaidSyntaxError {
  const known = detail.known && detail.known.length > 0 ? ` (known: ${detail.known.join(', ')})` : ''
  return new MermaidSyntaxError(`${detail.what} — expected ${detail.expectedForm}, e.g. ${detail.example}${known}`, detail.location)
}
