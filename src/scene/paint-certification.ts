import type { RenderedLayout } from '../agent/types.ts'
import { connectorMarkerPaintRegions } from './bounds.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import { inlineResolvedColors } from '../theme.ts'
import { escapeAttr } from '../multiline-utils.ts'
import { tryParseCssColor } from '../shared/color-math.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import { inspectScenePrimitives, scenePrimitiveSource, scenePrimitiveMatrix, type ScenePaintPrimitive } from './inspection.ts'
import type { Geometry, SceneDoc, ScenePoint, SceneTransform } from './ir.ts'
import { composeMatrices, inverseMatrix, transformMatrix, transformPoint } from './transforms.ts'

export interface PaintViewport { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PaintCertificationIssue {
  readonly code: 'UNMEASURED_PAINT' | 'UNPREPARED_TEXT' | 'CONDITIONAL_PAINT' | 'LABEL_CONTAINMENT' | 'TEXT_OCCLUDED' | 'CHECK_BUDGET' | 'OUTPUT_SCOPE' | 'POTENTIAL_OCCLUSION' | 'MARKER_OCCLUDED'
  readonly id?: string
  readonly by?: string
  readonly message: string
}
export interface PaintLayoutCertification {
  readonly version: 1
  readonly unit: 'px'
  readonly scope: 'native-scene'
  readonly status: 'passed' | 'failed' | 'unverified'
  /** The graphical receipt's digest binds this proof to the secured SVG bytes. */
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
const contains = (a: AxisAlignedBox, b: AxisAlignedBox, tolerance = 0): boolean => a.x0 <= b.x0 + tolerance && a.y0 <= b.y0 + tolerance && a.x1 >= b.x1 - tolerance && a.y1 >= b.y1 - tolerance
const overlaps = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const box = (r: { x: number; y: number; w: number; h: number }): AxisAlignedBox => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h })
const viewportBox = (v: PaintViewport): AxisAlignedBox => ({ x0: v.x, y0: v.y, x1: v.x + v.width, y1: v.y + v.height })

interface Surface { primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; interior?: AxisAlignedBox; borderWidth?: number }
interface Tree { bounds: AxisAlignedBox; leaves?: readonly Surface[]; left?: Tree; right?: Tree }
function tree(items: readonly Surface[]): Tree | undefined {
  if (!items.length) return undefined
  const bounds = items.reduce((b, s) => ({ x0: Math.min(b.x0, s.bounds.x0), y0: Math.min(b.y0, s.bounds.y0), x1: Math.max(b.x1, s.bounds.x1), y1: Math.max(b.y1, s.bounds.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  if (items.length <= 8) return { bounds, leaves: items }
  const axis = bounds.x1 - bounds.x0 >= bounds.y1 - bounds.y0 ? 'x0' : 'y0'
  const sorted = [...items].sort((a, b) => a.bounds[axis] - b.bounds[axis] || a.primitive.order - b.primitive.order)
  const middle = Math.floor(sorted.length / 2)
  return { bounds, left: tree(sorted.slice(0, middle)), right: tree(sorted.slice(middle)) }
}

/** A filled rectangle's inset is known to be solid, unlike an arbitrary path's
 * conservative envelope. Rounded corners are excluded before transformation.
 */
function solidInteriors(scene: SceneDoc, primitives: readonly ScenePaintPrimitive[]): Surface[] {
  const resolved = new Map<string, boolean>()
  const opaque = (fill: string): boolean => {
    if (resolved.has(fill)) return resolved.get(fill)!
    const svg = inlineResolvedColors(`<rect fill="${escapeAttr(fill)}"/>`, scene.colors)
    const value = decodedSvgAttributeValue(scanSvgStartTags(svg)[0]!, 'fill')
    const result = !!value && tryParseCssColor(value)?.[3] === 1
    resolved.set(fill, result)
    return result
  }
  const outlines = new Map<string, number>()
  const outlineKey = (primitive: ScenePaintPrimitive, geometry: Geometry) => JSON.stringify([primitive.owner, geometry, scenePrimitiveMatrix(primitive)])
  for (const primitive of primitives) {
    const node = scenePrimitiveSource(primitive)
    if (node?.kind !== 'shape' || primitive.coverage !== 'measured' || primitive.visibility === 'conditional' || !node.paint.stroke || node.paint.stroke === 'none' || node.paint.stroke === 'transparent' || Number(node.paint.opacity ?? 1) !== 1) continue
    const width = Number(node.paint.strokeWidth?.replace(/px$/, '') ?? 1)
    if (Number.isFinite(width)) outlines.set(outlineKey(primitive, node.geometry), width)
  }
  return primitives.flatMap(primitive => {
    const node = scenePrimitiveSource(primitive)
    if (!node || node.kind !== 'shape' || node.geometry.kind === 'line' || primitive.visibility === 'conditional' || primitive.coverage !== 'measured') return []
    if (Number(node.paint.opacity ?? 1) === 0 || node.paint.fill === 'none' || node.paint.fill === 'transparent') return []
    const knownFill = node.paint.fill ? tryParseCssColor(node.paint.fill) : null
    if (knownFill && knownFill[3] < 1) return []
    const candidate = { primitive, bounds: primitive.bounds!, borderWidth: outlines.get(outlineKey(primitive, node.geometry)) }
    if (Number(node.paint.opacity ?? 1) !== 1 || !node.paint.fill || !opaque(node.paint.fill) || node.geometry.kind !== 'rect') return [candidate]
    const m = scenePrimitiveMatrix(primitive)!
    // A rotated/sheared AABB is not a solid rectangle. Keep it out of this
    // exact test instead of interpreting empty corners as painted pixels.
    if (Math.abs(m[1]) > 1e-12 || Math.abs(m[2]) > 1e-12) return [candidate]
    const g = node.geometry, rx = Math.min(g.width / 2, g.rx ?? g.ry ?? 0), ry = Math.min(g.height / 2, g.ry ?? g.rx ?? 0)
    const a = transformPoint({ x: g.x + rx, y: g.y + ry }, m)
    const b = transformPoint({ x: g.x + g.width - rx, y: g.y + g.height - ry }, m)
    return [{ ...candidate, interior: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) } }]
  })
}

/** Conservative marker envelopes can overlap empty corners of endpoint shapes.
 * A separating side or radius proves absence; other intersections stay unknown.
 */
function outsideFilledBody(surface: Surface, bounds: AxisAlignedBox, attached: boolean, hull?: readonly ScenePoint[], padding = 0): boolean {
  const shape = scenePrimitiveSource(surface.primitive)
  if (shape?.kind !== 'shape') return false
  const inverse = inverseMatrix(scenePrimitiveMatrix(surface.primitive)!)
  if (!inverse) return false
  const corners = (hull ?? [{ x: bounds.x0, y: bounds.y0 }, { x: bounds.x0, y: bounds.y1 }, { x: bounds.x1, y: bounds.y0 }, { x: bounds.x1, y: bounds.y1 }]).map(point => transformPoint(point, inverse))
  const [a, b, c, d] = inverse
  const margin = padding * (Math.hypot(a + d, b - c) + Math.hypot(a - d, b + c)) / 2
  // An attached arrow's stroke can meet its endpoint outline. Exclude only
  // that declared border band; a marker entering the filled body stays checked.
  const inset = attached ? Math.max(0, (surface.borderWidth ?? 0) / 2) : 0
  const outside = (g: Geometry): boolean => {
  if (g.kind === 'compound') return g.children.length <= 64 && g.children.every(outside)
  if (g.kind === 'circle') {
    const x = Math.max(Math.min(...corners.map(p => p.x)), Math.min(g.cx, Math.max(...corners.map(p => p.x))))
    const y = Math.max(Math.min(...corners.map(p => p.y)), Math.min(g.cy, Math.max(...corners.map(p => p.y))))
    return Math.hypot(x - g.cx, y - g.cy) >= g.r - inset + margin - 1e-8
  }
  const points = g.kind === 'rect' ? [{ x: g.x, y: g.y }, { x: g.x + g.width, y: g.y }, { x: g.x + g.width, y: g.y + g.height }, { x: g.x, y: g.y + g.height }] : g.kind === 'polygon' ? g.points : undefined
  if (!points || points.length < 3 || points.length > 64) return false
  const cross = (a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]!; return sum + a.x * b.y - b.x * a.y }, 0)
  const direction = Math.sign(area)
  if (!direction || points.some((a, i) => direction * cross(a, points[(i + 1) % points.length]!, points[(i + 2) % points.length]!) < 0)) return false
  return points.some((a, i) => {
    const b = points[(i + 1) % points.length]!, length = Math.hypot(b.x - a.x, b.y - a.y)
    return length > 0 && corners.every(p => direction * cross(a, b, p) <= (inset - margin + 1e-8) * length)
  })
  }
  return outside(shape.geometry)
}

/** One linear envelope pass, at most one viewport repair, then final checking.
 * The certificate covers retained native geometry, not every antialiased pixel
 * or arbitrary CSS/backend changes. It never treats path-hull overlap as proof.
 */
export function certifyScenePaint(scene: SceneDoc, projection?: Pick<RenderedLayout, 'nodes' | 'labels'>, options: { outputSupported?: boolean } = {}): PaintLayoutCertification {
  const inspection = inspectScenePrimitives(scene)
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
  if (conditional) issue({ code: 'CONDITIONAL_PAINT', message: `${conditional} primitives depend on interaction state` })
  if (options.outputSupported === false || scene.family.startsWith('family:')) issue({ code: 'OUTPUT_SCOPE', message: 'Selected backend, style or external family has no native final-paint proof' })
  const repaired = x0 < 0 || y0 < 0 || x1 > scene.width || y1 > scene.height
  // Outward rounding adds a bounded safety margin without moving semantic
  // geometry, chart coordinates, routes, dates or authored memberships.
  const viewport = Object.freeze(repaired ? { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1) - Math.floor(x0), height: Math.ceil(y1) - Math.floor(y0) } : { x: 0, y: 0, width: scene.width, height: scene.height })
  const finalBounds = viewportBox(viewport)
  if (repaired && inspection.primitives.some(primitive => {
    const node = scenePrimitiveSource(primitive)
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
  const check = (branch: Tree | undefined, primitive: ScenePaintPrimitive): void => {
    if (exhausted || !work() || !branch || !overlaps(branch.bounds, primitive.bounds!)) return
    if (!branch.leaves) { check(branch.left, primitive); check(branch.right, primitive); return }
    for (const surface of branch.leaves) {
      if (!work()) return
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; return }
      if (surface.primitive.order <= primitive.order || !overlaps(surface.bounds, primitive.bounds!)) continue
      if (surface.interior && contains(surface.interior, primitive.bounds!)) issue({ code: 'TEXT_OCCLUDED', id: primitive.id, by: surface.primitive.id, message: `Retained text is fully covered by later opaque artwork owned by ${surface.primitive.owner.id}` }, true)
      else issue({ code: 'POTENTIAL_OCCLUSION', id: primitive.id, by: surface.primitive.id, message: 'Later filled artwork overlaps the occupied text band; its exact ink intersection is unverified' })
    }
  }
  for (const primitive of inspection.primitives) if (primitive.kind === 'text' && primitive.coverage === 'measured' && primitive.visibility !== 'conditional') check(surfaces, primitive)
  type MarkerTarget = { primitive: ScenePaintPrimitive; bounds: AxisAlignedBox; hull?: readonly ScenePoint[]; padding?: number }
  const lastMarkers = new Map<string, MarkerTarget>()
  for (const primitive of inspection.primitives) {
    const node = scenePrimitiveSource(primitive)
    if (primitive.kind !== 'connector' || node?.kind !== 'connector' || node.lineStyle === 'invisible' || primitive.visibility === 'conditional') continue
    const ownInverse = inverseMatrix(transformMatrix(node.transform))
    if (!ownInverse) continue
    const [a, b, c, d, e, f] = composeMatrices(scenePrimitiveMatrix(primitive)!, ownInverse)
    const parent: SceneTransform = { kind: 'matrix', a, b, c, d, e, f }
    for (const marker of connectorMarkerPaintRegions(node, parent)) {
      if (!marker.bounds) { issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Endpoint marker has no painted footprint' }); continue }
      const key = JSON.stringify([primitive.owner.id, primitive.owner.role, marker.position, marker.resource, marker.anchor, marker.repaint])
      lastMarkers.set(key, { primitive, bounds: marker.bounds, hull: marker.hull, padding: marker.padding })
    }
  }
  const markerCheck = (branch: Tree | undefined, target: MarkerTarget): void => {
    if (exhausted || !work() || !branch || !overlaps(branch.bounds, target.bounds)) return
    if (!branch.leaves) { markerCheck(branch.left, target); markerCheck(branch.right, target); return }
    for (const surface of branch.leaves) {
      if (!work()) return
      if (++pairs > MAX_OCCLUSION_PAIRS) { exhausted = true; return }
      if (surface.primitive.order <= target.primitive.order || !overlaps(surface.bounds, target.bounds)) continue
      const connector = scenePrimitiveSource(target.primitive)
      const attached = connector?.kind === 'connector' && [connector.endpoints?.from, connector.endpoints?.to].includes(surface.primitive.owner.id)
      if (outsideFilledBody(surface, target.bounds, attached, target.hull, target.padding)) continue
      if (surface.interior && contains(surface.interior, target.bounds)) issue({ code: 'MARKER_OCCLUDED', id: target.primitive.id, by: surface.primitive.id, message: 'Endpoint marker is fully covered by later opaque artwork with no owned repaint' }, true)
      else issue({ code: 'POTENTIAL_OCCLUSION', id: target.primitive.id, by: surface.primitive.id, message: 'Later filled artwork overlaps an endpoint marker; its exact ink intersection is unverified' })
    }
  }
  for (const target of lastMarkers.values()) markerCheck(surfaces, target)
  if (exhausted) issue({ code: 'CHECK_BUDGET', message: `Occlusion checking reached its ${MAX_OCCLUSION_PAIRS}-pair or ${MAX_OCCLUSION_OPERATIONS}-operation limit` })
  // Mandatory final certification of the chosen viewport, including markers.
  for (const primitive of inspection.primitives) if (primitive.bounds && primitive.visibility !== 'conditional' && !contains(finalBounds, primitive.bounds)) issue({ code: 'UNMEASURED_PAINT', id: primitive.id, message: 'Final viewport does not contain retained paint' }, true)
  return Object.freeze({ version: 1, unit: 'px', scope: 'native-scene', status: failed ? 'failed' : unverified ? 'unverified' : 'passed', viewport, attempts: repaired ? 2 : 1, repairs: Object.freeze(repaired ? ['expand-viewport' as const] : []), coverage: Object.freeze({ measured: inspection.coverage.measured, unmeasured: inspection.coverage.unmeasured, preparedText: inspection.coverage.preparedText, fallbackText: inspection.coverage.fallbackText, conditional }), checks: Object.freeze({ primitives: inspection.primitives.length, labels, occlusionPairs: Math.min(pairs, MAX_OCCLUSION_PAIRS), maxOcclusionPairs: MAX_OCCLUSION_PAIRS, operations, maxOperations: MAX_OCCLUSION_OPERATIONS, markers: lastMarkers.size }), issues: Object.freeze(issues), limitations: Object.freeze(['Prepared occupied text regions bound native geometry; exact glyph ink depends on the resolved font.', 'Declared transparency, intentional data-mark overlap and externally modified CSS are outside this proof.']) })
}

export class PaintLayoutCertificationError extends Error {
  readonly code = 'PAINT_LAYOUT_CERTIFICATION_FAILED'
  constructor(readonly certification: PaintLayoutCertification) {
    super(`Final paint certification failed: ${certification.issues.map(issue => `${issue.id ?? 'scene'}: ${issue.message}`).join('; ')}`)
    this.name = 'PaintLayoutCertificationError'
  }
}
