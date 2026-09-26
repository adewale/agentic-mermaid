/**
 * Mermaid Sequence accepts semicolons in place of physical line breaks. Keep
 * this lexical boundary shared by the render and agent projections so neither
 * can accept a packed statement that the other silently loses.
 *
 * `#59;` and the other documented Mermaid hash entities carry a terminator
 * semicolon inside text. Comments consume the physical line, while actor
 * `@{...}` metadata and accessibility text keep their embedded semicolons.
 * A CSS hex color right after `box` or `rect` is that block's argument; any
 * other `#` word there (`#12345`) starts a comment, as in Mermaid.
 * Preserve each segment's own whitespace; consumers decide normalization.
 */
export function isSequenceCommentLine(line: string): boolean {
  return /^(?:%(?!\{)|#(?![a-z\d]+;))/i.test(line.trimStart())
}

export function splitSequenceStatementLines(lines: readonly string[]): string[] {
  const statements: string[] = []
  let inAccessibilityDescription = false
  for (const physicalLine of lines) {
    const pushStatement = (statement: string): void => { statements.push(statement) }
    let line = physicalLine
    if (inAccessibilityDescription) {
      const closing = line.indexOf('}')
      if (closing < 0) {
        pushStatement(line)
        continue
      }
      pushStatement(line.slice(0, closing + 1))
      line = line.slice(closing + 1)
      inAccessibilityDescription = false
    }
    let start = 0
    let braceDepth = 0
    let quote: '"' | "'" | null = null
    let escaped = false
    let finished = false
    let firstHashIndex = -1
    for (let index = 0; index < line.length; index++) {
      if (index === start) {
        const remainder = line.slice(start).trimStart()
        const block = /^accDescr\s*:?\s*\{/i.exec(remainder)
        if (block) {
          const opening = line.indexOf('{', start)
          const closing = line.indexOf('}', opening + 1)
          if (closing < 0) {
            pushStatement(line.slice(start))
            inAccessibilityDescription = true
            finished = true
            break
          }
          pushStatement(line.slice(start, closing + 1))
          start = closing + 1
          index = closing
          continue
        }
        if (/^(?:rect|box)\s+#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8});/i.test(remainder)
          || isSequenceCommentLine(remainder)
          || /^(?:accTitle|accDescr)(?:\s*:|\s+)/i.test(remainder)) {
          pushStatement(line.slice(start))
          finished = true
          break
        }
      }
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
      if (char === '#' && firstHashIndex < 0) firstHashIndex = index
      if (char === '#' && !hasHashEntityAt(line, index)
        && !(/^\s*(?:rect|box)\s*$/i.test(line.slice(start, index))
          && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?=\s|;|$)/i.test(line.slice(index)))) {
        pushStatement(line.slice(start, index))
        pushStatement(line.slice(index))
        finished = true
        break
      }
      if (line[index] !== ';' || isHashEntityTerminator(line, start, index, firstHashIndex)) continue
      pushStatement(line.slice(start, index))
      start = index + 1
      firstHashIndex = -1
    }
    if (!finished) pushStatement(line.slice(start))
  }
  return statements
}

function isHashEntityTerminator(line: string, statementStart: number, semicolonIndex: number, firstHashIndex: number): boolean {
  // Scan only the token immediately before this semicolon. Testing the entire
  // growing statement prefix makes a line of repeated entities quadratic.
  let hashIndex = semicolonIndex - 1
  while (hashIndex >= statementStart && /[a-z\d]/i.test(line[hashIndex]!)) hashIndex--
  if (line[hashIndex] !== '#' || hashIndex === semicolonIndex - 1) return false
  if (!hasHashEntityAt(line, hashIndex)) return false
  // CSS hex colors are authored as block arguments, not HTML entities.
  if (firstHashIndex === hashIndex
    && /^\s*(?:rect|box)\s+#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(line.slice(statementStart, semicolonIndex))) return false
  return true
}

const HASH_ENTITY_RE = /#(?:\d+|[a-z][a-z\d]*);/iy

function hasHashEntityAt(line: string, index: number): boolean {
  HASH_ENTITY_RE.lastIndex = index
  return HASH_ENTITY_RE.test(line)
}
