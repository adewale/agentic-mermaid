import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { createInkIndex, type InkBounds } from '../shared/ink-index.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import type { Point, PositionedEdge, RouteBlocker } from '../types.ts'
import type { LabelMetricsStyle } from './route-geometry.ts'

type MarkerRegion = ReturnType<typeof graphEdgeMarkerPaintRegions>[number]
type MarkerView = ReturnType<typeof markerView>
type MarkerBox = NonNullable<MarkerRegion['bounds']>

interface PeerMarkerSnapshot {
  edge: PositionedEdge
  ordinals: number[]
  known: boolean
  view?: MarkerView
  bounds?: MarkerBox
}

export interface RouteMarkerPeerContext {
  invalidate(edge: PositionedEdge): void
  query(marker: MarkerRegion, peers: readonly PositionedEdge[], style: LabelMetricsStyle): PositionedEdge[] | undefined
  view(edge: PositionedEdge): PeerMarkerSnapshot | undefined
}

function expandedMarkerBox(marker: MarkerRegion): MarkerBox | undefined {
  if (!measured(marker)) return undefined
  const box = marker.bounds!
  // Two inflated boxes enclose separated()'s pairwise error, with spare
  // roundoff margin. An overflow stays in the unconditional peer set.
  const error = (Math.abs(box.x0) + Math.abs(box.y0) + Math.abs(box.x1) + Math.abs(box.y1)) * 2e-10 + 2e-9
  const expanded = { x0: box.x0 - error, y0: box.y0 - error, x1: box.x1 + error, y1: box.y1 + error }
  return Object.values(expanded).every(Number.isFinite) ? expanded : undefined
}

/** The owning synchronous route pass invalidates every changed edge. Views
 * and the spatial tree are prepared only when a changed marker needs peers;
 * accepted writes refresh their leaves rather than rebuilding the roster. */
export function createRouteMarkerPeerContext(peers: readonly PositionedEdge[], style: LabelMetricsStyle, admit?: () => boolean): RouteMarkerPeerContext {
  const prepare = () => {
    let capacity = 1
    while (capacity < peers.length) capacity *= 2
    const bounds = new Float64Array(8 * capacity)
    const ordinals = new Int32Array(2 * capacity).fill(-1)
    const leaves = new Int32Array(peers.length)
    const snapshots = new Map<PositionedEdge, PeerMarkerSnapshot>()
    const rows: PeerMarkerSnapshot[] = []
    const uncertain = new Set<number>(), dirty = new Set<PositionedEdge>()
    const write = (node: number, box?: MarkerBox): void => {
      const offset = 4 * node
      bounds[offset] = box?.x0 ?? Infinity; bounds[offset + 1] = box?.y0 ?? Infinity
      bounds[offset + 2] = box?.x1 ?? -Infinity; bounds[offset + 3] = box?.y1 ?? -Infinity
    }
    const join = (node: number): void => {
      const offset = 4 * node, left = 8 * node, right = left + 4
      bounds[offset] = Math.min(bounds[left]!, bounds[right]!); bounds[offset + 1] = Math.min(bounds[left + 1]!, bounds[right + 1]!)
      bounds[offset + 2] = Math.max(bounds[left + 2]!, bounds[right + 2]!); bounds[offset + 3] = Math.max(bounds[left + 3]!, bounds[right + 3]!)
    }
    const refresh = (snapshot: PeerMarkerSnapshot): void => {
      const edge = snapshot.edge, visible = edge.style !== 'invisible' && (edge.hasArrowStart || edge.hasArrowEnd)
      snapshot.known = !visible || mappingKnown(edge, style)
      snapshot.view = visible && snapshot.known ? markerView(edge, style, false) : undefined
      let combined: MarkerBox | undefined
      let unknown = !snapshot.known
      for (const marker of snapshot.view?.regions ?? []) {
        const box = expandedMarkerBox(marker)
        if (!box) { unknown = true; break }
        if (!combined) combined = { ...box }
        else {
          combined.x0 = Math.min(combined.x0, box.x0); combined.y0 = Math.min(combined.y0, box.y0)
          combined.x1 = Math.max(combined.x1, box.x1); combined.y1 = Math.max(combined.y1, box.y1)
        }
      }
      snapshot.bounds = unknown ? undefined : combined
      for (const ordinal of snapshot.ordinals) {
        if (unknown) uncertain.add(ordinal)
        else uncertain.delete(ordinal)
      }
    }
    peers.forEach((edge, ordinal) => {
      let snapshot = snapshots.get(edge)
      if (!snapshot) { snapshot = { edge, ordinals: [], known: false }; snapshots.set(edge, snapshot) }
      snapshot.ordinals.push(ordinal); rows.push(snapshot)
    })
    for (const snapshot of snapshots.values()) refresh(snapshot)
    const build = (order: number[], node: number): void => {
      if (order.length === 1) {
        const ordinal = order[0]!
        ordinals[node] = ordinal; leaves[ordinal] = node; write(node, rows[ordinal]!.bounds)
        return
      }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const ordinal of order) {
        const box = rows[ordinal]!.bounds
        if (box) { x0 = Math.min(x0, box.x0); y0 = Math.min(y0, box.y0); x1 = Math.max(x1, box.x1); y1 = Math.max(y1, box.y1) }
      }
      const axis = x1 - x0 >= y1 - y0 ? 'x0' : 'y0'
      order.sort((a, b) => (rows[a]!.bounds?.[axis] ?? 0) - (rows[b]!.bounds?.[axis] ?? 0) || a - b)
      const middle = Math.floor(order.length / 2)
      build(order.slice(0, middle), 2 * node); build(order.slice(middle), 2 * node + 1); join(node)
    }
    if (rows.length) build(rows.map((_, index) => index), 1)
    const flush = (): void => {
      for (const edge of dirty) {
        const snapshot = snapshots.get(edge)
        if (!snapshot) continue
        refresh(snapshot)
        for (const ordinal of snapshot.ordinals) {
          const leaf = leaves[ordinal]!
          write(leaf, snapshot.bounds)
          for (let parent = leaf >> 1; parent; parent >>= 1) join(parent)
        }
      }
      dirty.clear()
    }
    return { bounds, ordinals, snapshots, rows, uncertain, dirty, flush }
  }
  let state: ReturnType<typeof prepare> | undefined, admitted: boolean | undefined
  return {
    invalidate(edge) { state?.dirty.add(edge) },
    view(edge) { return state?.snapshots.get(edge) },
    query(marker, currentPeers, currentStyle) {
      if (currentPeers !== peers || currentStyle !== style) return undefined
      const box = expandedMarkerBox(marker)
      if (!box) return undefined
      if (admitted === undefined) admitted = admit ? admit() === true : true
      if (!admitted) return undefined
      const prepared = state ??= prepare()
      prepared.flush()
      const found = [...prepared.uncertain]
      const visit = (node: number): void => {
        const offset = 4 * node, bounds = prepared.bounds
        if (!(box.x0 <= bounds[offset + 2]! && box.x1 >= bounds[offset]! && box.y0 <= bounds[offset + 3]! && box.y1 >= bounds[offset + 1]!)) return
        const ordinal = prepared.ordinals[node]!
        if (ordinal >= 0) found.push(ordinal)
        else { visit(2 * node); visit(2 * node + 1) }
      }
      if (prepared.rows.length) visit(1)
      found.sort((a, b) => a - b)
      return found.map(ordinal => peers[ordinal]!)
    },
  }
}

function markerView(edge: PositionedEdge, style: LabelMetricsStyle, includeHull = true): { regions: MarkerRegion[]; points: Point[]; directional: boolean } {
  const points = edge.points.map(point => ({ x: Number(formatSvgNumber(point.x)), y: Number(formatSvgNumber(point.y)) }))
  const multiple = edge.style === 'thick' ? 2 : 1
  const lineWidth = Number(formatSvgNumber((style.lineWidth ?? 1) * multiple)) / multiple
  const writtenStyle = { ...style, lineWidth }
  const directional = !edge.curve && !(style.edgeBendRadius && style.edgeBendRadius > 0)
  if (directional) return { regions: graphEdgeMarkerPaintRegions({ ...edge, points }, writtenStyle, includeHull), points, directional }
  // A rounded/cubic control can round independently of its endpoint. Keep an
  // orientation-independent complete envelope rather than infer its served
  // tangent from the raw polyline. This is only a rejection guard.
  const regions = graphEdgeMarkerPaintRegions(edge, writtenStyle, includeHull).map(region => {
    const anchor = region.position === 'start' ? points[0]! : points.at(-1)!
    const box = region.bounds
    if (!box) return { ...region, anchor }
    const radius = Math.max(...[box.x0, box.x1].flatMap(x => [box.y0, box.y1].map(y => Math.hypot(x - region.anchor.x, y - region.anchor.y))))
    return { ...region, anchor, bounds: { x0: anchor.x - radius, y0: anchor.y - radius, x1: anchor.x + radius, y1: anchor.y + radius } }
  })
  return { regions, points, directional }
}

/** Complete written marker supports for optional placement admission. Share
 * the same width/endpoint projection and curved orientation envelope used by
 * route preference guards, rather than preparing a second marker view. */
export function routeMarkerPaintRegions(edge: PositionedEdge, style: LabelMetricsStyle): MarkerRegion[] | undefined {
  if (edge.style === 'invisible' || !edge.hasArrowStart && !edge.hasArrowEnd) return []
  if (!mappingKnown(edge, style)) return undefined
  const { regions } = markerView(edge, style)
  return regions.length === Number(Boolean(edge.hasArrowStart)) + Number(Boolean(edge.hasArrowEnd)) && regions.every(measured) ? regions : undefined
}

function mappingKnown(edge: PositionedEdge, style: LabelMetricsStyle): boolean {
  if (!edge.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false
  if (style.edgeBendRadius !== undefined && !(Number.isFinite(style.edgeBendRadius) && style.edgeBendRadius >= 0)) return false
  // Authored widths select fixed user-space marker resources. Otherwise SVG
  // markerUnits scales both geometry and stroke by the actual carrier width.
  const width = (style.lineWidth ?? 1) * (edge.style === 'thick' ? 2 : 1)
  return !!edge.inlineStyle?.['stroke-width'] || Number.isFinite(width) && width > 0
}

function measured(marker: MarkerRegion): boolean {
  const box = marker.bounds
  return !!box && [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) && box.x0 <= box.x1 && box.y0 <= box.y1
}

function sameEndpointRay(before: readonly Point[], after: readonly Point[], position: MarkerRegion['position']): boolean {
  if (position === 'mid') return false
  const anchor = (points: readonly Point[]) => position === 'start' ? points[0] : points.at(-1)
  const a = anchor(before), b = anchor(after)
  if (!a || !b || a.x !== b.x || a.y !== b.y) return false
  const neighbor = (points: readonly Point[]): Point | undefined => {
    for (let i = 1; i < points.length; i++) {
      const p = points[position === 'start' ? i : points.length - i - 1]!
      if (p.x !== a.x || p.y !== a.y) return p
    }
    return undefined
  }
  const p = neighbor(before), q = neighbor(after)
  if (!p || !q) return false
  if (p.x === q.x && p.y === q.y) return true
  if (a.x !== p.x && a.y !== p.y || a.x !== q.x && a.y !== q.y) return false
  return Math.sign(p.x - a.x) === Math.sign(q.x - a.x) && Math.sign(p.y - a.y) === Math.sign(q.y - a.y)
}

/** Read the two written terminal rays without materializing marker resources,
 * hulls or the interior of either polyline. Cardinal equal rays paint the same
 * resource at the same angle; unknown or curved mappings keep the full proof. */
function sameWrittenEndpointRay(before: readonly Point[], after: readonly Point[], start: boolean): boolean {
  const terminal = (points: readonly Point[]) => {
    const anchor = points[start ? 0 : points.length - 1]
    if (!anchor) return undefined
    const x = Number(formatSvgNumber(anchor.x)), y = Number(formatSvgNumber(anchor.y))
    for (let i = 1; i < points.length; i++) {
      const point = points[start ? i : points.length - i - 1]!
      const dx = Number(formatSvgNumber(point.x)) - x, dy = Number(formatSvgNumber(point.y)) - y
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(Math.hypot(dx, dy))) return undefined
      if (dx || dy) return { x, y, dx, dy }
    }
    return undefined
  }
  const a = terminal(before), b = terminal(after)
  return !!a && !!b && a.x === b.x && a.y === b.y && !(a.dx && a.dy) && !(b.dx && b.dy)
    && Math.sign(a.dx) === Math.sign(b.dx) && Math.sign(a.dy) === Math.sign(b.dy)
}

/** A rounded orthogonal route paints its endpoint marker along its final
 * straight segment; the corners before it never reach the marker's tangent. */
function sameTerminalSegment(before: readonly Point[], after: readonly Point[], position: MarkerRegion['position']): boolean {
  if (position === 'mid' || before.length < 2 || after.length < 2) return false
  const pick = (points: readonly Point[]): readonly [Point, Point] => position === 'start' ? [points[0]!, points[1]!] : [points.at(-1)!, points.at(-2)!]
  const [a, b] = pick(before), [c, d] = pick(after)
  return a.x === c.x && a.y === c.y && b.x === d.x && b.y === d.y
}

function separated(a: MarkerRegion, b: MarkerRegion): boolean {
  const x = a.bounds, y = b.bounds
  if (!x || !y || !measured(a) || !measured(b)) return false
  const values = [x.x0, x.y0, x.x1, x.y1, y.x0, y.y0, y.x1, y.y1]
  if (!values.every(Number.isFinite)) return false
  // Reject close arithmetic/serialization uncertainty; never enlarge a clear
  // gap. These are conservative complete stroke/cap/viewport envelopes.
  const error = values.reduce((sum, value) => sum + Math.abs(value), 0) * 1e-10 + 1e-9
  return Number.isFinite(error) && (x.x1 + error < y.x0 || y.x1 + error < x.x0 || x.y1 + error < y.y0 || y.y1 + error < x.y0)
}

/** One shared terminal paints a single final shaft and glyph for every edge
 * merged into it. That ink stands for each member only when the members paint
 * identically and at most one of them is named: a different dash, width or
 * colour would be painted over, and two labels cannot both own one arrowhead. */
export function edgesMayShareTerminal(a: PositionedEdge, b: PositionedEdge): boolean {
  if (a.label && b.label) return false
  if (a.style !== b.style || a.curve !== b.curve || a.animate !== b.animate || a.animation !== b.animation) return false
  const styleA = a.inlineStyle ?? {}, styleB = b.inlineStyle ?? {}
  for (const key in styleA) if (!(key in styleB) || styleB[key] !== styleA[key]) return false
  for (const key in styleB) if (!(key in styleA)) return false
  const classesA = a.classNames ?? [], classesB = b.classNames ?? []
  if (classesA.length !== classesB.length) return false
  for (let index = 0; index < classesA.length; index++) if (classesA[index] !== classesB[index]) return false
  return true
}

type MarkerView = ReturnType<typeof markerView>
interface PeerView { peer: PositionedEdge; view: MarkerView; known: boolean; order: number }
interface RetainedPeer extends PeerView { values: unknown[]; coordinates: number[] }
interface MarkerPeers { entries: RetainedPeer[]; query?: (bounds: InkBounds) => PeerView[]; uncertain: PeerView[] }
let markerExecutions: WeakMap<readonly PositionedEdge[], MarkerPeers> | undefined

/** Geometry reuse belongs to one synchronous layout, never to caller identity.
 * Nested layouts restore their parent's index even when a producer throws. */
export function withRouteMarkerCache<T>(run: () => T): T {
  const previous = markerExecutions
  markerExecutions = new WeakMap()
  try { return run() } finally { markerExecutions = previous }
}

// The broad phase must include the arithmetic uncertainty used by separated().
// Expanding both operands by their own coordinate contribution is conservative.
function markerQueryBounds(bounds: InkBounds): InkBounds | undefined {
  const error = (Math.abs(bounds.x0) + Math.abs(bounds.x1) + Math.abs(bounds.y0) + Math.abs(bounds.y1)) * 4e-10 + 4e-9
  const expanded = { x0: bounds.x0 - error, y0: bounds.y0 - error, x1: bounds.x1 + error, y1: bounds.y1 + error }
  return Object.values(expanded).every(Number.isFinite) ? expanded : undefined
}

function indexedMarkerPeers(peers: readonly PositionedEdge[], style: LabelMetricsStyle): MarkerPeers | undefined {
  if (!markerExecutions) return undefined
  let retained = markerExecutions.get(peers)
  if (!retained) { retained = { entries: [], uncertain: [] }; markerExecutions.set(peers, retained) }
  let changed = retained.entries.length !== peers.length
  for (let order = 0; order < peers.length; order++) {
    const peer = peers[order]!
    const prior = retained.entries[order]
    // These are all the inputs to mappingKnown/markerView. Endpoint identity,
    // label and terminal-sharing policy remain live at the exact check below.
    const values = [peer.style, peer.curve, peer.hasArrowStart, peer.hasArrowEnd, peer.startMarker, peer.endMarker,
      peer.inlineStyle?.stroke, peer.inlineStyle?.['stroke-width'], style.lineWidth, style.edgeStrokeColor, style.edgeBendRadius]
    let same = prior?.peer === peer && values.every((value, index) => Object.is(value, prior.values[index]))
      && prior.coordinates.length === peer.points.length * 2
    if (same) for (let i = 0; i < peer.points.length; i++) {
      const point = peer.points[i]!
      if (!Object.is(point.x, prior!.coordinates[2 * i]) || !Object.is(point.y, prior!.coordinates[2 * i + 1])) { same = false; break }
    }
    if (same) continue
    changed = true
    const visible = peer.style !== 'invisible' && !!(peer.hasArrowStart || peer.hasArrowEnd)
    const known = !visible || mappingKnown(peer, style)
    const view = visible && known ? markerView(peer, style, false) : { regions: [], points: [], directional: false }
    retained.entries[order] = { peer, order, values, known, view, coordinates: peer.points.flatMap(point => [point.x, point.y]) }
  }
  retained.entries.length = peers.length
  if (changed || !retained.query) {
    const bounded: Array<{ entry: PeerView; bounds: InkBounds }> = []
    retained.uncertain = []
    for (const entry of retained.entries) {
      if (!entry.known) { retained.uncertain.push(entry); continue }
      for (const region of entry.view.regions) {
        const bounds = measured(region) ? markerQueryBounds(region.bounds!) : undefined
        if (!bounds) { retained.uncertain.push(entry); break }
        bounded.push({ entry, bounds })
      }
    }
    const query = createInkIndex(bounded, item => item.bounds, () => {}, Number.MAX_SAFE_INTEGER)
    retained.query = bounds => {
      const expanded = markerQueryBounds(bounds)
      if (!expanded) return retained!.entries
      const found = new Set<PeerView>(retained!.uncertain)
      for (const item of query(expanded)) found.add(item.entry)
      return [...found].sort((a, b) => a.order - b.order)
    }
  }
  return retained
}

/** Optional endpoint-centering candidates may not discard reserved marker
 * seats. Borrowed callers read live peers; an owned pass may reuse explicitly
 * invalidated marker views. No candidate acceptance is retained.
 * Unchanged endpoint occurrences keep their existing proof/status, while a
 * changed one must separate from ALL peers and its staged opposite marker. */
export function routeCandidateMarkerBlocker(edge: PositionedEdge, points: Point[], peers: readonly PositionedEdge[], style: LabelMetricsStyle, peerOwner: PositionedEdge = edge, context?: RouteMarkerPeerContext): RouteBlocker | undefined {
  if (!edge.hasArrowStart && !edge.hasArrowEnd || edge.style === 'invisible') return undefined
  const blocker = (owner: PositionedEdge, position: string, relation: string): RouteBlocker => ({ kind: 'port', id: `${relation}:${owner.id ?? `${owner.source}->${owner.target}[${owner.edgeIndex ?? peers.indexOf(owner)}]`}:${position}` })
  if (!mappingKnown({ ...edge, points }, style)) return blocker(peerOwner, 'mapping', 'marker')
  const knownMarker = (kind: PositionedEdge['startMarker']) => kind === undefined || kind === 'arrow' || kind === 'circle' || kind === 'cross'
  if (!edge.curve && !(style.edgeBendRadius && style.edgeBendRadius > 0)
    && knownMarker(edge.startMarker) && knownMarker(edge.endMarker)
    && (!edge.hasArrowStart || sameWrittenEndpointRay(edge.points, points, true))
    && (!edge.hasArrowEnd || sameWrittenEndpointRay(edge.points, points, false))) return undefined
  const oldView = markerView(edge, style, false), newView = markerView({ ...edge, points }, style, false)
  const before = oldView.regions, after = newView.regions
  if (after.length !== Number(Boolean(edge.hasArrowStart)) + Number(Boolean(edge.hasArrowEnd))) return blocker(peerOwner, 'unmeasured', 'marker')
  let indexed: MarkerPeers | undefined
  for (const marker of after) {
    const old = before.find(candidate => candidate.position === marker.position)
    if (old && old.resource === marker.resource && old.repaint === marker.repaint
      && old.anchor.x === marker.anchor.x && old.anchor.y === marker.anchor.y
      && (oldView.directional && newView.directional ? sameEndpointRay(oldView.points, newView.points, marker.position)
        : edge.curve ? edge.points.length === points.length && edge.points.every((point, index) => point.x === points[index]!.x && point.y === points[index]!.y)
          : sameTerminalSegment(edge.points, points, marker.position))) continue
    if (!measured(marker)) return blocker(peerOwner, marker.position, 'marker')
    for (const opposite of after) if (opposite !== marker && !separated(marker, opposite)) return blocker(peerOwner, opposite.position, 'opposite-marker')
    const ownedPeers = context?.query(marker, peers, style)
    if (!context) indexed ??= indexedMarkerPeers(peers, style)
    const nearby = indexed?.query?.(marker.bounds!)
    const candidates = ownedPeers ? ownedPeers.map(peer => {
      const retained = context!.view(peer)
      return { peer, known: retained ? retained.known : mappingKnown(peer, style), view: retained?.view }
    }) : nearby ?? peers.map((peer, order) => ({ peer, order, known: mappingKnown(peer, style), view: undefined }))
    for (const entry of candidates) {
      const peer = entry.peer
      if (peer === peerOwner || peer.style === 'invisible' || !peer.hasArrowStart && !peer.hasArrowEnd) continue
      if (!entry.known) return blocker(peer, 'mapping', 'peer-marker')
      const peerView = entry.view ?? markerView(peer, style, false)
      for (const occurrence of peerView.regions) {
        const ownNode = marker.position === 'start' ? edge.source : edge.target
        const peerNode = occurrence.position === 'start' ? peer.source : peer.target
        // Existing Flowchart convergence may repaint one IDENTICAL glyph at
        // one physical port. Neither target identity nor color alone proves
        // this, and staged opposite occurrences above never get this rule.
        if (newView.directional && peerView.directional && measured(occurrence) && marker.position === occurrence.position
          && ownNode === peerNode && marker.resource === occurrence.resource && marker.repaint === occurrence.repaint
          && marker.anchor.x === occurrence.anchor.x && marker.anchor.y === occurrence.anchor.y
          && sameEndpointRay(newView.points, peerView.points, marker.position) && edgesMayShareTerminal(edge, peer)) continue
        if (!separated(marker, occurrence)) return blocker(peer, occurrence.position, 'peer-marker')
      }
    }
  }
  return undefined
}

export function routeCandidateMarkersClear(edge: PositionedEdge, points: Point[], peers: readonly PositionedEdge[], style: LabelMetricsStyle, peerOwner: PositionedEdge = edge, context?: RouteMarkerPeerContext): boolean {
  return routeCandidateMarkerBlocker(edge, points, peers, style, peerOwner, context) === undefined
}
