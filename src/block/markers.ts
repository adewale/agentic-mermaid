import type { MarkerDescriptor } from '../scene/ir.ts'
import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
export const blockMarkers: Record<string, MarkerDescriptor> = {}
for (const end of ['start', 'end'] as const) {
  blockMarkers[`arrow_point:${end}`] = tipAnchoredArrow(`block-arrow-${end}`, { width: 8, height: 7 }, end, { fill: 'var(--_arrow)', stroke: 'none' }, 'userSpaceOnUse')
  blockMarkers[`arrow_circle:${end}`] = { id: `block-circle-${end}`, shape: 'circle', size: { width: 9, height: 9 }, ref: { x: 4.5, y: 4.5 }, orient: 'auto', geometry: { kind: 'circle', cx: 4.5, cy: 4.5, r: 3.5 }, paint: { fill: 'var(--bg)', stroke: 'var(--_arrow)', strokeWidth: '1' }, units: 'userSpaceOnUse' }
  blockMarkers[`arrow_cross:${end}`] = { id: `block-cross-${end}`, shape: 'cross', size: { width: 9, height: 9 }, ref: { x: 4.5, y: 4.5 }, orient: 'auto', geometry: { kind: 'path', d: 'M1 1L8 8M1 8L8 1' }, paint: { fill: 'none', stroke: 'var(--_arrow)', strokeWidth: '1' }, units: 'userSpaceOnUse' }
}
export const blockMarkerTerminal = prepareMarkerTerminals(Object.values(blockMarkers))
