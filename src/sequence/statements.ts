/**
 * Mermaid Sequence accepts semicolons in place of physical line breaks. Keep
 * this lexical boundary shared by the render and agent projections so neither
 * can accept a packed statement that the other silently loses.
 *
 * `#59;` and the other documented Mermaid hash entities carry a terminator
 * semicolon inside text. Comments consume the physical line, while actor
 * `@{...}` metadata and accessibility text keep their embedded semicolons.
 * Preserve each segment's own whitespace; consumers decide normalization.
 */
export function splitSequenceStatementLines(lines: readonly string[]): string[] {
  const statements: string[] = []
  let inAccessibilityDescription = false
  for (const line of lines) {
    if (inAccessibilityDescription) {
      statements.push(line)
      if (line.includes('}')) inAccessibilityDescription = false
      continue
    }
    let start = 0
    let braceDepth = 0
    let quote: '"' | "'" | null = null
    let escaped = false
    const protectRemainder = (): boolean => {
      const remainder = line.slice(start).trimStart()
      if (/^accDescr\s*\{/i.test(remainder) && !remainder.includes('}')) inAccessibilityDescription = true
      return /^(?:%%|accTitle\s*:|accDescr\s*[:{])/i.test(remainder)
    }
    if (protectRemainder()) {
      statements.push(line)
      continue
    }
    for (let index = 0; index < line.length; index++) {
      const char = line[index]!
      if (braceDepth > 0) {
        if (quote) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === quote) quote = null
        } else if (char === '"' || char === "'") quote = char
        else if (char === '{') braceDepth++
        else if (char === '}') braceDepth--
        continue
      }

      if (char === '@' && line[index + 1] === '{' && /^(?:participant|actor)\b/i.test(line.slice(start, index).trimStart())) {
        braceDepth = 1
        index++
        continue
      }
      if (line[index] !== ';' || isHashEntityTerminator(line, start, index)) continue
      statements.push(line.slice(start, index))
      start = index + 1
      if (protectRemainder()) break
    }
    statements.push(line.slice(start))
  }
  return statements
}

function isHashEntityTerminator(line: string, statementStart: number, semicolonIndex: number): boolean {
  const before = line.slice(statementStart, semicolonIndex)
  if (!/#(?:\d+|[a-z][a-z\d]*)$/i.test(before)) return false
  // CSS hex colors are authored as block arguments, not HTML entities.
  if (/^\s*(?:rect|box)\s+#[0-9a-f]{3,8}$/i.test(before)) return false
  return true
}
