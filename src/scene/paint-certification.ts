import { buildInkTree, createInkIndex, chargeInkSort, type InkTree } from '../shared/ink-index.ts'
import type { RenderedLayout } from '../agent/types.ts'
import { connectorMarkerPaintRegions, connectorStrokeHasJoins, expandSceneBounds, nodePaintBounds, paintedStrokeExtent, unionSceneBounds, transformedBounds, visitTypedPathSegments, type ConnectorMarkerPaintRegion, type TypedPathSegment } from './bounds.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { createInlineColorAttributeResolver, resolveInlineColorAttribute } from '../theme.ts'
import { tryParseCssColor, type RgbaColor } from '../shared/color-math.ts'
import { inspectScenePaintGeometry, paintPrimitiveSource, scenePrimitiveMatrix, scenePrimitiveUntransformed, sceneGroupOpacity, type ScenePaintGeometryInspection, type NativeConnectorPaintSource, type ScenePaintGeometry as ScenePaintPrimitive } from './inspection.ts'
import type { Geometry, MarkPaint, SceneDoc, SceneOwner, ScenePoint, SceneTransform, MarkerDescriptor } from './ir.ts'
import { composeMatrices, inverseMatrix, transformMatrix, transformPoint } from './transforms.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import { markerPaintPieces, type MarkerPaintPiece } from './marker-paint-pieces.ts'
import { nativeEmissionWorkOf, hasNativeEmissionOccurrence, MAX_OCCLUSION_OPERATIONS } from './native-paint-emission.ts'
export { MAX_OCCLUSION_OPERATIONS } from './native-paint-emission.ts'

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

export const MAX_OCCLUSION_PAIRS = 100_000
const MAX_ISSUES = 64
const TOLERANCE = 0.5
/** Floating-point noise in layout arithmetic (a legend top at -3.6e-15); ink
 * within it of the canvas edge is on the canvas, not past it. */
const ARITHMETIC_NOISE = 1e-6
const contains = (a: AxisAlignedBox, b: AxisAlignedBox, tolerance = 0): boolean => a.x0 <= b.x0 + tolerance && a.y0 <= b.y0 + tolerance && a.x1 >= b.x1 - tolerance && a.y1 >= b.y1 - tolerance
const overlaps = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const box = (r: { x: number; y: number; w: number; h: number }): AxisAlignedBox => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h })
const viewportBox = (v: PaintViewport): AxisAlignedBox => ({ x0: v.x, y0: v.y, x1: v.x + v.width, y1: v.y + v.height })

interface Surface { primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; interiors?: readonly AxisAlignedBox[]; strokeInteriors?: readonly AxisAlignedBox[]; borderWidth?: number; partBorderWidths?: readonly number[]; partOwnBorderWidths?: readonly number[]; partFilled?: readonly boolean[]; partBounds?: readonly (AxisAlignedBox | undefined)[] }
type Tree = InkTree<Surface>
function tree(items: Surface[]): Tree | undefined {
  // Preserve the existing surface traversal and tie order. Its accounting is
  // unchanged; the new marker/text indexes charge their own construction.
  return buildInkTree(items, item => item.bounds, undefined, (a, b) => a.primitive.order - b.primitive.order)
}

const PAINT_QUERY_WORK_LIMIT = Symbol('paint query work limit')
/** Only the spatial broad phase is shared. Exact paint predicates and ordered
 * issue priority stay here, under this certificate's original allowance. */
function orderedPaintQuery<T extends { bounds: AxisAlignedBox; index: number }>(items: T[], work: () => boolean, expectedQueries: number): (bounds: AxisAlignedBox) => T[] {
  const charge = (count = 1): void => { for (let i = 0; i < count; i++) if (!work()) throw PAINT_QUERY_WORK_LIMIT }
  const query = createInkIndex(items, item => item.bounds, charge, expectedQueries)
  return bounds => {
    try {
      const found = query(bounds)
      chargeInkSort(found, (a, b) => a.index - b.index, charge)
      return found
    } catch (error) { if (error !== PAINT_QUERY_WORK_LIMIT) throw error; return [] }
  }
}

/** A straight orthogonal stroke is contained by its half-width body and
 * endpoint neighborhoods bounded by the original cap/join extent. The latter
 * retain every possible miter; they need not inflate the distant body. Only
 * translation preserves these world-space widths without additional proof. */
function separatedOrthogonalStroke(
  line: readonly [ScenePoint, ScenePoint], surface: AxisAlignedBox,
  stroke: NativeConnectorPaintSource['stroke'], width: number, extent: number,
  matrix: readonly number[], work: () => boolean,
): boolean {
  if (!work() || !matrix.every(Number.isFinite) || matrix[0] !== 1 || matrix[1] !== 0 || matrix[2] !== 0 || matrix[3] !== 1
    || stroke.nonScaling || !['butt', 'round', 'square'].includes(stroke.lineCap ?? 'butt')
    || !['miter', 'round', 'bevel'].includes(stroke.lineJoin ?? 'miter') || !Number.isFinite(width) || width <= 0
    || !Number.isFinite(extent) || extent < width / 2) return false
  const [first, last] = line
  if (![first.x, first.y, last.x, last.y].every(Number.isFinite)
    || first.x !== last.x && first.y !== last.y || first.x === last.x && first.y === last.y) return false
  const half = width / 2
  const body = { x0: Math.min(first.x, last.x) - half, y0: Math.min(first.y, last.y) - half,
    x1: Math.max(first.x, last.x) + half, y1: Math.max(first.y, last.y) + half }
  if (!work() || !Object.values(body).every(Number.isFinite) || overlaps(body, surface)) return false
  for (const point of line) {
    if (!work()) return false
    const end = { x0: point.x - extent, y0: point.y - extent, x1: point.x + extent, y1: point.y + extent }
    if (!Object.values(end).every(Number.isFinite) || overlaps(end, surface)) return false
  }
  return true
}

function possibleShapeFill(piece: Geometry, paint: MarkPaint): boolean {
  const opacity = sceneGroupOpacity(paint.opacity), fillOpacity = sceneGroupOpacity(paint.fillOpacity)
  const knownFill = paint.fill ? tryParseCssColor(paint.fill) : null
  return piece.kind !== 'line' && paint.fill !== 'none' && paint.fill !== 'transparent'
    && !(opacity < 1 || fillOpacity < 1 || knownFill && knownFill[3] < 1)
}
function possibleShapeStroke(piece: Geometry, paint: MarkPaint): boolean {
  return sceneGroupOpacity(paint.opacity) !== 0 && sceneGroupOpacity(paint.strokeOpacity) !== 0
    && paintedStrokeExtent(paint, ['polygon', 'polyline', 'path', 'compound'].includes(piece.kind)) !== 0
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
  const opaqueOutlineWidth = (paint: MarkPaint): number => {
    if (paint.vectorEffect === 'non-scaling-stroke' || !paint.stroke || !opaque(paint.stroke) || Number(paint.opacity ?? 1) !== 1 || Number(paint.strokeOpacity ?? 1) !== 1 || paint.strokeDasharray) return 0
    const width = Number(paint.strokeWidth?.replace(/px$/, '') ?? 1)
    return Number.isFinite(width) && width > 0 ? width : 0
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
      const width = opaqueOutlineWidth(paint)
      if (width > 0) outlines.set(outlineKey(primitive, pieces[index]!), width)
    }
  }
  const surfaces: Surface[] = []
  for (const primitive of primitives) {
    const node = paintPrimitiveSource(primitive)
    if (!node || node.kind !== 'shape' || primitive.visibility === 'conditional' || primitive.coverage !== 'measured') continue
    // A translucent wrapper lets what lies beneath show through. Each SVG
    // child replaces the summary paint completely and has its own fill alpha.
    if (primitive.groupOpacity !== undefined) continue
    const { geometry, paint: shapePaint, childPaints } = node
    const pieces = geometry.kind === 'compound' ? geometry.children : undefined
    const singleGeometry = pieces ? undefined : geometry
    const paints = pieces?.map((_, index) => childPaints?.[index] ?? shapePaint)
    const singlePaint = pieces ? undefined : shapePaint
    const filled = pieces?.map((piece, index) => possibleShapeFill(piece, paints![index]!))
    const singleFilled = pieces ? false : possibleShapeFill(singleGeometry!, singlePaint!)
    const stroked = pieces?.map((piece, index) => possibleShapeStroke(piece, paints![index]!))
    const singleStroked = pieces ? false : possibleShapeStroke(singleGeometry!, singlePaint!)
    if (!(filled ? filled.some(Boolean) : singleFilled) && !(stroked ? stroked.some(Boolean) : singleStroked)) continue
    const m = scenePrimitiveMatrix(primitive)!
    const [a, b, c, d, e, f] = m
    const transform: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    let bounds: AxisAlignedBox | undefined
    const partBounds: Array<AxisAlignedBox | undefined> | undefined = pieces ? [] : undefined
    for (let index = 0, count = pieces?.length ?? 1; index < count; index++) {
      if (pieces && !(index in pieces)) continue
      const geometry = pieces ? pieces[index]! : singleGeometry!, paint = paints ? paints[index]! : singlePaint!
      if (!(filled ? filled[index] : singleFilled) && !(stroked ? stroked[index] : singleStroked)) continue
      // Do not keep an invisible sibling's geometry in the possible ink box.
      // Unknown child bounds retain the original conservative primitive box.
      const painted = nodePaintBounds({ kind: 'shape', id: primitive.id, role: primitive.role, geometry, paint }, transform)
      const part = painted ?? primitive.bounds!
      if (partBounds) partBounds[index] = part
      bounds = unionSceneBounds(bounds, part)
    }
    if (!bounds) continue
    const candidate = { primitive, bounds, borderWidth: outlines.get(outlineKey(primitive, geometry)), ...(pieces ? {
      partBorderWidths: pieces.map(child => outlines.get(outlineKey(primitive, child)) ?? 0),
      partOwnBorderWidths: paints!.map(opaqueOutlineWidth),
      partFilled: filled!, partBounds: partBounds!,
    } : {}) }
    // A rotated/sheared AABB is not a solid rectangle. Keep it out of this
    // exact test instead of interpreting empty corners as painted pixels.
    if (Math.abs(m[1]) > 1e-12 || Math.abs(m[2]) > 1e-12) { surfaces.push(candidate); continue }
    const interiors: AxisAlignedBox[] = [], strokeInteriors: AxisAlignedBox[] = []
    for (let index = 0, count = pieces?.length ?? 1; index < count; index++) {
      if (pieces && !(index in pieces)) continue
      const g = pieces ? pieces[index]! : singleGeometry!, paint = paints ? paints[index]! : singlePaint!
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
      if (!(filled ? filled[index] : singleFilled) || g.kind !== 'rect' || sceneGroupOpacity(paint.opacity) !== 1 || sceneGroupOpacity(paint.fillOpacity) !== 1 || !paint.fill || !opaque(paint.fill)) continue
      const rx = Math.min(g.width / 2, g.rx ?? g.ry ?? 0), ry = Math.min(g.height / 2, g.ry ?? g.rx ?? 0)
      const a = transformPoint({ x: g.x + rx, y: g.y + ry }, m)
      const b = transformPoint({ x: g.x + g.width - rx, y: g.y + g.height - ry }, m)
      interiors.push({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
    }
    surfaces.push({ ...candidate, interiors, strokeInteriors })
  }
  return surfaces
}

/** Conservative marker envelopes can overlap empty corners of endpoint shapes.
 * A separating side or radius proves absence; other intersections stay unknown.
 */
function outsideFilledBody(surface: Surface, bounds: AxisAlignedBox, attached: boolean, hull?: readonly ScenePoint[], padding = 0, work: () => boolean = () => true, witnesses?: readonly ScenePoint[], anchor?: ScenePoint, strict = false): boolean {
  const shape = paintPrimitiveSource(surface.primitive)
  if (shape?.kind !== 'shape') return false
  const inverse = inverseMatrix(scenePrimitiveMatrix(surface.primitive)!)
  if (!inverse) return false
  const { geometry, paint: shapePaint, childPaints } = shape
  const corners = (hull ?? [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x0, y: bounds.y1 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }]).map(point => transformPoint(point, inverse))
  const [a, b, c, d] = inverse
  const inverseNorm = (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2
  const margin = padding * inverseNorm
  const localAnchor = anchor ? transformPoint(anchor, inverse) : undefined
  // An attached arrow's stroke can meet its endpoint outline. Exclude only
  // that declared border band; a marker entering the filled body stays checked.
  let contactAllowed = false
  let contactWitness: ScenePoint | undefined
  let sideContact: readonly Geometry[] = []
  const outside = (g: Geometry, borderWidth = surface.borderWidth ?? 0, paint = shapePaint, filled = true, painted = surface.bounds, witness?: ScenePoint): boolean => {
    if (!work()) return false
    if (!witness && sideContact.includes(g)) return true
    if (witness && (witness.x < painted.x0 || witness.x > painted.x1 || witness.y < painted.y0 || witness.y > painted.y1)) return true
    const samples = witness ? [transformPoint(witness, inverse)] : corners
    let sampleMargin = witness ? 0 : margin
    const tolerance = witness ? -1e-8 : strict ? 0 : 1e-8
    const lineTolerance = witness ? -1e-8 : 0
    // The shape writer admits one compound level only. Never reinterpret
    // nested indices as the root's independently painted siblings.
    if (g.kind === 'compound') return g === geometry && g.children.length <= 64 && g.children.every((child, index) => child.kind !== 'compound' && outside(child, surface.partBorderWidths?.[index] ?? 0, childPaints?.[index] ?? shapePaint, surface.partFilled?.[index] ?? true, surface.partBounds?.[index] ?? surface.bounds, witness))
    if (!filled) {
      // An absent/translucent fill does not occlude the retained ink, but its
      // independently emitted stroke still needs a conservative separator.
      if (sceneGroupOpacity(paint.opacity) === 0 || sceneGroupOpacity(paint.strokeOpacity) === 0 || paintedStrokeExtent(paint, g.kind !== 'line') === 0) return true
    }
    if (g.kind === 'line') {
      // Only a real endpoint cap contact may reuse the same point already
      // clear of EVERY endpoint piece. A line through the marker body retains
      // its complete hull check even if some filled witnesses survive.
      if (!witness && contactWitness && localAnchor && ['butt', 'round', 'square'].includes(paint.strokeLinecap ?? 'butt')) {
        if (!work()) return false
        const dx = g.x2 - g.x1, dy = g.y2 - g.y1
        const direction = localAnchor.x === g.x1 && localAnchor.y === g.y1 ? 1
          : localAnchor.x === g.x2 && localAnchor.y === g.y2 ? -1 : 0
        if (direction && Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)
          && corners.every(p => {
            if (!work()) return false
            const projection = ((p.x - localAnchor.x) * dx + (p.y - localAnchor.y) * dy) * direction
            return Number.isFinite(projection) && projection <= 0
          })) return outside(g, borderWidth, paint, filled, painted, contactWitness)
      }
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
    if (g.kind === 'rect') {
      // SVG rounds by an ellipse swept over the remaining central rectangle.
      // Its support function separates the entire marker hull, rather than
      // treating empty rounded corners as filled artwork.
      const rx = Math.min(g.width / 2, g.rx ?? g.ry ?? 0), ry = Math.min(g.height / 2, g.ry ?? g.rx ?? 0)
      if (rx > 0 && ry > 0) {
        // A clipped cardinal endpoint can be separated by the exact axial
        // support although none of the corner-derived normals finds it. This
        // added proof requires unchanged emitted shape/stroke coordinates;
        // composed or rounded transforms retain the existing conservative test.
        const exactAxes = !shape.transform && scenePrimitiveUntransformed(surface.primitive)
          && inverse.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])
          && Number(formatSvgNumber(borderWidth)) === borderWidth
          && Number.parseFloat(formatSvgNumericAttribute('stroke-width', paint.strokeWidth ?? '1')) === Number.parseFloat(paint.strokeWidth ?? '1')
        const exactX = exactAxes && Number(formatSvgNumber(g.x)) === g.x && Number(formatSvgNumber(g.width)) === g.width
        const exactY = exactAxes && Number(formatSvgNumber(g.y)) === g.y && Number(formatSvgNumber(g.height)) === g.height
        if (exactX && (samples.every(p => work() && p.x + sampleMargin <= g.x + inset + tolerance)
          || samples.every(p => work() && p.x - sampleMargin >= g.x + g.width - inset - tolerance))
          || exactY && (samples.every(p => work() && p.y + sampleMargin <= g.y + inset + tolerance)
          || samples.every(p => work() && p.y - sampleMargin >= g.y + g.height - inset - tolerance))) return true
        const cx = g.x + g.width / 2, cy = g.y + g.height / 2
        const halfWidth = g.width / 2 - rx, halfHeight = g.height / 2 - ry
        for (const point of samples) {
          if (!work()) return false
          const dx = point.x - cx, dy = point.y - cy
          const nx = (dx - Math.max(-halfWidth, Math.min(halfWidth, dx))) / (rx * rx)
          const ny = (dy - Math.max(-halfHeight, Math.min(halfHeight, dy))) / (ry * ry)
          const norm = Math.hypot(nx, ny)
          if (!norm) continue
          const x = nx / norm, y = ny / norm
          const support = halfWidth * Math.abs(x) + halfHeight * Math.abs(y) + Math.hypot(rx * x, ry * y) - inset + sampleMargin
          if (samples.every(p => work() && (p.x - cx) * x + (p.y - cy) * y >= support - tolerance)) return true
        }
        return false
      }
    }
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
    if (!direction || !points.every((a, i) => points.every(point => work() && direction * cross(a, points[(i + 1) % points.length]!, point) >= -(witness || strict ? 0 : 1e-8)))) return false
    return points.some((a, i) => {
      const b = points[(i + 1) % points.length]!, length = Math.hypot(b.x - a.x, b.y - a.y)
      return length > 0 && samples.every(p => work() && direction * cross(a, b, p) <= (inset - sampleMargin + tolerance) * length)
    })
  }
  // A contact allowance cannot establish visibility by itself. At least one
  // actual marker-ink point must clear every emitted endpoint piece, including
  // its full stroke, before allowing a partial owned border contact.
  if (attached) contactWitness = witnesses?.find(witness => work() && outside(geometry, surface.borderWidth ?? 0, shapePaint, true, surface.bounds, witness))
  contactAllowed = contactWitness !== undefined
  // Native cylinders emit a bare body first, then its left/right side lines.
  // Other child orders retain uncertainty. Every cap/extra piece stays checked.
  if (contactAllowed && localAnchor && geometry.kind === 'compound'
    && inverse.every((value, index) => value === [1, 0, 0, 1, 0, 0][index])) {
    const body = geometry.children[0]
    if (work() && body?.kind === 'rect' && !body.rx && !body.ry && surface.partFilled?.[0]
      && paintedStrokeExtent(childPaints?.[0] ?? shapePaint, false) === 0) {
      const index = localAnchor.x === body.x ? 1 : localAnchor.x === body.x + body.width ? 2 : 0
      const line = geometry.children[index], width = surface.partOwnBorderWidths?.[index] ?? 0
      if (index && line?.kind === 'line' && width > 0 && line.x1 === line.x2 && line.x1 === localAnchor.x
        && Math.min(line.y1, line.y2) === body.y && Math.max(line.y1, line.y2) === body.y + body.height
        && localAnchor.y > body.y && localAnchor.y < body.y + body.height
        && corners.every(point => work() && (index === 1 ? -1 : 1) * (point.x - line.x1) >= margin - width / 2)) sideContact = [body, line]
    }
  }
  return outside(geometry)
}

/** A hidden, unscaled SVG marker viewport clips ALL resource ink, including
 * round joins outside a polygon hull. A reference on its vertical boundary
 * therefore supplies one exact half-plane at a cardinal route endpoint.
 * Admit decimal normalization only as a tangential translation: the raw and
 * written routes must share the same nonzero cardinal direction and axial
 * anchor. The emitted region supplies witnesses AND broadphase bounds, not
 * just a clipping exemption downstream of a raw-coordinate spatial lookup. */
function emittedEndpointMarker(node: NativeConnectorPaintSource, marker: MarkerDescriptor | undefined, raw: ConnectorMarkerPaintRegion, work: () => boolean): { region: ConnectorMarkerPaintRegion; clipped: AxisAlignedBox } | undefined {
  const { position, anchor } = raw
  for (let i = 0; i < 18; i++) if (!work()) return undefined
  if (!marker || position === 'mid' || node.transform || node.route.closed || node.stroke.nonScaling
    || marker.overflow === 'visible' || (marker.scale ?? 1) !== 1 || marker.paint?.vectorEffect === 'non-scaling-stroke'
    || marker.orient !== undefined && marker.orient !== 'auto' && marker.orient !== 'auto-start-reverse'
    || !marker.size || !marker.ref || !(marker.size.width > 0) || !(marker.size.height > 0)
    || !Number.isFinite(marker.size.width + marker.size.height + marker.ref.x + marker.ref.y)
    || marker.ref.y < 0 || marker.ref.y > marker.size.height
    || marker.ref.x !== 0 && marker.ref.x !== marker.size.width
    || marker.viewBox && (marker.viewBox.x !== 0 || marker.viewBox.y !== 0 || marker.viewBox.width !== marker.size.width || marker.viewBox.height !== marker.size.height)) return undefined
  const geometry = node.route.geometry
  let first: ScenePoint | undefined, next: ScenePoint | undefined
  const take = (x: number, y: number): boolean => {
    if (!work() || !Number.isFinite(x) || !Number.isFinite(y)) return false
    if (!first) first = { x, y }
    else if (x !== first.x || y !== first.y) { next = { x, y }; return false }
    return true
  }
  if (geometry.kind === 'line') {
    if (!take(position === 'start' ? geometry.x1 : geometry.x2, position === 'start' ? geometry.y1 : geometry.y2)) return undefined
    take(position === 'start' ? geometry.x2 : geometry.x1, position === 'start' ? geometry.y2 : geometry.y1)
  } else if (geometry.kind === 'polyline') {
    for (let i = 0; i < geometry.points.length; i++) {
      const point = geometry.points[position === 'start' ? i : geometry.points.length - i - 1]!
      if (!take(point.x, point.y)) break
    }
  } else return undefined
  if (!first || !next || first.x !== anchor.x || first.y !== anchor.y || first.x !== next.x && first.y !== next.y) return undefined
  const written = (point: ScenePoint): ScenePoint => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) })
  const startPoint = written(first), nextPoint = written(next)
  const horizontal = first.y === next.y
  if (![startPoint.x, startPoint.y, nextPoint.x, nextPoint.y].every(Number.isFinite)
    || horizontal && (startPoint.x !== first.x || startPoint.y !== nextPoint.y || Math.sign(nextPoint.x - startPoint.x) !== Math.sign(next.x - first.x))
    || !horizontal && (startPoint.y !== first.y || startPoint.x !== nextPoint.x || Math.sign(nextPoint.y - startPoint.y) !== Math.sign(next.y - first.y))) return undefined
  // Omitted markerUnits means strokeWidth. A changed emitted width scales
  // both the viewport and resource ink, so translation alone proves nothing.
  let width = 1
  if (marker.units !== 'userSpaceOnUse') {
    const rawWidth = String(node.stroke.width)
    if (!/^\s*(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(rawWidth)) return undefined
    width = Number.parseFloat(typeof node.stroke.width === 'number' ? formatSvgNumber(node.stroke.width) : formatSvgNumericAttribute('stroke-width', node.stroke.width))
    if (!(width > 0) || !Number.isFinite(width) || width !== Number.parseFloat(rawWidth)) return undefined
  }
  const start = position === 'start' ? startPoint : nextPoint, end = position === 'start' ? nextPoint : startPoint
  const tangent = { x: end.x - start.x, y: end.y - start.y }
  const emitted = connectorMarkerPaintRegions({ route: { geometry: { kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y }, closed: false,
    contours: [{ start, end, closed: false, startTangent: tangent, endTangent: tangent }] }, stroke: { width }, markers: { mid: [], ...(position === 'start' ? { start: marker } : { end: marker }) } })[0]
  if (!work() || !emitted?.bounds || !raw.bounds) return undefined
  const bounds = unionSceneBounds(raw.bounds, emitted.bounds)!
  // The SVG orient="auto" start marker follows the forward path tangent.
  const reverse = position === 'end' ? -1 : marker.orient === 'auto-start-reverse' ? -1 : 1
  const side = marker.ref.x === 0 ? 1 : -1
  const dx = Math.sign(next.x - first.x) * reverse * side
  const dy = Math.sign(next.y - first.y) * reverse * side
  if (!work()) return undefined
  const clipped = {
    x0: dx > 0 ? Math.max(bounds.x0, emitted.anchor.x) : bounds.x0,
    y0: dy > 0 ? Math.max(bounds.y0, emitted.anchor.y) : bounds.y0,
    x1: dx < 0 ? Math.min(bounds.x1, emitted.anchor.x) : bounds.x1,
    y1: dy < 0 ? Math.min(bounds.y1, emitted.anchor.y) : bounds.y1,
  }
  return clipped.x0 <= clipped.x1 && clipped.y0 <= clipped.y1 ? { region: { ...emitted, bounds }, clipped } : undefined
}

/** Strict interior points of an emitted convex polygon fill, rather than
 * corners of its conservative stroke envelope. Clipped-away ink is excluded. */
function markerInkWitnesses(marker: MarkerDescriptor | undefined, hull: readonly ScenePoint[] | undefined, resolveColor: (value: string) => string | undefined, work: () => boolean): readonly ScenePoint[] | undefined {
  if (!marker || !hull || marker.geometry?.kind !== 'polygon' || (marker.scale ?? 1) > 1 || sceneGroupOpacity(marker.paint?.opacity) !== 1 || sceneGroupOpacity(marker.paint?.fillOpacity) !== 1 || !marker.paint?.fill) return undefined
  const fill = resolveColor(marker.paint.fill)
  if (!fill || tryParseCssColor(fill)?.[3] !== 1) return undefined
  const points = marker.geometry.points
  if (points.length < 3 || points.length > 64 || points.length !== hull.length) return undefined
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a.x * b.y - b.x * a.y }, 0)
  const sign = Math.sign(area)
  if (!sign || !points.every((a, i) => points.every(p => work() && sign * ((points[(i + 1) % points.length]!.x - a.x) * (p.y - a.y) - (points[(i + 1) % points.length]!.y - a.y) * (p.x - a.x)) >= 0))) return undefined
  const centroid = (vertices: readonly ScenePoint[]): ScenePoint => ({ x: vertices.reduce((sum, p) => sum + p.x, 0) / vertices.length, y: vertices.reduce((sum, p) => sum + p.y, 0) / vertices.length })
  const local = centroid(points), world = centroid(hull)
  const viewport = marker.viewBox ?? (marker.size ? { x: 0, y: 0, width: marker.size.width, height: marker.size.height } : undefined)
  const witnesses: ScenePoint[] = []
  for (let index = -1, length = points.length; index < length; index++) {
    if (!work()) continue
    const p = index < 0 ? local : { x: (local.x + points[index]!.x) / 2, y: (local.y + points[index]!.y) / 2 }
    if (marker.overflow !== 'visible' && (!viewport || !(p.x > viewport.x && p.x < viewport.x + viewport.width && p.y > viewport.y && p.y < viewport.y + viewport.height))) continue
    witnesses.push(index < 0 ? world : { x: (world.x + hull[index]!.x) / 2, y: (world.y + hull[index]!.y) / 2 })
  }
  return witnesses
}

/** Nonempty actual marker ink is required for a hard hidden-marker claim.
 * This source-space existence proof also admits filled round markers and
 * open stroked line crosses; it does not infer ink from a declared envelope. */
function markerHasInk(marker: MarkerDescriptor | undefined, witnesses: readonly ScenePoint[] | undefined, resolveColor: (value: string) => string | undefined, work: () => boolean): boolean {
  if (witnesses?.length) return true
  if (!marker?.geometry || sceneGroupOpacity(marker.paint?.opacity) !== 1) return false
  const viewport = marker.viewBox ?? (marker.size ? { x: 0, y: 0, width: marker.size.width, height: marker.size.height } : undefined)
  const visible = (p: ScenePoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && (marker.overflow === 'visible' || !!viewport && p.x > viewport.x && p.x < viewport.x + viewport.width && p.y > viewport.y && p.y < viewport.y + viewport.height)
  const opaque = (color: string | undefined): boolean => {
    if (!color || !work()) return false
    const value = resolveColor(color)
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

interface MarkerPieceSource {
  readonly marker: MarkerDescriptor
  readonly anchor: ScenePoint
  readonly tangent: ScenePoint
  readonly position: 'start' | 'end'
  readonly width: number
}

export interface MarkerPolygonProof {
  /** Exact resource and pose after native line/polyline numeric serialization. */
  readonly repaint: { readonly resource: string; readonly anchor: ScenePoint; readonly geometry: 'polygon' | 'polyline' }
  readonly hull: readonly ScenePoint[]
  readonly strokeWitnesses: readonly ScenePoint[]
  readonly strokeColor?: readonly number[]
  readonly fillColor?: readonly number[]
  readonly fill: 'opaque' | 'absent' | 'unknown'
  readonly stroke: 'visible' | 'absent' | 'unknown'
  readonly innerStroke: number | undefined
  readonly padding: number | undefined
  readonly paintPieceSource?: MarkerPieceSource
}

/** A sufficient emitted-ink proof, deliberately smaller than marker support.
 * Source matrix composition cannot recover the rounding of individual SVG
 * group transforms. Those cases stay unknown; no affine envelope is ink.
 * The canonical region authority supplies the normalized polygon's mapping.
 * Consumers may share their guarded color resolver; direct calls resolve live.
 */
export function prepareMarkerPolygonInk(scene: Pick<NativePaintHeader, 'colors'>, node: NativeConnectorPaintSource, marker: MarkerDescriptor | undefined, position: 'start' | 'mid' | 'end', work: () => boolean, resolveColor: ((value: string) => string | undefined) | undefined = undefined): MarkerPolygonProof | undefined {
  const pay = (count: number): boolean => { for (let i = 0; i < count; i++) if (!work()) return false; return true }
  if (!pay(3) || !marker || position === 'mid' || (marker.geometry?.kind !== 'polygon' && marker.geometry?.kind !== 'polyline') || marker.geometry.points.length < 3 || marker.geometry.points.length > 64
    || node.transform
    || marker.geometry.kind === 'polyline' && marker.paint?.strokeLinecap !== undefined && !['butt', 'round'].includes(marker.paint.strokeLinecap)
    || node.route.closed || node.stroke.nonScaling || node.stroke.mixBlendMode && node.stroke.mixBlendMode !== 'normal'
    || (marker.scale ?? 1) !== 1 || marker.paint?.vectorEffect === 'non-scaling-stroke'
    || marker.paint?.strokeLinejoin && !['miter', 'round', 'bevel'].includes(marker.paint.strokeLinejoin)
    || !marker.size || !marker.ref || !(marker.size.width > 0) || !(marker.size.height > 0)
    || !Number.isFinite(marker.size.width + marker.size.height + marker.ref.x + marker.ref.y)
    || marker.viewBox && (!(marker.viewBox.width > 0) || !(marker.viewBox.height > 0) || !Number.isFinite(marker.viewBox.x + marker.viewBox.y + marker.viewBox.width + marker.viewBox.height))) return undefined
  const rawWidth = String(node.stroke.width)
  if (!/^\s*(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(rawWidth)) return undefined
  const written = (value: number): number => Number(formatSvgNumber(value))
  const width = Number.parseFloat(typeof node.stroke.width === 'number' ? formatSvgNumber(node.stroke.width) : formatSvgNumericAttribute('stroke-width', node.stroke.width))
  if (!(width > 0) || !Number.isFinite(width) || !pay(12 + 5 * marker.geometry.points.length)) return undefined
  const geometry = node.route.geometry
  let first: ScenePoint | undefined, next: ScenePoint | undefined
  const take = (x: number, y: number): boolean => {
    if (!work()) return false
    const p = { x: written(x), y: written(y) }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
    if (!first) first = p
    else if (p.x !== first.x || p.y !== first.y) { next = p; return false }
    return true
  }
  if (geometry.kind === 'line') {
    take(position === 'start' ? geometry.x1 : geometry.x2, position === 'start' ? geometry.y1 : geometry.y2)
    take(position === 'start' ? geometry.x2 : geometry.x1, position === 'start' ? geometry.y2 : geometry.y1)
  } else if (geometry.kind === 'polyline') {
    for (let i = 0; i < geometry.points.length; i++) {
      const p = geometry.points[position === 'start' ? i : geometry.points.length - i - 1]!
      if (!take(p.x, p.y)) break
    }
  } else return undefined
  if (!first || !next || !work() || first.x !== next.x && first.y !== next.y) return undefined
  // Marker resources serialize their finite descriptor numbers verbatim;
  // connector attributes alone use the SVG writer's decimal normalization.
  const points = marker.geometry.points
  // A polyline's fill closes implicitly in SVG. Reuse the polygon mapping for
  // its vertex positions, but only its actual open segments supply stroke ink.
  const local = marker.geometry.kind === 'polygon' ? marker : { ...marker, geometry: { kind: 'polygon' as const, points } }
  const tangent = position === 'start' ? { x: next.x - first.x, y: next.y - first.y } : { x: first.x - next.x, y: first.y - next.y }
  const start = position === 'start' ? first : next, end = position === 'start' ? next : first
  const line = { kind: 'line' as const, x1: start.x, y1: start.y, x2: end.x, y2: end.y }
  const region = connectorMarkerPaintRegions({ route: { ...node.route, geometry: line, contours: [{ start, end, closed: false, startTangent: tangent, endTangent: tangent }] }, stroke: { ...node.stroke, width }, markers: { mid: [], ...(position === 'start' ? { start: local } : { end: local }) } })[0]
  const hull = region?.hull
  if (!hull || hull.length !== points.length || !pay(hull.length)) return undefined
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!
    for (const p of hull) {
      if (!work()) return undefined
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
      if (!Number.isFinite(cross)) return undefined
      if (cross) { if (sign && Math.sign(cross) !== sign) return undefined; sign ||= Math.sign(cross) }
    }
  }
  if (!sign) return undefined
  const viewport = local.viewBox ?? (local.size ? { x: 0, y: 0, ...local.size } : undefined)
  const unclipped = (p: ScenePoint): boolean => local.overflow === 'visible' || !!viewport && p.x > viewport.x && p.x < viewport.x + viewport.width && p.y > viewport.y && p.y < viewport.y + viewport.height
  const paint = marker.paint ?? {}
  const color = (value: string | undefined): RgbaColor | undefined => {
    if (!value || !work()) return undefined
    const resolved = resolveColor ? resolveColor(value) : resolveInlineColorAttribute(value, scene.colors)
    return resolved ? tryParseCssColor(resolved) ?? undefined : undefined
  }
  const fillColor = color(paint.fill), strokeColor = color(paint.stroke)
  // The resource writer emits opacity, but not fillOpacity/strokeOpacity.
  // Proofs follow emitted attributes rather than un-emitted descriptor hints.
  const opacity = sceneGroupOpacity(paint.opacity)
  const fill = paint.fill === 'none' || opacity < 1 || !!fillColor && fillColor[3] < 1 ? 'absent'
    : fillColor?.[3] === 1 && opacity === 1 && points.every(p => work() && unclipped(p)) ? 'opaque' : 'unknown'
  const noStroke = paint.stroke === undefined || paint.stroke === 'none' || opacity === 0 || strokeColor?.[3] === 0
  const strokeWidth = paint.strokeWidth ?? '1'
  const knownWidth = /^\s*(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(strokeWidth) ? Number.parseFloat(strokeWidth) : undefined
  const unit = (local.units === 'userSpaceOnUse' ? 1 : width) * (local.viewBox && local.size ? Math.min(local.size.width / local.viewBox.width, local.size.height / local.viewBox.height) : 1)
  const innerStroke = noStroke ? 0 : knownWidth !== undefined && Number.isFinite(knownWidth * unit) ? knownWidth * unit / 2 : undefined
  const stroke = noStroke || knownWidth === 0 ? 'absent' : knownWidth !== undefined && knownWidth > 0 && strokeColor?.[3] === 1 && opacity === 1 && !paint.strokeDasharray ? 'visible' : 'unknown'
  const strokeWitnesses: ScenePoint[] = []
  if (!noStroke && knownWidth !== undefined && knownWidth > 0 && strokeColor?.[3] === 1 && opacity === 1 && !paint.strokeDasharray) {
    for (let i = 0; i < points.length - (marker.geometry.kind === 'polyline' ? 1 : 0); i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!
      if (a.x === b.x && a.y === b.y) continue
      // Fixed dyadic interior points are actual stroke ink; unlike a convex
      // hull corner or a cap boundary, none invents an unpainted segment.
      for (let sample = 1; sample < 4; sample++) {
        if (!pay(3)) return undefined
        const t = sample / 4, p = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t }
        if (unclipped(p)) strokeWitnesses.push({ x: hull[i]!.x * (1 - t) + hull[(i + 1) % hull.length]!.x * t, y: hull[i]!.y * (1 - t) + hull[(i + 1) % hull.length]!.y * t })
      }
    }
    // A closed vertex or an open interior join is genuine stroke interior.
    // Open butt-cap endpoints are deliberately not promoted to opaque points.
    const firstJoin = marker.geometry.kind === 'polygon' ? 0 : 1
    const lastJoin = points.length - (marker.geometry.kind === 'polygon' ? 0 : 1)
    for (let i = firstJoin; i < lastJoin; i++) {
      if (!pay(2)) return undefined
      const a = points[(i + points.length - 1) % points.length]!, b = points[i]!, c = points[(i + 1) % points.length]!
      if ((a.x !== b.x || a.y !== b.y) && (b.x !== c.x || b.y !== c.y) && unclipped(b)) strokeWitnesses.push(hull[i]!)
    }
  }
  // The all-piece proof is constructed only after the old padded fast paths
  // fail. This request-local descriptor carries the already-proved mapping.
  let matchedHiddenViewport = false
  if (marker.overflow === 'hidden') {
    if (!pay(5)) return undefined
    matchedHiddenViewport = marker.viewBox?.x === 0 && marker.viewBox.y === 0
      && marker.viewBox.width === marker.size.width && marker.viewBox.height === marker.size.height
  }
  let paintPieceSource: MarkerPieceSource | undefined
  if ((marker.overflow === 'visible' || matchedHiddenViewport) &&
    (marker.orient === undefined || marker.orient === 'auto' || marker.orient === 'auto-start-reverse') &&
    fill !== 'unknown' &&
    stroke !== 'unknown' &&
    opacity === 1 &&
    (marker.geometry.kind === 'polygon' || paint.fill === 'none' || fillColor?.[3] === 0) &&
    !paint.strokeDasharray &&
    (paint.strokeLinecap === undefined || paint.strokeLinecap === 'butt') &&
    (paint.strokeLinejoin === undefined || paint.strokeLinejoin === 'miter') &&
    (paint.strokeMiterlimit === undefined || Number(paint.strokeMiterlimit) === 4)) {
    if (matchedHiddenViewport && !pay(16)) return undefined
    // Only the proof uses an unclipped stencil. Its full paint is a superset
    // of the actual hidden marker, so strict separation proves visibility
    // without asserting a clipping boundary or changing the emitted resource.
    const stencil: MarkerDescriptor = matchedHiddenViewport ? {
      id: marker.id, shape: marker.shape, geometry: marker.geometry, paint: marker.paint,
      units: marker.units, size: marker.size, ref: marker.ref, orient: marker.orient,
      viewBox: marker.viewBox, scale: marker.scale, overflow: 'visible',
    } : marker
    paintPieceSource = { marker: stencil, anchor: first, tangent, position, width }
  }
  if (paintPieceSource && !work()) return undefined
  // Reuse the normalized region's full resource/pose identity. The hull
  // mapping closes polylines, so retain their original stroke topology too.
  if (!pay(6)) return undefined
  const repaint = { resource: region!.repaint, anchor: first, geometry: marker.geometry.kind }
  return { repaint, hull, fill, stroke, fillColor, strokeColor, innerStroke, strokeWitnesses, padding: region.padding, ...(paintPieceSource ? { paintPieceSource } : {}) }
}


function measuredMarkerPaintPieces(source: MarkerPieceSource, work: () => boolean): readonly MarkerPaintPiece[] | undefined {
  const geometry = source.marker.geometry!
  if (geometry.kind !== 'polygon' && geometry.kind !== 'polyline') return undefined
  const points = geometry.points,
    joins = geometry.kind === 'polygon' ? points.length : points.length - 2
  for (let join = 0; join < joins; join++) {
    for (let i = 0; i < 8; i++) if (!work()) return undefined
    const i = geometry.kind === 'polygon' ? join : join + 1
    const a = points[(i + points.length - 1) % points.length]!,
      b = points[i]!,
      c = points[(i + 1) % points.length]!
    const ax = b.x - a.x,
      ay = b.y - a.y,
      bx = c.x - b.x,
      by = c.y - b.y
    const an = Math.hypot(ax, ay),
      bn = Math.hypot(bx, by),
      dot = (ax / an) * (bx / bn) + (ay / an) * (by / bn)
    // Miter ratio squared is2/(1+dot). Keep it strictly below limit4,
    // rejecting the numerically ambiguous cutoff rather than beveling ink.
    if (!(an > 0) || !(bn > 0) || !Number.isFinite(dot) || dot <= -0.875 + 128 * Number.EPSILON) return undefined
  }
  const stopped = {}
  let pieces: readonly MarkerPaintPiece[]
  try {
    pieces = markerPaintPieces(source.marker, source.anchor, source.tangent, source.position, source.width, () => {
      if (!work()) throw stopped
    })
  } catch (error) {
    if (error === stopped) return undefined
    throw error
  }
  for (const piece of pieces) {
    if (!work() || piece.kind !== 'polygon' || piece.points.length < 3) return undefined
    let area = 0
    for (let i = 0; i < piece.points.length; i++) {
      if (!work()) return undefined
      const p = piece.points[i]!,
        q = piece.points[(i + 1) % piece.points.length]!
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined
      area += (p.x - piece.points[0]!.x) * (q.y - piece.points[0]!.y) - (p.y - piece.points[0]!.y) * (q.x - piece.points[0]!.x)
    }
    if (!Number.isFinite(area) || area === 0) return undefined
  }
  return pieces
}

/** All early paint must separate from ALL later paint, including its outline.
 * A positive numerical margin only declines near-contact proof; it never
 * turns overlapping ink into a separator. No opaque witness is added here. */
function separatedMarkerPaintPieces(left: readonly MarkerPaintPiece[], right: readonly MarkerPaintPiece[], work: () => boolean): boolean {
  for (const a of left)
    for (const b of right) {
      if (!work() || a.kind !== 'polygon' || b.kind !== 'polygon') return false
      let separated = false
      for (const polygon of [a.points, b.points]) {
        for (let i = 0; i < polygon.length; i++) {
          if (!work()) return false
          const p = polygon[i]!,
            q = polygon[(i + 1) % polygon.length]!,
            dx = p.y - q.y,
            dy = q.x - p.x,
            norm = Math.hypot(dx, dy)
          if (!(norm > 0) || !Number.isFinite(norm)) continue
          const nx = dx / norm,
            ny = dy / norm,
            origin = a.points[0]!
          let lo = Infinity,
            hi = -Infinity,
            low = Infinity,
            high = -Infinity,
            magnitude = 1
          for (const v of a.points) {
            if (!work()) return false
            const projection = (v.x - origin.x) * nx + (v.y - origin.y) * ny
            lo = Math.min(lo, projection)
            hi = Math.max(hi, projection)
            magnitude = Math.max(magnitude, Math.abs(v.x), Math.abs(v.y))
          }
          for (const v of b.points) {
            if (!work()) return false
            const projection = (v.x - origin.x) * nx + (v.y - origin.y) * ny
            low = Math.min(low, projection)
            high = Math.max(high, projection)
            magnitude = Math.max(magnitude, Math.abs(v.x), Math.abs(v.y))
          }
          const margin = 1e-8 + 128 * Number.EPSILON * magnitude
          if (Number.isFinite(lo + hi + low + high) && (hi + margin < low || high + margin < lo)) {
            separated = true
            break
          }
        }
        if (separated) break
      }
      if (!separated) return false
    }
  return true
}

/** All painted pieces must separate even when the later marker has no fill.
 * This proof supplies no lost-ink witness or shared-color exemption. */
function compareMarkerPaintSeparation(earlier: MarkerPolygonProof | undefined, later: MarkerPolygonProof | undefined, work: () => boolean): 'clear' | 'unknown' | 'exhausted' {
  if (!work()) return 'exhausted'
  const empty = (proof: MarkerPolygonProof | undefined): boolean => proof?.fill === 'absent' && proof.stroke === 'absent' && (proof.fillColor?.[3] === 0 || proof.paintPieceSource?.marker.paint?.fill === 'none')
  if (empty(earlier) || empty(later)) return 'clear'
  if (!earlier?.paintPieceSource || !later?.paintPieceSource) return 'unknown'
  const stopped = {}
  const paid = (): boolean => { if (!work()) throw stopped; return true }
  try {
    const a = measuredMarkerPaintPieces(earlier.paintPieceSource, paid)
    if (a) {
      const b = measuredMarkerPaintPieces(later.paintPieceSource, paid)
      if (b && separatedMarkerPaintPieces(a, b, paid)) return 'clear'
    }
  } catch (error) { if (error === stopped) return 'exhausted'; throw error }
  return 'unknown'
}

/** Strict half-plane distance proves a real stroke point lies in opaque fill,
 * away from its own outline. Conservative hull padding proves separation only.
 */
export function compareMarkerStrokeInk(earlier: MarkerPolygonProof | undefined, later: MarkerPolygonProof | undefined, work: () => boolean, startWitness = 0): Readonly<ScenePoint> | 'clear' | 'unknown' {
  if (!work() || !Number.isSafeInteger(startWitness) || startWitness < 0) return 'unknown'
  if (later?.fill === 'absent' || earlier?.stroke === 'absent' && earlier.fill === 'absent') return 'clear'
  if (!earlier || !later) return 'unknown'
  const hull = later.hull
  if (earlier.innerStroke !== undefined) {
    let sign = 0
    for (let i = 0; i < earlier.hull.length; i++) {
      if (!work()) return 'unknown'
      const a = earlier.hull[i]!, b = earlier.hull[(i + 1) % earlier.hull.length]!, c = earlier.hull[(i + 2) % earlier.hull.length]!
      const cross = (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)
      if (cross) { sign = Math.sign(cross); break }
    }
    if (sign) for (let i = 0; i < earlier.hull.length; i++) {
      if (!work()) return 'unknown'
      const a = earlier.hull[i]!, b = earlier.hull[(i + 1) % earlier.hull.length]!, dx = b.x-a.x, dy = b.y-a.y, norm = Math.hypot(dx,dy)
      if (!norm) continue
      let outside = true
      for (const p of hull) {
        if (!work()) return 'unknown'
        const distance = sign*(dx*(p.y-a.y)-dy*(p.x-a.x))/norm
        const margin = 1e-8 + 64*Number.EPSILON*Math.max(1,Math.abs(p.x),Math.abs(p.y),Math.abs(a.x),Math.abs(a.y),Math.abs(b.x),Math.abs(b.y))
        if (!Number.isFinite(distance) || distance >= -earlier.innerStroke-margin) { outside=false;break }
      }
      if (outside) return 'clear'
    }
  }
  if (earlier.padding !== undefined && Number.isFinite(earlier.padding)) {
    for (const vertices of [earlier.hull, hull]) for (let i = 0; i < vertices.length; i++) {
      if (!work()) return 'unknown'
      const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!, nx = b.y - a.y, ny = a.x - b.x, norm = Math.hypot(nx, ny)
      if (!norm) continue
      let lo = Infinity, hi = -Infinity, low = Infinity, high = -Infinity
      for (const p of earlier.hull) { if (!work()) return 'unknown'; const v = (p.x - a.x) * nx + (p.y - a.y) * ny; lo = Math.min(lo, v); hi = Math.max(hi, v) }
      for (const p of hull) { if (!work()) return 'unknown'; const v = (p.x - a.x) * nx + (p.y - a.y) * ny; low = Math.min(low, v); high = Math.max(high, v) }
      if (hi + earlier.padding * norm < low || high < lo - earlier.padding * norm) return 'clear'
    }
  }
  if (earlier.paintPieceSource && later.paintPieceSource) {
    const separation = compareMarkerPaintSeparation(earlier, later, work)
    if (separation === 'clear') return 'clear'
    if (separation === 'exhausted') return 'unknown'
  }
  if (earlier.stroke !== 'visible' || later.fill !== 'opaque' || later.innerStroke === undefined) return 'unknown'
  // An identical opaque color can intentionally merge strokes and fill. It is
  // not a proof of lost visible ink under this narrowly scoped rule.
  if (!earlier.strokeColor || !later.fillColor) return 'unknown'
  let sameColor = true
  for (let i = 0; i < 3; i++) { if (!work()) return 'unknown'; if (earlier.strokeColor[i] !== later.fillColor[i]) sameColor = false }
  if (sameColor) return 'unknown'
  for (let witness = startWitness; witness < earlier.strokeWitnesses.length; witness++) {
    if (!work()) return 'unknown'
    const p = earlier.strokeWitnesses[witness]!
    let sign = 0, inside = true
    for (let i = 0; i < hull.length; i++) {
      if (!work()) return 'unknown'
      const a = hull[i]!, b = hull[(i + 1) % hull.length]!, dx = b.x - a.x, dy = b.y - a.y, norm = Math.hypot(dx, dy)
      const cross = dx * (p.y - a.y) - dy * (p.x - a.x)
      const margin = 1e-8 + 64 * Number.EPSILON * Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y))
      if (!Number.isFinite(cross) || !norm || Math.abs(cross) / norm <= later.innerStroke + margin || sign && Math.sign(cross) !== sign) { inside = false; break }
      sign ||= Math.sign(cross)
    }
    if (inside && sign) return p
  }
  return 'unknown'
}

/** A convex polygon's filled and stroked ink is contained by its outward
 * half-width offset half-planes (miter, round and bevel joins). A point beyond
 * any one plane therefore cannot be restored by that polygon's later ink. */
function outsideMarkerPolygon(proof: MarkerPolygonProof | undefined, p: Readonly<ScenePoint>, work: () => boolean): boolean {
  if (!proof || proof.innerStroke === undefined) return false
  const hull = proof.hull
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    if (!work()) return false
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!, c = hull[(i + 2) % hull.length]!
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (cross) { sign = Math.sign(cross); break }
  }
  if (!sign) return false
  for (let i = 0; i < hull.length; i++) {
    if (!work()) return false
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!, dx = b.x - a.x, dy = b.y - a.y
    const norm = Math.hypot(dx, dy), distance = sign * (dx * (p.y - a.y) - dy * (p.x - a.x)) / norm
    const margin = 1e-8 + 64 * Number.EPSILON * Math.max(1, Math.abs(p.x), Math.abs(p.y), Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y))
    if (Number.isFinite(distance) && distance < -proof.innerStroke - margin) return true
  }
  return false
}

function markerMayHaveOpaqueFill(resolveColor: (value: string) => string | undefined, marker: MarkerDescriptor | undefined, work: () => boolean): boolean {
  if (!work() || !marker) return true
  if (marker.geometry?.kind === 'line' || marker.paint?.fill === 'none' || marker.paint?.fill === 'transparent' || sceneGroupOpacity(marker.paint?.opacity) < 1) return false
  const value = marker.paint?.fill
  if (!value || !work()) return true
  const resolved = resolveColor(value), color = resolved ? tryParseCssColor(resolved) : null
  return !color || color[3] === 1
}


/** Resource equality alone cannot prove contextual or inherited paints equal
 * at distinct carriers. Only explicit resolved colors/none and known emitted
 * paint establish this narrower duplicate-paint proof. */
function markerPaintIdentity(marker: MarkerDescriptor | undefined, resolveColor: (value: string) => string | undefined, work: () => boolean): string | undefined {
  const paint = marker?.paint
  if (!work() || !paint || !Number.isFinite(sceneGroupOpacity(paint.opacity)) || paintedStrokeExtent(paint, true) === undefined
    || paint.strokeDasharray !== undefined && paint.strokeDasharray !== 'none' || paint.strokeDashoffset !== undefined
    || paint.paintOrder !== undefined && paint.paintOrder !== 'normal') return undefined
  if (!paint.fill || !paint.stroke || !work()) return undefined
  const fill = resolveColor(paint.fill)
  if (!fill || fill !== 'none' && !tryParseCssColor(fill) || !work()) return undefined
  const stroke = resolveColor(paint.stroke)
  if (!stroke || stroke !== 'none' && !tryParseCssColor(stroke)) return undefined
  return `${fill}\0${stroke}`
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
  const potentialOcclusion = (id: string, by: string, message: string): void => issue({ code: 'POTENTIAL_OCCLUSION', id, by, message })
  const unmeasuredPaint = (id: string, message: string, failure = false): void => issue({ code: 'UNMEASURED_PAINT', id, message }, failure)
  const outputScope = (message: string): void => issue({ code: 'OUTPUT_SCOPE', message })
  const emissionWork = nativeEmissionWorkOf(inspection)
  if (emissionWork && scene !== emissionWork.header) {
    outputScope('Retained emission is paired with a different document header')
    scene = emissionWork.header
  }
  let x0 = 0, y0 = 0, x1 = scene.width, y1 = scene.height, conditional = 0
  for (const primitive of inspection.primitives) {
    if (!emissionWork && hasNativeEmissionOccurrence(primitive)) outputScope('Native paint occurrences have no bound emission context')
    if (primitive.visibility === 'conditional') { conditional++; continue }
    if (primitive.coverage === 'unmeasured') unmeasuredPaint(primitive.id, primitive.reason ?? 'Paint geometry is unavailable')
    if (primitive.text && primitive.coverage !== 'non-painting' && primitive.text.measurement !== 'prepared') issue({ code: 'UNPREPARED_TEXT', id: primitive.id, message: 'Text was not retained from layout preparation' })
    const b = primitive.bounds
    if (b) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1) }
  }
  if (conditional) issue({ code: 'CONDITIONAL_PAINT', message: `${conditional} primitives depend on unresolved paint or interaction state` })
  if (options.outputSupported === false || scene.family.startsWith('family:')) outputScope('Selected backend, style or external family has no native final-paint proof')
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
  })) outputScope('Viewport expansion changes the user-unit extent of non-scaling strokes; final painted containment is unverified')
  let labels = 0
  const label = (id: string, bounds: { x: number; y: number; w: number; h: number } | undefined, container?: { x: number; y: number; w: number; h: number }): void => {
    labels++
    if (!bounds || !container) { unmeasuredPaint(id, 'Projected label has no retained occupied or available region'); return }
    let region = box(container)
    if (region.x0 === 0 && region.y0 === 0 && region.x1 === scene.width && region.y1 === scene.height) region = finalBounds
    if (!contains(region, box(bounds), TOLERANCE)) issue({ code: 'LABEL_CONTAINMENT', id, message: 'Retained text extends beyond its declared available region' }, true)
  }
  if (projection) {
    for (const node of projection.nodes) if (node.label?.trim() && node.labelVisibility !== 'hidden' && node.labelVisibility !== 'semantic') label(String(node.id), node.labelBounds, node.labelContainer)
    for (const value of projection.labels ?? []) if (value.text.trim() && value.visibility !== 'hidden' && value.visibility !== 'semantic') label(value.id, value.bounds, value.container)
  }
  const surfaces = tree(solidInteriors(scene, inspection.primitives))
  if (emissionWork?.uncertain) outputScope('Emitted document context or marker resource differs from retained paint evidence')
  let pairs = 0, operations = emissionWork?.operations ?? 0, exhausted = emissionWork?.exhausted ?? false
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
      else potentialOcclusion(primitive.id, surface.primitive.id, 'Later filled artwork overlaps the occupied text band; its exact ink intersection is unverified')
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
    if (extent === undefined) { unmeasuredPaint(primitive.id, 'Final connector stroke has no bounded cap/join extent'); continue }
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
          // Notes participate only for known semantic ink and a proved opaque
          // core. This does not turn lifelines or decorative rails into routes.
          const noteCore = exactInk && surface.primitive.role === 'note' && !!surface.interiors?.length
          if ((!CARD_ROLES.has(surface.primitive.role) && !noteCore) || surface.primitive.owner.id === primitive.owner.id && surface.primitive.owner.role === primitive.owner.role || !overlaps(surface.bounds, bounds)) continue
          const relation = endpointRelation(node, surface.primitive.owner)
          if (relation === 'attached') continue
          if (exactInk && line && separatedOrthogonalStroke(line, surface.bounds, node.stroke, width, extent, matrix, work)) continue
          if (exactInk && relation === 'unrelated' && line && surface.interiors?.some(interior => work() && lineCrossesInterior(line, interior))) issue({ code: 'CONNECTOR_CARD_CROSSING', id: primitive.id, by: surface.primitive.id, message: `Final connector shaft crosses opaque artwork owned by unrelated ${noteCore ? 'note' : 'card'} ${surface.primitive.owner.id}` }, true)
          else potentialOcclusion(primitive.id, surface.primitive.id, noteCore ? 'Final connector envelope intersects unrelated filled note artwork; actual route/note crossing is unverified' : 'Final connector envelope intersects unrelated filled card artwork; actual route/card crossing is unverified')
        }
      }
      walk(surfaces)
      return !exhausted
    }
    const geometry = node.route.geometry
    if (geometry.kind === 'path') {
      if (!visitTypedPathSegments(geometry.d, visit, work) && !exhausted) unmeasuredPaint(primitive.id, 'Final connector segments could not be measured from typed path geometry')
    } else {
      const points = geometry.kind === 'line' ? [{ x: geometry.x1, y: geometry.y1 }, { x: geometry.x2, y: geometry.y2 }] : geometry.points
      for (let i = 1; i < points.length; i++) {
        const first = points[i - 1]!, last = points[i]!
        if (!visit({ bounds: { x0: Math.min(first.x, last.x), y0: Math.min(first.y, last.y), x1: Math.max(first.x, last.x), y1: Math.max(first.y, last.y) }, line: [first, last] })) break
      }
    }
  }
  type MarkerTarget = { primitive: ScenePaintPrimitive; position: 'start' | 'mid' | 'end'; clipped?: AxisAlignedBox; anchor: ScenePoint; repaint: string; bounds: AxisAlignedBox; hull?: readonly ScenePoint[]; padding?: number; witnesses?: readonly ScenePoint[]; actualInk: boolean; strokeProof?: MarkerPolygonProof; paintIdentity?: string; semantic: boolean; mayFill: boolean }
  const lastMarkers = new Map<string, MarkerTarget>()
  let markerColor: ReturnType<typeof createInlineColorAttributeResolver> | undefined
  const resolveMarkerColor = (value: string): string | undefined => (markerColor ??= createInlineColorAttributeResolver())(value, scene.colors)
  for (const primitive of inspection.primitives) {
    const node = paintPrimitiveSource(primitive)
    if (primitive.kind !== 'connector' || node?.kind !== 'connector' || node.lineStyle === 'invisible' || primitive.coverage === 'non-painting') continue
    const ownInverse = inverseMatrix(transformMatrix(node.transform))
    if (!ownInverse) continue
    const [a, b, c, d, e, f] = composeMatrices(scenePrimitiveMatrix(primitive)!, ownInverse)
    const parent: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    for (const marker of connectorMarkerPaintRegions(node, parent)) {
      if (!marker.bounds) { unmeasuredPaint(primitive.id, 'Endpoint marker has no painted footprint'); continue }
      const key = JSON.stringify([primitive.owner.id, primitive.owner.role, marker.position, marker.resource, marker.anchor, marker.repaint])
      const knownUnitScale = (typeof node.stroke.width === 'number' ? Number.isFinite(node.stroke.width) && node.stroke.width > 0 : /^\s*(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?\s*$/i.test(node.stroke.width) && Number.parseFloat(node.stroke.width) > 0)
      const descriptor = marker.position === 'start' ? node.markers.start : marker.position === 'end' ? node.markers.end : node.markers.mid.length === 1 ? node.markers.mid[0] : undefined
      const measuredWorld = primitive.coverage === 'measured' && !!inverseMatrix(scenePrimitiveMatrix(primitive)!)
      const knownMapping = descriptor?.units === 'userSpaceOnUse' || knownUnitScale
      const previous = lastMarkers.get(key)
      const semantic = options.outputSupported !== false && !scene.family.startsWith('family:') && (['edge', 'relationship'].includes(primitive.role) && !!node.endpoints?.from && !!node.endpoints.to || previous?.semantic === true)
      const matrix = scenePrimitiveMatrix(primitive)
      const exactWorld = primitive.coverage === 'measured' && primitive.visibility !== 'conditional' && (primitive.groupOpacity ?? 1) === 1 && primitive.ancestors.length === 0
        && !!matrix && matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && matrix[4] === 0 && matrix[5] === 0
      const emitted = semantic && exactWorld && knownMapping ? emittedEndpointMarker(node, descriptor, marker, work) : undefined
      const region = emitted?.region ?? marker
      const witnesses = measuredWorld && knownMapping ? markerInkWitnesses(descriptor, region.hull, resolveMarkerColor, work) : undefined
      const actualInk = measuredWorld && knownMapping && descriptor?.paint?.vectorEffect !== 'non-scaling-stroke' && markerHasInk(descriptor, witnesses, resolveMarkerColor, work)
      const mayFill = markerMayHaveOpaqueFill(resolveMarkerColor, descriptor, work)
      const paintIdentity = semantic && (primitive.groupOpacity ?? 1) === 1 && primitive.ancestors.length === 0 && (!node.stroke.mixBlendMode || node.stroke.mixBlendMode === 'normal') ? markerPaintIdentity(descriptor, resolveMarkerColor, work) : undefined
      const strokeProof = semantic && exactWorld ? prepareMarkerPolygonInk(scene, node, descriptor, marker.position, work, resolveMarkerColor) : undefined
      lastMarkers.set(key, { primitive, position: marker.position, clipped: emitted?.clipped, anchor: region.anchor, repaint: region.repaint, bounds: region.bounds!, hull: region.hull, padding: region.padding, witnesses, actualInk, strokeProof, paintIdentity, semantic, mayFill })
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
      if (outsideFilledBody(surface, target.bounds, attached, target.hull, target.padding, work, target.witnesses, target.anchor)) continue
      if (target.clipped && outsideFilledBody(surface, target.clipped, attached, undefined, 0, work, target.witnesses, target.anchor, true)) continue
      potentialOcclusion(target.primitive.id, surface.primitive.id, 'Later filled artwork overlaps an endpoint marker; its exact ink intersection is unverified')
    }
  }
  const markerTargets = Array.from(lastMarkers.values())
  for (let index = 0; index < markerTargets.length; index++) markerCheck(surfaces, markerTargets[index]!)
  // A few marker queries keep the original linear walk: building an index
  // cannot amortize amid a large unrelated primitive roster.
  let semanticMarkers = 0, textQueries = 0
  for (const target of markerTargets) {
    if (!work()) break
    if (!target.semantic || target.primitive.visibility === 'conditional') continue
    semanticMarkers++
    if (!(target.strokeProof?.fill === 'absent' && target.strokeProof.stroke === 'absent')) textQueries++
  }
  const indexedText = textQueries > Math.ceil(Math.log2(inspection.primitives.length + 1)) ** 2
  const indexedMarkers = semanticMarkers > Math.ceil(Math.log2(semanticMarkers + 1)) ** 2
  const textItems: Array<{ primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; index: number }> = []
  if (indexedText) for (const [index, primitive] of inspection.primitives.entries()) {
    if (!work()) break
    if (primitive.kind === 'text' && primitive.coverage === 'measured' && primitive.visibility !== 'conditional' && primitive.bounds) textItems.push({ primitive, bounds: primitive.bounds, index })
  }
  const textQuery = indexedText ? orderedPaintQuery(textItems, work, textQueries) : undefined
  const markerItems: Array<{ primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; target: MarkerTarget; index: number }> = []
  if (indexedMarkers) for (const [index, target] of markerTargets.entries()) {
    if (!work()) break
    if (target.semantic && target.primitive.visibility !== 'conditional') markerItems.push({ primitive: target.primitive, bounds: target.bounds, target, index })
  }
  const markerQuery = indexedMarkers ? orderedPaintQuery(markerItems, work, semanticMarkers) : undefined
  // Prepared text and endpoint markers can hide each other in either paint
  // order. Text bounds already include the actual halo stroke; neither
  // a same owner/color nor a bounds overlap proves glyph-ink separation.
  for (let targetIndex = 0; targetIndex < markerTargets.length; targetIndex++) {
    const target = markerTargets[targetIndex]!
    if (!work()) break
    if (!target.semantic || target.primitive.visibility === 'conditional'
      || target.strokeProof?.fill === 'absent' && target.strokeProof.stroke === 'absent') continue
    const texts = textQuery ? textQuery(target.bounds).map(item => item.primitive) : inspection.primitives
    for (const primitive of texts) {
      if (!work()) break
      if (primitive.kind !== 'text' || primitive.coverage !== 'measured' || primitive.visibility === 'conditional'
        || !primitive.bounds || !overlaps(primitive.bounds, target.bounds)) continue
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; break }
      const markerLater = target.primitive.order > primitive.order
      potentialOcclusion(markerLater ? primitive.id : target.primitive.id, markerLater ? target.primitive.id : primitive.id, markerLater ? 'Later endpoint-marker ink overlaps occupied text; actual text visibility is unverified.' : 'Later occupied text or its halo overlaps an endpoint marker; actual marker ink visibility is unverified.')
    }
  }
  for (let earlierIndex = 0; earlierIndex < markerTargets.length; earlierIndex++) {
    const earlier = markerTargets[earlierIndex]!
    if (exhausted) break
    if (!earlier.semantic || earlier.primitive.visibility === 'conditional') continue
    const laterMarkers = markerQuery ? markerQuery(earlier.bounds).map(item => item.target) : markerTargets
    for (const later of laterMarkers) {
      if (!work()) break
      const earlierRepaint = earlier.strokeProof?.repaint, laterRepaint = later.strokeProof?.repaint
      const samePaint = earlier.paintIdentity !== undefined && earlier.paintIdentity === later.paintIdentity
      if (!later.semantic || later.primitive.visibility === 'conditional' || later.primitive.order <= earlier.primitive.order
        || samePaint && (earlier.anchor.x === later.anchor.x && earlier.anchor.y === later.anchor.y && earlier.repaint === later.repaint
          || earlierRepaint && laterRepaint && earlierRepaint.resource === laterRepaint.resource && earlierRepaint.geometry === laterRepaint.geometry && earlierRepaint.anchor.x === laterRepaint.anchor.x && earlierRepaint.anchor.y === laterRepaint.anchor.y)
        || !overlaps(earlier.bounds, later.bounds)) continue
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; break }
      let startWitness = 0, result: 'covered' | 'clear' | 'unknown' = 'unknown'
      while (!exhausted) {
        let proof = later.mayFill
          ? compareMarkerStrokeInk(earlier.strokeProof, later.strokeProof, work, startWitness)
          : compareMarkerPaintSeparation(earlier.strokeProof, later.strokeProof, work)
        if (proof === 'exhausted') proof = 'unknown'
        if (typeof proof === 'string') { result = proof; break }
        // A still-later primitive might restore this particular stroke point.
        // Continue through the finite evidence under the SAME charged budget;
        // restoring one point does not prove every other stroke point visible.
        let restored = false
        const primitives = inspection.primitives
        for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
          const primitive = primitives[primitiveIndex]!
          if (!work()) break
          const b = primitive.bounds
          if (primitive.order <= later.primitive.order || primitive.coverage === 'non-painting') continue
          if (!b) { restored = true; break }
          if (b.x0 > proof.x || proof.x > b.x1 || b.y0 > proof.y || proof.y > b.y1) continue
          const source = paintPrimitiveSource(primitive)
          if (source?.kind === 'connector' && Number(source.stroke.opacity) === 0) {
            let markerMayRestore = false
            for (let markerIndex = 0; markerIndex < markerTargets.length; markerIndex++) {
              const marker = markerTargets[markerIndex]!
              if (!work()) break
              if (marker.primitive.order !== primitive.order || marker.bounds.x0 > proof.x || proof.x > marker.bounds.x1 || marker.bounds.y0 > proof.y || proof.y > marker.bounds.y1) continue
              if (!outsideMarkerPolygon(marker.strokeProof, proof, work)) { markerMayRestore = true; break }
            }
            if (!markerMayRestore && !exhausted) continue
          }
          restored = true; break
        }
        if (!restored && !exhausted) { result = 'covered'; break }
        const witnesses = earlier.strokeProof!.strokeWitnesses
        let advanced = false
        for (; startWitness < witnesses.length; startWitness++) {
          if (!work()) break
          if (witnesses[startWitness] === proof) { startWitness++; advanced = true; break }
        }
        if (!advanced) break
      }
      if (result === 'covered' && !exhausted) issue({ code: 'MARKER_OCCLUDED', id: earlier.primitive.id, by: later.primitive.id, message: 'Later opaque endpoint-marker fill covers actual stroke ink of a distinct marker.' }, true)
      else if (result === 'unknown') potentialOcclusion(earlier.primitive.id, later.primitive.id, 'Distinct endpoint-marker envelopes overlap; actual marker ink separation is unverified.')
    }
  }
  if (exhausted) issue({ code: 'CHECK_BUDGET', message: `Occlusion checking reached its ${MAX_OCCLUSION_PAIRS}-pair or ${MAX_OCCLUSION_OPERATIONS}-operation limit` })
  // Mandatory final certification of the chosen viewport, including markers.
  for (const primitive of inspection.primitives) if (primitive.bounds && primitive.visibility !== 'conditional' && !contains(finalBounds, primitive.bounds, ARITHMETIC_NOISE)) unmeasuredPaint(primitive.id, 'Final viewport does not contain retained paint', true)
  for (const target of markerTargets) if (target.primitive.visibility !== 'conditional' && !contains(finalBounds, target.bounds, ARITHMETIC_NOISE)) unmeasuredPaint(target.primitive.id, 'Final viewport does not contain serialized marker paint', true)
  return Object.freeze({ version: 1, unit: 'px', scope: 'native-scene', status: failed ? 'failed' : unverified ? 'unverified' : 'passed', viewport, attempts: repaired ? 2 : 1, repairs: Object.freeze(repaired ? ['expand-viewport' as const] : []), coverage: Object.freeze({ measured: inspection.coverage.measured, unmeasured: inspection.coverage.unmeasured, preparedText: inspection.coverage.preparedText, fallbackText: inspection.coverage.fallbackText, conditional }), checks: Object.freeze({ primitives: inspection.primitives.length, labels, occlusionPairs: Math.min(pairs, MAX_OCCLUSION_PAIRS), maxOcclusionPairs: MAX_OCCLUSION_PAIRS, operations, maxOperations: MAX_OCCLUSION_OPERATIONS, markers: lastMarkers.size }), issues: Object.freeze(issues), limitations: Object.freeze(['Prepared occupied text regions bound native geometry; exact glyph ink depends on the resolved font.', 'Declared transparency, intentional data-mark overlap and externally modified CSS are outside this proof.']) })
}

export class PaintLayoutCertificationError extends Error {
  readonly code = 'PAINT_LAYOUT_CERTIFICATION_FAILED'
  constructor(readonly certification: PaintLayoutCertification) {
    super(`Final paint certification failed: ${certification.issues.map(issue => `${issue.id ?? 'scene'}: ${issue.message}`).join('; ')}`)
    this.name = 'PaintLayoutCertificationError'
  }
}
