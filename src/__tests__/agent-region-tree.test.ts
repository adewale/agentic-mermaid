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
    expect(layout.regions).toContainEqual(expect.objectContaining({ id: 'group:Outer', kind: 'group', sourceLine: 2 }))
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
})
