// Subgraph `direction` support (TODO.md BUILD-12).
//
// Mermaid itself ignores `direction` inside a subgraph whenever any inner
// node links outward (mermaid-js/mermaid#2509, #6438). Our ELK SEPARATE
// hierarchy handling and the ASCII grid layout both honor it; these tests
// pin that differentiator with geometry assertions so layout work cannot
// silently regress it.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, layoutMermaid } from '../agent/index.ts'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../index.ts'
import { terminalDocumentOf } from '../ascii/terminal-document.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout, hardViolations, onShapeOutline } from '../layout-rubric.ts'
import { parseMermaid as parseGraph } from '../parser.ts'

function layoutOf(source: string) {
  const r = parseMermaid(source)
  if (!r.ok) throw new Error('parse failed: ' + JSON.stringify(r.error))
  return layoutMermaid(r.value)
}

function node(layout: ReturnType<typeof layoutOf>, id: string) {
  const n = layout.nodes.find(n => n.id === id)
  if (!n) throw new Error(`node ${id} missing from layout`)
  return n
}

const LR_INSIDE_TD = `flowchart TD
  Start --> Pipeline
  subgraph Pipeline
    direction LR
    Fetch --> Parse --> Transform --> Store
  end
  Pipeline --> Done
`

describe('subgraph direction override (SVG/ELK layout geometry)', () => {
  test('direction LR inside a TD flowchart lays the inner chain out horizontally', () => {
    const layout = layoutOf(LR_INSIDE_TD)
    const chain = ['Fetch', 'Parse', 'Transform', 'Store'].map(id => node(layout, id))
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.x).toBeGreaterThan(chain[i - 1]!.x)
      // Same rank row: vertical centers stay aligned.
      expect(Math.abs(chain[i]!.y - chain[i - 1]!.y)).toBeLessThan(2)
    }
    // The outer flow stays TD.
    expect(node(layout, 'Done').y).toBeGreaterThan(node(layout, 'Start').y)
  })

  test('direction TB inside an LR flowchart survives an external link to an inner node (mermaid#2509 case)', () => {
    const layout = layoutOf(`flowchart LR
  subgraph subgraph2
    direction TB
    top2[top] --> bottom2[bottom]
  end
  outside ---> top2
`)
    const top = node(layout, 'top2')
    const bottom = node(layout, 'bottom2')
    // TB inside: bottom strictly below top, roughly same column.
    expect(bottom.y).toBeGreaterThan(top.y + top.h / 2)
    expect(Math.abs(bottom.x - top.x)).toBeLessThan(top.w)
    // Outer LR: outside sits to the left of the subgraph contents.
    expect(node(layout, 'outside').x).toBeLessThan(top.x)
  })

  test.each([false, true])('nested same-root cross-hierarchy edges extract in absolute coordinates (direction override: %p)', withOverride => {
    const graph = parseGraph(`graph LR
X
subgraph outer
    A
    subgraph inner
        ${withOverride ? 'direction TB' : ''}
        B --> C
    end
    A --> B
end
X --> A
C --> Y
Y`)
    const positioned = layoutGraphSync(graph)
    expect(positioned.edges.map(edge => [edge.source, edge.target]).sort()).toEqual([['B', 'C'], ['A', 'B'], ['X', 'A'], ['C', 'Y']].sort())
    for (const edge of positioned.edges) {
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.source)!, edge.points[0]!)).toBe(true)
      expect(onShapeOutline(positioned.nodes.find(node => node.id === edge.target)!, edge.points.at(-1)!)).toBe(true)
    }
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    if (!withOverride) {
      const a = positioned.nodes.find(n => n.id === 'A')!
      const b = positioned.nodes.find(n => n.id === 'B')!
      const ab = positioned.edges.find(e => e.source === 'A' && e.target === 'B')!
      expect(ab.points[0]!.x).toBeCloseTo(a.x + a.width, 1)
      expect(ab.points.at(-1)!.x).toBeCloseTo(b.x, 1)
    }
  })

  test('nested subgraph-id edges under direction overrides attach to the container', () => {
    const graph = parseGraph(`flowchart LR
  X --> Pipeline
  subgraph Outer
    direction TB
    subgraph Pipeline
      Fetch --> Done
    end
  end`)
    const positioned = layoutGraphSync(graph)
    expect(hardViolations(assessLayout(graph, positioned))).toEqual([])
    const edge = positioned.edges.find(e => e.source === 'X' && e.target === 'Pipeline')!
    expect(edge.points.length).toBeGreaterThanOrEqual(2)
    expect(edge.routeCertificate?.routeClass).toBe('container')
  })
})

describe('subgraph direction override (ASCII grid layout)', () => {
  test('direction LR inside a TD flowchart renders the inner chain on one row', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD)
    const fetchRow = out.split('\n').findIndex(l => l.includes('Fetch'))
    expect(fetchRow).toBeGreaterThanOrEqual(0)
    const row = out.split('\n')[fetchRow]!
    for (const label of ['Parse', 'Transform', 'Store']) {
      expect(row).toContain(label)
    }
    expect(row.indexOf('Fetch')).toBeLessThan(row.indexOf('Parse'))
    expect(row.indexOf('Parse')).toBeLessThan(row.indexOf('Transform'))
    expect(row.indexOf('Transform')).toBeLessThan(row.indexOf('Store'))
  })

  test('container heading and member labels remain visible in 7-bit ASCII', () => {
    const out = renderMermaidASCII(LR_INSIDE_TD, { useAscii: true })
    expect(out.split('\n').filter(l => l.includes('Pipeline')).length).toBe(1)
    expect(out).toContain('Fetch')
    expect(out).toContain('Done')
    expect(out).toContain('+')
    expect(out).toMatch(/^[\x00-\x7f]*$/)
  })

  test('nested edges to a child subgraph id still do not create a phantom node box', () => {
    const out = renderMermaidASCII(`flowchart TD
  subgraph Outer
    Start --> Pipeline
    subgraph Pipeline
      Fetch --> Done
    end
  end`)
    expect(out.split('\n').filter(l => l.includes('Pipeline')).length).toBe(1)
    expect(out).toContain('Outer')
    expect(out).toContain('Start')
    expect(out).toContain('Done')
  })

  test('labeled and styled subgraph-id edges preserve labels and line styles', () => {
    const src = `flowchart LR
  A -.->|load| Cluster
  subgraph Cluster
    direction TB
    In --> Work --> Out
  end
  Cluster ==> Done`
    for (const useAscii of [false, true]) {
      const rendered = renderMermaidASCIIWithReceipt(src, { useAscii, paddingX: 12, colorMode: 'none' })
      const document = terminalDocumentOf(rendered)!, regions = document.regions()
      expect(rendered.text.split('\n').filter(line => line.includes('Cluster'))).toHaveLength(1)
      const frame = regions.find(region => region.kind === 'subgraph' && region.id === 'Cluster')!
      const incoming = regions.find(region => region.kind === 'edge' && region.from === 'A')!
      const outgoing = regions.find(region => region.kind === 'edge' && region.to === 'Done')!
      expect(incoming.to).toBe('Cluster'); expect(outgoing.from).toBe('Cluster')
      expect(incoming.projectedText).toBe('load')
      expect(incoming.authoredTextCells!.map(cell => cell.glyph).join('')).toBe('load')
      for (const cell of incoming.authoredTextCells!) expect(document.cell(cell.column, cell.row)?.glyph).toBe(cell.glyph)
      expect(incoming.ports!.find(port => port.end === 'end')).toMatchObject({ nodeId: 'Cluster', side: 'L', x: frame.canvasColStart })
      expect(outgoing.ports!.find(port => port.end === 'start')).toMatchObject({ nodeId: 'Cluster', side: 'R', x: frame.canvasColEnd - 1 })
      for (const [edge, style] of [[incoming, 'dotted'], [outgoing, 'heavy']] as const) {
        const owned = [...document.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))
        const shafts = owned.filter(([, , cell]) => cell.kind === 'stroke' && (cell.stroke?.mask === 10 || cell.stroke?.mask === 5))
        expect(shafts.length).toBeGreaterThan(0)
        for (const [, , cell] of shafts) expect(cell.stroke?.style).toBe(style)
        const end = edge.ports!.find(port => port.end === 'end')!
        const marker = document.cell(end.x - (end.markerOffset ?? 1), end.y)!
        expect(marker.kind).toBe('marker'); expect(marker.glyph).toBe(useAscii ? '>' : '►')
        expect(marker.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
      }
      expect(document.diagnostics).toEqual([])
    }
  })

  test('multiple inbound and outbound subgraph-id edges share the container without duplicate boxes', () => {
    const out = renderMermaidASCII(`flowchart TD
  A --> Cluster
  B --> Cluster
  subgraph Cluster
    direction LR
    In --> Work --> Out
  end
  Cluster --> Done
  Cluster --> Audit`)
    expect(out.split('\n').filter(l => l.includes('Cluster')).length).toBe(1)
    for (const label of ['A', 'B', 'In', 'Work', 'Out', 'Done', 'Audit']) {
      expect(out).toContain(label)
    }
  })
})
