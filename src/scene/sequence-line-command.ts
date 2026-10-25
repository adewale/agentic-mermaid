import type { ConnectorLabelDescriptor, ConnectorMark, MarkerDescriptor, ScenePoint, SceneTransform } from './ir.ts'
import { connector, connectorSemanticFields } from './marks.ts'
import { connectorUnitTangent } from './connector-geometry.ts'
import { deferredTerminalProjectionInput } from './deferred-terminal-projection.ts'
import { privateConnectorPaintGeometry, type ConnectorMarkerPaintRegion } from './bounds.ts'
import type { NativeSceneValidator } from './scene-validation.ts'
import type { SequenceLineInput } from './drawing.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { composeMatrices, IDENTITY_MATRIX, inverseMatrix } from './transforms.ts'

/** Detached occurrence data; no route, hit, endpoint or terminal graph survives. */
export interface CheckedSequenceLine {
  readonly kind: 'sequence-line'
  readonly id: string
  readonly from: string
  readonly to: string
  readonly bounds?: AxisAlignedBox
  readonly regions: readonly ConnectorMarkerPaintRegion[]
}

/** One complete constructor-owned admission projection is rebound privately.
 * Its registered deferred input keeps these SAME nested object/array aliases.
 * It is never frozen, inspected, adopted into a Scene, or returned to a producer. */
export function createSequenceLineCompiler(marker: MarkerDescriptor) {
  const paintGeometry = privateConnectorPaintGeometry(marker)
  // Original message groups have no transform/opacity/conditional fields.
  // Keep the old identity world × inverse(own) association, including zeros.
  const [a, b, c, d, e, f] = composeMatrices([1, 0, 0, 1, 0, 0], inverseMatrix(IDENTITY_MATRIX)!)
  const markerParent: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
  let frame: ConnectorMark | undefined
  let labels: ConnectorLabelDescriptor[]
  let startTangent: ScenePoint
  let endTangent: ScenePoint

  function geometry(input: Pick<SequenceLineInput, 'id' | 'from' | 'to' | 'x1' | 'y1' | 'x2' | 'y2' | 'strokeColor' | 'strokeWidth'>): ConnectorMark {
    const node = frame!
    const line = node.route.geometry
    if (line.kind !== 'line') throw new Error('Private Sequence projection lost its line geometry')
    node.id = input.id
    node.endpoints.from = input.from
    node.endpoints.to = input.to
    line.x1 = node.endpoints.start!.point!.x = node.route.contours[0]!.start.x = input.x1
    line.y1 = node.endpoints.start!.point!.y = node.route.contours[0]!.start.y = input.y1
    line.x2 = node.endpoints.end!.point!.x = node.route.contours[0]!.end.x = input.x2
    line.y2 = node.endpoints.end!.point!.y = node.route.contours[0]!.end.y = input.y2
    const tangent = connectorUnitTangent(node.route.contours[0]!.start, node.route.contours[0]!.end)
    if (tangent) {
      startTangent.x = endTangent.x = tangent.x
      startTangent.y = endTangent.y = tangent.y
      node.route.startTangent = node.route.contours[0]!.startTangent = startTangent
      node.route.endTangent = node.route.contours[0]!.endTangent = endTangent
    } else {
      delete node.route.startTangent
      delete node.route.endTangent
      delete node.route.contours[0]!.startTangent
      delete node.route.contours[0]!.endTangent
    }
    node.stroke.color = input.strokeColor
    node.stroke.width = input.strokeWidth
    const width = Number.parseFloat(input.strokeWidth)
    node.hit.strokeWidth = Math.max(6, Number.isFinite(width) ? Math.max(0, width) : 1)
    return node
  }

  return {
    compile(input: SequenceLineInput, validator: NativeSceneValidator): { readonly command: CheckedSequenceLine; readonly svg: string } {
      if (!frame) {
        frame = connector({
          id: input.id, role: 'message', lineStyle: 'solid',
          geometry: { kind: 'line', x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2 },
          paint: { stroke: input.strokeColor, strokeWidth: input.strokeWidth },
          endpoints: { from: input.from, to: input.to },
          relationship: { kind: 'sequence-message', direction: 'forward' },
          route: { ownership: 'layout' }, markers: { mid: [], end: marker },
          labels: input.label ? [{ text: input.label, ...(input.labelContent ? { textContent: input.labelContent } : {}) }] : [],
        })
        // The constructor owns this mutable array, including its deferred alias.
        labels = frame.labels as ConnectorLabelDescriptor[]
        startTangent = frame.route.startTangent ?? { x: 0, y: 0 }
        endTangent = frame.route.endTangent ?? { x: 0, y: 0 }
      } else {
        const node = geometry(input)
        const semantics = connectorSemanticFields({ id: input.id, role: 'message',
          labels: input.label ? [{ text: input.label, ...(input.labelContent ? { textContent: input.labelContent } : {}) }] : [],
        }, node.endpoints, node)
        if (semantics.accessibility === undefined) delete node.accessibility
        else node.accessibility = semantics.accessibility
        labels.length = 0
        labels.push(...semantics.labels)
      }
      // Only the unchanged native shortcut may consume this projection.
      if (!deferredTerminalProjectionInput(frame)) throw new Error('Private Sequence projection must retain its deferred terminal input')
      const svg = validator.node(frame)
      // This closed command has semantic-only labels: no bounds or inline ink.
      // Admission/SVG already consumed them; paint needs no retained text graph.
      labels.length = 0
      const bounds = paintGeometry.bounds(frame)
      const regions = paintGeometry.regions(frame, markerParent)
      if (bounds) Object.freeze(bounds)
      for (const region of regions) {
        Object.freeze(region.anchor)
        if (region.bounds) Object.freeze(region.bounds)
        if (region.hull) {
          for (const point of region.hull) Object.freeze(point)
          Object.freeze(region.hull)
        }
        Object.freeze(region)
      }
      const command: CheckedSequenceLine = Object.freeze({ kind: 'sequence-line', id: input.id, from: input.from, to: input.to,
        ...(bounds ? { bounds } : {}), regions: Object.freeze(regions) })
      return { command, svg }
    },
  }
}

export type SequenceLineCompiler = ReturnType<typeof createSequenceLineCompiler>
