import { accessibilityFields, requireClosedAccessibility, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { readAuthoredGrammarAccessibility, readGrammarAuthoredText, readGrammarText } from '../shared/grammar-text.ts'
import { quotedTextEnds } from '../shared/trailing-comment.ts'
import { parseUsecase } from './grammar/parser.ts'
import type { GraphStatement, UsecaseModel } from './grammar/types.ts'
import type { UsecaseBody, UsecaseNode } from './types.ts'
export const isUsecaseHeader = (line: string): boolean => /^usecase-beta\s*$/.test(line.trim())
export const usecaseStatementEnds = (lines: readonly string[]) => quotedTextEnds(lines, { escapes: false, spanning: '"', opensAfter: /[\s([=:,]/ })
const read = (text: string) => readGrammarText(readGrammarAuthoredText(text), '\r\n')

export function usecaseBody(model: UsecaseModel): UsecaseBody {
  const first = new Map<string, number>()
  const pending: GraphStatement[] = [...model.statements].reverse()
  while (pending.length) {
    const statement = pending.pop()!
    for (const node of statement.nodes ?? []) if (!first.has(node.id)) first.set(node.id, node.span[0])
    for (const child of [...(statement.children ?? [])].reverse()) pending.push(child)
  }
  const nodes: UsecaseNode[] = [...model.actors.values()].map(actor => ({ ...actor, kind: 'actor' as const, label: read(actor.label), ...(actor.icon ? { icon: read(actor.icon) } : {}), ...(actor.stereotype ? { stereotype: read(actor.stereotype) } : {}) }))
  nodes.push(...[...model.useCases.values()].map(node => ({ ...node, kind: 'usecase' as const, label: read(node.label), ...(node.stereotype ? { stereotype: read(node.stereotype) } : {}) })))
  nodes.sort((a, b) => (first.get(a.id) ?? 0) - (first.get(b.id) ?? 0))
  return {
    kind: 'usecase',
    direction: model.direction === 'TD' ? 'TB' : model.direction,
    nodes,
    boundaries: [...model.systemBoundaries.values()].map(boundary => ({ ...boundary, label: read(boundary.label) })),
    relationships: model.relationships.map(edge => ({ ...edge, ...(edge.label === undefined ? {} : { label: read(edge.label) }) })),
    notes: [...model.notes.values()].map(note => ({ ...note, label: read(note.label) })),
    jsonNodes: [...model.jsonNodes.values()].map(node => ({ ...node, propertyOrder: [...node.propertyOrder] })),
    classDefs: [...model.classDefs.values()],
    ...(model.title === undefined ? {} : { title: read(model.title) }),
    ...(model.accTitle ? { accessibilityTitle: read(model.accTitle) } : {}),
    ...(model.accDescription ? { accessibilityDescription: read(model.accDescription) } : {}),
  }
}
export function parseUsecaseDiagram(input: string | readonly string[]): UsecaseBody {
  const original = typeof input === 'string' ? input.split(/\r?\n/) : [...input]
  assertDiagramWorkLimit(
    'sourceCharacters',
    original.reduce((length, line) => length + line.length + 1, 0),
  )
  const scanned = scanAccessibilityDirectives(original, usecaseStatementEnds(original))
  requireClosedAccessibility(scanned)
  const first = scanned.familyLines.findIndex(line => line.trim() && !line.trim().startsWith('%%'))
  if (!isUsecaseHeader(scanned.familyLines[first] ?? '')) throw new Error('UseCase source must start with usecase-beta')
  const body = usecaseBody(parseUsecase(scanned.familyLines.slice(first).join('\n')))
  Object.assign(body, accessibilityFields(readAuthoredGrammarAccessibility(scanned.accessibility)))
  assertDiagramWorkLimit('nodes', body.nodes.length + body.boundaries.length + body.notes.length + body.jsonNodes.length)
  assertDiagramWorkLimit('edges', body.relationships.length)
  const pending = body.jsonNodes.map(node => ({ value: node.value as unknown, depth: 0 }))
  while (pending.length) {
    const { value, depth } = pending.pop()!
    assertDiagramWorkLimit('nesting', depth)
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 })
  }
  return body
}
