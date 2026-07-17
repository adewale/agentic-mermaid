import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'

const SOURCE = `flowchart TD
  subgraph Outer[Outer Region]
    A[Alpha]
    subgraph Inner[Inner Region]
      B[Beta]
    end
  end
  A --> B
`

describe('stable region tree MVP', () => {
  test('flowchart layout JSON flattens nested subgraphs with parent ids and direct members', () => {
    const parsed = parseMermaid(SOURCE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const layout = layoutMermaid(parsed.value)
    const outer = layout.groups.find(g => g.id === 'Outer')
    const inner = layout.groups.find(g => g.id === 'Inner')
    expect(outer).toEqual(expect.objectContaining({ id: 'Outer', label: 'Outer Region', members: ['A'] }))
    expect(outer?.parentId).toBeUndefined()
    expect(inner).toEqual(expect.objectContaining({ id: 'Inner', label: 'Inner Region', parentId: 'Outer', members: ['B'] }))
  })

  test('debug layout JSON exposes region and action sidecars aligned by region id', () => {
    const parsed = parseMermaid(`${SOURCE}  click A href "https://example.com"\n`)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const layout = layoutMermaid(parsed.value, { debug: true })
    expect(layout.regions).toContainEqual(expect.objectContaining({ id: 'canvas', kind: 'canvas' }))
    expect(layout.regions).toContainEqual(expect.objectContaining({ id: 'group:Outer', kind: 'cluster', sourceLine: 2 }))
    expect(layout.regions).toContainEqual(expect.objectContaining({ id: 'node:A', kind: 'node', parentId: 'group:Outer', sourceLine: 3 }))
    expect(layout.actions).toContainEqual(expect.objectContaining({ id: 'action:flowchart:A:0', regionId: 'node:A', executable: false, security: 'safe' }))
  })

  test('debug label regions use a real bounding box around the label center', () => {
    const parsed = parseMermaid('flowchart LR\n  A -- retry --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const layout = layoutMermaid(parsed.value, { debug: true })
    const edge = layout.edges.find(e => e.label?.text === 'retry')
    const label = layout.regions?.find(r => r.id === `label:${edge?.id}`)
    expect(edge?.label).toBeDefined()
    expect(label).toBeDefined()
    if (!edge?.label || !label) return
    expect(label.bounds.x).toBeLessThan(edge.label.x)
    expect(label.bounds.y).toBeLessThan(edge.label.y)
    expect(label.bounds.x + label.bounds.w).toBeGreaterThan(edge.label.x)
    expect(label.bounds.y + label.bounds.h).toBeGreaterThan(edge.label.y)
  })

  test('sequence self-message label region respects start-anchored text', () => {
    const parsed = parseMermaid('sequenceDiagram\n  participant A\n  A->>A: self')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const layout = layoutMermaid(parsed.value, { debug: true })
    const edge = layout.edges[0]!
    const label = layout.regions?.find(r => r.id === `label:${edge.id}`)
    expect(label).toBeDefined()
    if (!edge.label || !label) return
    expect(label.bounds.x).toBe(edge.label.x)
    expect(label.bounds.y).toBeLessThan(edge.label.y)
    expect(label.bounds.x + label.bounds.w).toBeGreaterThan(edge.label.x)
  })

  test('flowchart SVG marks subgraph regions with stable ids and parent ids', () => {
    const svg = renderMermaidSVG(SOURCE)
    expect(svg).toContain('class="subgraph" data-id="Outer" data-region="subgraph" data-label="Outer Region"')
    expect(svg).toContain('class="subgraph" data-id="Inner" data-region="subgraph" data-label="Inner Region" data-parent-id="Outer"')
  })

  test('ASCII metadata includes best-effort subgraph label regions with source lines', () => {
    const { regions } = renderMermaidASCIIWithMeta(SOURCE)
    expect(regions).toContainEqual(expect.objectContaining({ kind: 'subgraph', id: 'Outer', sourceLine: 2 }))
    expect(regions).toContainEqual(expect.objectContaining({ kind: 'subgraph', id: 'Inner', sourceLine: 4 }))
    expect(regions).toContainEqual(expect.objectContaining({ kind: 'node', id: 'A', sourceLine: 3 }))
    expect(regions).toContainEqual(expect.objectContaining({ kind: 'node', id: 'B', sourceLine: 5 }))
  })

  test('group regions expose family semantics instead of a single generic kind', () => {
    const cases = [
      { kind: 'lane', source: 'gitGraph\n  commit id:"base"\n  branch feature\n  commit id:"work"' },
      { kind: 'band', source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Core :core, 2024-01-01, 1d' },
      { kind: 'compartment', source: 'sequenceDiagram\n  participant A\n  participant B\n  alt success\n    A->>B: ok\n  end' },
      { kind: 'plot', source: 'xychart-beta\n  x-axis [Jan, Feb]\n  bar [3, 7]' },
      { kind: 'ring', source: 'radar-beta\n  axis quality["Quality"], speed["Speed"]\n  curve now{4,3}' },
    ] as const
    for (const entry of cases) {
      const parsed = parseMermaid(entry.source)
      expect(parsed.ok, entry.source).toBe(true)
      if (!parsed.ok) continue
      const regions = layoutMermaid(parsed.value, { regions: true }).regions ?? []
      expect(regions.some(region => region.kind === entry.kind), entry.source).toBe(true)
    }
  })

  test('terminal metadata preserves semantic container kinds across families', () => {
    const cases = [
      { kind: 'cluster', source: 'stateDiagram-v2\n  state Parent {\n    A --> B\n  }' },
      { kind: 'compartment', source: 'sequenceDiagram\n  participant A\n  participant B\n  alt success\n    A->>B: ok\n  end' },
      { kind: 'cluster', source: 'classDiagram\n  namespace Domain {\n    class A\n  }' },
      { kind: 'plot', source: 'xychart-beta\n  x-axis [Jan, Feb]\n  bar [3, 7]' },
      { kind: 'ring', source: 'radar-beta\n  axis quality["Quality"], speed["Speed"]\n  curve now{4,3}' },
    ] as const
    for (const entry of cases) {
      const regions = renderMermaidASCIIWithMeta(entry.source).regions
      expect(regions.some(region => region.kind === entry.kind), entry.source).toBe(true)
    }
  })

  test('terminal metadata matches graphical state-region and ER-group container ids', () => {
    for (const source of [
      'stateDiagram-v2\n state Active {\n [*] --> A\n --\n [*] --> B\n }',
      'erDiagram\n subgraph Domain\n A ||--o{ B : owns\n end',
    ]) {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const graphical = (layoutMermaid(parsed.value, { regions: true }).regions ?? [])
        .filter(region => region.kind === 'cluster')
        .map(region => region.elementId)
        .filter((id): id is string => id !== undefined)
        .sort()
      const terminal = renderMermaidASCIIWithMeta(source).regions
        .filter(region => region.kind === 'cluster')
        .map(region => region.id)
        .sort()
      expect(terminal).toEqual(graphical)
    }
  })
})
