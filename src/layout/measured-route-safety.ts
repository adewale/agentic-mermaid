import type { MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { formatSvgNumber, SVG_LONG_DECIMAL } from '../shared/svg-number.ts'

export interface MeasuredBox {
  x: number
  y: number
  width: number
  height: number
}

export function segmentEntersMeasuredBox(a: Point, b: Point, box: MeasuredBox): boolean {
  return a.x === b.x ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
}

export function pointOnMeasuredSegment(point: Point, a: Point, b: Point): boolean {
  return (a.x === b.x ? Math.abs(point.x - a.x) < 1e-7 : Math.abs(point.y - a.y) < 1e-7) && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)
}

export function measuredBoxesOverlap(a: MeasuredBox, b: MeasuredBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function sharesShaft(a: Point, b: Point, c: Point, d: Point): boolean {
  return (
    (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) <= 0.5 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 0.01) ||
    (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) <= 0.5 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 0.01)
  )
}

/** Extra physical checks debit the owning caller's existing allowance. False
 * stops immediately; the caller's exhausted ledger remains authoritative. */
export type MeasuredContactCharge = (amount: number) => boolean | void

/** Caller-owned scratch, reset before each query. Only exact sharp refusal
 * fills these 1-based ending-point segment indices; never a retained proof. */
export interface MeasuredSharpContactWitness {
  candidateSegment: number
  peerIndex: number
  peerSegment: number
}

function sharpRefusal(witness: MeasuredSharpContactWitness | undefined, i:number, other:number, j:number, charge?:MeasuredContactCharge):false|undefined {
  if(witness){
    if(charge?.(3)===false)return undefined
    witness.candidateSegment=i;witness.peerIndex=other;witness.peerSegment=j
  }
  return false
}

/** Base work reserved by the caller for each segment pair. Complete sharp
 * admission first proves conservative support separation; only remaining
 * pairs execute the other two predicates. Proposals retain the old metric. */
export function measuredRouteContactPairBudget(input:MeasuredGraph,phase:'complete'|'proposal'='complete'):1|3 {
  return phase==='complete'&&input.maximumEdgeStrokeWidth!==undefined&&input.maximumEdgeBendRadius===0?1:3
}

function separatedSharpSupports(a:Point,b:Point,c:Point,d:Point,width:number):boolean|undefined {
  // The quarter-square authority is cardinal only. Unknown acute miters
  // cannot borrow this width-sized support bound, even for a far pair.
  if(a.x!==b.x&&a.y!==b.y||c.x!==d.x&&c.y!==d.y)return undefined
  const error=(Math.abs(a.x)+Math.abs(a.y)+Math.abs(b.x)+Math.abs(b.y)+Math.abs(c.x)+Math.abs(c.y)+Math.abs(d.x)+Math.abs(d.y)+width)*1e-10+1e-9,
    margin=width+error,left=Math.min(a.x,b.x)-Math.max(c.x,d.x),right=Math.min(c.x,d.x)-Math.max(a.x,b.x),
    top=Math.min(a.y,b.y)-Math.max(c.y,d.y),bottom=Math.min(c.y,d.y)-Math.max(a.y,b.y)
  return Number.isFinite(margin)&&Number.isFinite(left)&&Number.isFinite(right)&&Number.isFinite(top)&&Number.isFinite(bottom)
    &&(left>margin||right>margin||top>margin||bottom>margin)
}

function writtenGapComparison(a: string, b: string, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge, twice = false): -1 | 0 | 1 | undefined {
  if (charge?.(8) === false) return undefined
  const x = Number(a), y = Number(b), w = Number(width), difference = Math.abs(x - y) * (twice ? 2 : 1) - w
  // This only selects exact arithmetic near binary cancellation. It is never
  // a geometric tolerance or an allowance for positive painted overlap.
  if (Math.abs(difference) > 8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), w)) return difference < 0 ? -1 : 1
  if (charge?.(384) === false) return undefined
  if (reserve?.(42) === false) return undefined
  const part = (text: string) => {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
    return { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
  }
  const A = part(a), B = part(b), W = part(width), scale = Math.min(A.e, B.e, W.e)
  if (charge?.(32 + A.e - scale + B.e - scale + W.e - scale) === false) return undefined
  const delta = A.n * 10n ** BigInt(A.e - scale) - B.n * 10n ** BigInt(B.e - scale),
    magnitude = delta < 0n ? -delta : delta
  const comparison = magnitude * (twice ? 2n : 1n) - W.n * 10n ** BigInt(W.e - scale)
  return comparison < 0n ? -1 : comparison > 0n ? 1 : 0
}

export function writtenCoordinateGapLessThan(a: string, b: string, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): boolean | undefined {
  const comparison = writtenGapComparison(a, b, width, charge, reserve)
  return comparison === undefined ? undefined : comparison < 0
}

function sharesWrittenShaft(a: Point, b: Point, c: Point, d: Point, width: number, widthText: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): boolean | undefined {
  const vertical = a.x === b.x
  // Axis classification is already reserved by the original segment-pair
  // check. Only parallel pairs execute the additional writer-error proof.
  if ((c.x === d.x) !== vertical || (!vertical && (a.y !== b.y || c.y !== d.y))) return false
  // The original paid shaft predicate already classifies axes, distance and
  // span. Add two writer-error bound visits only for parallel support.
  if (charge?.(2) === false) return undefined
  const fixed = vertical ? a.x : a.y, other = vertical ? c.x : c.y,
    distance = Math.abs(fixed - other), error = (Math.abs(fixed) + Math.abs(other) + width) * 1e-10 + 1e-9
  if (distance > width + error) return false
  const A = vertical ? a.y : a.x, B = vertical ? b.y : b.x, C = vertical ? c.y : c.x, D = vertical ? d.y : d.x,
    span = Math.min(Math.max(A, B), Math.max(C, D)) - Math.max(Math.min(A, B), Math.min(C, D)),
    spanError = (Math.abs(A) + Math.abs(B) + Math.abs(C) + Math.abs(D)) * 1e-10 + 1e-9
  if (span < -spanError) return false
  // A shared raw end spells identically; robust other ends stay opposite.
  if (span === 0) {
    if (charge?.(2) === false) return undefined
    if (Math.abs(A - B) > 2 * spanError && Math.abs(C - D) > 2 * spanError) return false
  }
  if (charge?.(2) === false) return undefined
  if (distance < width - error && span > spanError) return true
  if (charge?.(6) === false) return undefined
  if (!Number.isFinite(fixed) || !Number.isFinite(other) || !Number.isFinite(A) || !Number.isFinite(B) || !Number.isFinite(C) || !Number.isFinite(D)) return undefined
  // Prepay bounded numeric spellings before invoking the canonical writer.
  if (reserve?.(10) === false) return undefined
  if (charge?.(256) === false) return undefined
  const gap = writtenCoordinateGapLessThan(formatSvgNumber(fixed), formatSvgNumber(other), widthText, charge, reserve)
  if (gap !== true) return gap
  if (reserve?.(20) === false) return undefined
  if (charge?.(512) === false) return undefined
  const wa = Number(formatSvgNumber(A)),
    wb = Number(formatSvgNumber(B)),
    wc = Number(formatSvgNumber(C)),
    wd = Number(formatSvgNumber(D)),
    lo = Math.max(Math.min(wa, wb), Math.min(wc, wd)),
    hi = Math.min(Math.max(wa, wb), Math.max(wc, wd))
  return lo < hi
}


function sameSharpPoint(p: Point, q: Point): boolean { return p.x === q.x && p.y === q.y }

interface SharpBox { x0: number; x1: number; y0: number; y1: number; ox0: number; ox1: number; oy0: number; oy1: number }

// Bounds are canonical coordinates PLUS integer multiples of the mathematical
// half of the written width. No synthetic half-width is serialized or rounded.
function sharpOffsetLess(a: number, oa: number, b: number, ob: number, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): boolean | undefined {
  if (charge?.(3) === false) return undefined
  const q = ob - oa
  if (!q) return a < b
  if (a === b) return q > 0
  if (a > b ? q < 0 : q > 0) return a < b
  // The inputs already denote canonical served scalars. Prove the sign
  // away from floating evaluation error; exact decimal arithmetic owns the
  // unresolved boundary. This bound never permits geometric overlap.
  if (charge?.(6) === false) return undefined
  const w=Number(width),delta=2*(a-b)-q*w,
    error=32*Number.EPSILON*Math.max(1,Math.abs(a)+Math.abs(b)+Math.abs(q*w))
  if(Number.isFinite(delta)&&Math.abs(delta)>error)return delta<0
  if (reserve?.(10) === false || charge?.(64) === false) return undefined
  const comparison = writtenGapComparison(String(a), String(b), width, charge, reserve, Math.abs(q) === 1)
  return comparison === undefined ? undefined : q > 0 ? comparison < 0 : comparison > 0
}

function sharpBoxesOverlap(a: SharpBox, b: SharpBox, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): boolean | undefined {
  const x0 = sharpOffsetLess(a.x0,a.ox0,b.x1,b.ox1,width,charge,reserve)
  if (x0 !== true) return x0
  const x1 = sharpOffsetLess(b.x0,b.ox0,a.x1,a.ox1,width,charge,reserve)
  if (x1 !== true) return x1
  const y0 = sharpOffsetLess(a.y0,a.oy0,b.y1,b.oy1,width,charge,reserve)
  if (y0 !== true) return y0
  return sharpOffsetLess(b.y0,b.oy0,a.y1,a.oy1,width,charge,reserve)
}

function sharpPoint(p: Point, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): Point | undefined {
  if(charge?.(2)===false)return undefined
  // Safe integers have no fractional tail and are already served verbatim.
  if(Number.isSafeInteger(p.x)&&Number.isSafeInteger(p.y))return p
  if (charge?.(66) === false || reserve?.(13) === false) return undefined
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined
  let x = String(p.x), y = String(p.y)
  if (x.length >= 14 && SVG_LONG_DECIMAL.test(x)) {
    if (reserve?.(5) === false || charge?.(128) === false) return undefined
    x = formatSvgNumber(p.x)
  }
  if (y.length >= 14 && SVG_LONG_DECIMAL.test(y)) {
    if (reserve?.(5) === false || charge?.(128) === false) return undefined
    y = formatSvgNumber(p.y)
  }
  return { x: Number(x), y: Number(y) }
}

function sharpStrip(a: Point, b: Point, reserve?: MeasuredContactCharge): SharpBox | undefined {
  if (reserve?.(9) === false) return undefined
  if (a.x === b.x && a.y === b.y) return undefined
  if (a.x === b.x) return {x0:a.x,x1:a.x,y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y),ox0:-1,ox1:1,oy0:0,oy1:0}
  if (a.y === b.y) return {x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),y0:a.y,y1:a.y,ox0:0,ox1:0,oy0:-1,oy1:1}
  return undefined
}

function sharpJoin(a: Point, b: Point, c: Point, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): SharpBox | false | undefined {
  if (charge?.(8) === false) return undefined
  const ux=Math.sign(b.x-a.x),uy=Math.sign(b.y-a.y),vx=Math.sign(c.x-b.x),vy=Math.sign(c.y-b.y),turn=ux*vy-uy*vx
  if (!turn) return ux*vx+uy*vy<0 ? undefined : false
  if ((a.x!==b.x&&a.y!==b.y)||(b.x!==c.x&&b.y!==c.y)) return undefined
  if (reserve?.(9) === false) return undefined
  const side=turn>0?-1:1,dx=(-uy-vy)*side,dy=(ux+vx)*side
  return {x0:b.x,x1:b.x,y0:b.y,y1:b.y,ox0:Math.min(0,dx),ox1:Math.max(0,dx),oy0:Math.min(0,dy),oy1:Math.max(0,dy)}
}

function straightThrough(points: readonly Point[], segment: number, p: Point, written: boolean, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge): boolean | undefined {
  let before=segment-1,after=segment,a:Point|undefined,b:Point|undefined
  while(before>=0){
    if(charge?.(1)===false)return undefined
    a=written?sharpPoint(points[before]!,charge,reserve):points[before]!
    if(!a)return undefined
    if(a.x!==p.x||a.y!==p.y)break
    before--
  }
  while(after<points.length){
    if(charge?.(1)===false)return undefined
    b=written?sharpPoint(points[after]!,charge,reserve):points[after]!
    if(!b)return undefined
    if(b.x!==p.x||b.y!==p.y)break
    after++
  }
  if(before<0||after>=points.length||!a||!b)return false
  return a.x===p.x&&b.x===p.x&&Math.min(a.y,b.y)<p.y&&p.y<Math.max(a.y,b.y)
    ||a.y===p.y&&b.y===p.y&&Math.min(a.x,b.x)<p.x&&p.x<Math.max(a.x,b.x)
}

function sharpContactsClear(points: Point[], index: number, routes: readonly {points:Point[];style:string}[], input: MeasuredGraph, width:number, widthText:string, visiblePeers:readonly number[], charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge,witness?:MeasuredSharpContactWitness):boolean|undefined {
  const edge=input.edges[index]!
  // Numeric projection is local to this synchronous read-only score. Reuse
  // spellings, never contact decisions, and prepare a fresh view next call.
  if(reserve?.(points.length+2)===false)return undefined
  const writtenPoints: (Point | undefined)[] = new Array(points.length)
  for(let cursor=0;cursor<visiblePeers.length;cursor++){
    if(charge?.(1)===false)return undefined
    const other=visiblePeers[cursor]!,peer=routes[other]!,peerEdge=input.edges[other]!
    let writtenPeer: (Point | undefined)[] | undefined
    for(let i=1;i<points.length;i++)for(let j=1;j<peer.points.length;j++){
      if(charge?.(1)===false)return undefined
      const a=points[i-1]!,b=points[i]!,c=peer.points[j-1]!,d=peer.points[j]!,
        error=(Math.abs(a.x)+Math.abs(a.y)+Math.abs(b.x)+Math.abs(b.y)+Math.abs(c.x)+Math.abs(c.y)+Math.abs(d.x)+Math.abs(d.y)+width)*1e-10+1e-9,
        margin=width+error
      if(Math.min(a.x,b.x)-Math.max(c.x,d.x)>margin||Math.min(c.x,d.x)-Math.max(a.x,b.x)>margin||Math.min(a.y,b.y)-Math.max(c.y,d.y)>margin||Math.min(c.y,d.y)-Math.max(a.y,b.y)>margin)continue
      const av=a.x===b.x,bv=c.x===d.x
      if(av!==bv&&(a.x===b.x||a.y===b.y)&&(c.x===d.x||c.y===d.y)){
        const x=av?a.x:c.x,y=av?c.y:a.y,h0=av?c:a,h1=av?d:b,v0=av?a:c,v1=av?b:d
        // A proper crossing far from every end cannot touch a miter quarter.
        if(x>Math.min(h0.x,h1.x)+margin&&x<Math.max(h0.x,h1.x)-margin&&y>Math.min(v0.y,v1.y)+margin&&y<Math.max(v0.y,v1.y)-margin)continue
      }
      if(!writtenPeer){
        if(reserve?.(peer.points.length+1)===false)return undefined
        writtenPeer=new Array(peer.points.length)
      }
      if(charge?.(4)===false)return undefined
      const A=writtenPoints[i-1]??(writtenPoints[i-1]=sharpPoint(a,charge,reserve));if(!A)return undefined
      const B=writtenPoints[i]??(writtenPoints[i]=sharpPoint(b,charge,reserve));if(!B)return undefined
      const C=writtenPeer[j-1]??(writtenPeer[j-1]=sharpPoint(c,charge,reserve));if(!C)return undefined
      const D=writtenPeer[j]??(writtenPeer[j]=sharpPoint(d,charge,reserve));if(!D)return undefined
      const stripA=sharpStrip(A,B,reserve);if(!stripA)return undefined
      const stripB=sharpStrip(C,D,reserve);if(!stripB)return undefined
      const actualAv=A.x===B.x,actualBv=C.x===D.x
      // A raw diagonal may project to a real cardinal shaft. The old raw
      // parallel predicate did not inspect that strip, so prove it here.
      if(actualAv===actualBv&&(a.x!==b.x&&a.y!==b.y||c.x!==d.x&&c.y!==d.y)){
        const overlap=sharpBoxesOverlap(stripA,stripB,widthText,charge,reserve)
        if(overlap!==false)return overlap===undefined?undefined:sharpRefusal(witness,i,other,j,charge)
      }
      if(actualAv!==actualBv){
        const overlap=sharpBoxesOverlap(stripA,stripB,widthText,charge,reserve)
        if(overlap===undefined)return undefined
        if(overlap){
          if(reserve?.(6)===false)return undefined
          const raw={x:actualAv?a.x:c.x,y:actualAv?c.y:a.y},written={x:actualAv?A.x:C.x,y:actualAv?C.y:A.y}
          const rawA=straightThrough(points,i,raw,false,charge,reserve);if(rawA===undefined)return undefined
          const rawB=straightThrough(peer.points,j,raw,false,charge,reserve);if(rawB===undefined)return undefined
          let proper=false
          if(rawA&&rawB){
            const writtenA=straightThrough(points,i,written,true,charge,reserve);if(writtenA===undefined)return undefined
            const writtenB=straightThrough(peer.points,j,written,true,charge,reserve);if(writtenB===undefined)return undefined
            proper=writtenA&&writtenB
          }
          const first=points[0]!,last=points.at(-1)!,pf=peer.points[0]!,pl=peer.points.at(-1)!
          if(charge?.(4)===false)return undefined
          const common=i===1&&j===1&&edge.source===peerEdge.source&&sameSharpPoint(raw,first)&&sameSharpPoint(raw,pf)
            ||i===1&&j===peer.points.length-1&&edge.source===peerEdge.target&&sameSharpPoint(raw,first)&&sameSharpPoint(raw,pl)
            ||i===points.length-1&&j===1&&edge.target===peerEdge.source&&sameSharpPoint(raw,last)&&sameSharpPoint(raw,pf)
            ||i===points.length-1&&j===peer.points.length-1&&edge.target===peerEdge.target&&sameSharpPoint(raw,last)&&sameSharpPoint(raw,pl)
          if(!proper&&!common)return sharpRefusal(witness,i,other,j,charge)
        }
      }
      let joinA:SharpBox|false=false,joinB:SharpBox|false=false
      if(i+1<points.length){if(charge?.(1)===false)return undefined;const next=writtenPoints[i+1]??(writtenPoints[i+1]=sharpPoint(points[i+1]!,charge,reserve));if(!next)return undefined;const join=sharpJoin(A,B,next,charge,reserve);if(join===undefined)return undefined;joinA=join}
      if(j+1<peer.points.length){if(charge?.(1)===false)return undefined;const next=writtenPeer[j+1]??(writtenPeer[j+1]=sharpPoint(peer.points[j+1]!,charge,reserve));if(!next)return undefined;const join=sharpJoin(C,D,next,charge,reserve);if(join===undefined)return undefined;joinB=join}
      // An actual quarter is additional ink, never excused by a remote common
      // endpoint or an unrelated proper crossing elsewhere on these routes.
      if(joinA){const hit=sharpBoxesOverlap(joinA,stripB,widthText,charge,reserve);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
      if(joinB){const hit=sharpBoxesOverlap(stripA,joinB,widthText,charge,reserve);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
      if(joinA&&joinB){const hit=sharpBoxesOverlap(joinA,joinB,widthText,charge,reserve);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
    }
  }
  return true
}

function orthogonal(points: readonly Point[]): boolean {
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
      || (index && point.x !== points[index - 1]!.x && point.y !== points[index - 1]!.y)) return false
  }
  return true
}

/** A bend touching another route must not erase a crossing from the metric.
 * Only an authored common endpoint may be an unmarked contact. */
export function scoreMeasuredRouteCrossings(points: Point[], index: number, routes: readonly { points: Point[]; style: string }[], input: MeasuredGraph, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge,witness?:MeasuredSharpContactWitness,prepaidPairBudget:1|3=3): number | undefined {
  return scoreMeasuredRouteCrossingsWithAdmission(points,index,routes,input,charge,reserve,true,witness,prepaidPairBudget)
}

/** Search ranking only: retains the full-width shaft and legacy crossing
 * metric. This result is NOT a sharp-contact certificate. Every caller must
 * pass committed-marker/global final admission before returning geometry. */
export function scoreMeasuredRouteProposalCrossings(points:Point[],index:number,routes:readonly {points:Point[];style:string}[],input:MeasuredGraph,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):number|undefined {
  return scoreMeasuredRouteCrossingsWithAdmission(points,index,routes,input,charge,reserve,false)
}

function scoreMeasuredRouteCrossingsWithAdmission(points:Point[],index:number,routes:readonly {points:Point[];style:string}[],input:MeasuredGraph,charge:MeasuredContactCharge|undefined,reserve:MeasuredContactCharge|undefined,sharp:boolean,witness?:MeasuredSharpContactWitness,prepaidPairBudget:1|3=3):number|undefined {
  let score = 0
  let width: number | undefined, widthText: string | undefined
  if (input.maximumEdgeStrokeWidth !== undefined) {
    if (reserve?.(4) === false) return undefined
    const value = input.maximumEdgeStrokeWidth
    if (Number.isSafeInteger(value) && value > 0) {
      // Safe integers have no fractional tail: the canonical writer is the
      // identity, with at most sixteen digits (one for the common small case).
      if (charge?.(value < 10 ? 2 : 17) === false) return undefined
      width = value
      widthText = String(value)
    } else {
      if (charge?.(128) === false) return undefined
      widthText = formatSvgNumber(value)
      width = Number(widthText)
    }
    if (!Number.isFinite(width) || width <= 0) throw new TypeError('Measured stroke width must be finite and positive')
  }
  // Reuse only the visibility roster read by THIS synchronous score; the
  // original traversal already excludes this candidate and invisible peers.
  // It carries no geometry/contact result into another query or revision.
  let visiblePeers:number[]|undefined
  if(sharp&&width!==undefined&&input.maximumEdgeBendRadius===0){
    if(reserve?.(1)===false)return undefined
    visiblePeers=[]
  }
  let candidateOrthogonal: boolean | undefined
  const edge = input.edges[index]!, pair = [{ points }, { points: [] as Point[] }]
  for (let other = 0; other < routes.length; other++) {
    const route = routes[other]!
    if (other === index || route.style === 'invisible') continue
    if(visiblePeers){
      if(reserve?.(1)===false||charge?.(1)===false)return undefined
      visiblePeers.push(other)
    }
    const peerEdge = input.edges[other]!
    let contacts: Set<string> | undefined
    for (let i = 1; i < points.length; i++) for (let j = 1; j < route.points.length; j++) {
      const a = points[i - 1]!, b = points[i]!, c = route.points[j - 1]!, d = route.points[j]!
      if(sharp&&width!==undefined&&input.maximumEdgeBendRadius===0){
        // The caller reserved the first support-bound predicate. Only a
        // strict proof omits the old shaft/contact predicates and their fee.
        const separated=separatedSharpSupports(a,b,c,d,width)
        if(separated===undefined){
          // ELK may retain a tiny raw diagonal whose four served endpoints
          // are exactly cardinal. Verify that mapping; never guess a shape
          // from a numeric tolerance or borrow an acute-miter bound.
          const A=sharpPoint(a,charge,reserve);if(!A)return undefined
          const B=sharpPoint(b,charge,reserve);if(!B)return undefined
          const C=sharpPoint(c,charge,reserve);if(!C)return undefined
          const D=sharpPoint(d,charge,reserve);if(!D)return undefined
          if(charge?.(4)===false)return undefined
          if(A.x!==B.x&&A.y!==B.y||C.x!==D.x&&C.y!==D.y)return undefined
        }
        if(separated===true)continue
      }
      // Default callers retain their old prepaid three-predicate envelope.
      // Explicit one-predicate callers must pay the remaining work now, even
      // if their input no longer has sharp metadata.
      if(prepaidPairBudget===1&&charge?.(2)===false)return undefined
      if (width === undefined) {
        if (sharesShaft(a,b,c,d)) return undefined
      } else {
        const shared = sharesWrittenShaft(a,b,c,d,width,widthText!,charge,reserve)
        if (shared !== false) return undefined
      }
      const av = a.x === b.x, bv = c.x === d.x
      let x = 0, y = 0, contact = false
      if (av !== bv) {
        x = av ? a.x : c.x; y = av ? c.y : a.y
        contact = x >= Math.min(a.x,b.x) && x <= Math.max(a.x,b.x) && y >= Math.min(a.y,b.y) && y <= Math.max(a.y,b.y)
          && x >= Math.min(c.x,d.x) && x <= Math.max(c.x,d.x) && y >= Math.min(c.y,d.y) && y <= Math.max(c.y,d.y)
      } else if (av ? a.x === c.x : a.y === c.y) {
        const lo = Math.max(av ? Math.min(a.y,b.y) : Math.min(a.x,b.x), av ? Math.min(c.y,d.y) : Math.min(c.x,d.x))
        const hi = Math.min(av ? Math.max(a.y,b.y) : Math.max(a.x,b.x), av ? Math.max(c.y,d.y) : Math.max(c.x,d.x))
        if (hi >= lo) { x = av ? a.x : lo; y = av ? lo : a.y; contact = true }
      }
      if (!contact) continue
      const first = points[0]!, last = points.at(-1)!, peerFirst = route.points[0]!, peerLast = route.points.at(-1)!
      const from = first.x === x && first.y === y, to = last.x === x && last.y === y
      const peerFrom = peerFirst.x === x && peerFirst.y === y, peerTo = peerLast.x === x && peerLast.y === y
      const common = (edge.source === peerEdge.source && from && peerFrom) || (edge.source === peerEdge.target && from && peerTo)
        || (edge.target === peerEdge.source && to && peerFrom) || (edge.target === peerEdge.target && to && peerTo)
      if (!common) (contacts ??= new Set()).add(`${x},${y}`)
    }
    // Every proper crossing of finite orthogonal routes is a recorded
    // perpendicular contact. A contact-free pair needs no segment preparation.
    if (!contacts && (candidateOrthogonal ??= orthogonal(points)) && orthogonal(route.points)) continue
    pair[1]!.points = route.points
    const crossings = countPolylineCrossings(pair)
    if (crossings < (contacts?.size ?? 0)) return undefined
    score += crossings
  }
  if (sharp && width !== undefined && input.maximumEdgeBendRadius === 0 && visiblePeers!.length && sharpContactsClear(points,index,routes,input,width,widthText!,visiblePeers!,charge,reserve,witness) !== true) return undefined
  return score
}
