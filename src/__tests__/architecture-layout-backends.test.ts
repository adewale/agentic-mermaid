import { describe, expect, spyOn, test } from 'bun:test'
import * as graphPlacement from '../layout-engine.ts'
import { withGraphLayoutDecisionObserver, type GraphLayoutDecision } from '../layout/backend.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { readFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt, parseRegisteredMermaid } from '../agent/core.ts'
import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { layoutArchitectureDiagram } from '../architecture/layout.ts'
import { parseArchitectureDiagram } from '../architecture/parser.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { withRenderStageObserver } from '../render-stages.ts'

const elkOptions = { graphLayout: { backend: 'elk' as const } }
const highContrastElk = { graphLayout: { backend: 'elk' as const, fallback: 'none' as const }, style: ['accessible-high-contrast', 'catppuccin-latte'], bg: '#111827', transparent: false, seed: 19, security: 'default' as const, embedFontImport: false }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/architecture-backends.mmd', import.meta.url), 'utf8')
const faces = 'architecture-beta\nservice left(disk)[Left]\nservice top(disk)[Top]\nservice bottom(disk)[Bottom]\nservice right(server)[Right]\njunction center\nleft:R --> L:center\ntop:B --> T:center\nbottom:T --> B:center\ncenter:R --> L:right'
const literalIcons = 'architecture-beta\nservice a "<b>日本 API</b>\\nSecond line" [Backend]\nservice b(database)[Storage]\na:R-->L:b'

describe('Architecture layout backends', () => {
  test.each([['alignment', fixture, elkOptions, 'elk'], ['four faces', faces, elkOptions, 'elk'], ['literal icons', literalIcons, elkOptions, 'elk'], ['high-contrast stock alignment', fixture, highContrastElk, 'elk']] as const)('retains authored ports, junctions, alignments and complete routes: %s', (_name, source, options, backend) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, options)
    expect(model).toEqual(original)
    expect(layoutArchitectureDiagram(model, options)).toEqual(placed)
    expect(placed.services.map(service => [service.id, service.label, service.icon, service.iconText, service.parentId])).toEqual(model.services.map(service => [service.id, service.label, service.icon, service.iconText, service.parentId]))
    expect(placed.junctions.map(junction => junction.id)).toEqual(model.junctions.map(junction => junction.id))
    expect(placed.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.label])).toEqual(model.edges.map(edge => [edge.source, edge.target, edge.hasArrowStart, edge.hasArrowEnd, edge.label]))
    const boxes = new Map([...placed.services, ...placed.junctions].map(node => [node.id, node]))
    for (const edge of placed.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2)
      for (const [endpoint, point] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
        const box = boxes.get(endpoint.id)!
        expect(point.x).toBeCloseTo(endpoint.side === 'L' ? box.x : endpoint.side === 'R' ? box.x + box.width : box.x + box.width / 2, 5)
        expect(point.y).toBeCloseTo(endpoint.side === 'T' ? box.y : endpoint.side === 'B' ? box.y + box.height : box.y + box.height / 2, 5)
      }
      for (let i = 1; i < edge.points.length; i++) expect(edge.points[i - 1]!.x === edge.points[i]!.x || edge.points[i - 1]!.y === edge.points[i]!.y).toBe(true)
    }
    if (source === fixture) expect(new Set(placed.services.filter(service => service.id.startsWith('src')).map(service => service.y)).size).toBe(1)
    const rendered = renderMermaidSVGWithReceipt(source, options)
    // Curved marker/junction occupied envelopes may remain unverified. Keep
    // the existing fixture certification requirements explicit.
    if (_name !== 'high-contrast stock alignment') expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    else {
      const status = rendered.receipt.layoutCertification?.status
      expect(status === 'passed' || status === 'unverified').toBe(true)
    }
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: backend, role: 'primary' })])
    if (source === literalIcons) {
      expect(rendered.svg).toContain('&lt;b&gt;日本 API&lt;/b&gt;')
      expect(rendered.svg).not.toContain('<b>日本 API</b>')
      expect(rendered.svg).toContain('Second line')
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error('literal icon fixture must parse')
      const text = renderMermaidASCIIWithReceipt(parsed.value, { ...elkOptions, colorMode: 'none' })
      expect(text.text).toContain('Second line')
      // Architecture projects pixel placement into cells, then independently
      // builds graphical companion evidence. Attribute both real placements.
      expect(text.receipt.layoutDecisions).toEqual([
        expect.objectContaining({ selected: backend, role: 'primary' }),
        expect.objectContaining({ selected: backend, role: 'companion' }),
      ])
    }
  })

  test('uses ELK placement across public surfaces and retains default bytes', () => {
    const options = { ...elkOptions, nodeSpacing: 51 }, stages: string[] = [], parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(fixture, options))
    expect(stages).toContain('elk')
    expect(renderMermaidSVGWithReceipt(parsed.value, options).svg).toBe(result.svg)
    expect(layoutMermaidWithReceipt(fixture, options).receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    const png = renderMermaidPNGWithReceipt(fixture, options)
    expect(png.png.length).toBeGreaterThan(0)
    expect(png.receipt.layoutDecisions).toEqual(result.receipt.layoutDecisions)
    expect(renderMermaidSVGWithReceipt(fixture, { graphLayout: { backend: 'elk' } }).svg).toBe(renderMermaidSVGWithReceipt(fixture).svg)
  })

  const compounds = JSON.parse(readFileSync(new URL('../../eval/mermaid-docs-corpus/corpus.json', import.meta.url), 'utf8')) as Array<{ family: string; index: number; source: string }>
  test.each(compounds.filter(entry => entry.family === 'architecture'))('retains all authored Architecture relationships and certifies final compound paint: $index', ({ source }) => {
    const model = parseArchitectureDiagram(toMermaidLines(source)), original = structuredClone(model)
    const placed = layoutArchitectureDiagram(model, elkOptions)
    expect(model).toEqual(original)
    expect(placed.edges.map(edge => [edge.source, edge.target])).toEqual(model.edges.map(edge => [edge.source, edge.target]))
    expect(placed.services.map(service => [service.id, service.parentId])).toEqual(model.services.map(service => [service.id, service.parentId]))
    const rendered = renderMermaidSVGWithReceipt(source, elkOptions)
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('corpus input must parse')
    expect(renderMermaidSVGWithReceipt(parsed.value, elkOptions).svg).toBe(rendered.svg)
  })

  test('retains empty frames and empty diagrams', () => {
    const grouped = 'architecture-beta\ngroup g[Group]'
    const framed = renderMermaidSVGWithReceipt(grouped, elkOptions)
    expect(framed.svg).toContain('Group')
    expect(framed.receipt.layoutCertification?.status).toBe('passed')
    expect(renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'elk', fallback: 'none' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
    expect(renderMermaidSVGWithReceipt('architecture-beta', elkOptions).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'elk' })])
  })
// Row and column requests compose across groups; endpoint-side ordering must
// not restore an obsolete rank for one member of a declared row.
test.each(['elk'] as const)('composes row and column alignment before final %s routes', backend => {
  const source = compounds.find(entry => entry.family === 'architecture' && entry.index === 3)!.source
  const model = parseArchitectureDiagram(toMermaidLines(source))
  const positioned = layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })
  const byId = new Map([...positioned.services, ...positioned.junctions].map(node => [node.id, node]))
  for (const alignment of model.alignments) {
    const values = alignment.members.map(id => {
      const node = byId.get(id)!
      return alignment.axis === 'row' ? node.y + node.height / 2 : node.x + node.width / 2
    })
    expect(Math.max(...values) - Math.min(...values), `${alignment.axis}: ${alignment.members.join(', ')}`).toBeLessThan(0.00001)
  }
  const flatten = (groups: typeof positioned.groups): typeof positioned.groups => groups.flatMap(group => [group, ...flatten(group.children)])
  const forbidden = [...positioned.services, ...positioned.junctions, ...flatten(positioned.groups).map(group => ({ ...group, height: group.headerHeight! }))]
  for (const edge of positioned.edges) {
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1]!, b = edge.points[index]!
      for (const box of forbidden) {
        const enters = a.x === b.x
          ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
          : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
        expect(enters, `${edge.source.id}->${edge.target.id} enters owned surface`).toBe(false)
      }
    }
  }
  const rendered = renderMermaidSVGWithReceipt(source, { graphLayout: { backend, fallback: 'none' } })
  expect(rendered.receipt.layoutCertification?.status).toBe('passed')
  expect(rendered.svg.match(/class="architecture-edge"/g)).toHaveLength(model.edges.length)
  for (const edge of positioned.edges) {
    expect(edge.obstacleFree).toBe(true)
    expect(edge.placement).toBe('satisfied')
    for (const [endpoint, point] of [[edge.source, edge.points[0]!], [edge.target, edge.points.at(-1)!]] as const) {
      const node = byId.get(endpoint.id)!
      expect(point).toEqual({
        x: endpoint.side === 'L' ? node.x : endpoint.side === 'R' ? node.x + node.width : node.x + node.width / 2,
        y: endpoint.side === 'T' ? node.y : endpoint.side === 'B' ? node.y + node.height : node.y + node.height / 2,
      })
    }
  }
})

})



test.each(['elk'] as const)('rejects inconsistent row and column centers explicitly with %s', backend => {
  const source = 'architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign row z a\nalign column a z'
  const model = parseArchitectureDiagram(toMermaidLines(source))
  expect(() => layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })).toThrow('incompatible row and column constraints')
})


test.each(['elk'] as const)('composes complete overlapping alignment components with %s', backend => {
  for (const axis of ['row', 'column'] as const) for (const ids of [['z', 'a', 'm'], ['z', 'a', 'm', 'b']]) {
    const sides = axis === 'row' ? 'R --> L' : 'B --> T'
    const body = `architecture-beta\ngroup g(cloud)[Group]\n${ids.map(id => `service ${id}(server)[${id.toUpperCase()}] in g`).join('\n')}\nservice sink(database)[Sink]\n${ids.map(id => `${id}:${sides}:sink`).join('\n')}`
    const overlapping = ids.slice(1).map((id, index) => `align ${axis} ${ids[index]} ${id}`).reverse().join('\n')
    const positioned = [overlapping, `align ${axis} ${ids.join(' ')}`].map(directives => {
      const model = parseArchitectureDiagram(toMermaidLines(body + '\n' + directives)), original = structuredClone(model)
      const placed = layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })
      expect(model).toEqual(original)
      const values = placed.services.filter(item => ids.includes(item.id)).map(item => axis === 'row' ? item.y + item.height / 2 : item.x + item.width / 2)
      expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.00001)
      for (const [index, item] of placed.services.entries()) for (const other of placed.services.slice(index + 1)) {
        expect(item.x < other.x + other.width && other.x < item.x + item.width && item.y < other.y + other.height && other.y < item.y + item.height).toBe(false)
      }
      expect(placed.edges.every(edge => edge.obstacleFree && edge.placement === 'satisfied')).toBe(true)
      return placed
    })
    expect(positioned[0]!.services.map(({ id, label, icon, parentId, width, height }) => ({ id, label, icon, parentId, width, height }))).toEqual(positioned[1]!.services.map(({ id, label, icon, parentId, width, height }) => ({ id, label, icon, parentId, width, height })))
    expect(positioned[0]!.edges.map(({ source, target, label, hasArrowStart, hasArrowEnd }) => ({ source, target, label, hasArrowStart, hasArrowEnd }))).toEqual(positioned[1]!.edges.map(({ source, target, label, hasArrowStart, hasArrowEnd }) => ({ source, target, label, hasArrowStart, hasArrowEnd })))
  }
})

test('selects only a completed Architecture artifact', () => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(server)[B]\na:T --> B:b'))
  const original = structuredClone(model), elk = graphPlacement.layoutElkGraphPlacementSync
  // Corrupt the raw placement: actual header and route admission must reject
  // the candidate before any selected decision escapes.
  const producer = spyOn(graphPlacement, 'layoutElkGraphPlacementSync').mockImplementation((graph, options) => {
    const placed = elk(graph, options), group = placed.groups.find(group => group.id === 'g')!
    return { ...placed, nodes: placed.nodes.map(node => node.id === 'a' ? { ...node, y: group.y + 2 } : node) }
  })
  const decisions: GraphLayoutDecision[] = []
  try {
    expect(() => withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'elk' } }))).toThrow(LayoutCertificationError)
    expect(producer).toHaveBeenCalledTimes(1)
    expect(decisions).toEqual([])
    expect(model).toEqual(original)
  } finally { producer.mockRestore() }
})

test('Architecture complete producer propagates unexpected defects without fallback', () => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice a(server)[A]'))
  const defect = new TypeError('controlled raw provider defect')
  const elk = spyOn(graphPlacement, 'layoutElkGraphPlacementSync').mockImplementation(() => { throw defect })
  const decisions: GraphLayoutDecision[] = []
  let caught: unknown
  try {
    try { withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'elk', fallback: 'none' } })) } catch (error) { caught = error }
    expect(caught).toBe(defect)
    expect(elk).toHaveBeenCalledTimes(1)
    expect(decisions).toEqual([])
  } finally { elk.mockRestore() }
})

test('Architecture rejects incompatible constraints without selecting an artifact', () => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign row z a\nalign column a z'))
  const elk = spyOn(graphPlacement, 'layoutElkGraphPlacementSync')
  const decisions: GraphLayoutDecision[] = []
  try {
    expect(() => withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'elk', fallback: 'none' } }))).toThrow('incompatible row and column constraints')
    expect(elk).toHaveBeenCalledTimes(1)
    expect(decisions).toEqual([])
  } finally { elk.mockRestore() }
})


test.each(['elk'] as const)('reversed equivalent alignment membership stays feasible with %s', backend => {
  for (const axis of ['row', 'column'] as const) {
    const model = parseArchitectureDiagram(toMermaidLines(`architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign ${axis} z a\nalign ${axis} a z`))
    const original = structuredClone(model), placed = layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })
    expect(model).toEqual(original)
    const [a, b] = placed.services
    expect(axis === 'row' ? a!.y + a!.height / 2 : a!.x + a!.width / 2).toBeCloseTo(axis === 'row' ? b!.y + b!.height / 2 : b!.x + b!.width / 2, 6)
    expect(a!.x < b!.x + b!.width && b!.x < a!.x + a!.width && a!.y < b!.y + b!.height && b!.y < a!.y + a!.height).toBe(false)
  }
})
