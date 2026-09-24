/**
 * Mermaid Sequence accepts semicolons in place of physical line breaks. Keep
 * this lexical boundary shared by the render and agent projections so neither
 * can accept a packed statement that the other silently loses.
 *
 * `#59;` and the other documented Mermaid hash entities carry a terminator
 * semicolon inside text. Those are not statement delimiters. Preserve each
 * segment's own whitespace here; consumers decide how to normalize it.
 */
export function splitSequenceStatementLines(lines: readonly string[]): string[] {
  const statements: string[] = []
  for (const line of lines) {
    if (line.trimStart().startsWith('%%')) {
      statements.push(line)
      continue
    }
    let start = 0
    for (let index = 0; index < line.length; index++) {
      if (line[index] !== ';' || isHashEntityTerminator(line, start, index)) continue
      statements.push(line.slice(start, index))
      start = index + 1
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
