
import { describe, expect, test } from 'bun:test'
import { assertFinalBoundaryContacts, createBoundaryContactValidator } from '../layout/compound-boundary-routes.ts'
import type { AgenticLayout, MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { countPolylineCrossings } from '../shared/edge-crossings.ts'
import { scoreMeasuredRouteCrossings } from '../layout/measured-route-safety.ts'

const fail = (reason: string): never => { throw new Error(reason) }
const work = (pairs = 1_000_000) => ({ pairs, arcs: 65536, swaps: 1_000_000 })

function drawing(): { input: MeasuredGraph; placed: AgenticLayout } {
  return {
    input: { nodes: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index}`, width: 10, height: 10 })),
      edges: [{ source: 0, target: 1, minSpan: 1 }, { source: 2, target: 3, minSpan: 1 }, { source: 4, target: 5, minSpan: 1 }],
      direction: 'TB', padding: 20, nodeSpacing: 20, layerSpacing: 40 },
    placed: { topology: 'layered', width: 140, height: 160,
      nodes: [{ x: 40, y: 65 }, { x: 90, y: 65 }, { x: 65, y: 40 }, { x: 65, y: 110 }, { x: 40, y: 85 }, { x: 90, y: 85 }],
      edges: [
        { points: [{ x: 50, y: 70 }, { x: 90, y: 70 }] },
        { points: [{ x: 70, y: 50 }, { x: 70, y: 110 }] },
        { points: [{ x: 50, y: 90 }, { x: 90, y: 90 }] },
      ] },
  }
}

function separatedDrawing(): { input: MeasuredGraph; placed: AgenticLayout } {
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

describe('final compound route contact closure', () => {
  test('proves separated route pairs within a tight candidate reserve without changing exact scores', () => {
    const { input, placed } = separatedDrawing(), routes = placed.edges.map(route => ({ ...route, style: 'solid' }))
    const original = structuredClone({ input, routes }), reserve = work(850)
    const score = scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, input)
    expect(score).toBe(0)
    expect(createBoundaryContactValidator(input, 0, routes, reserve, fail)(routes[0]!.points)).toBe(true)
    expect(reserve.pairs).toBeGreaterThanOrEqual(0)
    expect(scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, input)).toBe(score)
    expect({ input, routes }).toEqual(original)
  })

  test('closes separated final routes within a tight reserve while retaining the published crossing metric', () => {
    const { input, placed } = separatedDrawing(), original = structuredClone({ input, placed }), reserve = work(1800)
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    assertFinalBoundaryContacts(input, placed, new Set(input.edges.map((_, index) => index)), reserve, fail)
    expect(reserve.pairs).toBeGreaterThanOrEqual(0)
    expect(countPolylineCrossings(placed.edges)).toBe(0)
    expect({ input, placed }).toEqual(original)
  })

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
    if (offset === .5 || kind === 'touch') expect(score).toBeUndefined()
    if (kind === 'cross') expect(score).toBe(1)
    const accept = createBoundaryContactValidator(input, 0, routes, work(), fail)
    expect(accept(routes[0]!.points)).toBe(score !== undefined)
    if (score === undefined) expect(() => assertFinalBoundaryContacts(input, placed, new Set([0]), work(), fail)).toThrow('uncertified shared contact')
    else assertFinalBoundaryContacts(input, placed, new Set([0]), work(), fail)
    expect(scoreMeasuredRouteCrossings(routes[0]!.points, 0, routes, input)).toBe(score)
    expect(countPolylineCrossings(placed.edges)).toBe(crossings)
    expect({ input, placed, routes }).toEqual(original)
  })

  test('charges bounds metadata once and rebuilds it for a new peer geometry revision', () => {
    const { input, placed } = separatedDrawing(), routes = placed.edges.map(route => ({ ...route, style: 'solid' })), reserve = work()
    const accept = createBoundaryContactValidator(input, 0, routes, reserve, fail)
    expect(accept(routes[0]!.points)).toBe(true)
    expect(65536 - reserve.arcs).toBe(2 * routes.length + routes.length - 1 + 1)
    const retained = reserve.arcs
    expect(accept(routes[0]!.points)).toBe(true)
    expect(reserve.arcs).toBe(retained)
    routes[1] = { points: routes[0]!.points.map(point => ({ ...point })), style: 'solid' }
    expect(createBoundaryContactValidator(input, 0, routes, work(), fail)(routes[0]!.points)).toBe(false)
  })

  test('checks all visible final pairs within one reserve without changing exact crossing metrics', () => {
    const { input, placed } = drawing(), original = structuredClone({ input, placed })
    const reserve = work(65)
    expect(countPolylineCrossings(placed.edges)).toBe(2)
    assertFinalBoundaryContacts(input, placed, new Set([0, 1, 2]), reserve, fail)
    expect(reserve.pairs).toBeGreaterThan(0)
    expect(countPolylineCrossings(placed.edges)).toBe(2)
    expect({ input, placed }).toEqual(original)
  })

  test('hidden pending shafts retain metadata without spending visible pair proof', () => {
    const { input, placed } = drawing()
    const routes = placed.edges.map(route => ({ ...route, style: 'solid' }))
    routes[2] = { style: 'invisible', points: Array.from({ length: 1000 }, (_, i) => ({ x: i, y: i % 2 })) }
    const reserve = work(20)
    const accept = createBoundaryContactValidator(input, 0, routes, reserve, fail)
    expect(accept(routes[0]!.points)).toBe(true)
    expect(reserve.pairs).toBeGreaterThan(0)
    routes[2] = { style: 'solid', points: [{ x: 80, y: 70 }, { x: 80, y: 110 }] }
    const late = createBoundaryContactValidator(input, 0, routes, work(), fail)
    expect(late(routes[0]!.points)).toBe(false)
  })

  test.each([
    { name: 'future rescue T contact', rescued: [0, 1, 2], shaft: false },
    { name: 'later primary T contact', rescued: [0], shaft: false },
    { name: 'shared shaft', rescued: [2], shaft: true },
    { name: 'invisible rescue retains earlier visible peers', rescued: [0, 2], shaft: false, invisible: true },
  ])('rejects $name after all routes are finalized', ({ rescued, shaft, invisible }) => {
    const { input, placed } = drawing()
    placed.edges[2]!.points = shaft ? [{ x: 60, y: 70 }, { x: 80, y: 70 }] : [{ x: 80, y: 70 }, { x: 80, y: 110 }]
    if (invisible) input.edges[2]!.visible = false
    expect(() => assertFinalBoundaryContacts(input, placed, new Set(rescued), work(), fail)).toThrow('uncertified shared contact')
  })
})

describe('already executed final current-scene proofs', () => {
const fail=(s:string):never=>{throw new Error(s)},work=(pairs=1000000)=>({pairs,arcs:65536,swaps:1000000})
const point=(x:number,y:number)=>({x,y}),input=(count:number)=>({nodes:Array.from({length:2*count},(_,i)=>({id:'N'+i,width:10,height:10})),edges:Array.from({length:count},(_,i)=>({source:2*i,target:2*i+1,minSpan:1})),direction:'TB' as const,padding:0,nodeSpacing:1,layerSpacing:1})
const placed=(routes:any[])=>({topology:'layered' as const,width:100,height:100,nodes:[],edges:routes.map(points=>({points}))})
test('retained executed full current proofs close their pairs without spending the reserve twice',()=>{
 const graph=input(2),scene=placed([[point(0,0),point(100,0)],[point(50,-50),point(50,50)]]),budget=work(26)
 const proof=new Set<number>()
 for(let i=0;i<2;i++){
  budget.pairs-=8 // same original coefficient3+candidate/peer/selection metadata
  expect(scoreMeasuredRouteCrossings(scene.edges[i]!.points,i,scene.edges.map(r=>({...r,style:'solid'})),graph)).toBe(1)
  proof.add(i)
 }
 expect(budget.pairs).toBe(10)

 assertFinalBoundaryContacts(graph,scene,new Set([0,1]),budget,fail,proof)
 expect(budget.pairs).toBe(2) // no reset/refund; only the unused final work is absent
})
test('an untouched late T collision is still rejected after unrelated proved routes are masked',()=>{
 const graph=input(3),scene=placed([[point(-30,40),point(-20,40)],[point(5,-10),point(5,10)],[point(0,10),point(5,10)]])
 expect(()=>assertFinalBoundaryContacts(graph,scene,new Set([0,1]),work(),fail,new Set([0]))).toThrow('uncertified shared contact')
})
test.each([false,true])('invisible rescued candidate retains directional checks against visible proved peer (known sharp: %s)',knownSharp=>{
 const graph:any=input(2);graph.edges[1].visible=false
 if(knownSharp){graph.maximumEdgeStrokeWidth=1;graph.maximumEdgeBendRadius=0}
 const scene=placed([[point(0,0),point(10,0)],[point(5,-10),point(5,0)]])
 expect(()=>assertFinalBoundaryContacts(graph,scene,new Set([1]),work(),fail,new Set([0]))).toThrow('uncertified shared contact')
})
test('a nonorthogonal rescued route cannot use a proof-mask shortcut',()=>{
 const graph=input(2),scene=placed([[point(0,0),point(10,0)],[point(0,0),point(10,0),point(11,5)]])
 expect(()=>assertFinalBoundaryContacts(graph,scene,new Set([1]),work(),fail,new Set([0,1]))).toThrow('uncertified shared contact')
})

})
