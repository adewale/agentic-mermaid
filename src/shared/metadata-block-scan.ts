/**
 * Where a Mermaid `@{…}` metadata block ends, by each family's upstream lexer
 * (see shared/metadata-yaml.ts for the rules). This is the lexer alone, with
 * no YAML: statement splitters and source maps that only need to skip a block
 * import it without the YAML reader.
 */

/** The family grammar whose lexer delimits the block. */
export type MetadataGrammar = 'flowchart' | 'sequence'

export type MetadataBlockScan =
  /** `body` is the text upstream hands to YAML; `end` indexes the closing `}`. */
  | { kind: 'closed'; body: string; end: number }
  /** The text ended inside the block (a multi-line block continues). */
  | { kind: 'unclosed' }
  /** Upstream's lexer or grammar rejects the block. */
  | { kind: 'invalid'; message: string }

/**
 * Delimit the `@{…}` block whose `{` is at `text[open]`, by the family's
 * upstream lexer rules (see the module comment).
 */
export function scanMetadataBlock(text: string, open: number, grammar: MetadataGrammar): MetadataBlockScan {
  if (text[open] !== '{') throw new RangeError(`scanMetadataBlock: no "{" at ${open}`)
  if (grammar === 'sequence') {
    const end = text.indexOf('}', open + 1)
    if (end < 0) return { kind: 'unclosed' }
    if (end === open + 1) return { kind: 'invalid', message: 'empty @{} participant metadata' }
    return { kind: 'closed', body: text.slice(open + 1, end).trim(), end }
  }
  let body = ''
  for (let index = open + 1; index < text.length; index++) {
    const character = text[index]!
    if (character === '"') {
      const close = text.indexOf('"', index + 1)
      if (close < 0) return { kind: 'unclosed' }
      body += `"${text.slice(index + 1, close).replace(/\n\s*/g, '<br/>')}"`
      index = close
    } else if (character === '}') {
      return { kind: 'closed', body, end: index }
    } else if (character === '^') {
      return { kind: 'invalid', message: 'unquoted "^" in @{} metadata' }
    } else {
      body += character
    }
  }
  return { kind: 'unclosed' }
}
