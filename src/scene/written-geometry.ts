import type { ConnectorContourSemantics, Geometry, ScenePoint } from './ir.ts'

export interface WrittenPolylineProjection {
  readonly contours: readonly ConnectorContourSemantics[]
  readonly collapsed: boolean
  readonly rawBounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  readonly rawStart: ScenePoint
  readonly rawEnd: ScenePoint
  readonly rawStartTangent?: ScenePoint
  readonly rawEndTangent?: ScenePoint
}

const projections = new WeakMap<object, WrittenPolylineProjection>()

/** Only a fresh geometry receives metadata. Existing projections cannot be
 * overwritten, and this derived data alone supplies no write/context custody.
 * The writer transfers its prepaid, individually frozen points and contours. */
export function createWrittenPolyline(points: ScenePoint[], projection: WrittenPolylineProjection): Extract<Geometry, { kind: 'polyline' }> {
  const geometry = Object.freeze({ kind: 'polyline' as const, points })
  projections.set(geometry, Object.freeze(projection))
  return geometry
}

export function writtenPolylineProjectionOf(geometry: object): WrittenPolylineProjection | undefined { return projections.get(geometry) }
