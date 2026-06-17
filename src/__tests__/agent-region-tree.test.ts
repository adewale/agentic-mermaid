import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseMermaid, renderMermaidSVG } from '../agent/index.ts'
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
