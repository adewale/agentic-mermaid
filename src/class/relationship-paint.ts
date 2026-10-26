import type { MarkerDescriptor } from '../scene/ir.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { classInterfaceMarker } from './interface-occurrences.ts'
import type { RelationshipType } from './types.ts'
export function classMarkerResources(style: ResolvedRenderStyle): readonly MarkerDescriptor[] {
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

export { markerPaintPieces as classMarkerPieces, type MarkerPaintPiece as ClassMarkerPiece } from '../scene/marker-paint-pieces.ts'
