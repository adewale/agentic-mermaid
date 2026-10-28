import { describe, expect, test } from 'bun:test'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import type { Point, PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'
import { assessLayout, onShapeOutline } from '../layout-rubric.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { resolveRenderStyle } from '../styles.ts'
import { graphEdgeMarkerPaintRegions } from '../graph-connectors.ts'
import { equalizePeerNodeDimensions } from '../layout/passes/peers.ts'
import { alignPortLaneCandidate } from '../layout/passes/port-lanes.ts'

const C_FIVE_WAY_FAN_IN = `flowchart TD
  Web[Web App] --> Gateway
  Mobile[Mobile App] --> Gateway
  CLI[CLI Tool] --> Gateway
  Partner[Partner API] --> Gateway
  Cron[Cron Jobs] --> Gateway
  Gateway --> Auth[Auth Service]`

const D_DISPATCHER_FAN_OUT = `flowchart TD
  Dispatcher --> Email[Email Worker]
  Dispatcher --> SMS[SMS Worker]
  Dispatcher --> Push[Push Worker]
  Dispatcher --> Webhook[Webhook Worker]`

const M_DENSE_BUNDLES = `flowchart TD
  A["AAA<br>(keita)"] --> C["CCC"]
  B["BBB<br>(yuriko)"] --> C
  C --> D["DDDD"]
  D --> E["EEEE"]
  A1["1 / 2"] --> A
  A2["3 / 4"] --> A
  A3["5 / 6"] --> A
  A4["XXX<br>(YYY ZZZ)"] --> A
  B1["77 77<br>(7 / 7 / 7)"] --> B
  B2["88-88<br>(99 99)"] --> B
  B3["111s 222s"] --> B
  D --> F{"F?"}
  F -->|Yes| G["High level<br>Tr"]
  F -->|No| H["Dumb Tr<br>S"]`

const N_DENSE_LABELS = `flowchart TD
  Z[Start] -->|long 1| A[Alpha]
  Z -->|long 2| A
  A -->|3| B[Beta]
  A -->|4| B
  B -->|5| C[Gamma]
  B -->|6| D[Delta]
  C -->|7| D
  D -->|8| E[End]
  B -->|9| A
  C -->|10| A
  D -->|11| A
  B -->|12| B
  C -->|13| B
  D -->|14| B
  C -->|18| C
  D -->|21| D`

const P_TERMINAL_FAN_OUT = `flowchart TD
  Source[Source] --> Left[Left]
  Source --> Mid[Middle]
  Source --> Right[Right]`

const Q_RECIPROCAL_PEER_MERGE_FAN_OUT = `flowchart TD
  A[A] --> C[C]
  B[B] --> C
  C --> D[D]
  C --> E[E]
  D --> F[F]
  E --> F`

const PEER_COUNTS = [2, 3, 4, 5, 6] as const

function peerIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`)
}

function peerFanOut(count: number): string {
  return `flowchart TD
  Hub[Hub]
${peerIds(count).map(id => `  Hub --> ${id}[Peer]`).join('\n')}`
}

function peerFanIn(count: number): string {
  return `flowchart TD
${peerIds(count).map(id => `  ${id}[Peer] --> Hub[Hub]`).join('\n')}
  Hub --> Tail[Tail]`
}

const MIXED_DIRECTIONS = ['TD', 'BT', 'LR', 'RL'] as const

describe('labeled decision duplicates (#373)', () => {
  test.each(MIXED_DIRECTIONS.flatMap(direction => ['A[Start] --> D', 'D --> C'].map(neighbor => [direction, neighbor] as const)))('%s separates labels without crossing %s', (direction, neighbor) => {
    const source = `flowchart ${direction}\nC{Verify} -->|ok| D[View]\nC -->|warnings| D\n${neighbor}`
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    const [first, second] = positioned.edges
    expect(assessLayout(graph, positioned).metrics.edgeCrossings).toBe(0)
    expect(first!.points).not.toEqual(second!.points)
    const style = resolveRenderStyle({})
    const sizes = positioned.edges.slice(0, 2).map(edge => measureMultilineText(edge.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight))
    const dx = Math.abs(first!.labelPosition!.x - second!.labelPosition!.x)
    const dy = Math.abs(first!.labelPosition!.y - second!.labelPosition!.y)
    expect(dx > (sizes[0]!.width + sizes[1]!.width) / 2 + 16 || dy > (sizes[0]!.height + sizes[1]!.height) / 2 + 16).toBe(true)
    for (const edge of positioned.edges) {
      expect(onShapeOutline(node(positioned, edge.source), edge.points[0]!)).toBe(true)
      expect(onShapeOutline(node(positioned, edge.target), edge.points.at(-1)!)).toBe(true)
    }
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
  })

  test.each([...MIXED_DIRECTIONS])('%s keeps both labels on separate outline-anchored lanes', direction => {
    const source = `flowchart ${direction}\nC{Verify} -->|ok| D[View]\nC -->|warnings| D`
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    const decision = node(positioned, 'C')
    const target = node(positioned, 'D')
    const [first, second] = positioned.edges
    const cross = direction === 'LR' || direction === 'RL' ? 'y' : 'x'
    const style = resolveRenderStyle({})
    const labelSizes = positioned.edges.map(edge => measureMultilineText(edge.label!, style.edgeLabelFontSize, style.edgeLabelFontWeight))
    const size = cross === 'y' ? 'height' : 'width'
    const separation = second!.labelPosition![cross] - first!.labelPosition![cross]
    expect(separation).toBeGreaterThan((labelSizes[0]![size] + labelSizes[1]![size]) / 2 + 16)
    expect(first!.points).not.toEqual(second!.points)
    for (const edge of positioned.edges) {
      expect(onShapeOutline(decision, edge.points[0]!)).toBe(true)
      expect(onShapeOutline(target, edge.points.at(-1)!)).toBe(true)
    }
    const metrics = assessLayout(graph, positioned).metrics
    expect(metrics.edgeCrossings).toBe(0)
    expect(metrics.labelOffRoute).toBe(0)
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'ROUTE_LABEL_ON_SHARED_TRUNK')).toEqual([])
    expect(layoutGraphSync(graph)).toEqual(positioned)
  })
})

// A non-terminal hub that receives from `n` incoming peers and fans out to `m`
// outgoing peers — the mixed fan-in/fan-out class from issue #61.
function mixedHub(n: number, m: number, dir: string): string {
  const lines = [`flowchart ${dir}`]
  for (let i = 0; i < n; i++) lines.push(`  I${i}[In ${i}] --> H[Hub]`)
  for (let j = 0; j < m; j++) lines.push(`  H --> O${j}[Out ${j}]`)
  return lines.join('\n')
}

function layout(source: string): PositionedGraph {
  return layoutGraphSync(parseMermaid(source))
}

function node(g: PositionedGraph, id: string): PositionedNode {
  const n = g.nodes.find(n => n.id === id)
  if (!n) throw new Error(`node ${id} not found`)
  return n
}

function edge(g: PositionedGraph, source: string, target: string, label?: string): PositionedEdge {
  const e = g.edges.find(e => e.source === source && e.target === target && (label === undefined || e.label === label))
  if (!e) throw new Error(`edge ${source}->${target}${label ? ` ${label}` : ''} not found`)
  return e
}

function cx(n: PositionedNode): number { return n.x + n.width / 2 }
function cy(n: PositionedNode): number { return n.y + n.height / 2 }
function barycenter(nodes: PositionedNode[]): number {
  return nodes.reduce((sum, n) => sum + cx(n), 0) / nodes.length
}
// Cross-axis center: x for vertical layouts (TD/BT), y for horizontal (LR/RL).
function crossOf(n: PositionedNode, dir: string): number {
  return dir === 'LR' || dir === 'RL' ? cy(n) : cx(n)
}
function crossBarycenter(nodes: PositionedNode[], dir: string): number {
  return nodes.reduce((sum, n) => sum + crossOf(n, dir), 0) / nodes.length
}
// Worst cross-axis offset of the hub from either peer barycenter — the
// peerBarycenterDelta from issue #61, measured on a single mixed hub.
function mixedHubDelta(g: PositionedGraph, n: number, m: number, dir: string): number {
  const hub = crossOf(node(g, 'H'), dir)
  const ins = Array.from({ length: n }, (_, i) => node(g, `I${i}`))
  const outs = Array.from({ length: m }, (_, j) => node(g, `O${j}`))
  return Math.max(Math.abs(hub - crossBarycenter(ins, dir)), Math.abs(hub - crossBarycenter(outs, dir)))
}
function close(a: number, b: number, tolerance = 0.75): void { expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance) }
function pkey(p: Point): string { return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }
function isVertical(e: PositionedEdge): boolean { return e.points.length === 2 && Math.abs(e.points[0]!.x - e.points[1]!.x) <= 0.75 }
function equalSize(nodes: PositionedNode[]): void {
  const first = nodes[0]!
  for (const n of nodes.slice(1)) {
    close(n.width, first.width)
    close(n.height, first.height)
  }
}

describe('layout symmetry floor', () => {
  test.each(['TD', 'BT', 'LR', 'RL'] as const)('%s hub centering keeps a fixed straight feeder rather than creating a diagonal', direction => {
    const project = ({x,y}:Point):Point => direction==='TD'?{x,y}:direction==='BT'?{x,y:300-y}:direction==='LR'?{x:y,y:x}:{x:300-y,y:x}
    const box = (id:string,x:number,y:number,width:number,height:number,shape:PositionedNode['shape']='rectangle'):PositionedNode => {
      const a=project({x,y}),b=project({x:x+width,y:y+height})
      return {id,label:id,shape,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)}
    }
    const originalNodes=[box('A',0,0,40,30),box('B',100,0,40,30),box('C',204,0,40,30),box('H',110,120,20,20,'circle'),box('D',100,200,40,30)]
    const edge=(source:string,target:string,points:number[][]):PositionedEdge=>({source,target,style:'solid',hasArrowStart:false,hasArrowEnd:true,points:points.map(([x,y])=>project({x:x!,y:y!}))})
    const originalEdges=[edge('A','H',[[20,30],[20,80],[113,80],[113,120]]),edge('B','H',[[120,30],[120,120]]),edge('C','H',[[224,30],[224,80],[127,80],[127,120]]),edge('H','D',[[120,140],[120,200]])]
    for(const mode of ['valid','served-ulp','off-center','allocated','diagonal'] as const){
      const nodes=structuredClone(originalNodes),edges=structuredClone(originalEdges)
      if(mode==='diagonal')edges[1]!.points[1]=project({x:119,y:120})
      if(mode==='served-ulp')edges[1]!.points[0]=project({x:120.00000000000001,y:30})
      if(mode==='off-center'){
        nodes.find(n=>n.id==='H')!.shape='rectangle'
        edges[1]!.points=[project({x:119.5,y:30}),project({x:119.5,y:120})]
      }
      if(mode==='allocated'){
        nodes[1]=box('B',102,0,40,30)
        nodes.find(n=>n.id==='H')!.shape='rectangle'
        // The fixed S/N/E/W face is valid at x120 but its midpoint is x122.
        // This existing side allocation cannot be replaced by default ports.
        edges[1]!.routeCertificate={edgeIndex:1,routeClass:'primary-forward',bendCount:0,invariant:'straight',sourcePortAssignment:{side:direction==='TD'?'S':direction==='BT'?'N':direction==='LR'?'E':'W',slotIndex:0,slotCount:1,role:'flow-source'}}
        // A separate fixed backward lane prevents a different source slide
        // from obscuring the hub-allocation obligation under test.
        nodes.push(box('E',102,-70,40,30));edges.push(edge('B','E',[[122,0],[122,-40]]))
        expect(onShapeOutline(nodes[1]!,edges[1]!.points[0]!)).toBe(true)
      }
      const beforeNodes=structuredClone(nodes),beforeEdges=structuredClone(edges)
      alignPortLaneCandidate(nodes,edges,[],direction,resolveRenderStyle())
      // Already-diagonal input retains the established repair path.
      if(mode==='diagonal')expect(nodes.find(n=>n.id==='H')).not.toEqual(beforeNodes.find(n=>n.id==='H'))
      else{
        expect(nodes,mode).toEqual(beforeNodes);expect(edges,mode).toEqual(beforeEdges)
        if(mode!=='served-ulp')for(const e of edges)for(let i=1;i<e.points.length;i++)expect(e.points[i-1]!.x===e.points[i]!.x||e.points[i-1]!.y===e.points[i]!.y).toBe(true)
      }
    }
  })
  for (const count of PEER_COUNTS) {
    test(`${count}-way rectangle fan-out centers the hub over its peer barycenter`, () => {
      const g = layout(peerFanOut(count))
      const peers = peerIds(count).map(id => node(g, id))
      equalSize(peers)
      close(cx(node(g, 'Hub')), barycenter(peers))
    })

    test(`${count}-way rectangle fan-in centers the hub over its peer barycenter`, () => {
      const g = layout(peerFanIn(count))
      const peers = peerIds(count).map(id => node(g, id))
      equalSize(peers)
      close(cx(node(g, 'Hub')), barycenter(peers))
    })
  }

  test('high-degree equivalent fan-in stays centered and keeps its owned continuation straight', () => {
    const g = layout(C_FIVE_WAY_FAN_IN)
    const sources = ['Web', 'Mobile', 'CLI', 'Partner', 'Cron'].map(id => node(g, id))
    equalSize(sources)
    const gateway = node(g, 'Gateway')
    const auth = node(g, 'Auth')
    const sourceBarycenter = sources.reduce((sum, n) => sum + cx(n), 0) / sources.length
    close(cx(gateway), sourceBarycenter)
    close(cx(auth), sourceBarycenter)
    expect(isVertical(edge(g, 'Gateway', 'Auth'))).toBe(true)
  })

  test('high-degree rectangle fan-out keeps a shared trunk instead of drawing a box', () => {
    const g = layout(D_DISPATCHER_FAN_OUT)
    const targets = ['Email', 'SMS', 'Push', 'Webhook'].map(id => node(g, id))
    equalSize(targets)
    const dispatcher = node(g, 'Dispatcher')
    close(cx(dispatcher), barycenter(targets))
    const exits = g.edges.map(e => pkey(e.points[0]!))
    const trunks = g.edges.map(e => pkey(e.points[1]!))
    expect(new Set(exits).size).toBe(1)
    expect(new Set(trunks).size).toBe(1)
    close(edge(g, 'Dispatcher', 'Email').points[0]!.x, barycenter(targets))
  })

  test('non-terminal peer groups center through fan-in and fan-out chains', () => {
    const g = layout(Q_RECIPROCAL_PEER_MERGE_FAN_OUT)
    const a = node(g, 'A')
    const b = node(g, 'B')
    const c = node(g, 'C')
    const d = node(g, 'D')
    const e = node(g, 'E')
    const f = node(g, 'F')
    equalSize([a, b, c, d, e, f])
    close(cx(c), barycenter([a, b]))
    close(cx(c), barycenter([d, e]))
    close(cx(f), barycenter([d, e]))
  })

  test('small terminal peer fan-out uses symmetric source emissions and equal target boxes', () => {
    const g = layout(P_TERMINAL_FAN_OUT)
    const source = node(g, 'Source')
    const left = node(g, 'Left')
    const mid = node(g, 'Mid')
    const right = node(g, 'Right')
    equalSize([left, mid, right])
    close(cx(mid), cx(source))
    close(cx(source) - cx(left), cx(right) - cx(source))
    const leftEdge = edge(g, 'Source', 'Left')
    const midEdge = edge(g, 'Source', 'Mid')
    const rightEdge = edge(g, 'Source', 'Right')
    close(midEdge.points[0]!.x, cx(source))
    close(cx(source) - leftEdge.points[0]!.x, rightEdge.points[0]!.x - cx(source))
    expect(new Set([leftEdge, midEdge, rightEdge].map(e => pkey(e.points[0]!))).size).toBe(3)
  })

  test('repeated peer groups equalize dimensions and owned chains do not gain doglegs', () => {
    const g = layout(M_DENSE_BUNDLES)
    equalSize(['A1', 'A2', 'A3', 'A4'].map(id => node(g, id)))
    equalSize(['B1', 'B2', 'B3'].map(id => node(g, id)))
    expect(isVertical(edge(g, 'C', 'D'))).toBe(true)

    const f = node(g, 'F')
    const yes = edge(g, 'F', 'G', 'Yes')
    const no = edge(g, 'F', 'H', 'No')
    close(cx(f) - yes.points[0]!.x, no.points[0]!.x - cx(f))
    close(cx(f) - cx(node(g, 'G')), cx(node(g, 'H')) - cx(f))
  })

  test.each([1, 4])('peer widening preserves the painted label and marker corridor at line width %s', lineWidth => {
    const source = `flowchart RL
S0["a longer label goes here"] --> H["hub"]
U0_0["ok"] --> S0
U0_1["same word ok"] --> U0_0
U0_2["a longer label goes here"] -->|a longer label goes here| U0_1
S1["x"] --> H
S2["errors"] --> H
U2_0["a longer label goes here"] -->|ok| S2
U2_1["x"] -->|same word ok| U2_0
H --> T["t"]`
    const options = { styleFace: { edge: { lineWidth } } }
    const style = resolveRenderStyle(options)
    expect(style.lineWidth).toBe(lineWidth)
    const positioned = layoutGraphSync(parseMermaid(source), options)
    const route = edge(positioned, 'U2_0', 'S2')
    const text = route.labelBlock!
    const padding = 8 + Math.max(4, lineWidth * 2)
    const label = {
      x0: route.labelPosition!.x - text.width / 2 - padding,
      x1: route.labelPosition!.x + text.width / 2 + padding,
      y0: route.labelPosition!.y - text.height / 2 - padding,
      y1: route.labelPosition!.y + text.height / 2 + padding,
    }
    const overlap = (a: typeof label, b: typeof label): boolean =>
      Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)
    for (const endpoint of [node(positioned, route.source), node(positioned, route.target)]) {
      expect(overlap(label, { x0: endpoint.x, x1: endpoint.x + endpoint.width, y0: endpoint.y, y1: endpoint.y + endpoint.height })).toBe(false)
    }
    const from = node(positioned, route.source)
    for (const marker of graphEdgeMarkerPaintRegions(route, style)) {
      expect(marker.bounds).toBeDefined()
      expect(overlap(label, marker.bounds!)).toBe(false)
      expect(overlap(marker.bounds!, { x0: from.x, x1: from.x + from.width, y0: from.y, y1: from.y + from.height })).toBe(false)
    }
  })

  test.each([
    { sourceX: 105, labelX: undefined, accept: false },
    { sourceX: 110, labelX: 85, accept: false },
    { sourceX: 150, labelX: 128, accept: true },
    { sourceX: 150, labelX: undefined, packOnly: true, accept: false },
  ])('peer resize and packing preserve existing paint or restore the entire proposal: %j', ({ sourceX, labelX, packOnly, accept }) => {
    const graph = parseMermaid(`flowchart RL\nWide --> Hub\nNarrow --> Hub\nUpstream --> Narrow${packOnly ? '\nPadding\nLeft --> Right' : ''}`)
    const nodes: PositionedNode[] = [
      { id: 'Wide', label: 'Wide', shape: 'rectangle', x: 0, y: 0, width: 100, height: 36 },
      { id: 'Narrow', label: 'Narrow', shape: 'rectangle', x: 0, y: 70, width: 60, height: 36 },
      { id: 'Hub', label: 'Hub', shape: 'rectangle', x: -100, y: 35, width: 60, height: 36 },
      { id: 'Upstream', label: 'Upstream', shape: 'rectangle', x: sourceX, y: 70, width: 60, height: 36 },
    ]
    const edges: PositionedEdge[] = [
      { ...graph.edges[0]!, points: [{ x: 0, y: 18 }, { x: -40, y: 18 }] },
      { ...graph.edges[1]!, points: [{ x: 0, y: 88 }, { x: -40, y: 88 }] },
      { ...graph.edges[2]!, points: [{ x: sourceX, y: 88 }, { x: 60, y: 88 }], ...(labelX === undefined ? {} : { label: 'ok', labelPosition: { x: labelX, y: 88 } }) },
    ]
    if (packOnly) {
      // The resize alone clears this unrelated label. The subsequent pack
      // pushes Narrow down over it, so the whole proposal must roll back.
      nodes.push(
        { id: 'Padding', label: 'Padding', shape: 'rectangle', x: 0, y: 55, width: 60, height: 36 },
        { id: 'Left', label: 'Left', shape: 'rectangle', x: 110, y: 122, width: 60, height: 36 },
        { id: 'Right', label: 'Right', shape: 'rectangle', x: -100, y: 122, width: 60, height: 36 },
      )
      edges.push({ ...graph.edges[3]!, points: [{ x: 110, y: 140 }, { x: -40, y: 140 }], label: 'ok', labelPosition: { x: 85, y: 140 } })
    }
    const before = structuredClone(nodes)
    const edgeBefore = structuredClone(edges)
    equalizePeerNodeDimensions(nodes, edges, [], graph, resolveRenderStyle({}))
    if (accept) {
      expect(nodes.find(n => n.id === 'Narrow')!.width).toBe(100)
      expect(nodes.find(n => n.id === 'Narrow')!.y).toBe(60)
    } else expect(nodes).toEqual(before)
    expect(edges).toEqual(edgeBefore)
  })

  test('dense parallel labels preserve authored routes without buying outer symmetry with crossings', () => {
    const g = layout(N_DENSE_LABELS)
    const z = node(g, 'Z')
    const a = node(g, 'A')
    const left = edge(g, 'Z', 'A', 'long 1')
    const right = edge(g, 'Z', 'A', 'long 2')
    expect(g.edges).toHaveLength(16)
    expect([left.label, right.label]).toEqual(['long 1', 'long 2'])
    expect(left.points).not.toEqual(right.points)
    expect(onShapeOutline(z, left.points[0]!)).toBe(true)
    expect(onShapeOutline(a, left.points.at(-1)!)).toBe(true)
    expect(onShapeOutline(z, right.points[0]!)).toBe(true)
    expect(onShapeOutline(a, right.points.at(-1)!)).toBe(true)
    // The symmetric outer proposal raises this fixture's crossings from2 to3.
    // Keeping distinct inner lanes lets the final router reduce that count to1.
    const { metrics } = assessLayout(parseMermaid(N_DENSE_LABELS), g)
    expect(metrics.edgeCrossings).toBeLessThanOrEqual(1)
    expect(metrics.labelOffRoute).toBe(0)
    expect(new Set([left, right].map(e => pkey(e.points[0]!))).size).toBe(2)
  })
})

// Issue #61: a non-terminal hub that both receives from a peer group and fans
// out to another peer group must be centered with BOTH sides in view, not by
// whichever centering pass writes last.
describe('mixed fan-in/fan-out hub centering', () => {
  for (const dir of MIXED_DIRECTIONS) {
    // Every mixed hub — small (2–3) or large (4–6) terminal fan-out — must end
    // centered on BOTH peer barycenters within 0.75px. The incoming side (which
    // has no re-spread pass) anchors the hub; the terminal fan-out is re-spread
    // symmetrically around it by applySymmetricFanoutEmissions, so neither side
    // is left off. This replaces the earlier ~4px "midpoint floor" the hub used
    // to settle at when both sides were anchored and disagreed (issue #61).
    for (let n = 2; n <= 6; n++) for (let m = 2; m <= 6; m++) {
      test(`${dir} ${n}-in/${m}-out hub centers on both peer barycenters`, () => {
        expect(mixedHubDelta(layout(mixedHub(n, m, dir)), n, m, dir)).toBeLessThanOrEqual(0.75)
      })
    }
  }

  test('mixed hub placement is deterministic across repeated layouts', () => {
    for (const dir of MIXED_DIRECTIONS) {
      const a = layout(mixedHub(4, 6, dir))
      const b = layout(mixedHub(4, 6, dir))
      expect(node(a, 'H').x).toBe(node(b, 'H').x)
      expect(node(a, 'H').y).toBe(node(b, 'H').y)
    }
  })
})
