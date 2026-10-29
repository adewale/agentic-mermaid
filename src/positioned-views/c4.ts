import type { PositionedC4Diagram } from '../c4/layout.ts'
import { effectiveC4Shape } from '../c4/config.ts'
import type { PositionedGroup, TextTransform } from '../types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { toFinite } from '../agent/types.ts'
import type { RenderedLayoutLabel } from '../agent/types.ts'
import { retainedLabelBounds, retainedLabelGeometry, canvasOf, labelRect } from './geometry.ts'
import { c4ElementText, c4BoundaryText, c4RelationshipText } from '../c4/projection.ts'
import { c4LegendEntries } from '../c4/legend.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'

/** Identity and membership come from authored C4 semantics, never from text
 * search, coordinates, or a concatenated endpoint pair. */
export function projectC4Positioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedC4Diagram>): FamilyPositionedView {
  const body = positioned.body
  const textContext = positioned.textContext
  const retainedText = (id: string, source: string, block: PixelTextBlock | undefined, transform?: TextTransform): void => {
    if (!block || block.prepared.source !== source || block.prepared.display !== 'literal' || block.prepared.transform !== transform) throw new Error('C4 ' + id + ' changed its retained prepared text')
  }
  const elements = new Map(body.elements.map(element => [element.id, element]))
  const relationships = new Map(body.relationships.map(relationship => [relationship.id, relationship]))
  const frames = new Map<string, PositionedGroup>()
  const parents = new Map<string, string | undefined>()
  const visit = (groups: PositionedGroup[], parentId?: string): void => {
    for (const group of groups) {
      if (frames.has(group.id)) throw new Error(`C4 boundary "${group.id}" has a repeated positioned frame`)
      frames.set(group.id, group)
      parents.set(group.id, parentId)
      visit(group.children, group.id)
    }
  }
  visit(positioned.groups)
  const nodeIds = new Set(positioned.nodes.map(node => node.id))
  if (nodeIds.size !== positioned.nodes.length || nodeIds.size !== elements.size || body.elements.some(element => !nodeIds.has(element.id))) throw new Error('C4 positioned cards do not match the authored identities')
  if (frames.size !== body.boundaries.length) throw new Error('C4 positioned frames do not match the authored boundaries')
  const edgeIds = new Set(positioned.edges.map(edge => edge.id))
  if (edgeIds.size !== positioned.edges.length || edgeIds.size !== relationships.size) throw new Error('C4 positioned relationships do not match the authored identities')
  for (const node of positioned.nodes) {
    const source = c4ElementText(elements.get(node.id)!)
    if (node.label !== source) throw new Error('C4 card ' + node.id + ' changed its authored text')
    retainedText(node.id, source, node.labelBlock, textContext.node)
  }
  for (const edge of positioned.edges) {
    const relation = edge.id === undefined ? undefined : relationships.get(edge.id)
    if (!relation) throw new Error('C4 positioned relationship has no authored interaction identity')
    const source = c4RelationshipText(body, relation)
    const style = relation.style.lineStyle === 'dashed' || relation.style.lineStyle === 'dotted' ? 'dotted' : 'solid'
    if (edge.source !== relation.source || edge.target !== relation.target || edge.label !== source || edge.style !== style || edge.hasArrowStart !== relation.bidirectional || !edge.hasArrowEnd || (edge.startMarker ?? 'arrow') !== 'arrow' || (edge.endMarker ?? 'arrow') !== 'arrow') throw new Error('C4 relationship ' + edge.id + ' changed its authored endpoints, label, shaft or markers')
    retainedText(edge.id!, source, edge.labelBlock, textContext.edge)
  }
  const labels: RenderedLayoutLabel[] = []
  for (const boundary of body.boundaries) {
    const frame = frames.get(boundary.id)
    if (!frame || parents.get(boundary.id) !== boundary.parentId) throw new Error(`C4 boundary "${boundary.id}" changed its authored parent`)
    const source = c4BoundaryText(boundary)
    if (frame.label !== source) throw new Error('C4 boundary ' + boundary.id + ' changed its authored text')
    retainedText(boundary.id, source, frame.labelBlock, textContext.group)
    const anchor = boundary.alignment === 'left' ? 'start' : boundary.alignment === 'right' ? 'end' : 'middle'
    const x = boundary.alignment === 'left' ? frame.x + positioned.config.padding : boundary.alignment === 'right' ? frame.x + frame.width - positioned.config.padding : frame.x + frame.width / 2
    const height = frame.headerHeight ?? 36
    labels.push({ id: `boundary-label:${boundary.id}`, text: frame.labelBlock?.text ?? frame.label,
      bounds: retainedLabelBounds(frame.labelBlock, x, frame.y + height / 2, anchor),
      container: labelRect({ ...frame, height }) })
  }
  if ((textContext.title !== undefined) !== (positioned.title !== undefined)) throw new Error('C4 positioned title does not match the authored title')
  if (positioned.title) {
    const title = positioned.title
    retainedText('title', textContext.title!, title.block, textContext.group)
    labels.push({ id: 'title', text: title.text, bounds: retainedLabelBounds(title.block, title.x, title.y), container: labelRect(canvasOf(positioned)) })
  }
  const entries = c4LegendEntries(body, positioned.config)
  if ((entries.length > 0) !== (positioned.legend !== undefined)) throw new Error('C4 positioned legend does not match the authored legend')
  if (positioned.legend) {
    const legend = positioned.legend
    if (legend.entries.length !== entries.length || legend.entries.some((entry, index) => entry.id !== entries[index]!.id)) throw new Error('C4 positioned legend entries do not match the authored legend')
    retainedText('legend heading', 'Legend', legend.heading, textContext.legendHeading)
    const container = labelRect(legend)
    labels.push({ id: 'legend:heading', text: legend.heading.text, bounds: retainedLabelBounds(legend.heading, legend.x + 12, legend.y + 8 + legend.heading.height / 2, 'start'), container })
    let y = legend.y + 20 + legend.heading.height
    for (const [index, entry] of legend.entries.entries()) {
      retainedText(entry.id, entries[index]!.label, entry.block, textContext.edge)
      labels.push({ id: `legend:entry:${entry.id}`, text: entry.block.text, bounds: retainedLabelBounds(entry.block, legend.x + 38, y + entry.block.height / 2, 'start'), container })
      y += entry.block.height + 10
    }
  }
  return {
    version: 1,
    nodes: positioned.nodes.map(node => {
      const element = elements.get(node.id)!
      const shape = effectiveC4Shape(element)
      const textY = node.y + node.height / 2 + (shape === 'person' ? 19 : shape === 'database' ? 4 : 0)
      return {
        id: element.id,
        x: toFinite(node.x), y: toFinite(node.y), w: toFinite(node.width), h: toFinite(node.height),
        shape, label: element.label, role: 'box' as const,
        ...retainedLabelGeometry(node.labelBlock, node.x + node.width / 2, textY, node),
        ...(element.parentId !== undefined ? { parentId: element.parentId } : {}),
      }
    }),
    edges: positioned.edges.map(edge => {
      const relation = edge.id === undefined ? undefined : relationships.get(edge.id)
      if (!relation) throw new Error('C4 positioned relationship has no authored interaction identity')
      return {
        id: relation.id, from: edge.source, to: edge.target,
        path: edge.points.map(point => [toFinite(point.x), toFinite(point.y)] as [ReturnType<typeof toFinite>, ReturnType<typeof toFinite>]),
        ...(edge.label !== undefined && edge.labelPosition ? { label: { x: toFinite(edge.labelPosition.x), y: toFinite(edge.labelPosition.y), text: edge.label, bounds: retainedLabelBounds(edge.labelBlock, edge.labelPosition.x, edge.labelPosition.y) } } : {}),
        ...(options.debug && edge.routeCertificate ? { route: edge.routeCertificate } : {}),
      }
    }),
    groups: body.boundaries.map(boundary => {
      const frame = frames.get(boundary.id)
      if (!frame) throw new Error(`C4 boundary "${boundary.id}" has no positioned frame`)
      return {
        id: boundary.id, label: boundary.label,
        x: toFinite(frame.x), y: toFinite(frame.y), w: toFinite(frame.width), h: toFinite(frame.height),
        members: body.elements.filter(element => element.parentId === boundary.id).map(element => element.id),
        ...(boundary.parentId !== undefined ? { parentId: boundary.parentId } : {}),
      }
    }),
    bounds: { w: toFinite(positioned.width), h: toFinite(positioned.height) },
    labels,
  }
}
