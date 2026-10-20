export class PeleError extends Error {
  constructor(message: string, _category?: string, _details?: unknown) {
    super(message)
  }
}
export function syntaxError(family: string, source: string, offset = 0, message = '', lexical = false): Error {
  const rows = source.slice(0, offset).split(/\r\n?|\n/),
    line = rows.length,
    column = rows.at(-1)!.length + 1
  return new Error(`${family} ${lexical ? 'lexical' : 'parse'} error at line ${line}, column ${column}: ${message || 'unrecognized input'}`)
}
