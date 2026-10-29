export class PeleError extends Error {
  constructor(message: string, _category?: string, _details?: unknown) {
    super(message)
  }
}
export function syntaxError(family: string, source: string, offset = 0, message = '', lexical = false): Error {
  const before = source.slice(0, offset),
    line = before.split('\n').length,
    column = offset - before.lastIndexOf('\n')
  return new Error(`${family} ${lexical ? 'lexical' : 'parse'} error at line ${line}, column ${column}: ${message || 'unrecognized input'}`)
}
