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
