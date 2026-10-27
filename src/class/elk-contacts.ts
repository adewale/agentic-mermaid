import { LayoutCertificationError } from '../layout/certification-error.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } from './marker-admission.ts'
import { addClassSvgNumbers, compareClassSvgSum } from './owned-surfaces.ts'
import type { PositionedClassDiagram, PositionedClassNode, PositionedClassRelationship } from './types.ts'

export interface ClassElkContact {
  node: PositionedClassNode
  relation: PositionedClassRelationship
  from: boolean
  axis: 'x' | 'y'
}
const charge = (work?: ClassMarkerAdmissionWork): void => {
  if (work && !chargeClassMarkerAdmissionWork(work)) throw new LayoutCertificationError([{ strategy: 'class-elk-contact', violations: ['Class contact projection proof work limit'] }])
}

/** Retain only exact raw rectangle/normal identities, before the title's rigid
 * translation. References stay within the owned, freshly extracted artifact. */
export function retainClassElkContacts(diagram: PositionedClassDiagram, work?: ClassMarkerAdmissionWork): ClassElkContact[] {
  const nodes = new Map(diagram.classes.map(node => { charge(work); return [node.id, node] })),
    contacts: ClassElkContact[] = []
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
export function projectClassElkContacts(contacts: readonly ClassElkContact[], work?: ClassMarkerAdmissionWork): void {
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
