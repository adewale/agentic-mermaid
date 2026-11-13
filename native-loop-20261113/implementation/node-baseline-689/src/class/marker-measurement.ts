import type { MarkerPaint } from '../layout/compound-marker-seating.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { classMarkerPieces, classMarkerResources, getMarkerDefId } from './relationship-paint.ts'
import type { ClassRelationship } from './types.ts'

/** Bounded producer measurement: canonical resources, roles and resolved style.
 * Numeric bank references enter the measured JSON cache key with each edge. */
export function buildClassEndpointMarkerTemplates(relationships: readonly ClassRelationship[], style: ResolvedRenderStyle): MarkerPaint[] {
  const bank = classMarkerResources(style).map(marker => ({ id: marker.id, start: classMarkerPieces(marker, { x: 0, y: 0 }, { x: 1, y: 0 }, 'start', style.lineWidth), end: classMarkerPieces(marker, { x: 0, y: 0 }, { x: -1, y: 0 }, 'end', style.lineWidth) }))
  return relationships.map(rel => {
    const startType = rel.markerAt === 'from' || rel.markerAt === 'both' ? (rel.fromType ?? rel.type) : undefined
    const endType = rel.markerAt === 'to' || rel.markerAt === 'both' ? (rel.toType ?? rel.type) : undefined
    const start = startType ? bank.find(resource => resource.id === getMarkerDefId(startType))?.start : undefined
    const end = endType ? bank.find(resource => resource.id === getMarkerDefId(endType))?.end : undefined
    return { ...(start?.length ? { start } : {}), ...(end?.length ? { end } : {}) }
  })
}

/** The same painted pieces bound each singleton shaft's perpendicular support.
 * Pieces already include resource units, clipping and stroke joins. */
export function classEndpointMarkerSpans(templates: readonly MarkerPaint[], shaftWidth: number, charge: (amount: number) => void): Array<{ sourcePortSpan: number; targetPortSpan: number }> {
  return templates.map(template => {
    charge(3)
    const spans = [template.start, template.end].map(pieces => {
      let span = shaftWidth
      for (const piece of pieces ?? []) {
        charge(4)
        if (piece.kind === 'circle') span = Math.max(span, 2 * (Math.abs(piece.cy) + piece.r))
        else for (const point of piece.points) { charge(3); span = Math.max(span, 2 * Math.abs(point.y)) }
      }
      return span
    })
    return { sourcePortSpan: spans[0]!, targetPortSpan: spans[1]! }
  })
}
