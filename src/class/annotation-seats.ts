import { LayoutCertificationError } from '../layout/certification-error.ts'
import { resolveLabelContent } from '../shared/display-text.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { diagramTitleBand, type ResolvedRenderStyle } from '../styles.ts'
import type { Point } from '../types.ts'
import { classTextBlock } from './layout.ts'
import { type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } from './marker-admission.ts'
import { type ClassSurfaceBox, classRelationshipPaintBoxes, classSegmentEntersBox } from './owned-surfaces.ts'
import { CLASS_TEXT_CANDIDATE_LIMIT, classCaptionAnchor, classCardinalityAnchor, classEndpointTextCandidates, RELATION_LABEL_HALO_WIDTH, RELATION_LABEL_OFFSET_Y } from './relationship-paint.ts'
import type { PositionedClassDiagram, PositionedClassRelationship } from './types.ts'

type Role = 'caption' | 'from' | 'to'
type Seat = { rel: PositionedClassRelationship; edge: number; role: Role; block: PixelTextBlock; original: Point; center: Point; next?: Point; fixed?: boolean }
const written = (n: number) => Number(formatSvgNumber(n))
const overlaps = (a: ClassSurfaceBox, b: ClassSurfaceBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const row = (seat: Seat, center: Point): ClassSurfaceBox => {
  const width = written(seat.block.width),
    height = written(seat.block.height),
    half = RELATION_LABEL_HALO_WIDTH / 2
  return { x: center.x - width / 2 - half, y: center.y - height / 2 - half, width: width + 2 * half, height: height + 2 * half }
}
const centerOf = (point: Point, role: Role): Point => ({ x: written(point.x), y: written(point.y - (role === 'caption' ? RELATION_LABEL_OFFSET_Y : 0)) })

/** Seat actual Class annotations, preserving the intentional shaft/halo policy.
 * Measured rows plus the real halo are sufficient clearances, not claims that
 * every row-box overlap is actual glyph ink. No route or contact is changed. */
export function repairClassAnnotationSeats(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, ledger: ClassMarkerAdmissionWork, changed?: ReadonlySet<number>): void {
  if ((!diagram.relationships.some(r => r.markerAt !== 'none') && !changed?.size) || !diagram.relationships.some(r => r.label || r.fromCardinality || r.toCardinality)) return
  const charge = () => {
    if (!chargeClassMarkerAdmissionWork(ledger)) throw new LayoutCertificationError([{ strategy: 'class-owned-annotation', violations: ['Class annotation proof work limit'] }])
  }
  const seats: Seat[] = []
  for (const [edge, rel] of diagram.relationships.entries()) {
    charge()
    if (rel.points.length < 2) continue
    const add = (role: Role, original: Point | undefined, block: PixelTextBlock) => {
      // Formatting-only source has no occupied text and must not acquire a seat.
      if (!original || !block.text) return
      charge()
      seats.push({ rel, edge, role, original, block, center: centerOf(original, role) })
    }
    if (rel.label) add('caption', classCaptionAnchor(rel), rel.labelBlock ?? classTextBlock(resolveLabelContent(rel.label, rel.labelContent), style, 'edge'))
    for (const side of ['from', 'to'] as const)
      if (rel[`${side}Cardinality`])
        add(side, classCardinalityAnchor(rel, side), rel[`${side}CardinalityBlock`] ?? preparePixelText(resolveLabelContent(rel[`${side}Cardinality`]!, rel[`${side}CardinalityContent`]), { fontSize: style.edgeLabelFontSize, fontWeight: style.edgeLabelFontWeight, letterSpacing: style.edgeLetterSpacing }))
  }
  const markerPaint = classRelationshipPaintBoxes(diagram, style, true, charge, false).filter(item => {
    charge()
    return item.kind === 'marker'
  })
  const boxes: ClassSurfaceBox[] = []
  if (diagram.title) {
    charge()
    const title = diagram.title,
      block = title.block ?? diagramTitleBand(title.text, style)?.block
    if (block) boxes.push({ x: written(title.x) - written(block.width) / 2, y: written(title.y) - written(block.height) / 2, width: written(block.width), height: written(block.height) })
  }
  for (const node of diagram.classes) {
    charge()
    if (!node.isInterface) boxes.push({ x: node.x - 1, y: node.y - 1, width: node.width + 2, height: node.height + 2 })
    else {
      if (node.interfaceBox) boxes.push(node.interfaceBox)
      const block = node.labelBlock
      if (block) boxes.push({ x: node.x + (node.width - block.width) / 2, y: node.y + node.headerHeight / 2 - block.height / 2, width: block.width, height: block.height })
    }
  }
  for (const group of diagram.namespaces) {
    charge()
    boxes.push({ x: group.x, y: group.y, width: group.width, height: group.headerHeight })
  }
  for (const note of diagram.notes) {
    charge()
    boxes.push(note)
  }
  const clearStatic = (seat: Seat, center: Point): boolean => {
    charge()
    const box = row(seat, center)
    if (seat.role === 'caption' && changed?.has(seat.edge)) {
      const near = {x:box.x-8,y:box.y-8,width:box.width+16,height:box.height+16}
      let associated=false
      for(let i=1;i<seat.rel.points.length;i++) {
        charge()
        if(classSegmentEntersBox(seat.rel.points[i-1]!,seat.rel.points[i]!,near)){associated=true;break}
      }
      if(!associated)return false
    }
    if (box.x < 0 || box.y < 0 || box.x + box.width > diagram.width || box.y + box.height > diagram.height) return false
    for (const obstacle of boxes) {
      charge()
      if (overlaps(box, obstacle)) return false
    }
    for (const note of diagram.notes) {
      charge()
      if (note.targetX !== undefined && note.targetY !== undefined && classSegmentEntersBox({ x: note.targetX, y: note.targetY }, { x: note.noteX ?? note.x, y: note.noteY ?? note.y + note.height / 2 }, { x: box.x - 0.5, y: box.y - 0.5, width: box.width + 1, height: box.height + 1 })) return false
    }
    for (const marker of markerPaint) {
      charge()
      // The consumer's text visibility authority retains this full canonical
      // envelope. Separation is sufficient; an overlap is not an ink-loss claim.
      if (overlaps(box, marker.box)) return false
    }
    return true
  }
  const clearTexts = (seat: Seat, center: Point, other: Seat): boolean => {
    charge()
    return !overlaps(row(seat, center), row(other, other.next ?? other.center))
  }
  // Reserve all already-clear seats before moving anything. A moved annotation
  // cannot steal the seat of a later annotation that needs no repair.
  for (const seat of seats) {
    if (!clearStatic(seat, seat.center)) continue
    seat.fixed = true
    for (const other of seats)
      if (other !== seat && !clearTexts(seat, seat.center, other)) {
        seat.fixed = false
        break
      }
  }
  const accepted: Seat[] = seats.filter(seat => {
    charge()
    return seat.fixed
  })
  const trySeat = (seat: Seat, center: Point): boolean => {
    if (!clearStatic(seat, center)) return false
    for (const other of accepted) if (!clearTexts(seat, center, other)) return false
    seat.next = center
    accepted.push(seat)
    return true
  }
  for (const seat of seats) {
    charge()
    if (seat.fixed) continue
    if (trySeat(seat, seat.center)) continue
    let found = false,
      count = 0
    if (seat.role !== 'caption') {
      const from = seat.role === 'from',
        points = seat.rel.points,
        anchor = from ? points[0]! : points.at(-1)!,
        toward = from ? points[1]! : points.at(-2)!
      const candidates: { point: Point; distance: number; order: number }[] = []
      for (const point of classEndpointTextCandidates(anchor, toward)) {
        charge()
        const center = centerOf(point, seat.role)
        candidates.push({ point: center, distance: (center.x - seat.center.x) ** 2 + (center.y - seat.center.y) ** 2, order: candidates.length })
      }
      // The roster/cap is unchanged. For a newly invalid seat, prefer the
      // closest clear replacement rather than a remote perpendicular slot.
      candidates.sort((a, b) => {
        charge()
        return a.distance - b.distance || a.order - b.order
      })
      for (const { point } of candidates) {
        charge()
        if (++count > CLASS_TEXT_CANDIDATE_LIMIT) break
        if (trySeat(seat, point)) {
          found = true
          break
        }
      }
    } else {
      const segments: { a: Point; b: Point; index: number; distance: number }[] = []
      for (let i = 1; i < seat.rel.points.length; i++) {
        charge()
        const a = seat.rel.points[i - 1]!,
          b = seat.rel.points[i]!,
          dx = b.x - a.x,
          dy = b.y - a.y,
          t = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((seat.center.x - a.x) * dx + (seat.center.y - a.y) * dy) / (dx * dx + dy * dy))) : 0
        segments.push({ a, b, index: i, distance: (seat.center.x - a.x - dx * t) ** 2 + (seat.center.y - a.y - dy * t) ** 2 })
      }
      segments.sort((a, b) => {
        charge()
        return a.distance - b.distance || a.index - b.index
      })
      search: for (const { a, b } of segments) {
        charge()
        if (a.x !== b.x && a.y !== b.y) continue
        for (const t of [0.5, 1 / 3, 2 / 3, 0.25, 0.75, 1 / 6, 5 / 6])
          for (const side of [-1, 1]) {
            charge()
            if (++count > CLASS_TEXT_CANDIDATE_LIMIT) break search
            const vertical = a.x === b.x,
              point = { x: written(a.x + (b.x - a.x) * t + (vertical ? side * (seat.block.width / 2 + RELATION_LABEL_OFFSET_Y) : 0)), y: written(a.y + (b.y - a.y) * t + (vertical ? 0 : side * RELATION_LABEL_OFFSET_Y)) }
            if (trySeat(seat, point)) {
              found = true
              break search
            }
          }
      }
    }
    if (!found) throw new LayoutCertificationError([{ strategy: 'class-owned-annotation', violations: [`No separated ${seat.role} text seat for ${seat.rel.from} -> ${seat.rel.to} in the existing bounded candidates`] }])
  }
  // Notes and leading translations are final before this stage. The joint
  // proof precedes all writes; final surface/marker guards recompute afterward.
  for (const seat of seats) {
    const point = seat.next ?? seat.center
    if (!clearStatic(seat, point)) throw new LayoutCertificationError([{ strategy: 'class-owned-annotation', violations: ['Unproved final annotation seat'] }])
    for (const other of seats) if (other !== seat && !clearTexts(seat, point, other)) throw new LayoutCertificationError([{ strategy: 'class-owned-annotation', violations: ['Unproved final text separation'] }])
  }
  for (const seat of seats) charge() // Prepay all publication work before the first write.
  for (const seat of seats) {
    if (!seat.next || (seat.next.x === seat.center.x && seat.next.y === seat.center.y)) continue
    const point = { x: seat.next.x, y: seat.next.y + (seat.role === 'caption' ? RELATION_LABEL_OFFSET_Y : 0) }
    if (seat.role === 'caption') seat.rel.labelPosition = point
    else seat.rel[`${seat.role}CardinalityPosition`] = point
  }
}
