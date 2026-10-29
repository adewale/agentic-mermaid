import type { MermaidGraph, MermaidSubgraph } from '../types.ts'
import type { C4Body, C4Boundary, C4Element, C4Relationship } from './types.ts'
import { checkedAuthoredStyle } from '../shared/style-props.ts'
import { prepareDisplayText } from '../shared/display-text.ts'
import { planC4Identity } from './identity.ts'
import { c4Appearance, effectiveC4Shape, resolveC4Config, type C4Config } from './config.ts'

export function c4ElementText(item: C4Element): string {
  const kind = `${item.external ? 'External ' : ''}${item.kind[0]!.toUpperCase()}${item.kind.slice(1)}${item.shape === 'database' ? ': Database' : item.shape === 'queue' ? ': Queue' : ''}`
  const technology = item.style.techn ?? item.technology
  return [item.label, `[${kind}${technology ? `: ${technology}` : ''}]`, item.description, item.tags.length ? `[tags: ${item.tags.join(', ')}]` : undefined, item.sprite ? `[sprite: ${item.sprite}]` : undefined].filter(value => value !== undefined && value !== '').join('\n')
}
export function c4BoundaryText(item: C4Boundary): string {
  const kind = item.kind === 'deployment' ? 'Deployment Node' : `${item.kind === 'boundary' ? '' : `${item.kind[0]!.toUpperCase()}${item.kind.slice(1)} `}Boundary`
  return [item.label, `[${kind}${item.type ? `: ${item.type}` : ''}]`, item.description, item.tags.length ? `[tags: ${item.tags.join(', ')}]` : undefined, item.sprite ? `[sprite: ${item.sprite}]` : undefined].filter(value => value !== undefined && value !== '').join('\n')
}
export function c4RelationshipText(body: C4Body, item: C4Relationship): string {
  const index = item.index ?? (body.variant === 'C4Dynamic' ? String(item.order) : undefined)
  return [`${index !== undefined ? `${index}: ` : ''}${item.label}`, item.technology ? `[${item.technology}]` : undefined, item.description, item.tags.length ? `[tags: ${item.tags.join(', ')}]` : undefined, item.sprite ? `[sprite: ${item.sprite}]` : undefined].filter(value => value !== undefined && value !== '').join('\n')
}
export function c4SourceLine(body: C4Body, statementId: string): number | undefined { return body.statements.find(statement => statement.id === statementId)?.span.line }
/** Internal routing adapter only. C4Body remains the authored model. */
export function projectC4Graph(body: C4Body, config: C4Config = resolveC4Config()): MermaidGraph {
  for (const item of [...body.elements, ...body.boundaries, ...body.relationships, ...(body.legend?.entries ?? [])]) {
    const style = item.style
    checkedAuthoredStyle({ ...(style.bgColor === undefined ? {} : { fill: style.bgColor }), ...(style.borderColor === undefined && style.lineColor === undefined ? {} : { stroke: style.borderColor ?? style.lineColor! }), ...(style.fontColor === undefined && style.textColor === undefined ? {} : { color: style.fontColor ?? style.textColor! }) }, `C4 ${item.id}`)
  }
  const identities = planC4Identity(body)
  const graph: MermaidGraph = { direction: body.layout.direction ?? body.layout.hints[0]?.direction ?? body.relationships.find(edge => edge.direction)?.direction ?? 'LR', nodes: new Map(), edges: [], subgraphs: [], classDefs: new Map(), classAssignments: new Map(), nodeStyles: new Map(), linkStyles: new Map() }
  const groups = new Map<string, MermaidSubgraph>()
  for (const item of body.boundaries) groups.set(item.id, { id: identities.nodes.get(item.id) ?? item.id, label: c4BoundaryText(item), nodeIds: [], children: [] })
  for (const item of body.boundaries) {
    const group = groups.get(item.id)!, parent = item.parentId && groups.get(item.parentId)
    if (parent) parent.children.push(group); else graph.subgraphs.push(group)
  }
  for (const item of body.elements) {
    const id = identities.nodes.get(item.id) ?? item.id, appearance = c4Appearance(item, config), shape = effectiveC4Shape(item)
    graph.nodes.set(id, { id, label: c4ElementText(item), shape: shape === 'database' ? 'cylinder' : shape === 'queue' ? 'subroutine' : 'rectangle', href: item.effectiveLink ?? item.link })
    if (item.parentId) groups.get(item.parentId)?.nodeIds.push(id)
    graph.nodeStyles.set(id, { ...(appearance.fill ? { fill: appearance.fill } : {}), ...(appearance.stroke ? { stroke: appearance.stroke } : {}), ...(appearance.text ? { color: appearance.text } : {}), ...(appearance.dashed ? { 'stroke-dasharray': '5 3' } : {}) })
  }
  for (const item of body.relationships) {
    const label = c4RelationshipText(body, item)
    graph.edges.push({ id: identities.relationships.get(item.id) ?? item.id, source: item.source, target: item.target, label, labelContent: { value: label, prepared: prepareDisplayText(label, 'literal') }, style: item.style.lineStyle === 'dashed' || item.style.lineStyle === 'dotted' ? 'dotted' : 'solid', hasArrowStart: item.bidirectional, hasArrowEnd: true })
    graph.linkStyles.set(graph.edges.length - 1, checkedAuthoredStyle({ ...(item.style.lineColor ? { stroke: item.style.lineColor } : {}), ...(item.style.textColor ? { color: item.style.textColor } : {}) }, `UpdateRelStyle(${item.from}, ${item.to})`))
  }
  return graph
}
