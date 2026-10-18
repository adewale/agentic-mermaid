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
  const opening = /^﻿?(?:[^\S\r\n]*\r?\n)*([^\S\r\n]*)---[^\S\r\n]*\r?\n/.exec(text)
  if (!opening) return undefined
  const start = opening[0].length
  let blockIndent: number | undefined
  let quote: '"' | "'" | undefined
  const lines = /([^\r\n]*)(\r?\n|$)/g
  lines.lastIndex = start
  for (let line = lines.exec(text); line && line[0]; line = lines.exec(text)) {
    const content = line[1]!
    const indent = /^[^\S\r\n]*/.exec(content)![0].length
    const trimmed = content.trim()
    if (!trimmed) continue
    if (blockIndent !== undefined && indent <= blockIndent) blockIndent = undefined
    if (trimmed === '---' && blockIndent === undefined) {
      return { source: text.slice(0, lines.lastIndex), yaml: text.slice(start, line.index) }
    }
    if (blockIndent !== undefined || (!quote && trimmed.startsWith('#'))) continue
    // Inspect the value after its first mapping colon or sequence marker.
    // Carry only quoted-value state across lines so a continuation containing
    // `x: |` cannot become a block header. Bare markers still close the wrapper
    // by its historical convention, even inside a multiline quoted value.
    const continuedQuote = quote !== undefined
    const entry = trimmed.replace(/^(?:-[ \t]+)+/, '')
    const sequencePrefixWidth = trimmed.length - entry.length
    const key = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^"':](?:[^:]|:(?![ \t]))*):[ \t]+/.exec(entry)
    const value = continuedQuote ? content : (key ? entry.slice(key[0].length) : entry).replace(/^(?:[!&][^ \t]+[ \t]+)*/, '')
    if (!quote && (value[0] === '"' || value[0] === "'")) quote = value[0]
    if (quote) {
      for (let index = continuedQuote ? 0 : 1; index < value.length; index++) {
        if (quote === '"' && value[index] === '\\') { index++; continue }
        if (value[index] !== quote) continue
        if (quote === "'" && value[index + 1] === "'") { index++; continue }
        quote = undefined
        break
      }
      continue
    }
    if (/^[|>](?:[+-][1-9]?|[1-9][+-]?)?(?:[ \t]+#.*)?$/.test(value)) {
      // A mapping inside a sequence owns the key's column after `- `;
      // a standalone sequence scalar still owns the dash's column.
      blockIndent = indent + (key ? sequencePrefixWidth : 0)
    }
  }
  return undefined
}
// Outer whitespace is horizontal-only. Using `\s*` at either line boundary
// consumes preceding blank lines or the next family's indentation because
// `\s` includes CR/LF. The directive payload itself remains multiline.
export const INIT_DIRECTIVE_REGEX = /^[^\S\r\n]*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}\s*%%[^\S\r\n]*(?:\r?\n|$)?/gm

export function toMermaidLines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('%%'))
}

/** The first family line, lowercased: the line `normalizeMermaidSource`
 * reports as `firstLine`, found without parsing frontmatter or directives. */
export function mermaidFirstLine(text: string): string {
  const frontmatter = matchMermaidFrontmatter(text)
  const rawBody = frontmatter ? text.slice(frontmatter.source.length) : text
  const body = rawBody.replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  return toMermaidLines(body)[0]?.toLowerCase() ?? ''
}
