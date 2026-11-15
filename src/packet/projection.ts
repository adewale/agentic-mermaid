import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { canvasOf, f, retainedLabelGeometry } from '../positioned-views/geometry.ts'
import type { PositionedPacketDiagram } from './types.ts'

export function projectPacketPositioned({ positioned }: FamilyPositionedProjectionContext<PositionedPacketDiagram>): FamilyPositionedView {
  return {
    version: 1,
    nodes: positioned.fields.map(field => ({ id: field.id, x: f(field.x), y: f(field.y), w: f(field.width), h: f(field.height), shape: 'rectangle', label: field.label, ...retainedLabelGeometry(field.labelBlock, field.x + field.width / 2, field.y + field.height / 2, canvasOf(positioned), 'middle') })),
    edges: [],
    groups: [],
    bounds: { w: f(positioned.width), h: f(positioned.height) },
  }
}
