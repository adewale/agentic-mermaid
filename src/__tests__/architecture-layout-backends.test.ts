import { createRequire } from 'node:module'
import { useTestChildren } from './helpers/test-child.ts'
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

const runInteractionChild = useTestChildren(20_000)

const native = { graphLayout: { backend: 'agentic' as const } }
const highContrastElk = { graphLayout: { backend: 'elk' as const, fallback: 'none' as const }, style: ['accessible-high-contrast', 'catppuccin-latte'], bg: '#111827', transparent: false, seed: 19, security: 'default' as const, embedFontImport: false }
const fixture = readFileSync(new URL('../../eval/layout-compare/fixtures/architecture-backends.mmd', import.meta.url), 'utf8')
const faces = 'architecture-beta\nservice left(disk)[Left]\nservice top(disk)[Top]\nservice bottom(disk)[Bottom]\nservice right(server)[Right]\njunction center\nleft:R --> L:center\ntop:B --> T:center\nbottom:T --> B:center\ncenter:R --> L:right'
const literalIcons = 'architecture-beta\nservice a "<b>日本 API</b>\\nSecond line" [Backend]\nservice b(database)[Storage]\na:R-->L:b'

describe('Architecture layout backends', () => {
  test.each((['agentic', 'elk'] as const).flatMap(backend => (['scene', 'native'] as const).map(admission => ({ backend, admission }))))('retains nested junction and group-boundary meanings with $backend through $admission', async ({ backend, admission }) => {
    // Hand-authored before parser/render calls: leaf sink remains the endpoint
    // identity while its group boundary supplies the physical bottom port.
    const interaction = {
      source: 'architecture-beta\ngroup outer(cloud)[Control]\ngroup inner(database)[Data] in outer\nservice edge-1(server)[Ingress] in outer\nservice sink(database)[Archive] in inner\nservice probe(server)[Monitor]\njunction relay in outer\nedge-1:R -[handoff]-> L:relay\nrelay:R -[handoff]-> L:sink\nsink{group}:B --> T:probe',
      groups: [
        { id: 'outer', label: 'Control', parent: null },
        { id: 'inner', label: 'Data', parent: 'outer' },
      ],
      services: [
        { id: 'edge-1', label: 'Ingress', parent: 'outer', icon: 'server' },
        { id: 'sink', label: 'Archive', parent: 'inner', icon: 'database' },
        { id: 'probe', label: 'Monitor', parent: null, icon: 'server' },
      ],
      junctions: [
        { id: 'relay', parent: 'outer' },
      ],
      relations: [
        { from: 'edge-1', to: 'relay', fromSide: 'R', toSide: 'L', fromBoundary: 'item', toBoundary: 'item', start: 'none', end: 'arrow', label: 'handoff' },
        { from: 'relay', to: 'sink', fromSide: 'R', toSide: 'L', fromBoundary: 'item', toBoundary: 'item', start: 'none', end: 'arrow', label: 'handoff' },
        { from: 'sink', to: 'probe', fromSide: 'B', toSide: 'T', fromBoundary: 'group', toBoundary: 'item', start: 'none', end: 'arrow', label: null },
      ],
    } as const

    const options = { graphLayout: { backend, fallback: 'none' as const }, embedFontImport: false }
    let packet: { rendered: ReturnType<typeof renderMermaidSVGWithReceipt>; parsed: ReturnType<typeof parseRegisteredMermaid>; stages: string[] }
    if (admission === 'native') {
      const child = await runInteractionChild(process.execPath, ['-e', `
        import { renderMermaidSVGWithReceipt, parseRegisteredMermaid } from './src/index.ts'
        import { withRenderStageObserver } from './src/render-stages.ts'
        const input = await Bun.stdin.text(), options = ${JSON.stringify(options)}, stages = []
        const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(input, options))
        console.log(JSON.stringify({ rendered, parsed: parseRegisteredMermaid(input), stages }))
      `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' }, input: interaction.source })
      expect(child.status, child.stderr).toBe(0)
      packet = JSON.parse(child.stdout)
      expect(packet.stages).toContain('drawing')
      expect(packet.stages).not.toContain('scene')
    } else {
      const stages: string[] = []
      const rendered = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(interaction.source, options))
      packet = { rendered, parsed: parseRegisteredMermaid(interaction.source), stages }
      expect(stages).toContain('scene')
    }
    expect(packet.rendered.receipt.layoutDecisions?.[0]?.selected).toBe(backend)
    if (!packet.parsed.ok) throw new Error('The independently authored interaction must parse')
    const body = packet.parsed.value.body

    if (body.kind !== 'architecture') throw new Error('Expected public structured Architecture')
    expect(body.groups.map(group => ({ id: group.id, label: group.label, parent: group.parentId ?? null }))).toEqual([...interaction.groups])
    expect(body.services.map(service => ({ id: service.id, label: service.label, parent: service.parentId ?? null, icon: service.icon }))).toEqual([...interaction.services])
    expect(body.junctions.map(junction => ({ id: junction.id, parent: junction.parentId ?? null }))).toEqual([...interaction.junctions])
    expect(body.edges.map(edge => ({ from: edge.source.id, to: edge.target.id, fromSide: edge.source.side, toSide: edge.target.side,
      fromBoundary: edge.source.boundary ?? 'item', toBoundary: edge.target.boundary ?? 'item', start: edge.hasArrowStart ? 'arrow' : 'none', end: edge.hasArrowEnd ? 'arrow' : 'none', label: edge.label ?? null }))).toEqual([...interaction.relations])
    const { JSDOM } = createRequire(import.meta.url)('jsdom')
    const dom = new JSDOM(packet.rendered.svg, { contentType: 'image/svg+xml' })
    try {
      const document = dom.window.document as Document
      const groups = [...document.querySelectorAll('g.architecture-group')], services = [...document.querySelectorAll('g.architecture-service')], junctions = [...document.querySelectorAll('g.architecture-junction')]
      expect(groups.map(group => group.getAttribute('data-id')).sort()).toEqual(interaction.groups.map(group => group.id).sort())
      expect(services.map(service => service.getAttribute('data-id')).sort()).toEqual(interaction.services.map(service => service.id).sort())
      expect(junctions.map(junction => junction.getAttribute('data-id'))).toEqual(interaction.junctions.map(junction => junction.id))
      const actualBoxes = new Map<string, { x: number; y: number; w: number; h: number }>()
      const rectangle = (element: Element) => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')), w: Number(element.getAttribute('width')), h: Number(element.getAttribute('height')) })
      for (const expected of interaction.groups) {
        const group = groups.find(element => element.getAttribute('data-id') === expected.id)!
        expect(group.querySelector(':scope > text.architecture-group-label')?.textContent).toBe(expected.label)
        actualBoxes.set(expected.id, rectangle(group.querySelector(':scope > rect.architecture-group-frame')!))
      }
      for (const expected of interaction.services) {
        const group = services.find(element => element.getAttribute('data-id') === expected.id)!
        expect(group.querySelector(':scope > text.architecture-service-label')?.textContent).toBe(expected.label)
        actualBoxes.set(expected.id, rectangle(group.querySelector(':scope > rect.architecture-service-card')!))
      }
      for (const expected of interaction.junctions) {
        const circle = junctions.find(element => element.getAttribute('data-id') === expected.id)!.querySelector('circle.architecture-junction-ring')!
        const radius = Number(circle.getAttribute('r'))
        actualBoxes.set(expected.id, { x: Number(circle.getAttribute('cx')) - radius, y: Number(circle.getAttribute('cy')) - radius, w: 2 * radius, h: 2 * radius })
      }
      for (const expected of [...interaction.groups, ...interaction.services, ...interaction.junctions]) {
        const box = actualBoxes.get(expected.id)!
        expect(box.w).toBeGreaterThan(0); expect(box.h).toBeGreaterThan(0)
        if (expected.parent) {
          const parent = actualBoxes.get(expected.parent)!
          expect(box.x).toBeGreaterThanOrEqual(parent.x); expect(box.y).toBeGreaterThanOrEqual(parent.y)
          expect(box.x + box.w).toBeLessThanOrEqual(parent.x + parent.w); expect(box.y + box.h).toBeLessThanOrEqual(parent.y + parent.h)
        }
      }
      const carriers = [...document.querySelectorAll('[data-role="edge"][data-from]')]
      expect(carriers.map(carrier => ({ from: carrier.getAttribute('data-from'), to: carrier.getAttribute('data-to'),
        fromSide: carrier.getAttribute('data-from-side'), toSide: carrier.getAttribute('data-to-side'), fromBoundary: carrier.getAttribute('data-from-boundary'), toBoundary: carrier.getAttribute('data-to-boundary'),
        start: carrier.hasAttribute('marker-start') ? 'arrow' : 'none', end: carrier.hasAttribute('marker-end') ? 'arrow' : 'none', label: carrier.getAttribute('data-label') }))).toEqual([...interaction.relations])
      expect(new Set(carriers.map(carrier => carrier.getAttribute('data-id'))).size).toBe(interaction.relations.length)
      for (const [index, carrier] of carriers.entries()) {
        const numbers = (carrier.getAttribute('points') ?? carrier.getAttribute('d')!).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)!.map(Number)
        const relation = interaction.relations[index]!
        for (const [id, side, boundary, x, y] of [[relation.from, relation.fromSide, relation.fromBoundary, numbers[0]!, numbers[1]!], [relation.to, relation.toSide, relation.toBoundary, numbers.at(-2)!, numbers.at(-1)!]] as const) {
          const owner = boundary === 'group' ? interaction.services.find(service => service.id === id)!.parent! : id
          const box = actualBoxes.get(owner)!
          expect(x).toBeCloseTo(side === 'L' ? box.x : side === 'R' ? box.x + box.w : box.x + box.w / 2, 5)
          expect(y).toBeCloseTo(side === 'T' ? box.y : side === 'B' ? box.y + box.h : box.y + box.h / 2, 5)
        }
      }
      const captions = [...document.querySelectorAll('text.architecture-edge-label-text')]
      expect(captions.map(text => text.textContent)).toEqual(['handoff', 'handoff'])
      expect(new Set(captions.map(text => [text.getAttribute('x'), text.getAttribute('y')].join(','))).size).toBe(2)
      // Parent/port/model and owned-output checks do not promote a paint
      // certificate or infer actual glyph visibility from element presence.
    } finally { dom.window.close() }
  })

  test.each([['alignment', fixture, native, 'agentic'], ['four faces', faces, native, 'agentic'], ['literal icons', literalIcons, native, 'agentic'], ['high-contrast stock alignment', fixture, highContrastElk, 'elk']] as const)('retains authored ports, junctions, alignments and complete routes: %s', (_name, source, options, backend) => {
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
    // the existing Native certification requirement explicit.
    if (backend === 'agentic') expect(rendered.receipt.layoutCertification?.status).toBe('passed')
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
      const text = renderMermaidASCIIWithReceipt(parsed.value, { ...native, colorMode: 'none' })
      expect(text.text).toContain('Second line')
      // Architecture projects pixel placement into cells, then independently
      // builds graphical companion evidence. Attribute both real placements.
      expect(text.receipt.layoutDecisions).toEqual([
        expect.objectContaining({ selected: backend, role: 'primary' }),
        expect.objectContaining({ selected: backend, role: 'companion' }),
      ])
    }
  })

  test('uses native placement across public surfaces and retains explicit ELK bytes', () => {
    const options = { ...native, nodeSpacing: 51 }, stages: string[] = [], parsed = parseRegisteredMermaid(fixture)
    if (!parsed.ok) throw new Error('fixture must parse')
    const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderMermaidSVGWithReceipt(fixture, options))
    expect(stages).toContain('agentic')
    expect(stages).not.toContain('elk')
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
    const placed = layoutArchitectureDiagram(model, native)
    expect(model).toEqual(original)
    expect(placed.edges.map(edge => [edge.source, edge.target])).toEqual(model.edges.map(edge => [edge.source, edge.target]))
    expect(placed.services.map(service => [service.id, service.parentId])).toEqual(model.services.map(service => [service.id, service.parentId]))
    const rendered = withRenderStageObserver(sample => { expect(sample.stage).not.toBe('elk') }, () => renderMermaidSVGWithReceipt(source, native))
    expect(rendered.receipt.layoutCertification?.status).toBe('passed')
    expect(rendered.receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('corpus input must parse')
    expect(renderMermaidSVGWithReceipt(parsed.value, native).svg).toBe(rendered.svg)
  })

  test('retains native empty frames and empty diagrams without fetching ELK', () => {
    const grouped = 'architecture-beta\ngroup g[Group]'
    const framed = withRenderStageObserver(sample => { expect(sample.stage).not.toBe('elk') }, () => renderMermaidSVGWithReceipt(grouped, native))
    expect(framed.svg).toContain('Group')
    expect(framed.receipt.layoutCertification?.status).toBe('passed')
    expect(renderMermaidSVGWithReceipt(grouped, { graphLayout: { backend: 'agentic', fallback: 'elk' } }).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
    expect(renderMermaidSVGWithReceipt('architecture-beta', native).receipt.layoutDecisions).toEqual([expect.objectContaining({ selected: 'agentic' })])
  })
// Row and column requests compose across groups; endpoint-side ordering must
// not restore an obsolete rank for one member of a declared row.
test.each(['elk', 'agentic'] as const)('composes row and column alignment before final %s routes', backend => {
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



test.each(['elk', 'agentic'] as const)('rejects inconsistent row and column centers explicitly with %s', backend => {
  const source = 'architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign row z a\nalign column a z'
  const model = parseArchitectureDiagram(toMermaidLines(source))
  expect(() => layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })).toThrow('incompatible row and column constraints')
})


test.each(['elk', 'agentic'] as const)('composes complete overlapping alignment components with %s', backend => {
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

test.each(['none', 'elk'] as const)('selects only a completed Architecture artifact with fallback=%s', fallback => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(server)[B]\na:T --> B:b'))
  const original = structuredClone(model), native = graphPlacement.layoutNativeGraphPlacementSync, elk = graphPlacement.layoutElkGraphPlacementSync
  // Corrupt the raw placement, not the finisher: its actual header and route
  // admission must reject the candidate before any selected decision escapes.
  const nativeProducer = spyOn(graphPlacement, 'layoutNativeGraphPlacementSync').mockImplementation((graph, options) => {
    const placed = native(graph, options), group = placed.groups.find(group => group.id === 'g')!
    return { ...placed, nodes: placed.nodes.map(node => node.id === 'a' ? { ...node, y: group.y + 2 } : node) }
  })
  const elkProducer = spyOn(graphPlacement, 'layoutElkGraphPlacementSync').mockImplementation((graph, options) => elk(graph, options))
  const decisions: GraphLayoutDecision[] = []
  let failure: unknown, placed: ReturnType<typeof layoutArchitectureDiagram> | undefined
  try {
    try { placed = withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'agentic', fallback } })) } catch (error) { failure = error }
    expect(nativeProducer).toHaveBeenCalledTimes(1)
    if (fallback === 'none') {
      expect(failure).toBeInstanceOf(LayoutCertificationError)
      expect((failure as Error).message).toContain('architecture-final-headers')
      expect(placed).toBeUndefined()
      expect(decisions).toEqual([])
      expect(elkProducer).not.toHaveBeenCalled()
    } else {
      expect(failure).toBeUndefined()
      expect(placed!.edges).toHaveLength(1)
      expect(placed!.edges[0]!.obstacleFree).toBe(true)
      expect(elkProducer).toHaveBeenCalledTimes(1)
      expect(decisions).toEqual([expect.objectContaining({ requested: 'agentic', fallback: 'elk', selected: 'elk', attempts: [expect.objectContaining({ backend: 'agentic', outcome: 'candidate-rejected' }), { backend: 'elk', outcome: 'selected' }] })])
    }
    expect(model).toEqual(original)
  } finally { nativeProducer.mockRestore(); elkProducer.mockRestore() }
})

test('Architecture complete producer propagates unexpected defects without fallback', () => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice a(server)[A]'))
  const defect = new TypeError('controlled raw provider defect')
  const native = spyOn(graphPlacement, 'layoutNativeGraphPlacementSync').mockImplementation(() => { throw defect })
  const elk = spyOn(graphPlacement, 'layoutElkGraphPlacementSync')
  const decisions: GraphLayoutDecision[] = []
  let caught: unknown
  try {
    try { withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'agentic', fallback: 'elk' } })) } catch (error) { caught = error }
    expect(caught).toBe(defect)
    expect(elk).not.toHaveBeenCalled()
    expect(decisions).toEqual([])
  } finally { native.mockRestore(); elk.mockRestore() }
})

test('Architecture rejects constraints that neither complete backend can satisfy', () => {
  const model = parseArchitectureDiagram(toMermaidLines('architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign row z a\nalign column a z'))
  const native = spyOn(graphPlacement, 'layoutNativeGraphPlacementSync'), elk = spyOn(graphPlacement, 'layoutElkGraphPlacementSync')
  const decisions: GraphLayoutDecision[] = []
  try {
    expect(() => withGraphLayoutDecisionObserver(decision => decisions.push(decision), () => layoutArchitectureDiagram(model, { graphLayout: { backend: 'agentic', fallback: 'elk' } }))).toThrow('incompatible row and column constraints')
    expect(native).toHaveBeenCalledTimes(1)
    expect(elk).toHaveBeenCalledTimes(1)
    expect(decisions).toEqual([])
  } finally { native.mockRestore(); elk.mockRestore() }
})


test.each(['elk', 'agentic'] as const)('reversed equivalent alignment membership stays feasible with %s', backend => {
  for (const axis of ['row', 'column'] as const) {
    const model = parseArchitectureDiagram(toMermaidLines(`architecture-beta\nservice z(server)[Z]\nservice a(server)[A]\nalign ${axis} z a\nalign ${axis} a z`))
    const original = structuredClone(model), placed = layoutArchitectureDiagram(model, { graphLayout: { backend, fallback: 'none' } })
    expect(model).toEqual(original)
    const [a, b] = placed.services
    expect(axis === 'row' ? a!.y + a!.height / 2 : a!.x + a!.width / 2).toBeCloseTo(axis === 'row' ? b!.y + b!.height / 2 : b!.x + b!.width / 2, 6)
    expect(a!.x < b!.x + b!.width && b!.x < a!.x + a!.width && a!.y < b!.y + b!.height && b!.y < a!.y + a!.height).toBe(false)
  }
})
