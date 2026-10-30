import { describe, expect, test } from 'bun:test'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import type { DiagramKind } from '../agent/types.ts'
import { renderMermaidSVG } from '../index.ts'
import { escapeAttr, escapeDisplayAttr } from '../multiline-utils.ts'
import { ensureSvgIdentity, semanticIdentityForSvg } from '../scene/identity.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'

function semanticElements(svg: string): string[] {
  return [...svg.matchAll(/<[a-z]+\b[^>]*\sdata-id="[^"]+"[^>]*>/g)].map(match => match[0])
}

function dataIds(svg: string): string[] {
  return [...svg.matchAll(/\sdata-id="([^"]+)"/g)].map(match => match[1]!)
}

interface IdentityTuple {
  id: string
  role: string
  from: string
  to: string
}
function attr(element: string, name: string): string {
  return element.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? ''
}
function identityTuples(svg: string): IdentityTuple[] {
  return semanticElements(svg).map(element => ({
    id: attr(element, 'data-id'),
    role: attr(element, 'data-role'),
    from: attr(element, 'data-from'),
    to: attr(element, 'data-to'),
  }))
}
function primaryNodeIdentities(family: DiagramKind, tuples: IdentityTuple[]): IdentityTuple[] {
  return tuples.filter(({ id, role }) => {
    if (family === 'packet' || family === 'kanban' || family === 'requirement' || family === 'eventmodeling' || family === 'block' || family === 'ishikawa' || family === 'treemap') return role === 'node'
    if (family === 'c4') return role === 'node' && !id.startsWith('c4:')
    if (family === 'flowchart' || family === 'state') return role === 'node' && !id.startsWith('node-shape:')
    if (family === 'sequence' || family === 'zenuml') return role === 'actor' && !id.startsWith('actor:')
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
    if (family === 'sankey') return role === 'bar'
    return role === 'node'
  })
}
function primaryGroupIdentities(family: DiagramKind, tuples: IdentityTuple[]): IdentityTuple[] {
  return tuples.filter(({ id, role }) => {
    if (family === 'eventmodeling' || family === 'kanban' || family === 'treemap' || family === 'block') return role === 'group'
    if (family === 'c4') return role === 'group' && !id.startsWith('c4:')
    if (family === 'flowchart' || family === 'state') return role === 'group' && !id.startsWith('group-')
    if (family === 'class') return role === 'group' && !id.startsWith('namespace-')
    if (family === 'architecture') return role === 'group' && !id.startsWith('group-')
    if (family === 'quadrant') return role === 'plate'
    if (family === 'journey') return role === 'section' && /^section-\d+$/.test(id)
    if (family === 'gantt') return role === 'section' && id.startsWith('section-band:')
    if (family === 'gitgraph') return role === 'group' && id.startsWith('branch:')
    if (family === 'zenuml') return role === 'block' && /^statement:\d+$/.test(id)
    return false
  })
}

interface IdentityPair {
  id: string
  role: string
}
const sortedPairs = (pairs: IdentityPair[]): IdentityPair[] => pairs.sort((a, b) => compareCodePointStrings(`${a.role}\0${a.id}`, `${b.role}\0${b.id}`))
function expectedNodePairs(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityPair[] {
  // Radar's primary data marks are the curve vertex dots (role 'point'); its
  // layout also projects axis-label boxes (role 'labelled-mark') for the rubric,
  // which the identity contract does not enroll — filter to the dots.
  if (family === 'radar') return sortedPairs(layout.nodes.filter(node => node.role === 'mark' && node.id.startsWith('dot:')).map(node => ({ id: node.id, role: 'point' })))
  if (family === 'zenuml') return sortedPairs(layout.nodes.filter(node => node.shape !== 'external-anchor' && node.shape !== 'note').map(node => ({ id: node.id, role: 'actor' })))
  return sortedPairs(
    layout.nodes.map((node, index) => {
      if (family === 'sequence') return { id: node.id, role: 'actor' }
      if (family === 'class') return { id: node.id, role: 'class-box' }
      if (family === 'er') return { id: node.id, role: 'entity' }
      if (family === 'architecture') return { id: node.id, role: node.role === 'mark' ? 'junction' : 'service' }
      if (family === 'xychart') return { id: `${node.shape === 'line' ? 'line-point' : 'bar'}:0:${node.label}`, role: node.shape === 'line' ? 'line-point' : 'bar' }
      if (family === 'pie') return { id: `slice:${node.id.slice(node.id.indexOf(':') + 1)}`, role: 'pie-slice' }
      if (family === 'quadrant') return { id: `point:${node.label}`, role: 'point' }
      if (family === 'journey') return { id: node.id, role: 'task' }
      if (family === 'timeline') return node.id.endsWith(':period') ? { id: node.id.slice(0, -':period'.length), role: 'period' } : { id: node.id, role: 'event' }
      if (family === 'gantt') return { id: `task:${node.id}`, role: 'task' }
      if (family === 'sankey') return { id: node.id, role: 'bar' }
      return { id: node.id, role: 'node' }
    }),
  )
}
function expectedGroupPairs(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityPair[] {
  if (family === 'xychart' || family === 'radar') return []
  return sortedPairs(
    layout.groups.map((group, index) => {
      if (family === 'quadrant') return { id: `plate:${group.id.slice(group.id.indexOf('#') + 1)}`, role: 'plate' }
      if (family === 'journey') return { id: group.id, role: 'section' }
      if (family === 'gantt') return { id: `section-band:${group.label}#${index}`, role: 'section' }
      if (family === 'zenuml') return { id: group.id, role: 'block' }
      return { id: group.id, role: 'group' }
    }),
  )
}
const sortedTuples = (tuples: IdentityTuple[]): IdentityTuple[] => tuples.sort((left, right) => compareCodePointStrings(`${left.role}\0${left.id}\0${left.from}\0${left.to}`, `${right.role}\0${right.id}\0${right.from}\0${right.to}`))
function expectedRelationTuples(family: DiagramKind, layout: ReturnType<typeof layoutMermaid>): IdentityTuple[] {
  const occurrences = new Map<string, number>()
  return sortedTuples(
    layout.edges.map(edge => {
      const key = `${edge.from}\0${edge.to}`
      const occurrence = occurrences.get(key) ?? 0
      occurrences.set(key, occurrence + 1)
      const arrow = `${edge.from}-&gt;${edge.to}`
      if (family === 'c4') return { id: edge.id, role: 'edge', from: edge.from, to: edge.to }
      if (family === 'requirement') return { id: edge.id, role: 'relationship', from: edge.from, to: edge.to }
      if (family === 'eventmodeling' || family === 'block' || family === 'ishikawa') return { id: edge.id, role: 'edge', from: edge.from, to: edge.to }
      if (family === 'sequence') return { id: `message:${arrow}#${occurrence}:line`, role: 'message', from: edge.from, to: edge.to }
      if (family === 'zenuml') return { id: `${edge.id}:line`, role: 'message', from: edge.from, to: edge.to }
      if (family === 'class') return { id: `rel:${arrow}#${occurrence}`, role: 'relationship', from: edge.from, to: edge.to }
      if (family === 'er') return { id: `rel:${edge.from}-${edge.to}#${occurrence}`, role: 'relationship', from: edge.from, to: edge.to }
      if (family === 'mindmap' || family === 'gitgraph') return { id: arrow, role: 'edge', from: edge.from, to: edge.to }
      if (family === 'sankey') {
        // The label IS the node identity, so from/to are the raw labels.
        const base = `link:${edge.from}-&gt;${edge.to}`
        return { id: occurrence === 0 ? base : `${base}#${occurrence}`, role: 'edge', from: edge.from, to: edge.to }
      }
      return { id: `edge:${arrow}#${occurrence}`, role: 'edge', from: edge.from, to: edge.to }
    }),
  )
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
      expect(sortedPairs(primaryNodeIdentities(entry.family, tuples).map(({ id, role }) => ({ id, role }))), `${entry.family} complete node identities`).toEqual(expectedNodePairs(entry.family, layout))
      expect(sortedPairs(primaryGroupIdentities(entry.family, tuples).map(({ id, role }) => ({ id, role }))), `${entry.family} complete group identities`).toEqual(expectedGroupPairs(entry.family, layout))
      // Label companions may carry endpoint metadata, but the connector is
      // the sole semantic interaction authority.
      expect(sortedTuples(tuples.filter(tuple => tuple.from && tuple.to && tuple.role !== 'edge-label')), `${entry.family} complete relation identities`).toEqual(expectedRelationTuples(entry.family, layout))

      const styled = renderMermaidSVG(source, { embedFontImport: false, style: 'hand-drawn' })
      const styledIds = dataIds(styled)
      expect(styledIds.length, `${entry.family} styled identities`).toBeGreaterThan(0)
      expect(new Set(styledIds).size, `${entry.family} styled data-id uniqueness`).toBe(styledIds.length)
      expect(identityTuples(styled), `${entry.family} identity tuples survive style redraw`).toEqual(tuples)
    }
  })

  test('relations expose normalized data-from/data-to endpoints', () => {
    const cases = [
      ['c4', 'C4Context\n  System(A,"Alpha")\n  System(B,"Beta")\n  Rel(A,B,"Calls")\n  Rel(A,B,"Retries")'],
      ['flowchart', 'flowchart LR\n  A --> B'],
      ['state', 'stateDiagram-v2\n  A --> B'],
      ['sequence', 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi'],
      ['zenuml', 'zenuml\nUser as Client\nAPI\nUser->API.request() {\n if(ready) {\n  API->User: ready\n }\n}'],
      ['class', 'classDiagram\n  A --> B'],
      ['er', 'erDiagram\n  A ||--o{ B : owns'],
      ['architecture', 'architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R --> L:b'],
      ['mindmap', 'mindmap\n  A\n    B'],
      ['gitgraph', 'gitGraph\n  commit id:"A"\n  commit id:"B"'],
      ['requirement', 'requirementDiagram\nrequirement safety {\nid: R1\ntext: "Retain evidence"\nrisk: high\nverifymethod: test\n}\nelement suite {\ntype: "test suite"\n}\nsuite - verifies -> safety'],
      ['block', 'block\ncolumns 2\nblock:storage:2\nA["API"] B["Database"]\nend\nA --> B'],
      ['ishikawa', 'ishikawa\nEffect\nProcess\n  Cause'],
    ] as const
    for (const [family, source] of cases) {
      const parsed = parseMermaid(source)
      expect(parsed.ok, `${family} typed parse`).toBe(true)
      if (!parsed.ok) continue
      const actual = identityTuples(renderMermaidSVG(source, { embedFontImport: false })).filter(tuple => tuple.from && tuple.to && tuple.role !== 'edge-label')
      expect(sortedTuples(actual), `${family} exact relation identity`).toEqual(expectedRelationTuples(family, layoutMermaid(parsed.value)))
      expect(sortedPairs(primaryGroupIdentities(family, identityTuples(renderMermaidSVG(source))).map(({ id, role }) => ({ id, role }))), `${family} exact group identity`).toEqual(expectedGroupPairs(family, layoutMermaid(parsed.value)))
    }
  })

  test('keeps generated identities unique when visible labels repeat', () => {
    const cases = [
      { source: 'journey\n  section One\n    Repeat: 3: A\n    Repeat: 4: A', family: 'journey', role: 'task', expected: ['task-0', 'task-1'] },
      { source: 'timeline\n  Repeat : Event A\n  Repeat : Event B', family: 'timeline', role: 'period', expected: ['period-0', 'period-1'] },
    ] as const
    for (const { source, family, role, expected } of cases) {
      const svg = renderMermaidSVG(source, { embedFontImport: false })
      expect(primaryNodeIdentities(family, identityTuples(svg)).filter(tuple => tuple.role === role).map(tuple => tuple.id)).toEqual([...expected])
      const ids = dataIds(svg)
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

test('XML attribute projection preserves whitespace and decodes source references exactly once', () => {
  const id = 'A\tB\nC\rD & < " \' &#9;'
  const encoded = 'A&#9;B&#10;C&#13;D &amp; &lt; &quot; &#39; &amp;#9;'
  expect(escapeAttr(id)).toBe(encoded)
  expect(escapeDisplayAttr('A\rB\nC\tD\u001b')).toBe('A?B&#10;C D?')
  const from = 'literal &#9; &amp;',
    to = 'real\tTAB\nLF\rCR'
  const crisp = `<path data-id="${encoded}" data-role="edge" data-from="${escapeAttr(from)}" data-to="${escapeAttr(to)}" data-label="one&#10;two &amp;#9;" />`
  const identity = semanticIdentityForSvg(crisp, { id: 'bounded-mark', role: 'edge' })
  expect(identity).toEqual({ id, role: 'edge', from, to })
  expect(ensureSvgIdentity(crisp, identity)).toBe(crisp)
})

// Reduced from the structural all-families fuzz: identities were written with
// a string replacement, so authored text spelling `$&` or `$'` inserted the
// matched tag or the rest of the document, and every family's SVG render
// failed scene validation for such a label or id.
test.each(['$&', "$'", '$`', '$$', '$1', 'R$&D'])('authored text spelling %j keeps the identity it was written with', text => {
  const crisp = '<g class="node"><title>t</title><rect/></g>'
  const identity = { id: `node:${text}`, role: 'node' as const, from: text, to: `${text}x` }
  const written = ensureSvgIdentity(`<g data-id="old" class="node"><title>t</title><rect/></g>`, identity)
  expect(semanticIdentityForSvg(written, { id: 'unused', role: 'node' })).toEqual({ ...identity, classNames: ['node'] })
  expect(written.endsWith('<title>t</title><rect/></g>')).toBe(true)
  expect(ensureSvgIdentity(crisp, identity).endsWith('<title>t</title><rect/></g>')).toBe(true)
  for (const source of [`flowchart TD\n  A["${text}"]`, `timeline\n  section ${text}\n    2020 : a`, `sequenceDiagram\n  participant A as ${text}\n  A->>B: x`]) {
    expect(() => renderMermaidSVG(source, { embedFontImport: false }), source).not.toThrow()
  }
})
