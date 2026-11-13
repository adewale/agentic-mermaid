import { LayoutCertificationError } from '../layout/certification-error.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { projectMeasuredRoutePoint } from '../layout/measured-route-safety.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import type { Point } from '../types.ts'
import type { PositionedClassDiagram, PositionedClassRelationship } from './types.ts'
import { classRelationshipLineStyle } from './parser.ts'

type Charge = () => boolean
type Box = { x0: number; y0: number; x1: number; y1: number }
type Piece = { owner: number; kind: 'strip' | 'join' | 'curve'; segment: number; box: Box; axis: 'x' | 'y' }
type Entry = { key: number; piece: Piece }
type Route = { from: string; to: string; dashed: boolean; raw: Point[]; points: Point[] }
export interface ClassHeaderPeerContext {
  readonly routes: readonly Route[]
  readonly pieces: readonly Piece[]
  readonly horizontal: readonly Entry[]
  readonly vertical: readonly Entry[]
  readonly horizontalEnds: readonly Entry[]
  readonly verticalEnds: readonly Entry[]
  readonly cornersX: readonly Entry[]
  readonly cornersY: readonly Entry[]
  readonly cornerHalfX: number
  readonly cornerHalfY: number
  readonly half: number
  readonly radius: number
}
// Request-local opaque data holder. Candidate capabilities/leases are never
// stored here. The numeric view grants no stroke-box or old-proof authority.
const numericContext = Symbol('Class header numeric snapshot')
export interface ClassHeaderNumericCapture {
  [numericContext]?: ClassHeaderPeerContext
}
/** Borrowed entries may carry private header fields; consumers use only these
 * numeric keys/ordinals and establish fresh exact physical predicates. */
export interface ClassHeaderNumericSeed {
  readonly routes: readonly { readonly raw: readonly Point[]; readonly points: readonly Point[] }[]
  readonly horizontal: readonly { readonly key: number; readonly piece: { readonly owner: number; readonly segment: number } }[]
  readonly vertical: readonly { readonly key: number; readonly piece: { readonly owner: number; readonly segment: number } }[]
  readonly horizontalEnds: readonly { readonly key: number; readonly piece: { readonly owner: number; readonly segment: number } }[]
  readonly verticalEnds: readonly { readonly key: number; readonly piece: { readonly owner: number; readonly segment: number } }[]
}
/** Caller prepays the single holder write. The context contains copied numeric
 * data only; the candidate iterator's proof and charge callback stay private. */
export function captureClassHeaderNumericContext(capture: ClassHeaderNumericCapture, context: ClassHeaderPeerContext | undefined): void {
  capture[numericContext] = context
}
export interface ClassHeaderLaneOptions {
  header: { x: number; y: number; width: number; height: number }
  a: Point
  b: Point
  owner: number
  relationships: readonly PositionedClassRelationship[]
  width: number
  height: number
  style: ResolvedRenderStyle
  gap: number
  escape: number
  charge: Charge
  peerContext?: ClassHeaderPeerContext
}
export interface ClassHeaderLaneCandidate {
  points: Point[]
  side: 'low' | 'high'
  offset: number
  lane: number
  low: number
  high: number
  peerContext: ClassHeaderPeerContext
  peerProof: ClassHeaderCandidatePeerProof
}
// A nominal internal capability, not a mutable global cache or proof result.
const candidateAuthority = Symbol('Class header candidate authority')
class ClassHeaderCandidatePeerProof {
  readonly #lease: { active: boolean }
  readonly #owner: number
  readonly #context: ClassHeaderPeerContext
  readonly #charge: Charge
  constructor(authority: symbol, lease: { active: boolean }, owner: number, peerContext: ClassHeaderPeerContext, charge: Charge) {
    if (authority !== candidateAuthority) throw new TypeError('Unauthorized Class header candidate proof')
    this.#lease = lease; this.#owner = owner; this.#context = peerContext; this.#charge = charge
  }
  /** Only the known synchronous header guard span may use this snapshot. It
   * performs no geometry writes or user callbacks before this check, and closes
   * the iterator BEFORE publishing an accepted route. Never cache its result. */
  clear(points: readonly Point[]): boolean {
    tick(this.#charge)
    if (!this.#lease.active) throw new LayoutCertificationError([{ strategy: 'class-header-lanes', violations: ['Stale Class header candidate proof'] }])
    return trialPeerClearInContext(points, this.#owner, this.#context, this.#charge)
  }
}
const written = (v: number): number => Number(formatSvgNumber(v))
const tick = (charge: Charge): void => {
  if (!charge()) throw new LayoutCertificationError([{ strategy: 'class-header-lanes', violations: ['Class header carrier proof work limit'] }])
}
const intersects = (a: Box, b: Box): boolean => Math.max(a.x0, b.x0) < Math.min(a.x1, b.x1) && Math.max(a.y0, b.y0) < Math.min(a.y1, b.y1)
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
function primitives(points: readonly Point[], owner: number, half: number, radius: number, charge: Charge, raw: readonly Point[] = points): Piece[] | undefined {
  const pieces: Piece[] = []
  for (let i = 1; i < points.length; i++) {
    tick(charge)
    const a = points[i - 1]!, b = points[i]!
    if (same(a, b) || a.x !== b.x && a.y !== b.y) return undefined
    if (half > 0) pieces.push({ owner, kind: 'strip', segment: i - 1, axis: a.y === b.y ? 'x' : 'y', box: a.y === b.y ? { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: a.y - half, y1: a.y + half } : { x0: a.x - half, x1: a.x + half, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) } })
    if (i + 1 === points.length) continue
    const c = points[i + 1]!, ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y), vx = Math.sign(c.x - b.x), vy = Math.sign(c.y - b.y), turn = ux * vy - uy * vx
    if (!turn || half <= 0) continue
    if (radius > 0) {
      const ra = raw[i - 1]!, rb = raw[i]!, rc = raw[i + 1]!, previousLength = Math.abs(rb.x - ra.x) + Math.abs(rb.y - ra.y), nextLength = Math.abs(rc.x - rb.x) + Math.abs(rc.y - rb.y), r = Math.min(radius, previousLength / 2, nextLength / 2)
      // Match the raw Manhattan interpolation, THEN numeric serialization,
      // used by projectRoundedConnectorPath and the SVG writer.
      const before = { x: written(rb.x + (ra.x - rb.x) * (r / previousLength)), y: written(rb.y + (ra.y - rb.y) * (r / previousLength)) }, after = { x: written(rb.x + (rc.x - rb.x) * (r / nextLength)), y: written(rb.y + (rc.y - rb.y) * (r / nextLength)) }
      // The actual quadratic and its stroke stay in this expanded control hull.
      // An overlapping hull is unproved, not a claim of curved ink collision.
      pieces.push({ owner, kind: 'curve', segment: i - 1, axis: 'x', box: { x0: Math.min(before.x, b.x, after.x) - half, x1: Math.max(before.x, b.x, after.x) + half, y0: Math.min(before.y, b.y, after.y) - half, y1: Math.max(before.y, b.y, after.y) + half } })
    } else {
      const side = turn > 0 ? -1 : 1, dx = (-uy * side + -vy * side) * half, dy = (ux * side + vx * side) * half
      // A cardinal default miter is exactly the outer quarter-square.
      pieces.push({ owner, kind: 'join', segment: i - 1, axis: 'x', box: { x0: Math.min(b.x, b.x + dx), x1: Math.max(b.x, b.x + dx), y0: Math.min(b.y, b.y + dy), y1: Math.max(b.y, b.y + dy) } })
    }
  }
  return pieces
}
function context(relationships: readonly PositionedClassRelationship[], style: ResolvedRenderStyle, charge: Charge): ClassHeaderPeerContext {
  const half = written(style.lineWidth) / 2, radius = style.edgeBendRadius, routes: Route[] = [], pieces: Piece[] = []
  if (![half, radius].every(Number.isFinite) || half < 0 || radius < 0) throw new TypeError('Nonfinite Class header stroke')
  for (let owner = 0; owner < relationships.length; owner++) {
    tick(charge)
    const rel = relationships[owner]!, raw: Point[] = [], points: Point[] = []
    for (const p of rel.points) {
      tick(charge)
      if (![p.x, p.y].every(Number.isFinite)) throw new TypeError('Nonfinite Class header carrier')
      raw.push({ x: p.x, y: p.y }); points.push({ x: written(p.x), y: written(p.y) })
    }
    routes.push({ from: rel.from, to: rel.to, dashed: classRelationshipLineStyle(rel) === 'dashed', raw, points })
    const ink = primitives(points, owner, half, radius, charge, raw)
    if (!ink) throw new LayoutCertificationError([{ strategy: 'class-header-lanes', violations: ['Unproved noncardinal Class header carrier'] }])
    pieces.push(...ink)
  }
  return { ...indexPieces(pieces, routes, charge), routes, pieces, half, radius }
}
function indexPieces(pieces: readonly Piece[], routes: readonly Route[], charge: Charge) {
  const horizontal: Entry[] = [], vertical: Entry[] = [], horizontalEnds: Entry[] = [], verticalEnds: Entry[] = [], cornersX: Entry[] = [], cornersY: Entry[] = []
  let cornerHalfX = 0, cornerHalfY = 0
  for (const p of pieces) {
    tick(charge)
    if (p.kind === 'strip') {
      const a = routes[p.owner]!.points[p.segment]!, b = routes[p.owner]!.points[p.segment + 1]!
      if (p.axis === 'x') { horizontal.push({ key: a.y, piece: p }); horizontalEnds.push({ key: a.x, piece: p }, { key: b.x, piece: p }) }
      else { vertical.push({ key: a.x, piece: p }); verticalEnds.push({ key: a.y, piece: p }, { key: b.y, piece: p }) }
    } else {
      cornersX.push({ key: (p.box.x0 + p.box.x1) / 2, piece: p }); cornersY.push({ key: (p.box.y0 + p.box.y1) / 2, piece: p })
      cornerHalfX = Math.max(cornerHalfX, (p.box.x1 - p.box.x0) / 2); cornerHalfY = Math.max(cornerHalfY, (p.box.y1 - p.box.y0) / 2)
    }
  }
  for (const entries of [horizontal, vertical, horizontalEnds, verticalEnds, cornersX, cornersY]) entries.sort((a, b) => { tick(charge); return a.key - b.key || a.piece.owner - b.piece.owner || a.piece.segment - b.piece.segment })
  return { horizontal, vertical, horizontalEnds, verticalEnds, cornersX, cornersY, cornerHalfX, cornerHalfY }
}

function* range(entries: readonly Entry[], lo: number, hi: number, charge: Charge): Generator<Piece> {
  let l = 0, r = entries.length
  while (l < r) { tick(charge); const m = (l + r) >>> 1; if (entries[m]!.key < lo) l = m + 1; else r = m }
  for (; l < entries.length; l++) { tick(charge); const e = entries[l]!; if (e.key > hi) break; yield e.piece }
}
function* peers(p: Piece, c: ClassHeaderPeerContext, charge: Charge): Generator<Piece> {
  const b = p.box, h = c.half
  const seen = new Set<Piece>()
  const lists: Array<Generator<Piece>> = []
  if (p.kind === 'strip' && p.axis === 'x') lists.push(range(c.horizontal, b.y0 - h, b.y1 + h, charge), range(c.vertical, b.x0 - h, b.x0 + h, charge), range(c.vertical, b.x1 - h, b.x1 + h, charge), range(c.verticalEnds, b.y0 - h, b.y1 + h, charge), range(c.cornersY, b.y0 - c.cornerHalfY, b.y1 + c.cornerHalfY, charge))
  else if (p.kind === 'strip') lists.push(range(c.vertical, b.x0 - h, b.x1 + h, charge), range(c.horizontal, b.y0 - h, b.y0 + h, charge), range(c.horizontal, b.y1 - h, b.y1 + h, charge), range(c.horizontalEnds, b.x0 - h, b.x1 + h, charge), range(c.cornersX, b.x0 - c.cornerHalfX, b.x1 + c.cornerHalfX, charge))
  else lists.push(range(c.horizontal, b.y0 - h, b.y1 + h, charge), range(c.vertical, b.x0 - h, b.x1 + h, charge), range(c.cornersX, b.x0 - c.cornerHalfX, b.x1 + c.cornerHalfX, charge))
  for (const list of lists) for (const q of list) { tick(charge); if (!seen.has(q)) { seen.add(q); yield q } }
}
function proper(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a.x === b.x && c.y === d.y) return Math.min(a.y, b.y) < c.y && c.y < Math.max(a.y, b.y) && Math.min(c.x, d.x) < a.x && a.x < Math.max(c.x, d.x)
  return a.y === b.y && c.x === d.x && Math.min(a.x, b.x) < c.x && c.x < Math.max(a.x, b.x) && Math.min(c.y, d.y) < a.y && a.y < Math.max(c.y, d.y)
}
/** The existing route-contact contract permits an authored common physical
 * endpoint, not a positive collinear shared stem or whole-path reuse. */
function sharedTerminalContact(box: Box, a: Route, b: Route, p: Piece, q: Piece, half: number, charge: Charge): boolean {
  if (p.kind !== 'strip' || q.kind !== 'strip' || p.axis === q.axis) return false
  for (const afrom of [true, false]) for (const bfrom of [true, false]) {
    tick(charge)
    if (p.segment !== (afrom ? 0 : a.points.length - 2) || q.segment !== (bfrom ? 0 : b.points.length - 2)) continue
    if ((afrom ? a.from : a.to) !== (bfrom ? b.from : b.to)) continue
    const ap = a.points[afrom ? 0 : a.points.length - 1]!, bp = b.points[bfrom ? 0 : b.points.length - 1]!
    if (same(ap, bp) && box.x0 >= ap.x - half && box.x1 <= ap.x + half && box.y0 >= ap.y - half && box.y1 <= ap.y + half) return true
  }
  return false
}

function current(c: ClassHeaderPeerContext, relationships: readonly PositionedClassRelationship[], style: ResolvedRenderStyle, charge: Charge): boolean {
  if (c.routes.length !== relationships.length || c.half !== written(style.lineWidth) / 2 || c.radius !== style.edgeBendRadius) return false
  for (let i = 0; i < relationships.length; i++) {
    tick(charge)
    const r = relationships[i]!, old = c.routes[i]!
    if (r.from !== old.from || r.to !== old.to || (classRelationshipLineStyle(r) === 'dashed') !== old.dashed || r.points.length !== old.raw.length) return false
    for (let j = 0; j < r.points.length; j++) { tick(charge); if (!same(r.points[j]!, old.raw[j]!)) return false }
  }
  return true
}
/** Refresh only changed owners inside one synchronous header repair. Every
 * source value is compared, including in-place edits; unchanged sorted entries
 * are retained, never a cached success or reference-identity proof. */
function refresh(c: ClassHeaderPeerContext, relationships: readonly PositionedClassRelationship[], style: ResolvedRenderStyle, charge: Charge): ClassHeaderPeerContext {
  if (current(c, relationships, style, charge)) return c
  if (c.routes.length !== relationships.length || c.half !== written(style.lineWidth) / 2 || c.radius !== style.edgeBendRadius) return context(relationships, style, charge)
  tick(charge)
  const changed = new Set<number>(), routes: Route[] = [], pieces: Piece[] = [], added: Piece[] = []
  for (let owner = 0; owner < relationships.length; owner++) {
    tick(charge)
    const r = relationships[owner]!, old = c.routes[owner]!, dashed = classRelationshipLineStyle(r) === 'dashed'
    let unchanged = r.from === old.from && r.to === old.to && dashed === old.dashed && r.points.length === old.raw.length
    if (unchanged) for (let i = 0; i < r.points.length; i++) { tick(charge); if (!same(r.points[i]!, old.raw[i]!)) { unchanged = false; break } }
    if (unchanged) { routes.push(old); continue }
    changed.add(owner)
    const raw: Point[] = [], points: Point[] = []
    for (const p of r.points) {
      tick(charge)
      if (![p.x, p.y].every(Number.isFinite)) throw new TypeError('Nonfinite Class header carrier')
      raw.push({ x: p.x, y: p.y }); points.push({ x: written(p.x), y: written(p.y) })
    }
    routes.push({ from: r.from, to: r.to, dashed, raw, points })
    const ink = primitives(points, owner, c.half, c.radius, charge, raw)
    if (!ink) throw new LayoutCertificationError([{ strategy: 'class-header-lanes', violations: ['Unproved noncardinal Class header carrier'] }])
    for (const piece of ink) { tick(charge); added.push(piece) }
  }
  for (const piece of c.pieces) { tick(charge); if (!changed.has(piece.owner)) pieces.push(piece) }
  for (const piece of added) { tick(charge); pieces.push(piece) }
  const delta = indexPieces(added, routes, charge)
  const merge = (old: readonly Entry[], extra: readonly Entry[]): Entry[] => {
    tick(charge)
    const out: Entry[] = []
    let i = 0
    for (const entry of old) {
      tick(charge)
      if (changed.has(entry.piece.owner)) continue
      while (i < extra.length) {
        tick(charge)
        const next = extra[i]!
        if ((next.key - entry.key || next.piece.owner - entry.piece.owner || next.piece.segment - entry.piece.segment) > 0) break
        out.push(next); i++
      }
      out.push(entry)
    }
    for (; i < extra.length; i++) { tick(charge); out.push(extra[i]!) }
    return out
  }
  return { routes, pieces, half: c.half, radius: c.radius,
    horizontal: merge(c.horizontal, delta.horizontal), vertical: merge(c.vertical, delta.vertical),
    horizontalEnds: merge(c.horizontalEnds, delta.horizontalEnds), verticalEnds: merge(c.verticalEnds, delta.verticalEnds),
    cornersX: merge(c.cornersX, delta.cornersX), cornersY: merge(c.cornersY, delta.cornersY),
    cornerHalfX: Math.max(c.cornerHalfX, delta.cornerHalfX), cornerHalfY: Math.max(c.cornerHalfY, delta.cornerHalfY) }
}
/** Refresh after all note/contact/annotation writes. Unchanged copied rows
 * and sorted axis entries are borrowed; changed rows pay the shared canonical
 * projection envelope. Stroke boxes and old contact outcomes are never used. */
export function finalClassHeaderNumericSeed(capture: ClassHeaderNumericCapture, relationships: readonly PositionedClassRelationship[], style: ResolvedRenderStyle, charge: Charge): ClassHeaderNumericSeed | undefined {
  tick(charge)
  const before = capture[numericContext]
  if (!before) return undefined
  tick(charge)
  capture[numericContext] = undefined // One final traversal, never another revision.
  tick(charge) // The local debit callback, before construction.
  const pay = (units: number): void => { for (let i = 0; i < units; i++) tick(charge) }
  if (style.edgeBendRadius !== 0 || before.radius !== 0 || before.routes.length !== relationships.length) return undefined
  let half: number
  if (Number.isSafeInteger(style.lineWidth)) { pay(2); half = style.lineWidth / 2 }
  else { pay(133); half = written(style.lineWidth) / 2 }
  if (before.half !== half) return undefined
  let changed: Set<number> | undefined
  for (let owner = 0; owner < relationships.length; owner++) {
    tick(charge)
    const live = relationships[owner]!, old = before.routes[owner]!
    if (live.from !== old.from || live.to !== old.to || (classRelationshipLineStyle(live) === 'dashed') !== old.dashed) return undefined
    let equal = live.points.length === old.raw.length
    if (equal) for (let i = 0; i < live.points.length; i++) {
      tick(charge)
      if (!same(live.points[i]!, old.raw[i]!)) { equal = false; break }
    }
    if (!equal) {
      if (!changed) { tick(charge); changed = new Set() }
      tick(charge); changed.add(owner)
    }
  }
  if (!changed) {
    pay(6)
    return { routes: before.routes, horizontal: before.horizontal, vertical: before.vertical, horizontalEnds: before.horizontalEnds, verticalEnds: before.verticalEnds }
  }
  type NumericRoute = ClassHeaderNumericSeed['routes'][number]
  type NumericEntry = ClassHeaderNumericSeed['horizontal'][number]
  pay(before.routes.length + 5) // Copied row references and four new-entry arrays.
  const routes: NumericRoute[] = before.routes.slice(), horizontal: NumericEntry[] = [], vertical: NumericEntry[] = [], horizontalEnds: NumericEntry[] = [], verticalEnds: NumericEntry[] = []
  for (const owner of changed) {
    tick(charge)
    const live = relationships[owner]!
    pay(5) // Two row headers and a two-field route record.
    const raw: Point[] = [], points: Point[] = []
    for (const p of live.points) {
      tick(charge)
      const projected = projectMeasuredRoutePoint(p, pay, pay)
      if (!projected) return undefined
      // Safe integer projection may return the live point; retain an owned
      // copy, just as the original header context does for every coordinate.
      pay(projected === p ? 8 : 5)
      raw.push({ x: p.x, y: p.y })
      points.push(projected === p ? { x: p.x, y: p.y } : projected)
    }
    routes[owner] = { raw, points }
    for (let i = 1; i < points.length; i++) {
      tick(charge)
      const a = points[i - 1]!, b = points[i]!
      if (same(a, b) || a.x !== b.x && a.y !== b.y) return undefined
      pay(15) // One numeric piece, three entry records and three list references.
      const piece = { owner, segment: i - 1 }, h = a.y === b.y
      ;(h ? horizontal : vertical).push({ key: h ? a.y : a.x, piece })
      ;(h ? horizontalEnds : verticalEnds).push({ key: h ? a.x : a.y, piece }, { key: h ? b.x : b.y, piece })
    }
  }
  tick(charge) // One comparator shared by both actual sorts and merges.
  const compare = (a: NumericEntry, b: NumericEntry): number => { tick(charge); return a.key - b.key || a.piece.owner - b.piece.owner || a.piece.segment - b.piece.segment }
  horizontal.sort(compare); vertical.sort(compare); horizontalEnds.sort(compare); verticalEnds.sort(compare)
  tick(charge)
  const merge = (old: readonly NumericEntry[], added: readonly NumericEntry[]): NumericEntry[] => {
    tick(charge)
    const entries: NumericEntry[] = []
    let i = 0
    for (const entry of old) {
      tick(charge)
      if (changed.has(entry.piece.owner)) continue
      while (i < added.length && compare(added[i]!, entry) <= 0) { tick(charge); entries.push(added[i++]!) }
      tick(charge); entries.push(entry)
    }
    for (; i < added.length; i++) { pay(2); entries.push(added[i]!) }
    return entries
  }
  const h = merge(before.horizontal, horizontal), v = merge(before.vertical, vertical), he = merge(before.horizontalEnds, horizontalEnds), ve = merge(before.verticalEnds, verticalEnds)
  pay(6)
  return { routes, horizontal: h, vertical: v, horizontalEnds: he, verticalEnds: ve }
}
/** Continuous strips are sufficient reservations for dashed carriers too. They
 * prevent two unrelated dashed meanings from interleaving into one solid run. */
export function classHeaderPeerClear(points: readonly Point[], owner: number, relationships: readonly PositionedClassRelationship[], style: ResolvedRenderStyle, charge: Charge, prepared?: ClassHeaderPeerContext): boolean {
  const c = prepared ? refresh(prepared, relationships, style, charge) : context(relationships, style, charge)
  return trialPeerClearInContext(points, owner, c, charge)
}
function trialPeerClearInContext(points: readonly Point[], owner: number, c: ClassHeaderPeerContext, charge: Charge): boolean {
  const original = c.routes[owner]!, own: Route = { from: original.from, to: original.to, dashed: original.dashed, raw: points.map(p => { tick(charge); return { ...p } }), points: points.map(p => { tick(charge); return { x: written(p.x), y: written(p.y) } }) }
  return peerClearInContext(own, owner, c, charge)
}
/** The route and peer pieces are immutable snapshots from the same context. */
function peerClearInContext(own: Route, owner: number, c: ClassHeaderPeerContext, charge: Charge): boolean {
  const ink = primitives(own.points, owner, c.half, c.radius, charge, own.raw)
  if (!ink) return false
  for (const p of ink) for (const q of peers(p, c, charge)) {
    tick(charge)
    if (q.owner === owner || !intersects(p.box, q.box)) continue
    const peer = c.routes[q.owner]!
    if (p.kind === 'strip' && q.kind === 'strip') {
      tick(charge)
      if (proper(own.points[p.segment]!, own.points[p.segment + 1]!, peer.points[q.segment]!, peer.points[q.segment + 1]!)) continue
    }
    const intersection = { x0: Math.max(p.box.x0, q.box.x0), x1: Math.min(p.box.x1, q.box.x1), y0: Math.max(p.box.y0, q.box.y0), y1: Math.min(p.box.y1, q.box.y1) }
    if (!sharedTerminalContact(intersection, own, peer, p, q, c.half, charge)) return false
  }
  return true
}
/** Two original orientations, then the earliest finite stroke-critical offsets.
 * Move BOTH bypass rows and the cross lane: moving only the cross lane still
 * co-owns the long before/after spurs. No canvas growth or model reroute. */
export function* classHeaderDetourCandidates(o: ClassHeaderLaneOptions): Generator<ClassHeaderLaneCandidate> {
  const { charge } = o, c = o.peerContext ? refresh(o.peerContext, o.relationships, o.style, charge) : context(o.relationships, o.style, charge), a = { x: written(o.a.x), y: written(o.a.y) }, b = { x: written(o.b.x), y: written(o.b.y) }
  const vertical = a.x === b.x
  if (!vertical && a.y !== b.y) return
  const main = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y', h = o.header
  const start = written(h[main]), size = written(vertical ? h.height : h.width), lo = written(start - o.gap), hi = written(start + size + o.gap)
  if (Math.min(a[main], b[main]) >= lo || Math.max(a[main], b[main]) <= hi) return
  const bases = [{ side: 'low' as const, lane: written(h[cross] - o.escape) }, { side: 'high' as const, lane: written(h[cross] + (vertical ? h.width : h.height) + o.escape) }].sort((l, r) => Math.abs(l.lane - a[cross]) - Math.abs(r.lane - a[cross]))
  const maximum = Math.min(lo - Math.min(a[main], b[main]), Math.max(a[main], b[main]) - hi), quantum = Math.max(1, written(o.style.lineWidth)), offsets = new Set<number>([0])
  const add = (n: number) => { if (n > 0 && Number.isFinite(n)) { const offset = Math.ceil(n / quantum) * quantum; if (offset < maximum) offsets.add(offset) } }
  for (const p of c.pieces) {
    tick(charge)
    if (p.owner === o.owner) continue
    const low = vertical ? p.box.y0 : p.box.x0, high = vertical ? p.box.y1 : p.box.x1, left = vertical ? p.box.x0 : p.box.y0, right = vertical ? p.box.x1 : p.box.y1
    add(lo + c.half - low); add(high + c.half - hi); add(bases.find(v => v.side === 'low')!.lane + c.half - left); add(right + c.half - bases.find(v => v.side === 'high')!.lane)
  }
  const ordered = [...offsets].sort((a, b) => { tick(charge); return a - b })
  for (const offset of ordered) for (const base of bases) {
    tick(charge)
    const low = written(lo - offset), high = written(hi + offset), lane = written(base.lane + (base.side === 'low' ? -offset : offset))
    const before = { ...a, [main]: a[main] < b[main] ? low : high }, after = { ...b, [main]: a[main] < b[main] ? high : low }
    const points = [before, { ...before, [cross]: lane }, { ...after, [cross]: lane }, after]
    if (points.some(p => p.x < c.half || p.y < c.half || p.x > o.width - c.half || p.y > o.height - c.half)) continue
    // Prepay the constant capability construction and its mandatory release;
    // exhaustion during a trial still closes the lease without further work.
    tick(charge); tick(charge); tick(charge)
    const lease = { active: true }, peerProof = new ClassHeaderCandidatePeerProof(candidateAuthority, lease, o.owner, c, charge)
    try { yield { points, side: base.side, offset, lane, low, high, peerContext: c, peerProof } }
    finally { lease.active = false }
  }
}
/** Final current changed-route × ALL-route closure, including future repairs. */
export function assertClassHeaderPeersClear(diagram: Pick<PositionedClassDiagram, 'relationships'>, changed: ReadonlySet<number>, style: ResolvedRenderStyle, charge: Charge): void {
  if (!changed.size) return
  const c = context(diagram.relationships, style, charge)
  for (const owner of changed) {
    tick(charge)
    // This synchronous closure performs no geometry writes between the fresh
    // copy above and these tests. Reuse that snapshot, not an earlier success;
    // every actual primitive/index/overlap test still charges the same ledger.
    if (!peerClearInContext(c.routes[owner]!, owner, c, charge)) throw new LayoutCertificationError([{ strategy: 'class-header-lanes', violations: [`No proved final header carrier separation for ${c.routes[owner]!.from} -> ${c.routes[owner]!.to}`] }])
  }
}
