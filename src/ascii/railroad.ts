import type { AsciiContext } from '../agent/families.ts'
import { parseRailroad } from '../railroad/parser.ts'
import type { RailroadNode } from '../railroad/types.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'
import { visualWidth } from './width.ts'

/** Terminal output is an explicit expression-tree projection. Every ordered
 * alternative, bound, predicate and exception remains independently owned. */
export function renderRailroadTerminal(ctx: AsciiContext) {
  const body = parseRailroad(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), document = new TerminalDocument()
  const ascii = ctx.config.useAscii, width = ctx.options.targetWidth ?? ctx.options.maxWidth
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'railroad.expression-hierarchy', message: 'Railroad tracks project to the complete grammar expression hierarchy; branch order, optional paths, repetition bounds, predicates and exceptions are retained as owned text.' })
  const label = (node: RailroadNode): string => {
    switch (node.type) {
      case 'terminal': return `terminal ${JSON.stringify(node.value)}`
      case 'nonterminal': return `nonterminal ${node.name}`
      case 'special': return `special ${node.text}`
      case 'any': return 'any character'
      case 'sequence': return 'sequence'
      case 'choice': return node.ordered ? 'ordered choice' : 'choice'
      case 'optional': return 'optional'
      case 'repetition': return `repeat ${node.min}..${node.max ?? 'unbounded'}`
      case 'predicate': return `lookahead ${node.operator}`
      case 'exception': return 'exception (base, excluded expression)'
    }
  }
  const children = (node: RailroadNode): RailroadNode[] => node.type === 'sequence' ? node.elements : node.type === 'choice' ? node.alternatives : node.type === 'optional' || node.type === 'repetition' || node.type === 'predicate' ? [node.element] : node.type === 'exception' ? [node.base, node.except] : []
  const draw = (node: RailroadNode, id: string, parent: string, prefix: string, last: boolean): void => {
    const cue = ascii ? (last ? '`-- ' : '|-- ') : last ? '└── ' : '├── ', continuation = prefix + (last ? '    ' : ascii ? '|   ' : '│   ')
    const lines = wrapText(label(node), width ? Math.max(1, width - visualWidth(prefix + cue)) : undefined)
    const owner = { id, kind: 'node' as const, parent: { id: parent, kind: 'node' as const } }
    lines.forEach((line, index) => document.line([{ text: index ? continuation : prefix + cue, kind: 'surface', owner }, { text: line, role: 'text', owner }]))
    const nested = children(node)
    nested.forEach((child, index) => draw(child, `${id}/${index}`, id, continuation, index === nested.length - 1))
  }
  const title = body.title ?? ctx.config.title
  if (title) document.line([{ text: title, owner: { id: 'title', kind: 'label' }, role: 'text' }])
  body.rules.forEach((rule, index) => {
    const id = `rule#${index}:${rule.name}`
    document.line([{ text: rule.name, owner: { id, kind: 'node' }, role: 'text' }])
    draw(rule.definition, `${id}/expression`, id, '', true)
    if (index !== body.rules.length - 1) document.line()
  })
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
