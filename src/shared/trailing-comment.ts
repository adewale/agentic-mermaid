// Mermaid's `%%` comment after a statement, for the families whose grammar
// lexes one there (pinned Mermaid 11.16: pie, xychart, quadrant, radar,
// architecture and gitGraph statements, and gantt keyword statements). Which
// statements take a trailing comment is each family's grammar; how to find the
// comment is this one rule. Other families read `%%` after a statement as text
// (a gantt title, a journey actor) or reject it (a flowchart edge), so they do
// not call this.

// A quote opens a string only where a token can start, so the apostrophe in
// `title Bob's chart %% note` stays text, as in Mermaid's lexers.
const TOKEN_START = /[\s[({,:=]/

/** Call only for a grammar-classified comment. Keep a directive-looking
 * comment out of Mermaid's universal init-directive prepass. */
export function writeMermaidComment(line: string): string {
  return line.replace(/^(\s*%%)\{/, '$1 {')
    // Ordinary comments keep their text but cannot become native metadata
    // when canonicalization moves them outside a spanning family statement.
    .replace(/^(\s*%%) (?=agentic-mermaid (?:accTitle|accDescr):)/, '$1  ')
}

/**
 * Offset of the `%%` that starts a trailing comment on one statement line, or
 * -1. A `%%` inside a "…" or '…' string (backslash escapes) is text, as is one
 * in a block that the sticky `block` pattern opens, to its `}`.
 */
export function trailingCommentStart(line: string, block?: RegExp): number {
  let quote: '"' | "'" | null = null
  for (let index = 0; index < line.length - 1; index++) {
    const char = line[index]!
    if (quote) {
      if (char === '\\') index++
      else if (char === quote) quote = null
      continue
    }
    if ((char === '"' || char === "'") && (index === 0 || TOKEN_START.test(line[index - 1]!))) {
      quote = char
      continue
    }
    if (char === '%' && line[index + 1] === '%') return index
    if (block && (block.lastIndex = index, block.test(line))) {
      const close = line.indexOf('}', block.lastIndex)
      if (close < 0) return -1
      index = close
    }
  }
  return -1
}

/** The statement part of `line`, without its trailing `%%` comment. */
export function stripTrailingComment(line: string): string {
  const start = trailingCommentStart(line)
  return start < 0 ? line : line.slice(0, start).trimEnd()
}

// The same families' lexers read a quoted string to its closing quote across
// line breaks. Which quotes may do so is each family's grammar; where a string
// opens is the rule above.

export interface QuotedTextRule {
  /** The quotes whose strings run across line breaks (default `"`). A line
   * that ends inside another quote's string ends its statement. */
  spanning?: string
  /** Whether a backslash escapes the next character in a string (default true). */
  escapes?: boolean
  /** The character a quote must follow to open a string (default: one where
   * a token can start, as above). The start of a line counts as a line break. */
  opensAfter?: RegExp
  /** Grammar-specific quote opening context, when one preceding character is insufficient. */
  opensAt?: (line: string, index: number) => boolean
  /** A statement that runs to the end of its line whatever it holds, such as a title. */
  wholeLine?: (line: string) => boolean
  /** A sticky pattern for a keyword that, outside a string, takes the rest of
   * its line as text wherever it stands, such as XYChart's `accTitle:`. */
  restOfLine?: RegExp
  /** A sticky pattern for a keyword that, outside a string, opens a block
   * running to the next `}` across line breaks whatever it holds, such as
   * XYChart's `accDescr {`. */
  block?: RegExp
}

/** An open string's quote, or `{` for an open block. */
type Quote = '"' | "'" | '{' | null

/** The string or block `line` leaves open when it starts inside `quote`'s. */
function openQuoteAtEnd(line: string, quote: Quote, escapes: boolean, opensAfter: RegExp, restOfLine?: RegExp, block?: RegExp, opensAt?: QuotedTextRule['opensAt']): Quote {
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote === '{') {
      if (char === '}') quote = null
    } else if (quote) {
      if (char === '\\' && escapes) index++
      else if (char === quote) quote = null
    } else if (char === '%' && line[index + 1] === '%') {
      break
    } else if (restOfLine && (restOfLine.lastIndex = index, restOfLine.test(line))) {
      break
    } else if (block && (block.lastIndex = index, block.test(line))) {
      quote = '{'
      index = block.lastIndex - 1
    } else if ((char === '"' || char === "'") && (opensAt ? opensAt(line, index) : opensAfter.test(index === 0 ? '\n' : line[index - 1]!))) {
      quote = char
    }
  }
  return quote
}

/**
 * For each line, the last line of the statement that starts there: the line
 * that closes a string the statement leaves open, or the line itself when it
 * leaves none open or nothing closes it. Each line is read once per spanning
 * quote, from the end, so the search stays linear however many strings never
 * close.
 */
export function quotedTextEnds(lines: readonly string[], rule: QuotedTextRule = {}): number[] {
  const spanning = [...(rule.spanning ?? '"'), ...(rule.block ? '{' : '')] as Array<'"' | "'" | '{'>
  const escapes = rule.escapes ?? true
  const opensAfter = rule.opensAfter ?? TOKEN_START
  const ends = new Array<number>(lines.length)
  // closes.get(quote): where a string of that quote, open at the start of the
  // next line, closes (-1: never).
  let closes = new Map(spanning.map(quote => [quote, -1]))
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!
    const open = rule.wholeLine?.(line.trim()) ? null : openQuoteAtEnd(line, null, escapes, opensAfter, rule.restOfLine, rule.block, rule.opensAt)
    const end = open ? closes.get(open) ?? -1 : -1
    ends[index] = end < 0 ? index : end
    closes = new Map(spanning.map(quote => {
      const still = openQuoteAtEnd(line, quote, escapes, opensAfter, rule.restOfLine, rule.block, rule.opensAt)
      return [quote, still && closes.has(still) ? closes.get(still)! : index]
    }))
  }
  return ends
}

/** The statement on `lines[start..end]`: the line break kept, not the indentation. */
export function statementText(lines: readonly string[], start: number, end: number): string {
  if (end === start) return lines[start]!
  return [lines[start]!.trimEnd(), ...lines.slice(start + 1, end + 1).map(line => line.trim())].join('\n')
}

/**
 * `lines` with each statement that `ends` carries onto later lines joined into
 * its first line, and the lines it took left empty, so an index is still a
 * line number.
 */
export function joinStatementLines(lines: readonly string[], ends: readonly number[]): string[] {
  const joined = [...lines]
  for (let index = 0; index < lines.length; index++) {
    const end = ends[index]!
    if (end === index) continue
    joined[index] = statementText(lines, index, end)
    joined.fill('', index + 1, end + 1)
    index = end
  }
  return joined
}

/** `lines` with each statement whose quoted text runs onto later lines joined (joinStatementLines). */
export function joinQuotedTextLines(lines: readonly string[], rule: QuotedTextRule = {}): string[] {
  return joinStatementLines(lines, quotedTextEnds(lines, rule))
}
