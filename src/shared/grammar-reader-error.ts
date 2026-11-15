import { MermaidSyntaxError } from './syntax-error.ts'
import { sourceLineStarts, sourcePointAt } from './source-spans.ts'

/** Positioned errors shared by the native grammar readers. */
export class GrammarReadError extends MermaidSyntaxError {
  constructor(
    message: string,
    readonly code = 'syntax',
    readonly context: { type?: string; line?: number; column?: number; snippet?: string } = {},
  ) {
    super(message)
  }
}

export function syntaxError(type: string, source: string, offset: number, detail: string, lexical = false): GrammarReadError {
  const at = sourcePointAt(sourceLineStarts(source), offset)
  const line = source.split(/\r?\n/)[at.line - 1] ?? ''
  return new GrammarReadError(`${type} ${lexical ? 'unrecognized text' : 'syntax error'} at ${at.line}:${at.col}: ${detail || line}`, 'syntax', { type, line: at.line, column: at.col, snippet: line })
}
