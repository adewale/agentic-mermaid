/**
 * The universal Mermaid source wrapper as text: the frontmatter block and
 * `%%{init}%%` directive spans are found and stripped here without being
 * parsed. mermaid-source.ts parses what they contain. The lazy browser entry
 * uses this module alone to read the family header, so detecting a family
 * loads no YAML reader; the full normalizer runs in the family's render.
 */

/** Find a frontmatter wrapper without loading the YAML reader. The root
 * document indentation also owns its closing marker: a template may indent
 * the whole YAML document even when its opening marker starts at column zero.
 * Deeper marker lines are document content, including block scalar text. */
export function matchMermaidFrontmatter(text: string): { source: string; yaml: string } | undefined {
  const opening = /^﻿?(?:[^\S\r\n]*\r?\n)*([^\S\r\n]*)---[^\S\r\n]*\r?\n/.exec(text)
  if (!opening) return undefined
  const start = opening[0].length
  let rootIndent: number | undefined
  let blockIndent: number | undefined
  const lines = /([^\r\n]*)(\r?\n|$)/g
  lines.lastIndex = start
  for (let line = lines.exec(text); line && line[0]; line = lines.exec(text)) {
    const content = line[1]!
    const indent = /^[^\S\r\n]*/.exec(content)![0].length
    const trimmed = content.trim()
    if (!trimmed) continue
    if (blockIndent !== undefined && indent <= blockIndent) blockIndent = undefined
    if (trimmed === '---' && blockIndent === undefined
      && (rootIndent === undefined || indent <= rootIndent || indent === opening[1]!.length)) {
      return { source: text.slice(0, lines.lastIndex), yaml: text.slice(start, line.index) }
    }
    if (trimmed.startsWith('#')) continue
    if (rootIndent === undefined) rootIndent = indent
    // Only indentation is needed for a block's boundary. Its contents remain
    // untouched for the shared reader; this also protects a first scalar line
    // that is itself `---` in a historically accepted indented wrapper.
    if (blockIndent === undefined && /(?:^|:[ \t]+|-[ \t]+)(?:[!&][^ \t]+[ \t]+)*[|>](?:[+-][1-9]?|[1-9][+-]?)?(?:[ \t]+#.*)?$/.test(trimmed)) blockIndent = indent
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
