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
    // Restore a continuation's opening quote. Flow collections can contain
    // quoted nodes too; quotes embedded in plain scalars are ordinary text.
    const value = quote ? quote + trimmed : trimmed.slice(prefix[0].length)
    if (/^["'[{]/.test(value)) {
      quote = ''
      let nodeStart = true, previous = ''
      for (let index = 0; index < value.length; index++) {
        const char = value[index]!
        if (quote) {
          if (quote === '"' && char === '\\') index++
          else if (char === quote) {
            if (quote === "'" && value[index + 1] === "'") index++
            else { quote = ''; previous = char }
          }
        } else if (char === '#' && (index === 0 || /[ \t,]/.test(value[index - 1]!))) break
        else if (nodeStart && char === '?' && /[ \t]/.test(value[index + 1] ?? '')) continue
        else if (nodeStart && (char === '&' || char === '!')) {
          // Flow-node properties precede the value; its quote can still open.
          const property = /^(?:!<[^>]*>|[!&][^ \t,[\]{}]*)/.exec(value.slice(index))!
          index += property[0].length - 1
        } else if ((char === '"' || char === "'") && nodeStart) { quote = char; nodeStart = false }
        else if (!/[ \t]/.test(char)) {
          nodeStart = '[{,'.includes(char) || char === ':' && (previous === '"' || previous === "'" || /[ \t]/.test(value[index + 1] ?? ''))
          previous = char
        }
      }
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

// The header, with the options its grammar keeps on that line, of each family
// whose Mermaid grammar also reads a statement there (`gantt dateFormat …`,
// `pie "a": 1`, `gitGraph LR: commit`). Flowchart, class, sankey and C4 need a
// line break after the header (flowchart also takes `;`).
// Gantt and timeline move only a keyword statement or one with a `:` (a task,
// a `period : event`): a bare word (`gantt LR`, `timeline TB`) is more likely a
// mistyped option, which stays a diagnosed header suffix, than the task or
// period Mermaid reads it as.
const HEADER_WITH_STATEMENT_RE = /^[^\S\r\n]*(?:sequenceDiagram|stateDiagram(?:-v2)?|mindmap|architecture(?:-beta)?|gitGraph(?:[^\S\r\n]+(?:LR|TB|BT))?(?:[^\S\r\n]*:)?|gantt(?=[^\S\r\n]+(?:(?:dateFormat|inclusiveEndDates|topAxis|axisFormat|tickInterval|includes|excludes|todayMarker|weekday|weekend|title|accTitle|accDescr|section|click)\b|[^\r\n]*:))|journey|quadrantChart|timeline(?:[^\S\r\n]+(?:LR|TD))?(?=[^\S\r\n]+(?:(?:title|section|accTitle|accDescr)\b|[^\r\n]*:))|pie(?:[^\S\r\n]+showData)?|xychart(?:-beta)?(?:[^\S\r\n]+(?:horizontal|vertical))?|radar-beta(?:[^\S\r\n]*:)?|erDiagram)/i

/** Move a statement written on the header line onto a line of its own, as
 * Mermaid reads it, so every family reader sees the header alone. */
export function splitHeaderStatement(body: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex(line => line.trim() !== '' && !line.trim().startsWith('%%'))
  const header = at < 0 ? null : HEADER_WITH_STATEMENT_RE.exec(lines[at]!)
  const statement = header ? lines[at]!.slice(header[0].length) : ''
  if (!header || !/^[^\S\r\n]+(?!%%)\S/.test(statement)) return body
  lines.splice(at, 1, header[0], statement.trim())
  return lines.join('\n')
}

/** The first family line, lowercased: the line `normalizeMermaidSource`
 * reports as `firstLine`, found without parsing frontmatter or directives. */
export function mermaidFirstLine(text: string): string {
  return toMermaidLines(splitHeaderStatement(
    text.slice(matchMermaidFrontmatter(text)?.source.length ?? 0).replace(INIT_DIRECTIVE_REGEX, ''),
  ))[0]?.toLowerCase() ?? ''
}
