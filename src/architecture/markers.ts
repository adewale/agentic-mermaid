import type { MarkerDescriptor } from '../scene/ir.ts'
import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
const ARCHITECTURE_MARKER_PAINT = {
  fill: 'var(--arch-edge-stroke, var(--_arrow))',
  stroke: 'var(--arch-edge-stroke, var(--_arrow))',
  strokeWidth: '0.75',
  strokeLinejoin: 'round' as const,
}

export const ARCHITECTURE_MARKERS: readonly MarkerDescriptor[] = [
  tipAnchoredArrow('architecture-arrow-end', { width: 8, height: 5 }, 'end', ARCHITECTURE_MARKER_PAINT),
  tipAnchoredArrow('architecture-arrow-start', { width: 8, height: 5 }, 'start', ARCHITECTURE_MARKER_PAINT),
]

export const architectureMarkerTerminal = prepareMarkerTerminals(ARCHITECTURE_MARKERS)
