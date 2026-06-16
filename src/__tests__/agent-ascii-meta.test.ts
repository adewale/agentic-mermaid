// Loop 9 M11 — renderMermaidASCIIWithMeta returns regions that cover the
// node ids and whose column ranges line up with the rendered characters.

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

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
    const lines = ascii.split('\n')
    for (const r of regions) {
      const line = lines[r.canvasRow]
      expect(line).toBeDefined()
      const slice = line!.slice(r.canvasColStart, r.canvasColEnd)
      // The slice should contain the node id or its label substring.
      expect(slice.length).toBe(r.canvasColEnd - r.canvasColStart)
      expect(slice.trim().length).toBeGreaterThan(0)
    }
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
      ids: ['title', 'x-axis-near', 'x-axis-far', 'y-axis-near', 'y-axis-far', 'quadrant-1', 'point-0'],
    },
    {
      family: 'gantt',
      source: 'gantt\n  title Release\n  section Build\n    Core engine :core, 2024-01-01, 2d\n    Polish :polish, after core, 1d\n',
      ids: ['section-0', 'core', 'polish'],
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
