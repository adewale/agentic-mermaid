import { renderMermaidSVG, verifyMermaid } from '../agent/core.ts'
import { describe, expect, test } from 'bun:test'
import { parseWardleyBody, renderWardley, mutateWardley } from '../agent/wardley-body.ts'
import { layoutWardley } from '../wardley/layout.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { decodePng } from './helpers/png-pixels.ts'
import { resolveStyleStackWithFace } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'

const source = `wardley-beta
title Platform evolution
anchor Customer [0.95, 0.1]
component Service [0.6, 0.5] label [-12, 8] (build) inertia
component Power [0.2, 0.8]
pipeline Service {
  component Custom [0.3]
  component Utility [0.7]
}
Customer -> Service
Service +<> -.-> Power ;delivery
evolve Service 0.9
note "Keep all note text" [0.3, 0.4]
annotations [0.1, 0.8]
annotation 1, [0.4, 0.7] "Adopt utility"
accelerator Demand [0.7, 0.2]
deaccelerator Risk [0.3, 0.6]
`
describe('Wardley native source and geometry', () => {
  test('public Scene validation retains an inertial component and all of its owned artwork', () => {
    expect(verifyMermaid(source).ok).toBe(true)
    const svg = renderMermaidSVG(source)
    expect(svg).toContain('data-id="Service"')
    expect(svg).toContain('data-strategy="build"')
    expect(svg).toContain('Adopt utility')
  })

  test('canonical maps retain every native builder value through the pinned public Mermaid parser', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const body = parseWardleyBody(source)
      const { kind: _kind, title: _title, accessibilityTitle: _accTitle, accessibilityDescription: _accDescr, ...expected } = body
      const actual = await upstream.project(renderWardley(body), diagram => diagram.db.getWardleyData())
      expect(actual).toEqual({ ok: true, value: JSON.parse(JSON.stringify(expected)) })
      const edited = mutateWardley(body, { kind: 'add_note', text: '%%{init: {}}%%\nKeep all text', x: 20, y: 30 })
      if (!edited.ok) throw new Error(edited.error.message)
      const notes = await upstream.project(renderWardley(edited.value), diagram => diagram.db.getWardleyData().notes)
      expect(notes).toEqual({ ok: true, value: edited.value.notes })
    } finally { upstream.close() }
  })
  test('retains coordinates, pipelines, decorators, text and movement through writing', () => {
    const body = parseWardleyBody(source)
    expect(body.nodes.map(node => [node.id, node.x, node.y])).toEqual([['Customer', 10, 95], ['Service', 50, 60], ['Power', 80, 20], ['Service_Custom', 30, 60], ['Service_Utility', 70, 60]])
    expect(body.nodes[1]).toMatchObject({ labelOffsetX: -12, labelOffsetY: 8, sourceStrategy: 'build', inertia: true })
    expect(body.pipelines).toEqual([{ nodeId: 'Service', componentIds: ['Service_Custom', 'Service_Utility'] }])
    expect(body.links[1]).toEqual({ source: 'Service', target: 'Power', dashed: true, label: 'delivery', flow: 'bidirectional' })
    expect(body.annotations).toEqual([{ number: 1, coordinates: [{ x: 70, y: 40 }], text: 'Adopt utility' }])
    expect(parseWardleyBody(renderWardley(body))).toEqual(body)
    const layout = layoutWardley(body)
    const customer = layout.nodes.find(node => node.id === 'Customer')!, power = layout.nodes.find(node => node.id === 'Power')!
    expect(customer.x).toBeLessThan(power.x)
    expect(customer.y).toBeLessThan(power.y)
    expect(layout.pipelines[0]!.members).toEqual(['Service_Custom', 'Service_Utility'])
    expect(layout.labels.map(label => label.text)).toContain('Keep all note text')
  })
  test('moving a pipeline parent keeps child visibility and evolution targets coherent', () => {
    const body = parseWardleyBody(source), before = JSON.stringify(body)
    const moved = mutateWardley(body, { kind: 'set_component_position', id: 'Service', x: 55, y: 65 })
    if (!moved.ok) throw new Error(moved.error.message)
    expect(moved.value.nodes.filter(node => node.id.startsWith('Service')).map(node => [node.id, node.x, node.y])).toEqual([['Service', 55, 65], ['Service_Custom', 30, 65], ['Service_Utility', 70, 65]])
    expect(moved.value.trends).toEqual([{ nodeId: 'Service', targetX: 90, targetY: 65 }])
    expect(mutateWardley(body, { kind: 'set_component_position', id: 'Service_Custom', x: 50, y: 20 }).ok).toBe(false)
    expect(mutateWardley(body, { kind: 'set_component_position', id: 'Service', x: 101, y: 20 }).ok).toBe(false)
    expect(JSON.stringify(body)).toBe(before)
  })
  test('keeps authored annotation placement and negative label offsets inside the complete canvas', () => {
    const body = parseWardleyBody(source.replace('label [-12, 8]', 'label [-900, -600]'))
    const layout = layoutWardley(body), service = layout.nodes.find(node => node.id === 'Service')!
    const legend = layout.labels.find(label => label.id === 'annotation-text:0')!
    expect(legend.text).toBe('1. Adopt utility')
    expect(legend.x).toBeCloseTo(layout.plot.x + layout.plot.width * 0.8)
    expect(legend.y).toBeCloseTo(layout.plot.y + layout.plot.height * 0.9)
    expect(layout.labels.find(label => label.id === 'strategy:Service')?.text).toBe('[build]')
    expect(service.x - 900 - service.block.width / 2).toBeGreaterThanOrEqual(0)
    expect(service.y - 600 - service.block.height / 2).toBeGreaterThanOrEqual(0)
    expect(layout.width).toBeGreaterThan(900)
    expect(layout.height).toBeGreaterThan(600)
  })
  test('quoted mutation text cannot become a preprocessor directive or new statement', () => {
    const body = parseWardleyBody('wardley-beta\ncomponent A [0.5,0.5]')
    const edited = mutateWardley(body, { kind: 'add_note', text: '%%{init: {}}%%\ncomponent Injected', x: 30, y: 40 })
    if (!edited.ok) throw new Error(edited.error.message)
    expect(renderWardley(edited.value)).not.toContain('%%{')
    expect(parseWardleyBody(renderWardley(edited.value)).notes).toEqual([{ text: '%%{init: {}}%%\ncomponent Injected', x: 30, y: 40 }])
  })
})

// Text placement may adapt; authored map coordinates may not.
test('Wardley separates ordinary dense component captions without changing map coordinates', () => {
  const body = parseWardleyBody(['wardley-beta', ...Array.from({ length: 30 }, (_, i) => `component Component${i} [${0.1 + Math.floor(i / 10) * 0.35}, ${0.05 + i % 10 * 0.1}]`)].join('\n')), chart = layoutWardley(body)
  for (const node of chart.nodes) {
    expect(node.x).toBeCloseTo(chart.plot.x + node.node.x! / 100 * chart.plot.width)
    expect(node.y).toBeCloseTo(chart.plot.y + (1 - node.node.y! / 100) * chart.plot.height)
    expect(node.label?.text).toBe(node.node.label)
  }
  for (let i = 0; i < chart.nodes.length; i++) for (let j = i + 1; j < chart.nodes.length; j++) {
    const a = chart.nodes[i]!.label!, b = chart.nodes[j]!.label!
    expect(Math.abs(a.x - b.x) < (a.block.width + b.block.width) / 2 && Math.abs(a.y - b.y) < (a.block.height + b.block.height) / 2).toBe(false)
  }
  expect(chart.nodes.some(node => node.leader?.length === 2)).toBe(true)
  const svg = renderMermaidSVG(renderWardley(body))
  expect(svg).toContain('data-id="Component29"')
  expect(svg).not.toContain('NaN')
})

test('Wardley dashed dependencies and evolution retain visible dash paint', () => {
  const svg = renderMermaidSVG('wardley-beta\ncomponent A [0.6,0.2]\ncomponent B [0.2,0.8]\nA -.-> B\nevolve A 0.9')
  const dependency = svg.match(/<polyline\b[^>]*data-id="dependency:0"[^>]*>/)?.[0], evolution = svg.match(/<polyline\b[^>]*data-id="evolve:0"[^>]*>/)?.[0]
  expect(dependency!).toContain('stroke-dasharray=')
  expect(evolution!).toContain('stroke-dasharray=')
})

test('Wardley paints arrow ink in the declared dependency direction', () => {
  for (const [flow, start, end] of [['+>', false, true], ['+<', true, false], ['+<>', true, true]] as const) {
    for (const [a, b] of [[0.2, 0.8], [0.8, 0.2]]) {
      const svg = renderMermaidSVG(`wardley-beta\ncomponent A [0.8,${a}]\ncomponent B [0.8,${b}]\nA ${flow} -> B`)
      const tags = scanSvgStartTags(svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
      const edge = tags.find(tag => tag.attrs['data-id'] === 'dependency:0')!
      const route = edge.attrs.points!.replaceAll(',', ' ').trim().split(/\s+/).map(Number)
      expect(Math.sign(route.at(-2)! - route[0]!)).toBe(Math.sign(b! - a!))
      for (const [position, present] of [['start', start], ['end', end]] as const) {
        const reference = edge.attrs[`marker-${position}`]
        expect(Boolean(reference), `${flow}/${a}/${position}: painted arrow`).toBe(present)
        if (!present) continue
        const id = reference!.match(/^url\(#(.+)\)$/)![1]!
        const index = tags.findIndex(tag => tag.name === 'marker' && tag.attrs.id === id)
        const marker = tags[index]!.attrs, polygon = tags[index + 1]!
        expect(polygon.name).toBe('polygon')
        const values = polygon.attrs.points!.replaceAll(',', ' ').trim().split(/\s+/).map(Number)
        // SVG auto orientation follows the forward path tangent at either
        // endpoint. The triangle's tip is its second vertex; its back must
        // extend into the shaft, independently of relationship metadata.
        const rotation = position === 'start' && marker.orient === 'auto-start-reverse' ? -1 : 1
        expect(['auto', 'auto-start-reverse']).toContain(marker.orient!)
        expect((values[2]! - values[0]!) * rotation * (position === 'start' ? -1 : 1), `${flow}/${a}/${position}: actual tip direction`).toBeGreaterThan(0)
        expect([Number(marker.refX), Number(marker.refY)]).toEqual([values[2]!, values[3]!])
      }
    }
  }
})

test('Wardley arrowheads remain visible at each declared node surface', () => {
  for (const [declaration, radius, pipeline] of [['anchor', 7, false], ['component', 5, false], ['component', 9, false], ['component', 6, true], ['component', 9, true]] as const) {
    for (const style of ['accessible-high-contrast', 'crisp', { colors: { bg: '#ffffff', fg: '#000000' }, roles: { node: { lineWidth: 4 } } }] as const) {
      const prefix = `wardley-beta\n${declaration} A [0.5,0.25]${radius === 9 ? ' inertia' : ''}\n${declaration} B [0.5,0.75]${radius === 9 ? ' inertia' : ''}\n${pipeline ? 'pipeline A {\ncomponent A1 [0.1]\n}\npipeline B {\ncomponent B1 [0.9]\n}\n' : ''}`
      const options = { style, embedFontImport: false }
      const plain = decodePng(renderMermaidPNG(`${prefix}A -> B`, { ...options, scale: 1 }))
      const plainSvg = renderMermaidSVG(`${prefix}A -> B`, options)
      const tags = scanSvgStartTags(plainSvg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value])) }))
      const marks = ['25', '75'].map(value => tags.find(tag => tag.attrs['data-evolution'] === value)!)
      const centers = marks.map(mark => mark.name === 'rect' ? { x: Number(mark.attrs.x) + Number(mark.attrs.width) / 2, y: Number(mark.attrs.y) + Number(mark.attrs.height) / 2 } : { x: Number(mark.attrs.cx), y: Number(mark.attrs.cy) })
      const strokeHalf = Number(marks[0]!.attrs['stroke-width']) / 2
      const route = tags.find(tag => tag.attrs['data-id'] === 'dependency:0')!.attrs.points!.replaceAll(',', ' ').trim().split(/\s+/).map(Number)
      for (const [flow, heads] of [['+>', [false, true]], ['+<', [true, false]], ['+<>', [true, true]]] as const) {
        const directed = decodePng(renderMermaidPNG(`${prefix}A ${flow} -> B`, { ...options, scale: 1 }))
        expect([directed.width, directed.height]).toEqual([plain.width, plain.height])
        for (const [index, center] of centers.entries()) {
          let changed = 0
          for (let y = Math.floor(center.y - 12); y <= Math.ceil(center.y + 12); y++) for (let x = Math.floor(center.x - 20); x <= Math.ceil(center.x + 20); x++) {
            const offset = (y * plain.width + x) * 4
            if ([0, 1, 2, 3].some(channel => plain.rgba[offset + channel] !== directed.rgba[offset + channel])) changed++
          }
          if (heads[index]) expect(changed, `${declaration}/${radius}/${String(style)}/${flow}/${index}: visible arrow ink`).toBeGreaterThan(4)
          else expect(changed, `${declaration}/${radius}/${String(style)}/${flow}/${index}: no arrow ink`).toBe(0)
        }
      }
      expect(route[0]! - centers[0]!.x).toBeCloseTo(radius + strokeHalf, 2)
      expect(centers[1]!.x - route[2]!).toBeCloseTo(radius + strokeHalf, 2)
    }
  }
})

test('Wardley diagonal and vertical contacts follow painted surfaces without moving authored targets', () => {
  for (const decoration of ['anchor', 'component', 'inertia', 'pipeline'] as const) for (const [ax, ay, bx, by] of [[0.2, 0.2, 0.8, 0.8], [0.8, 0.8, 0.2, 0.2], [0.5, 0.2, 0.5, 0.8], [0.5, 0.8, 0.5, 0.2]] as const) {
    const body = parseWardleyBody(`wardley-beta\n${decoration === 'anchor' ? 'anchor' : 'component'} A [${ay},${ax}]${decoration === 'inertia' ? ' inertia' : ''}\ncomponent B [${by},${bx}]\n${decoration === 'pipeline' ? 'pipeline A {\ncomponent Child [0.1]\n}\n' : ''}A +<> -> B\nevolve A 0.95`)
    const chart = layoutWardley(body, {}, { node: { lineWidth: 4 } }), a = chart.nodes[0]!, b = chart.nodes[1]!
    for (const node of [a, b]) {
      expect(node.x).toBeCloseTo(chart.plot.x + node.node.x! / 100 * chart.plot.width)
      expect(node.y).toBeCloseTo(chart.plot.y + (1 - node.node.y! / 100) * chart.plot.height)
    }
    const first = chart.edges[0]!.points[0]!, last = chart.edges[0]!.points[1]!, dx = b.x - a.x, dy = b.y - a.y
    // Independent ray/circle and ray/square distances include the outer half
    // stroke. Both contacts must remain on the authored center-to-center ray.
    const distance = decoration === 'pipeline' ? 8 * Math.hypot(dx, dy) / Math.max(Math.abs(dx), Math.abs(dy)) : decoration === 'inertia' ? 11 : decoration === 'anchor' ? 9 : 7
    expect(Math.hypot(first.x - a.x, first.y - a.y)).toBeCloseTo(distance)
    expect(Math.hypot(last.x - b.x, last.y - b.y)).toBeCloseTo(7)
    expect((first.x - a.x) * dy - (first.y - a.y) * dx).toBeCloseTo(0)
    expect((last.x - b.x) * dy - (last.y - b.y) * dx).toBeCloseTo(0)
    const target = chart.edges[1]!.points[1]!
    expect(target.x).toBeCloseTo(chart.plot.x + chart.plot.width * 0.95)
    expect(target.y).toBeCloseTo(a.y)
  }
  const coincident = layoutWardley(parseWardleyBody('wardley-beta\ncomponent A [0.5,0.5]\ncomponent B [0.5,0.5]\nA +<> -> B\nevolve A 0.5'))
  expect(coincident.edges.flatMap(edge => edge.points).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
})

test('Wardley keeps clustered overflow captions clear of occupied legends and notes', () => {
  const clustered = (count: number, extras: string) => ['wardley-beta', ...Array.from({ length: count }, (_, i) => `component "Component number ${i} with full caption" [0.5,0.5]`), extras].join('\n')
  const cases: Array<{ source: string; options: RenderOptions }> = [
    { source: clustered(23, 'annotation 1, [0.2,0.2] "Legend text occupying fallback captions"'), options: {} },
    { source: clustered(30, 'annotation 1, [0.2,0.2] "First occupied legend"\nannotation 2, [0.1,0.1] "Second occupied legend"\nnote "An authored note" [0.45,0.25]').replace('" [0.5,0.5]', '" [0.5,0.5] label [-40,-20]'), options: { style: { roles: { node: { fontSize: 26, fontWeight: 700 } } } } },
  ]
  for (const { source, options } of cases) {
    const body = parseWardleyBody(source), original = JSON.stringify(body), chart = layoutWardley(body, options, resolveStyleStackWithFace(options.style).face)
    for (const node of chart.nodes) {
      expect(node.x).toBeCloseTo(chart.plot.x + node.node.x! / 100 * chart.plot.width)
      expect(node.y).toBeCloseTo(chart.plot.y + (1 - node.node.y! / 100) * chart.plot.height)
      if (node.node.labelOffsetX !== undefined) {
        expect(node.label!.x - node.x).toBe(node.node.labelOffsetX)
        expect(node.label!.y - node.y).toBe(node.node.labelOffsetY ?? -14)
        continue
      }
      for (const other of [...chart.labels, ...chart.nodes.filter(other => other !== node).map(other => other.label!)]) {
        const caption = node.label!
        expect(Math.abs(caption.x - other.x) < (caption.block.width + other.block.width) / 2 && Math.abs(caption.y - other.y) < (caption.block.height + other.block.height) / 2, `${node.id}/${other.id}: automatic text overlap`).toBe(false)
      }
    }
    expect(JSON.stringify(body)).toBe(original)
    expect(verifyMermaid(source, { renderOptions: options }).ok).toBe(true)
    expect(renderMermaidSVG(source, options)).toContain('Component number 22 with full caption')
  }
})
