import { LayoutCertificationError } from '../layout/certification-error.ts'
import { writtenCoordinateGapLessThan } from '../layout/measured-route-safety.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } from './marker-admission.ts'
import { addClassSvgNumbers, classCarrierBoundsMayMeetMarker, classCarrierSupportBounds, classRelationshipPaintBoxes, compareClassSvgSum } from './owned-surfaces.ts'
import type { PositionedClassDiagram, PositionedClassNode, PositionedClassRelationship } from './types.ts'

export interface ClassRectangleContact {
  node: PositionedClassNode
  relation: PositionedClassRelationship
  from: boolean
  axis: 'x' | 'y'
}
const charge = (work?: ClassMarkerAdmissionWork, units = 1): void => {
  for (let unit = 0; unit < units; unit++) if (work && !chargeClassMarkerAdmissionWork(work)) throw new LayoutCertificationError([{ strategy: 'class-elk-contact', violations: ['Class contact projection proof work limit'] }])
}

/** Construct one sharp unmarked rectangular loop from its literal endpoint
 * face and existing parallel inner support. This is new geometry, not a
 * tolerance-based assertion that the solver's diagonal was already axial. */
export function constructClassElkSelfContacts(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, work: ClassMarkerAdmissionWork): Set<number> | undefined {
  if (style.edgeBendRadius !== 0 || style.cornerRadius !== 0) return
  let changed: Set<number> | undefined
  charge(work, 2)
  const pay = (units = 1): void => charge(work, units)
  const written = (value: number): number => {
    pay(2)
    const text = String(value)
    pay(text.length)
    return Number(formatSvgNumber(value))
  }
  const compare = (value: number, origin: number, size: number): number => {
    // Includes the bounded decimal parsing/alignment scratch in the existing
    // exact written-face helper; no cheaper uncharged copy of that predicate.
    pay(2048)
    return compareClassSvgSum(value, origin, size)
  }
  for (let index = 0; index < diagram.relationships.length; index++) {
    pay(8)
    const rel = diagram.relationships[index]!
    if (rel.from !== rel.to || rel.markerAt !== 'none' || rel.label !== undefined || rel.fromCardinality !== undefined || rel.toCardinality !== undefined || rel.points.length !== 4) continue
    const A = rel.points[0]!, B = rel.points[1]!, C = rel.points[2]!, D = rel.points[3]!
    // Already axial originals retain their exact owned array and point records.
    if ((A.x === B.x || A.y === B.y) && (C.x === D.x || C.y === D.y)) continue
    let node: PositionedClassNode | undefined
    for (const candidate of diagram.classes) { pay(); if (candidate.id === rel.from) { node = candidate; break } }
    if (!node || node.isInterface) continue
    pay(32)
    if (![A.x,A.y,B.x,B.y,C.x,C.y,D.x,D.y,node.x,node.y,node.width,node.height,style.lineWidth].every(Number.isFinite) || !(node.width > 0 && node.height > 0 && style.lineWidth > 0)) continue
    pay(12)
    const a = { x: written(A.x), y: written(A.y) }, b = { x: written(B.x), y: written(B.y) }, c = { x: written(C.x), y: written(C.y) }, d = { x: written(D.x), y: written(D.y) }
    if ((a.x === b.x || a.y === b.y) && (c.x === d.x || c.y === d.y)) continue
    const x = written(node.x), y = written(node.y), width = written(node.width), height = written(node.height)
    let axis: 'x' | 'y' | undefined, sign = 0
    // Strict cross-coordinate interior excludes corners/ambiguous normals.
    if (a.x === d.x && a.y > y && d.y > y && compare(a.y,y,height) < 0 && compare(d.y,y,height) < 0) {
      if (a.x === x) { axis = 'x'; sign = -1 }
      else if (compare(a.x,x,width) === 0) { axis = 'x'; sign = 1 }
    } else if (a.y === d.y && a.x > x && d.x > x && compare(a.x,x,width) < 0 && compare(d.x,x,width) < 0) {
      if (a.y === y) { axis = 'y'; sign = -1 }
      else if (compare(a.y,y,height) === 0) { axis = 'y'; sign = 1 }
    }
    if (!axis) continue
    const cross = axis === 'x' ? 'y' : 'x'
    pay(10)
    if (b[axis] !== c[axis] || Math.sign(b[axis] - a[axis]) !== sign || a[cross] === d[cross] || Math.sign(c[cross] - b[cross]) !== Math.sign(d[cross] - a[cross])) continue
    // First retain any already-written outward geometry byte-for-byte.
    if (a[cross] === b[cross] && c[cross] === d[cross]) continue
    pay(4)
    if (writtenCoordinateGapLessThan(formatSvgNumber(a[cross]), formatSvgNumber(d[cross]), formatSvgNumber(written(style.lineWidth)), pay, pay) !== false) continue
    pay(13) // two point records, four array references/header and Set entry.
    const first = { x: B.x, y: B.y }, last = { x: C.x, y: C.y }
    first[cross] = A[cross]; last[cross] = D[cross]
    last[axis] = first[axis]
    const points = [A, first, last, D]
    if (!changed) { pay(); changed = new Set() }
    rel.points = points
    changed.add(index)
  }
  return changed
}

/** Fresh final geometry only: no marker pose/proof from before title, note,
 * header or annotation writes is reused for a newly constructed carrier. */
export function assertClassElkSelfContactsClear(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, changed: ReadonlySet<number> | undefined, work: ClassMarkerAdmissionWork): void {
  if (!changed?.size) return
  charge(work)
  const pay = (units = 1): void => charge(work, units)
  const refuse = (): never => { throw new LayoutCertificationError([{ strategy: 'class-elk-contact', violations: ['Constructed Class self contact has unproved final support'] }]) }
  pay(2)
  const width=Number(formatSvgNumber(style.lineWidth))
  // New invocation owns all resource/connector/region scratch. The canonical
  // roster has five fixed descriptors; each endpoint has at most nine clipped
  // pieces. Existing callbacks additionally pay actual geometry visits.
  pay(512)
  for(const rel of diagram.relationships){
    pay(128)
    for(const point of rel.points){pay(8);const x=String(point.x),y=String(point.y);pay(4*(x.length+y.length))}
    if(rel.markerAt==='from'||rel.markerAt==='both')pay(4096)
    if(rel.markerAt==='to'||rel.markerAt==='both')pay(4096)
  }
  const markers = classRelationshipPaintBoxes(diagram,style,true,pay,false)
  for (const index of changed) {
    pay()
    const points = diagram.relationships[index]!.points
    // A subsequent repair may have changed arity. Its general proof is not a
    // certificate for this deliberately bounded rectangular-loop constructor.
    if (points.length !== 4) refuse()
    pay(18) // four point records, result array/header/references and mapper.
    const rows = points.map(p => { pay(2);const x=String(p.x),y=String(p.y);pay(x.length+y.length);return {x:Number(formatSvgNumber(p.x)),y:Number(formatSvgNumber(p.y))} })
    const a=rows[0]!,b=rows[1]!,c=rows[2]!,d=rows[3]!, vertical=a.x===b.x
    pay(8)
    if(vertical ? b.y!==c.y||c.x!==d.x||a.y!==d.y||a.x===d.x||a.y===b.y : a.y!==b.y||b.x!==c.x||c.y!==d.y||a.x!==d.x||a.y===d.y||a.x===b.x)refuse()
    pay(4)
    if(writtenCoordinateGapLessThan(formatSvgNumber(vertical?a.x:a.y),formatSvgNumber(vertical?d.x:d.y),formatSvgNumber(width),pay,pay)!==false)refuse()
    pay(4)
    const supports=[]
    for(let segment=1;segment<rows.length;segment++){
      pay(3)
      supports.push(classCarrierSupportBounds([rows[segment-1]!,rows[segment]!],width,pay))
    }
    for (const marker of markers) {
      pay()
      for(const support of supports){
        pay()
        if(classCarrierBoundsMayMeetMarker(support,marker.box,pay))refuse()
      }
    }
  }
}

/** Retain exact raw rectangle/normal identities from either producer before
 * the title's rigid translation. References stay within the owned artifact. */
export function retainClassRectangleContacts(diagram: PositionedClassDiagram, work?: ClassMarkerAdmissionWork): ClassRectangleContact[] {
  const nodes = new Map(diagram.classes.map(node => { charge(work); return [node.id, node] })),
    contacts: ClassRectangleContact[] = []
  for (const relation of diagram.relationships)
    for (const from of [true, false]) {
      charge(work)
      const node = nodes.get(from ? relation.from : relation.to)
      if (!node || node.isInterface || relation.points.length < 2) continue
      const a = from ? relation.points[0]! : relation.points.at(-1)!,
        b = from ? relation.points[1]! : relation.points.at(-2)!
      let axis: 'x' | 'y' | undefined
      if (a.x === node.x + node.width && b.x > a.x && b.y === a.y && a.y > node.y && a.y < node.y + node.height) axis = 'x'
      else if (a.y === node.y + node.height && b.y > a.y && b.x === a.x && a.x > node.x && a.x < node.x + node.width) axis = 'y'
      if (axis) contacts.push({node, relation, from, axis})
    }
  return contacts
}

/** Reconcile a proved raw face to the exact sum of the two actual SVG fields.
 * No nearby point, automatic side or unrelated coordinate is reassigned. */
export function projectClassRectangleContacts(contacts: readonly ClassRectangleContact[], work?: ClassMarkerAdmissionWork): void {
  const updates: { point: { x: number; y: number }; axis: 'x' | 'y'; value: number }[] = []
  for (const {node, relation, from, axis} of contacts) {
    charge(work)
    const a = from ? relation.points[0]! : relation.points.at(-1)!,
      b = from ? relation.points[1]! : relation.points.at(-2)!,
      other = axis === 'x' ? 'y' : 'x',
      size = axis === 'x' ? node.width : node.height
    if (compareClassSvgSum(a[axis], node[axis], size) === 0) continue
    const face = addClassSvgNumbers(node[axis], size)
    if (face === undefined) throw new LayoutCertificationError([{ strategy: 'class-elk-contact', violations: ['Exact written Class rectangle face is not representable'] }])
    if (!(Number(formatSvgNumber(b[axis])) > face) || Number(formatSvgNumber(b[other])) !== Number(formatSvgNumber(a[other]))) throw new LayoutCertificationError([{ strategy: 'class-elk-contact', violations: ['Written Class contact has no outward lead'] }])
    charge(work)
    updates.push({ point: a, axis, value: face })
  }
  for (const _update of updates) charge(work) // Prepay before any publication.
  for (const { point, axis, value } of updates) point[axis] = value
}
