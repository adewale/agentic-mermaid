import { describe, expect, test } from 'bun:test'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { asClass, asMindmap, asRadar, layoutMermaid, parseMermaid } from '../agent/index.ts'

function example(id: string): string {
  const entry = EDITOR_EXAMPLES.find(candidate => candidate.id === id)
  if (!entry) throw new Error(`missing editor example ${id}`)
  return entry.source
}

describe('editor family examples are obvious canonical exemplars', () => {
  test('Mindmap opens with the centered bilateral layout rather than the explicit tidy-tree alternate', () => {
    const parsed = parseMermaid(example('mindmap-basic'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asMindmap(parsed.value)).not.toBeNull()
    const layout = layoutMermaid(parsed.value)
    const root = layout.nodes.find(node => node.id === 'root')!
    const children = layout.nodes.filter(node => node.id !== 'root')
    expect(children.some(node => node.x + node.w < root.x)).toBe(true)
    expect(children.some(node => node.x > root.x + root.w)).toBe(true)
  })

  test('Mindmap Delivery branch reaches the visible Beta signal burst boundary', () => {
    const parsed = parseMermaid(example('mindmap-basic'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const layout = layoutMermaid(parsed.value)
    const beta = layout.nodes.find(node => node.label === 'Beta signal')!
    const edge = layout.edges.find(candidate => candidate.from === 'delivery' && candidate.to === 'beta')!
    const endpoint = edge.path.at(-1)!

    // The bang shape's horizontal tip is 0.38 radii from its center; its
    // rectangular layout bounds extend farther than the painted polygon.
    expect(endpoint[0]).toBeCloseTo(beta.x + beta.w * 0.88, 0)
    expect(Math.abs(endpoint[1] - (beta.y + beta.h / 2))).toBeLessThanOrEqual(1)
  })

  test('Class demonstrates both inheritance and composition relationships', () => {
    const parsed = parseMermaid(example('class-basic'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const diagram = asClass(parsed.value)!
    const kinds = new Set(diagram.body.relations.map(relation => relation.kind))
    expect(kinds.has('inheritance')).toBe(true)
    expect(kinds.has('composition')).toBe(true)
  })

  test('Radar demonstrates the documented polygon graticule alternate', () => {
    const parsed = parseMermaid(example('radar-basic'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asRadar(parsed.value)?.body.graticule).toBe('polygon')
  })
})
