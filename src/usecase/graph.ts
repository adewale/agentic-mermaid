import { prepareDisplayText } from '../shared/display-text.ts'
import { generatedIds } from '../shared/generated-identity.ts'
import { checkedAuthoredStyle, parseStyleProps } from '../shared/style-props.ts'
import type { MermaidGraph, MermaidNode, MermaidSubgraph } from '../types.ts'
import { Arrow } from './grammar/types.ts'
import type { UsecaseBody, UsecaseNode } from './types.ts'

const content = (value: string, labelType: string = 'text') => ({ value, prepared: prepareDisplayText(value, labelType === 'markdown' ? 'formatted' : 'literal') })
export const usecaseNodeLabel = (node: UsecaseNode) => `${node.stereotype ? `<<${node.stereotype}>>\n` : ''}${node.label}`
export function usecaseJsonLabel(node: UsecaseBody['jsonNodes'][number]): string {
  const order = new Map(node.propertyOrder),
    keys = order.get('') ?? Object.keys(node.value)
  return [node.id, ...keys.map(key => `${key}: ${JSON.stringify(node.value[key])}`)].join('\n')
}
export function projectUsecaseGraph(body: UsecaseBody, terminal = false): MermaidGraph {
  const nodes = new Map<string, MermaidNode>(),
    styles = new Map<string, Record<string, string>>(),
    assignments = new Map<string, string>()
  for (const node of body.nodes) {
    const label = `${terminal && node.kind === 'actor' ? '[actor] ' : ''}${usecaseNodeLabel(node)}${terminal && node.kind === 'actor' && node.icon ? ` [${node.icon}]` : ''}`
    nodes.set(node.id, { id: node.id, label, labelContent: content(label, node.labelType), shape: node.kind === 'usecase' && node.shape === 'ellipse' ? 'ellipse' : 'rectangle' })
    styles.set(node.id, checkedAuthoredStyle(parseStyleProps(node.styles.join(',')), `style ${node.id}`))
    assignments.set(node.id, node.classes.join(' '))
  }
  for (const node of body.jsonNodes) {
    const label = usecaseJsonLabel(node)
    nodes.set(node.id, { id: node.id, label, shape: 'rectangle', labelContent: content(label) })
    styles.set(node.id, checkedAuthoredStyle(parseStyleProps(node.styles.join(',')), `style ${node.id}`))
    assignments.set(node.id, node.classes.join(' '))
  }
  const allocate = generatedIds([...nodes.keys(), ...body.boundaries.map(node => node.id), ...body.relationships.map(edge => edge.id)])
  const subgraphs: MermaidSubgraph[] = body.boundaries.map(boundary => ({ id: boundary.id, label: boundary.label, labelContent: content(boundary.label, boundary.labelType), nodeIds: body.nodes.filter(node => node.parentId === boundary.id).map(node => node.id), children: [] }))
  for (const boundary of body.boundaries) {
    styles.set(boundary.id, checkedAuthoredStyle(parseStyleProps(boundary.styles.join(',')), `style ${boundary.id}`))
    assignments.set(boundary.id, boundary.classes.join(' '))
  }
  const edges: MermaidGraph['edges'] = body.relationships.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.type === 'include' || edge.type === 'extend' ? `<<${edge.type}>>` : edge.label,
    style: edge.type === 'include' || edge.type === 'extend' ? 'dotted' : 'solid',
    hasArrowStart: [Arrow.BACK_ARROW, Arrow.CIRCLE_ARROW_REVERSED, Arrow.CROSS_ARROW_REVERSED].includes(edge.arrowType),
    hasArrowEnd: edge.arrowType !== Arrow.LINE_SOLID && ![Arrow.BACK_ARROW, Arrow.CIRCLE_ARROW_REVERSED, Arrow.CROSS_ARROW_REVERSED].includes(edge.arrowType),
    ...(edge.arrowType === Arrow.CIRCLE_ARROW || edge.arrowType === Arrow.CIRCLE_ARROW_REVERSED ? ({ startMarker: 'circle', endMarker: 'circle' } as const) : edge.arrowType === Arrow.CROSS_ARROW || edge.arrowType === Arrow.CROSS_ARROW_REVERSED ? ({ startMarker: 'cross', endMarker: 'cross' } as const) : {}),
    length: edge.minlen,
    animate: edge.animate,
    animation: edge.animation,
    ...(edge.label !== undefined ? { labelContent: content(edge.type === 'include' || edge.type === 'extend' ? `<<${edge.type}>>` : edge.label, edge.labelType) } : {}),
  }))
  const linkStyles = new Map<number | 'default', Record<string, string>>()
  for (const [index, edge] of body.relationships.entries()) {
    linkStyles.set(index, checkedAuthoredStyle(parseStyleProps(edge.styles.join(',')), `style ${edge.id}`))
    assignments.set(edge.id, edge.classes.join(' '))
  }
  for (const note of body.notes) {
    if (nodes.has(note.id) || subgraphs.some(group => group.id === note.id)) throw new Error(`UseCase note identity ${note.id} collides with an authored node`)
    nodes.set(note.id, { id: note.id, label: note.label, shape: 'state-note', labelContent: content(note.label, note.labelType) })
    edges.push({ id: allocate(`${note.id}:link`, ['note-link', note.id]), source: note.target, target: note.id, style: 'dotted', hasArrowStart: false, hasArrowEnd: false })
  }
  return { direction: body.direction, nodes, edges, subgraphs, classDefs: new Map(body.classDefs.map(cls => [cls.id, checkedAuthoredStyle(parseStyleProps(cls.styles.join(',')), `classDef ${cls.id}`)])), classAssignments: assignments, nodeStyles: styles, linkStyles }
}
