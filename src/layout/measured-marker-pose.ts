import type { ClassMarkerPiece } from '../class/relationship-paint.ts'
import type { Point } from '../types.ts'
import type { RoutingBox } from './compound-visibility.ts'

export type MarkerPoseBounds = { owner: number; source: boolean; minX: number; maxX: number; minY: number; maxY: number }
export type MarkerPose = MarkerPoseBounds & { pieces: ClassMarkerPiece[] }

/** One cardinal projection owns both retained seating pieces and obstacle
 * boxes. Box queries retain neither transformed pieces nor a second bounds record. */
function projectMarker(
  template: readonly ClassMarkerPiece[], port: Point, next: Point, owner: number, source: boolean,
  charge: (amount: number) => void, records: (amount: number) => void, fail: (reason: string) => never,
  reservePoints?: (amount: number) => void, margin = 0,
): MarkerPose | RoutingBox {
  charge(10)
  if (!Number.isFinite(port.x) || !Number.isFinite(port.y) || !Number.isFinite(next.x) || !Number.isFinite(next.y)) fail('Nonfinite measured marker normal')
  const dx = Math.sign(next.x - port.x), dy = Math.sign(next.y - port.y)
  if (Number(!dx) + Number(!dy) !== 1) fail('Nonorthogonal measured marker normal')
  if (reservePoints) {
    let points = 0
    for (const piece of template) {
      charge(1)
      if (piece.kind === 'polygon') points += piece.points.length
    }
    records(2 + 2 * template.length + points)
    reservePoints(points)
  } else records(5)
  const pieces: ClassMarkerPiece[] | undefined = reservePoints ? [] : undefined
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const piece of template) {
    charge(1)
    if (piece.kind === 'circle') {
      const cx = port.x + dx * piece.cx - dy * piece.cy, cy = port.y + dy * piece.cx + dx * piece.cy
      pieces?.push({ kind: 'circle', cx, cy, r: piece.r })
      minX = Math.min(minX, cx - piece.r); maxX = Math.max(maxX, cx + piece.r)
      minY = Math.min(minY, cy - piece.r); maxY = Math.max(maxY, cy + piece.r)
    } else {
      const polygon: Extract<ClassMarkerPiece, { kind: 'polygon' }> | undefined = pieces ? { kind: 'polygon', points: [] } : undefined
      for (const p of piece.points) {
        charge(1)
        const x = port.x + dx * p.x - dy * p.y, y = port.y + dy * p.x + dx * p.y
        polygon?.points.push({ x, y })
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
      if (polygon) pieces!.push(polygon)
    }
  }
  return pieces ? { owner, source, pieces, minX, maxX, minY, maxY }
    : { x: minX - margin, y: minY - margin, width: maxX - minX + 2 * margin, height: maxY - minY + 2 * margin }
}

export function projectMeasuredMarkerBox(
  template: readonly ClassMarkerPiece[], port: Point, next: Point, margin: number,
  charge: (amount: number) => void, records: (amount: number) => void, fail: (reason: string) => never,
): RoutingBox {
  return projectMarker(template, port, next, -1, false, charge, records, fail, undefined, margin) as RoutingBox
}

export function projectMeasuredMarkerPose(
  template: readonly ClassMarkerPiece[], port: Point, next: Point, owner: number, source: boolean,
  charge: (amount: number) => void, records: (amount: number) => void, reservePoints: (amount: number) => void, fail: (reason: string) => never,
): MarkerPose {
  return projectMarker(template, port, next, owner, source, charge, records, fail, reservePoints) as MarkerPose
}
