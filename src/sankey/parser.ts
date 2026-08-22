import { parseAccessibilityDirective } from '../shared/accessibility-directives.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import type { SankeyDiagram, SankeyLink } from './types.ts'

// ============================================================================
// Sankey diagram parser
//
// Parses Mermaid sankey syntax (v10.3.0+): the `sankey` / `sankey-beta`
// header followed by CSV rows of exactly three columns:
//
//   source,target,value
//
// RFC 4180 subset, matching the upstream syntax page:
//   - quoted fields ("...") may contain commas and physical line breaks
//   - a doubled quote inside a quoted field is a literal quote ("")
//   - empty lines (no separators) are allowed for visual grouping
//   - every field is trimmed before it becomes a node identity, matching
//     Mermaid's Sankey database actions after CSV unquoting
//
// Faithfulness contract (see docs/project/lessons-learned.md, ER lesson):
// malformed rows ERROR LOUDLY — they are never silently dropped. Upstream's
// d3-sankey throws an opaque "circular link" at layout time; we reject
// self-loops and cycles at parse time with the offending path named, since a
// sankey flow graph must be acyclic to have a layered layout at all.
// ============================================================================

/** Mermaid Sankey numeric tokens, including exponent and trailing-dot forms. */
const NUMBER_RE = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export interface SankeyParseOptions {
  /** Frontmatter `title:` — sankey has no in-body title statement. */
  title?: string
}

/**
 * Parse a Mermaid sankey diagram from raw lines. The first line is expected
 * to be the `sankey` / `sankey-beta` header.
 *
 * Throws on malformed input:
 *   - a header that isn't `sankey` / `sankey-beta`
 *   - a row without exactly three columns
 *   - an unterminated quoted field, or text between a closing quote and the
 *     next comma
 *   - a value that is not a non-negative number
 *   - a self-loop (`A,A,1`) or a cycle — the layered layout requires a DAG,
 *     which upstream enforces with d3-sankey's "circular link" throw
 *   - a diagram with no data rows
 */
export function parseSankeyDiagram(lines: string[], options: SankeyParseOptions = {}): SankeyDiagram {
  if (lines.length === 0) {
    throw new Error('Sankey diagram is empty')
  }

  const header = lines[0]!.trim()
  if (!/^sankey(?:-beta)?\s*$/i.test(header)) {
    throw new Error(`Sankey diagram must start with "sankey" or "sankey-beta", got: "${header}"`)
  }

  const nodes: string[] = []
  const seen = new Set<string>()
  const links: SankeyLink[] = []
  const addNode = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label)
      nodes.push(label)
    }
  }

  for (let i = 1; i < lines.length; i++) {
    let row = lines[i]!.replace(/\r$/, '')
    const rowNumber = i + 1
    const trimmedPhysicalLine = row.trim()
    // Empty lines are explicitly allowed by the upstream syntax page.
    if (trimmedPhysicalLine.length === 0 || trimmedPhysicalLine.startsWith('%%')) continue

    // Mermaid-universal accessibility directives: accept and skip (the shared
    // render pipeline projects them into the SVG title/desc).
    const acc = parseAccessibilityDirective(lines, i)
    if (acc) {
      i = acc.endIndex
      continue
    }

    // Mermaid's lexer admits CR/LF inside an escaped CSV field. Reassemble
    // that logical record before handing it to the strict row parser; comment
    // and accessibility-looking text inside the quotes remains label content.
    while (csvQuotedFieldIsOpen(row) && i + 1 < lines.length) {
      i++
      row += `\n${lines[i]!.replace(/\r$/, '')}`
    }
    const trimmed = row.trim()
    const fields = parseCsvRow(row, rowNumber)
    if (fields.length !== 3) {
      throw syntaxError({
        what: `Sankey row ${rowNumber} has ${fields.length} column${fields.length === 1 ? '' : 's'}: "${trimmed}"`,
        expectedForm: 'exactly three CSV columns: source,target,value',
        example: 'Electricity grid,Industry,342.165',
      })
    }

    const [source, target, rawValue] = fields as [string, string, string]
    if (source.length === 0 || target.length === 0) {
      throw new Error(`Sankey row ${rowNumber} has an empty ${source.length === 0 ? 'source' : 'target'} label: "${trimmed}"`)
    }
    if (!NUMBER_RE.test(rawValue)) {
      throw new Error(`Sankey flow "${source}" -> "${target}" has invalid value "${rawValue}". ` + 'Values must be non-negative numbers.')
    }
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Sankey flow "${source}" -> "${target}" has invalid value "${rawValue}". ` + 'Values must be non-negative numbers.')
    }
    if (source === target) {
      throw new Error(`Sankey flow "${source}" -> "${target}" is a self-loop. ` + 'Sankey diagrams must be acyclic (upstream rejects circular links).')
    }

    addNode(source)
    addNode(target)
    links.push({ source, target, value })
  }

  if (links.length === 0) {
    throw new Error('Sankey diagram must include at least one source,target,value row')
  }

  const cycle = findSankeyCycle(links)
  if (cycle) {
    throw new Error(`Sankey diagram contains a cycle: ${cycle.map(label => `"${label}"`).join(' -> ')}. ` + 'Sankey diagrams must be acyclic (upstream rejects circular links).')
  }

  return { ...(options.title !== undefined ? { title: options.title } : {}), nodes, links }
}

/**
 * Split one logical CSV record into fields (RFC 4180 subset). Every field is
 * trimmed before identity assignment, and `""` inside a quoted field decodes
 * to a literal quote. Whitespace may surround a quoted field, but any other
 * text between the closing quote and the next comma errors loudly.
 */
function parseCsvRow(line: string, lineNumber: number): string[] {
  const fields: string[] = []
  let index = 0
  while (true) {
    // Leading whitespace before field content (or before an opening quote).
    let start = index
    while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start++
    if (line[start] === '"') {
      let cursor = start + 1
      let content = ''
      let closed = false
      while (cursor < line.length) {
        const ch = line[cursor]!
        if (ch === '"') {
          if (line[cursor + 1] === '"') {
            content += '"'
            cursor += 2
            continue
          }
          closed = true
          cursor++
          break
        }
        content += ch
        cursor++
      }
      if (!closed) {
        throw new Error(`Sankey row ${lineNumber} has an unterminated quoted field: "${line.trim()}"`)
      }
      // Only whitespace may follow a closing quote before the comma/EOL.
      let after = cursor
      while (after < line.length && (line[after] === ' ' || line[after] === '\t')) after++
      if (after < line.length && line[after] !== ',') {
        throw new Error(`Sankey row ${lineNumber} has text after a closing quote: "${line.trim()}". ` + 'Escape a literal quote by doubling it ("").')
      }
      fields.push(content.trim())
      index = after
    } else {
      let comma = line.indexOf(',', start)
      if (comma === -1) comma = line.length
      fields.push(line.slice(index, comma).trim())
      index = comma
    }
    if (index >= line.length) break
    // Skip the comma; a trailing comma yields a trailing empty field, which
    // the three-column check reports.
    index++
    if (index >= line.length) {
      fields.push('')
      break
    }
  }
  return fields
}

/** True when a logical CSV record ends inside a quoted field. Doubled quotes
 * are one escaped data character and therefore do not change quote state. */
function csvQuotedFieldIsOpen(record: string): boolean {
  let open = false
  for (let index = 0; index < record.length; index++) {
    if (record[index] !== '"') continue
    if (open && record[index + 1] === '"') {
      index++
      continue
    }
    open = !open
  }
  return open
}

/**
 * Find a directed cycle, if any, and return its node path (closed: the first
 * label repeats at the end). Iterative DFS with explicit color states so deep
 * diagrams cannot overflow the call stack. Shared with the structured body's
 * invariant owner so typed mutation cannot construct what the parser rejects.
 */
export function findSankeyCycle(links: readonly SankeyLink[]): string[] | undefined {
  const nodes: string[] = []
  const seen = new Set<string>()
  const outgoing = new Map<string, string[]>()
  for (const link of links) {
    for (const label of [link.source, link.target]) {
      if (!seen.has(label)) {
        seen.add(label)
        nodes.push(label)
      }
    }
    const targets = outgoing.get(link.source)
    if (targets) targets.push(link.target)
    else outgoing.set(link.source, [link.target])
  }
  const state = new Map<string, 'active' | 'done'>()
  for (const root of nodes) {
    if (state.has(root)) continue
    const stack: Array<{ label: string; next: number }> = [{ label: root, next: 0 }]
    state.set(root, 'active')
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const targets = outgoing.get(frame.label) ?? []
      if (frame.next >= targets.length) {
        state.set(frame.label, 'done')
        stack.pop()
        continue
      }
      const target = targets[frame.next]!
      frame.next++
      const targetState = state.get(target)
      if (targetState === 'active') {
        const from = stack.findIndex(entry => entry.label === target)
        return [...stack.slice(from).map(entry => entry.label), target]
      }
      if (targetState === undefined) {
        state.set(target, 'active')
        stack.push({ label: target, next: 0 })
      }
    }
  }
  return undefined
}
