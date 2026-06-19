import { describe, expect, test } from 'bun:test'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import type { Point, PositionedEdge, PositionedGraph, PositionedNode } from '../types.ts'

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

  test('equivalent parallel labels route on symmetric outer lanes, not neighboring center lines', () => {
    const g = layout(N_DENSE_LABELS)
    const z = node(g, 'Z')
    const a = node(g, 'A')
    const left = edge(g, 'Z', 'A', 'long 1')
    const right = edge(g, 'Z', 'A', 'long 2')
    const minX = Math.min(z.x, a.x)
    const maxX = Math.max(z.x + z.width, a.x + a.width)
    expect(left.labelPosition!.x).toBeLessThan(minX)
    expect(right.labelPosition!.x).toBeGreaterThan(maxX)
    close(left.labelPosition!.y, right.labelPosition!.y)
    expect(new Set([left, right].map(e => pkey(e.points[0]!))).size).toBe(2)
  })
})
