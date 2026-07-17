import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import type { DiagramKind } from '../agent/types.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

function semanticElements(svg: string): string[] {
  return [...svg.matchAll(/<[a-z]+\b[^>]*\sdata-id="[^"]+"[^>]*>/g)].map(match => match[0])
}

function dataIds(svg: string): string[] {
  return [...svg.matchAll(/\sdata-id="([^"]+)"/g)].map(match => match[1]!)
}

interface IdentityTuple { id: string; role: string; from: string; to: string }
function attr(element: string, name: string): string {
  return element.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''
}
function identityTuples(svg: string): IdentityTuple[] {
  return semanticElements(svg).map(element => ({
    id: attr(element, 'data-id'), role: attr(element, 'data-role'),
    from: attr(element, 'data-from'), to: attr(element, 'data-to'),
  }))
}
function primaryNodeIdentities(family: DiagramKind, tuples: IdentityTuple[]): IdentityTuple[] {
  return tuples.filter(({ id, role }) => {
    if (family === 'flowchart' || family === 'state') return role === 'node' && !id.startsWith('node-shape:')
    if (family === 'sequence') return role === 'actor' && !id.startsWith('actor:')
    if (family === 'class') return role === 'class-box' && !id.startsWith('class:')
    if (family === 'er') return role === 'entity' && !id.startsWith('entity-')
    if (family === 'architecture') return (role === 'service' || role === 'junction') && !/^(?:service-|junction-)/.test(id)
    if (family === 'xychart') return role === 'bar' || role === 'line-point'
    if (family === 'pie') return role === 'pie-slice'
    if (family === 'quadrant') return role === 'point'
    if (family === 'journey') return role === 'task' && /^task-\d+$/.test(id)
    if (family === 'timeline') return (role === 'period' && /^period-\d+$/.test(id)) || (role === 'event' && /^event-\d+$/.test(id))
    if (family === 'gantt') return role === 'task'
    if (family === 'radar') return role === 'point'
    return role === 'node'
  })
}
function primaryGroupIdentities(family: DiagramKind, tuples: IdentityTuple[]): IdentityTuple[] {
  return tuples.filter(({ id, role }) => {
    if (family === 'flowchart' || family === 'state') return role === 'group' && !id.startsWith('group-')
    if (family === 'class') return role === 'group' && !id.startsWith('namespace-')
    if (family === 'architecture') return role === 'group' && !id.startsWith('group-')
    if (family === 'quadrant') return role === 'plate'
    if (family === 'journey') return role === 'section' && /^section-\d+$/.test(id)
    if (family === 'gantt') return role === 'section' && id.startsWith('section-band:')
    if (family === 'gitgraph') return role === 'group' && id.startsWith('branch:')
    return false
  })
}

interface IdentityPair { id: string; role: string }
const sortedPairs = (pairs: IdentityPair[]): IdentityPair[] => pairs.sort((a, b) => compareCodePointStrings(`${a.role}\0${a.id}`, `${b.role}\0${b.id}`))
function expectedNodePairs(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityPair[] {
  // Radar's primary data marks are the curve vertex dots (role 'point'); its
  // layout also projects axis-label boxes (role 'labelled-mark') for the rubric,
  // which the identity contract does not enroll — filter to the dots.
  if (family === 'radar') return sortedPairs(layout.nodes.filter(node => node.role === 'mark' && node.id.startsWith('dot:')).map(node => ({ id: node.id, role: 'point' })))
  return sortedPairs(layout.nodes.map((node, index) => {
    if (family === 'sequence') return { id: node.id, role: 'actor' }
    if (family === 'class') return { id: node.id, role: 'class-box' }
    if (family === 'er') return { id: node.id, role: 'entity' }
    if (family === 'architecture') return { id: node.id, role: node.role === 'mark' ? 'junction' : 'service' }
    if (family === 'xychart') return { id: `${node.shape === 'line' ? 'line-point' : 'bar'}:0:${node.label}`, role: node.shape === 'line' ? 'line-point' : 'bar' }
    if (family === 'pie') return { id: `slice:${node.id.slice(node.id.indexOf(':') + 1)}`, role: 'pie-slice' }
    if (family === 'quadrant') return { id: `point:${node.label}`, role: 'point' }
    if (family === 'journey') return { id: node.id, role: 'task' }
    if (family === 'timeline') return node.id.endsWith(':period')
      ? { id: node.id.slice(0, -':period'.length), role: 'period' }
      : { id: node.id, role: 'event' }
    if (family === 'gantt') return { id: `task:${node.id}`, role: 'task' }
    return { id: node.id, role: 'node' }
  }))
}
function expectedGroupPairs(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityPair[] {
  if (family === 'xychart' || family === 'radar') return []
  return sortedPairs(layout.groups.map((group, index) => {
    if (family === 'quadrant') return { id: `plate:${group.id.slice(group.id.indexOf('#') + 1)}`, role: 'plate' }
    if (family === 'journey') return { id: group.id, role: 'section' }
    if (family === 'gantt') return { id: `section-band:${group.label}#${index}`, role: 'section' }
    return { id: group.id, role: 'group' }
  }))
}
const sortedTuples = (tuples: IdentityTuple[]): IdentityTuple[] => tuples.sort((left, right) =>
  compareCodePointStrings(`${left.role}\0${left.id}\0${left.from}\0${left.to}`, `${right.role}\0${right.id}\0${right.from}\0${right.to}`),
)
function expectedRelationTuples(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityTuple[] {
  const occurrences = new Map<string, number>()
  return sortedTuples(layout.edges.map(edge => {
    const key = `${edge.from}\0${edge.to}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const arrow = `${edge.from}-&gt;${edge.to}`
    if (family === 'sequence') return { id: `message:${arrow}#${occurrence}:line`, role: 'message', from: edge.from, to: edge.to }
    if (family === 'class') return { id: `rel:${arrow}#${occurrence}`, role: 'relationship', from: edge.from, to: edge.to }
    if (family === 'er') return { id: `rel:${edge.from}-${edge.to}#${occurrence}`, role: 'relationship', from: edge.from, to: edge.to }
    if (family === 'mindmap' || family === 'gitgraph') return { id: arrow, role: 'edge', from: edge.from, to: edge.to }
    return { id: `edge:${arrow}#${occurrence}`, role: 'edge', from: edge.from, to: edge.to }
  }))
}

describe('all-family SVG semantic identity contract', () => {
  test('enrolls every registered family with stable, unique data-id + data-role pairs', () => {
    for (const entry of Object.values(METAMORPHIC_FAMILIES)) {
      const source = entry.build(entry.kRange[0], 'Identity')
      const first = renderMermaidSVG(source, { embedFontImport: false })
      const second = renderMermaidSVG(source, { embedFontImport: false })
      expect(second, `${entry.family} identity must be deterministic`).toBe(first)

      const elements = semanticElements(first)
      expect(elements.length, `${entry.family} semantic elements`).toBeGreaterThan(0)
      for (const element of elements) {
        expect(element, `${entry.family}: ${element.slice(0, 80)}`).toMatch(/\sdata-role="[^"]+"/)
      }
      const ids = dataIds(first)
      expect(new Set(ids).size, `${entry.family} data-id uniqueness`).toBe(ids.length)

      const parsed = parseMermaid(source)
      expect(parsed.ok, `${entry.family} typed parse`).toBe(true)
      if (!parsed.ok) continue
      const layout = layoutMermaid(parsed.value)
      const tuples = identityTuples(first)
      expect(sortedPairs(primaryNodeIdentities(entry.family, tuples).map(({ id, role }) => ({ id, role }))), `${entry.family} complete node identities`)
        .toEqual(expectedNodePairs(entry.family, layout))
      expect(sortedPairs(primaryGroupIdentities(entry.family, tuples).map(({ id, role }) => ({ id, role }))), `${entry.family} complete group identities`)
        .toEqual(expectedGroupPairs(entry.family, layout))
      expect(sortedTuples(tuples.filter(tuple => tuple.from && tuple.to)), `${entry.family} complete relation identities`)
        .toEqual(expectedRelationTuples(entry.family, layout))

      const styled = renderMermaidSVG(source, { embedFontImport: false, style: 'hand-drawn' })
      const styledIds = dataIds(styled)
      expect(styledIds.length, `${entry.family} styled identities`).toBeGreaterThan(0)
      expect(new Set(styledIds).size, `${entry.family} styled data-id uniqueness`).toBe(styledIds.length)
      expect(identityTuples(styled), `${entry.family} identity tuples survive style redraw`).toEqual(tuples)
    }
  })

  test('relations expose normalized data-from/data-to endpoints', () => {
    const cases = [
      ['flowchart', 'flowchart LR\n  A --> B'],
      ['state', 'stateDiagram-v2\n  A --> B'],
      ['sequence', 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi'],
      ['class', 'classDiagram\n  A --> B'],
      ['er', 'erDiagram\n  A ||--o{ B : owns'],
      ['architecture', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R --> L:b'],
      ['mindmap', 'mindmap\n  A\n    B'],
      ['gitgraph', 'gitGraph\n  commit id:"A"\n  commit id:"B"'],
    ] as const
    for (const [family, source] of cases) {
      const parsed = parseMermaid(source)
      expect(parsed.ok, `${family} typed parse`).toBe(true)
      if (!parsed.ok) continue
      const actual = identityTuples(renderMermaidSVG(source, { embedFontImport: false })).filter(tuple => tuple.from && tuple.to)
      expect(sortedTuples(actual), `${family} exact relation identity`).toEqual(expectedRelationTuples(family, layoutMermaid(parsed.value)))
    }
  })

  test('keeps generated identities unique when visible labels repeat', () => {
    const sources = [
      `journey
  section One
    Repeat: 3: A
    Repeat: 4: A`,
      `timeline
  Repeat : Event A
  Repeat : Event B`,
    ]
    for (const source of sources) {
      const ids = dataIds(renderMermaidSVG(source, { embedFontImport: false }))
      expect(new Set(ids).size, source.split('\n')[0]).toBe(ids.length)
    }
  })

  test('preserves Mermaid className tokens on the identified element', () => {
    const source = `flowchart LR
  A[Alpha] --> B[Beta]
  class A critical
  classDef critical stroke:#000`
    const svg = renderMermaidSVG(source, { embedFontImport: false })
    const node = semanticElements(svg).find(element => element.includes('data-id="A"'))
    expect(node).toBeDefined()
    expect(node).toMatch(/class="node critical"/)
  })

  test('retains identity when a styled backend redraws geometry', () => {
    const source = 'pie\n  "Alpha" : 2\n  "Beta" : 1'
    const svg = renderMermaidSVG(source, { embedFontImport: false, style: 'hand-drawn' })
    expect(svg).toContain('data-id="slice:Alpha"')
    expect(svg).toContain('data-role="pie-slice"')
    const ids = dataIds(svg)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
