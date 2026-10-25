import type { ConnectorLabelDescriptor, ConnectorMark, MarkerDescriptor, ScenePoint, SceneTransform } from './ir.ts'
import { connector, connectorSemanticFields } from './marks.ts'
import { connectorUnitTangent } from './connector-geometry.ts'
import { deferredTerminalProjectionInput } from './deferred-terminal-projection.ts'
import { privateConnectorPaintGeometry } from './bounds.ts'
import type { NativeSceneValidator } from './scene-validation.ts'
import type { SequenceLineInput } from './sequence-line-sink.ts'

/** Detached occurrence data; no route, hit, endpoint or terminal graph survives. */
export interface CheckedSequenceLine extends Omit<SequenceLineInput, 'label' | 'labelContent'> {
  readonly kind: 'sequence-line'
  readonly label?: ConnectorLabelDescriptor
  readonly accessibleLabel: string
  readonly relationLabel?: string
}

/** One complete constructor-owned admission projection is rebound privately.
 * Its registered deferred input keeps these SAME nested object/array aliases.
 * It is never frozen, inspected, adopted into a Scene, or returned to a producer. */
export function createSequenceLineCompiler(marker: MarkerDescriptor) {
  const paintGeometry = privateConnectorPaintGeometry(marker)
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

  function restore(input: CheckedSequenceLine): ConnectorMark {
    const node = geometry(input)
    node.identity!.id = input.id
    node.identity!.from = input.from
    node.identity!.to = input.to
    node.accessibility!.label = input.accessibleLabel
    node.accessibility!.relation.from = input.from
    node.accessibility!.relation.to = input.to
    if (input.relationLabel === undefined) delete node.accessibility!.relation.label
    else node.accessibility!.relation.label = input.relationLabel
    labels.length = 0
    if (input.label) labels.push(input.label)
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
      const command: CheckedSequenceLine = Object.freeze({ kind: 'sequence-line', id: input.id, from: input.from, to: input.to,
        x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2, strokeColor: input.strokeColor, strokeWidth: input.strokeWidth,
        ...(labels[0] ? { label: labels[0] } : {}), accessibleLabel: frame.accessibility!.label,
        ...(frame.accessibility!.relation.label !== undefined ? { relationLabel: frame.accessibility!.relation.label } : {}) })
      return { command, svg }
    },
    paint(command: CheckedSequenceLine, parent: SceneTransform | undefined, markerParent: SceneTransform, hidden = false) {
      const node = restore(command)
      return { bounds: hidden ? undefined : paintGeometry.bounds(node, parent), regions: paintGeometry.regions(node, markerParent) }
    },
  }
}

export type SequenceLineCompiler = ReturnType<typeof createSequenceLineCompiler>
