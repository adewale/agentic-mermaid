import { describe, expect, test } from 'bun:test'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'
import { createOwnedMeasuredRouteContactValidator, measuredRouteContactPairBudget, scoreMeasuredRouteCrossings, writtenCoordinateGapLessThan } from '../layout/measured-route-safety.ts'
import type { MeasuredRouteGraph } from '../layout/measured-graph.ts'
import type { Point } from '../types.ts'

interface TestRouteGraph extends MeasuredRouteGraph {
  edges: { source: number; target: number }[]
  maximumEdgeStrokeWidth?: number
  maximumEdgeBendRadius?: number
}
function measured(overrides: Partial<TestRouteGraph> = {}): TestRouteGraph {
  return { edges: [{ source: 0, target: 2 }, { source: 1, target: 2 }, { source: 2, target: 3 }, { source: 0, target: 3 }, { source: 0, target: 3 }], ...overrides }
}

describe('measured painted route contacts', () => {
  const input = (width: number | undefined): TestRouteGraph => measured({
    maximumEdgeStrokeWidth: width,
    edges: [{ source: 0, target: 1 }, { source: 0, target: 2 }],
  })
  const routes = (a: Point[], b: Point[], style = 'solid') => [{ points: a, style: 'solid' }, { points: b, style }]

  test.each([
    { name: 'distinct source ports and a narrow vertical overlap', a: [{ x: 781.361, y: 518.7 }, { x: 781.361, y: 562.7 }, { x: 800, y: 562.7 }], b: [{ x: 751.361, y: 518.7 }, { x: 751.361, y: 550.7 }, { x: 780.379, y: 550.7 }, { x: 780.379, y: 601.5 }], style: 'solid' },
    { name: 'solid and dashed carriers beside a common source', a: [{ x: 1397.784, y: 489.960249676 }, { x: 1361.784, y: 489.960249676 }, { x: 1361.784, y: 439.05 }, { x: 1001.054, y: 439.05 }, { x: 1001.054, y: 478.55 }, { x: 959.054, y: 478.55 }], b: [{ x: 1397.784, y: 502.912812095 }, { x: 1355.784, y: 502.912812095 }, { x: 1355.784, y: 479.35 }, { x: 971.054, y: 479.35 }, { x: 971.054, y: 545.45 }], style: 'dashed' },
  ])('rejects actual one-pixel ink in $name', ({ a: originalA, b: originalB, style }) => {
    const a: Point[] = [...originalA], b: Point[] = [...originalB], ink = routes(a, b, style)
    // These distinct paths share an authored source, not a physical stem.
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(b, 1, ink, input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(undefined))).toBe(0)
  })

  test('retains written boundary contact, proper crossings and actual common terminals', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }]
    for (const x of [1, 2]) expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x, y: 2 }, { x, y: 18 }]), input(1))).toBe(0)
    const crossing = [{ x: -10, y: 10 }, { x: 10, y: 10 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, crossing), input(1))).toBe(1)
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), input(1))).toBe(0)
    // Both the writer's width and coordinates spell exactly one here.
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: 1.0000000000002, y: 2 }, { x: 1.0000000000002, y: 18 }]), input(1.0000000000004))).toBe(0)
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: .2, y: 2 }, { x: .2, y: 18 }]), input(.1))).toBe(0)
    const decimal = [{ x: .2, y: 0 }, { x: .2, y: 20 }]
    expect(scoreMeasuredRouteCrossings(decimal, 0, routes(decimal, [{ x: .3, y: 2 }, { x: .3, y: 18 }]), input(.1))).toBe(0)
    const large = [{ x: 1000000000000.2, y: 0 }, { x: 1000000000000.2, y: 20 }]
    expect(scoreMeasuredRouteCrossings(large, 0, routes(large, [{ x: 1000000000000.3, y: 2 }, { x: 1000000000000.3, y: 18 }]), input(.10001))).toBeUndefined()
    for (const width of [1000000000001, 1.2345678901234568e21]) {
      const written = width === 1000000000001 ? 1000000000001 : 1.23456789012e21
      expect(scoreMeasuredRouteCrossings(a, 0, routes(a, [{ x: written, y: 2 }, { x: written, y: 18 }]), input(width))).toBe(0)
    }
  })

  test('does not discard a short positive support or invisible peer distinction', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }], b = [{ x: .75, y: 2 }, { x: .75, y: 2.005 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b), input(1))).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b, 'invisible'), input(1))).toBe(0)
  })

  test('keeps physical peers through the owned whole-route traversal', () => {
    const a = Array.from({ length: 60 }, (_, y) => ({ x: 0, y })), b = Array.from({ length: 33 }, (_, y) => ({ x: .75, y }))
    const ink = routes(a, b), original = structuredClone(ink)
    for (const width of [1, undefined]) {
      let remaining = 1_000_000
      const validate = createOwnedMeasuredRouteContactValidator(ink, input(width), amount => { remaining -= amount; return remaining >= 0 })
      expect(typeof validate).toBe('function')
      if (typeof validate !== 'function') throw new Error('expected owned scorer')
      expect(validate(0)).toBe(width === undefined)
      expect(remaining).toBeLessThan(1_000_000)
      expect(remaining).toBeGreaterThanOrEqual(0)
    }
    expect(ink).toEqual(original)
  })

  test('does not infer zero written support from a tiny raw shared endpoint', () => {
    // Conditional long-tail formatting reverses the second tiny segment:
    // the shared endpoint writes1000.12345679, beyond BOTH other endpoints.
    const a = [{ x: 0, y: 1000.1234567894 }, { x: 0, y: 1000.123456789401 }],
      b = [{ x: .75, y: 1000.123456789401 }, { x: .75, y: 1000.1234567895 }]
    expect(scoreMeasuredRouteCrossings(a, 0, routes(a, b), input(1))).toBeUndefined()
  })

  test('keeps proved axis-disjoint peers within the existing extra-work allowance', () => {
    const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      ink = [{ points: a, style: 'solid' }, ...Array.from({ length: 100 }, (_, i) => ({ points: [{ x: i + 1, y: 10 }, { x: i + 1, y: 20 }], style: 'solid' }))],
      graph = measured({ maximumEdgeStrokeWidth: 1, edges: ink.map(() => ({ source: 0, target: 1 })) })
    let remaining = 300
    expect(scoreMeasuredRouteCrossings(a, 0, ink, graph, amount => (remaining -= amount) >= 0)).toBe(0)
    expect(remaining).toBeGreaterThanOrEqual(0)
  })

  test('charges the same caller allowance and stops at the first refused debit', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 20 }], b = [{ x: 1, y: 2 }, { x: 1, y: 18 }], ink = routes(a, b)
    let full = 0
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), amount => { full += amount })).toBe(0)
    expect(full).toBeGreaterThan(0)
    let left = full - 1, stopped = false
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), amount => {
      expect(stopped).toBe(false)
      left -= amount
      if (left < 0) stopped = true
      return !stopped
    })).toBeUndefined()
    expect(stopped).toBe(true)
    let legacyVisits = 0
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(undefined), () => { legacyVisits++; return false })).toBe(0)
    expect(legacyVisits).toBe(0)
    let capacityStopped = false
    expect(scoreMeasuredRouteCrossings(a, 0, ink, input(1), () => { expect(capacityStopped).toBe(false) }, () => {
      expect(capacityStopped).toBe(false)
      capacityStopped = true
      return false
    })).toBeUndefined()
    expect(capacityStopped).toBe(true)
  })
})

describe('written sharp join contact closure', () => {
  const path = (values: readonly (readonly [number, number])[]): Point[] => values.map(([x, y]) => ({ x, y }))
  const graph = (width = 1, radius: number | undefined = 0, commonSource = false): TestRouteGraph => measured({
    edges: [{ source: 0, target: commonSource ? 1 : 2 }, { source: commonSource ? 0 : 1, target: 2 }],
    maximumEdgeStrokeWidth: width, maximumEdgeBendRadius: radius,
  })
  const cases = [
    { name: '13: separated collinear ends meet through their outer miters', width: 1, common: false, reverseShared: false,
      a: path([[636.974, 869.2], [507.414, 869.2], [507.414, 1119], [250, 1119], [250, 1131.45], [184, 1131.45]]),
      b: path([[636.974, 760.3], [501.414, 760.3], [501.414, 1078.7], [250, 1078.7], [250, 1118.2], [184, 1118.2]]) },
    { name: '38: opposite vertical spans merely touch before their corners merge', width: 1, common: false, reverseShared: true,
      a: path([[430.496, 369.5], [430.496, 384.5], [543.735, 384.5], [543.735, 434.8], [543.258437581, 434.8], [543.258437581, 449.8]]),
      b: path([[556.211, 449.8], [556.211, 434.8], [647.502, 434.8], [647.502, 384.5], [544.421, 384.5], [544.421, 215.3], [386.641, 215.3], [386.641, 200.3]]) },
    { name: 'a shared physical source cannot excuse a remote wide join', width: 22, common: true, reverseShared: false,
      a: path([[0, 0], [10, 0], [10, 30]]), b: path([[0, 0], [0, -30]]) },
  ]
  test.each(cases)('rejects $name', ({ a, b, width, common, reverseShared }) => {
    const input = graph(width, 0, common), routes = [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], before = structuredClone({ input, routes })
    if (reverseShared) { input.edges = [{ source: 0, target: 1 }, { source: 1, target: 2 }]; before.input.edges = structuredClone(input.edges) }
    for (const stable of [false, true]) {
      expect(scoreMeasuredRouteCrossings(a, 0, routes, input, undefined, undefined, undefined, 3, stable)).toBeUndefined()
      expect(scoreMeasuredRouteCrossings(b, 1, routes, input, undefined, undefined, undefined, 3, stable)).toBeUndefined()
    }
    const owned = createOwnedMeasuredRouteContactValidator(routes, input)
    if (typeof owned !== 'function') throw new Error('expected owned scorer')
    expect(owned(0)).toBe(false)
    expect({ input, routes }).toEqual(before)
  })
  test('completes a separated field by paying only its executed contact predicates', () => {
    const candidate=path([[0,0],[10,0]]),input=graph(),edges=[input.edges[0]!],routes=[{points:candidate,style:'solid'}]
    input.edges=edges
    for(let i=0;i<40;i++){
      edges.push({source:1,target:2})
      routes.push({points:path([[100+i,100],[100+i,110]]),style:'solid'})
    }
    const basis=measuredRouteContactPairBudget(input)
    let remaining=250-basis*40-candidate.length-40,stopped=false
    const charge=(amount:number)=>{
      expect(stopped).toBe(false)
      remaining-=amount
      if(remaining<0)stopped=true
      return !stopped
    }
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input,charge,undefined,undefined,basis)).toBe(0)
    expect(remaining).toBeGreaterThanOrEqual(0)
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input)).toBe(0)
    expect(scoreMeasuredRouteCrossings(candidate,0,routes,input,undefined,undefined,undefined,basis,true)).toBe(0)
  })
  test('reports only the exact refused supports in caller-owned witness scratch', () => {
    const {a,b}=cases[0]!,routes=[{points:a,style:'solid'},{points:b,style:'solid'}],witness={candidateSegment:-1,peerIndex:-1,peerSegment:-1}
    expect(scoreMeasuredRouteCrossings(a,0,routes,graph(),undefined,undefined,witness)).toBeUndefined()
    expect(witness).toEqual({candidateSegment:3,peerIndex:1,peerSegment:4})
    witness.candidateSegment=witness.peerIndex=witness.peerSegment=-1
    expect(scoreMeasuredRouteCrossings(a,0,routes,graph(),()=>false,undefined,witness)).toBeUndefined()
    expect(witness).toEqual({candidateSegment:-1,peerIndex:-1,peerSegment:-1})
  })
  test('keeps subnormal offset signs under exact served-decimal authority', () => {
    // Exact a+W/2=1.49e-322 lies below b=1.5e-322. Binary
    // subtraction has the opposite sign and its relative error underflows.
    const width=2.1e-322,a=path([[-1,0],[4.4e-323,0],[4.4e-323,1]]),b=path([[1.5e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:b,style:'solid'}],graph(width))).toBe(0)
    // A real low offset 0 versus high offset +W/2 also reverses binary
    // sign: exact 2.1e-322 < 1.1e-322 + 2.03e-322/2.
    const tinyJoin=path([[-1,0],[1.1e-322,0],[1.1e-322,1]]),tinyStrip=path([[2.1e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(tinyJoin,0,[{points:tinyJoin,style:'solid'},{points:tinyStrip,style:'solid'}],graph(2.03e-322))).toBeUndefined()
    const overlap=path([[1.4e-322,-5e-323],[1,-5e-323]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:overlap,style:'solid'}],graph(width))).toBeUndefined()
  })
  test('retains ordinary proper crossings through collinear subdivision and real common terminals', () => {
    const input = graph(), horizontal = path([[0, 5], [5, 5], [10, 5]]), vertical = path([[5, 0], [5, 10]])
    expect(scoreMeasuredRouteCrossings(horizontal, 0, [{ points: horizontal, style: 'solid' }, { points: vertical, style: 'solid' }], input)).toBe(1)
    const a = path([[0, 0], [10, 0]]), b = path([[0, 0], [0, -10]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph(1, 0, true))).toBe(0)
    const bent = path([[0, 0], [10, 0], [10, 10]]), separated = path([[30, 20], [40, 20]])
    expect(scoreMeasuredRouteCrossings(bent, 0, [{ points: bent, style: 'solid' }, { points: separated, style: 'solid' }], input)).toBe(0)
  })
  test('uses exact served cardinality for raw drift and rechecks the resulting parallel ink', () => {
    const a=path([[1000.0000000000001,0],[1000,10]]),far=path([[1020,0],[1020,10]]),input=graph()
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:far,style:'solid'}],input)).toBe(0)
    const overlapping=path([[1000.4,2],[1000.4,8]])
    expect(scoreMeasuredRouteCrossings(a,0,[{points:a,style:'solid'},{points:overlapping,style:'solid'}],input)).toBeUndefined()
    const stillDiagonal=path([[1000.0001,0],[1000,10]])
    expect(scoreMeasuredRouteCrossings(stillDiagonal,0,[{points:stillDiagonal,style:'solid'},{points:far,style:'solid'}],input)).toBeUndefined()
  })
  test('does not borrow a cardinal support bound for an acute diagonal miter', () => {
    // The actual 120-degree miter reaches x=sqrt(3)/2, beyond the
    // width-sized raw-path separation from the peer at x=1.2.
    const a=path([[-10,0],[0,0],[-5,8.660254037844386]]),b=path([[1.2,-2],[1.2,2]]),input=graph(),routes=[{points:a,style:'solid'},{points:b,style:'solid'}]
    expect(scoreMeasuredRouteCrossings(a,0,routes,input)).toBeUndefined()
    expect(scoreMeasuredRouteCrossings(b,1,routes,input)).toBeUndefined()
    const owned = createOwnedMeasuredRouteContactValidator(routes, input)
    if (typeof owned !== 'function') throw new Error('expected owned scorer')
    expect(owned(0)).toBe(false)
  })
  test('does not claim sharp join authority for absent or rounded geometry metadata', () => {
    const { a, b } = cases[0]!, routes = [{ points: a, style: 'solid' }, { points: b, style: 'solid' }]
    const unknown = graph(); delete unknown.maximumEdgeBendRadius
    expect(scoreMeasuredRouteCrossings(a, 0, routes, unknown)).toBe(0)
    expect(scoreMeasuredRouteCrossings(a, 0, routes, graph(1, 8))).toBe(0)
  })
  test('compares half-width offsets as exact served decimals at a nonbinary boundary', () => {
    // The writer preserves W (eleven fractional digits). Its exact half is
    // 9.234567890105; formatting the DERIVED half would change it to 9.23456789011.
    const width = 18.46913578021, a = path([[-40, 0], [0, 0], [0, 40]]), b = path([[width, -40], [width, -1]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph(width))).toBe(0)
    const shifted = path([[18.4691357802, -40], [18.4691357802, -1]])
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: shifted, style: 'solid' }], graph(width))).toBeUndefined()
  })
  test('does not let a raw metric miss excuse a contact created by actual SVG spelling', () => {
    const a = path([[-10, 1000], [1.0000000000001, 1000], [1.0000000000001, 1010]]), b = path([[1, 990], [1, 999.9999999999999]])
    // Served endpoints both become (1,1000): the positive corner/strip
    // intersection is [1,1.5] x [999.5,1000], not a proper interior crossing.
    expect(scoreMeasuredRouteCrossings(a, 0, [{ points: a, style: 'solid' }, { points: b, style: 'solid' }], graph())).toBeUndefined()
  })
  test('owned final traversal preserves every physical rejection and exact decimal boundary', () => {
    for(const {a,b} of cases){
      const routes=[{points:a,style:'solid'},{points:b,style:'solid'}],input=graph()
      const owned=createOwnedMeasuredRouteContactValidator(routes,input)
      expect(typeof owned).toBe('function')
      if(typeof owned!=='function')throw new Error('expected owned scorer')
      expect(owned(0)).toBe(scoreMeasuredRouteCrossings(a,0,routes,input)!==undefined)
    }
    // Round-trip multiplication is NOT an exact decimal coefficient proof.
    // 65536.1*1e11 is6553610000000001, although the served coefficient ends0.
    for(const [left,right,width,expected] of [[65536,65536.1,0.10000000001,undefined],[65536.1,65536.2,0.1,0],[0.2,0.3,0.1,0],[1000000000000.2,1000000000000.3,0.10001,undefined]] as const){
      const a=path([[left,0],[left,20]]),b=path([[right,2],[right,18]]),routes=[{points:a,style:'solid'},{points:b,style:'solid'}],input=graph(width)
      const owned=createOwnedMeasuredRouteContactValidator(routes,input)
      if(typeof owned!=='function')throw new Error('expected owned scorer')
      expect(owned(0)).toBe(expected!==undefined)
      expect(scoreMeasuredRouteCrossings(a,0,routes,input)).toBe(expected)
    }
  })
  test('unprepared contact fallback preserves proper crossings and live visibility', () => {
    const routes=Array.from({length:40},(_,i)=>({points:path([[-20,i*10],[20,i*10]]),style:'solid'}))
    routes.push({points:path([[0,-5],[0,405]]),style:'solid'})
    const input=graph();input.edges=routes.map((_,i)=>({source:i*2,target:i*2+1}))
    const owned=createOwnedMeasuredRouteContactValidator(routes,input,undefined,undefined,true)
    if(typeof owned!=='function')throw new Error('expected owned scorer')
    expect(owned(40)).toBe(true)
    expect(scoreMeasuredRouteCrossings(routes[40]!.points,40,routes,input)).toBe(40)
    for(let i=0;i<40;i+=2)routes[i]!.style='invisible'
    expect(owned(40)).toBe(true)
    expect(scoreMeasuredRouteCrossings(routes[40]!.points,40,routes,input)).toBe(20)
  })
  test('owned preparation rejects acute support before pruning and stops immediately on exhausted work', () => {
    const a=path([[-10,0],[0,0],[-5,8.660254037844386]]),far=path([[1000,0],[1000,20]])
    const acute=createOwnedMeasuredRouteContactValidator([{points:a,style:'solid'},{points:far,style:'solid'}],graph())
    expect(typeof acute==='function'?acute(0):acute).toBe(false)
    for(const candidate of [path([[0,0],[10,0],[10,20]]),path([[1000.0000000000001,0],[1000,10],[1010,10]])]){
      const routes=[{points:candidate,style:'solid'},{points:path([[40,0],[40,20]]),style:'solid'}],input=graph()
      let used=0
      const pay=(n:number)=>{used+=n}
      const complete=createOwnedMeasuredRouteContactValidator(routes,input,pay,pay,true)
      if(typeof complete!=='function')throw new Error('expected owned scorer')
      expect(complete(0)).toBe(true)
      let left=used-1,stopped=false
      const limited=(n:number)=>{if(stopped)throw new Error('visited after exhausted debit');left-=n;if(left<0){stopped=true;return false}return true}
      const bounded=createOwnedMeasuredRouteContactValidator(routes,input,limited,limited,true)
      expect(typeof bounded==='function'?bounded(0):bounded).not.toBe(true)
      expect(stopped).toBe(true)
    }

  })

  test('canonical numeric seeds retain logical crossing counts, subdivision and exact boundaries', () => {
    const seed=(routes:readonly {points:Point[];style:string}[])=>{
      const rows=routes.map(route=>({raw:route.points.map(p=>({...p})),points:route.points.map(p=>({x:Number(formatSvgNumber(p.x)),y:Number(formatSvgNumber(p.y))}))}))
      const horizontal:Array<{key:number;piece:{owner:number;segment:number}}>=[],vertical:typeof horizontal=[],horizontalEnds:typeof horizontal=[],verticalEnds:typeof horizontal=[]
      rows.forEach((row,owner)=>{for(let segment=0;segment+1<row.points.length;segment++){
        const a=row.points[segment]!,b=row.points[segment+1]!
        const piece={owner,segment}
        ;(a.x===b.x?vertical:horizontal).push({key:a.x===b.x?a.x:a.y,piece})
        ;(a.x===b.x?verticalEnds:horizontalEnds).push({key:a.x===b.x?a.y:a.x,piece},{key:a.x===b.x?b.y:b.x,piece})
      }})
      for(const entries of [horizontal,vertical,horizontalEnds,verticalEnds])entries.sort((a,b)=>a.key-b.key||a.piece.owner-b.piece.owner||a.piece.segment-b.piece.segment)
      return {routes:rows,horizontal,vertical,horizontalEnds,verticalEnds}
    }
    const samples=[...cases.map(({a,b,width})=>({a,b,width,expected:undefined})),
      {a:path([[0,5],[5,5],[10,5]]),b:path([[5,0],[5,10]]),width:1,expected:1},
      {a:path([[0,0],[100,0]]),b:path([[0.005,-10],[0.005,10]]),width:1,expected:undefined},
      {a:path([[0.005,0.005],[0.1,0.005],[0.1,1],[-1,1],[-1,0],[1,0]]),b:path([[0,-2],[0,2]]),width:1e-5,expected:undefined},
      {a:path([[0,0],[100,0]]),b:path([[0.005,-10],[0.005,10]]),width:1e-5,expected:undefined},
      {a:path([[65536,0],[65536,20]]),b:path([[65536.1,2],[65536.1,18]]),width:0.10000000001,expected:undefined},
      {a:path([[65536.1,0],[65536.1,20]]),b:path([[65536.2,2],[65536.2,18]]),width:0.1,expected:0},
      {a:path([[0,0],[20,0],[20,10],[0,10],[0,20],[20,20]]),b:path([[10,-5],[10,25]]),width:1,expected:3},
      // Actual served cardinal crossing, with an ELK-sized raw ULP drift.
      // The generic raw-axis helper remains conservative; CONTACT now proves
      // THIS raw and served support pair using the shared crossing primitive.
      {a:path([[1000.0000000000001,0],[1000,10]]),b:path([[990,8.9],[1010,8.9]]),width:1,expected:undefined,admitted:true},
      {a:path([[1000.0000000000001,0],[1000,10]]),b:path([[990,9.995],[1010,9.995]]),width:1,expected:undefined,admitted:false},
      {a:path([[1000.0000000000001,0],[1000,8.9]]),b:path([[990,8.9],[1010,8.9]]),width:1,expected:undefined,admitted:false},
      // A proper strip crossing never excuses the positive outer quarter.
      {a:path([[1000.0000000000001,0],[1000,10],[1010,10]]),b:path([[990,9.75],[1020,9.75]]),width:1,expected:undefined,admitted:false}]
    for(const sample of samples)for(const reverse of [false,true]){
      const {a,b,width,expected}=sample
      const routes=[{points:reverse?a.slice().reverse():a,style:'solid'},{points:reverse?b.slice().reverse():b,style:'solid'}],input=graph(width)
      if(reverse)input.edges=input.edges.map(edge=>({...edge,source:edge.target,target:edge.source}))
      expect(scoreMeasuredRouteCrossings(routes[0]!.points,0,routes,input)).toBe(expected)
      for(const prepared of [seed(routes),undefined]){
        const validate=createOwnedMeasuredRouteContactValidator(routes,input,undefined,undefined,true,prepared)
        if(typeof validate!=='function')throw new Error('expected contact validator')
        expect(validate(0)).toBe('admitted' in sample?sample.admitted===true:expected!==undefined)
      }
    }
  })

})


function separatedDrawing() {
  const edges = Array.from({ length: 12 }, (_, index) => ({ source: index * 2, target: index * 2 + 1, minSpan: 1 }))
  return {
    input: { nodes: Array.from({ length: 24 }, (_, index) => ({ id: `node-${index}`, width: 10, height: 10 })), edges,
      direction: 'TB', padding: 20, nodeSpacing: 20, layerSpacing: 40 },
    placed: { topology: 'layered', width: 1200, height: 100,
      nodes: Array.from({ length: 24 }, () => ({ x: 0, y: 0 })),
      edges: edges.map((_, index) => ({ points: [
        { x: index * 100, y: 0 }, { x: index * 100 + 10, y: 0 }, { x: index * 100 + 10, y: 10 },
        { x: index * 100 + 20, y: 10 }, { x: index * 100 + 20, y: 20 }, { x: index * 100 + 30, y: 20 },
      ] })) },
  }
}

describe('shared route crossing boundaries', () => {
  test.each([
    { name: 'half-pixel vertical shaft', kind: 'vertical', offset: .5 },
    { name: 'over-half-pixel vertical separation', kind: 'vertical', offset: .500001 },
    { name: 'half-pixel horizontal shaft', kind: 'horizontal', offset: .5 },
    { name: 'over-half-pixel horizontal separation', kind: 'horizontal', offset: .500001 },
    { name: 'endpoint T contact', kind: 'touch' },
    { name: 'proper crossing', kind: 'cross' },
    { name: 'diagonal peer fallback', kind: 'diagonal' },
    { name: 'nonfinite peer fallback', kind: 'nonfinite' },
    { name: 'diagonal candidate fallback', kind: 'candidate-diagonal' },
    { name: 'nonfinite candidate fallback', kind: 'candidate-nonfinite' },
    { name: 'overflowed finite gap fallback', kind: 'overflow' },
  ])('preserves the exact scorer for $name', ({ kind, offset }) => {
    const { input, placed } = separatedDrawing()
    if (kind === 'vertical' || kind === 'horizontal') {
      placed.edges[0]!.points = Array.from({ length: 6 }, (_, index) => kind === 'vertical' ? { x: 0, y: index * 10 } : { x: index * 10, y: 0 })
      placed.edges[1]!.points = placed.edges[0]!.points.map(point => kind === 'vertical' ? { ...point, x: offset! } : { ...point, y: offset! })
    } else if (kind === 'touch' || kind === 'cross') {
      placed.edges[1]!.points = [{ x: 5, y: kind === 'touch' ? 0 : -10 }, { x: 5, y: 5 }]
    } else if (kind === 'diagonal') placed.edges[1]!.points = [{ x: 100, y: 0 }, { x: 110, y: 5 }]
    else if (kind === 'nonfinite') placed.edges[1]!.points = [{ x: NaN, y: 0 }, { x: NaN, y: 10 }]
    else if (kind === 'candidate-diagonal') placed.edges[0]!.points[1] = { x: 10, y: 5 }
    else if (kind === 'candidate-nonfinite') placed.edges[0]!.points[1] = { x: NaN, y: 0 }
    else {
      placed.edges[0]!.points = placed.edges[0]!.points.map(point => ({ ...point, x: -1e308 }))
      placed.edges[1]!.points = [{ x: 1e308, y: 0 }, { x: 1e308, y: 10 }]
    }
    const routes = placed.edges.map(route => ({ ...route, style: 'solid' })), original = structuredClone({ input, placed, routes })
    const score = scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, input), crossings = countPolylineCrossings(placed.edges)
    // No physical-width metadata was supplied: this is the legacy crossing
    // metric, not final painted-route admission. Separated and malformed
    // remote peers add no crossing; T/half-pixel contacts are refused.
    const expected = offset === .5 || kind === 'touch' ? undefined : kind === 'cross' ? 1 : 0
    expect(score).toBe(expected)
    expect(crossings).toBe(kind === 'cross' ? 1 : 0)
    expect({ input, placed, routes }).toEqual(original)
  })

})


// These witnesses came from the retired Native marker seater. Their surviving
// owner is the shared contact scorer used by final Class physical admission.
describe('written parallel support witnesses', () => {
  const point = (x: number, y: number) => ({ x, y })
  const score = (a: Point, b: Point, c: Point, d: Point, width = 1) => {
    const routes = [{ points: [a, b], style: 'solid' }, { points: [c, d], style: 'solid' }]
    return scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, {
      edges: [{ source: 0, target: 1 }, { source: 2, target: 3 }], maximumEdgeStrokeWidth: width,
    })
  }
  test.each([false, true])('rejects actual width1 .74346 support overlap, transpose=%s', transpose => {
    const p = (x: number, y: number) => transpose ? point(y, x) : point(x, y)
    expect(score(p(1804.82254011, 900.5), p(1804.82254011, 929.5625), p(1805.566, 915.5), p(1805.566, 960.5))).toBeUndefined()
  })
  test('distinguishes zero measure from tiny positive served overlap', () => {
    expect(score(point(0, 0), point(0, 10), point(1, 2), point(1, 8))).toBe(0)
    // The right writer rounds to1; the left preserves1e-17. The exact served
    // gap1-1e-17 is less than width1, unlike the literal0-to1 boundary.
    expect(score(point(.00000000000000001, 0), point(.00000000000000001, 10), point(1.0000000000000002, 2), point(1.0000000000000002, 8))).toBeUndefined()
    expect(score(point(0, 0), point(0, 10), point(.25, 10), point(.25, 20))).toBe(0)
  })
  for (const transpose of [false, true]) for (const row of [
    { left: 1000000000000.2, right: 1000000000000.3, width: .10001, overlap: true },
    { left: 1000000000000.1, right: 1000000000000.2, width: .1, overlap: false },
  ]) test(`uses exact served decimal gap at large coordinates ${transpose}/${row.width}`, () => {
    // Both written gaps are exactly0.1. Binary subtraction gives .10009765625
    // and .0999755859375 respectively, neither of which describes the ink.
    const p = (x: number, y: number) => transpose ? point(y, x) : point(x, y)
    expect(score(p(row.left, 0), p(row.left, 10), p(row.right, 2), p(row.right, 8), row.width)).toBe(row.overlap ? undefined : 0)
    expect(writtenCoordinateGapLessThan(formatSvgNumber(row.left), formatSvgNumber(row.right), formatSvgNumber(row.width))).toBe(row.overlap)
  })
  test('retains a proper perpendicular crossing as one crossing', () => {
    expect(score(point(0, 5), point(10, 5), point(5, 0), point(5, 10))).toBe(1)
  })
  test('checks longitudinal endpoint collapse after canonical spelling', () => {
    expect(score(point(0, 0), point(0, 1000.1234567891), point(.5, 1000.1234567890999), point(.5, 1001))).toBe(0)
    expect(score(point(0, 0), point(0, 1000.1234567890999), point(.5, 1000.1234567891), point(.5, 1001))).toBeUndefined()
  })
  test('propagates the original exact-decimal capacity failure', () => {
    const error = new Error('original capacity')
    let caught: unknown
    try {
      writtenCoordinateGapLessThan('0.00000000000000001', '1', '1', undefined, () => { throw error })
    } catch (value) { caught = value }
    expect(caught).toBe(error)
  })
})

describe('far miter rejection before any marker repair', () => {
  for (const transpose of [false, true]) for (const reverse of [false, true]) for (const unmarked of [false, true]) {
    test(`retains the exact refused peer transpose=${transpose} reverse=${reverse} unmarked=${unmarked}`, () => {
      const point = (p: Point): Point => transpose ? { x: p.y, y: p.x } : { ...p }
      const routes = [
        { points: [{ x: 200, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 80 }, { x: 60, y: 80 }, { x: 60, y: 120 }, { x: 20, y: 120 }].map(point), labelPosition: point(unmarked ? { x: 60, y: 100 } : { x: 80, y: 80 }), style: 'solid' },
        { points: [{ x: 200, y: 60 }, { x: 140, y: 60 }, { x: 140, y: 120.8 }, { x: 60, y: 120.8 }, { x: 60, y: 140 }, { x: 20, y: 140 }].map(point), labelPosition: point(unmarked ? { x: 140, y: 100 } : { x: 100, y: 120.8 }), style: 'solid' },
      ]
      if (reverse) for (const route of routes) route.points.reverse()
      const input: MeasuredRouteGraph = {
        edges: [{ source: reverse ? 2 : 0, target: reverse ? 0 : 2 }, { source: reverse ? 2 : 1, target: reverse ? 1 : 2 }],
        maximumEdgeStrokeWidth: 1, maximumEdgeBendRadius: 0,
      }
      const original = structuredClone({ input, routes })
      // A's outer quarter is x60..60.5,y120..120.5; B's width1 shaft is
      // y120.3..121.3. Their positive overlap is0.1, independent of seating.
      expect(Math.min(120.5, 121.3) - Math.max(120, 120.3)).toBeGreaterThan(0)
      const witness = { candidateSegment: -1, peerIndex: -1, peerSegment: -1 }
      expect(scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, input, undefined, undefined, witness)).toBeUndefined()
      expect(witness.peerIndex).toBe(1)
      const owned = createOwnedMeasuredRouteContactValidator(routes, input)
      if (typeof owned !== 'function') throw new Error('expected owned scorer')
      expect(owned(0)).toBe(false)
      expect({ input, routes }).toEqual(original)
    })
  }
})
