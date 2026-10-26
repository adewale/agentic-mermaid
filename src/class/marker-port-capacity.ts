import type { Direction } from '../types.ts'
import type { MarkerPaint } from '../layout/compound-marker-seating.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { formatSvgNumber, formatSvgNumericAttribute } from '../shared/svg-number.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { type ClassMarkerAdmissionWork, chargeClassMarkerAdmissionWork } from './marker-admission.ts'
import { compareClassSvgSum } from './owned-surfaces.ts'
import { classMarkerPieces, classMarkerResources, getMarkerDefId } from './relationship-paint.ts'
import type { PositionedClassDiagram } from './types.ts'

type Face = 'N' | 'E' | 'S' | 'W'
type Port = { along: number; low: number; high: number; marker: string | null }
export interface ClassCardMinimum {
  width: number
  height: number
}

/** Minimum extent for the current implicit ELK face order with a common pitch.
 * This is a reservation proposal, not an ink-collision verdict. Final Class
 * admission still proves the actual returned geometry after bounded relayout. */
export function classElkMarkerMinimums(diagram: PositionedClassDiagram, style: ResolvedRenderStyle, ledger: ClassMarkerAdmissionWork): ReadonlyMap<string, ClassCardMinimum> {
  const work = () => chargeClassMarkerAdmissionWork(ledger),
    pay = (count: number) => {
      for (let i = 0; i < count; i++) if (!work()) return false
      return true
    }
  const width = Number.parseFloat(formatSvgNumericAttribute('stroke-width', String(style.lineWidth)))
  if (!(width > 0) || !Number.isFinite(width) || !pay(5)) return new Map()
  const resources = classMarkerResources(style),
    templates = new Map<string, { low: number; high: number }>(),
    cards = new Map<string, PositionedClassDiagram['classes'][number]>(),
    faces = new Map<string, Map<Face, Port[]>>(),
    result = new Map<string, ClassCardMinimum>()
  for (const card of diagram.classes) {
    if (!work()) return new Map()
    if (!card.isInterface) cards.set(card.id, card)
  }
  for (const rel of diagram.relationships)
    for (const role of ['from', 'to'] as const) {
      if (!work()) return new Map()
      const card = cards.get(rel[role]),
        points = rel.points
      if (!card || points.length < 2) continue
      const anchor = role === 'from' ? points[0]! : points.at(-1)!,
        p = { x: Number(formatSvgNumber(anchor.x)), y: Number(formatSvgNumber(anchor.y)) }
      let q = p
      for (let i = 1; i < points.length; i++) {
        if (!work()) return new Map()
        const raw = points[role === 'from' ? i : points.length - i - 1]!,
          candidate = { x: Number(formatSvgNumber(raw.x)), y: Number(formatSvgNumber(raw.y)) }
        if (candidate.x !== p.x || candidate.y !== p.y) {
          q = candidate
          break
        }
      }
      const dx = q.x - p.x,
        dy = q.y - p.y
      let face: Face | undefined
      if (dy === 0 && dx < 0 && compareClassSvgSum(p.x, card.x, 0) === 0) face = 'W'
      else if (dy === 0 && dx > 0 && compareClassSvgSum(p.x, card.x, card.width) === 0) face = 'E'
      else if (dx === 0 && dy < 0 && compareClassSvgSum(p.y, card.y, 0) === 0) face = 'N'
      else if (dx === 0 && dy > 0 && compareClassSvgSum(p.y, card.y, card.height) === 0) face = 'S'
      if (!face) continue // Unsupported contacts remain the final proof's concern.
      const vertical = face === 'W' || face === 'E',
        marked = rel.markerAt === 'both' || rel.markerAt === role,
        markerId = marked ? getMarkerDefId((role === 'from' ? rel.fromType : rel.toType) ?? rel.type) : null,
        key = `${role}:${face}:${markerId ?? ''}`
      let template = templates.get(key)
      if (!template) {
        let low = -width / 2,
          high = width / 2
        let descriptor: (typeof resources)[number] | undefined
        if (markerId)
          for (const resource of resources) {
            if (!work()) return new Map()
            if (resource.id === markerId) {
              descriptor = resource
              break
            }
          }
        if (descriptor) {
          const outward = { x: face === 'E' ? 1 : face === 'W' ? -1 : 0, y: face === 'S' ? 1 : face === 'N' ? -1 : 0 },
            tangent = role === 'from' ? outward : { x: -outward.x, y: -outward.y }
          const stopped = {}
          let pieces: ReturnType<typeof classMarkerPieces>
          try {
            pieces = classMarkerPieces(descriptor, { x: 0, y: 0 }, tangent, role === 'from' ? 'start' : 'end', width, () => {
              if (!work()) throw stopped
            })
          } catch (error) {
            if (error === stopped) return new Map()
            throw error
          }
          for (const piece of pieces) {
            if (!work()) return new Map()
            if (piece.kind === 'circle') {
              const center = vertical ? piece.cy : piece.cx
              low = Math.min(low, center - piece.r)
              high = Math.max(high, center + piece.r)
            } else
              for (const point of piece.points) {
                if (!work()) return new Map()
                const along = vertical ? point.y : point.x
                low = Math.min(low, along)
                high = Math.max(high, along)
              }
          }
        }
        templates.set(key, (template = { low, high }))
      }
      let byFace = faces.get(card.id)
      if (!byFace) faces.set(card.id, (byFace = new Map()))
      let ports = byFace.get(face)
      if (!ports) byFace.set(face, (ports = []))
      ports.push({ along: vertical ? p.y - card.y : p.x - card.x, low: template.low, high: template.high, marker: markerId })
    }
  for (const [id, byFace] of faces) {
    if (!work()) return new Map()
    const card = cards.get(id)!
    let minWidth = card.width,
      minHeight = card.height
    for (const [face, ports] of byFace) {
      if (!work()) return new Map()
      let hasMarker = false
      for (const port of ports) {
        if (!work()) return new Map()
        hasMarker ||= port.marker !== null
      }
      if (!hasMarker) continue
      const stopped = {}
      try {
        ports.sort((a, b) => {
          if (!work()) throw stopped
          return a.along - b.along
        })
      } catch (error) {
        if (error === stopped) return new Map()
        throw error
      }
      // Count endpoint incidences, including both ends of a self loop. An
      // automatic coincident output is not a capacity guarantee for a retry.
      const first = ports[0]!,
        last = ports.at(-1)!,
        length = face === 'W' || face === 'E' ? card.height : card.width,
        corner = Math.max(0, style.cornerRadius ?? 0),
        currentCorner = Math.min(corner, card.width / 2, card.height / 2)
      let crowded = first.along < Math.max(-first.low, currentCorner) || length - last.along < Math.max(last.high, currentCorner),
        pitch = Math.max(-first.low, last.high, corner)
      for (let i = 1; i < ports.length; i++) {
        if (!work()) return new Map()
        const previous = ports[i - 1]!,
          next = ports[i]!,
          separation = previous.high - next.low
        crowded ||= next.along - previous.along < separation
        pitch = Math.max(pitch, separation)
      }
      // Keep a clear nonuniform face exactly. Overlapping projected spans are
      // reservation pressure, never an actual-ink failure or an acceptance proof.
      if (!crowded) continue
      const extent = Math.ceil((ports.length + 1) * pitch)
      if (!Number.isSafeInteger(extent) || extent < 0) throw new LayoutCertificationError([{ strategy: 'class-marker-capacity', violations: ['Nonfinite Class marker face reservation'] }])
      if (face === 'W' || face === 'E') minHeight = Math.max(minHeight, extent)
      else minWidth = Math.max(minWidth, extent)
    }
    if (minWidth > card.width || minHeight > card.height) result.set(id, { width: minWidth, height: minHeight })
  }
  return result
}

/** Native has no authored port side. Reserve one conservative common pitch
 * for EVERY endpoint incidence on the primary faces before its single placement (a loop counts
 * twice). This proposes capacity, never substitutes for final actual ink proof. */
export function classNativeMarkerMinimums(
  cards: readonly { id: string; isInterface?: boolean }[],
  relationships: readonly { from: string; to: string }[],
  templates: readonly MarkerPaint[], strokeWidth: number, direction: Direction,
  ledger: ClassMarkerAdmissionWork,
): ReadonlyMap<string, ClassCardMinimum & { portSpacing: number }> {
  const pay=(units=1):void=>{for(let unit=0;unit<units;unit++)if(!chargeClassMarkerAdmissionWork(ledger))throw new LayoutCertificationError([{strategy:'class-native-marker-capacity',violations:['Class marker capacity work limit']}])}
  pay(3)
  const incidents=new Map<string,{count:number;low:number;high:number;marked:boolean}>(),result=new Map<string,ClassCardMinimum & { portSpacing: number }>()
  for(const card of cards){pay(5);if(!card.isInterface)incidents.set(card.id,{count:0,low:-strokeWidth/2,high:strokeWidth/2,marked:false})}
  for(let index=0;index<relationships.length;index++)for(let role=0;role<2;role++){
    pay(8)
    const rel=relationships[index]!,entry=incidents.get(role===0?rel.from:rel.to)
    if(!entry)continue
    entry.count++
    const pieces=role===0?templates[index]?.start:templates[index]?.end
    if(!pieces?.length)continue
    entry.marked=true
    for(const piece of pieces){
      pay()
      if(piece.kind==='circle'){pay(4);entry.low=Math.min(entry.low,piece.cy-piece.r);entry.high=Math.max(entry.high,piece.cy+piece.r)}
      else for(const point of piece.points){pay(3);entry.low=Math.min(entry.low,point.y);entry.high=Math.max(entry.high,point.y)}
    }
  }
  for(const [id,entry]of incidents){
    pay(7)
    if(!entry.marked)continue
    const portSpacing=entry.high-entry.low+strokeWidth,extent=Math.ceil((entry.count+1)*portSpacing)
    if(!Number.isSafeInteger(extent)||extent<=0)throw new LayoutCertificationError([{strategy:'class-native-marker-capacity',violations:['Nonfinite Class marker face reservation']}])
    pay(4);result.set(id,{width:direction==='LR'||direction==='RL'?0:extent,height:direction==='LR'||direction==='RL'?extent:0,portSpacing})
  }
  return result
}
