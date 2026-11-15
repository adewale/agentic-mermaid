import { accessibilityFields, requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import { stripTrailingComment } from '../shared/trailing-comment.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import type { TreemapBody, TreemapNode } from './types.ts'
import { readAuthoredGrammarAccessibility, readGrammarAuthoredText, readGrammarText } from '../shared/grammar-text.ts'

/** Flat authored order is retained independently of value-sorted placement. */
export function parseTreemapDiagram(input: string | readonly string[]): TreemapBody {
  const scanned = scanAccessibilityDirectives(typeof input === 'string' ? input.split(/\r?\n/) : input)
  requireClosedAccessibility(scanned)
  const lines = scanned.familyLines
  const first = lines.findIndex(line => line.trim() && !line.trim().startsWith('%%'))
  if (!/^treemap(?:-beta)?\s*$/i.test(stripTrailingComment(lines[first]?.trim() ?? ''))) throw new Error('Treemap source must start with treemap')
  const body: TreemapBody = { kind: 'treemap', nodes: [], classDefs: Object.create(null), ...accessibilityFields(readAuthoredGrammarAccessibility(scanned.accessibility)) }
  const stack: { indent: number; node: TreemapNode }[] = []
  for (let i = first + 1; i < lines.length; i++) {
    const raw = lines[i]!
    const line = stripTrailingComment(raw).trim()
    if (!line) continue
    observeParserStatement('treemap', 'statement', raw, { line: i + 1, unit: 'normalized' })
    const title = /^title(?:\s+(.*))?$/i.exec(line)
    if (title) {
      body.title = readGrammarText(readGrammarAuthoredText(title[1] ?? ''), '\r\n')
      observeParserMutation('treemap', 'set-title', body.title)
      continue
    }
    const cls = /^classDef\s+([A-Za-z_]\w*)\s+(.+?);?$/.exec(line)
    if (cls) {
      const style = checkedAuthoredStyle(parseStyleProps(cls[2]!), `classDef ${cls[1]}`)
      body.classDefs[cls[1]!] = { ...(body.classDefs[cls[1]!] ?? {}), ...style }
      observeParserMutation('treemap', 'define-class', { name: cls[1], style })
      continue
    }
    const indent = raw.match(/^[\t ]*/)?.[0].length ?? 0
    let rowIndent = indent
    let remaining = line
    while (remaining) {
      const match = /^(?:"([^"]*)"|'([^']*)')(?:\s*[:,]\s*([0-9_.,]+))?(?:\s*:::\s*([A-Za-z_]\w*))?/.exec(remaining)
      if (!match) throw new Error(`Invalid Treemap statement at line ${i + 1}: ${remaining}`)
      assertDiagramWorkLimit('nodes', body.nodes.length + 1)
      while (stack.length && stack.at(-1)!.indent >= rowIndent) stack.pop()
      const parentId = stack.at(-1)?.node.id
      // Each quoted entry is a grammar row. Its indentation is the whitespace
      // immediately before that entry, even when another row shares the line.
      const value = match[3] === undefined ? undefined : Number(match[3].replace(/[,_]/g, ''))
      assertDiagramWorkLimit('nesting', stack.length + (value === undefined ? 1 : 0))
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid Treemap value at line ${i + 1}`)
      const node: TreemapNode = { id: `treemap-${body.nodes.length}`, label: readGrammarText(readGrammarAuthoredText(match[1] ?? match[2]!), '\r\n'), ...(parentId ? { parentId } : {}), ...(value === undefined ? {} : { value }), ...(match[4] ? { className: match[4] } : {}) }
      body.nodes.push(node)
      if (parserObservationActive('treemap')) observeParserMutation('treemap', 'add-node', node, { line: i + 1, column: indent + line.length - remaining.length + 1, unit: 'normalized' })
      if (value === undefined) stack.push({ indent: rowIndent, node })
      const suffix = remaining.slice(match[0].length)
      rowIndent = suffix.match(/^[\t ]*/)?.[0].length ?? 0
      remaining = suffix.slice(rowIndent)
    }
  }
  return body
}
