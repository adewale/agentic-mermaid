import type { Geometry, MarkPaint, MarkerDescriptor, ScenePoint } from './ir.ts'

/** Private exact arithmetic for a fresh, actually written five-piece body and
 * a closed opaque triangular marker. The caller must establish that a fill
 * witness survives its own stroke: absent stroke or the same opaque RGBA.
 * Actual occurrence, source/write/context identity and all other paint remain
 * caller obligations. This proves only the attached contact. */
export interface ExactCompoundMarkerPose {
  readonly marker: MarkerDescriptor
  readonly anchor: ScenePoint
  readonly tangent: ScenePoint
  readonly position: 'start' | 'end'
  readonly width: string | number
}

type Point = { x: bigint; y: bigint }
type Rect = { kind: 'rect'; x: bigint; y: bigint; width: bigint; height: bigint }
type Line = { kind: 'line'; x1: bigint; y1: bigint; x2: bigint; y2: bigint }
type Ellipse = { kind: 'ellipse'; cx: bigint; cy: bigint; rx: bigint; ry: bigint }
const SCALE = 4_000_000_000_000_000_000n
const COORDINATE_LIMIT = 1_000_000n * SCALE
const INTEGER_LIMIT = 1n << 1536n
const STOP = Symbol('unsupported-exact-contact')

export function exactCompoundContact(
  geometry: Geometry, paints: readonly MarkPaint[], pose: ExactCompoundMarkerPose,
  opaque: (value: string | undefined) => boolean,
  clear: (point: ScenePoint) => boolean, work: () => boolean,
): ScenePoint | undefined {
  const pay = (count: number): void => { for (let i = 0; i < count; i++) if (!work()) throw STOP }
  const bounded = (value: bigint): bigint => { if (value <= -INTEGER_LIMIT || value >= INTEGER_LIMIT) throw STOP; return value }
  const add = (a: bigint, b: bigint): bigint => { pay(1); return bounded(a + b) }
  const sub = (a: bigint, b: bigint): bigint => { pay(1); return bounded(a - b) }
  const mul = (a: bigint, b: bigint): bigint => { pay(4); return bounded(a * b) }
  const abs = (value: bigint): bigint => value < 0n ? -value : value
  const decimal = (value: string | number, places = 12): bigint => {
    const text = String(value)
    pay(text.length * 2 + 8)
    if (text.length > 48) throw STOP
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?(?:px)?$/i.exec(text)
    if (!match) throw STOP
    const fraction = match[3] ?? match[4] ?? '', exponent = Number(match[5] ?? 0)
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 24) throw STOP
    let digits = (match[2] ?? '0') + fraction, power = exponent - fraction.length
    // Redundant zeroes do not enlarge the exact decimal domain.
    while (power < 0 && digits.endsWith('0')) { pay(1); digits = digits.slice(0, -1); power++ }
    if (power < -places || power > 6) throw STOP
    const denominator = power < 0 ? 10n ** BigInt(-power) : 1n
    const numerator = BigInt(digits) * (power > 0 ? 10n ** BigInt(power) : 1n)
    const scaled = numerator * (SCALE / denominator) * (match[1] === '-' ? -1n : 1n)
    if (abs(scaled) > COORDINATE_LIMIT) throw STOP
    return scaled
  }
  const point = (p: ScenePoint): Point => ({ x: decimal(p.x), y: decimal(p.y) })
  const cross = (a: Point, b: Point, c: Point): bigint => sub(mul(sub(b.x, a.x), sub(c.y, a.y)), mul(sub(b.y, a.y), sub(c.x, a.x)))
  const hull = (input: readonly Point[]): Point[] => {
    pay(input.length * 2 + 4)
    if (input.length > 64) throw STOP
    const sorted = [...input].sort((a, b) => { pay(2); return a.x < b.x ? -1 : a.x > b.x ? 1 : a.y < b.y ? -1 : a.y > b.y ? 1 : 0 })
    const unique: Point[] = []
    for (const p of sorted) { pay(1); const last = unique.at(-1); if (!last || p.x !== last.x || p.y !== last.y) unique.push(p) }
    if (unique.length < 3) throw STOP
    const chain = (points: readonly Point[]): Point[] => {
      const result: Point[] = []
      for (const p of points) {
        pay(1)
        while (result.length >= 2 && cross(result[result.length - 2]!, result.at(-1)!, p) <= 0n) result.pop()
        result.push(p)
      }
      result.pop()
      return result
    }
    return [...chain(unique), ...chain([...unique].reverse())]
  }
  const floor = (numerator: bigint, denominator: bigint): bigint => {
    pay(4)
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator }
    if (!denominator) throw STOP
    const quotient = numerator / denominator
    return numerator < 0n && numerator % denominator ? quotient - 1n : quotient
  }
  const ceil = (numerator: bigint, denominator: bigint): bigint => -floor(-numerator, denominator)
  // Each intersection is enclosed by its two adjacent grid points. Taking
  // their convex hull expands the exact clipped polygon; inputs never round.
  const clip = (polygon: readonly Point[], axis: 'x' | 'y', boundary: bigint, low: boolean): Point[] => {
    const result: Point[] = [], other = axis === 'x' ? 'y' : 'x'
    for (let i = 0; i < polygon.length; i++) {
      pay(4)
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!
      const aa = low ? a[axis] >= boundary : a[axis] <= boundary, bb = low ? b[axis] >= boundary : b[axis] <= boundary
      if (aa) { if (result.length >= 64) throw STOP; result.push(a) }
      if (aa !== bb) {
        const denominator = sub(b[axis], a[axis])
        const numerator = add(mul(a[other], denominator), mul(sub(boundary, a[axis]), sub(b[other], a[other])))
        const lo = floor(numerator, denominator), hi = ceil(numerator, denominator)
        if (result.length >= 64) throw STOP
        result.push({ [axis]: boundary, [other]: lo } as Point)
        if (hi !== lo) { if (result.length >= 64) throw STOP; result.push({ [axis]: boundary, [other]: hi } as Point) }
      }
    }
    return hull(result)
  }
  const project = (p: Point, origin: Point, normal: Point): bigint => add(mul(sub(p.x, origin.x), normal.x), mul(sub(p.y, origin.y), normal.y))
  const separated = (a: readonly Point[], b: readonly Point[], strict: boolean): boolean => {
    for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
      pay(2)
      const origin = polygon[i]!, next = polygon[(i + 1) % polygon.length]!, normal = { x: sub(next.y, origin.y), y: sub(origin.x, next.x) }
      if (normal.x === 0n && normal.y === 0n) continue
      pay((a.length + b.length) * 2 + 4)
      const av = a.map(p => project(p, origin, normal)), bv = b.map(p => project(p, origin, normal))
      const min = (values: readonly bigint[]): bigint => values.reduce((a, b) => a < b ? a : b)
      const max = (values: readonly bigint[]): bigint => values.reduce((a, b) => a > b ? a : b)
      if (strict ? max(av) < min(bv) || max(bv) < min(av) : max(av) <= min(bv) || max(bv) <= min(av)) return true
    }
    return false
  }
  const rectPoints = (x0: bigint, y0: bigint, x1: bigint, y1: bigint): Point[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  const pointOutsideRect = (p: Point, rectangle: readonly Point[]): boolean => {
    pay(8)
    const low = rectangle[0]!, high = rectangle[2]!
    return p.x < low.x || p.x > high.x || p.y < low.y || p.y > high.y
  }
  const separatedRect = (polygon: readonly Point[], rectangle: readonly Point[]): boolean => {
    pay(8)
    if (!polygon.length) return false
    const low = rectangle[0]!, high = rectangle[2]!
    let left = true, right = true, above = true, below = true
    for (const p of polygon) {
      pay(5)
      left &&= p.x <= low.x
      right &&= p.x >= high.x
      above &&= p.y <= low.y
      below &&= p.y >= high.y
    }
    return left || right || above || below || separated(polygon, rectangle, false)
  }
  // m >= sqrt(a)-h*sqrt(b), without rounding a square root. m>=0 is
  // essential before squaring. Every arithmetic operation is exact/bounded.
  const ellipsePlane = (m: bigint, a: bigint, b: bigint, h: bigint, outsideStroke: boolean): boolean => {
    if (m < 0n) return false
    const mm = mul(m, m), hhB = mul(mul(h, h), b)
    if (outsideStroke) {
      const d = sub(sub(mm, a), hhB)
      return d > 0n && mul(d, d) > mul(4n, mul(a, hhB))
    }
    if (mm >= a) return true
    const d = sub(sub(a, mm), hhB)
    return d <= 0n || mul(d, d) <= mul(4n, mul(mm, hhB))
  }
  const ellipseOutside = (ellipse: Ellipse, polygon: readonly Point[], anchor: Point, halfWidth: bigint, outsideStroke: boolean): boolean => {
    const center = { x: ellipse.cx, y: ellipse.cy }, normals: Point[] = [{ x: 1n, y: 0n }, { x: -1n, y: 0n }, { x: 0n, y: 1n }, { x: 0n, y: -1n }]
    const rx2 = mul(ellipse.rx, ellipse.rx), ry2 = mul(ellipse.ry, ellipse.ry)
    for (let index = 0; index < normals.length + polygon.length + 1; index++) {
      pay(4)
      let normal: Point
      if (index < normals.length) normal = normals[index]!
      else {
        const p = index === normals.length ? anchor : polygon[index - normals.length - 1]!
        normal = { x: mul(sub(p.x, ellipse.cx), ry2), y: mul(sub(p.y, ellipse.cy), rx2) }
      }
      if (!normal.x && !normal.y) continue
      const nx2 = mul(normal.x, normal.x), ny2 = mul(normal.y, normal.y)
      const a = add(mul(rx2, nx2), mul(ry2, ny2)), b = add(nx2, ny2)
      if (polygon.every(p => ellipsePlane(project(p, center, normal), a, b, halfWidth, outsideStroke))) return true
    }
    return false
  }
  const one = (value: string | undefined): boolean => value === undefined || decimal(value) === SCALE
  const simplePaint = (paint: MarkPaint): boolean => {
    pay(16)
    return one(paint.opacity) && one(paint.fillOpacity) && one(paint.strokeOpacity)
      && paint.strokeDasharray === undefined && paint.strokeDashoffset === undefined
      && (paint.vectorEffect === undefined || paint.vectorEffect === 'none')
      && (paint.paintOrder === undefined || paint.paintOrder === 'normal')
      && (paint.strokeLinecap === undefined || ['butt', 'round', 'square'].includes(paint.strokeLinecap))
  }
  try {
    pay(32)
    if (geometry.kind !== 'compound' || geometry.children.length !== 5 || paints.length !== 5) return undefined
    const [rawBody, rawLeft, rawRight, rawBottom, rawTop] = geometry.children
    if (rawBody?.kind !== 'rect' || rawLeft?.kind !== 'line' || rawRight?.kind !== 'line' || rawBottom?.kind !== 'ellipse' || rawTop?.kind !== 'ellipse'
      || (rawBody.rx ?? 0) !== 0 || (rawBody.ry ?? 0) !== 0) return undefined
    const body: Rect = { kind: 'rect', x: decimal(rawBody.x), y: decimal(rawBody.y), width: decimal(rawBody.width), height: decimal(rawBody.height) }
    const line = (g: typeof rawLeft): Line => ({ kind: 'line', x1: decimal(g.x1), y1: decimal(g.y1), x2: decimal(g.x2), y2: decimal(g.y2) })
    const ellipse = (g: typeof rawTop): Ellipse => ({ kind: 'ellipse', cx: decimal(g.cx), cy: decimal(g.cy), rx: decimal(g.rx), ry: decimal(g.ry) })
    const left = line(rawLeft), right = line(rawRight), bottom = ellipse(rawBottom), top = ellipse(rawTop)
    if (body.width <= 0n || body.height <= 0n || bottom.rx <= 0n || bottom.ry <= 0n || top.rx <= 0n || top.ry <= 0n
      || left.x1 !== left.x2 || right.x1 !== right.x2 || left.x1 !== body.x || right.x1 !== add(body.x, body.width)) return undefined
    const widths: bigint[] = []
    for (let i = 0; i < 5; i++) {
      const paint = paints[i]!
      if (!simplePaint(paint) || (i === 0 || i >= 3) && !opaque(paint.fill)) return undefined
      if (i === 0) { if (paint.stroke !== 'none') return undefined; widths.push(0n) }
      else { if (!opaque(paint.stroke)) return undefined; const w = decimal(paint.strokeWidth ?? '1'); if (w <= 0n) return undefined; widths.push(w) }
    }
    const marker = pose.marker, markerPaint = marker.paint, rawTriangle = marker.geometry
    if (!markerPaint || !simplePaint(markerPaint) || !opaque(markerPaint.fill) || rawTriangle?.kind !== 'polygon' || rawTriangle.points.length !== 3
      || !marker.size || !marker.ref || marker.scale !== undefined && marker.scale !== 1
      || marker.units !== undefined && marker.units !== 'strokeWidth' && marker.units !== 'userSpaceOnUse'
      || marker.orient !== undefined && marker.orient !== 'auto' && marker.orient !== 'auto-start-reverse'
      || marker.overflow !== undefined && marker.overflow !== 'hidden') return undefined
    const triangle = rawTriangle.points.map(point), size = { x: decimal(marker.size.width), y: decimal(marker.size.height) }, ref = point(marker.ref), anchor = point(pose.anchor)
    if (size.x <= 0n || size.y <= 0n || cross(triangle[0]!, triangle[1]!, triangle[2]!) === 0n) return undefined
    if (marker.viewBox && (decimal(marker.viewBox.x) !== 0n || decimal(marker.viewBox.y) !== 0n || decimal(marker.viewBox.width) !== size.x || decimal(marker.viewBox.height) !== size.y)) return undefined
    const tx = pose.tangent.x, ty = pose.tangent.y
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || Math.abs(tx) > 1e6 || Math.abs(ty) > 1e6
      || tx !== 0 && ty !== 0 || tx === 0 && ty === 0) return undefined
    // Every nonzero cardinal vector has exactly the same orientation as its
    // sign. This does not normalize or round a material paint coordinate.
    let dx = tx > 0 ? 1n : tx < 0 ? -1n : 0n, dy = ty > 0 ? 1n : ty < 0 ? -1n : 0n
    if (pose.position === 'start' && marker.orient === 'auto-start-reverse') { dx = -dx; dy = -dy }
    const width = marker.units === 'userSpaceOnUse' ? SCALE : decimal(pose.width)
    if (width <= 0n) return undefined
    const stroke = markerPaint.stroke === undefined || markerPaint.stroke === 'none' ? 0n : decimal(markerPaint.strokeWidth ?? '1')
    if (stroke < 0n || stroke && markerPaint.strokeLinejoin !== 'round' && markerPaint.strokeLinejoin !== 'bevel') return undefined
    const r = stroke / 2n, half = r / 2n
    // x/y <=r and |x|+|y|<=3r/2 circumscribe the radius-r disk:
    // diagonal edge distance is3r/(2sqrt(2))>r. This contains convex ROUND
    // and BEVEL joins. Unsupported MITER joins receive no new authority.
    const octagon: Point[] = [{ x: r, y: half }, { x: half, y: r }, { x: -half, y: r }, { x: -r, y: half }, { x: -r, y: -half }, { x: -half, y: -r }, { x: half, y: -r }, { x: r, y: -half }]
    const sums: Point[] = []
    for (const p of triangle) for (const q of octagon) { pay(2); sums.push({ x: add(p.x, q.x), y: add(p.y, q.y) }) }
    let outer = hull(sums)
    for (const [axis, boundary, low] of [['x', 0n, true], ['x', size.x, false], ['y', 0n, true], ['y', size.y, false]] as const) outer = clip(outer, axis, boundary, low)
    const world: Point[] = []
    for (const p of outer) {
      const x = add(mul(anchor.x, SCALE), mul(sub(mul(dx, sub(p.x, ref.x)), mul(dy, sub(p.y, ref.y))), width))
      const y = add(mul(anchor.y, SCALE), mul(add(mul(dy, sub(p.x, ref.x)), mul(dx, sub(p.y, ref.y))), width))
      const x0 = floor(x, SCALE), x1 = ceil(x, SCALE), y0 = floor(y, SCALE), y1 = ceil(y, SCALE)
      if ([x0, x1, y0, y1].some(v => abs(v) > COORDINATE_LIMIT)) return undefined
      if (world.length > 60) throw STOP
      pay(2)
      const wide = x0 !== x1, tall = y0 !== y1
      world.push({ x: x0, y: y0 })
      if (wide) world.push({ x: x1, y: y0 })
      if (tall) {
        if (wide) world.push({ x: x1, y: y1 })
        world.push({ x: x0, y: y1 })
      }
    }
    const ink = hull(world), bodyPoints = rectPoints(body.x, body.y, add(body.x, body.width), add(body.y, body.height))
    const lineBox = (g: Line, w: bigint): Point[] => rectPoints(sub(g.x1, w / 2n), sub(g.y1 < g.y2 ? g.y1 : g.y2, w / 2n), add(g.x1, w / 2n), add(g.y1 > g.y2 ? g.y1 : g.y2, w / 2n))
    const leftBox = lineBox(left, widths[1]!), rightBox = lineBox(right, widths[2]!)
    const sideContact = (g: Line, isLeft: boolean): boolean => anchor.x === g.x1 && anchor.y >= (g.y1 < g.y2 ? g.y1 : g.y2) && anchor.y <= (g.y1 > g.y2 ? g.y1 : g.y2)
      && ink.every(p => { pay(1); return isLeft ? p.x <= g.x1 : p.x >= g.x1 })
    if (!separatedRect(ink, bodyPoints)
      || !sideContact(left, true) && !separatedRect(ink, leftBox)
      || !sideContact(right, false) && !separatedRect(ink, rightBox)
      || !ellipseOutside(bottom, ink, anchor, widths[3]! / 2n, false)
      || !ellipseOutside(top, ink, anchor, widths[4]! / 2n, false)) return undefined
    const orientation = cross(triangle[0]!, triangle[1]!, triangle[2]!) > 0n ? 1n : -1n
    const inside = (candidate: Point): boolean => {
      const qx = sub(candidate.x, anchor.x), qy = sub(candidate.y, anchor.y)
      const x = add(mul(ref.x, width), mul(add(mul(dx, qx), mul(dy, qy)), SCALE))
      const y = add(mul(ref.y, width), mul(sub(mul(dx, qy), mul(dy, qx)), SCALE))
      if (x <= 0n || y <= 0n || x >= mul(size.x, width) || y >= mul(size.y, width)) return false
      return triangle.every((a, i) => {
        const b = triangle[(i + 1) % 3]!
        return mul(orientation, sub(mul(sub(b.x, a.x), sub(y, mul(a.y, width))), mul(sub(b.y, a.y), sub(x, mul(a.x, width))))) > 0n
      })
    }
    const centroid = { x: add(add(triangle[0]!.x, triangle[1]!.x), triangle[2]!.x), y: add(add(triangle[0]!.y, triangle[1]!.y), triangle[2]!.y) }
    for (const denominator of [8n, 4n, 2n]) for (const vertex of triangle) {
      pay(8)
      // This rounds only the CHOICE of a candidate, not any paint geometry.
      // The resulting finite point must independently pass exact interior,
      // viewport, all-five-piece/full-stroke and caller-wide paint checks.
      const lx = add(centroid.x, mul(3n * (denominator - 1n), vertex.x)), ly = add(centroid.y, mul(3n * (denominator - 1n), vertex.y))
      const divisor = 3n * denominator
      const wx = add(mul(mul(anchor.x, SCALE), divisor), mul(sub(mul(dx, sub(lx, mul(ref.x, divisor))), mul(dy, sub(ly, mul(ref.y, divisor)))), width))
      const wy = add(mul(mul(anchor.y, SCALE), divisor), mul(add(mul(dy, sub(lx, mul(ref.x, divisor))), mul(dx, sub(ly, mul(ref.y, divisor)))), width))
      const choiceScale = 1_000_000_000n, common = mul(mul(SCALE, SCALE), divisor)
      const x = Number(floor(mul(wx, choiceScale), common)) / 1e9, y = Number(floor(mul(wy, choiceScale), common)) / 1e9
      const candidate = { x: decimal(x), y: decimal(y) }
      if (!inside(candidate) || !pointOutsideRect(candidate, bodyPoints) || !pointOutsideRect(candidate, leftBox) || !pointOutsideRect(candidate, rightBox)
        || !ellipseOutside(bottom, [candidate], anchor, widths[3]! / 2n, true) || !ellipseOutside(top, [candidate], anchor, widths[4]! / 2n, true)) continue
      const result = { x, y }
      if (clear(result)) return result
    }
    return undefined
  } catch (error) {
    if (error === STOP) return undefined
    throw error
  }
}
