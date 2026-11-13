import { VISIBLE_SHAFT } from '../shared/edge-label-geometry.ts'
import { markerTerminalDepth } from './bounds.ts'
import type { MarkerDescriptor } from './ir.ts'

/** Prepare once per resource bank, before visiting edges. Paint colours do not
 * affect these unit-width supports; carrier widths are applied arithmetically.
 * The bank belongs to the lowering/request, never to a mutable route cache. */
export function prepareMarkerTerminals(markers: readonly MarkerDescriptor[]) {
  const bank = new Map(markers.map(marker => [marker.id, {
    start: markerTerminalDepth(marker, 'start'),
    end: markerTerminalDepth(marker, 'end'),
    fixed: marker.units === 'userSpaceOnUse',
  }]))
  return (id: string | undefined, width: number, position: 'start' | 'end'): number => {
    if (!id) return 0
    const measured = bank.get(id)
    if (!measured) throw new Error(`Missing terminal marker ${id}`)
    return measured[position] * (measured.fixed ? 1 : width) + VISIBLE_SHAFT
  }
}
