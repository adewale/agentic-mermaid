/**
 * The universal Mermaid source wrapper as text: the frontmatter block and
 * `%%{init}%%` directive spans are found and stripped here without being
 * parsed. mermaid-source.ts parses what they contain. The lazy browser entry
 * uses this module alone to read the family header, so detecting a family
 * loads no YAML reader; the full normalizer runs in the family's render.
 */

/** Find a frontmatter wrapper without loading the YAML reader. By the
 * historical wrapper contract, a bare marker outside a block scalar closes
 * frontmatter at any horizontal indentation. Block scalar marker lines remain
 * content until the scalar dedents; all captured whitespace stays intact. */
export function matchMermaidFrontmatter(text: string): { source: string; yaml: string } | undefined {
  const start = /^(?:[^\S\r\n]*\r?\n)*[^\S\r\n]*---[^\S\r\n]*\r?\n/.exec(text)?.[0].length
  if (!start) return undefined
  // Physical indentation is nonnegative; -1 means no block scalar is open.
  let blockIndent = -1
  let quote = ''
  const lines = /([^\S\r\n]*)([^\r\n]*)(?:\r?\n|$)/g
  lines.lastIndex = start
  for (let line = lines.exec(text); line?.[0]; line = lines.exec(text)) {
    const indent = line[1]!.length
    const trimmed = line[2]!.trimEnd()
    if (!trimmed) continue
    if (indent <= blockIndent) blockIndent = -1
    if (trimmed === '---' && blockIndent < 0) {
      return { source: text.slice(0, lines.lastIndex), yaml: text.slice(start, line.index) }
    }
    if (blockIndent >= 0 || (!quote && trimmed[0] === '#')) continue
    // Inspect the value after its first mapping colon or sequence marker.
    // Carry only quoted-value state across lines so a continuation containing
    // `x: |` cannot become a block header. Bare markers still close the wrapper
    // by its historical convention, even inside a multiline quoted value.
    // Capture the sequence prefix and optional mapping key, then skip any
    // tags/anchors. Keeping the prefix width preserves a sequence key's column.
    const prefix = /^((?:-[ \t]+)*)(?:("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^"':](?:[^:]|:(?![ \t]))*):[ \t]+)?(?:[!&][^ \t]+[ \t]+)*/.exec(trimmed)!
    // Reuse the complete-value recognizer for continuations by restoring
    // their opening quote. Escapes and doubled apostrophes stay inside it.
    const value = quote ? quote + trimmed : trimmed.slice(prefix[0].length)
    if (/^["']/.test(value)) {
      quote = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'(?!'))/.test(value) ? '' : value[0]!
      continue
    }
    if (/^[|>](?:[+-][1-9]?|[1-9][+-]?)?(?:[ \t]+#.*)?$/.test(value)) {
      // A mapping inside a sequence owns the key's column after `- `;
      // a standalone sequence scalar still owns the dash's column.
      blockIndent = indent + (prefix[2] ? prefix[1]!.length : 0)
    }
  }
  return undefined
}
// Outer whitespace is horizontal-only. Using `\s*` at either line boundary
// consumes preceding blank lines or the next family's indentation because
// `\s` includes CR/LF. The directive payload itself remains multiline.
export const INIT_DIRECTIVE_REGEX = /^[^\S\r\n]*%%\{\s*init(?:ialize)?\s*:\s*([\s\S]*?)\}\s*%%[^\S\r\n]*(?:\r?\n)?/gm

export function toMermaidLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('%%'))
}

/** The first family line, lowercased: the line `normalizeMermaidSource`
 * reports as `firstLine`, found without parsing frontmatter or directives. */
export function mermaidFirstLine(text: string): string {
  return toMermaidLines(
    text.slice(matchMermaidFrontmatter(text)?.source.length ?? 0).replace(INIT_DIRECTIVE_REGEX, ''),
  )[0]?.toLowerCase() ?? ''
}
