import { SaxesParser } from 'saxes'
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
  test('flat marker closure uses the retained grown body rather than its smaller measured minimum',()=>{
    const input:MeasuredGraph={nodes:[{id:'A',width:1,height:.3,sizePolicy:'minimum'},{id:'B',width:1,height:.3}],edges:[{source:0,target:1,minSpan:1,markerPaint:{start:[{kind:'circle',cx:.02,cy:0,r:.001}]}}],direction:'TB',padding:1,nodeSpacing:1,layerSpacing:1,maximumEdgeStrokeWidth:.001}
    const raw:AgenticLayout={topology:'forest',width:5,height:5,nodes:[{x:1,y:0,width:1,height:.5},{x:1,y:3}],edges:[{points:[{x:1.5,y:.5},{x:1.5,y:3}]}]}
    const placed=finalizeFlatMeasuredMarkers(input,raw,{pairs:1_000_000,arcs:65536,swaps:1_000_000},32768,fail)
    expect(placed.nodes[0]!.height).toBe(.5)
    expect(placed.edges[0]!.points[0]!.y).toBe(.5)
    expect(input.nodes[0]!.height).toBe(.3)
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
  const crowdedSources = [
    { caseId: 201, target: 'n7', source: `flowchart LR
n0((Node 201-0))
n1[[Node 201-1]]
n2[(Node 201-2)]
n3[Node 201-3]
n4{Node 201-4}
n5(Node 201-5)
n6((Node 201-6))
n7[[Node 201-7]]
n8[(Node 201-8)]
n9[Node 201-9]
n10{Node 201-10}
n11(Node 201-11)
n12((Node 201-12))
n13[[Node 201-13]]
n3 -->|edge 0 xxx| n12
n11 --> n0
n6 --> n7
n7 --> n1
n1 -->|edge 4 xxxxxxx| n6
n2 --> n3
n0 --> n2
n12 --> n1
n1 -->|edge 8 xxxxxxxxxxx| n7
n1 --> n0
n10 --> n9
n1 --> n13
n3 -->|edge 12 xxxxxxxxxxxxxxx| n13
n10 --> n9
n13 --> n10
n0 --> n11
n6 -->|edge 16 xxxxxxxxxxxxxxxxxxx| n2
n11 --> n12
n9 --> n10
n9 --> n1
n2 -->|edge 20 xxxxxx| n10
n1 --> n7
n3 --> n7
n5 --> n3
n3 -->|edge 24 xxxxxxxxxx| n12
n9 --> n7
n4 --> n12
n6 --> n3
n12 -->|edge 28 xxxxxxxxxxxxxx| n13
n3 --> n6
n6 --> n7
n2 --> n0
n3 -->|edge 32 xxxxxxxxxxxxxxxxxx| n4` },
    { caseId: 241, target: 'n3', source: `flowchart LR
n0{Node 241-0}
n1(Node 241-1)
n2((Node 241-2))
n3[[Node 241-3]]
n4[(Node 241-4)]
n5[Node 241-5]
n6{Node 241-6}
n7(Node 241-7)
n8((Node 241-8))
n9[[Node 241-9]]
n10[(Node 241-10)]
n11[Node 241-11]
n12{Node 241-12}
n13(Node 241-13)
n14((Node 241-14))
n10 -->|edge 0 xxx| n3
n12 --> n9
n4 --> n2
n8 --> n9
n3 -->|edge 4 xxxxxxx| n14
n11 --> n5
n0 --> n10
n12 --> n14
n3 -->|edge 8 xxxxxxxxxxx| n11
n13 --> n11
n6 --> n5
n11 --> n0
n0 -->|edge 12 xxxxxxxxxxxxxxx| n1
n13 --> n2
n1 --> n4
n3 --> n12
n8 -->|edge 16 xxxxxxxxxxxxxxxxxxx| n6
n8 --> n7
n13 --> n3
n8 --> n9
n2 -->|edge 20 xxxxxx| n3
n3 --> n12
n7 --> n10
n14 --> n2
n10 -->|edge 24 xxxxxxxxxx| n6
n9 --> n10
n5 --> n1
n6 --> n14
n1 -->|edge 28 xxxxxxxxxxxxxx| n10
n9 --> n0
n2 --> n8
n12 --> n13
n12 -->|edge 32 xxxxxxxxxxxxxxxxxx| n11` }
  ]
  const markerCases = crowdedSources.flatMap(fixture => ['LR', 'RL', 'TB', 'BT'].flatMap(direction => {
    return [false, true].map(hidden => ({
      ...fixture, source: fixture.source + (hidden ? `\nn0 ~~~ ${fixture.target}\nn0 ~~~ ${fixture.target}\nn0 ~~~ ${fixture.target}` : ''),
      direction, hidden, backend: 'agentic' as const,
    }))
  })).concat([{ caseId: 353, target: 'n1', direction: 'LR', hidden: false, backend: 'agentic' as const, source: `flowchart LR
n0[(Node 353-0)]
n1[Node 353-1]
n2{Node 353-2}
n3(Node 353-3)
n4((Node 353-4))
n5[[Node 353-5]]
n6[(Node 353-6)]
n7[Node 353-7]
n8{Node 353-8}
n9(Node 353-9)
n3 -->|edge 0 xxx| n4
n7 --> n9
n5 --> n8
n5 --> n0
n7 -->|edge 4 xxxxxxx| n6
n5 --> n3
n7 --> n5
n9 --> n1
n1 -->|edge 8 xxxxxxxxxxx| n5
n7 --> n8
n3 --> n1
n1 --> n2
n1 -->|edge 12 xxxxxxxxxxxxxxx| n4
n7 --> n9
n7 --> n1
n3 --> n9
n9 -->|edge 16 xxxxxxxxxxxxxxxxxxx| n0
n3 --> n4
n9 --> n3
n5 --> n7
n5 -->|edge 20 xxxxxx| n7
n3 --> n1
n3 --> n1` }])
  test.each(markerCases)('keeps ordinary heads distinct on the actual measured face: $caseId / $direction / hidden=$hidden', ({ caseId, source, target, direction, backend, hidden }) => {
    const product = renderMermaidSVGWithReceipt(source.replace('flowchart LR', 'flowchart ' + direction), { graphLayout: { backend, fallback: 'none' }, embedFontImport: false })
    const tags: Array<{ name: string; attrs: Record<string, string>; text: string }> = [], stack: Array<(typeof tags)[number]> = []
    const xml = new SaxesParser({ xmlns: true })
    xml.on('opentag', tag => {
      const item = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(value => [value.name, value.value])), text: '' }
      tags.push(item); stack.push(item)
    })
    xml.on('text', text => { for (const item of stack) item.text += text })
    xml.on('closetag', () => { stack.pop() })
    xml.write(product.svg).close()
    const authored = [...source.matchAll(/^(n\d+) -->(?:\|([^|]+)\|)? (n\d+)$/gm)]
    const carriers = tags.filter(tag => tag.attrs['data-role'] === 'edge' && tag.attrs['data-from'])
    expect(carriers.map(tag => tag.attrs['data-from'] + '->' + tag.attrs['data-to']).sort()).toEqual(authored.map(match => match[1] + '->' + match[3]).sort())
    const names = [...source.matchAll(/Node \d+-\d+/g)].map(match => match[0])
    expect(tags.filter(tag => tag.name === 'text').map(tag => tag.text).sort()).toEqual([...names, ...authored.filter(match => match[2]).map(match => match[2]!)].sort())
    const body = tags.find(tag => tag.name === 'rect' && tag.attrs['data-id'] === 'node-shape:' + target)
    expect(body).toBeDefined()
    if (caseId === 353) expect(Number(body!.attrs.height)).toBeGreaterThanOrEqual(36.9)
    else expect(Number(body!.attrs.height)).toBeCloseTo(36.9, 8)
    const markerVertices = (tag: (typeof tags)[number]) => {
      const points = tag.attrs.points!.split(/\s+/).map(pair => pair.split(',').map(Number))
      const tip = points.at(-1)!, prior = points.at(-2)!
      expect(tip[0] === prior[0] || tip[1] === prior[1]).toBe(true)
      expect(tag.attrs['stroke-width']).toBe('1')
      const resourceId = tag.attrs['marker-end']!.slice(5, -1), resource = tags.filter(tag => tag.name === 'marker' && tag.attrs.id === resourceId)
      expect(resource).toHaveLength(1)
      expect(['markerWidth', 'markerHeight', 'refX', 'refY', 'orient'].map(key => resource[0]!.attrs[key])).toEqual(['8', '5', '8', '2.5', 'auto'])
      const index = tags.indexOf(resource[0]!), polygon = tags[index + 1]!
      expect([polygon.name, polygon.attrs.points, polygon.attrs['stroke-width']]).toEqual(['polygon', '0 0, 8 2.5, 0 5', '0.75'])
      expect(polygon.attrs.fill).not.toBe('none')
      const dx = Math.sign(tip[0]! - prior[0]!), dy = Math.sign(tip[1]! - prior[1]!)
      // Independent actual marker vertices: reference (8,2.5), unit shaft
      // width, cardinal SVG auto orientation. The round stroke adds .375px.
      return [[0, 0], [8, 2.5], [0, 5]].map(([x, y]) => ({ x: tip[0]! + (x! - 8) * dx - (y! - 2.5) * dy, y: tip[1]! + (x! - 8) * dy + (y! - 2.5) * dx }))
    }
    const heads = carriers.filter(tag => tag.attrs['data-to'] === target).map(markerVertices)
    expect(heads).toHaveLength(authored.filter(match => match[3] === target).length)
    expect(heads.length).toBeGreaterThan(1)
    for (let i = 0; i < heads.length; i++) for (const other of heads.slice(i + 1)) {
      const head = heads[i]!
      const axes = [head, other].flatMap(polygon => polygon.map((point, index) => {
        const next = polygon[(index + 1) % polygon.length]!
        return { x: next.y - point.y, y: point.x - next.x }
      }))
      expect(axes.some(axis => {
        const project = (polygon: typeof head) => polygon.map(point => point.x * axis.x + point.y * axis.y)
        const a = project(head), b = project(other), stroke = .75 * Math.hypot(axis.x, axis.y)
        return Math.max(...a) + stroke < Math.min(...b) || Math.max(...b) + stroke < Math.min(...a)
      })).toBe(true)
    }
    if (caseId === 201 && hidden && (direction === 'TB' || direction === 'BT')) {
      const carrier = carriers.find(tag => tag.attrs['data-from'] === 'n5' && tag.attrs['data-to'] === 'n3')!
      const marker = markerVertices(carrier)
      const label = tags.findIndex(tag => tag.name === 'g' && tag.attrs.class === 'edge-label' && tag.attrs['data-from'] === 'n6' && tag.attrs['data-to'] === 'n2')
      const halo = tags[label + 1]!
      expect(halo.attrs.class).toBe('edge-label-halo')
      const x = Number(halo.attrs.x), y = Number(halo.attrs.y), width = Number(halo.attrs.width), height = Number(halo.attrs.height)
      // Actual emitted halo and the marker's round stroke must remain separate.
      expect(Math.max(...marker.map(p => p.x)) + .375 < x || Math.min(...marker.map(p => p.x)) - .375 > x + width
        || Math.max(...marker.map(p => p.y)) + .375 < y || Math.min(...marker.map(p => p.y)) - .375 > y + height).toBe(true)
    }
    expect(product.receipt.layoutCertification?.status).toBe('passed')
  })


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
  test.each(['minimumPortSpacing', 'sourcePortSpan', 'targetPortSpan', 'nodeClearance'] as const)('includes %s mutations in the full measured cache key', field => {
    let calls = 0
    const cached = createMeasuredLayoutCache(input => { calls++; return compute(input) }), input = measured()
    cached(input)
    if (field === 'minimumPortSpacing') input.nodes = input.nodes.map((node, index) => index ? node : { ...node, minimumPortSpacing: 16 })
    else if (field === 'nodeClearance') input.nodeClearance = .75
    else input.edges = input.edges.map((edge, index) => index ? edge : { ...edge, [field]: 5.75 })
    const result = cached(input)
    expect(calls).toBe(2)
    expect(result).toEqual(compute(input))
    expect(cached(input)).toEqual(result)
    expect(calls).toBe(2)
  })
  test.each(['sourcePortSpan', 'targetPortSpan', 'nodeClearance'] as const)('rejects invalid measured %s values', field => {
    for (const value of [-1, NaN, Infinity]) {
      const input = measured()
      if (field === 'nodeClearance') input.nodeClearance = value
      else input.edges = input.edges.map((edge, index) => index ? edge : { ...edge, [field]: value })
      expect(() => compute(input)).toThrow(TypeError)
    }
  })
})
