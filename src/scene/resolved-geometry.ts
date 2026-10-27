import type { SvgElement } from './resolved-css.ts'
import { cssLength } from './resolved-css.ts'
import type { Matrix } from './resolved-types.ts'
import { composeMatrices, parseSvgTransform } from './transforms.ts'

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
export const multiply = (a: Matrix, b: Matrix): Matrix => {
  const matrix: Matrix = [...composeMatrices(a, b)]
  if (!matrix.every(Number.isFinite)) throw new Error('Non-finite transform')
  return matrix
}

export function svgMatrix(value: string | undefined): Matrix {
  if (!value) return [...IDENTITY]
  const matrix = parseSvgTransform(value)
  if (matrix) return [...matrix]
  // The Scene transform grammar is intentionally narrower than SVG's.
  const skew = value.match(/^skew([XY])\(\s*([-+\d.eE]+)\s*\)$/)
  if (skew) {
    const t = Math.tan(Number(skew[2]) * Math.PI / 180)
    return skew[1] === 'X' ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0]
  }
  throw new Error(`Unsupported transform "${value}"`)
}

export function pathData(node: SvgElement, fontSize: number): string {
  const n = (key: string, fallback = 0) => node.attrs[key] === undefined ? fallback : cssLength(node.attrs[key]!, fontSize)
  switch (node.tag) {
    case 'path': return node.attrs.d ?? ''
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
    case 'polygon':
    case 'polyline': {
      const numbers = (node.attrs.points ?? '').trim().split(/[\s,]+/).map(Number)
      const points: string[] = []
      for (let i = 0; i + 1 < numbers.length; i += 2) points.push(`${numbers[i]} ${numbers[i + 1]}`)
      return points.length ? `M${points.join('L')}${node.tag === 'polygon' ? 'Z' : ''}` : ''
    }
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height')
      const rx = Math.min(n('rx', n('ry')), w / 2), ry = Math.min(n('ry', n('rx')), h / 2)
      return rx > 0 && ry > 0
        ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
        : `M${x} ${y}h${w}v${h}h${-w}Z`
    }
    case 'circle':
    case 'ellipse': {
      const x = n('cx'), y = n('cy'), rx = n('rx', n('r')), ry = n('ry', n('r'))
      // SVG basic ellipses start at the rightmost point and run clockwise.
      // Retain that traversal so dash phase agrees, not just the filled outline.
      // Quarter arcs avoid the numerically unstable 180-degree large-arc
      // boundary in SVG path implementations after float coordinate rounding.
      return `M${x + rx} ${y}A${rx} ${ry} 0 0 1 ${x} ${y + ry}A${rx} ${ry} 0 0 1 ${x - rx} ${y}A${rx} ${ry} 0 0 1 ${x} ${y - ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    default: throw new Error(`Unsupported element <${node.tag}>`)
  }
}

interface Point { x: number; y: number }
interface Endpoint { point: Point; angle: number }

/** Endpoint derivatives of SVG path commands. Zero-length segments defer to
 * the nearest segment with a direction, as SVG marker orientation requires. */
export function pathEndpoints(d: string): [Endpoint, Endpoint] {
  const tokens = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) ?? []
  let i = 0, command = '', previous = '', point: Point = { x: 0, y: 0 }, move = point, control = point
  let first: Endpoint | undefined, last: Endpoint | undefined, firstPoint: Point | undefined
  const angle = (a: Point, b: Point): number | undefined => a.x === b.x && a.y === b.y ? undefined : Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
  const direction = (pts: Point[]): number | undefined => {
    for (let n = 1; n < pts.length; n++) { const a = angle(pts[0]!, pts[n]!); if (a !== undefined) return a }
    return undefined
  }
  const lineAngles = (start: Point, end: Point): [number | undefined, number | undefined] => {
    // Match the float geometry and 0.1-unit endpoint samples exposed by
    // Chromium's SVGGeometryElement API, including almost-axis-aligned lines.
    const ax = Math.fround(start.x), ay = Math.fround(start.y)
    const bx = Math.fround(end.x), by = Math.fround(end.y)
    const size = Math.hypot(bx - ax, by - ay)
    if (!size) return [undefined, undefined]
    const t = Math.min(0.1, size) / size
    return [
      Math.atan2(Math.fround(ay + (by - ay) * t) - ay, Math.fround(ax + (bx - ax) * t) - ax) * 180 / Math.PI,
      Math.atan2(by - Math.fround(by - (by - ay) * t), bx - Math.fround(bx - (bx - ax) * t)) * 180 / Math.PI,
    ]
  }
  const segment = (end: Point, startAngle: number | undefined, endAngle: number | undefined) => {
    firstPoint ??= point
    if (!first && startAngle !== undefined) first = { point: firstPoint, angle: startAngle }
    last = { point: end, angle: endAngle ?? last?.angle ?? 0 }
    point = end
  }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i]!)) command = tokens[i++]!
    const c = command.toUpperCase(), relative = c !== command
    if (c === 'Z') { segment(move, ...lineAngles(point, move)); command = ''; previous = c; continue }
    const count = c === 'A' ? 7 : c === 'C' ? 6 : c === 'S' || c === 'Q' ? 4 : c === 'H' || c === 'V' ? 1 : c === 'M' || c === 'L' || c === 'T' ? 2 : 0
    if (!count || i + count > tokens.length) throw new Error('Unsupported marker path data')
    const args = tokens.slice(i, i + count).map(Number)
    if (!args.every(Number.isFinite)) throw new Error('Unsupported marker path data')
    i += count
    const p = (index: number): Point => ({ x: args[index]! + (relative ? point.x : 0), y: args[index + 1]! + (relative ? point.y : 0) })
    const end = c === 'H' ? { x: args[0]! + (relative ? point.x : 0), y: point.y }
      : c === 'V' ? { x: point.x, y: args[0]! + (relative ? point.y : 0) } : p(count - 2)
    if (c === 'M') {
      point = end; move = end; firstPoint ??= end; command = relative ? 'l' : 'L'
    } else if (c === 'C' || c === 'S' || c === 'Q' || c === 'T') {
      const reflect = ((c === 'S' && ['C', 'S'].includes(previous)) || (c === 'T' && ['Q', 'T'].includes(previous)))
        ? { x: 2 * point.x - control.x, y: 2 * point.y - control.y } : point
      const c1 = c === 'S' || c === 'T' ? reflect : p(0)
      const c2 = c === 'C' ? p(2) : c === 'S' ? p(0) : c1
      segment(end, direction([point, c1, c2, end]), direction([end, c2, c1, point]) === undefined ? undefined : direction([end, c2, c1, point])! + 180)
      control = c2
    } else if (c === 'A' && args[0] && args[1] && (point.x !== end.x || point.y !== end.y)) {
      let rx = Math.abs(args[0]!), ry = Math.abs(args[1]!)
      const phi = args[2]! * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi)
      const dx = (point.x - end.x) / 2, dy = (point.y - end.y) / 2
      const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy
      const scale = Math.max(1, Math.hypot(xp / rx, yp / ry)); rx *= scale; ry *= scale
      const ratio = (xp / rx) ** 2 + (yp / ry) ** 2
      const factor = (args[3] === args[4] ? -1 : 1) * Math.sqrt(Math.max(0, (1 - ratio) / ratio))
      const cx = factor * rx * yp / ry, cy = -factor * ry * xp / rx
      const tangent = (x: number, y: number) => {
        const vx = -rx * y / ry, vy = ry * x / rx, sign = args[4] ? 1 : -1
        return Math.atan2(sign * (sin * vx + cos * vy), sign * (cos * vx - sin * vy)) * 180 / Math.PI
      }
      segment(end, tangent(xp - cx, yp - cy), tangent(-xp - cx, -yp - cy))
    } else segment(end, ...lineAngles(point, end))
    previous = c
  }
  const fallback = { point: firstPoint ?? point, angle: 0 }
  return [first ?? fallback, last ?? fallback]
}
