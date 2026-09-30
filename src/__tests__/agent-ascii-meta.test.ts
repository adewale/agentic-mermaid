// Loop 9 M11 — renderMermaidASCIIWithMeta returns regions that cover the
// node ids and whose column ranges line up with the rendered characters.

import { describe, test, expect } from 'bun:test'
import { renderMermaidWithActions } from '../agent/index.ts'
import { ASCII_ROUTE_PARITY_CONTRACT, renderMermaidASCIIWithMeta, type AsciiRegion } from '../ascii/meta.ts'
import { visualWidth } from '../ascii/multiline-utils.ts'

// Region columns are terminal display cells, not string indices: a wide glyph
// earlier on the row shifts every later string index by one per glyph.
function cellSlice(line: string, start: number, end: number): string {
  let column = 0
  let out = ''
  for (const { segment } of new Intl.Segmenter().segment(line)) {
    if (column >= start && column < end) out += segment
    column += visualWidth(segment)
  }
  return out
}

/** The rendered text a region covers, one trimmed line per spanned row. */
function regionText(ascii: string, region: AsciiRegion): string {
  const lines = ascii.split('\n')
  return Array.from({ length: region.rowSpan ?? 1 }, (_, i) =>
    cellSlice(lines[region.canvasRow + i] ?? '', region.canvasColStart, region.canvasColEnd).trim()).join('\n')
}

describe('renderMermaidASCIIWithMeta', () => {
  test('flowchart: every node id appears in regions', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n  C --> D\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    expect(ascii.length).toBeGreaterThan(0)
    const ids = new Set(regions.map(r => r.id))
    for (const id of ['A', 'B', 'C', 'D']) expect(ids.has(id)).toBe(true)
  })

  test('flowchart: col ranges actually match rendered characters', () => {
    const src = 'flowchart LR\n  Alpha --> Beta\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    expect(regions.map(r => ({ id: r.id, text: regionText(ascii, r) }))).toEqual([
      { id: 'Alpha', text: 'Alpha' },
      { id: 'Beta', text: 'Beta' },
    ])
  })

  test('flowchart with labels: label string is what regions point at', () => {
    const src = 'flowchart LR\n  A[Login] --> B[Dashboard]\n'
    const { ascii, regions } = renderMermaidASCIIWithMeta(src)
    const lines = ascii.split('\n')
    const byId: Record<string, typeof regions[number]> = {}
    for (const r of regions) byId[r.id] = r
    expect(byId.A).toBeDefined()
    expect(byId.B).toBeDefined()
    expect(lines[byId.A!.canvasRow]!.slice(byId.A!.canvasColStart, byId.A!.canvasColEnd)).toContain('Login')
    expect(lines[byId.B!.canvasRow]!.slice(byId.B!.canvasColStart, byId.B!.canvasColEnd)).toContain('Dashboard')
  })

  // One table for both surfaces: the meta region must cover exactly the
  // rendered label, and the terminal action for a clicked node binds to it.
  test('projected labels keep exact regions and action targets after normalization and wrapping', () => {
    const cases = [
      { node: 'A["\`Target\`"]', options: {}, text: 'Target' },
      { node: 'A["Line<br>Break"]', options: {}, text: 'Line\nBreak' },
      { node: 'A["Map&#x3C;K,V&#x3E;"]', options: {}, text: 'Map<K,V>' },
      { node: 'A[This is a very long action label that must wrap]', options: { targetWidth: 40 }, text: 'This is a\nvery long\naction label\nthat must\nwrap' },
    ]
    for (const { node, options, text } of cases) {
      const source = `flowchart LR\n  ${node} --> B[Done]`
      const rendered = renderMermaidASCIIWithMeta(source, { colorMode: 'none', ...options })
      const region = rendered.regions.find(r => r.id === 'A')
      expect({ node, kind: region?.kind, text: region && regionText(rendered.ascii, region) }).toEqual({ node, kind: 'node', text })
      const actions = renderMermaidWithActions(`${source}\n  click A href "https://example.com"`, { format: 'unicode', options: { colorMode: 'none', ...options } })
      expect(actions.actionSurface.actions[0]).toEqual(expect.objectContaining({ target: 'A', region: expect.objectContaining({ id: 'node:A' }) }))
    }
  })

  test('flowchart projected text keeps the `*` and `~` the drawing shows', () => {
    const rendered = renderMermaidASCIIWithMeta(
      'flowchart LR\n  A[*a* and ~~s~~] --> B[**b**]\n  subgraph S[*t*]\n    C\n  end',
      { colorMode: 'none' },
    )
    const lines = rendered.ascii.split('\n')
    for (const [id, text] of [['A', '*a* and ~~s~~'], ['B', '**b**'], ['S', '*t*']] as const) {
      const region = rendered.regions.find(candidate => candidate.id === id)!
      expect({ id, projectedText: region.projectedText }).toEqual({ id, projectedText: text })
      expect(lines[region.canvasRow]!.slice(region.canvasColStart, region.canvasColEnd)).toBe(text)
    }
    // A wrapped label maps through its projected tokens, markers included.
    const wrapped = renderMermaidASCIIWithMeta(
      'flowchart RL\n  A[*alpha* beta gamma delta ~~eps~~ zeta eta] --> B[Alpha]',
      { colorMode: 'none', targetWidth: 30 },
    ).regions.find(candidate => candidate.id === 'A')!
    expect(wrapped.authoredTextCells!.map(cell => cell.glyph).join('')).toBe('*alpha*betagammadelta~~eps~~zetaeta')
    // Families that render markdown-lite emphasis still project without markers.
    const mindmap = renderMermaidASCIIWithMeta('mindmap\n  root((*Root* ~~x~~))', { colorMode: 'none' })
    const root = mindmap.regions.find(candidate => candidate.id === 'root')!
    expect(root.projectedText).toBe('Root x')
    expect(mindmap.ascii.split('\n')[root.canvasRow]!.slice(root.canvasColStart, root.canvasColEnd)).toBe('Root x')
  })

  test('wrapped label tokens stay within one rendered node', () => {
    const rendered = renderMermaidASCIIWithMeta(
      'flowchart RL\n  A[Alpha Beta] --> B[Alpha]\n  click A href https://example.com/a',
      { colorMode: 'none', targetWidth: 20 },
    )
    const a = rendered.regions.find(region => region.id === 'A')!
    const b = rendered.regions.find(region => region.id === 'B')!
    expect(a.rowSpan).toBe(2)
    expect(a.canvasColStart).toBeGreaterThanOrEqual(b.canvasColEnd)
  })

  test('multiline label tokens (and action hit regions) cannot escape into a neighboring node', () => {
    const source = 'flowchart TD\n  F{F?} -->|Yes| G["High level<br>Tr"]\n  F -->|No| H["Dumb Tr<br>S"]'
    const rendered = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const g = rendered.regions.find(region => region.id === 'G')!
    const h = rendered.regions.find(region => region.id === 'H')!
    expect(g.rowSpan).toBe(2)
    expect(g.canvasColEnd).toBeLessThanOrEqual(h.canvasColStart)
    const action = renderMermaidWithActions(`${source}\n  click G href "https://example.com"`, { format: 'unicode', options: { colorMode: 'none' } })
    const bounds = action.actionSurface.actions[0]!.region!.bounds
    expect(Number(bounds.h)).toBe(2)
    expect(Number(bounds.x) + Number(bounds.w)).toBeLessThanOrEqual(h.canvasColStart)
  })

  test('multiline regions (and action regions) remain mapped after a wide display-cell prefix', () => {
    const source = 'flowchart LR\n  B["界界界"] --> A["High<br>Tr"]\n  click A href "https://example.com"'
    const rendered = renderMermaidASCIIWithMeta(source, { colorMode: 'none' })
    const a = rendered.regions.find(region => region.id === 'A')!
    // Each wide glyph before A shifts string indices, not display columns.
    expect({ rowSpan: a.rowSpan, text: regionText(rendered.ascii, a) }).toEqual({ rowSpan: 2, text: 'High\nTr' })
    const action = renderMermaidWithActions(source, { format: 'unicode', options: { colorMode: 'none' } })
    expect(action.actionSurface.actions[0]).toEqual(expect.objectContaining({
      target: 'A', region: expect.objectContaining({ id: 'node:A', bounds: expect.objectContaining({ h: 2 }) }),
    }))
  })

  test('node regions and terminal actions prefer boxed labels over identical edge labels', () => {
    const source = 'flowchart TD\n  X[X] -->|Yes| Y[Y]\n  Y --> C[Yes]\n  click C href "https://example.com"'
    for (const useAscii of [true, false]) {
      const rendered = renderMermaidASCIIWithMeta(source, { colorMode: 'none', useAscii })
      const region = rendered.regions.find(candidate => candidate.id === 'C')!
      const line = rendered.ascii.split('\n')[region.canvasRow]!
      expect(line.slice(region.canvasColStart, region.canvasColEnd)).toBe('Yes')
      expect(line.trim()).toMatch(useAscii ? /^\|\s*Yes\s*\|$/ : /^│\s*Yes\s*│$/)
      const action = renderMermaidWithActions(source, { format: useAscii ? 'ascii' : 'unicode', options: { colorMode: 'none' } })
      const bounds = action.actionSurface.actions[0]!.region!.bounds
      const actionLine = String(action.output).split('\n')[Number(bounds.y)]!
      expect(actionLine.trim()).toMatch(useAscii ? /^\|\s*Yes\s*\|$/ : /^│\s*Yes\s*│$/)
    }
  })

  test('punctuation-only node labels do not bind to box borders', () => {
    for (const useAscii of [true, false]) {
      const rendered = renderMermaidASCIIWithMeta('flowchart TD\n  A[-]', { colorMode: 'none', useAscii })
      const region = rendered.regions.find(candidate => candidate.id === 'A')!
      const line = rendered.ascii.split('\n')[region.canvasRow]!
      expect(line.slice(region.canvasColStart, region.canvasColEnd)).toBe('-')
      expect(line.trim()).toMatch(useAscii ? /^\|\s*-\s*\|$/ : /^│\s*-\s*│$/)
      expect(region.authoredTextCells).toEqual([{ row: region.canvasRow, column: region.canvasColStart, glyph: '-' }])
    }
  })

  test('terminal action metadata contains no authored control bytes', () => {
    const osc = '\u001b]52;c;SEVMTE8=\u0007'
    const rendered = renderMermaidASCIIWithMeta(
      `flowchart LR\n  A[Docs]\n  click A href "https://example.com/${osc}"`,
      { colorMode: 'none' },
    )
    expect(rendered.ascii).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    const actionText = Object.values(rendered.actions[0] ?? {}).filter(value => typeof value === 'string').join('')
    expect(actionText).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    expect(rendered.actions[0]).toEqual(expect.objectContaining({ security: 'unsafe', href: expect.stringContaining('?') }))
  })

  test('sequence: participants appear in regions', () => {
    const src = 'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob->>Carol: Hello\n'
    const { regions } = renderMermaidASCIIWithMeta(src)
    const ids = new Set(regions.map(r => r.id))
    expect(ids.has('Alice')).toBe(true)
    expect(ids.has('Bob')).toBe(true)
    expect(ids.has('Carol')).toBe(true)
  })

  const familyRegionCases: Array<{ family: string; source: string; ids: string[] }> = [
    {
      family: 'state',
      source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  state "Running App" as Running\n',
      ids: ['Idle', 'Running'],
    },
    {
      family: 'timeline',
      source: 'timeline\n  title Product\n  section Alpha\n    2024 Q1 : Plan : Build\n',
      ids: ['section-0', 'period-0'],
    },
    {
      family: 'class',
      source: 'classDiagram\n  class Animal {\n    +String name\n  }\n  Animal <|-- Dog\n',
      ids: ['Animal', 'Dog'],
    },
    {
      family: 'er',
      source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string name\n  }\n',
      ids: ['CUSTOMER', 'ORDER'],
    },
    {
      family: 'journey',
      source: 'journey\n  title Day\n  section Work\n    Make tea: 5: Me\n    Do work: 2: Me\n',
      ids: ['title', 'section-0', 'task-0', 'task-1'],
    },
    {
      family: 'architecture',
      source: 'architecture-beta\n  group api(cloud)[API]\n  service web(server)[Web App] in api\n  service db(database)[DB] in api\n  web:R --> L:db\n',
      ids: ['api', 'web', 'db'],
    },
    {
      family: 'xychart',
      source: 'xychart-beta\n  title Sales\n  x-axis Months [Jan, Feb]\n  y-axis Revenue 0 --> 10\n  bar Signups [3, 7]\n',
      ids: ['title', 'x-axis', 'x-category-0', 'x-category-1'],
    },
    {
      family: 'pie',
      source: 'pie showData\n  title Pets\n  "Dogs" : 40\n  "Cats" : 60\n',
      ids: ['title', 'slice-0', 'slice-1'],
    },
    {
      family: 'quadrant',
      source: 'quadrantChart\n  title Priorities\n  x-axis Low --> High\n  y-axis Bad --> Good\n  quadrant-1 Big wins\n  Feature A: [0.8, 0.8]\n',
      ids: ['title', 'x-axis-near', 'x-axis-far', 'y-axis-near', 'y-axis-far', 'quadrant#1', 'quadrant#2', 'quadrant#3', 'quadrant#4', 'point-0'],
    },
    {
      family: 'gantt',
      source: 'gantt\n  title Release\n  section Build\n    Core engine :core, 2024-01-01, 2d\n    Polish :polish, after core, 1d\n',
      ids: ['section#0', 'core', 'polish'],
    },
  ]

  for (const { family, source, ids: expectedIds } of familyRegionCases) {
    test(`${family}: stable regions cover load-bearing labels`, () => {
      const { ascii, regions } = renderMermaidASCIIWithMeta(source)
      expect(ascii.length).toBeGreaterThan(0)
      const ids = new Set(regions.map(r => r.id))
      for (const id of expectedIds) expect({ family, id, present: ids.has(id) }).toEqual({ family, id, present: true })
      const lines = ascii.split('\n')
      for (const r of regions) {
        const line = lines[r.canvasRow]
        expect({ family, id: r.id, rowInBounds: Boolean(line) }).toEqual({ family, id: r.id, rowInBounds: true })
        expect(line!.slice(r.canvasColStart, r.canvasColEnd).trim().length).toBeGreaterThan(0)
      }
    })
  }

  test('terminal semantic containers use the same identities and counts as graphical regions', () => {
    const radar = renderMermaidASCIIWithMeta('radar-beta\n axis a, b\n curve c{1,2}\n ticks 5')
    expect(radar.regions.filter(region => region.kind === 'ring').map(region => region.id).sort())
      .toEqual(['ring:0', 'ring:1', 'ring:2', 'ring:3', 'ring:4'])

    const quadrant = renderMermaidASCIIWithMeta('quadrantChart\n Point: [0.2, 0.3]')
    expect(quadrant.regions.filter(region => region.kind === 'compartment').map(region => region.id).sort())
      .toEqual(['quadrant#1', 'quadrant#2', 'quadrant#3', 'quadrant#4'])

    const gantt = renderMermaidASCIIWithMeta('gantt\n section Build\n Task :t, 2024-01-01, 1d')
    expect(gantt.regions).toContainEqual(expect.objectContaining({ id: 'section#0', kind: 'band' }))
  })

  test('route parity contract is explicit and edge-region gaps are structured warnings', () => {
    const result = renderMermaidASCIIWithMeta('flowchart LR\n  A --> B\n')
    expect(result.routeParity).toBe(ASCII_ROUTE_PARITY_CONTRACT)
    expect(result.routeParity.routeIntent).toBe('shared-route-classes')
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'ASCII_EDGE_REGION_UNMAPPED', severity: 'degraded' }))
  })

  test('stable: same input → same regions (deterministic)', () => {
    const src = 'flowchart TD\n  A --> B\n  B --> C\n'
    const a = renderMermaidASCIIWithMeta(src)
    const b = renderMermaidASCIIWithMeta(src)
    expect(a.ascii).toBe(b.ascii)
    expect(a.regions).toEqual(b.regions)
  })

  test('regions sorted top-down, left-to-right', () => {
    const src = 'flowchart TD\n  A --> B\n  A --> C\n  B --> D\n  C --> D\n'
    const { regions } = renderMermaidASCIIWithMeta(src)
    for (let i = 1; i < regions.length; i++) {
      const prev = regions[i - 1]!
      const cur = regions[i]!
      if (prev.canvasRow !== cur.canvasRow) expect(cur.canvasRow).toBeGreaterThan(prev.canvasRow)
      else expect(cur.canvasColStart).toBeGreaterThanOrEqual(prev.canvasColStart)
    }
  })

  test('unparseable source yields empty regions', () => {
    const { regions } = renderMermaidASCIIWithMeta('not a diagram')
    expect(regions).toEqual([])
  })
})
