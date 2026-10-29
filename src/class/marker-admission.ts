import { LayoutCertificationError } from '../layout/certification-error.ts'
import { connectorMarkerPaintRegions } from '../scene/bounds.ts'
import { connector } from '../scene/marks.ts'
import { compareMarkerStrokeInk, MAX_OCCLUSION_OPERATIONS, MAX_OCCLUSION_PAIRS, type MarkerPolygonProof, prepareMarkerPolygonInk } from '../scene/paint-certification.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import type { AxisAlignedBox } from '../shared/transformed-bounds.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { createInlineColorAttributeResolver, type DiagramColors } from '../theme.ts'
import type { Point } from '../types.ts'
import { classRelationshipPaintBoxes } from './owned-surfaces.ts'
import { classMarkerResources, getMarkerDefId } from './relationship-paint.ts'
import type { PositionedClassDiagram } from './types.ts'

export interface ClassMarkerAdmissionWork {
  operations: number
  pairs: number
  exhausted: boolean
}
export function createClassMarkerAdmissionWork(): ClassMarkerAdmissionWork {
  return { operations: 0, pairs: 0, exhausted: false }
}

/** Shared by reservation and final proof; a backend retry never restores work. */
export function chargeClassMarkerAdmissionWork(ledger: ClassMarkerAdmissionWork): boolean {
  if (ledger.exhausted || ledger.operations >= MAX_OCCLUSION_OPERATIONS) {
    ledger.exhausted = true
    return false
  }
  ledger.operations++
  return true
}

interface MarkerInk {
  readonly owner: string
  readonly bounds: AxisAlignedBox
  readonly proof: MarkerPolygonProof | undefined
}
const contains = (bounds: AxisAlignedBox, point: Readonly<Point>): boolean => bounds.x0 <= point.x && point.x <= bounds.x1 && bounds.y0 <= point.y && point.y <= bounds.y1
const overlaps = (a: AxisAlignedBox, b: AxisAlignedBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Reject only a final, actual contrasting stroke-cover witness. Unsupported
 * geometry or exhausted proof work is left to final consumer uncertainty. */
export function assertClassMarkerMeaning(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, colors: DiagramColors, ledger: ClassMarkerAdmissionWork = createClassMarkerAdmissionWork()): void {
  // The shared sufficient proof currently admits cardinal sharp carriers.
  // Do not substitute an ideal polyline for actual rounded marker tangents.
  if (style.edgeBendRadius > 0 || ledger.exhausted) return
  const work = (): boolean => chargeClassMarkerAdmissionWork(ledger)
  const resolveColor = createInlineColorAttributeResolver()
  const resolveMarkerColor = (value: string): string | undefined => resolveColor(value, colors)
  const width = formatSvgNumericAttribute('stroke-width', String(style.lineWidth)),
    resources = classMarkerResources(style),
    markers: MarkerInk[] = []
  for (let index = 0; index < diagram.relationships.length; index++) {
    if (!work()) return
    const rel = diagram.relationships[index]!
    if (rel.points.length < 2) continue
    const start = rel.markerAt === 'from' || rel.markerAt === 'both' ? resources.find(marker => marker.id === getMarkerDefId(rel.fromType ?? rel.type)) : undefined
    const end = rel.markerAt === 'to' || rel.markerAt === 'both' ? resources.find(marker => marker.id === getMarkerDefId(rel.toType ?? rel.type)) : undefined
    if (!start && !end) continue
    // Only the emitted first/last nonzero legs determine marker orientation.
    // Keep bounds and restoration vetoes on those actual serialized coordinates;
    // no interior carrier is painted by this marker-only overlay.
    const first = { x: Number(formatSvgNumber(rel.points[0]!.x)), y: Number(formatSvgNumber(rel.points[0]!.y)) },
      last = { x: Number(formatSvgNumber(rel.points.at(-1)!.x)), y: Number(formatSvgNumber(rel.points.at(-1)!.y)) }
    let next = first,
      previous = last
    for (let i = 1; i < rel.points.length; i++) {
      if (!work()) return
      const p = rel.points[i]!,
        x = Number(formatSvgNumber(p.x)),
        y = Number(formatSvgNumber(p.y))
      if (x !== first.x || y !== first.y) {
        next = { x, y }
        break
      }
    }
    for (let i = rel.points.length - 2; i >= 0; i--) {
      if (!work()) return
      const p = rel.points[i]!,
        x = Number(formatSvgNumber(p.x)),
        y = Number(formatSvgNumber(p.y))
      if (x !== last.x || y !== last.y) {
        previous = { x, y }
        break
      }
    }
    // These are the actual final overlay fields: invisible carrier stroke does
    // not suppress the separately painted endpoint resource.
    const mark = connector({
      id: `class-marker-proof:${index}`,
      role: 'chrome',
      owner: { id: `relationship:${index}`, role: 'relationship' },
      geometry: { kind: 'polyline', points: [first, next, previous, last] },
      lineStyle: 'solid',
      paint: { fill: 'none', stroke: style.edgeStrokeColor ?? 'var(--_line)', strokeWidth: width },
      stroke: { opacity: 0 },
      endpoints: { from: rel.from, to: rel.to },
      markers: { ...(start ? { start } : {}), mid: [], ...(end ? { end } : {}) },
    })
    for (const region of connectorMarkerPaintRegions(mark)) {
      if (!work() || !region.bounds) return
      const descriptor = region.position === 'start' ? start : region.position === 'end' ? end : undefined
      const proof = prepareMarkerPolygonInk({ colors }, mark, descriptor, region.position, work, resolveMarkerColor)
      if (ledger.exhausted) return
      markers.push({ owner: `relationship ${index} ${rel.from}->${rel.to} ${region.position}`, bounds: region.bounds, proof })
    }
  }
  if (markers.length < 2) return
  // Every note and endpoint/central label is painted after the marker overlays.
  // Their envelopes can prevent a hard conclusion, never establish painted ink.
  if (diagram.relationships.some(rel => !!rel.label && !rel.labelPosition)) return
  const laterArtwork: AxisAlignedBox[] = classRelationshipPaintBoxes(diagram, style, false).map(item => ({ x0: item.box.x, y0: item.box.y, x1: item.box.x + item.box.width, y1: item.box.y + item.box.height }))
  for (const note of diagram.notes) {
    if (!work()) return
    laterArtwork.push({ x0: note.x - 1, y0: note.y - 1, x1: note.x + note.width + 1, y1: note.y + note.height + 1 })
    if (note.targetX !== undefined && note.targetY !== undefined) {
      const x = note.noteX ?? note.x,
        y = note.noteY ?? note.y + note.height / 2
      laterArtwork.push({ x0: Math.min(note.targetX, x) - 1, y0: Math.min(note.targetY, y) - 1, x1: Math.max(note.targetX, x) + 1, y1: Math.max(note.targetY, y) + 1 })
    }
  }
  for (let earlier = 0; earlier < markers.length; earlier++)
    for (let later = earlier + 1; later < markers.length; later++) {
      if (!work()) return
      const a = markers[earlier]!,
        b = markers[later]!
      if (!overlaps(a.bounds, b.bounds)) continue
      if (ledger.pairs >= MAX_OCCLUSION_PAIRS) {
        ledger.exhausted = true
        return
      }
      ledger.pairs++
      let cursor = 0
      while (a.proof && cursor < a.proof.strokeWitnesses.length) {
        const witness = compareMarkerStrokeInk(a.proof, b.proof, work, cursor)
        if (ledger.exhausted) return
        if (typeof witness === 'string') break
        let next = cursor
        for (; next < a.proof.strokeWitnesses.length; next++) {
          if (!work()) return
          if (a.proof.strokeWitnesses[next] === witness) break
        }
        if (next === a.proof.strokeWitnesses.length) return
        cursor = next + 1
        let restored = false
        for (let index = later + 1; index < markers.length; index++) {
          if (!work()) return
          if (contains(markers[index]!.bounds, witness)) {
            restored = true
            break
          }
        }
        if (!restored)
          for (const bounds of laterArtwork) {
            if (!work()) return
            if (contains(bounds, witness)) {
              restored = true
              break
            }
          }
        if (!restored) throw new LayoutCertificationError([{ strategy: 'class-marker-meaning', violations: [`Later marker ${b.owner} covers actual stroke ink of ${a.owner}`] }])
      }
    }
}
