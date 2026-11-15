import { describe, expect, test } from 'bun:test'
import { describeMermaidTree, layoutMermaid, mutate, parseRegisteredMermaid as parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import { renderMermaidASCIIWithMeta } from '../ascii/meta.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import type { PositionedEdge } from '../types.ts'

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
  test('terminal State and Class annotations retain target references without claiming containment', () => {
    const cases = [
      { source: 'stateDiagram-v2\nstate Outer {\n A --> B\n}\nnote left of Outer: Note', note: 'note#0', target: { id: 'Outer', kind: 'cluster' } },
      { source: 'stateDiagram-v2\nstate Outer {\n A --> B\n}\nnote left of B: Note', note: 'note#0', target: { id: 'B', kind: 'node' } },
      { source: 'classDiagram\nnamespace Domain {\n class A\n}\nnote for A "Note"', note: 'note:0', target: { id: 'A', kind: 'node' } },
    ] as const
    for (const fixture of cases) for (const useAscii of [false, true]) {
      const native = renderMermaidASCIIWithMeta(fixture.source, { useAscii, colorMode: 'none', layoutSafety: 'strict' })
      expect(native.warnings.some(warning => warning.code === 'ASCII_RENDER_FAILED')).toBe(false)
      const note = native.regions.find(region => region.id === fixture.note)!
      expect(note).toMatchObject({ projectedText: 'Note', annotationTarget: fixture.target })
      expect(note.parentId).toBeUndefined()
      const target = native.regions.find(region => region.id === fixture.target.id && region.kind === fixture.target.kind)!
      expect(target).toBeDefined()
      expect(target.members ?? []).not.toContain(fixture.note)
    }
  })

  for (const backend of ['elk', 'agentic'] as const) test.each([false, true])(`${backend} parallel edge identities remain distinct through regions and edits (named=%s)`, named => {
    const source = `flowchart TD
      subgraph Frame
        A ${named ? 'first@' : ''}-->|one| B
        A ${named ? 'second@' : ''}-->|two| B
      end
      B -->|out| C`
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const options = { graphLayout: { backend } }
    const layout = layoutMermaid(parsed.value, { ...options, debug: true })
    const firstId = named ? 'first' : 'A->B'
    const secondId = named ? 'second' : 'A->B#1'
    expect(Object.fromEntries(layout.edges.map(edge => [edge.label?.text, edge.id]))).toEqual({ one: firstId, two: secondId, out: 'B->C' })
    const regions = layout.regions ?? []
    expect(new Set(regions.map(region => region.id)).size).toBe(regions.length)
    expect(regions).toContainEqual(expect.objectContaining({ id: `label:${secondId}`, parentId: `edge:${secondId}`, elementId: secondId }))

    const edited = mutate(parsed.value, { kind: 'set_label', target: secondId, label: 'changed' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(describeMermaidTree(edited.value).edges.map(edge => edge.label)).toEqual(['one', 'changed', 'out'])
    const svg = renderMermaidSVG(edited.value, options)
    const svgEdges = [...svg.matchAll(/data-id="([^"]+)" data-role="edge"/g)].map(match => match[1]!.replaceAll('&gt;', '>'))
    expect(svgEdges).toContain(named ? firstId : 'edge:A->B#0')
    expect(svgEdges).toContain(named ? secondId : 'edge:A->B#1')
    expect(svg).toContain('changed')
  })

  test('parallel endpoint selectors follow source indices after backend extraction reorders edges', () => {
    const makeEdge = (edgeIndex: number, label: string): PositionedEdge => ({ source: 'A', target: 'B', edgeIndex, label,
      style: 'solid', hasArrowStart: false, hasArrowEnd: true, points: [{ x: 0, y: edgeIndex }, { x: 20, y: edgeIndex }] })
    const layout = positionedToRenderedLayout({ nodes: [], groups: [], edges: [makeEdge(1, 'second'), makeEdge(0, 'first')], width: 20, height: 20 }, 'flowchart')
    expect(layout.edges.map(edge => [edge.label?.text, edge.id])).toEqual([['second', 'A->B#1'], ['first', 'A->B']])
  })

  for (const backend of ['elk', 'agentic'] as const) test.each([
    ['node identity', 'flowchart TD\n A A@-->|one| B\n A second@-->|two| B', 'A->B', 'second'],
    ['repeated authored identity', 'flowchart TD\n A same@-->|one| B\n A same@-->|two| B', 'same', 'A->B#1'],
  ])(`${backend} projected selectors remain editable with %s`, (_kind, source, firstId, secondId) => {
    const parsed = parseMermaid(source!)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const layout = layoutMermaid(parsed.value, { graphLayout: { backend }, regions: true })
    expect(layout.edges.map(edge => edge.id)).toEqual([firstId, secondId])
    const regions = layout.regions ?? []
    expect(new Set(regions.map(region => region.id)).size).toBe(regions.length)
    for (const [index, target] of [firstId!, secondId!].entries()) {
      const edited = mutate(parsed.value, { kind: 'set_label', target, label: 'changed' })
      expect(edited.ok).toBe(true)
      if (!edited.ok) continue
      expect(describeMermaidTree(edited.value).edges.map(edge => edge.label)).toEqual(index === 0 ? ['changed', 'two'] : ['one', 'changed'])
    }
  })

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
    expect(edge.label).toBeDefined()
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
      expect(graphical.length).toBeGreaterThan(0)
      expect(terminal).toEqual(graphical)
    }
  })
})
