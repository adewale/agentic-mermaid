import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { renderMermaidSVG } from '../index.ts'
import { renderSvg as renderSvgWithContext } from '../renderer.ts'
import type { DiagramColors } from '../theme.ts'
import type { PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode, RenderOptions } from '../types.ts'

const colors: DiagramColors = { bg: '#ffffff', fg: '#111827' }
const semanticColorOptions: RenderOptions = {
  style: {
    node: {
      fillColor: '#fee2e2',
      borderColor: '#991b1b',
      textColor: '#111827',
    },
    edge: {
      strokeColor: '#2563eb',
      textColor: '#1e3a8a',
    },
    group: {
      fillColor: '#f0fdf4',
      headerFillColor: '#dcfce7',
      borderColor: '#15803d',
      textColor: '#14532d',
    },
  },
}

function renderSvg(
  positioned: PositionedGraph,
  palette: DiagramColors,
  font = 'Inter',
  transparent = false,
  options: RenderOptions = {},
): string {
  return renderSvgWithContext({
    positioned,
    colors: { ...palette, font },
    options: { ...options, transparent },
  })
}

function graph(overrides: Partial<PositionedGraph> = {}): PositionedGraph {
  return { width: 320, height: 240, nodes: [], edges: [], groups: [], ...overrides }
}

function node(overrides: Partial<PositionedNode> = {}): PositionedNode {
  return {
    id: 'A',
    label: 'Alpha',
    shape: 'rectangle',
    x: 40,
    y: 40,
    width: 90,
    height: 44,
    ...overrides,
  }
}

function edge(overrides: Partial<PositionedEdge> = {}): PositionedEdge {
  return {
    source: 'A',
    target: 'B',
    style: 'solid',
    hasArrowStart: false,
    hasArrowEnd: true,
    points: [
      { x: 130, y: 62 },
      { x: 180, y: 62 },
      { x: 180, y: 120 },
      { x: 230, y: 120 },
    ],
    ...overrides,
  }
}

function groupBox(overrides: Partial<PositionedGroup> = {}): PositionedGroup {
  return {
    id: 'backend',
    label: 'Backend',
    x: 20,
    y: 20,
    width: 260,
    height: 160,
    children: [],
    ...overrides,
  }
}

function firstNodeRect(svg: string, id = 'A') {
  const nodeMatch = svg.match(new RegExp(`<g class="node" data-id="${id}"[\\s\\S]*?<rect ([^>]+)>`))
  expect(nodeMatch, `expected node ${id} rect`).not.toBeNull()
  const attrs = nodeMatch![1]!
  return {
    attrs,
    width: Number(attrs.match(/width="([\d.]+)"/)?.[1] ?? 0),
    height: Number(attrs.match(/height="([\d.]+)"/)?.[1] ?? 0),
  }
}

function firstSubgraphRect(svg: string, id = 'backend') {
  const match = svg.match(new RegExp(`<g class="subgraph" data-id="${id}"[\\s\\S]*?<rect ([^>]+)>`))
  expect(match, `expected subgraph ${id} rect`).not.toBeNull()
  const attrs = match![1]!
  return {
    attrs,
    width: Number(attrs.match(/width="([\d.]+)"/)?.[1] ?? 0),
    height: Number(attrs.match(/height="([\d.]+)"/)?.[1] ?? 0),
  }
}

describe('RenderOptions semantic style roles', () => {
  it('applies typography, node geometry, and edge stroke knobs through the public SVG API', () => {
    const source = 'graph TD\n  A[Configurable Node] -->|route| B[End]'
    const baseline = renderMermaidSVG(source)
    const styled = renderMermaidSVG(source, {
      style: {
        node: {
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -0.25,
          paddingX: 42,
          paddingY: 24,
          cornerRadius: 9,
        },
        edge: {
          fontSize: 15,
          lineWidth: 2.5,
        },
      },
    })

    const baseRect = firstNodeRect(baseline, 'A')
    const styledRect = firstNodeRect(styled, 'A')

    expect(styledRect.width).toBeGreaterThan(baseRect.width)
    expect(styledRect.height).toBeGreaterThan(baseRect.height)
    expect(styledRect.attrs).toContain('rx="9" ry="9"')
    expect(styled).toContain('font-size="20" font-weight="700"')
    expect(styled).toContain('letter-spacing="-0.25"')
    expect(styled).toContain('font-size="15" font-weight="400"')
    expect(styled).toContain('stroke-width="2.5"')
  })

  it('applies semantic color roles through the core SVG renderer', () => {
    const source = `graph TD
      subgraph backend [Backend]
        A[API] -->|route| B[DB]
      end`
    const svg = renderMermaidSVG(source, semanticColorOptions)
    const nodeA = firstNodeRect(svg, 'A').attrs
    const group = firstSubgraphRect(svg, 'backend').attrs

    expect(nodeA).toContain('fill="#fee2e2"')
    expect(nodeA).toContain('stroke="#991b1b"')
    expect(svg).toContain('fill="#111827"')
    expect(svg).toContain('stroke="#2563eb"')
    expect(svg).toContain('fill="#1e3a8a"')
    expect(group).toContain('fill="#f0fdf4"')
    expect(group).toContain('stroke="#15803d"')
    expect(svg).toContain('fill="#dcfce7"')
    expect(svg).toContain('fill="#14532d"')
  })

  it('keeps Mermaid inline color directives above semantic style defaults', () => {
    const source = `graph TD
      A[Alpha] -->|route| B[Beta]
      style A fill:#ff0000,stroke:#00ff00,color:#0000ff
      linkStyle 0 stroke:#123456`
    const svg = renderMermaidSVG(source, semanticColorOptions)
    const nodeAStart = svg.indexOf('<g class="node" data-id="A"')
    const nodeBStart = svg.indexOf('<g class="node" data-id="B"')
    const nodeA = svg.slice(nodeAStart, nodeBStart)
    const nodeB = svg.slice(nodeBStart)
    const edgeTag = svg.match(/<(?:path|polyline) class="edge"[^>]+data-from="A"[^>]+>/)?.[0] ?? ''

    expect(nodeA).toContain('fill="#ff0000"')
    expect(nodeA).toContain('stroke="#00ff00"')
    expect(nodeA).toContain('fill="#0000ff"')
    expect(nodeA).not.toContain('fill="#fee2e2"')
    expect(nodeA).not.toContain('stroke="#991b1b"')
    expect(nodeB).toContain('fill="#fee2e2"')
    expect(nodeB).toContain('stroke="#991b1b"')
    expect(edgeTag).toContain('stroke="#123456"')
    expect(edgeTag).not.toContain('stroke="#2563eb"')
    expect(svg).toContain('fill="#1e3a8a"')
  })

  it('preserves default SVG output when style options are omitted or invalid', () => {
    const positioned = graph({
      groups: [groupBox()],
      nodes: [node()],
      edges: [edge({ label: 'route', points: [{ x: 130, y: 62 }, { x: 230, y: 62 }] })],
    })
    const baseline = renderSvg(positioned, colors, 'Inter', false)
    const emptyOptions = renderSvg(positioned, colors, 'Inter', false, {})
    const invalidOptions = renderSvg(positioned, colors, 'Inter', false, {
      style: {
        node: {
          fontSize: Number.NaN,
          fontWeight: -100,
          letterSpacing: Number.POSITIVE_INFINITY,
          paddingX: -1,
          paddingY: -1,
          cornerRadius: -1,
        },
        edge: {
          fontSize: 0,
          lineWidth: 0,
          bendRadius: -1,
        },
        group: {
          fontSize: Number.NaN,
          fontWeight: -1,
          fontFamily: '   ',
          textTransform: 'bogus' as never,
          cornerRadius: -1,
          borderColor: '',
          paddingX: -1,
          paddingY: -1,
        },
      },
    })

    expect(baseline).toContain('font-size="13" font-weight="500"')
    expect(baseline).toContain('font-size="11" font-weight="400"')
    expect(baseline).toContain('stroke-width="1"')
    expect(baseline).toContain('rx="0" ry="0"')
    expect(baseline).toContain('<polyline class="edge"')
    expect(baseline).not.toContain('letter-spacing=')
    expect(emptyOptions).toBe(baseline)
    expect(invalidOptions).toBe(baseline)
  })

  it('ignores removed flat style aliases at runtime', () => {
    const source = 'graph TD\n  A[Alpha] ==> B[Beta]'
    const baseline = renderMermaidSVG(source)
    const withRemovedAliases = renderMermaidSVG(source, {
      fontSize: 32,
      edgeFontSize: 28,
      nodePaddingX: 80,
      nodePaddingY: 40,
      lineWidth: 9,
      cornerRadius: 12,
      edgeBendRadius: 16,
      groupTextTransform: 'uppercase',
    } as unknown as Parameters<typeof renderMermaidSVG>[1])

    expect(withRemovedAliases).toBe(baseline)
  })

  it('uses lineWidth as the base stroke width and doubles it for thick edges', () => {
    const svg = renderSvg(
      graph({ edges: [edge({ style: 'thick', points: [{ x: 10, y: 10 }, { x: 100, y: 10 }] })] }),
      colors,
      'Inter',
      false,
      { style: { edge: { lineWidth: 2.25 } } },
    )

    expect(svg).toContain('stroke-width="4.5"')
  })

  it('renders rounded edge paths when edgeBendRadius is configured', () => {
    const svg = renderSvg(
      graph({ edges: [edge()] }),
      colors,
      'Inter',
      false,
      { style: { edge: { bendRadius: 8 } } },
    )

    expect(svg).toContain('<path class="edge"')
    expect(svg).toContain('data-from="A"')
    expect(svg).toContain('d="M130,62')
    expect(svg).toContain(' Q')
    expect(svg).not.toContain('<polyline class="edge"')
  })

  it('applies group typography, corner, border, transform, and padding knobs', () => {
    const source = `graph TD
      subgraph backend [Backend]
        A[API] --> B[DB]
      end`
    const baseline = renderMermaidSVG(source)
    const styled = renderMermaidSVG(source, {
      style: {
        group: {
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'Geist Mono',
          textTransform: 'uppercase',
          cornerRadius: 12,
          borderColor: '#ff00aa',
          paddingX: 40,
          paddingY: 32,
        },
      },
    })

    const baseGroup = firstSubgraphRect(baseline, 'backend')
    const styledGroup = firstSubgraphRect(styled, 'backend')

    expect(styledGroup.width).toBeGreaterThan(baseGroup.width)
    expect(styledGroup.height).toBeGreaterThan(baseGroup.height)
    expect(styledGroup.attrs).toContain('rx="12" ry="12"')
    expect(styledGroup.attrs).toContain('stroke="#ff00aa"')
    expect(styled).toContain('font-size="18" font-weight="700"')
    expect(styled).toContain('font-family="Geist Mono"')
    expect(styled).toContain('>BACKEND</text>')
  })

  it('applies semantic style roles across SVG diagram families', () => {
    const styleOptions = {
      style: {
        node: {
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 0.4,
          paddingX: 50,
          paddingY: 30,
          cornerRadius: 14,
          lineWidth: 2.25,
          fillColor: '#fee2e2',
          borderColor: '#991b1b',
          textColor: '#111827',
        },
        edge: {
          fontSize: 18,
          lineWidth: 3,
          bendRadius: 10,
          strokeColor: '#2563eb',
          textColor: '#1e3a8a',
        },
        group: {
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'Geist Mono',
          textTransform: 'uppercase' as const,
          cornerRadius: 16,
          borderColor: '#ff00aa',
          fillColor: '#f0fdf4',
          headerFillColor: '#dcfce7',
          textColor: '#14532d',
          paddingX: 48,
          paddingY: 36,
          lineWidth: 2,
        },
      },
    }
    const cases = [
      ['architecture', 'architecture-beta\n  group backend(cloud)[Backend]\n  service api(server)[API] in backend\n  service db(database)[DB] in backend\n  api:R -[reads]-> L:db', ['font-size="24"', 'rx="14"', 'stroke-width: 3', 'font-size="18"', '--arch-service-fill:#fee2e2', '--arch-group-band:#dcfce7', '--arch-edge-stroke:#2563eb']],
      ['sequence', 'sequenceDiagram\n  Alice->>Bob: Hello', ['font-size="24"', 'rx="14"', 'stroke-width="3"', 'font-size="18"', 'fill="#fee2e2"', 'stroke="#991b1b"', 'stroke="#2563eb"']],
      ['class', 'classDiagram\n  Animal <|-- Dog : inherits\n  class Animal\n  class Dog', ['font-size="24"', 'rx="14"', 'stroke-width="3"', 'font-size="18"', 'fill="#fee2e2"', 'stroke="#991b1b"', 'stroke="#2563eb"', 'fill="#dcfce7"']],
      ['er', 'erDiagram\n  CUSTOMER ||--o{ ORDER : places', ['font-size="24"', 'rx="14"', 'stroke-width="3"', 'font-size="18"', 'fill="#fee2e2"', 'stroke="#991b1b"', 'stroke="#2563eb"', 'fill="#dcfce7"']],
      ['timeline', 'timeline\n  section Releases\n  2020 : Event A', ['font-size="24"', 'rx="14"', 'stroke-width: 3', 'font-size="20"', '#fee2e2', '#2563eb', '#f0fdf4', '#dcfce7']],
      ['journey', 'journey\n  title User Journey\n  section Login\n    Open app: 5: User', ['font-size="24"', 'rx="14"', 'font-size="20"', '#fee2e2', '#2563eb', '#f0fdf4', '#dcfce7']],
      ['xychart', 'xychart-beta\n  title Sales\n  x-axis [A, B, C]\n  y-axis "Count" 0 --> 10\n  line [3, 7, 5]', ['font-size="24"', 'font-size="20"', 'stroke-width: 3', '#111827', '#2563eb', '#1e3a8a', '#14532d']],
      ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  title Plan\n  section Build\n    Spec :spec, 2024-01-01, 2d', ['font-size="24"', 'font-size="20"', 'stroke-width: 3', '#fee2e2', '#991b1b', '#2563eb', '#f0fdf4']],
      ['pie', 'pie title Pets\n  "Dogs" : 3\n  "Cats" : 2', ['font-size="24"', 'font-size="20"', '#991b1b', '#111827', '#14532d']],
      ['quadrant', 'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Risk --> Reward\n  quadrant-1 Plan\n  quadrant-2 Invest\n  quadrant-3 Ignore\n  quadrant-4 Monitor\n  A: [0.7, 0.8]', ['font-size="24"', 'font-size="20"', 'stroke-width: 3', '#fee2e2', '#991b1b', '#2563eb', '#1e3a8a']],
    ] as const

    for (const [name, source, expectations] of cases) {
      const svg = renderMermaidSVG(source, styleOptions)
      for (const expected of expectations) {
        expect(svg, `${name} should include ${expected}`).toContain(expected)
      }
      expect(svg, name).not.toMatch(/NaN|undefined/)
    }
  })
})

describe('RenderOptions style knobs – properties', () => {
  it('larger generated typography and padding values enlarge the rendered node and appear in SVG text attributes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 14, max: 28 }),
        fc.integer({ min: 24, max: 64 }),
        fc.integer({ min: 12, max: 36 }),
        (fontSize, nodePaddingX, nodePaddingY) => {
          const source = 'graph TD\n  A[Property Node] --> B[End]'
          const baseline = renderMermaidSVG(source)
          const styled = renderMermaidSVG(source, {
            style: { node: { fontSize, paddingX: nodePaddingX, paddingY: nodePaddingY } },
          })
          const baseRect = firstNodeRect(baseline, 'A')
          const styledRect = firstNodeRect(styled, 'A')

          expect(styled).toContain(`font-size="${fontSize}"`)
          expect(styledRect.width).toBeGreaterThan(baseRect.width)
          expect(styledRect.height).toBeGreaterThan(baseRect.height)
          expect(styled).not.toMatch(/NaN|undefined/)
        },
      ),
      { numRuns: 40 },
    )
  })
})
