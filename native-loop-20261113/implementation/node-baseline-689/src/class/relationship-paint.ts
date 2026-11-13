import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
import type { MarkerDescriptor } from '../scene/ir.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { Point } from '../types.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import type { PositionedClassRelationship, RelationshipType } from './types.ts'
export function classMarkerResources(style: Pick<ResolvedRenderStyle, 'edgeStrokeColor'>): readonly MarkerDescriptor[] {
  const edgeColor = style.edgeStrokeColor ?? 'var(--_arrow)'
  const triangle = [
    { x: 0, y: 0 },
    { x: 12, y: 5 },
    { x: 0, y: 10 },
  ]
  const diamond = [
    { x: 7, y: 1 },
    { x: 13, y: 6 },
    { x: 7, y: 11 },
    { x: 1, y: 6 },
  ]
  return [
    { id: 'cls-inherit', shape: 'triangle', size: { width: 12, height: 10 }, ref: { x: 12, y: 5 }, orient: 'auto-start-reverse', overflow: 'visible', geometry: { kind: 'polygon', points: triangle }, paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' } },
    { id: 'cls-composition', shape: 'diamond', size: { width: 14, height: 12 }, viewBox: { x: 0, y: 0, width: 14, height: 12 }, ref: { x: 13, y: 6 }, orient: 'auto-start-reverse', overflow: 'hidden', geometry: { kind: 'polygon', points: diamond }, paint: { fill: edgeColor, stroke: edgeColor, strokeWidth: '1' } },
    {
      id: 'cls-aggregation',
      shape: 'diamond-open',
      size: { width: 14, height: 12 },
      viewBox: { x: 0, y: 0, width: 14, height: 12 },
      ref: { x: 13, y: 6 },
      orient: 'auto-start-reverse',
      overflow: 'hidden',
      geometry: { kind: 'polygon', points: diamond },
      paint: { fill: 'var(--bg)', stroke: edgeColor, strokeWidth: '1.5' },
    },
    {
      id: 'cls-arrow',
      shape: 'open-arrow',
      size: { width: 8, height: 6 },
      ref: { x: 8, y: 3 },
      orient: 'auto-start-reverse',
      overflow: 'visible',
      geometry: {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 3 },
          { x: 0, y: 6 },
        ],
      },
      paint: { fill: 'none', stroke: edgeColor, strokeWidth: '1.5' },
    },
    classInterfaceMarker(edgeColor),
  ]
}

const markerTerminal = prepareMarkerTerminals(classMarkerResources({}))
export function classRelationshipTerminalClearance(rel: Pick<PositionedClassRelationship, 'markerAt' | 'fromType' | 'toType' | 'type'>, style: Pick<ResolvedRenderStyle, 'lineWidth'>) {
  return {
    start: markerTerminal(rel.markerAt === 'from' || rel.markerAt === 'both' ? getMarkerDefId(rel.fromType ?? rel.type) ?? undefined : undefined, style.lineWidth, 'start'),
    end: markerTerminal(rel.markerAt === 'to' || rel.markerAt === 'both' ? getMarkerDefId(rel.toType ?? rel.type) ?? undefined : undefined, style.lineWidth, 'end'),
  }
}

export function getMarkerDefId(type: RelationshipType): string | null {
  switch (type) {
    case 'inheritance':
    case 'realization':
      return 'cls-inherit'
    case 'composition':
      return 'cls-composition'
    case 'aggregation':
      return 'cls-aggregation'
    case 'association':
    case 'dependency':
      return 'cls-arrow'
    case 'lollipop':
      return 'cls-lollipop'
    default:
      return null
  }
}

export const RELATION_LABEL_HALO_WIDTH = 3
export const RELATION_LABEL_OFFSET_Y = 8
/** Same stored anchors and fallback semantics consumed by Class drawing. */
export function classCaptionAnchor(rel: PositionedClassRelationship): Point | undefined {
  return rel.label && rel.points.length >= 2 ? (rel.labelPosition ?? rel.points[Math.floor(rel.points.length / 2)]) : undefined
}
export function classCardinalityAnchor(rel: PositionedClassRelationship, side: 'from' | 'to'): Point | undefined {
  if (!rel[`${side}Cardinality`] || rel.points.length < 2) return undefined
  const stored = rel[`${side}CardinalityPosition`]
  if (stored) return stored
  const p = side === 'from' ? rel.points[0]! : rel.points.at(-1)!,
    q = side === 'from' ? rel.points[1]! : rel.points.at(-2)!,
    dx = q.x - p.x,
    dy = q.y - p.y
  return Math.abs(dx) > Math.abs(dy) ? { x: p.x + (dx > 0 ? 14 : -14), y: p.y - 10 } : { x: p.x - 14, y: p.y + (dy > 0 ? 14 : -14) }
}
// The existing Class endpoint roster: 14 along slots × 32 perpendicular slots.
export const CLASS_TEXT_CANDIDATE_LIMIT = (Math.floor((150 - 14) / 10) + 1) * 2 * (Math.floor((190 - 10) / 12) + 1)
export function* classEndpointTextCandidates(endpoint: Point, toward: Point): Generator<Point> {
  const dx = toward.x - endpoint.x,
    dy = toward.y - endpoint.y,
    horizontal = Math.abs(dx) >= Math.abs(dy),
    ux = horizontal ? Math.sign(dx || 1) : 0,
    uy = horizontal ? 0 : Math.sign(dy || 1)
  for (let along = 14; along <= 150; along += 10) for (let distance = 10; distance <= 190; distance += 12) for (const offset of [-distance, distance]) yield { x: endpoint.x + ux * along - uy * offset, y: endpoint.y + uy * along + ux * offset }
}

export { markerPaintPieces as classMarkerPieces, type MarkerPaintPiece as ClassMarkerPiece } from '../scene/marker-paint-pieces.ts'
