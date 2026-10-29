import { finalizeFlatMeasuredMarkers } from '../layout/compound-boundary-routes.ts'
import { classMarkerPieces, classMarkerResources } from '../class/relationship-paint.ts'
import { classMarkerPiecesOverlap } from '../layout/measured-marker-overlap.ts'
import type { ResolvedRenderStyle } from '../styles.ts'
import { layoutAgenticGraph } from '../layout/agentic-layered.ts'
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createMeasuredLayoutCache, layoutLayeredGraph } from '../layout/agentic-producer-core.ts'
import { layoutMeasuredForest } from '../layout/measured-forest.ts'
import type { AgenticLayout, MeasuredGraph } from '../layout/agentic-layered-core.ts'
import { createMermaidRenderer, renderMermaidSVGWithReceipt } from '../index.ts'
import { withPerformanceExperiments, type PerformanceExperiment } from '../experimental-performance.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const measured = (): MeasuredGraph => ({
  nodes: ['a', 'b', 'c', 'd'].map(id => ({ id, width: 80, height: 32 })),
  edges: [{ source: 0, target: 1, minSpan: 1, label: { width: 50, height: 16 } },
    { source: 1, target: 2, minSpan: 1 }, { source: 2, target: 0, minSpan: 1 }],
  direction: 'TB', padding: 30, nodeSpacing: 40, layerSpacing: 60,
})
const compute = (input: MeasuredGraph): AgenticLayout => layoutLayeredGraph(input, layoutMeasuredForest, reason => { throw new Error(reason) })

describe('native measured geometry reuse', () => {
  test('replays the selected order after a comment edit and rechecks changed style maps and host metrics', () => {
    const source = readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-15.mmd', import.meta.url), 'utf8')
    const options = { graphLayout: { backend: 'agentic' as const }, nodeSpacing: 73 }
    const observe = (value: string, render = renderMermaidSVGWithReceipt, flags: readonly PerformanceExperiment[] = ['text-spans']) => {
      let placements = 0
      const rendered = withPerformanceExperiments(flags, () => withRenderStageObserver(sample => {
        if (sample.stage === 'agentic') placements++
      }, () => render(value, options)))
      return { placements, rendered }
    }
    const first = observe(source), edited = observe(source + '\n%% reviewed')
    expect(first.placements).toBeGreaterThan(1)
    expect(edited.placements).toBe(1)
    expect(edited.rendered.svg).toBe(first.rendered.svg)
    expect(edited.rendered.receipt.layoutDecisions).toEqual(first.rendered.receipt.layoutDecisions)
    expect(edited.rendered.receipt.layoutCertification).toEqual(first.rendered.receipt.layoutCertification)
    expect(edited.rendered.receipt.requestDigest).not.toBe(first.rendered.receipt.requestDigest)
    for (const flags of [[], ['text-spans', 'indexed-layout'], ['text-spans', 'position-cache']] as const) {
      const transparent = observe(source + '\n%% transparent ' + flags.join(','), renderMermaidSVGWithReceipt, flags)
      expect(transparent.placements).toBe(1)
      expect(transparent.rendered.svg).toBe(first.rendered.svg)
    }
    for (const style of ['style n0 stroke-width:4px', 'linkStyle default stroke-width:4px']) {
      const changed = source + '\n' + style
      expect(observe(changed).placements).toBeGreaterThan(1)
      expect(observe(changed + '\n%% reviewed').placements).toBe(1)
    }
    const textMeasurement = { id: 'test:native-order', version: '1.0.0', measure: ({ text, fontSize }: { text: string; fontSize: number }) => text.length * fontSize * .55 }
    const host = createMermaidRenderer({ textMeasurement })
    expect(observe(source, host.renderMermaidSVGWithReceipt).placements).toBeGreaterThan(1)
    expect(observe(source + '\n%% profiled', host.renderMermaidSVGWithReceipt).placements).toBeGreaterThan(1)
  })

  test('reattaches current authored text and execution receipts after an edit of equal-size cards', () => {
    const options = { graphLayout: { backend: 'agentic' as const } }
    const first = renderMermaidSVGWithReceipt('flowchart TB\n A[Cat] --> B[Pet]', options)
    const edited = renderMermaidSVGWithReceipt('flowchart TB\n A[Dog] --> B[Pet]', options)
    expect(first.svg).toContain('Cat')
    expect(edited.svg).toContain('Dog')
    expect(edited.svg).not.toContain('Cat')
    expect(edited.receipt.layoutDecisions).toEqual(first.receipt.layoutDecisions)
    expect(edited.receipt.layoutDecisions?.[0]?.selected).toBe('agentic')
  })

  test.each(['cycle', 'compound', 'shared fan'])('isolates cached %s geometry from caller mutations', kind => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    let graph = measured()
    if (kind === 'compound') graph = { ...graph,
      nodes: graph.nodes.map(node => ({ ...node, parent: 0 })),
      groups: [{ id: 'scope', minWidth: 200, padding: { top: 40, right: 20, bottom: 20, left: 20 } }],
    }
    if (kind === 'shared fan') graph = { ...graph, shareCompleteFans: true,
      edges: [0, 1].flatMap(source => [2, 3].map(target => ({ source, target, minSpan: 1 }))),
    }
    const first = cached(graph), expected = structuredClone(first)
    first.nodes[0]!.x = 99999
    first.edges[0]!.points[0]!.y = -99999
    if (first.edges[0]!.labelPosition) first.edges[0]!.labelPosition!.x = 99999
    if (first.groups) first.groups[0]!.width = 99999
    if (first.sharedEdges) (first.sharedEdges as number[]).push(99999)
    const second = cached(structuredClone(graph))
    expect(calls).toBe(1)
    expect(second).toEqual(expected)
    second.edges[0]!.points.push({ x: -1, y: -1 })
    expect(cached(graph)).toEqual(expected)
    expect(calls).toBe(1)
  })

  test('includes measured constraints and private solver options and never retains failed computations', () => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    const graph = measured()
    cached(graph)
    const variants: MeasuredGraph[] = [
      { ...graph, direction: 'LR' }, { ...graph, nodeSpacing: 41 }, { ...graph, layerSpacing: 61 },
      { ...graph, compactPrivateRanks: true }, { ...graph, authoredCycleOrder: true },
      { ...graph, nodes: graph.nodes.map((node, i) => i ? node : { ...node, width: 81 }) },
      { ...graph, edges: graph.edges.map((edge, i) => i ? edge : { ...edge, label: { width: 51, height: 16 } }) },
      { ...graph, edges: graph.edges.map((edge, i) => i ? edge : { ...edge, minSpan: 2 }) },
    ]
    for (const variant of variants) expect(cached(variant)).toEqual(compute(variant))
    expect(calls).toBe(1 + variants.length)
    for (const width of [NaN, Infinity, -Infinity, 0]) {
      const invalid = { ...graph, nodes: graph.nodes.map((node, i) => i ? node : { ...node, width }) }
      expect(() => cached(invalid)).toThrow()
      expect(() => cached(invalid)).toThrow()
    }
    expect(calls).toBe(1 + variants.length + 8)
    expect(cached(graph)).toEqual(compute(graph))
    expect(calls).toBe(1 + variants.length + 8)
  })

  test('evicts old measured graphs while preserving recent caller-owned geometry', () => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) })
    const graphs = Array.from({ length: 65 }, (_, index) => {
      const graph = measured()
      return { ...graph, nodes: graph.nodes.map((node, position) => position ? node : { ...node, id: `item${index}` }) }
    })
    for (const graph of graphs) cached(graph)
    const recent = cached(graphs.at(-1)!)
    expect(calls).toBe(65)
    expect(recent).toEqual(compute(graphs.at(-1)!))
    expect(cached(graphs[0]!)).toEqual(compute(graphs[0]!))
    expect(calls).toBe(66)
  })

  test.each(['0', '1'])('honors the common startup cache switch %s', setting => {
    const child = Bun.spawnSync([process.execPath, '-e', `
      const { createMeasuredLayoutCache } = await import('./src/layout/agentic-producer-core.ts')
      let calls = 0
      const cached = createMeasuredLayoutCache(() => { calls++; return { topology: 'layered', width: 0, height: 0, nodes: [], edges: [] } })
      const graph = { nodes: [], edges: [], direction: 'TB', padding: 0, nodeSpacing: 0, layerSpacing: 0 }
      cached(graph); cached(graph)
      console.log(calls)
    `], { cwd: resolve(import.meta.dir, '../..'), env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: setting }, stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString().trim()).toBe(setting === '0' ? '2' : '1')
  })
})

describe('measured physical metadata dependencies', () => {
const base=()=>({nodes:[{id:'A',width:20,height:20,paintStrokeWidth:1},{id:'B',width:20,height:20,paintStrokeWidth:1}],edges:[{source:0,target:1,minSpan:1,markerPaint:{start:[{kind:'circle' as const,cx:6,cy:0,r:3}]}}],direction:'TD' as const,padding:4,nodeSpacing:4,layerSpacing:8})
for(const kind of ['marker','node','group','corner'])test(`measured admission rejects invalid ${kind} physical metadata`,()=>{
 const input:any=base()
 if(kind==='marker')input.edges[0].markerPaint.start[0].r=NaN
 if(kind==='node')input.nodes[0].paintStrokeWidth=Infinity
 if(kind==='corner')input.nodes[0].paintCornerRadius=-1
 if(kind==='group')input.groups=[{id:'G',minWidth:20,padding:{top:10,right:5,bottom:5,left:5},paintStrokeWidth:0}]
 expect(()=>layoutAgenticGraph(input)).toThrow(TypeError)
})
test('full measured cache owns marker and node/group physical metadata edits and cloned results',()=>{
 let calls=0
 const cached=createMeasuredLayoutCache((input:any)=>{calls++;return {topology:'layered' as const,width:input.edges[0].markerPaint.start[0].r,height:input.nodes[0].paintStrokeWidth,nodes:[{x:0,y:0},{x:1,y:1}],edges:[{points:[{x:0,y:0},{x:1,y:0}]}]}})
 const input:any=base(),first=cached(input);first.edges[0]!.points[0]!.x=999
 expect(cached(input).edges[0]!.points[0]!.x).toBe(0);expect(calls).toBe(1)
 input.edges[0].markerPaint.start[0].r=4;expect(cached(input).width).toBe(4);expect(calls).toBe(2)
 input.nodes[0].paintStrokeWidth=8;expect(cached(input).height).toBe(8);expect(calls).toBe(3)
 input.groups=[{id:'G',paintStrokeWidth:2}];cached(input);expect(calls).toBe(4)
 input.groups[0].paintStrokeWidth=3;cached(input);expect(calls).toBe(5)
 input.nodes[0].paintCornerRadius=3;cached(input);expect(calls).toBe(6)
 input.nodes[0].paintCornerRadius=9;cached(input);expect(calls).toBe(7)
})
test('actual rounded-carrier metadata is admitted only as finite nonnegative geometry',()=>{
 for(const value of [NaN,Infinity,-1])expect(()=>layoutAgenticGraph({...base(),maximumEdgeBendRadius:value})).toThrow(TypeError)
})

})

describe('flat measured marker finalization', () => {
  const fail = (reason: string): never => { throw new Error(reason) }
  const scene = (): AgenticLayout => ({ topology:'forest',width:200,height:170,nodes:[{x:80,y:0},{x:150,y:70},{x:150,y:120}],edges:[{points:[{x:100,y:20},{x:120,y:20},{x:120,y:80},{x:150,y:80}]},{points:[{x:100,y:24},{x:130,y:24},{x:130,y:130},{x:150,y:130}]}] })
  const graph = (): MeasuredGraph => {
    const resources = classMarkerResources({lineWidth:1} as ResolvedRenderStyle)
    const aggregation = resources.find(marker=>marker.id==='cls-aggregation')!, inheritance=resources.find(marker=>marker.id==='cls-inherit')!
    return {nodes:[{id:'hub',width:20,height:100,paintStrokeWidth:1},{id:'upper',width:20,height:20,paintStrokeWidth:1},{id:'lower',width:20,height:20,paintStrokeWidth:1}],edges:[{source:0,target:1,minSpan:1,markerPaint:{start:classMarkerPieces(aggregation,{x:0,y:0},{x:1,y:0},'start',1)}},{source:0,target:2,minSpan:1,markerPaint:{start:classMarkerPieces(inheritance,{x:0,y:0},{x:1,y:0},'start',1)}}],direction:'LR',padding:0,nodeSpacing:1,layerSpacing:1,maximumEdgeStrokeWidth:1}
  }
  const pieces = (input:MeasuredGraph,placed:AgenticLayout,index:number) => {
    const resource=classMarkerResources({lineWidth:1} as ResolvedRenderStyle).find(marker=>marker.id===(index?'cls-inherit':'cls-aggregation'))!,path=placed.edges[index]!.points
    return classMarkerPieces(resource,path[0]!,{x:path[1]!.x-path[0]!.x,y:path[1]!.y-path[0]!.y},'start',input.maximumEdgeStrokeWidth!)
  }
  test('closes actual flat glyph loss on the raw producer ledger before cache/shortening',()=>{
    const input=graph(),raw=scene(),before=structuredClone(raw),work={pairs:60000,arcs:12000,swaps:1000000}
    // The earlier diamond bottom vertex (106,25) is inside the later white
    // triangle at x106, whose vertical section is y21.5..26.5.
    expect(classMarkerPiecesOverlap(pieces(input,raw,0),pieces(input,raw,1))).toBe(true)
    const placed=layoutLayeredGraph(input,()=>{work.pairs-=777;return raw},fail,work)
    expect(classMarkerPiecesOverlap(pieces(input,placed,0),pieces(input,placed,1))).toBe(false)
    expect(placed.edges.some((edge,index)=>JSON.stringify(edge.points)!==JSON.stringify(before.edges[index]!.points))).toBe(true)
    expect(placed.boundaryRoutes).toEqual([0,1])
    expect(work.pairs).toBeLessThan(60000-777);expect(work.pairs).toBeGreaterThan(0);expect(work.arcs).toBeLessThan(12000)
  })
  test('a spent raw request reserve propagates without a fresh finalizer budget',()=>{
    const error=new Error('original request capacity'),work={pairs:60000,arcs:0,swaps:1000000},raw=scene(),before=structuredClone(raw)
    expect(()=>layoutLayeredGraph(graph(),()=>{work.pairs-=777;return raw},()=>{throw error},work)).toThrow(error)
    expect(work.arcs).toBeLessThan(0);expect(work.pairs).toBeLessThan(60000-777);expect(raw).toEqual(before)
  })
  test.each(['placement only','absent paint'])('keeps %s outside marker finalization',kind=>{
    const input=graph(),raw=scene(),before=structuredClone(raw)
    if(kind==='placement only')input.placementOnly=true
    else{delete input.maximumEdgeStrokeWidth;for(const edge of input.edges)delete edge.markerPaint}
    const placed=layoutLayeredGraph(input,()=>raw,fail)
    expect(placed.boundaryRoutes).toBeUndefined()
    if(kind==='placement only')expect(placed.edges).toEqual(before.edges)
  })
  test.each(['body', 'normal', 'fixed label'])('rejects a raw flat %s violation before declaring full closure',kind=>{
    const input=graph(),raw=scene()
    // Separate valid glyph poses so each failure exercises the complete path
    // proof, independently of whether seating has a proposal to make.
    raw.edges[1]!.points=[{x:100,y:60},{x:130,y:60},{x:130,y:130},{x:150,y:130}]
    if(kind==='body')raw.edges[0]!.points=[{x:100,y:20},{x:160,y:20},{x:160,y:80},{x:150,y:80}]
    if(kind==='normal')raw.edges[0]!.points=[{x:90,y:20},{x:120,y:20},{x:120,y:80},{x:150,y:80}]
    if(kind==='fixed label'){input.edges=input.edges.map((edge,index)=>index?edge:{...edge,label:{width:4,height:4}});raw.edges[0]!.labelPosition={x:110,y:40}}
    expect(()=>layoutLayeredGraph(input,()=>raw,fail)).toThrow()
  })
  test.each(['duplicate','reversal'])('compacts only identical flat ink while retaining a real %s distinction',kind=>{
    const input=graph(),raw=scene();raw.edges[1]!.points=[{x:100,y:60},{x:130,y:60},{x:130,y:130},{x:150,y:130}]
    const original=structuredClone(raw.edges[0]!.points)
    if(kind==='duplicate'){raw.edges[0]!.points.splice(2,0,{...raw.edges[0]!.points[1]!});const placed=layoutLayeredGraph(input,()=>raw,fail);expect(placed.edges[0]!.points).toEqual(original)}
    else{raw.edges[0]!.points=[{x:100,y:20},{x:120,y:20},{x:110,y:20},{x:110,y:80},{x:150,y:80}];const before=structuredClone(raw.edges[0]!.points);expect(()=>layoutLayeredGraph(input,()=>raw,fail)).toThrow();expect(raw.edges[0]!.points).toEqual(before)}
  })
  test.each([0.1+0.2,0.30000001])('restores a reflected endpoint only when its actual SVG spelling is identical: %s',bottom=>{
    const input:MeasuredGraph={nodes:[{id:'A',width:1,height:.3},{id:'B',width:1,height:.3}],edges:[{source:0,target:1,minSpan:1,markerPaint:{start:[{kind:'circle',cx:.02,cy:0,r:.001}]}}],direction:'TB',padding:1,nodeSpacing:1,layerSpacing:1,maximumEdgeStrokeWidth:.001}
    const raw:AgenticLayout={topology:'forest',width:5,height:5,nodes:[{x:1,y:0},{x:1,y:3}],edges:[{points:[{x:1.5,y:bottom},{x:1.5,y:3}]}]}
    if(bottom===0.1+0.2){const placed=finalizeFlatMeasuredMarkers(input,raw,{pairs:1_000_000,arcs:65536,swaps:1_000_000},32768,fail);expect(placed.edges[0]!.points[0]!.y).toBe(.3)}
    else expect(()=>finalizeFlatMeasuredMarkers(input,raw,{pairs:1_000_000,arcs:65536,swaps:1_000_000},32768,fail)).toThrow()
  })
  test('preserves a real loop caption beside its shaft while closing all routes',()=>{
    const input=graph(),raw=scene()
    input.edges=[...input.edges,{source:0,target:0,minSpan:1,label:{width:4,height:4}}]
    raw.edges.push({points:[{x:100,y:60},{x:140,y:60},{x:140,y:110},{x:60,y:110},{x:60,y:60},{x:80,y:60}],labelPosition:{x:145,y:85}})
    const placed=finalizeFlatMeasuredMarkers(input,raw,{pairs:1_000_000,arcs:65536,swaps:1_000_000},32768,fail)
    expect(placed.edges[2]!.labelPosition).toEqual({x:145,y:85})
    expect(placed.edges[2]!.points).toEqual(raw.edges[2]!.points)
    expect(placed.boundaryRoutes).toEqual([0,1,2])
  })
  test('cache clones the closed geometry and invalidates changed marker measurements',()=>{
    let calls=0;const input=graph(),cached=createMeasuredLayoutCache(measured=>{calls++;return layoutLayeredGraph(measured,scene,fail)})
    const first=cached(input),expected=structuredClone(first);expect(first.boundaryRoutes).toEqual([0,1]);first.edges[0]!.points[0]!.x=999;(first.boundaryRoutes as number[])[0]=99
    expect(cached(input)).toEqual(expected);expect(calls).toBe(1)
    input.edges[0]!.markerPaint!.start=[{kind:'circle',cx:0,cy:0,r:100}]
    expect(()=>cached(input)).toThrow();expect(calls).toBe(2)
  })
})


describe('measured primary port pitch',()=>{
  test.each(['LR','RL','TD','BT'] as const)('uses the reserved %s face capacity instead of reclustering ports eight pixels apart',direction=>{
    const horizontal=direction==='LR'||direction==='RL'
    const input:MeasuredGraph={nodes:[{id:'A',width:horizontal?20:100,height:horizontal?100:20},...['B','C','D'].map(id=>({id,width:horizontal?20:1,height:horizontal?1:20}))],edges:[1,2,3].map(target=>({source:0,target,minSpan:1})),direction,padding:0,nodeSpacing:0,layerSpacing:40}
    const before=structuredClone(input),old=layoutLayeredGraph(input,()=>undefined,reason=>{throw new Error(reason)})
    const reserved=layoutLayeredGraph({...input,nodes:input.nodes.map((node,index)=>index?node:{...node,minimumPortSpacing:20})},()=>undefined,reason=>{throw new Error(reason)})
    const spans=(placed:AgenticLayout)=>placed.edges.map(edge=>horizontal?edge.points[0]!.y:edge.points[0]!.x).sort((a,b)=>a-b)
    const original=spans(old),current=spans(reserved)
    expect(original[1]!-original[0]!).toBe(8)
    expect(current[1]!-current[0]!).toBeGreaterThanOrEqual(20);expect(current[2]!-current[1]!).toBeGreaterThanOrEqual(20)
    expect(input).toEqual(before)
  })
  test.each([0,NaN,Infinity])('rejects invalid physical port spacing %s',value=>{
    const input=measured();input.nodes=input.nodes.map((node,index)=>index?node:{...node,minimumPortSpacing:value})
    expect(()=>compute(input)).toThrow(TypeError)
  })
  test('includes port-pitch mutations in the full measured cache key',()=>{
    let calls=0;const cached=createMeasuredLayoutCache(input=>{calls++;return compute(input)}),input=measured()
    cached(input);input.nodes=input.nodes.map((node,index)=>index?node:{...node,minimumPortSpacing:16});cached(input)
    expect(calls).toBe(2)
  })
})
