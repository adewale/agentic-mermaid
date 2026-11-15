import type { MeasuredGraph } from './agentic-layered-core.ts'
import type { Point } from '../types.ts'
import { countPolylineCrossings, crossingPoint, retainCrossingLocation, distinctCrossingLocations, CROSSING_ENDPOINT_RADIUS } from '../shared/edge-crossings.ts'
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
  return separatedSharpSupportBounds(a,b,c,d,width)
}

/** Cardinality must already be proved in raw or exact served coordinates. */
function separatedSharpSupportBounds(a:Point,b:Point,c:Point,d:Point,width:number):boolean {
  const error=(Math.abs(a.x)+Math.abs(a.y)+Math.abs(b.x)+Math.abs(b.y)+Math.abs(c.x)+Math.abs(c.y)+Math.abs(d.x)+Math.abs(d.y)+width)*1e-10+1e-9,
    margin=width+error,left=Math.min(a.x,b.x)-Math.max(c.x,d.x),right=Math.min(c.x,d.x)-Math.max(a.x,b.x),
    top=Math.min(a.y,b.y)-Math.max(c.y,d.y),bottom=Math.min(c.y,d.y)-Math.max(a.y,b.y)
  return Number.isFinite(margin)&&Number.isFinite(left)&&Number.isFinite(right)&&Number.isFinite(top)&&Number.isFinite(bottom)
    &&(left>margin||right>margin||top>margin||bottom>margin)
}

interface WrittenDecimalPart { readonly n:bigint; readonly e:number }
function ownedDecimalPart(text:string,parts:Map<string,WrittenDecimalPart>,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):WrittenDecimalPart|undefined {
  if(charge?.(1)===false)return undefined
  const cached=parts.get(text);if(cached)return cached
  if(charge?.(128)===false||reserve?.(14)===false)return undefined
  const m=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
  const part={n:BigInt(m[1]!+m[2]!+(m[3]??'')),e:Number(m[4]??0)-(m[3]?.length??0)}
  if(reserve?.(2)===false||charge?.(1)===false)return undefined
  parts.set(text,part);return part
}

function writtenGapComparison(a: string, b: string, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge, twice = false, parts?:Map<string,WrittenDecimalPart>): -1 | 0 | 1 | undefined {
  if (charge?.(8) === false) return undefined
  const x = Number(a), y = Number(b), w = Number(width), difference = Math.abs(x - y) * (twice ? 2 : 1) - w
  // This only selects exact arithmetic near binary cancellation. It is never
  // a geometric tolerance or an allowance for positive painted overlap.
  if (Math.abs(difference) > 8 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), w)) return difference < 0 ? -1 : 1
  let A:WrittenDecimalPart,B:WrittenDecimalPart,W:WrittenDecimalPart
  if(parts){
    const x=ownedDecimalPart(a,parts,charge,reserve);if(!x)return undefined;A=x
    const y=ownedDecimalPart(b,parts,charge,reserve);if(!y)return undefined;B=y
    const w=ownedDecimalPart(width,parts,charge,reserve);if(!w)return undefined;W=w
  }else{
    if (charge?.(384) === false || reserve?.(42) === false) return undefined
    const part = (text: string) => {
      const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text)!
      return { n: BigInt(m[1]! + m[2]! + (m[3] ?? '')), e: Number(m[4] ?? 0) - (m[3]?.length ?? 0) }
    }
    A=part(a);B=part(b);W=part(width)
  }
  const scale = Math.min(A.e, B.e, W.e)
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
function sharpOffsetLess(a: number, oa: number, b: number, ob: number, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge,projection?:SharpProjectionRows): boolean | undefined {
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
  let A:string,B:string
  if(projection){
    const x=ownedSharpText(a,projection,charge,reserve);if(x===undefined)return undefined;A=x
    const y=ownedSharpText(b,projection,charge,reserve);if(y===undefined)return undefined;B=y
  }else{
    if (reserve?.(10) === false || charge?.(64) === false) return undefined
    A=String(a);B=String(b)
  }
  const comparison = writtenGapComparison(A, B, width, charge, reserve, Math.abs(q) === 1,projection?.parts)
  return comparison === undefined ? undefined : q > 0 ? comparison < 0 : comparison > 0
}

function sharpBoxesOverlap(a: SharpBox, b: SharpBox, width: string, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge,projection?:SharpProjectionRows): boolean | undefined {
  if(projection){
    if(projection.width!==undefined){
      if(charge?.(1)===false)return undefined
      const w=projection.width,h=w/2,error=(Math.abs(a.x0)+Math.abs(a.x1)+Math.abs(a.y0)+Math.abs(a.y1)+Math.abs(b.x0)+Math.abs(b.x1)+Math.abs(b.y0)+Math.abs(b.y1)+w)*1e-10+1e-9
      // This is only a conservative disjoint-support bound. Ambiguous signs,
      // cancellation, touch and tiny widths retain exact symbolic authority.
      if((a.x0-b.x1)+(a.ox0-b.ox1)*h>error||(b.x0-a.x1)+(b.ox0-a.ox1)*h>error||(a.y0-b.y1)+(a.oy0-b.oy1)*h>error||(b.y0-a.y1)+(b.oy0-a.oy1)*h>error)return false
    }
    // Equal offsets cancel EXACTLY. Test those canonical ordering predicates
    // before any width parsing/alignment for the remaining axes. The four
    // separating inequalities are unchanged; only owned evaluation order is.
    if(charge?.(4)===false)return undefined
    const x0=a.ox0===b.ox1,x1=b.ox0===a.ox1,y0=a.oy0===b.oy1,y1=b.oy0===a.oy1
    if(x0){if(charge?.(1)===false)return undefined;if(!(a.x0<b.x1))return false}
    if(x1){if(charge?.(1)===false)return undefined;if(!(b.x0<a.x1))return false}
    if(y0){if(charge?.(1)===false)return undefined;if(!(a.y0<b.y1))return false}
    if(y1){if(charge?.(1)===false)return undefined;if(!(b.y0<a.y1))return false}
    if(!x0){const hit=sharpOffsetLess(a.x0,a.ox0,b.x1,b.ox1,width,charge,reserve,projection);if(hit!==true)return hit}
    if(!x1){const hit=sharpOffsetLess(b.x0,b.ox0,a.x1,a.ox1,width,charge,reserve,projection);if(hit!==true)return hit}
    if(!y0){const hit=sharpOffsetLess(a.y0,a.oy0,b.y1,b.oy1,width,charge,reserve,projection);if(hit!==true)return hit}
    if(!y1)return sharpOffsetLess(b.y0,b.oy0,a.y1,a.oy1,width,charge,reserve,projection)
    return true
  }
  const x0 = sharpOffsetLess(a.x0,a.ox0,b.x1,b.ox1,width,charge,reserve,projection)
  if (x0 !== true) return x0
  const x1 = sharpOffsetLess(b.x0,b.ox0,a.x1,a.ox1,width,charge,reserve,projection)
  if (x1 !== true) return x1
  const y0 = sharpOffsetLess(a.y0,a.oy0,b.y1,b.oy1,width,charge,reserve,projection)
  if (y0 !== true) return y0
  return sharpOffsetLess(b.y0,b.oy0,a.y1,a.oy1,width,charge,reserve,projection)
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

/** Internal paid projection for owned numeric snapshots; integer inputs may be borrowed. */
export { sharpPoint as projectMeasuredRoutePoint }

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

// Private numeric scratch owned by one synchronous final traversal. Neither raw
// geometry nor a contact result is retained, and no view escapes the call.
export interface OwnedMeasuredRouteNumericSeed {
  readonly routes:readonly {readonly raw:readonly Point[];readonly points:readonly Point[]}[]
  readonly horizontal:readonly {readonly key:number;readonly piece:{readonly owner:number;readonly segment:number}}[]
  readonly vertical:readonly {readonly key:number;readonly piece:{readonly owner:number;readonly segment:number}}[]
  readonly horizontalEnds:readonly {readonly key:number;readonly piece:{readonly owner:number;readonly segment:number}}[]
  readonly verticalEnds:readonly {readonly key:number;readonly piece:{readonly owner:number;readonly segment:number}}[]
}
interface SharpProjectionRows {
  readonly rows:Point[][]
  readonly rangeStarts:Map<OwnedMeasuredRouteNumericSeed['horizontal'],Map<number,number>>
  readonly parts:Map<string,WrittenDecimalPart>
  readonly texts:Map<number,string>
  readonly strips:Array<Array<SharpBox|undefined>|undefined>
  readonly joins:Array<Array<SharpBox|false|undefined>|undefined>
  readonly numericSeed:OwnedMeasuredRouteNumericSeed
  readonly width:number
  readonly widthText:string
  readonly margin:number
  readonly offsets:number[]
  readonly driftHorizontal:OwnedMeasuredRouteNumericSeed['horizontal']
  readonly driftVertical:OwnedMeasuredRouteNumericSeed['vertical']
  readonly seen:Uint32Array
  readonly fullCandidates:Uint8Array
  epoch:number
  readonly contactOnly:true
}
function ownedSharpText(value:number,projection:SharpProjectionRows,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):string|undefined {
  if(charge?.(1)===false)return undefined
  const cached=projection.texts.get(value);if(cached!==undefined)return cached
  if(reserve?.(5)===false||charge?.(32)===false)return undefined
  const text=String(value)
  if(reserve?.(2)===false||charge?.(1)===false)return undefined
  projection.texts.set(value,text);return text
}
function sharpProjectionRow(owner:number,rows:SharpProjectionRows,charge?:MeasuredContactCharge):Point[]|undefined {
  if(charge?.(2)===false)return undefined
  return rows.rows[owner]
}
function ownedSharpPoint(_points:readonly Point[],owner:number,cursor:number,rows:SharpProjectionRows,charge?:MeasuredContactCharge,_reserve?:MeasuredContactCharge):Point|undefined {
  if(charge?.(3)===false)return undefined
  return rows.rows[owner]?.[cursor]
}
function ownedSharpStrip(points:readonly Point[],owner:number,index:number,a:Point,b:Point,projection:SharpProjectionRows,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):SharpBox|undefined {
  if(charge?.(2)===false)return undefined
  let row=projection.strips[owner]
  if(!row){if(reserve?.(points.length+1)===false)return undefined;row=projection.strips[owner]=new Array(points.length)}
  const cached=row[index];if(cached)return cached
  const strip=sharpStrip(a,b,reserve);if(!strip)return undefined
  if(charge?.(1)===false)return undefined
  row[index]=strip;return strip
}
function ownedSharpJoin(points:readonly Point[],owner:number,index:number,a:Point,b:Point,projection:SharpProjectionRows,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):SharpBox|false|undefined {
  if(charge?.(2)===false)return undefined
  let row=projection.joins[owner]
  if(!row){if(reserve?.(points.length+1)===false)return undefined;row=projection.joins[owner]=new Array(points.length)}
  const cached=row[index];if(cached!==undefined)return cached
  const c=ownedSharpPoint(points,owner,index+1,projection,charge,reserve);if(!c)return undefined
  const join=sharpJoin(a,b,c,charge,reserve);if(join===undefined)return undefined
  if(charge?.(1)===false)return undefined
  row[index]=join;return join
}
function straightThrough(points: readonly Point[], segment: number, p: Point, written: boolean, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge,projection?:SharpProjectionRows,owner=-1): boolean | undefined {
  let before=segment-1,after=segment,a:Point|undefined,b:Point|undefined
  while(before>=0){
    if(charge?.(1)===false)return undefined
    a=written?(projection?ownedSharpPoint(points,owner,before,projection,charge,reserve):sharpPoint(points[before]!,charge,reserve)):points[before]!
    if(!a)return undefined
    if(a.x!==p.x||a.y!==p.y)break
    before--
  }
  while(after<points.length){
    if(charge?.(1)===false)return undefined
    b=written?(projection?ownedSharpPoint(points,owner,after,projection,charge,reserve):sharpPoint(points[after]!,charge,reserve)):points[after]!
    if(!b)return undefined
    if(b.x!==p.x||b.y!==p.y)break
    after++
  }
  if(before<0||after>=points.length||!a||!b)return false
  return a.x===p.x&&b.x===p.x&&Math.min(a.y,b.y)<p.y&&p.y<Math.max(a.y,b.y)
    ||a.y===p.y&&b.y===p.y&&Math.min(a.x,b.x)<p.x&&p.x<Math.max(a.x,b.x)
}

function sharpContactsClear(points: Point[], index: number, routes: readonly {points:Point[];style:string}[], input: MeasuredGraph, width:number, widthText:string, visiblePeers:readonly number[], charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge,witness?:MeasuredSharpContactWitness,projection?:SharpProjectionRows,selected?:readonly (readonly number[]|undefined)[]):boolean|undefined {
  const edge=input.edges[index]!
  let servedPair:[{points:Point[]},{points:Point[]}]|undefined,servedSegments:[{a:Point;b:Point;edgeIndex:number;pointIndex:number},{a:Point;b:Point;edgeIndex:number;pointIndex:number}]|undefined
  // Numeric projection is local to this synchronous read-only score. Reuse
  // spellings, never contact decisions, and prepare a fresh view next call.
  let writtenPoints:Array<Point|undefined>
  if(projection){const row=sharpProjectionRow(index,projection,charge);if(!row)return undefined;writtenPoints=row}
  else{if(reserve?.(points.length+2)===false)return undefined;writtenPoints=new Array(points.length)}
  for(let cursor=0;cursor<visiblePeers.length;cursor++){
    if(charge?.(1)===false)return undefined
    const other=visiblePeers[cursor]!,peer=routes[other]!,peerEdge=input.edges[other]!
    if(projection&&charge?.(1)===false)return undefined
    let writtenPeer: (Point | undefined)[] | undefined=projection?.rows[other]
    const selectedPairs=selected?.[other]
    let pairCursor=0
    for(let i=1;selected?!!selectedPairs&&pairCursor<selectedPairs.length:i<points.length;i++)for(let j=1;selected?pairCursor<selectedPairs!.length:j<peer.points.length;j++){
      const at=pairCursor
      if(selected){
        if(charge?.(2)===false)return undefined
        i=selectedPairs![pairCursor]!;j=selectedPairs![pairCursor+1]!;pairCursor+=3
      }
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
        if(projection)return undefined
        if(reserve?.(peer.points.length+1)===false)return undefined
        writtenPeer=new Array(peer.points.length)
      }
      if(charge?.(4)===false)return undefined
      const A=writtenPoints[i-1]??(writtenPoints[i-1]=projection?ownedSharpPoint(points,index,i-1,projection,charge,reserve):sharpPoint(a,charge,reserve));if(!A)return undefined
      const B=writtenPoints[i]??(writtenPoints[i]=projection?ownedSharpPoint(points,index,i,projection,charge,reserve):sharpPoint(b,charge,reserve));if(!B)return undefined
      const C=writtenPeer[j-1]??(writtenPeer[j-1]=projection?ownedSharpPoint(peer.points,other,j-1,projection,charge,reserve):sharpPoint(c,charge,reserve));if(!C)return undefined
      const D=writtenPeer[j]??(writtenPeer[j]=projection?ownedSharpPoint(peer.points,other,j,projection,charge,reserve):sharpPoint(d,charge,reserve));if(!D)return undefined
      const stripA=projection?ownedSharpStrip(points,index,i,A,B,projection,charge,reserve):sharpStrip(A,B,reserve);if(!stripA)return undefined
      const stripB=projection?ownedSharpStrip(peer.points,other,j,C,D,projection,charge,reserve):sharpStrip(C,D,reserve);if(!stripB)return undefined
      const actualAv=A.x===B.x,actualBv=C.x===D.x
      // A raw diagonal may project to a real cardinal shaft. The old raw
      // parallel predicate did not inspect that strip, so prove it here.
      if(projection?.contactOnly&&actualAv===actualBv){
        if(charge?.(2)===false)return undefined
        const lo=Math.max(actualAv?Math.min(A.y,B.y):Math.min(A.x,B.x),actualAv?Math.min(C.y,D.y):Math.min(C.x,D.x)),
          hi=Math.min(actualAv?Math.max(A.y,B.y):Math.max(A.x,B.x),actualAv?Math.max(C.y,D.y):Math.max(C.x,D.x))
        if(lo<hi){
          const first=actualAv?A.x:A.y,second=actualAv?C.x:C.y,
            overlap=sharpOffsetLess(Math.max(first,second),-2,Math.min(first,second),0,widthText,charge,reserve,projection)
          if(overlap!==false)return overlap===undefined?undefined:sharpRefusal(witness,i,other,j,charge)
        }
      }else if(actualAv===actualBv&&(a.x!==b.x&&a.y!==b.y||c.x!==d.x&&c.y!==d.y)){
        const overlap=sharpBoxesOverlap(stripA,stripB,widthText,charge,reserve,projection)
        if(overlap!==false)return overlap===undefined?undefined:sharpRefusal(witness,i,other,j,charge)
      }
      if(actualAv!==actualBv){
        const overlap=sharpBoxesOverlap(stripA,stripB,widthText,charge,reserve,projection)
        if(overlap===undefined)return undefined
        if(overlap){
          if(reserve?.(6)===false)return undefined
          const raw={x:actualAv?a.x:c.x,y:actualAv?c.y:a.y},written={x:actualAv?A.x:C.x,y:actualAv?C.y:A.y}
          let proper=false
          if(projection?.contactOnly&&projection.numericSeed&&(a.x!==b.x&&a.y!==b.y||c.x!==d.x&&c.y!==d.y)){
            if(charge?.(1)===false)return undefined
            if(selectedPairs?.[at+2]===1){
              // The raw witness belongs to THIS support pair. Complete served
              // rows retain true route endpoints and subdivision neighbors.
              if(!servedPair){
                if(reserve?.(20)===false)return undefined
                servedPair=[{points:writtenPoints as Point[]},{points:writtenPeer as Point[]}]
                servedSegments=[{a:A,b:B,edgeIndex:0,pointIndex:i-1},{a:C,b:D,edgeIndex:1,pointIndex:j-1}]
              }
              if(charge?.(7+writtenPoints.length+writtenPeer.length)===false||reserve?.(4)===false)return undefined
              servedPair[1].points=writtenPeer as Point[]
              const first=servedSegments![0],second=servedSegments![1]
              first.a=A;first.b=B;first.pointIndex=i-1;second.a=C;second.b=D;second.pointIndex=j-1
              proper=!!crossingPoint(first,second,servedPair)
            }
          }else{
            const rawA=straightThrough(points,i,raw,false,charge,reserve);if(rawA===undefined)return undefined
            const rawB=straightThrough(peer.points,j,raw,false,charge,reserve);if(rawB===undefined)return undefined
            if(rawA&&rawB){
              const writtenA=straightThrough(points,i,written,true,charge,reserve,projection,index);if(writtenA===undefined)return undefined
              const writtenB=straightThrough(peer.points,j,written,true,charge,reserve,projection,other);if(writtenB===undefined)return undefined
              proper=writtenA&&writtenB
            }
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
      if(i+1<points.length){if(projection){const join=ownedSharpJoin(points,index,i,A,B,projection,charge,reserve);if(join===undefined)return undefined;joinA=join}else{if(charge?.(1)===false)return undefined;const next=writtenPoints[i+1]??(writtenPoints[i+1]=sharpPoint(points[i+1]!,charge,reserve));if(!next)return undefined;const join=sharpJoin(A,B,next,charge,reserve);if(join===undefined)return undefined;joinA=join}}
      if(j+1<peer.points.length){if(projection){const join=ownedSharpJoin(peer.points,other,j,C,D,projection,charge,reserve);if(join===undefined)return undefined;joinB=join}else{if(charge?.(1)===false)return undefined;const next=writtenPeer[j+1]??(writtenPeer[j+1]=sharpPoint(peer.points[j+1]!,charge,reserve));if(!next)return undefined;const join=sharpJoin(C,D,next,charge,reserve);if(join===undefined)return undefined;joinB=join}}
      // An actual quarter is additional ink, never excused by a remote common
      // endpoint or an unrelated proper crossing elsewhere on these routes.
      if(joinA){const hit=sharpBoxesOverlap(joinA,stripB,widthText,charge,reserve,projection);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
      if(joinB){const hit=sharpBoxesOverlap(stripA,joinB,widthText,charge,reserve,projection);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
      if(joinA&&joinB){const hit=sharpBoxesOverlap(joinA,joinB,widthText,charge,reserve,projection);if(hit!==false)return hit===undefined?undefined:sharpRefusal(witness,i,other,j,charge)}
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
 * Only an authored common endpoint may be an unmarked contact. The private
 * final Class owner may reuse support separation only while geometry, input
 * metadata and its charge/reserve callbacks cannot mutate the query. */
export function scoreMeasuredRouteCrossings(points: Point[], index: number, routes: readonly { points: Point[]; style: string }[], input: MeasuredGraph, charge?: MeasuredContactCharge, reserve?: MeasuredContactCharge,witness?:MeasuredSharpContactWitness,prepaidPairBudget:1|3=3,reuseSharpSupports=false): number | undefined {
  return scoreMeasuredRouteCrossingsWithAdmission(points,index,routes,input,charge,reserve,true,witness,prepaidPairBudget,reuseSharpSupports)
}

// Cardinal route sets from this many segments use the prepared traversal. The
// unprepared fallback charges and scans every Cartesian segment pair (about
// 1.5·S² for S segments of a Class tree); the prepared one charges about 450
// per segment. They cross near 300 segments.
const PREPARED_CONTACT_MIN_SEGMENTS = 256

// Prepare the immutable owned traversal once: written rows and sorted axis
// indices. A raw ULP diagonal can be exactly cardinal after the writer projects
// it, so diagonal routes are always prepared. Large cardinal sets are prepared
// too: without it a Class tree of a few hundred cards spends its whole
// admission budget on the quadratic fallback. Routes with a degenerate or
// noncardinal written segment keep the unprepared scorer (false).
function prepareOwnedNumericSeed(routes:readonly {points:Point[];style:string}[],charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):OwnedMeasuredRouteNumericSeed|false|undefined {
  let diagonal=false,segments=0
  for(const route of routes)for(let i=1;i<route.points.length;i++){
    if(charge?.(1)===false)return undefined
    const a=route.points[i-1]!,b=route.points[i]!
    if(a.x!==b.x&&a.y!==b.y)diagonal=true
    segments++
  }
  if(!diagonal&&segments<PREPARED_CONTACT_MIN_SEGMENTS)return false
  // Seed record, route slots/header, four index headers, comparator/stop
  // records, and the temporary four-list traversal array.
  if(reserve?.(routes.length+18)===false)return undefined
  const rows:Array<{raw:Point[];points:Point[]}>=new Array(routes.length),
    horizontal:Array<{key:number;piece:{owner:number;segment:number}}>=[],vertical:typeof horizontal=[],
    horizontalEnds:typeof horizontal=[],verticalEnds:typeof horizontal=[]
  for(let owner=0;owner<routes.length;owner++){
    const source=routes[owner]!.points
    if(charge?.(1)===false||reserve?.(5*source.length+5)===false)return undefined
    const raw:Point[]=new Array(source.length),points:Point[]=new Array(source.length)
    for(let i=0;i<source.length;i++){
      if(charge?.(3)===false)return undefined
      const value=source[i]!,point=sharpPoint(value,charge,reserve);if(!point)return undefined
      raw[i]={x:value.x,y:value.y}
      if(point===value){if(reserve?.(3)===false)return undefined;points[i]={x:point.x,y:point.y}}
      else points[i]=point
    }
    rows[owner]={raw,points}
    for(let segment=0;segment+1<points.length;segment++){
      if(charge?.(4)===false)return undefined
      const a=points[segment]!,b=points[segment+1]!
      if((a.x===b.x)===(a.y===b.y))return false
      if(reserve?.(15)===false)return undefined
      const piece={owner,segment},isVertical=a.x===b.x
      ;(isVertical?vertical:horizontal).push({key:isVertical?a.x:a.y,piece})
      ;(isVertical?verticalEnds:horizontalEnds).push({key:isVertical?a.y:a.x,piece},{key:isVertical?b.y:b.x,piece})
    }
  }
  const stopped={},compare=(a:typeof horizontal[number],b:typeof horizontal[number])=>{
    if(charge?.(1)===false)throw stopped
    return a.key-b.key||a.piece.owner-b.piece.owner||a.piece.segment-b.piece.segment
  }
  try{for(const entries of [horizontal,vertical,horizontalEnds,verticalEnds])entries.sort(compare)}
  catch(error){if(error===stopped)return undefined;throw error}
  return {routes:rows,horizontal,vertical,horizontalEnds,verticalEnds}
}

/** Final contact admission over one immutable, internally owned snapshot.
 * The optional seed contains canonical-writer numeric rows and complete sorted
 * fixed/end-point indices, refreshed AFTER every Class geometry write. Input
 * topology, width/radius and point arrays stay immutable; only visibility may
 * change during this synchronous traversal. No contact result escapes. */
export function createOwnedMeasuredRouteContactValidator(routes:readonly {points:Point[];style:string}[],input:MeasuredGraph,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge,validateSegments=false,seed?:OwnedMeasuredRouteNumericSeed):((index:number,witness?:MeasuredSharpContactWitness)=>boolean)|false|undefined {
  if(!seed&&input.maximumEdgeStrokeWidth!==undefined&&input.maximumEdgeBendRadius===0){
    const prepared=prepareOwnedNumericSeed(routes,charge,reserve)
    if(prepared===undefined)return undefined
    if(prepared)seed=prepared
  }
  if(!seed){
    // No authenticated prepared data: retain the original complete scorer,
    // including its ordinary pair/preparation envelope and unknown handling.
    if(validateSegments)for(const route of routes){
      let previous:Point|undefined
      for(const raw of route.points){
        const point=sharpPoint(raw,charge,reserve);if(!point)return undefined
        if(charge?.(2)===false)return undefined
        if(previous&&(point.x===previous.x&&point.y===previous.y||point.x!==previous.x&&point.y!==previous.y))return false
        previous=point
      }
    }
    if(reserve?.(1)===false)return undefined
    return (index,witness)=>{
      if(charge?.(routes.length)===false)return false
      let peerSegments=0
      for(let other=0;other<routes.length;other++)if(other!==index&&routes[other]!.style!=='invisible')peerSegments+=Math.max(0,routes[other]!.points.length-1)
      const points=routes[index]!.points,basis=measuredRouteContactPairBudget(input)
      if(charge?.(basis*Math.max(0,points.length-1)*peerSegments+points.length+peerSegments+routes.length)===false)return false
      return scoreMeasuredRouteCrossings(points,index,routes,input,charge,reserve,witness,basis,true)!==undefined
    }
  }
  if(charge?.(routes.length+1)===false)return undefined
  if(seed.routes.length!==routes.length)return false
  let segments=0
  for(const route of routes)segments+=Math.max(0,route.points.length-1)
  // Four ordinal arrays, three Maps, projection record and returned closure.
  if(reserve?.(4*routes.length+28+2*segments+4)===false)return undefined
  const rows:Point[][]=new Array(routes.length),offsets:number[]=new Array(routes.length),
    driftHorizontal:OwnedMeasuredRouteNumericSeed['horizontal'][number][]=[],driftVertical:typeof driftHorizontal=[]
  let magnitude=0,cursor=0
  for(let owner=0;owner<routes.length;owner++){
    if(charge?.(3)===false)return undefined
    const raw=routes[owner]!.points,prepared=seed.routes[owner]!
    offsets[owner]=cursor;cursor+=Math.max(0,raw.length-1)
    if(raw.length!==prepared.raw.length||raw.length!==prepared.points.length)return false
    // The seed owns immutable copied canonical rows; no duplicate reference
    // array is needed during this synchronous read-only traversal.
    rows[owner]=prepared.points as Point[]
    let previous:Point|undefined
    for(let i=0;i<raw.length;i++){
      if(charge?.(7)===false)return undefined
      const actual=raw[i]!,old=prepared.raw[i]!,written=prepared.points[i]!
      if(actual.x!==old.x||actual.y!==old.y||!Number.isFinite(actual.x)||!Number.isFinite(actual.y)||!Number.isFinite(written.x)||!Number.isFinite(written.y))return false
      if(previous&&(written.x===previous.x&&written.y===previous.y||written.x!==previous.x&&written.y!==previous.y))return false
      previous=written;magnitude+=Math.abs(actual.x)+Math.abs(actual.y)
    }
  }
  const value=input.maximumEdgeStrokeWidth
  let width:number,widthText:string
  if(Number.isSafeInteger(value)&&value!>0){if(reserve?.(4)===false||charge?.(value!<10?2:17)===false)return undefined;width=value!;widthText=String(value)}
  else{if(reserve?.(5)===false||charge?.(128)===false)return undefined;widthText=formatSvgNumber(value!);width=Number(widthText)}
  if(!Number.isFinite(width)||width<=0||input.maximumEdgeBendRadius!==0)return false
  const margin=Math.max(width,CROSSING_ENDPOINT_RADIUS)+(magnitude+width)*1e-10+1e-9,
    endpointMargin=CROSSING_ENDPOINT_RADIUS+(magnitude+width)*1e-10+1e-9,large=magnitude>Math.sqrt(Number.MAX_VALUE)/4,
    fullCandidates=new Uint8Array(segments)
  for(let axis=0;axis<2;axis++)for(const entry of axis?seed.horizontal:seed.vertical){
    if(charge?.(3)===false)return undefined
    const raw=routes[entry.piece.owner]!.points,written=seed.routes[entry.piece.owner]!.points,
      full=requiresFullContactCandidates(raw,written,entry.piece.segment,endpointMargin,large,charge)
    if(full===undefined)return undefined
    if(full){if(reserve?.(1)===false||charge?.(1)===false)return undefined;fullCandidates[offsets[entry.piece.owner]!+entry.piece.segment]=1;(axis?driftHorizontal:driftVertical).push(entry)}
  }
  const projection:SharpProjectionRows={rows,rangeStarts:new Map(),parts:new Map(),texts:new Map(),strips:new Array(routes.length),joins:new Array(routes.length),numericSeed:seed,width,widthText,margin,offsets,driftHorizontal,driftVertical,seen:new Uint32Array(segments),fullCandidates,epoch:0,contactOnly:true}
  return (index,witness)=>scoreMeasuredRouteCrossingsWithAdmission(routes[index]!.points,index,routes,input,charge,reserve,true,witness,1,false,projection)!==undefined
}

/** Search ranking only: retains the full-width shaft and legacy crossing
 * metric. This result is NOT a sharp-contact certificate. Every caller must
 * pass committed-marker/global final admission before returning geometry. */
export function scoreMeasuredRouteProposalCrossings(points:Point[],index:number,routes:readonly {points:Point[];style:string}[],input:MeasuredGraph,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):number|undefined {
  return scoreMeasuredRouteCrossingsWithAdmission(points,index,routes,input,charge,reserve,false)
}

/** A remote whole-route endpoint still owns the shared crossing primitive's
 * physical exclusion disk. Such segments and raw diagonals keep full queries. */
function requiresFullContactCandidates(raw:readonly Point[],written:readonly Point[],segment:number,margin:number,large:boolean,charge?:MeasuredContactCharge):boolean|undefined {
  if(charge?.(4)===false)return undefined
  const a=raw[segment]!,b=raw[segment+1]!,A=written[segment]!,B=written[segment+1]!
  if(large||a.x!==b.x&&a.y!==b.y)return true
  for(let end=0;end<2;end++){
    if(charge?.(2)===false)return undefined
    const at=end?raw.length-1:0,p=raw[at]!,P=written[at]!
    // Only literal equality in BOTH coordinate authorities is local. The
    // segment-end query already covers that entire endpoint neighborhood.
    if(p.x===a.x&&p.y===a.y&&P.x===A.x&&P.y===A.y||p.x===b.x&&p.y===b.y&&P.x===B.x&&P.y===B.y)continue
    for(let view=0;view<2;view++){
      if(charge?.(1)===false)return undefined
      const start=view?A:a,finish=view?B:b,point=view?P:p
      if(point.x>=Math.min(start.x,finish.x)-margin&&point.x<=Math.max(start.x,finish.x)+margin&&point.y>=Math.min(start.y,finish.y)-margin&&point.y<=Math.max(start.y,finish.y)+margin)return true
    }
  }
  return false
}

function ownedRangeStart(entries:OwnedMeasuredRouteNumericSeed['horizontal'],lo:number,projection:SharpProjectionRows,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):number|undefined {
  if(charge?.(2)===false)return undefined
  let starts=projection.rangeStarts.get(entries)
  const cached=starts?.get(lo);if(cached!==undefined)return cached
  let left=0,right=entries.length
  while(left<right){if(charge?.(1)===false)return undefined;const middle=(left+right)>>>1;if(entries[middle]!.key<lo)left=middle+1;else right=middle}
  if(!starts){if(reserve?.(3)===false||charge?.(1)===false)return undefined;starts=new Map();projection.rangeStarts.set(entries,starts)}
  if(reserve?.(2)===false||charge?.(1)===false)return undefined
  starts.set(lo,left);return left
}

function seededSharpPairs(points:readonly Point[],index:number,routes:readonly {points:Point[];style:string}[],projection:SharpProjectionRows,charge?:MeasuredContactCharge,reserve?:MeasuredContactCharge):Array<number[]|undefined>|null|undefined {
  let selected:Array<number[]|undefined>|undefined
  const seed=projection.numericSeed,margin=projection.margin
  for(let i=1;i<points.length;i++){
    if(charge?.(4)===false)return undefined
    const a=points[i-1]!,b=points[i]!
    if(projection.contactOnly&&charge?.(1)===false)return undefined
    const vertical=a.x===b.x,selective=projection.contactOnly&&!projection.fullCandidates![projection.offsets![index]!+i-1]
    if(projection.contactOnly){
      if(charge?.(1)===false)return undefined
      projection.epoch++
      if(projection.epoch===0x100000000){if(charge?.(projection.seen.length)===false)return undefined;projection.seen.fill(0);projection.epoch=1}
    }
    for(let axis=0;axis<(selective?5:2);axis++){
      if(charge?.(4)===false)return undefined
      let entries:OwnedMeasuredRouteNumericSeed['horizontal'],lo:number,hi:number
      if(!selective){entries=axis?seed.horizontal:seed.vertical;lo=Math.min(axis?a.y:a.x,axis?b.y:b.x)-margin;hi=Math.max(axis?a.y:a.x,axis?b.y:b.x)+margin}
      else if(axis===0){entries=vertical?seed.vertical:seed.horizontal;lo=(vertical?a.x:a.y)-margin;hi=(vertical?a.x:a.y)+margin}
      else if(axis===1||axis===2){entries=vertical?seed.horizontal:seed.vertical;const p=axis===1?a:b;lo=(vertical?p.y:p.x)-margin;hi=(vertical?p.y:p.x)+margin}
      else if(axis===3){entries=vertical?seed.horizontalEnds:seed.verticalEnds;lo=(vertical?a.x:a.y)-margin;hi=(vertical?a.x:a.y)+margin}
      else{entries=(vertical?projection.driftHorizontal:projection.driftVertical)!;lo=Math.min(vertical?a.y:a.x,vertical?b.y:b.x)-margin;hi=Math.max(vertical?a.y:a.x,vertical?b.y:b.x)+margin}
      const left=ownedRangeStart(entries,lo,projection,charge,reserve);if(left===undefined)return undefined
      for(let cursor=left;cursor<entries.length;cursor++){
        if(charge?.(3)===false)return undefined
        const entry=entries[cursor]!;if(entry.key>hi)break
        const piece=entry.piece
        if(piece.owner===index||routes[piece.owner]!.style==='invisible')continue
        if(projection.contactOnly){if(charge?.(2)===false)return undefined;const ordinal=projection.offsets![piece.owner]!+piece.segment;if(projection.seen[ordinal]===projection.epoch)continue;projection.seen[ordinal]=projection.epoch}
        if(charge?.(1)===false)return undefined
        const peer=routes[piece.owner]!.points,c=peer[piece.segment]!,d=peer[piece.segment+1]!
        if(separatedSharpSupportBounds(a,b,c,d,projection.width!))continue
        if(!selected){if(reserve?.(routes.length+1)===false)return undefined;selected=new Array(routes.length)}
        let pairs=selected[piece.owner]
        if(!pairs){if(reserve?.(1)===false)return undefined;pairs=selected[piece.owner]=[]}
        if(reserve?.(3)===false||charge?.(1)===false)return undefined
        // Slot2 is unknown/no positive raw witness, never a negative proof.
        pairs.push(i,piece.segment+1,0)
      }
    }

  }
  return selected??null
}

function scoreMeasuredRouteCrossingsWithAdmission(points:Point[],index:number,routes:readonly {points:Point[];style:string}[],input:MeasuredGraph,charge:MeasuredContactCharge|undefined,reserve:MeasuredContactCharge|undefined,sharp:boolean,witness?:MeasuredSharpContactWitness,prepaidPairBudget:1|3=3,reuseSharpSupports=false,projection?:SharpProjectionRows):number|undefined {
  let score = 0
  let width: number | undefined, widthText: string | undefined
  if(projection){
    if(charge?.(2)===false)return undefined
    width=projection.width;widthText=projection.widthText
  }else if (input.maximumEdgeStrokeWidth !== undefined) {
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
  let contactAdmission=false
  if(projection){
    if(charge?.(2)===false)return undefined
    contactAdmission=projection.contactOnly&&width!==undefined&&input.maximumEdgeBendRadius===0
  }
  if(sharp&&width!==undefined&&input.maximumEdgeBendRadius===0){
    if(reserve?.(1)===false)return undefined
    visiblePeers=[]
  }
  let indexed:Array<number[]|undefined>|false|null|undefined=false
  if(projection){indexed=seededSharpPairs(points,index,routes,projection,charge,reserve);if(indexed===undefined)return undefined;if(indexed===null)return 0}
  let crossingSegments:[{a:Point;b:Point;edgeIndex:number;pointIndex:number},{a:Point;b:Point;edgeIndex:number;pointIndex:number}]|undefined
  let candidateOrthogonal: boolean | undefined
  const edge = input.edges[index]!, pair = [{ points }, { points: [] as Point[] }]
  if(projection&&charge?.(routes.length)===false)return undefined
  for (let other = 0; other < routes.length; other++) {
    const route = routes[other]!
    if (other === index || route.style === 'invisible') continue
    let needsSharpContact = !reuseSharpSupports
    if(indexed){if(charge?.(1)===false)return undefined;if(!indexed[other]?.length)continue}
    if(visiblePeers){
      if(reserve?.(1)===false||charge?.(1)===false)return undefined
      if(needsSharpContact)visiblePeers.push(other)
    }
    const peerEdge = input.edges[other]!
    let contacts: Set<string> | undefined
    let locations:Array<{x:number;y:number;error:number}>|undefined
    if(projection){if(charge?.(1)===false)return undefined;pair[1]!.points=route.points}
    let selectedCursor=0
    const selected=indexed?indexed[other]:undefined
    for (let i = 1; indexed ? selectedCursor<selected!.length : i < points.length; i++) for (let j = 1; indexed ? selectedCursor<selected!.length : j < route.points.length; j++) {
      const selectedPair=selectedCursor
      if(indexed){
        if(charge?.(2)===false)return undefined
        i=selected![selectedCursor]!;j=selected![selectedCursor+1]!;selectedCursor+=3
      }
      if(projection&&!indexed&&charge?.(prepaidPairBudget)===false)return undefined
      const a = points[i - 1]!, b = points[i]!, c = route.points[j - 1]!, d = route.points[j]!
      if(!indexed&&sharp&&width!==undefined&&input.maximumEdgeBendRadius===0){
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
        needsSharpContact = true
      }
      // Default callers retain their old prepaid three-predicate envelope.
      // Explicit one-predicate callers must pay the remaining work now, even
      // if their input no longer has sharp metadata.
      if((indexed||prepaidPairBudget===1)&&charge?.(contactAdmission?1:2)===false)return undefined
      if(!contactAdmission){
        if (width === undefined) {
          if (sharesShaft(a,b,c,d)) return undefined
        } else {
          const shared = sharesWrittenShaft(a,b,c,d,width,widthText!,charge,reserve)
          if (shared !== false) return undefined
        }
      }
      if(projection){
        // The complete selected roster is a superset of every RAW bbox
        // intersection. Match the original sweep's gate before its exact
        // crossing primitive, retaining original route and point ordinals.
        if(charge?.(1)===false)return undefined
        if((a.x!==b.x||a.y!==b.y)&&(c.x!==d.x||c.y!==d.y)&&Math.min(a.x,b.x)<=Math.max(c.x,d.x)&&Math.min(c.x,d.x)<=Math.max(a.x,b.x)&&Math.min(a.y,b.y)<=Math.max(c.y,d.y)&&Math.min(c.y,d.y)<=Math.max(a.y,b.y)){
          if(!crossingSegments){
            if(reserve?.(13)===false)return undefined
            crossingSegments=[{a,b,edgeIndex:0,pointIndex:i-1},{a:c,b:d,edgeIndex:1,pointIndex:j-1}]
          }
          if(charge?.(7+points.length+route.points.length)===false||reserve?.(4)===false)return undefined
          const first=crossingSegments[0],second=crossingSegments[1]
          first.a=a;first.b=b;first.pointIndex=i-1;second.a=c;second.b=d;second.pointIndex=j-1
          const point=crossingPoint(first,second,pair)
          if(point){
            if(!locations){if(reserve?.(1)===false)return undefined;locations=[]}
            if(charge?.(locations.length)===false||reserve?.(2)===false)return undefined
            retainCrossingLocation(locations,point)
            if(contactAdmission&&(a.x!==b.x&&a.y!==b.y||c.x!==d.x&&c.y!==d.y)){
              if(charge?.(1)===false)return undefined
              selected![selectedPair+2]=1
            }
          }
        }
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
    // Only the private final Class traversal opts in: its local charge and
    // reserve callbacks cannot mutate the final geometry. Every segment pair
    // of an omitted peer already proved the SAME support bound that the sharp
    // pass would repeat. General/live callers retain their original rereads.
    if(visiblePeers&&reuseSharpSupports&&needsSharpContact)visiblePeers.push(other)
    // Every proper crossing of finite orthogonal routes is a recorded
    // perpendicular contact. A contact-free pair needs no segment preparation.
    let crossings:number
    if(projection){
      if(locations){
        const n=locations.length
        if(charge?.(2*n*n+n)===false||reserve?.(2*n+1)===false)return undefined
        crossings=distinctCrossingLocations(locations)
      }else crossings=0
    }else{
      if (!contacts && (candidateOrthogonal ??= orthogonal(points)) && orthogonal(route.points)) continue
      pair[1]!.points = route.points
      crossings = countPolylineCrossings(pair)
    }
    if (crossings < (contacts?.size ?? 0)) return undefined
    score += crossings
  }
  if (sharp && width !== undefined && input.maximumEdgeBendRadius === 0 && visiblePeers!.length && sharpContactsClear(points,index,routes,input,width,widthText!,visiblePeers!,charge,reserve,witness,projection,indexed||undefined) !== true) return undefined
  return score
}
