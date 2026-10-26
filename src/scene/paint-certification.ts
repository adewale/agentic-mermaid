import type { RenderedLayout } from '../agent/types.ts'
import { connectorMarkerPaintRegions, connectorStrokeHasJoins, expandSceneBounds, nodePaintBounds, paintedStrokeExtent, unionSceneBounds, transformedBounds, visitTypedPathSegments, type TypedPathSegment } from './bounds.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { resolveInlineColorAttribute } from '../theme.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import { inspectScenePaintGeometry, paintPrimitiveSource, scenePrimitiveMatrix, sceneGroupOpacity, type ScenePaintGeometryInspection, type NativeConnectorPaintSource, type ScenePaintGeometry as ScenePaintPrimitive } from './inspection.ts'
import type { Geometry, SceneDoc, SceneOwner, ScenePoint, SceneTransform, MarkerDescriptor } from './ir.ts'
import { composeMatrices, inverseMatrix, transformMatrix, transformPoint } from './transforms.ts'

export interface PaintViewport { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PaintCertificationIssue {
  readonly code: 'UNMEASURED_PAINT' | 'UNPREPARED_TEXT' | 'CONDITIONAL_PAINT' | 'LABEL_CONTAINMENT' | 'TEXT_OCCLUDED' | 'CHECK_BUDGET' | 'OUTPUT_SCOPE' | 'POTENTIAL_OCCLUSION' | 'MARKER_OCCLUDED' | 'CONNECTOR_CARD_CROSSING'
  readonly id?: string
  readonly by?: string
  readonly message: string
}
export interface PaintLayoutCertification {
  readonly version: 1
  readonly unit: 'px'
  readonly scope: 'native-scene'
  readonly status: 'passed' | 'failed' | 'unverified'
  /** Digest of the final secured SVG this proof was issued with. Its shape,
   * text and connector elements are written from the fields the proof reads;
   * the document passes after the backend resolve colour variables, fit
   * uncalibrated host fonts, namespace ids and scope styles, and the security
   * policy may remove content it does not admit. */
  readonly outputDigest?: string
  readonly viewport: PaintViewport
  readonly attempts: 1 | 2
  readonly repairs: readonly 'expand-viewport'[]
  readonly coverage: { readonly measured: number; readonly unmeasured: number; readonly preparedText: number; readonly fallbackText: number; readonly conditional: number }
  readonly checks: { readonly primitives: number; readonly labels: number; readonly occlusionPairs: number; readonly maxOcclusionPairs: number; readonly operations: number; readonly maxOperations: number; readonly markers: number }
  readonly issues: readonly PaintCertificationIssue[]
  readonly limitations: readonly string[]
}

const renderedCertificates = new WeakMap<RenderedLayout, PaintLayoutCertification>()
export function retainRenderedPaintCertification(layout: RenderedLayout, certification: PaintLayoutCertification): void { renderedCertificates.set(layout, certification) }
export function renderedPaintCertification(layout: RenderedLayout): PaintLayoutCertification | undefined { return layout.paintCertification ?? renderedCertificates.get(layout) }

const MAX_OCCLUSION_PAIRS = 100_000
const MAX_OCCLUSION_OPERATIONS = 400_000
const MAX_ISSUES = 64
const TOLERANCE = 0.5
/** Floating-point noise in layout arithmetic (a legend top at -3.6e-15); ink
 * within it of the canvas edge is on the canvas, not past it. */
const ARITHMETIC_NOISE = 1e-6
const contains = (a: AxisAlignedBox, b: AxisAlignedBox, tolerance = 0): boolean => a.x0 <= b.x0 + tolerance && a.y0 <= b.y0 + tolerance && a.x1 >= b.x1 - tolerance && a.y1 >= b.y1 - tolerance
const overlaps = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const box = (r: { x: number; y: number; w: number; h: number }): AxisAlignedBox => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h })
const viewportBox = (v: PaintViewport): AxisAlignedBox => ({ x0: v.x, y0: v.y, x1: v.x + v.width, y1: v.y + v.height })

interface Surface { primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; interiors?: readonly AxisAlignedBox[]; strokeInteriors?: readonly AxisAlignedBox[]; borderWidth?: number; partBorderWidths?: readonly number[]; partFilled?: readonly boolean[]; partBounds?: readonly (AxisAlignedBox | undefined)[] }
interface Tree { bounds: AxisAlignedBox; leaves?: readonly Surface[]; left?: Tree; right?: Tree }
function tree(items: Surface[]): Tree | undefined {
  if (!items.length) return undefined
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const surface of items) {
    bounds.x0 = Math.min(bounds.x0, surface.bounds.x0)
    bounds.y0 = Math.min(bounds.y0, surface.bounds.y0)
    bounds.x1 = Math.max(bounds.x1, surface.bounds.x1)
    bounds.y1 = Math.max(bounds.y1, surface.bounds.y1)
  }
  if (items.length <= 8) return { bounds, leaves: items }
  const axis = bounds.x1 - bounds.x0 >= bounds.y1 - bounds.y0 ? 'x0' : 'y0'
  // These arrays belong to this tree: the root comes from solidInteriors,
  // and child ranges are fresh slices. Keep the same split and tie order.
  items.sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.primitive.order - b.primitive.order)
  const middle = Math.floor(items.length / 2)
  return { bounds, left: tree(items.slice(0, middle)), right: tree(items.slice(middle)) }
}

/** A filled rectangle's inset is known to be solid, unlike an arbitrary path's
 * conservative envelope. Rounded corners are excluded before transformation.
 */
function solidInteriors(scene: NativePaintHeader, primitives: readonly ScenePaintPrimitive[]): Surface[] {
  const resolved = new Map<string, boolean>()
  const opaque = (fill: string): boolean => {
    if (resolved.has(fill)) return resolved.get(fill)!
    const value = resolveInlineColorAttribute(fill, scene.colors)
    const result = !!value && tryParseCssColor(value)?.[3] === 1
    resolved.set(fill, result)
    return result
  }
  const outlines = new Map<string, number>()
  const outlineKey = (primitive: ScenePaintPrimitive, geometry: Geometry) => JSON.stringify([primitive.owner, geometry, scenePrimitiveMatrix(primitive)])
  for (const primitive of primitives) {
    const node = paintPrimitiveSource(primitive)
    if (node?.kind !== 'shape' || primitive.coverage !== 'measured' || primitive.visibility === 'conditional' || primitive.groupOpacity !== undefined) continue
    // Each border band needs its own emitted continuous opaque outline. A
    // compound's summary paint need not be used by any of its SVG children.
    const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
    for (let index = 0; index < pieces.length; index++) {
      const paint = node.geometry.kind === 'compound' ? node.childPaints?.[index] ?? node.paint : node.paint
      if (paint.vectorEffect === 'non-scaling-stroke' || !paint.stroke || !opaque(paint.stroke) || Number(paint.opacity ?? 1) !== 1 || Number(paint.strokeOpacity ?? 1) !== 1 || paint.strokeDasharray) continue
      const width = Number(paint.strokeWidth?.replace(/px$/, '') ?? 1)
      if (Number.isFinite(width) && width > 0) outlines.set(outlineKey(primitive, pieces[index]!), width)
    }
  }
  const surfaces: Surface[] = []
  for (const primitive of primitives) {
    const node = paintPrimitiveSource(primitive)
    if (!node || node.kind !== 'shape' || primitive.visibility === 'conditional' || primitive.coverage !== 'measured') continue
    // A translucent wrapper lets what lies beneath show through. Each SVG
    // child replaces the summary paint completely and has its own fill alpha.
    if (primitive.groupOpacity !== undefined) continue
    const pieces = node.geometry.kind === 'compound' ? node.geometry.children : [node.geometry]
    const paints = pieces.map((_, index) => node.geometry.kind === 'compound' ? node.childPaints?.[index] ?? node.paint : node.paint)
    const filled = pieces.map((piece, index) => {
      const paint = paints[index]!, opacity = sceneGroupOpacity(paint.opacity), fillOpacity = sceneGroupOpacity(paint.fillOpacity)
      const knownFill = paint.fill ? tryParseCssColor(paint.fill) : null
      return piece.kind !== 'line' && paint.fill !== 'none' && paint.fill !== 'transparent'
        && !(opacity < 1 || fillOpacity < 1 || knownFill && knownFill[3] < 1)
    })
    const stroked = pieces.map((piece, index) => {
      const paint = paints[index]!
      return sceneGroupOpacity(paint.opacity) !== 0 && sceneGroupOpacity(paint.strokeOpacity) !== 0
        && paintedStrokeExtent(paint, ['polygon', 'polyline', 'path', 'compound'].includes(piece.kind)) !== 0
    })
    if (!filled.some(Boolean) && !stroked.some(Boolean)) continue
    const m = scenePrimitiveMatrix(primitive)!
    const [a, b, c, d, e, f] = m
    const transform: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    let bounds: AxisAlignedBox | undefined
    const partBounds: Array<AxisAlignedBox | undefined> = []
    pieces.forEach((geometry, index) => {
      const paint = paints[index]!
      if (!filled[index] && !stroked[index]) return
      // Do not keep an invisible sibling's geometry in the possible ink box.
      // Unknown child bounds retain the original conservative primitive box.
      const painted = nodePaintBounds({ kind: 'shape', id: primitive.id, role: primitive.role, geometry, paint }, transform)
      partBounds[index] = painted ?? primitive.bounds!
      bounds = unionSceneBounds(bounds, partBounds[index])
    })
    if (!bounds) continue
    const candidate = { primitive, bounds, borderWidth: outlines.get(outlineKey(primitive, node.geometry)), ...(node.geometry.kind === 'compound' ? { partBorderWidths: pieces.map(child => outlines.get(outlineKey(primitive, child)) ?? 0), partFilled: filled, partBounds } : {}) }
    // A rotated/sheared AABB is not a solid rectangle. Keep it out of this
    // exact test instead of interpreting empty corners as painted pixels.
    if (Math.abs(m[1]) > 1e-12 || Math.abs(m[2]) > 1e-12) { surfaces.push(candidate); continue }
    const interiors: AxisAlignedBox[] = [], strokeInteriors: AxisAlignedBox[] = []
    pieces.forEach((g, index) => {
      const paint = paints[index]!
      if (g.kind === 'rect' && m[0] === 1 && m[3] === 1 && m[1] === 0 && m[2] === 0
        && paint.vectorEffect !== 'non-scaling-stroke' && paint.stroke && opaque(paint.stroke)
        && sceneGroupOpacity(paint.opacity) === 1 && sceneGroupOpacity(paint.strokeOpacity) === 1 && !paint.strokeDasharray
        && paintedStrokeExtent(paint, false) !== undefined) {
        const half = Number.parseFloat(paint.strokeWidth ?? '1') / 2
        const rx = Math.max(0, Math.min(g.width / 2, g.rx ?? g.ry ?? 0)), ry = Math.max(0, Math.min(g.height / 2, g.ry ?? g.rx ?? 0))
        // Straight-edge bands exclude rounded corners and join assumptions.
        if (half > 0) for (const band of [
          { x0: g.x - half, y0: g.y + ry, x1: g.x + half, y1: g.y + g.height - ry },
          { x0: g.x + g.width - half, y0: g.y + ry, x1: g.x + g.width + half, y1: g.y + g.height - ry },
          { x0: g.x + rx, y0: g.y - half, x1: g.x + g.width - rx, y1: g.y + half },
          { x0: g.x + rx, y0: g.y + g.height - half, x1: g.x + g.width - rx, y1: g.y + g.height + half },
        ]) if (band.x0 < band.x1 && band.y0 < band.y1) strokeInteriors.push(transformedBounds(band, transform)!)
      }
      if (!filled[index] || g.kind !== 'rect' || sceneGroupOpacity(paint.opacity) !== 1 || sceneGroupOpacity(paint.fillOpacity) !== 1 || !paint.fill || !opaque(paint.fill)) return
      const rx = Math.min(g.width / 2, g.rx ?? g.ry ?? 0), ry = Math.min(g.height / 2, g.ry ?? g.rx ?? 0)
      const a = transformPoint({ x: g.x + rx, y: g.y + ry }, m)
      const b = transformPoint({ x: g.x + g.width - rx, y: g.y + g.height - ry }, m)
      interiors.push({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
    })
    surfaces.push({ ...candidate, interiors, strokeInteriors })
  }
  return surfaces
}

/** Conservative marker envelopes can overlap empty corners of endpoint shapes.
 * A separating side or radius proves absence; other intersections stay unknown.
 */
function outsideFilledBody(surface: Surface, bounds: AxisAlignedBox, attached: boolean, hull?: readonly ScenePoint[], padding = 0, work: () => boolean = () => true, witnesses?: readonly ScenePoint[]): boolean {
  const shape = paintPrimitiveSource(surface.primitive)
  if (shape?.kind !== 'shape') return false
  const inverse = inverseMatrix(scenePrimitiveMatrix(surface.primitive)!)
  if (!inverse) return false
  const corners = (hull ?? [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x0, y: bounds.y1 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }]).map(point => transformPoint(point, inverse))
  const [a, b, c, d] = inverse
  const inverseNorm = (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2
  const margin = padding * inverseNorm
  // An attached arrow's stroke can meet its endpoint outline. Exclude only
  // that declared border band; a marker entering the filled body stays checked.
  let contactAllowed = false
  const outside = (g: Geometry, borderWidth = surface.borderWidth ?? 0, paint = shape.paint, filled = true, painted = surface.bounds, witness?: ScenePoint): boolean => {
    if (!work()) return false
    if (witness && (witness.x < painted.x0 || witness.x > painted.x1 || witness.y < painted.y0 || witness.y > painted.y1)) return true
    const samples = witness ? [transformPoint(witness, inverse)] : corners
    let sampleMargin = witness ? 0 : margin
    const tolerance = witness ? -1e-8 : 1e-8
    const lineTolerance = witness ? -1e-8 : 0
    // The shape writer admits one compound level only. Never reinterpret
    // nested indices as the root's independently painted siblings.
    if (g.kind === 'compound') return g === shape.geometry && g.children.length <= 64 && g.children.every((child, index) => child.kind !== 'compound' && outside(child, surface.partBorderWidths?.[index] ?? 0, shape.childPaints?.[index] ?? shape.paint, surface.partFilled?.[index] ?? true, surface.partBounds?.[index] ?? surface.bounds, witness))
    if (!filled) {
      // An absent/translucent fill does not occlude the retained ink, but its
      // independently emitted stroke still needs a conservative separator.
      if (sceneGroupOpacity(paint.opacity) === 0 || sceneGroupOpacity(paint.strokeOpacity) === 0 || paintedStrokeExtent(paint, g.kind !== 'line') === 0) return true
    }
    if (g.kind === 'line') {
      // SVG lines have no filled area. Their actual child stroke must still
      // separate from the complete marker hull, including cap and affine ink.
      const extent = paintedStrokeExtent(paint, false)
      if (extent === undefined) return false
      if (extent === 0) return true
      const radius = extent * (paint.vectorEffect === 'non-scaling-stroke' ? inverseNorm : 1)
      return samples.every(p => work() && p.x + sampleMargin <= Math.min(g.x1, g.x2) - radius + lineTolerance)
        || samples.every(p => work() && p.x - sampleMargin >= Math.max(g.x1, g.x2) + radius - lineTolerance)
        || samples.every(p => work() && p.y + sampleMargin <= Math.min(g.y1, g.y2) - radius + lineTolerance)
        || samples.every(p => work() && p.y - sampleMargin >= Math.max(g.y1, g.y2) + radius - lineTolerance)
    }
    // A fill separator does not bound a stroke outside that geometry. Retain
    // uncertainty there unless the existing owned opaque border-band contact
    // applies. Lines above always check their complete stroke independently.
    const strokeExtent = paintedStrokeExtent(paint, ['polygon', 'polyline', 'path'].includes(g.kind))
    if (strokeExtent === undefined) return false
    if (witness) sampleMargin = strokeExtent * (paint.vectorEffect === 'non-scaling-stroke' ? inverseNorm : 1)
    else if (strokeExtent > 0 && sceneGroupOpacity(paint.opacity) !== 0 && sceneGroupOpacity(paint.strokeOpacity) !== 0 && !(attached && contactAllowed && borderWidth > 0) && overlaps(painted, bounds)) return false
    const inset = !witness && attached && contactAllowed ? Math.max(0, borderWidth / 2) : 0
    if (g.kind === 'ellipse' || g.kind === 'circle') {
      const rx = g.kind === 'circle' ? g.r : g.rx, ry = g.kind === 'circle' ? g.r : g.ry
      if (!(rx > 0 && ry > 0)) return false
      if (g.kind === 'circle') {
        const x = Math.max(Math.min(...samples.map(p => p.x)), Math.min(g.cx, Math.max(...samples.map(p => p.x))))
        const y = Math.max(Math.min(...samples.map(p => p.y)), Math.min(g.cy, Math.max(...samples.map(p => p.y))))
        if (Math.hypot(x - g.cx, y - g.cy) >= rx - inset + sampleMargin - tolerance) return true
      }
      // A supporting line separates a convex ellipse from the complete marker
      // hull. Test candidate normals at hull points; every accepted line uses
      // the exact ellipse support function, including transformed ink padding.
      // Failure to find a separator preserves uncertainty, never visibility.
      for (const point of samples) {
        if (!work()) return false
        const nx = (point.x - g.cx) / (rx * rx), ny = (point.y - g.cy) / (ry * ry), norm = Math.hypot(nx, ny)
        if (!norm) continue
        const x = nx / norm, y = ny / norm
        const support = Math.hypot(rx * x, ry * y) - inset + sampleMargin
        if (samples.every(p => work() && (p.x - g.cx) * x + (p.y - g.cy) * y >= support - tolerance)) return true
      }
      return false
    }
    const points = g.kind === 'rect' ? [{ x: g.x, y: g.y }, { x: g.x + g.width, y: g.y }, { x: g.x + g.width, y: g.y + g.height }, { x: g.x, y: g.y + g.height }] : g.kind === 'polygon' ? g.points : undefined
    if (!points || points.length < 3 || points.length > 64) return false
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a.x * b.y - b.x * a.y }, 0)
    const direction = Math.sign(area)
    if (!direction || !points.every((a, i) => points.every(point => work() && direction * cross(a, points[(i + 1) % points.length]!, point) >= -(witness ? 0 : 1e-8)))) return false
    return points.some((a, i) => {
      const b = points[(i + 1) % points.length]!, length = Math.hypot(b.x - a.x, b.y - a.y)
      return length > 0 && samples.every(p => work() && direction * cross(a, b, p) <= (inset - sampleMargin + tolerance) * length)
    })
  }
  // A contact allowance cannot establish visibility by itself. At least one
  // actual marker-ink point must clear every emitted endpoint piece, including
  // its full stroke, before allowing a partial owned border contact.
  if (attached) contactAllowed = witnesses?.some(witness => work() && outside(shape.geometry, surface.borderWidth ?? 0, shape.paint, true, surface.bounds, witness)) ?? false
  return outside(shape.geometry)
}

/** Strict interior points of an emitted convex polygon fill, rather than
 * corners of its conservative stroke envelope. Clipped-away ink is excluded. */
function markerInkWitnesses(marker: MarkerDescriptor | undefined, hull: readonly ScenePoint[] | undefined, scene: NativePaintHeader, work: () => boolean): readonly ScenePoint[] | undefined {
  if (!marker || !hull || marker.geometry?.kind !== 'polygon' || (marker.scale ?? 1) > 1 || sceneGroupOpacity(marker.paint?.opacity) !== 1 || sceneGroupOpacity(marker.paint?.fillOpacity) !== 1 || !marker.paint?.fill) return undefined
  const fill = resolveInlineColorAttribute(marker.paint.fill, scene.colors)
  if (!fill || tryParseCssColor(fill)?.[3] !== 1) return undefined
  const points = marker.geometry.points
  if (points.length < 3 || points.length > 64 || points.length !== hull.length) return undefined
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a.x * b.y - b.x * a.y }, 0)
  const sign = Math.sign(area)
  if (!sign || !points.every((a, i) => points.every(p => work() && sign * ((points[(i + 1) % points.length]!.x - a.x) * (p.y - a.y) - (points[(i + 1) % points.length]!.y - a.y) * (p.x - a.x)) >= 0))) return undefined
  const centroid = (vertices: readonly ScenePoint[]): ScenePoint => ({ x: vertices.reduce((sum, p) => sum + p.x, 0) / vertices.length, y: vertices.reduce((sum, p) => sum + p.y, 0) / vertices.length })
  const local = centroid(points), world = centroid(hull)
  const viewport = marker.viewBox ?? (marker.size ? { x: 0, y: 0, width: marker.size.width, height: marker.size.height } : undefined)
  return [undefined, ...points.keys()].flatMap(index => {
    if (!work()) return []
    const p = index === undefined ? local : { x: (local.x + points[index]!.x) / 2, y: (local.y + points[index]!.y) / 2 }
    if (marker.overflow !== 'visible' && (!viewport || !(p.x > viewport.x && p.x < viewport.x + viewport.width && p.y > viewport.y && p.y < viewport.y + viewport.height))) return []
    return [index === undefined ? world : { x: (world.x + hull[index]!.x) / 2, y: (world.y + hull[index]!.y) / 2 }]
  })
}

/** Nonempty actual marker ink is required for a hard hidden-marker claim.
 * This source-space existence proof also admits filled round markers and
 * open stroked line crosses; it does not infer ink from a declared envelope. */
function markerHasInk(marker: MarkerDescriptor | undefined, witnesses: readonly ScenePoint[] | undefined, scene: NativePaintHeader, work: () => boolean): boolean {
  if (witnesses?.length) return true
  if (!marker?.geometry || sceneGroupOpacity(marker.paint?.opacity) !== 1) return false
  const viewport = marker.viewBox ?? (marker.size ? { x: 0, y: 0, width: marker.size.width, height: marker.size.height } : undefined)
  const visible = (p: ScenePoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && (marker.overflow === 'visible' || !!viewport && p.x > viewport.x && p.x < viewport.x + viewport.width && p.y > viewport.y && p.y < viewport.y + viewport.height)
  const opaque = (color: string | undefined): boolean => {
    if (!color || !work()) return false
    const value = resolveInlineColorAttribute(color, scene.colors)
    return !!value && tryParseCssColor(value)?.[3] === 1
  }
  const g = marker.geometry
  if (sceneGroupOpacity(marker.paint?.fillOpacity) === 1 && opaque(marker.paint?.fill)) {
    if (g.kind === 'circle' && g.r > 0 && visible({ x: g.cx, y: g.cy })) return true
    if (g.kind === 'ellipse' && g.rx > 0 && g.ry > 0 && visible({ x: g.cx, y: g.cy })) return true
    if (g.kind === 'rect' && g.width > 0 && g.height > 0 && visible({ x: g.x + g.width / 2, y: g.y + g.height / 2 })) return true
  }
  if (sceneGroupOpacity(marker.paint?.strokeOpacity) !== 1 || !opaque(marker.paint?.stroke) || marker.paint?.strokeDasharray || !(Number.parseFloat(marker.paint?.strokeWidth ?? '1') > 0) || paintedStrokeExtent(marker.paint ?? {}, true) === undefined) return false
  const lineHasInk = (a: ScenePoint, b: ScenePoint): boolean => work() && Math.hypot(b.x - a.x, b.y - a.y) > 0 && visible({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  if (g.kind === 'line') return lineHasInk({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 })
  if (g.kind === 'polygon' || g.kind === 'polyline') return g.points.length <= 64 && g.points.some((p, i) => i > 0 && lineHasInk(g.points[i - 1]!, p))
  if (g.kind === 'path') {
    let found = false
    const complete = visitTypedPathSegments(g.d, part => { if (part.line && lineHasInk(part.line[0], part.line[1])) found = true; return work() }, work)
    return complete && found
  }
  return false
}

/** A positive-length open-rectangle intersection proves actual straight shaft
 * ink, unlike a route envelope or a flattened curve approximation. */
function lineCrossesInterior(line: readonly [ScenePoint, ScenePoint], interior: AxisAlignedBox): boolean {
  const [a, b] = line
  let first = 0, last = 1
  for (const [origin, delta, low, high] of [[a.x, b.x - a.x, interior.x0, interior.x1], [a.y, b.y - a.y, interior.y0, interior.y1]]) {
    if (Math.abs(delta!) < 1e-12) {
      if (origin! <= low! + 1e-8 || origin! >= high! - 1e-8) return false
    } else {
      const start = (low! - origin!) / delta!, end = (high! - origin!) / delta!
      first = Math.max(first, Math.min(start, end)); last = Math.min(last, Math.max(start, end))
    }
  }
  return (last - first) * Math.hypot(b.x - a.x, b.y - a.y) > 1e-8
}

const CARD_ROLES = new Set(['node', 'service', 'class-box', 'entity'])
const ENDPOINT_ROLES = new Set([...CARD_ROLES, 'group', 'note', 'actor', 'junction'])

/** One linear envelope pass, at most one viewport repair, then final checking.
 * The certificate covers retained native geometry, not every antialiased pixel
 * or arbitrary CSS/backend changes. It never treats path-hull overlap as proof.
 */
export function certifyScenePaint(scene: SceneDoc, projection?: Pick<RenderedLayout, 'nodes' | 'labels'>, options: { outputSupported?: boolean } = {}): PaintLayoutCertification {
  return certifyNativePaint(scene, inspectScenePaintGeometry(scene), projection, options)
}

export type NativePaintHeader = Pick<SceneDoc, 'family' | 'width' | 'height' | 'colors'>

/** Certify a native drawing's flat paint evidence without constructing a Scene. */
export function certifyNativePaint(scene: NativePaintHeader, inspection: ScenePaintGeometryInspection, projection?: Pick<RenderedLayout, 'nodes' | 'labels'>, options: { outputSupported?: boolean } = {}): PaintLayoutCertification {
  const issues: PaintCertificationIssue[] = []
  let failed = false, unverified = false
  const issue = (value: PaintCertificationIssue, failure = false): void => {
    if (issues.length < MAX_ISSUES) issues.push(Object.freeze(value))
    if (failure) failed = true
    else unverified = true
  }
  let x0 = 0, y0 = 0, x1 = scene.width, y1 = scene.height, conditional = 0
  for (const primitive of inspection.primitives) {
    if (primitive.visibility === 'conditional') { conditional++; continue }
    if (primitive.coverage === 'unmeasured') issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: primitive.reason ?? 'Paint geometry is unavailable' })
    if (primitive.text && primitive.coverage !== 'non-painting' && primitive.text.measurement !== 'prepared') issue({ code: 'UNPREPARED_TEXT', id: primitive.id, message: 'Text was not retained from layout preparation' })
    const b = primitive.bounds
    if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1) }
  }
  if (conditional) issue({ code: 'CONDITIONAL_PAINT', message: `${conditional} primitives depend on unresolved paint or interaction state` })
  if (options.outputSupported === false || scene.family.startsWith('family:')) issue({ code: 'OUTPUT_SCOPE', message: 'Selected backend, style or external family has no native final-paint proof' })
  x0 = Math.min(0, x0 + ARITHMETIC_NOISE); y0 = Math.min(0, y0 + ARITHMETIC_NOISE)
  x1 = Math.max(scene.width, x1 - ARITHMETIC_NOISE); y1 = Math.max(scene.height, y1 - ARITHMETIC_NOISE)
  const repaired = x0 < 0 || y0 < 0 || x1 > scene.width || y1 > scene.height
  // Outward rounding adds a bounded safety margin without moving semantic
  // geometry, chart coordinates, routes, dates or authored memberships.
  const expanded = { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1) - Math.floor(x0), height: Math.ceil(y1) - Math.floor(y0) }
  if (repaired && scene.width > 0 && scene.height > 0) {
    const ratio = scene.width / scene.height
    if (expanded.width / expanded.height > ratio) expanded.height = expanded.width / ratio
    else expanded.width = expanded.height * ratio
  }
  const viewport = Object.freeze(repaired ? expanded : { x: 0, y: 0, width: scene.width, height: scene.height })
  const finalBounds = viewportBox(viewport)
  if (repaired && inspection.primitives.some(primitive => {
    const node = paintPrimitiveSource(primitive)
    return node?.kind === 'connector' ? node.stroke.nonScaling : node?.kind === 'shape' || node?.kind === 'text' ? node.paint.vectorEffect === 'non-scaling-stroke' : false
  })) issue({ code: 'OUTPUT_SCOPE', message: 'Viewport expansion changes the user-unit extent of non-scaling strokes; final painted containment is unverified' })
  let labels = 0
  const label = (id: string, bounds: { x: number; y: number; w: number; h: number } | undefined, container?: { x: number; y: number; w: number; h: number }): void => {
    labels++
    if (!bounds || !container) { issue({ code: 'UNMEASURED_PAINT', id, message: 'Projected label has no retained occupied or available region' }); return }
    let region = box(container)
    if (region.x0 === 0 && region.y0 === 0 && region.x1 === scene.width && region.y1 === scene.height) region = finalBounds
    if (!contains(region, box(bounds), TOLERANCE)) issue({ code: 'LABEL_CONTAINMENT', id, message: 'Retained text extends beyond its declared available region' }, true)
  }
  if (projection) {
    for (const node of projection.nodes) if (node.label?.trim() && node.labelVisibility !== 'hidden' && node.labelVisibility !== 'semantic') label(String(node.id), node.labelBounds, node.labelContainer)
    for (const value of projection.labels ?? []) if (value.text.trim() && value.visibility !== 'hidden' && value.visibility !== 'semantic') label(value.id, value.bounds, value.container)
  }
  const surfaces = tree(solidInteriors(scene, inspection.primitives))
  let pairs = 0, operations = 0, exhausted = false
  const work = (): boolean => {
    if (operations >= MAX_OCCLUSION_OPERATIONS) { exhausted = true; return false }
    operations++
    return true
  }
  const endpointRoles = new Map<string, Set<string>>()
  for (const primitive of inspection.primitives) {
    if (exhausted) break
    for (const owner of [primitive.owner, ...primitive.ancestors]) {
      if (!work()) break
      if (!ENDPOINT_ROLES.has(owner.role)) continue
      const roles = endpointRoles.get(owner.id) ?? new Set<string>()
      roles.add(owner.role)
      endpointRoles.set(owner.id, roles)
    }
  }
  const endpointRelation = (connector: NativeConnectorPaintSource, owner: SceneOwner): 'attached' | 'unrelated' | 'ambiguous' => {
    let ambiguous = false
    for (const [id, anchor] of [[connector.endpoints.from, connector.endpoints.start], [connector.endpoints.to, connector.endpoints.end]] as const) {
      if (id !== owner.id) continue
      if (anchor?.owner) {
        if (anchor.owner.id !== id) { ambiguous = true; continue }
        if (anchor.owner.role === owner.role) return 'attached'
      } else if ((endpointRoles.get(id)?.size ?? 0) > 1) ambiguous = true
      else return 'attached'
    }
    return ambiguous ? 'ambiguous' : 'unrelated'
  }
  const check = (branch: Tree | undefined, primitive: ScenePaintPrimitive): void => {
    if (exhausted || !work() || !branch || !overlaps(branch.bounds, primitive.bounds!)) return
    if (!branch.leaves) { check(branch.left, primitive); check(branch.right, primitive); return }
    for (const surface of branch.leaves) {
      if (!work()) return
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; return }
      if (surface.primitive.order <= primitive.order || !overlaps(surface.bounds, primitive.bounds!)) continue
      if (surface.interiors?.some(interior => work() && contains(interior, primitive.bounds!))) issue({ code: 'TEXT_OCCLUDED', id: primitive.id, by: surface.primitive.id, message: `Retained text is fully covered by later opaque artwork owned by ${surface.primitive.owner.id}` }, true)
      else issue({ code: 'POTENTIAL_OCCLUSION', id: primitive.id, by: surface.primitive.id, message: 'Later filled artwork overlaps the occupied text band; its exact ink intersection is unverified' })
    }
  }
  for (const primitive of inspection.primitives) if (primitive.kind === 'text' && primitive.coverage === 'measured' && primitive.visibility !== 'conditional') check(surfaces, primitive)
  const strokeAlpha = new Map<string, number | undefined>()
  for (const primitive of inspection.primitives) {
    if (!work()) break
    const node = paintPrimitiveSource(primitive)
    // Semantic relationships must not cross unrelated cards even when their
    // shafts paint above those cards. Missing endpoint ownership leaves an
    // intersection unverified; chrome rails retain their separate semantics.
    if (node?.kind !== 'connector' || !['edge', 'relationship'].includes(primitive.role) || node.lineStyle === 'invisible' || primitive.visibility === 'conditional' || primitive.coverage !== 'measured') continue
    const width = Number.parseFloat(String(node.stroke.width)), opacity = Number(node.stroke.opacity ?? 1)
    if (width === 0 || opacity === 0 || node.stroke.color === 'none' || node.stroke.color === 'transparent') continue
    if (!strokeAlpha.has(node.stroke.color)) {
      const value = resolveInlineColorAttribute(node.stroke.color, scene.colors)
      strokeAlpha.set(node.stroke.color, value ? tryParseCssColor(value)?.[3] : undefined)
    }
    const alpha = strokeAlpha.get(node.stroke.color)
    if (alpha === 0) continue
    const exactInk = options.outputSupported !== false && !scene.family.startsWith('family:') && !!node.endpoints?.from && !!node.endpoints.to && alpha !== undefined && alpha > 0 && width > 0 && opacity > 0 && !node.stroke.dash
    const matrix = scenePrimitiveMatrix(primitive)!
    const [a, b, c, d, e, f] = matrix
    const transform: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    const extent = paintedStrokeExtent({ stroke: node.stroke.color, strokeWidth: String(node.stroke.width), strokeLinecap: node.stroke.lineCap, strokeLinejoin: node.stroke.lineJoin, strokeMiterlimit: String(node.stroke.miterLimit) }, connectorStrokeHasJoins(node.route))
    if (extent === undefined) { issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Final connector stroke has no bounded cap/join extent' }); continue }
    const visit = (part: TypedPathSegment): boolean => {
      if (!work()) return false
      const bounds = node.stroke.nonScaling
        ? expandSceneBounds(transformedBounds(part.bounds, transform)!, extent)
        : transformedBounds(expandSceneBounds(part.bounds, extent), transform)!
      const line = part.line?.map(point => transformPoint(point, matrix)) as [ScenePoint, ScenePoint] | undefined
      const walk = (branch: Tree | undefined): void => {
        if (exhausted || !work() || !branch || !overlaps(branch.bounds, bounds)) return
        if (!branch.leaves) { walk(branch.left); walk(branch.right); return }
        for (const surface of branch.leaves) {
          if (!work()) return
          if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; return }
          if (!CARD_ROLES.has(surface.primitive.role) || surface.primitive.owner.id === primitive.owner.id && surface.primitive.owner.role === primitive.owner.role || !overlaps(surface.bounds, bounds)) continue
          const relation = endpointRelation(node, surface.primitive.owner)
          if (relation === 'attached') continue
          if (exactInk && relation === 'unrelated' && line && surface.interiors?.some(interior => work() && lineCrossesInterior(line, interior))) issue({ code: 'CONNECTOR_CARD_CROSSING', id: primitive.id, by: surface.primitive.id, message: `Final connector shaft crosses opaque artwork owned by unrelated card ${surface.primitive.owner.id}` }, true)
          else issue({ code: 'POTENTIAL_OCCLUSION', id: primitive.id, by: surface.primitive.id, message: 'Final connector envelope intersects unrelated filled card artwork; actual route/card crossing is unverified' })
        }
      }
      walk(surfaces)
      return !exhausted
    }
    const geometry = node.route.geometry
    if (geometry.kind === 'path') {
      if (!visitTypedPathSegments(geometry.d, visit, work) && !exhausted) issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Final connector segments could not be measured from typed path geometry' })
    } else {
      const points = geometry.kind === 'line' ? [{ x: geometry.x1, y: geometry.y1 }, { x: geometry.x2, y: geometry.y2 }] : geometry.points
      for (let i = 1; i < points.length; i++) {
        const first = points[i - 1]!, last = points[i]!
        if (!visit({ bounds: { x0: Math.min(first.x, last.x), y0: Math.min(first.y, last.y), x1: Math.max(first.x, last.x), y1: Math.max(first.y, last.y) }, line: [first, last] })) break
      }
    }
  }
  type MarkerTarget = { primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; hull?: readonly ScenePoint[]; padding?: number; witnesses?: readonly ScenePoint[]; actualInk: boolean }
  const lastMarkers = new Map<string, MarkerTarget>()
  for (const primitive of inspection.primitives) {
    const node = paintPrimitiveSource(primitive)
    if (primitive.kind !== 'connector' || node?.kind !== 'connector' || node.lineStyle === 'invisible' || primitive.coverage === 'non-painting') continue
    const ownInverse = inverseMatrix(transformMatrix(node.transform))
    if (!ownInverse) continue
    const [a, b, c, d, e, f] = composeMatrices(scenePrimitiveMatrix(primitive)!, ownInverse)
    const parent: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    for (const marker of connectorMarkerPaintRegions(node, parent)) {
      if (!marker.bounds) { issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Endpoint marker has no painted footprint' }); continue }
      const key = JSON.stringify([primitive.owner.id, primitive.owner.role, marker.position, marker.resource, marker.anchor, marker.repaint])
      const knownUnitScale = (typeof node.stroke.width === 'number' ? Number.isFinite(node.stroke.width) && node.stroke.width > 0 : /^\s*(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(node.stroke.width) && Number.parseFloat(node.stroke.width) > 0)
      const descriptor = marker.position === 'start' ? node.markers.start : marker.position === 'end' ? node.markers.end : node.markers.mid.length === 1 ? node.markers.mid[0] : undefined
      const measuredWorld = primitive.coverage === 'measured' && !!inverseMatrix(scenePrimitiveMatrix(primitive)!)
      const knownMapping = descriptor?.units === 'userSpaceOnUse' || knownUnitScale
      const witnesses = measuredWorld && knownMapping ? markerInkWitnesses(descriptor, marker.hull, scene, work) : undefined
      const actualInk = measuredWorld && knownMapping && descriptor?.paint?.vectorEffect !== 'non-scaling-stroke' && markerHasInk(descriptor, witnesses, scene, work)
      lastMarkers.set(key, { primitive, bounds: marker.bounds, hull: marker.hull, padding: marker.padding, witnesses, actualInk })
    }
  }
  const markerCheck = (branch: Tree | undefined, target: MarkerTarget): void => {
    // A matching later conditional repaint may restore this marker, but does
    // not establish final visible ink. The scene's conditional issue stays U.
    if (target.primitive.visibility === 'conditional') return
    if (exhausted || !work() || !branch || !overlaps(branch.bounds, target.bounds)) return
    if (!branch.leaves) { markerCheck(branch.left, target); markerCheck(branch.right, target); return }
    for (const surface of branch.leaves) {
      if (!work()) return
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; return }
      if (surface.primitive.order <= target.primitive.order || !overlaps(surface.bounds, target.bounds)) continue
      if (target.actualInk && (surface.interiors?.some(interior => work() && contains(interior, target.bounds)) || surface.strokeInteriors?.some(interior => work() && contains(interior, target.bounds)))) {
        issue({ code: 'MARKER_OCCLUDED', id: target.primitive.id, by: surface.primitive.id, message: 'Endpoint marker is fully covered by later opaque artwork with no owned repaint' }, true)
        continue
      }
      const connector = paintPrimitiveSource(target.primitive)
      const attached = connector?.kind === 'connector' && endpointRelation(connector, surface.primitive.owner) === 'attached'
      if (outsideFilledBody(surface, target.bounds, attached, target.hull, target.padding, work, target.witnesses)) continue
      issue({ code: 'POTENTIAL_OCCLUSION', id: target.primitive.id, by: surface.primitive.id, message: 'Later filled artwork overlaps an endpoint marker; its exact ink intersection is unverified' })
    }
  }
  for (const target of lastMarkers.values()) markerCheck(surfaces, target)
  if (exhausted) issue({ code: 'CHECK_BUDGET', message: `Occlusion checking reached its ${MAX_OCCLUSION_PAIRS}-pair or ${MAX_OCCLUSION_OPERATIONS}-operation limit` })
  // Mandatory final certification of the chosen viewport, including markers.
  for (const primitive of inspection.primitives) if (primitive.bounds && primitive.visibility !== 'conditional' && !contains(finalBounds, primitive.bounds, ARITHMETIC_NOISE)) issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Final viewport does not contain retained paint' }, true)
  return Object.freeze({ version: 1, unit: 'px', scope: 'native-scene', status: failed ? 'failed' : unverified ? 'unverified' : 'passed', viewport, attempts: repaired ? 2 : 1, repairs: Object.freeze(repaired ? ['expand-viewport' as const] : []), coverage: Object.freeze({ measured: inspection.coverage.measured, unmeasured: inspection.coverage.unmeasured, preparedText: inspection.coverage.preparedText, fallbackText: inspection.coverage.fallbackText, conditional }), checks: Object.freeze({ primitives: inspection.primitives.length, labels, occlusionPairs: Math.min(pairs, MAX_OCCLUSION_PAIRS), maxOcclusionPairs: MAX_OCCLUSION_PAIRS, operations, maxOperations: MAX_OCCLUSION_OPERATIONS, markers: lastMarkers.size }), issues: Object.freeze(issues), limitations: Object.freeze(['Prepared occupied text regions bound native geometry; exact glyph ink depends on the resolved font.', 'Declared transparency, intentional data-mark overlap and externally modified CSS are outside this proof.']) })
}

export class PaintLayoutCertificationError extends Error {
  readonly code = 'PAINT_LAYOUT_CERTIFICATION_FAILED'
  constructor(readonly certification: PaintLayoutCertification) {
    super(`Final paint certification failed: ${certification.issues.map(issue => `${issue.id ?? 'scene'}: ${issue.message}`).join('; ')}`)
    this.name = 'PaintLayoutCertificationError'
  }
}
