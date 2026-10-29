import type { MarkerDescriptor } from '../scene/ir.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
export function dependencyArrowMarker(id: string, color: string): MarkerDescriptor {
  return {
    id,
    shape: 'arrow',
    size: { width: 8, height: 7 },
    ref: { x: 8, y: 3.5 },
    orient: 'auto',
    geometry: { kind: 'path', d: 'M0,0 L8,3.5 L0,7 Z' },
    paint: { fill: color },
  }
}

export const dependencyStrokeWidth = (width: number, critical: boolean) => critical ? Math.max(1.8, width * 1.5) : Math.max(1.2, width)
const terminal = prepareMarkerTerminals([dependencyArrowMarker('dependency', 'black')])
export const dependencyTerminalLead = (width: number) => terminal('dependency', width, 'end')
