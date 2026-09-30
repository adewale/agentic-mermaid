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

/**
 * Offset of the `%%` that starts a trailing comment on one statement line, or
 * -1. A `%%` inside a "…" or '…' string (backslash escapes) is text.
 */
export function trailingCommentStart(line: string): number {
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
  }
  return -1
}

/** The statement part of `line`, without its trailing `%%` comment. */
export function stripTrailingComment(line: string): string {
  const start = trailingCommentStart(line)
  return start < 0 ? line : line.slice(0, start).trimEnd()
}
