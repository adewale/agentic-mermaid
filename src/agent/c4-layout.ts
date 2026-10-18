import type { PositionedC4Diagram } from '../c4/layout.ts'
import { effectiveC4Shape } from '../c4/config.ts'
import type { PositionedGroup } from '../types.ts'
import type { FamilyPositionedProjectionContext, FamilyPositionedView } from './families.ts'
import { toFinite } from './types.ts'

/** Identity and membership come from authored C4 semantics, never from text
 * search, coordinates, or a concatenated endpoint pair. */
export function projectC4Positioned({ positioned, options }: FamilyPositionedProjectionContext<PositionedC4Diagram>): FamilyPositionedView {
  const body = positioned.body
  const elements = new Map(body.elements.map(element => [element.id, element]))
  const relationships = new Map(body.relationships.map(relationship => [relationship.id, relationship]))
  const frames = new Map<string, PositionedGroup>()
  const visit = (groups: PositionedGroup[]): void => {
    for (const group of groups) {
      frames.set(group.id, group)
      visit(group.children)
    }
  }
  visit(positioned.groups)
  return {
    version: 1,
    nodes: positioned.nodes.flatMap(node => {
      const element = elements.get(node.id)
      return element ? [{
        id: element.id,
        x: toFinite(node.x), y: toFinite(node.y), w: toFinite(node.width), h: toFinite(node.height),
        shape: effectiveC4Shape(element), label: element.label, role: 'box' as const,
        ...(element.parentId !== undefined ? { parentId: element.parentId } : {}),
      }] : []
    }),
    edges: positioned.edges.map(edge => {
      const relation = edge.id === undefined ? undefined : relationships.get(edge.id)
      if (!relation) throw new Error('C4 positioned relationship has no authored interaction identity')
      return {
        id: relation.id, from: relation.source, to: relation.target,
        path: edge.points.map(point => [toFinite(point.x), toFinite(point.y)] as [ReturnType<typeof toFinite>, ReturnType<typeof toFinite>]),
        ...(edge.label !== undefined && edge.labelPosition ? { label: { x: toFinite(edge.labelPosition.x), y: toFinite(edge.labelPosition.y), text: edge.label } } : {}),
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
  }
}
