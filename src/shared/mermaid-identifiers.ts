/** Unicode-aware Mermaid identifier primitives shared by family parsers. */

/** Letters/numbers from any script, underscore, and hyphen. */
export const MERMAID_IDENTIFIER_SOURCE = String.raw`[\p{L}\p{N}_-]+`

const COMPLETE_IDENTIFIER_RE = new RegExp(`^${MERMAID_IDENTIFIER_SOURCE}$`, 'u')
const LEADING_IDENTIFIER_RE = new RegExp(`^(${MERMAID_IDENTIFIER_SOURCE})`, 'u')
const CLASS_NAME_RE = /^[\w-]+/

export function isMermaidIdentifier(value: string): boolean {
  return COMPLETE_IDENTIFIER_RE.test(value)
}

export function consumeMermaidIdentifier(value: string): { id: string; length: number } | null {
  const match = value.match(LEADING_IDENTIFIER_RE)
  return match ? { id: match[1]!, length: match[1]!.length } : null
}

export function consumeClassShorthandPrefix(value: string): { className: string; length: number } | null {
  if (!value.startsWith(':::')) return null
  const match = value.slice(3).match(CLASS_NAME_RE)
  return match ? { className: match[0], length: 3 + match[0].length } : null
}

/** A complete `identifier:::class-name` statement. */
export function parseClassShorthandStatement(value: string): { id: string; className: string } | null {
  const id = consumeMermaidIdentifier(value)
  if (!id) return null
  const shorthand = consumeClassShorthandPrefix(value.slice(id.length))
  if (!shorthand || id.length + shorthand.length !== value.length) return null
  return { id: id.id, className: shorthand.className }
}
