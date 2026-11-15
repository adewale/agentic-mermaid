import type { MarkerDescriptor } from '../scene/ir.ts'
import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
export const requirementArrow = tipAnchoredArrow('requirement-arrow', { width: 9, height: 7 }, 'end', { fill: 'none', stroke: 'var(--_arrow)', strokeWidth: '1' }, 'userSpaceOnUse')
export const requirementContains: MarkerDescriptor = {
  id: 'requirement-contains',
  shape: 'circle',
  size: { width: 12, height: 12 },
  ref: { x: 0, y: 6 },
  orient: 'auto',
  units: 'userSpaceOnUse',
  geometry: {
    kind: 'compound',
    children: [
      { kind: 'circle', cx: 6, cy: 6, r: 5 },
      { kind: 'path', d: 'M2 6H10M6 2V10' },
    ],
  },
  paint: { fill: 'var(--bg)', stroke: 'var(--_arrow)', strokeWidth: '1' },
}
export const requirementMarkerTerminal = prepareMarkerTerminals([requirementArrow, requirementContains])
