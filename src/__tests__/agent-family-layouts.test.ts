// ============================================================================
// QUAL-1 — perceptual-quality metrics must see EVERY renderable diagram family.
//
// Before this work, class/er/journey/architecture/xychart/pie/quadrant fell
// through to emptyRenderedLayout in layoutMermaid, so measureQuality reported
// nodeCount 0 — the metrics were blind to them. These tests pin the adapters:
//   - red-green per family: nodeCount > 0, finite bounds, whitespaceBalance ∈ (0,1]
//   - property/table: every node on-canvas (0 ≤ x,y; x+w ≤ bounds.w + ε)
//   - determinism: layoutMermaid twice → deep-equal
//   - opaque layout failures are explicit; renderable opaque bodies stay usable
// ============================================================================

import { describe, expect, it } from 'bun:test'
import {
  layoutCertificateProof, parseRegisteredMermaid as parseMermaid, layoutMermaid, layoutMermaidWithReceipt,
  measureQuality, renderMermaidASCIIWithReceipt, renderMermaidSVGWithReceipt, verifyMermaid,
} from '../agent/index.ts'
import type { RenderedLayout } from '../agent/index.ts'

const EPS = 1

const SOURCES: Record<string, string> = {
  class: 'classDiagram\n  Animal <|-- Dog\n  Animal <|-- Cat\n  Animal : +String name\n  Animal : +eat()\n  class Dog {\n    +bark()\n  }\n  class Cat {\n    +meow()\n  }',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }',
  sequence: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello\n  B-->>A: Hi',
  timeline: 'timeline\n  title Releases\n  section Alpha\n    2024 Q1 : Prototype : Test\n  section Beta\n    2024 Q2 : Launch',
  journey: 'journey\n  title My day\n  section Work\n    Make tea: 5: Me\n    Do work: 1: Me, Cat\n  section Home\n    Sit down: 5: Me',
  architecture: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api\n  service server(server)[Server] in api\n  db:L -- R:server',
  xychart: 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb, mar]\n  y-axis "Revenue" 0 --> 100\n  bar [30, 60, 90]\n  line [10, 50, 80]',
  pie: 'pie showData\n  title Pets\n  "Dogs" : 40\n  "Cats" : 35\n  "Birds" : 25',
  quadrant: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Bad --> Good\n  quadrant-1 A\n  quadrant-2 B\n  quadrant-3 C\n  quadrant-4 D\n  Point One: [0.3, 0.6]\n  Point Two: [0.8, 0.2]',
  gantt: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n    Core :core, 2024-01-01, 2d\n    Docs :docs, after core, 1d',
  mindmap: 'mindmap\n  root((Plan))\n    Build\n    Ship',
  gitgraph: 'gitGraph LR\n  commit id:"start"\n  branch feature\n  checkout feature\n  commit id:"work"',
}

function layoutOf(src: string): RenderedLayout {
  const p = parseMermaid(src)
  if (!p.ok) throw new Error(`parse failed: ${JSON.stringify(p.error)}`)
  return layoutMermaid(p.value)
}

// ---- red-green: metrics see every family -----------------------------------

describe('QUAL-1 adapters: every renderable family is measured', () => {
  for (const [family, src] of Object.entries(SOURCES)) {
    it(`${family}: measureQuality reports real geometry`, () => {
      const layout = layoutOf(src)
      const m = measureQuality(layout)

      // 1. nodes exist — the whole point: metrics are no longer blind here.
      expect(m.nodeCount).toBeGreaterThan(0)
      // 2. bounds are finite and positive (a real canvas, not the 0×0 empty layout).
      expect(Number.isFinite(layout.bounds.w)).toBe(true)
      expect(Number.isFinite(layout.bounds.h)).toBe(true)
      expect(layout.bounds.w).toBeGreaterThan(0)
      expect(layout.bounds.h).toBeGreaterThan(0)
      // 3. whitespaceBalance is a real ratio in (0, 1] — node area is present.
      expect(m.whitespaceBalance).toBeGreaterThan(0)
      expect(m.whitespaceBalance).toBeLessThanOrEqual(1)
      // 4. layout kind round-trips the family (not the flowchart fallback).
      expect(layout.kind).toBe(family as RenderedLayout['kind'])
    })
  }
})

// ---- property/table: nodes on-canvas ---------------------------------------

describe('QUAL-1 adapters: all nodes lie within bounds', () => {
  for (const [family, src] of Object.entries(SOURCES)) {
    it(`${family}: 0 ≤ x,y and x+w ≤ bounds.w, y+h ≤ bounds.h`, () => {
      const layout = layoutOf(src)
      expect(layout.nodes.length).toBeGreaterThan(0)
      for (const n of layout.nodes) {
        expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.w) && Number.isFinite(n.h)).toBe(true)
        expect(n.x).toBeGreaterThanOrEqual(0)
        expect(n.y).toBeGreaterThanOrEqual(0)
        expect(n.x + n.w).toBeLessThanOrEqual(layout.bounds.w + EPS)
        expect(n.y + n.h).toBeLessThanOrEqual(layout.bounds.h + EPS)
      }
      // edges (where present) must reference declared nodes / have finite paths.
      for (const e of layout.edges) {
        for (const [px, py] of e.path) {
          expect(Number.isFinite(px) && Number.isFinite(py)).toBe(true)
        }
      }
    })
  }
})

// ---- determinism -----------------------------------------------------------

describe('QUAL-1 adapters: layoutMermaid is deterministic', () => {
  for (const [family, src] of Object.entries(SOURCES)) {
    it(`${family}: two layouts are deep-equal`, () => {
      const a = layoutOf(src)
      const b = layoutOf(src)
      expect(a).toEqual(b)
    })
  }
})

// ---- structured body layout ------------------------------------------------

describe('QUAL-1 adapters: structured bodies do not reparse canonicalSource', () => {
  const STRUCTURED = [
    {
      kind: 'xychart',
      source: 'xychart-beta\n  title Sales\n  x-axis [jan, feb, mar]\n  y-axis Revenue 0 --> 100\n  bar [30, 60, 90]',
      broken: 'xychart-beta\n  this would not produce chart nodes',
    },
    {
      kind: 'pie',
      source: SOURCES.pie!,
      broken: 'pie\n  this is not a slice',
    },
    {
      kind: 'quadrant',
      source: SOURCES.quadrant!,
      broken: 'quadrantChart\n  Broken: [2, 3]',
    },
    {
      kind: 'gantt',
      source: 'gantt\n  section Build\n    Core :core, 2024-01-01, 2d\n    Docs :docs, after core, 1d',
      broken: 'gantt\n  Bad line without task metadata',
    },
    {
      kind: 'mindmap',
      source: SOURCES.mindmap!,
      broken: 'mindmap\n  broken((different))',
    },
    {
      kind: 'gitgraph',
      source: SOURCES.gitgraph!,
      broken: 'gitGraph\n  commit id:"different"',
    },
  ] as const

  for (const { kind, source, broken } of STRUCTURED) {
    it(`${kind}: parsed body is enough to produce real geometry`, () => {
      const p = parseMermaid(source)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      expect(p.value.body.kind).toBe(kind)
      const corrupted = { ...p.value, canonicalSource: broken }
      const layout = layoutMermaid(corrupted)
      expect(layout.kind).toBe(kind)
      expect(layout.nodes.length).toBeGreaterThan(0)
      expect(layout.bounds.w).toBeGreaterThan(0)
      expect(layout.bounds.h).toBeGreaterThan(0)
    })
  }
})

describe('ParsedDiagram render source authority', () => {
  it('flowchart layout, SVG, and terminal receipts all retain canonical authored order', () => {
    const parsed = parseMermaid('flowchart LR\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') return
    const staleBody = structuredClone(parsed.value)
    if (staleBody.body.kind !== 'flowchart') return
    staleBody.body.graph.direction = 'RL'

    const layout = layoutMermaidWithReceipt(staleBody)
    const svg = renderMermaidSVGWithReceipt(staleBody)
    const terminal = renderMermaidASCIIWithReceipt(staleBody, { colorMode: 'none' })
    expect(new Set([
      layout.receipt.sharedRequestDigest,
      svg.receipt.sharedRequestDigest,
      terminal.receipt.sharedRequestDigest,
    ]).size).toBe(1)
  })
})

// ---- verify.layout is now truthful -----------------------------------------

describe('QUAL-1: verify.layout carries real geometry', () => {
  for (const [family, src] of Object.entries(SOURCES)) {
    it(`${family}: verifyMermaid(...).layout has nodes`, () => {
      const v = verifyMermaid(src)
      expect(v.layout.kind).toBe(family as RenderedLayout['kind'])
      expect(v.layout.nodes.length).toBeGreaterThan(0)
    })
  }
})

// ---- family route certificates --------------------------------------------

describe('non-graph adapters: debug certificates stay family-specific (#26/#38)', () => {
  it('architecture emits endpoint-side certificates only in debug layout', () => {
    const p = parseMermaid(SOURCES.architecture!)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { debug: true })
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.edges.every(e => e.route?.routeClass === 'family-layout' && 'family' in e.route && e.route.family === 'architecture' && e.route.invariant === 'side-anchored')).toBe(true)
    expect(layout.edges.every(e => e.route && 'family' in e.route && e.route.family === 'architecture'
      && e.route.placement === 'satisfied' && e.route.sourceFacesTarget && e.route.targetFacesSource && e.route.obstacleFree)).toBe(true)
    expect(layout.edges.every(e => e.route && layoutCertificateProof(e.route) === 'edge-route')).toBe(true)
    const plain = layoutMermaid(p.value)
    expect(plain.edges.every(e => e.route === undefined)).toBe(true)
  })

  it('architecture certificates distinguish a legal side conflict from a broken route', () => {
    const p = parseMermaid('architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R --> R:b')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const route = layoutMermaid(p.value, { debug: true }).edges[0]!.route
    expect(route && 'family' in route && route.family === 'architecture' ? route : undefined).toMatchObject({
      invariant: 'side-anchored',
      placement: 'conflicted',
      sourceFacesTarget: true,
      targetFacesSource: false,
      sourceAnchored: true,
      targetAnchored: true,
      orthogonal: true,
      obstacleFree: true,
    })
  })

  it('sequence emits lifeline-message certificates only in debug layout', () => {
    const p = parseMermaid(SOURCES.sequence!)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { debug: true })
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.edges.every(e => e.route?.routeClass === 'family-layout' && 'family' in e.route && e.route.family === 'sequence' && e.route.invariant === 'lifeline-message')).toBe(true)
    expect(layout.edges.every(e => e.route && layoutCertificateProof(e.route) === 'edge-route')).toBe(true)
    expect(layoutMermaid(p.value).edges.every(e => e.route === undefined)).toBe(true)
  })

  it('sequence debug label anchors match rendered message text anchors', () => {
    const p = parseMermaid('sequenceDiagram\n  participant A\n  participant B\n  A->>B: hello')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { debug: true })
    const edge = layout.edges[0]!
    expect(Number(edge.label?.x)).toBe(140)
    expect(Number(edge.label?.y)).toBe(86)
    expect(edge.label?.text).toBe('hello')
  })

  it('sequence self-message debug certificate uses the rendered loop geometry', () => {
    const p = parseMermaid('sequenceDiagram\n  participant A\n  A->>A: self')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { debug: true })
    expect(layout.edges).toHaveLength(1)
    const edge = layout.edges[0]!
    expect(edge.path).toHaveLength(4)
    expect(edge.route).toEqual(expect.objectContaining({
      routeClass: 'family-layout', family: 'sequence', invariant: 'self-message', bendCount: 2, selfMessage: true, horizontal: false,
    }))
  })

  it('sequence opaque block content feeds real rendered-layout geometry', () => {
    const p = parseMermaid('sequenceDiagram\n  participant A\n  participant B\n  loop retry\n    A->>B: ping\n  end\n  Note right of B: cached')
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const layout = layoutMermaid(p.value, { debug: true })
    expect(layout.edges.length).toBeGreaterThan(0)
    expect(layout.groups.some(g => g.id.startsWith('block#'))).toBe(true)
    expect(layout.nodes.some(n => n.id.startsWith('note#') && n.label === 'cached')).toBe(true)
  })

  it('timeline and chart families emit layout certificates only in debug layout', () => {
    for (const kind of ['timeline', 'xychart', 'pie', 'quadrant', 'gantt'] as const) {
      const p = parseMermaid(SOURCES[kind]!)
      expect(p.ok).toBe(true)
      if (!p.ok) continue
      const layout = layoutMermaid(p.value, { debug: true })
      expect(layout.nodes.length).toBeGreaterThan(0)
      expect(layout.certificates?.length).toBe(layout.nodes.length)
      expect(layout.certificates?.every(c => c.routeClass === 'family-layout' && 'family' in c && c.family === kind)).toBe(true)
      expect(layout.certificates?.every(c => layoutCertificateProof(c) === 'region-containment')).toBe(true)
      expect(layout.certificates?.every(c => 'bounds' in c && 'center' in c && 'containment' in c)).toBe(true)
      if (kind === 'xychart') expect(layout.certificates?.every(c => 'containment' in c && c.containment === 'center')).toBe(true)
      const plain = layoutMermaid(p.value)
      expect(plain.certificates).toBeUndefined()
    }
  })

  it('class and ER emit orthogonal box-boundary certificates only in debug layout', () => {
    for (const kind of ['class', 'er'] as const) {
      const p = parseMermaid(SOURCES[kind]!)
      expect(p.ok).toBe(true)
      if (!p.ok) continue
      const layout = layoutMermaid(p.value, { debug: true })
      expect(layout.edges.length).toBeGreaterThan(0)
      expect(layout.edges.every(e => e.route?.routeClass === 'family-layout' && 'family' in e.route && e.route.family === kind && e.route.invariant === 'orthogonal-box')).toBe(true)
      expect(layout.edges.every(e => e.route && layoutCertificateProof(e.route) === 'edge-route')).toBe(true)
      const plain = layoutMermaid(p.value)
      expect(plain.edges.every(e => e.route === undefined)).toBe(true)
    }
  })
})

// ---- opaque family layout outcomes stay explicit ---------------------------

describe('QUAL-1: opaque family layout outcomes stay explicit', () => {
  it('an invalid opaque body throws from layout and fails verify instead of succeeding with 0x0 geometry', () => {
    const parsed = parseMermaid('pie\n  "Dogs" : 40\n  total unmodeled junk line')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(() => layoutMermaid(parsed.value)).toThrow(/Unrecognized pie chart line/)
    const verified = verifyMermaid(parsed.value)
    expect(verified.ok).toBe(false)
    expect(verified.warnings).toContainEqual(expect.objectContaining({
      code: 'RENDER_FAILED',
      reason: expect.stringMatching(/pie.*layout hook failed.*Unrecognized pie chart line/i),
    }))
  })

  const RENDERABLE_OPAQUE = [
    // quadrant header only (no points) → opaque; layout still must not throw.
    'quadrantChart\n  x-axis Low --> High',
    // class with a note keyword (unmodeled) → opaque body that still lays out.
    'classDiagram\n  Animal <|-- Dog\n  note "freestanding"',
  ]
  for (const src of RENDERABLE_OPAQUE) {
    it(`does not throw: ${src.split('\n')[0]}…`, () => {
      const p = parseMermaid(src)
      expect(p.ok).toBe(true)
      if (!p.ok) return
      // layoutMermaid must produce a layout (possibly empty) with truthful kind.
      let layout: RenderedLayout | undefined
      expect(() => { layout = layoutMermaid(p.value) }).not.toThrow()
      expect(layout!.kind).toBe(p.value.kind)
      expect(Number.isFinite(layout!.bounds.w)).toBe(true)
      // verify must also survive.
      expect(() => verifyMermaid(p.value)).not.toThrow()
    })
  }
})
