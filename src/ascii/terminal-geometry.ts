import type { TerminalBounds, TerminalDocument, TerminalOwner } from './terminal-document.ts'

export type TerminalSide = 'T' | 'R' | 'B' | 'L'
export type FaceDemand = Readonly<Record<TerminalSide, number>>

/** Endpoint demand is measured before allocation, shared by card families. */
export function countFaceDemand(endpoints: Iterable<{ id: string; side: TerminalSide }>): Map<string, FaceDemand> {
  const counts = new Map<string, Record<TerminalSide, number>>()
  for (const { id, side } of endpoints) {
    const value = counts.get(id) ?? { T: 0, R: 0, B: 0, L: 0 }
    value[side]++; counts.set(id, value)
  }
  for (const value of counts.values()) Object.freeze(value)
  return counts
}

export function faceSize(demand: FaceDemand | undefined): { width: number; height: number } {
  return demand ? { width: Math.max(demand.T, demand.B) * 3 + 2, height: Math.max(demand.L, demand.R) * 3 + 2 } : { width: 0, height: 0 }
}

/** A port is outside its card, away from corners and distinct from every
 * other allocation on that face. Insufficient capacity fails before paint. */
export function allocateFacePort(box: TerminalBounds, side: TerminalSide, index: number, count: number): Readonly<{ x: number; y: number; side: TerminalSide }> {
  if (![box.x, box.y, box.width, box.height].every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError('Terminal port allocation needs an integer card rectangle')
  const extent = side === 'T' || side === 'B' ? box.width : box.height
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(index) || index < 0 || index >= count || extent < count * 3 + 2) throw new RangeError('Terminal card face has insufficient allocated port capacity')
  const along = Math.floor((index + 1) * (extent - 1) / (count + 1))
  const point = side === 'T' ? { x: box.x + along, y: box.y - 1 }
    : side === 'B' ? { x: box.x + along, y: box.y + box.height }
    : side === 'L' ? { x: box.x - 1, y: box.y + along }
    : { x: box.x + box.width, y: box.y + along }
  if (!Number.isSafeInteger(point.x) || point.x < 0 || !Number.isSafeInteger(point.y) || point.y < 0) throw new RangeError('Terminal port must have nonnegative integer coordinates')
  return Object.freeze({ ...point, side })
}

/** Frames share occupied geometry; headers and containment remain family-owned. */
export function paintTerminalFrame(document: TerminalDocument, box: TerminalBounds, owner: TerminalOwner, ascii: boolean, opaque = false, reservedBorderCell?: (x: number, y: number) => boolean): void {
  owner = document.element(owner)
  if (box.width < 2 || box.height < 2) throw new RangeError('Terminal frames need room for opposite borders')
  document.region(owner, box)
  if (opaque) document.fill(box.x, box.y, box.width, box.height, { owner, kind: 'surface' })
  const paint = { owner, role: 'border' as const, ascii }
  const stroke = (x: number, y: number, mask: number) => { if (!reservedBorderCell?.(x, y)) document.stroke(x, y, mask, paint) }
  for (let x = box.x + 1; x < box.x + box.width - 1; x++) { stroke(x, box.y, 10); stroke(x, box.y + box.height - 1, 10) }
  for (let y = box.y + 1; y < box.y + box.height - 1; y++) { stroke(box.x, y, 5); stroke(box.x + box.width - 1, y, 5) }
  stroke(box.x, box.y, 6); stroke(box.x + box.width - 1, box.y, 12)
  stroke(box.x, box.y + box.height - 1, 3); stroke(box.x + box.width - 1, box.y + box.height - 1, 9)
}
