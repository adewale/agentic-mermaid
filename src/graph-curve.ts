import {
  curveBasis, curveCardinal, curveCatmullRom, curveLinear, curveMonotoneX,
  curveMonotoneY, curveNatural, curveStep, curveStepAfter, curveStepBefore,
  type CurveFactory,
} from 'd3-shape'
import type { Point } from './types.ts'
import { projectConnectorPath, type ConnectorPathProjection, type ConnectorPathProjectionSegment } from './scene/connector-geometry.ts'
import { formatSvgNumber } from './shared/svg-number.ts'

const factories: Readonly<Record<string, CurveFactory>> = {
  basis: curveBasis, cardinal: curveCardinal, catmullRom: curveCatmullRom,
  linear: curveLinear, monotoneX: curveMonotoneX, monotoneY: curveMonotoneY,
  natural: curveNatural, step: curveStep, stepAfter: curveStepAfter, stepBefore: curveStepBefore,
}

/** Capture the interpolation commands before serialization. The same controls
 * feed written SVG, bounds, placement, hit geometry and terminal derivatives;
 * no consumer needs to reconstruct the curve from its name or route chords. */
export function projectGraphCurve(points: readonly Point[], name: string): ConnectorPathProjection {
  const factory = Object.hasOwn(factories, name) ? factories[name] : undefined
  if (!factory && name !== 'bumpX' && name !== 'bumpY') {
    throw new RangeError(`Unsupported edge curve "${name}". Use basis, bumpX, bumpY, cardinal, catmullRom, linear, monotoneX, monotoneY, natural, step, stepAfter or stepBefore.`)
  }
  if (points.length === 0) throw new RangeError('Edge curves require at least one point')
  // Keep invocation-local values, including for mutable and accessor callers.
  const route = points.map(point => ({ x: point.x, y: point.y }))
  const start = route[0]!
  const segments: Exclude<ConnectorPathProjectionSegment, { kind: 'quadratic' }>[] = []
  // Constant interpolation is a point. Avoid arithmetic noise that could
  // round controls differently from the anchor and fabricate marker tangents.
  const interpolation = route.every(point => point.x === start.x && point.y === start.y) ? curveLinear : factory
  if (interpolation) {
    let moved = false
    const unsupportedCommand = (): never => { throw new TypeError('Edge interpolation emitted an unsupported path command') }
    const curve = interpolation({
      moveTo(x, y) {
        if (moved || x !== start.x || y !== start.y) unsupportedCommand()
        moved = true
      },
      lineTo(x, y) { segments.push({ kind: 'line', end: { x, y } }) },
      bezierCurveTo(x1, y1, x2, y2, x, y) {
        segments.push({ kind: 'cubic', control1: { x: x1, y: y1 }, control2: { x: x2, y: y2 }, end: { x, y } })
      },
      // These open factories may close a singleton, which has no painted leg.
      closePath() { if (segments.length > 0) unsupportedCommand() },
      quadraticCurveTo: unsupportedCommand, arcTo: unsupportedCommand,
      arc: unsupportedCommand, rect: unsupportedCommand, toString: unsupportedCommand,
    })
    curve.lineStart()
    for (const point of route) curve.point(point.x, point.y)
    curve.lineEnd()
  } else {
    // Bump curves use parallel endpoint tangents, bisecting the chosen axis.
    // d3-shape 1.x (already shipped for Sankey) predates these two factories.
    for (let index = 1; index < route.length; index++) {
      const previous = route[index - 1]!, end = route[index]!
      const mid = name === 'bumpX' ? (previous.x + end.x) / 2 : (previous.y + end.y) / 2
      segments.push({ kind: 'cubic',
        control1: name === 'bumpX' ? { x: mid, y: previous.y } : { x: previous.x, y: mid },
        control2: name === 'bumpX' ? { x: mid, y: end.y } : { x: end.x, y: mid }, end })
    }
  }
  // Final numeric spelling is part of the geometry. Derive all sampled ink
  // and exact terminal semantics from these same served controls/anchors.
  const writtenPoint = (point: Point): Point => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) })
  const writtenStart = writtenPoint(start)
  const writtenSegments = segments.map(segment => segment.kind === 'line'
    ? { kind: 'line' as const, end: writtenPoint(segment.end) }
    : { kind: 'cubic' as const, control1: writtenPoint(segment.control1), control2: writtenPoint(segment.control2), end: writtenPoint(segment.end) })
  const parts = [`M ${writtenStart.x} ${writtenStart.y}`]
  for (const segment of writtenSegments) {
    parts.push(segment.kind === 'cubic'
      ? `C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`
      : `L ${segment.end.x} ${segment.end.y}`)
  }
  return projectConnectorPath(parts.join(' '), writtenStart, writtenSegments)
}
