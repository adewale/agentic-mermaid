/**
 * The universal Mermaid source wrapper as text: the frontmatter block and
 * `%%{init}%%` directive spans are found and stripped here without being
 * parsed. mermaid-source.ts parses what they contain. The lazy browser entry
 * uses this module alone to read the family header, so detecting a family
 * loads no YAML reader; the full normalizer runs in the family's render.
 */

export const FRONTMATTER_REGEX = /^﻿?\s*---\s*\r?\n([\s\S]*?)\r?\n\s*---\s*(?:\r?\n|$)/
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
  const frontmatter = text.match(FRONTMATTER_REGEX)
  const rawBody = frontmatter ? text.slice(frontmatter[0].length) : text
  const body = rawBody.replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  return toMermaidLines(body)[0]?.toLowerCase() ?? ''
}
