import type {
  ConnectorContourSemantics,
  ConnectorGeometry,
  ConnectorSubpath,
  ScenePoint,
} from './ir.ts'

/** Compare two connector-space points. A tolerance is useful only when a
 * normalized tangent has passed through independent floating-point work; route
 * vertices remain exact by default. */
export function sameConnectorPoint(left: ScenePoint, right: ScenePoint, tolerance = 0): boolean {
  return Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance
}

/** Unit direction from one route point to another. Keeping this beside the
 * connector geometry helpers lets curve lowerings publish exact endpoint
 * tangents while their flattened route remains an approximation. */
export function connectorUnitTangent(from: ScenePoint, to: ScenePoint): ScenePoint | undefined {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return Number.isFinite(length) && length > 0
    ? { x: dx / length, y: dy / length }
    : undefined
}

function midpoint(left: ScenePoint, right: ScenePoint): ScenePoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

function distance(left: ScenePoint, right: ScenePoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function distanceToChord(point: ScenePoint, start: ScenePoint, end: ScenePoint): number {
  const chord = distance(start, end)
  if (chord === 0) return distance(point, start)
  return Math.abs(
    (end.x - start.x) * (start.y - point.y)
    - (start.x - point.x) * (end.y - start.y),
  ) / chord
}

/**
 * Deterministically flatten one cubic Bezier into the routed polyline required
 * by ConnectorGeometry. The perpendicular-error check preserves curved
 * contours; the control-polygon excess check also preserves collinear curves
 * that double back beyond an endpoint.
 */
export function flattenCubicBezier(
  start: ScenePoint,
  control1: ScenePoint,
  control2: ScenePoint,
  end: ScenePoint,
  tolerance = 0.5,
  maxDepth = 12,
): ScenePoint[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new TypeError('Cubic flattening tolerance must be positive and finite')
  }
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new TypeError('Cubic flattening maxDepth must be a non-negative safe integer')
  }
  for (const point of [start, control1, control2, end]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('Cubic flattening points must be finite')
    }
  }

  const routed: ScenePoint[] = [{ ...start }]
  const flatten = (
    p0: ScenePoint,
    p1: ScenePoint,
    p2: ScenePoint,
    p3: ScenePoint,
    depth: number,
  ): void => {
    const chord = distance(p0, p3)
    const controlExcess = distance(p0, p1) + distance(p1, p2) + distance(p2, p3) - chord
    const flat = Math.max(distanceToChord(p1, p0, p3), distanceToChord(p2, p0, p3)) <= tolerance
      && controlExcess <= tolerance
    if (flat || depth >= maxDepth) {
      routed.push({ ...p3 })
      return
    }

    // de Casteljau subdivision at t=0.5 is stable, deterministic, and keeps
    // the two child cubics exactly on the authored curve.
    const p01 = midpoint(p0, p1)
    const p12 = midpoint(p1, p2)
    const p23 = midpoint(p2, p3)
    const p012 = midpoint(p01, p12)
    const p123 = midpoint(p12, p23)
    const split = midpoint(p012, p123)
    flatten(p0, p01, p012, split, depth + 1)
    flatten(split, p123, p23, p3, depth + 1)
  }
  flatten(start, control1, control2, end, 0)
  return routed
}

/** One authored SVG path segment. Lowerings retain control points here so the
 * scene projection can flatten visible ink and publish exact endpoint
 * tangents without asking consumers to parse SVG path data. */
export type ConnectorPathProjectionSegment =
  | { readonly kind: 'line'; readonly end: ScenePoint }
  | { readonly kind: 'quadratic'; readonly control: ScenePoint; readonly end: ScenePoint }
  | {
      readonly kind: 'cubic'
      readonly control1: ScenePoint
      readonly control2: ScenePoint
      readonly end: ScenePoint
    }

export interface ConnectorPathProjection {
  readonly geometry: Extract<ConnectorGeometry, { kind: 'path' }>
  readonly contours: readonly ConnectorContourSemantics[]
}

function firstTangent(...points: readonly ScenePoint[]): ScenePoint | undefined {
  const origin = points[0]
  if (!origin) return undefined
  for (let index = 1; index < points.length; index++) {
    const tangent = connectorUnitTangent(origin, points[index]!)
    if (tangent) return tangent
  }
  return undefined
}

function segmentStartTangent(
  start: ScenePoint,
  segment: ConnectorPathProjectionSegment,
): ScenePoint | undefined {
  if (segment.kind === 'line') return firstTangent(start, segment.end)
  if (segment.kind === 'quadratic') return firstTangent(start, segment.control, segment.end)
  return firstTangent(start, segment.control1, segment.control2, segment.end)
}

function segmentEndTangent(
  start: ScenePoint,
  segment: ConnectorPathProjectionSegment,
): ScenePoint | undefined {
  if (segment.kind === 'line') return firstTangent(start, segment.end)
  if (segment.kind === 'quadratic') return firstTangent(segment.control, segment.end)
    ?? firstTangent(start, segment.end)
  return firstTangent(segment.control2, segment.end)
    ?? firstTangent(segment.control1, segment.end)
    ?? firstTangent(start, segment.end)
}

function quadraticAsCubic(
  start: ScenePoint,
  control: ScenePoint,
  end: ScenePoint,
): readonly [ScenePoint, ScenePoint] {
  return [
    {
      x: start.x + (control.x - start.x) * 2 / 3,
      y: start.y + (control.y - start.y) * 2 / 3,
    },
    {
      x: end.x + (control.x - end.x) * 2 / 3,
      y: end.y + (control.y - end.y) * 2 / 3,
    },
  ]
}

/**
 * Build the semantic projection of an authored line/quadratic/cubic path.
 * `d` remains the lowering's exact compatibility serialization; `points` is
 * an adaptive polyline of that same visible ink for hit-testing, bounds and
 * non-SVG backends. Endpoint tangents come from the authored derivatives,
 * not from the approximation's first and last chords.
 */
export function projectConnectorPath(
  d: string,
  start: ScenePoint,
  segments: readonly ConnectorPathProjectionSegment[],
  tolerance = 0.5,
): ConnectorPathProjection {
  for (const point of [start, ...segments.flatMap(segment =>
    segment.kind === 'line' ? [segment.end]
      : segment.kind === 'quadratic' ? [segment.control, segment.end]
        : [segment.control1, segment.control2, segment.end])]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('Connector path projection points must be finite')
    }
  }

  const points: ScenePoint[] = [{ ...start }]
  const starts: ScenePoint[] = []
  let cursor = start
  for (const segment of segments) {
    starts.push(cursor)
    if (segment.kind === 'line') {
      points.push({ ...segment.end })
    } else if (segment.kind === 'quadratic') {
      const [control1, control2] = quadraticAsCubic(cursor, segment.control, segment.end)
      points.push(...flattenCubicBezier(cursor, control1, control2, segment.end, tolerance).slice(1))
    } else {
      points.push(...flattenCubicBezier(
        cursor,
        segment.control1,
        segment.control2,
        segment.end,
        tolerance,
      ).slice(1))
    }
    cursor = segment.end
  }

  let startTangent: ScenePoint | undefined
  for (let index = 0; index < segments.length && !startTangent; index++) {
    startTangent = segmentStartTangent(starts[index]!, segments[index]!)
  }
  let endTangent: ScenePoint | undefined
  for (let index = segments.length - 1; index >= 0 && !endTangent; index--) {
    endTangent = segmentEndTangent(starts[index]!, segments[index]!)
  }

  return {
    geometry: { kind: 'path', d, points },
    contours: [{
      start: { ...start },
      end: { ...cursor },
      closed: false,
      ...(startTangent ? { startTangent } : {}),
      ...(endTangent ? { endTangent } : {}),
    }],
  }
}

export interface RoundedConnectorPathOptions {
  /** Mermaid's flowchart router measures arbitrary segments geometrically;
   * the orthogonal architecture/class/ER routers retain Manhattan radii. */
  readonly metric?: 'euclidean' | 'manhattan'
  /** Coordinate precision used by the compatibility SVG path serializer. */
  readonly precision?: number
  readonly tolerance?: number
}

function routeDistance(
  left: ScenePoint,
  right: ScenePoint,
  metric: NonNullable<RoundedConnectorPathOptions['metric']>,
): number {
  return metric === 'manhattan'
    ? Math.abs(right.x - left.x) + Math.abs(right.y - left.y)
    : distance(left, right)
}

function roundedCoordinate(value: number, precision: number | undefined): number {
  if (precision === undefined) return value
  if (!Number.isSafeInteger(precision) || precision < 0) {
    throw new TypeError('Rounded connector precision must be a non-negative safe integer')
  }
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function pointToward(
  from: ScenePoint,
  to: ScenePoint,
  amount: number,
  metric: NonNullable<RoundedConnectorPathOptions['metric']>,
  precision: number | undefined,
): ScenePoint {
  const total = routeDistance(from, to, metric)
  if (total === 0) return { ...from }
  const ratio = amount / total
  return {
    x: roundedCoordinate(from.x + (to.x - from.x) * ratio, precision),
    y: roundedCoordinate(from.y + (to.y - from.y) * ratio, precision),
  }
}

/**
 * Central compatibility serializer and semantic projection for Mermaid's
 * rounded routed connectors. It intentionally supports both historical
 * distance metrics while sharing one Q-segment model and one flattening path.
 */
export function projectRoundedConnectorPath(
  points: readonly ScenePoint[],
  radius: number,
  options: RoundedConnectorPathOptions = {},
): ConnectorPathProjection {
  if (points.length === 0) {
    throw new RangeError('Rounded connector paths require at least one point')
  }
  if (!Number.isFinite(radius)) {
    throw new TypeError('Rounded connector radius must be finite')
  }
  const metric = options.metric ?? 'euclidean'
  const first = points[0]!
  const segments: ConnectorPathProjectionSegment[] = []

  if (radius <= 0 || points.length < 3) {
    for (let index = 1; index < points.length; index++) {
      segments.push({ kind: 'line', end: points[index]! })
    }
    const d = `M${points.map(point => `${point.x},${point.y}`).join(' L')}`
    return projectConnectorPath(d, first, segments, options.tolerance)
  }

  const parts: string[] = [`M${first.x},${first.y}`]
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const current = points[index]!
    const next = points[index + 1]!
    const previousLength = routeDistance(previous, current, metric)
    const nextLength = routeDistance(current, next, metric)
    const cornerRadius = Math.min(radius, previousLength / 2, nextLength / 2)
    if (cornerRadius <= 0) {
      parts.push(`L${current.x},${current.y}`)
      segments.push({ kind: 'line', end: current })
      continue
    }

    const before = pointToward(current, previous, cornerRadius, metric, options.precision)
    const after = pointToward(current, next, cornerRadius, metric, options.precision)
    parts.push(`L${before.x},${before.y}`)
    parts.push(`Q${current.x},${current.y} ${after.x},${after.y}`)
    segments.push({ kind: 'line', end: before })
    segments.push({ kind: 'quadratic', control: current, end: after })
  }

  const last = points.at(-1)!
  parts.push(`L${last.x},${last.y}`)
  segments.push({ kind: 'line', end: last })
  return projectConnectorPath(parts.join(' '), first, segments, options.tolerance)
}

/** Continuous contours without reparsing SVG path data. */
export function connectorSubpaths(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): readonly ConnectorSubpath[] {
  if (geometry.kind === 'line') {
    return [{ points: [{ x: geometry.x1, y: geometry.y1 }, { x: geometry.x2, y: geometry.y2 }], closed: false }]
  }
  if (geometry.kind === 'path' && geometry.subpaths !== undefined) return geometry.subpaths
  return [{ points: geometry.points, closed: compatibilityClosed }]
}

/** Whether the authored compatibility path contains a non-linear command.
 * Curved paths may publish exact derivative tangents that intentionally differ
 * from the first/last chord of their flattened hit-test projection. */
export function connectorGeometryHasCurves(geometry: ConnectorGeometry): boolean {
  return geometry.kind === 'path' && /[AaCcQqSsTt]/.test(geometry.d)
}

/** Geometry-derived contour endpoints and chord tangents. These tangents are
 * authoritative for lines, polylines, and paths containing only linear SVG
 * commands; curved lowerings may override them with exact derivatives. */
export function connectorContourSemantics(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): ConnectorContourSemantics[] {
  const subpaths = connectorSubpaths(geometry, compatibilityClosed)
  const segments = connectorSegments(geometry, compatibilityClosed)
  return subpaths.flatMap((subpath, subpathIndex) => {
    const start = subpath.points[0]
    const last = subpath.points.at(-1)
    if (!start || !last) return []
    const contourSegments = segments.filter(segment => segment.subpathIndex === subpathIndex)
    let startTangent: ScenePoint | undefined
    for (let index = 0; index < contourSegments.length && !startTangent; index++) {
      startTangent = connectorUnitTangent(contourSegments[index]!.start, contourSegments[index]!.end)
    }
    let endTangent: ScenePoint | undefined
    for (let index = contourSegments.length - 1; index >= 0 && !endTangent; index--) {
      endTangent = connectorUnitTangent(contourSegments[index]!.start, contourSegments[index]!.end)
    }
    return [{
      start: { ...start },
      end: { ...(subpath.closed ? start : last) },
      closed: subpath.closed,
      ...(startTangent ? { startTangent } : {}),
      ...(endTangent ? { endTangent } : {}),
    }]
  })
}

export interface ConnectorSegment {
  readonly start: ScenePoint
  readonly end: ScenePoint
  readonly subpathIndex: number
  readonly closing: boolean
}

export interface ConnectorMarkerAnchor {
  readonly point: ScenePoint
  readonly contourIndex: number
}

/** Marker anchors retain their contour ownership. SVG applies marker-start
 * and marker-end once per subpath, not merely once to the flattened path. */
export function connectorEndpointMarkerAnchors(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): Readonly<{ starts: readonly ConnectorMarkerAnchor[]; ends: readonly ConnectorMarkerAnchor[] }> {
  const starts: ConnectorMarkerAnchor[] = []
  const ends: ConnectorMarkerAnchor[] = []
  connectorSubpaths(geometry, compatibilityClosed).forEach((subpath, contourIndex) => {
    const start = subpath.points[0]
    const end = subpath.closed ? start : subpath.points.at(-1)
    if (start) starts.push({ point: { ...start }, contourIndex })
    if (end) ends.push({ point: { ...end }, contourIndex })
  })
  return { starts, ends }
}

export function connectorEndpointAnchors(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): Readonly<{ starts: readonly ScenePoint[]; ends: readonly ScenePoint[] }> {
  const starts: ScenePoint[] = []
  const ends: ScenePoint[] = []
  for (const subpath of connectorSubpaths(geometry, compatibilityClosed)) {
    const start = subpath.points[0]
    const end = subpath.closed ? start : subpath.points.at(-1)
    if (start) starts.push(start)
    if (end) ends.push(end)
  }
  return { starts, ends }
}

/** Typed line segments with no synthetic bridge between SVG `M` contours. */
export function connectorSegments(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): readonly ConnectorSegment[] {
  const segments: ConnectorSegment[] = []
  for (const [subpathIndex, subpath] of connectorSubpaths(geometry, compatibilityClosed).entries()) {
    for (let index = 1; index < subpath.points.length; index++) {
      segments.push({
        start: subpath.points[index - 1]!,
        end: subpath.points[index]!,
        subpathIndex,
        closing: false,
      })
    }
    const first = subpath.points[0]
    const last = subpath.points.at(-1)
    if (subpath.closed && first && last && !sameConnectorPoint(first, last)) {
      segments.push({ start: last, end: first, subpathIndex, closing: true })
    }
  }
  return segments
}

/** Vertices at which SVG marker-mid applies. */
export function connectorMidpoints(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): readonly ScenePoint[] {
  if (geometry.kind === 'line') return []
  if (geometry.kind === 'path') return geometry.markerMidpoints ?? []
  return connectorSubpaths(geometry, compatibilityClosed).flatMap(subpath => {
    if (subpath.points.length < 2) return []
    const points = subpath.closed
      && sameConnectorPoint(subpath.points[0]!, subpath.points.at(-1)!)
      ? subpath.points.slice(0, -1)
      : subpath.points
    return subpath.closed ? points.slice(1) : points.slice(1, -1)
  })
}

/** Exact marker-mid anchors with contour ownership. For path geometry the
 * explicit marker vertices are authoritative; a multi-contour path must make
 * each vertex attributable to exactly one typed contour. */
export function connectorMidpointMarkerAnchors(
  geometry: ConnectorGeometry,
  compatibilityClosed = false,
): readonly ConnectorMarkerAnchor[] {
  if (geometry.kind === 'line') return []
  const subpaths = connectorSubpaths(geometry, compatibilityClosed)
  if (geometry.kind === 'path') {
    return (geometry.markerMidpoints ?? []).map(point => {
      if (subpaths.length === 1) return { point: { ...point }, contourIndex: 0 }
      const owners = subpaths.flatMap((subpath, contourIndex) =>
        subpath.points.some(candidate => sameConnectorPoint(candidate, point)) ? [contourIndex] : [])
      if (owners.length !== 1) {
        throw new TypeError('Path marker-mid vertices on multiple subpaths must belong to exactly one typed contour')
      }
      return { point: { ...point }, contourIndex: owners[0]! }
    })
  }
  return subpaths.flatMap((subpath, contourIndex) => {
    if (subpath.points.length < 2) return []
    const points = subpath.closed && sameConnectorPoint(subpath.points[0]!, subpath.points.at(-1)!)
      ? subpath.points.slice(0, -1)
      : subpath.points
    const midpoints = subpath.closed ? points.slice(1) : points.slice(1, -1)
    return midpoints.map(point => ({ point: { ...point }, contourIndex }))
  })
}

/** Multiple `M` commands require explicit typed contour boundaries. */
export function pathMoveCount(d: string): number {
  return d.match(/[Mm](?=\s*[-+.]?\d)/g)?.length ?? 0
}
