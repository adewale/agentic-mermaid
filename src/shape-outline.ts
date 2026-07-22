import type { Geometry } from './scene/ir.ts'
import { STROKE_WIDTHS } from './styles.ts'
import type { Point, PortSide, PositionedNode } from './types.ts'

/** Boundary consumed by routing. `envelope` is an explicit conservative
 * contract for open/decorated Bezier symbols; it is never presented as the
 * painted silhouette. */
export type ShapeRoutingBoundary =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'stadium'; cx: number; cy: number; halfWidth: number; radius: number }
  | { kind: 'cylinder'; cx: number; y: number; width: number; height: number; capRadiusY: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'envelope'; x: number; y: number; width: number; height: number; reason: string }
  | { kind: 'none'; reason: string }

export interface RenderedShapeOutline {
  geometry: Geometry
  crisp: string
  routing: ShapeRoutingBoundary
}

export interface ShapeCardinalPorts {
  N: Point
  E: Point
  S: Point
  W: Point
}

export type ShapeSideAttachment =
  | { kind: 'dynamic'; lo: number; hi: number; preferred: Point }
  | { kind: 'port'; point: Point; preferred: Point }
  | { kind: 'envelope'; lo: number; hi: number; preferred: Point }
  | { kind: 'none'; preferred: Point }

/** Routing and attachment are one declaration. Consumers may choose different
 * operations (paint, clip, lane proof), but cannot silently substitute a box
 * for an exact semantic outline. */
export interface ShapeRoutingProfile {
  boundary: ShapeRoutingBoundary
  sides: Readonly<Record<PortSide, ShapeSideAttachment>>
}

interface Paint { fill: string; stroke: string; strokeWidth: string }

const pointsText = (points: Point[]) => points.map(point => `${point.x},${point.y}`).join(' ')
const polygon = (points: Point[], paint: Paint): RenderedShapeOutline => ({
  geometry: { kind: 'polygon', points },
  crisp: `<polygon points="${pointsText(points)}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`,
  routing: { kind: 'polygon', points },
})
const path = (
  node: PositionedNode,
  d: string,
  paint: Paint,
  options: { fill?: 'normal' | 'none'; reason?: string } = {},
): RenderedShapeOutline => ({
  geometry: { kind: 'path', d },
  crisp: `<path d="${d}" fill="${options.fill === 'none' ? 'none' : paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`,
  routing: {
    kind: 'envelope', x: node.x, y: node.y, width: node.width, height: node.height,
    reason: options.reason ?? 'closed curved path uses a conservative routing envelope',
  },
})

/**
 * The single renderer/routing authority for flowchart and state node shapes.
 * Every output couples its Scene geometry, default SVG projection, and route
 * boundary so a new shape cannot silently update only one consumer.
 */
export function shapeOutline(
  node: PositionedNode,
  paint: Paint,
  cornerRadius?: number,
): RenderedShapeOutline {
  const semantic = semanticOutline(node, paint)
  if (semantic) return semantic
  const { x, y, width: w, height: h } = node
  const cx = x + w / 2, cy = y + h / 2
  switch (node.shape) {
    case 'diamond':
    case 'state-choice':
      // Retain the established arithmetic order so consolidating the authority
      // does not create meaningless floating-point SVG churn.
      return polygon([
        { x: cx, y: cy - h / 2 }, { x: cx + w / 2, y: cy },
        { x: cx, y: cy + h / 2 }, { x: cx - w / 2, y: cy },
      ], paint)
    case 'stadium': {
      const r = h / 2
      return {
        geometry: { kind: 'rect', x, y, width: w, height: h, rx: r, ry: r },
        crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`,
        routing: { kind: 'stadium', cx, cy, halfWidth: w / 2, radius: r },
      }
    }
    case 'circle':
    case 'state-history': return circle(cx, cy, Math.min(w, h) / 2, paint)
    case 'doublecircle': return doubleCircle(cx, cy, Math.min(w, h) / 2, paint)
    case 'hexagon': {
      const inset = h / 4
      return polygon([{ x: x + inset, y }, { x: x + w - inset, y }, { x: x + w, y: cy }, { x: x + w - inset, y: y + h }, { x: x + inset, y: y + h }, { x, y: cy }], paint)
    }
    case 'cylinder': return cylinder(x, y, w, h, paint)
    case 'asymmetric': return polygon([{ x: x + 12, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x: x + 12, y: y + h }, { x, y: cy }], paint)
    case 'trapezoid': {
      const inset = w * .15
      return polygon([{ x: x + inset, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x, y: y + h }], paint)
    }
    case 'trapezoid-alt': {
      const inset = w * .15
      return polygon([{ x, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x: x + inset, y: y + h }], paint)
    }
    case 'lean-r': {
      const inset = w * .15
      return polygon([{ x: x + inset, y }, { x: x + w, y }, { x: x + w - inset, y: y + h }, { x, y: y + h }], paint)
    }
    case 'lean-l': {
      const inset = w * .15
      return polygon([{ x, y }, { x: x + w - inset, y }, { x: x + w, y: y + h }, { x: x + inset, y: y + h }], paint)
    }
    case 'subroutine': return subroutine(x, y, w, h, paint, cornerRadius ?? 0)
    case 'state-start': return stateStart(cx, cy, Math.max(0, Math.min(w, h) / 2 - 2))
    case 'state-end': return stateEnd(cx, cy, Math.max(0, Math.min(w, h) / 2 - 2))
    case 'state-fork':
    case 'state-join': return stateBar(x, y, w, h)
    case 'rounded': return rect(x, y, w, h, paint, cornerRadius ?? 6)
    case 'service':
    case 'rectangle':
    default: return rect(x, y, w, h, paint, cornerRadius ?? 0)
  }
}

/**
 * Complete production routing profile. Exact boundaries expose only attachment
 * positions that lie on that boundary: straight side spans are dynamic,
 * curved/irregular sides use their cardinal point, and diamond facets retain a
 * bounded dynamic span. Envelopes and unenclosed text are explicit non-proofs.
 */
export function shapeRoutingProfile(node: PositionedNode): ShapeRoutingProfile {
  const boundary = shapeOutline(node, { fill: '', stroke: '', strokeWidth: '' }).routing
  const fallback = boxCardinalPorts(node)
  const sides = {} as Record<PortSide, ShapeSideAttachment>
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    const preferred = boundaryCardinalPoint(boundary, side) ?? fallback[side]
    if (boundary.kind === 'none') {
      sides[side] = { kind: 'none', preferred }
      continue
    }
    if (boundary.kind === 'envelope') {
      const [lo, hi] = crossBounds(boundary, side)
      sides[side] = { kind: 'envelope', lo, hi, preferred }
      continue
    }
    const dynamic = dynamicSideSpan(node, boundary, side)
    sides[side] = dynamic
      ? { kind: 'dynamic', ...dynamic, preferred }
      : { kind: 'port', point: preferred, preferred }
  }
  return { boundary, sides }
}

/** Cardinal-point projection used by ELK and certificate metadata. For
 * envelope/none policies these are layout fallbacks, not painted-outline
 * certificates; callers that need proof must inspect `shapeRoutingProfile`. */
export function shapeCardinalPorts(node: PositionedNode): ShapeCardinalPorts {
  const profile = shapeRoutingProfile(node)
  return {
    N: profile.sides.N.preferred,
    E: profile.sides.E.preferred,
    S: profile.sides.S.preferred,
    W: profile.sides.W.preferred,
  }
}

/** Exact point where one declared side meets an axis-aligned lane. */
export function pointOnShapeSide(
  profile: ShapeRoutingProfile,
  side: PortSide,
  crossCoordinate: number,
): Point | null {
  const attachment = profile.sides[side]
  if (attachment.kind === 'none') return null
  if (attachment.kind === 'port') return attachment.point
  const mainAxis = side === 'E' || side === 'W' ? 'x' : 'y'
  const positive = side === 'E' || side === 'S'
  return boundaryIntersection(profile.boundary, mainAxis, crossCoordinate, positive)
}

function boundaryCardinalPoint(boundary: ShapeRoutingBoundary, side: PortSide): Point | null {
  const bounds = routingBounds(boundary)
  if (!bounds) return null
  const mainAxis = side === 'E' || side === 'W' ? 'x' : 'y'
  const cross = mainAxis === 'x' ? (bounds.y + bounds.height / 2) : (bounds.x + bounds.width / 2)
  return boundaryIntersection(boundary, mainAxis, cross, side === 'E' || side === 'S')
}

function crossBounds(boundary: Exclude<ShapeRoutingBoundary, { kind: 'none' }>, side: PortSide): [number, number] {
  const bounds = routingBounds(boundary)!
  return side === 'E' || side === 'W'
    ? [bounds.y, bounds.y + bounds.height]
    : [bounds.x, bounds.x + bounds.width]
}

function dynamicSideSpan(
  node: PositionedNode,
  boundary: Exclude<ShapeRoutingBoundary, { kind: 'envelope' | 'none' }>,
  side: PortSide,
): { lo: number; hi: number } | null {
  const [crossLo, crossHi] = crossBounds(boundary, side)
  if (boundary.kind === 'rect') return insetSpan(crossLo, crossHi, 4)
  if (boundary.kind === 'stadium' && (side === 'N' || side === 'S')) {
    return insetSpan(boundary.cx - (boundary.halfWidth - boundary.radius), boundary.cx + (boundary.halfWidth - boundary.radius), 2)
  }
  if (boundary.kind === 'cylinder' && (side === 'E' || side === 'W')) {
    return insetSpan(boundary.y + boundary.capRadiusY, boundary.y + boundary.height - boundary.capRadiusY, 2)
  }
  if (boundary.kind !== 'polygon') return null

  const bounds = routingBounds(boundary)!
  const mainAxis = side === 'E' || side === 'W' ? 'x' : 'y'
  const extreme = mainAxis === 'x'
    ? (side === 'E' ? bounds.x + bounds.width : bounds.x)
    : (side === 'S' ? bounds.y + bounds.height : bounds.y)
  const flat: Array<[number, number]> = []
  for (let index = 0; index < boundary.points.length; index++) {
    const first = boundary.points[index]!
    const second = boundary.points[(index + 1) % boundary.points.length]!
    if (Math.abs(first[mainAxis] - extreme) > 1e-9 || Math.abs(second[mainAxis] - extreme) > 1e-9) continue
    const a = mainAxis === 'x' ? first.y : first.x
    const b = mainAxis === 'x' ? second.y : second.x
    flat.push([Math.min(a, b), Math.max(a, b)])
  }
  if (flat.length > 0) {
    const longest = flat.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]!
    return insetSpan(longest[0], longest[1], 2)
  }

  // A true diamond has no flat extreme side, but its facets intentionally
  // accept dynamic glue away from vertices. Semantic polygons that merely use
  // a diamond layout box do not qualify: the four boundary points themselves
  // must be the cardinal extrema.
  if (boundary.points.length === 4 && isCardinalDiamond(boundary.points, bounds)) {
    const size = crossHi - crossLo
    const margin = size <= 40 ? size / 4 : 10
    return insetSpan(crossLo, crossHi, margin)
  }
  return null
}

function insetSpan(lo: number, hi: number, margin: number): { lo: number; hi: number } | null {
  return hi - lo > margin * 2 ? { lo: lo + margin, hi: hi - margin } : null
}

function isCardinalDiamond(points: readonly Point[], bounds: { x: number; y: number; width: number; height: number }): boolean {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const expected = [
    { x: cx, y: bounds.y }, { x: bounds.x + bounds.width, y: cy },
    { x: cx, y: bounds.y + bounds.height }, { x: bounds.x, y: cy },
  ]
  return points.every(point => expected.some(candidate =>
    Math.abs(point.x - candidate.x) < 1e-8 && Math.abs(point.y - candidate.y) < 1e-8))
}

function routingBounds(boundary: ShapeRoutingBoundary): { x: number; y: number; width: number; height: number } | null {
  switch (boundary.kind) {
    case 'rect':
    case 'envelope': return { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height }
    case 'ellipse': return { x: boundary.cx - boundary.rx, y: boundary.cy - boundary.ry, width: boundary.rx * 2, height: boundary.ry * 2 }
    case 'stadium': return { x: boundary.cx - boundary.halfWidth, y: boundary.cy - boundary.radius, width: boundary.halfWidth * 2, height: boundary.radius * 2 }
    case 'cylinder': return { x: boundary.cx - boundary.width / 2, y: boundary.y, width: boundary.width, height: boundary.height }
    case 'polygon': {
      if (boundary.points.length === 0) return null
      const xs = boundary.points.map(point => point.x)
      const ys = boundary.points.map(point => point.y)
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    case 'none': return null
  }
}

function boundaryIntersection(
  boundary: ShapeRoutingBoundary,
  mainAxis: 'x' | 'y',
  cross: number,
  positive: boolean,
): Point | null {
  const choose = (values: number[]): number | null => values.length === 0 ? null : (positive ? Math.max(...values) : Math.min(...values))
  const point = (main: number): Point => mainAxis === 'x' ? { x: main, y: cross } : { x: cross, y: main }
  switch (boundary.kind) {
    case 'rect':
    case 'envelope': {
      const lo = mainAxis === 'x' ? boundary.y : boundary.x
      const hi = lo + (mainAxis === 'x' ? boundary.height : boundary.width)
      if (cross < lo - 1e-9 || cross > hi + 1e-9) return null
      return point(mainAxis === 'x'
        ? (positive ? boundary.x + boundary.width : boundary.x)
        : (positive ? boundary.y + boundary.height : boundary.y))
    }
    case 'ellipse': {
      const crossCenter = mainAxis === 'x' ? boundary.cy : boundary.cx
      const crossRadius = mainAxis === 'x' ? boundary.ry : boundary.rx
      const mainCenter = mainAxis === 'x' ? boundary.cx : boundary.cy
      const mainRadius = mainAxis === 'x' ? boundary.rx : boundary.ry
      if (crossRadius <= 0 || mainRadius <= 0) return null
      const scaled = (cross - crossCenter) / crossRadius
      if (Math.abs(scaled) > 1 + 1e-9) return null
      return point(mainCenter + (positive ? 1 : -1) * mainRadius * Math.sqrt(Math.max(0, 1 - scaled * scaled)))
    }
    case 'stadium': {
      if (mainAxis === 'x') {
        const dy = cross - boundary.cy
        if (Math.abs(dy) > boundary.radius + 1e-9) return null
        const main = (boundary.halfWidth - boundary.radius) + Math.sqrt(Math.max(0, boundary.radius ** 2 - dy ** 2))
        return point(boundary.cx + (positive ? main : -main))
      }
      const dx = Math.abs(cross - boundary.cx)
      if (dx > boundary.halfWidth + 1e-9) return null
      const capX = Math.max(0, dx - (boundary.halfWidth - boundary.radius))
      return point(boundary.cy + (positive ? 1 : -1) * Math.sqrt(Math.max(0, boundary.radius ** 2 - capX ** 2)))
    }
    case 'cylinder': {
      const halfWidth = boundary.width / 2
      const top = boundary.y + boundary.capRadiusY
      const bottom = boundary.y + boundary.height - boundary.capRadiusY
      if (mainAxis === 'x') {
        if (cross < boundary.y - 1e-9 || cross > boundary.y + boundary.height + 1e-9) return null
        const capCenter = cross < top ? top : cross > bottom ? bottom : cross
        const scaled = capCenter === cross ? 0 : (cross - capCenter) / boundary.capRadiusY
        return point(boundary.cx + (positive ? 1 : -1) * halfWidth * Math.sqrt(Math.max(0, 1 - scaled * scaled)))
      }
      const scaled = (cross - boundary.cx) / halfWidth
      if (Math.abs(scaled) > 1 + 1e-9) return null
      const span = boundary.capRadiusY * Math.sqrt(Math.max(0, 1 - scaled * scaled))
      return point(positive ? bottom + span : top - span)
    }
    case 'polygon': {
      const values: number[] = []
      for (let index = 0; index < boundary.points.length; index++) {
        const first = boundary.points[index]!
        const second = boundary.points[(index + 1) % boundary.points.length]!
        const firstCross = mainAxis === 'x' ? first.y : first.x
        const secondCross = mainAxis === 'x' ? second.y : second.x
        const firstMain = first[mainAxis], secondMain = second[mainAxis]
        const delta = secondCross - firstCross
        if (Math.abs(delta) < 1e-9) {
          if (Math.abs(cross - firstCross) < 1e-9) values.push(firstMain, secondMain)
          continue
        }
        const ratio = (cross - firstCross) / delta
        if (ratio >= -1e-9 && ratio <= 1 + 1e-9) values.push(firstMain + ratio * (secondMain - firstMain))
      }
      const main = choose(values)
      return main === null ? null : point(main)
    }
    case 'none': return null
  }
}

function boxCardinalPorts(box: { x: number; y: number; width: number; height: number }): ShapeCardinalPorts {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return {
    N: { x: cx, y: box.y }, E: { x: box.x + box.width, y: cy },
    S: { x: cx, y: box.y + box.height }, W: { x: box.x, y: cy },
  }
}

function semanticOutline(node: PositionedNode, paint: Paint): RenderedShapeOutline | null {
  const { x, y, width: w, height: h } = node
  const right = x + w, bottom = y + h, cx = x + w / 2, cy = y + h / 2
  switch (node.semanticShape) {
    case 'bang': return polygon(Array.from({ length: 16 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 8
      const radius = index % 2 === 0 ? 1 : .62
      return { x: cx + Math.cos(angle) * w / 2 * radius, y: cy + Math.sin(angle) * h / 2 * radius }
    }), paint)
    case 'notch-rect': return polygon([{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }], paint)
    case 'cloud': return path(node, `M${x + w * .18} ${bottom}C${x - 4} ${bottom} ${x - 4} ${cy} ${x + w * .12} ${cy}C${x + w * .08} ${y + h * .15} ${x + w * .38} ${y - 4} ${x + w * .48} ${y + h * .18}C${x + w * .65} ${y - 5} ${right} ${y + h * .16} ${x + w * .88} ${cy}C${right + 5} ${cy} ${right + 5} ${bottom} ${x + w * .72} ${bottom}Z`, paint)
    case 'hourglass': return polygon([{ x, y }, { x: right, y }, { x: x + w * .62, y: cy }, { x: right, y: bottom }, { x, y: bottom }, { x: x + w * .38, y: cy }], paint)
    case 'bolt': return polygon([{ x: x + w * .55, y }, { x: x + w * .25, y: cy }, { x: x + w * .48, y: cy }, { x: x + w * .35, y: bottom }, { x: x + w * .78, y: y + h * .4 }, { x: x + w * .55, y: y + h * .4 }], paint)
    case 'brace': return openPath(node, `M${right} ${y}C${x + w * .4} ${y} ${x + w * .7} ${cy} ${x} ${cy}C${x + w * .7} ${cy} ${x + w * .4} ${bottom} ${right} ${bottom}`, paint)
    case 'brace-r': return openPath(node, `M${x} ${y}C${x + w * .6} ${y} ${x + w * .3} ${cy} ${right} ${cy}C${x + w * .3} ${cy} ${x + w * .6} ${bottom} ${x} ${bottom}`, paint)
    case 'braces': return openPath(node, `M${x + w * .25} ${y}C${x} ${y} ${x + w * .15} ${cy} ${x} ${cy}C${x + w * .15} ${cy} ${x} ${bottom} ${x + w * .25} ${bottom}M${x + w * .75} ${y}C${right} ${y} ${x + w * .85} ${cy} ${right} ${cy}C${x + w * .85} ${cy} ${right} ${bottom} ${x + w * .75} ${bottom}`, paint)
    case 'datastore': return openPath(node, `M${x + 8} ${y}H${right}V${bottom}H${x + 8}M${x + 8} ${y}C${x - 2} ${y + h * .2} ${x - 2} ${bottom - h * .2} ${x + 8} ${bottom}`, paint)
    case 'delay': return path(node, `M${x} ${y}H${right - h / 2}A${h / 2} ${h / 2} 0 0 1 ${right - h / 2} ${bottom}H${x}Z`, paint)
    case 'h-cyl': return path(node, `M${x + 10} ${y}H${right - 10}A10 ${h / 2} 0 0 1 ${right - 10} ${bottom}H${x + 10}A10 ${h / 2} 0 0 1 ${x + 10} ${y}Z M${right - 10} ${y}A10 ${h / 2} 0 0 0 ${right - 10} ${bottom}`, paint)
    case 'lin-cyl': return path(node, `M${x} ${y + 8}A${w / 2} 8 0 0 1 ${right} ${y + 8}V${bottom - 8}A${w / 2} 8 0 0 1 ${x} ${bottom - 8}Z M${x} ${y + 8}A${w / 2} 8 0 0 0 ${right} ${y + 8}M${x} ${bottom - 16}A${w / 2} 8 0 0 0 ${right} ${bottom - 16}`, paint)
    case 'curv-trap': return path(node, `M${x + 12} ${y}Q${cx} ${y + 8} ${right - 12} ${y}L${right} ${bottom}Q${cx} ${bottom - 8} ${x} ${bottom}Z`, paint)
    case 'div-rect': return decoratedRect(node, `M${x} ${y}H${right}V${bottom}H${x}ZM${x} ${cy}H${right}`, paint)
    case 'doc': return path(node, `M${x} ${y}H${right}V${bottom - 8}Q${x + w * .75} ${bottom + 2} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 18} ${x} ${bottom - 8}Z`, paint)
    case 'tri': return polygon([{ x: cx, y }, { x: right, y: bottom }, { x, y: bottom }], paint)
    case 'fork': return solidRect(x, cy - 4, w, 8, paint.stroke, paint.strokeWidth)
    case 'win-pane': return decoratedRect(node, `M${x} ${y}H${right}V${bottom}H${x}ZM${x + w * .28} ${y}V${bottom}M${x} ${y + h * .32}H${right}`, paint)
    case 'f-circ': return solidCircle(cx, cy, Math.min(w, h) / 2, paint.stroke, paint.strokeWidth)
    case 'lin-doc': return path(node, `M${x} ${y}H${right}V${bottom - 8}Q${x + w * .75} ${bottom + 2} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 18} ${x} ${bottom - 8}ZM${x + 8} ${y + 8}H${right - 8}`, paint)
    case 'lin-rect': return decoratedRect(node, `M${x} ${y}H${right}V${bottom}H${x}ZM${x + 6} ${y}V${bottom}M${right - 6} ${y}V${bottom}`, paint)
    case 'notch-pent': return polygon([{ x, y }, { x: right - 10, y }, { x: right, y: cy }, { x: right - 10, y: bottom }, { x, y: bottom }, { x: x + 8, y: cy }], paint)
    case 'flip-tri': return polygon([{ x, y }, { x: right, y }, { x: cx, y: bottom }], paint)
    case 'docs': return path(node, `M${x + 8} ${y}H${right}V${bottom - 8}Q${x + w * .7} ${bottom} ${x + w * .45} ${bottom - 8}Q${x + w * .22} ${bottom - 16} ${x + 8} ${bottom - 8}ZM${x} ${y + 8}H${x + 8}M${x} ${y + 8}V${bottom}`, paint)
    case 'st-rect': return path(node, `M${x + 8} ${y}H${right}V${bottom - 8}H${x + 8}ZM${x} ${y + 8}H${right - 8}V${bottom}H${x}Z`, paint)
    case 'flag': return path(node, `M${x} ${y + 6}Q${x + w * .25} ${y - 4} ${cx} ${y + 6}Q${x + w * .75} ${y + 16} ${right} ${y + 6}V${bottom - 6}Q${x + w * .75} ${bottom + 4} ${cx} ${bottom - 6}Q${x + w * .25} ${bottom - 16} ${x} ${bottom - 6}Z`, paint)
    case 'sm-circ': return circle(cx, cy, Math.min(w, h) * .22, paint)
    case 'cross-circ': {
      const outline = path(node, `M${cx} ${y}A${w / 2} ${h / 2} 0 1 1 ${cx - .01} ${y}M${x + w * .28} ${y + h * .28}L${x + w * .72} ${y + h * .72}M${x + w * .72} ${y + h * .28}L${x + w * .28} ${y + h * .72}`, paint)
      outline.routing = { kind: 'ellipse', cx, cy, rx: w / 2, ry: h / 2 }
      return outline
    }
    case 'bow-rect': return path(node, `M${x} ${y}Q${x + 12} ${cy} ${x} ${bottom}H${right}Q${right - 12} ${cy} ${right} ${y}Z`, paint)
    case 'tag-doc': return path(node, `M${x + 10} ${y}H${right}V${bottom - 8}Q${x + w * .7} ${bottom} ${cx} ${bottom - 8}Q${x + w * .25} ${bottom - 16} ${x} ${bottom - 8}V${y + 10}ZM${x} ${y + 10}L${x + 10} ${y}`, paint)
    case 'tag-rect': return polygon([{ x: x + 10, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom }, { x, y: y + 10 }], paint)
    case 'text': return { geometry: { kind: 'path', d: `M${x} ${y}` }, crisp: `<path d="M${x} ${y}" fill="none" stroke="none" />`, routing: { kind: 'none', reason: 'text blocks have no painted enclosure' } }
    default: return null
  }
}

function rect(x: number, y: number, w: number, h: number, paint: Paint, radius: number): RenderedShapeOutline {
  return {
    geometry: { kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius },
    crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`,
    routing: { kind: 'rect', x, y, width: w, height: h },
  }
}
function circle(cx: number, cy: number, r: number, paint: Paint): RenderedShapeOutline {
  return { geometry: { kind: 'circle', cx, cy, r }, crisp: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`, routing: { kind: 'ellipse', cx, cy, rx: r, ry: r } }
}
function solidCircle(cx: number, cy: number, r: number, color: string, strokeWidth: string): RenderedShapeOutline {
  return { geometry: { kind: 'circle', cx, cy, r }, crisp: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="${color}" stroke-width="${strokeWidth}" />`, routing: { kind: 'ellipse', cx, cy, rx: r, ry: r } }
}
function doubleCircle(cx: number, cy: number, outerR: number, paint: Paint): RenderedShapeOutline {
  const innerR = Math.max(0, outerR - 5)
  return { geometry: { kind: 'compound', children: [{ kind: 'circle', cx, cy, r: outerR }, { kind: 'circle', cx, cy, r: innerR }] }, crisp: `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`, routing: { kind: 'ellipse', cx, cy, rx: outerR, ry: outerR } }
}
function subroutine(x: number, y: number, w: number, h: number, paint: Paint, radius: number): RenderedShapeOutline {
  const inset = 8
  return { geometry: { kind: 'compound', children: [{ kind: 'rect', x, y, width: w, height: h, rx: radius, ry: radius }, { kind: 'line', x1: x + inset, y1: y, x2: x + inset, y2: y + h }, { kind: 'line', x1: x + w - inset, y1: y, x2: x + w - inset, y2: y + h }] }, crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<line x1="${x + inset}" y1="${y}" x2="${x + inset}" y2="${y + h}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<line x1="${x + w - inset}" y1="${y}" x2="${x + w - inset}" y2="${y + h}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`, routing: { kind: 'rect', x, y, width: w, height: h } }
}
function cylinder(x: number, y: number, w: number, h: number, paint: Paint): RenderedShapeOutline {
  const ry = 7, cx = x + w / 2, bodyTop = y + ry, bodyH = h - 2 * ry
  return { geometry: { kind: 'compound', children: [{ kind: 'rect', x, y: bodyTop, width: w, height: bodyH }, { kind: 'line', x1: x, y1: bodyTop, x2: x, y2: bodyTop + bodyH }, { kind: 'line', x1: x + w, y1: bodyTop, x2: x + w, y2: bodyTop + bodyH }, { kind: 'ellipse', cx, cy: y + h - ry, rx: w / 2, ry }, { kind: 'ellipse', cx, cy: bodyTop, rx: w / 2, ry }] }, crisp: `<rect x="${x}" y="${bodyTop}" width="${w}" height="${bodyH}" fill="${paint.fill}" stroke="none" />\n<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<line x1="${x + w}" y1="${bodyTop}" x2="${x + w}" y2="${bodyTop + bodyH}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />\n<ellipse cx="${cx}" cy="${bodyTop}" rx="${w / 2}" ry="${ry}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="${paint.strokeWidth}" />`, routing: { kind: 'cylinder', cx, y, width: w, height: h, capRadiusY: ry } }
}
function stateStart(cx: number, cy: number, r: number): RenderedShapeOutline {
  return { geometry: { kind: 'circle', cx, cy, r }, crisp: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--_text)" stroke="none" />`, routing: { kind: 'ellipse', cx, cy, rx: r, ry: r } }
}
function stateEnd(cx: number, cy: number, outerR: number): RenderedShapeOutline {
  const innerR = Math.max(0, outerR - 4)
  return { geometry: { kind: 'compound', children: [{ kind: 'circle', cx, cy, r: outerR }, { kind: 'circle', cx, cy, r: innerR }] }, crisp: `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--_text)" stroke="none" />`, routing: { kind: 'ellipse', cx, cy, rx: outerR, ry: outerR } }
}
function stateBar(x: number, y: number, w: number, h: number): RenderedShapeOutline {
  const r = Math.min(w, h) / 2
  return { geometry: { kind: 'rect', x, y, width: w, height: h, rx: r, ry: r }, crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="var(--_text)" stroke="none" />`, routing: { kind: 'rect', x, y, width: w, height: h } }
}
function solidRect(x: number, y: number, w: number, h: number, color: string, strokeWidth: string): RenderedShapeOutline {
  return { geometry: { kind: 'rect', x, y, width: w, height: h }, crisp: `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" stroke="${color}" stroke-width="${strokeWidth}" />`, routing: { kind: 'rect', x, y, width: w, height: h } }
}
function openPath(node: PositionedNode, d: string, paint: Paint): RenderedShapeOutline {
  const value = path(node, d, paint, { fill: 'none', reason: 'open symbol has no enclosing painted boundary' })
  value.routing = { kind: 'envelope', x: node.x, y: node.y, width: node.width, height: node.height, reason: 'open symbol routes to its layout envelope' }
  return value
}
function decoratedRect(node: PositionedNode, d: string, paint: Paint): RenderedShapeOutline {
  const value = path(node, d, paint)
  value.routing = { kind: 'rect', x: node.x, y: node.y, width: node.width, height: node.height }
  return value
}
