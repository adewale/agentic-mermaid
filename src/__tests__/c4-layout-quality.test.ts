import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, layoutMermaid, parseRegisteredMermaid, describeMermaidFacts, verifyMermaid } from '../agent/core.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import type { FamilyDescriptor } from '../agent/families.ts'
import { LayoutCertificationError } from '../layout/certification-error.ts'
import { renderLoadedFamilySvg } from '../browser-lazy/render-core.ts'
import { measureQuality } from '../agent/quality.ts'
import type { PositionedC4Diagram } from '../c4/layout.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { extractOfficialCorpus } from '../../eval/shared/official-fences.ts'
import { C4RouteWorkLimitError } from '../c4/routing.ts'

interface Box { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .01 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .01
function painted(svg: string) {
  const tags = scanSvgStartTags(svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])) }))
  const rect = (attrs: Record<string, string>): Box => ({ x: Number(attrs.x), y: Number(attrs.y), width: Number(attrs.width), height: Number(attrs.height) })
  return {
    halos: tags.flatMap((tag, index) => tag.attrs['data-role'] === 'edge-label' && tags[index + 1]?.name === 'rect' ? [{ ...rect(tags[index + 1]!.attrs), id: tag.attrs['data-edge-id']! }] : []),
    cards: tags.filter(tag => tag.name === 'rect' && tag.attrs['data-id']?.endsWith(':surface')).map(tag => rect(tag.attrs)),
    routes: tags.filter(tag => tag.name === 'polyline' && tag.attrs['data-c4-macro']).map(tag => ({ id: tag.attrs['data-id']!, points: tag.attrs.points!.split(' ').map(pair => pair.split(',').map(Number) as [number, number]), start: tag.attrs['data-arrow-start'] === 'true', end: tag.attrs['data-arrow-end'] === 'true' })),
  }
}
function emittedMarkerBoxes(svg: string): Box[] {
  const tags = scanSvgStartTags(svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])) }))
  const resources = new Map(tags.flatMap((tag, index) => tag.name === 'marker' && tags[index + 1]?.name === 'polygon' ? [[tag.attrs.id!, { attrs: tag.attrs, polygon: tags[index + 1]!.attrs }] as const] : []))
  const boxes: Box[] = []
  for (const tag of tags.filter(tag => tag.name === 'polyline' && tag.attrs['data-c4-macro'])) {
    const points = tag.attrs.points!.split(' ').map(pair => pair.split(',').map(Number) as [number, number])
    for (const end of ['start', 'end'] as const) {
      const href = tag.attrs[`marker-${end}`]
      if (!href) continue
      const marker = resources.get(href.slice(5, -1))!, tip = points.at(end === 'start' ? 0 : -1)!
      const before = (end === 'start' ? points.slice(1) : points.slice(0, -1).reverse()).find(point => point[0] !== tip[0] || point[1] !== tip[1])!
      const angle = end === 'start' ? Math.atan2(before[1] - tip[1], before[0] - tip[0]) : Math.atan2(tip[1] - before[1], tip[0] - before[0])
      const scale = marker.attrs.markerUnits === 'userSpaceOnUse' ? 1 : Number(tag.attrs['stroke-width'] ?? 1)
      const values = marker.polygon.points!.replaceAll(',', ' ').trim().split(/\s+/).map(Number), transformed: Array<[number, number]> = []
      for (let index = 0; index < values.length; index += 2) {
        const x = (values[index]! - Number(marker.attrs.refX ?? 0)) * scale, y = (values[index + 1]! - Number(marker.attrs.refY ?? 0)) * scale
        transformed.push([tip[0] + x * Math.cos(angle) - y * Math.sin(angle), tip[1] + x * Math.sin(angle) + y * Math.cos(angle)])
      }
      const pad = Number(marker.polygon['stroke-width'] ?? 0) * scale / 2, xs = transformed.map(point => point[0]), ys = transformed.map(point => point[1])
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
      boxes.push({ x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y })
    }
  }
  return boxes
}
const ANCESTOR = 'C4Deployment\nNode(parent,"Parent","Cloud") {\nContainer(child,"Child","JS")\n}\nRel(child,parent,"Reports up")'
const PARALLEL = 'C4Deployment\nNode(parent,"Parent","Cloud") {\nContainer(child,"Child","JS")\n}\nRel(parent,child,"Deploys")\nRel(child,parent,"Reports")\nBiRel(parent,child,"Coordinates")\nRel(parent,parent,"Maintains")'
const DENSE = `C4Container\nSystem_Boundary(app,"Application") {\n${Array.from({ length: 7 }, (_, i) => `Container(n${i},"Service ${i}","HTTP")`).join('\n')}\n}\n${Array.from({ length: 7 }, (_, from) => Array.from({ length: 6 - from }, (_, j) => `Rel(n${from},n${from + j + 1},"Interaction ${from} to ${from + j + 1}","HTTPS")`).join('\n')).join('\n')}`

describe('C4 measured pixel layout quality', () => {
  test('native and lazy rendering expose exhausted physical route work instead of retaining an unchecked route', async () => {
    const source = ['C4Context', ...Array.from({ length: 201 }, (_, i) => `System(n${i},"Card ${i}")`), ...Array.from({ length: 1000 }, () => 'Rel(n0,n1,"Repeated")')].join('\n')
    expect(() => renderMermaidSVG(source)).toThrow(C4RouteWorkLimitError)
    const { default: browser } = await import('../browser-lazy/families/c4.ts')
    await expect(renderLoadedFamilySvg(source, {}, browser)).rejects.toMatchObject({ name: 'C4RouteWorkLimitError', code: 'C4_ROUTE_WORK_LIMIT' })
  })

  test.each([2, 4])('official C4 fence %s keeps final relationship shafts clear of unrelated cards', index => {
    const source = extractOfficialCorpus().find(fence => fence.id === `c4:official-syntax/c4.md#${index}`)!.source
    expect(() => renderMermaidSVG(source)).not.toThrow()
    expect(verifyMermaid(source).ok).toBe(true)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'c4') throw new Error('Expected structured official C4 source')
    const layout = layoutMermaid(parsed.value, { debug: true })
    expect(layout.edges).toHaveLength(parsed.value.body.relationships.length)
    for (const edge of layout.edges) {
      const authored = parsed.value.body.relationships.find(relationship => relationship.id === edge.id)!
      expect([edge.from, edge.to]).toEqual([authored.source, authored.target])
      expect(edge.label?.text).toContain(authored.label)
      for (const [id, point] of [[edge.from, edge.path[0]!], [edge.to, edge.path.at(-1)!]] as const) {
        const card = layout.nodes.find(node => node.id === id)!
        expect(point[0] >= card.x - .01 && point[0] <= card.x + card.w + .01 && point[1] >= card.y - .01 && point[1] <= card.y + card.h + .01).toBe(true)
        expect(Math.min(Math.abs(point[0] - card.x), Math.abs(point[0] - card.x - card.w), Math.abs(point[1] - card.y), Math.abs(point[1] - card.y - card.h))).toBeLessThan(.01)
      }
      for (const card of layout.nodes) {
        if (card.id === edge.from || card.id === edge.to) continue
        for (let i = 1; i < edge.path.length; i++) {
          const [ax, ay] = edge.path[i - 1]!, [bx, by] = edge.path[i]!
          const crossed = ax === bx
            ? ax > card.x + .01 && ax < card.x + card.w - .01 && Math.min(Math.max(ay, by), card.y + card.h) - Math.max(Math.min(ay, by), card.y) > .01
            : ay === by && ay > card.y + .01 && ay < card.y + card.h - .01 && Math.min(Math.max(ax, bx), card.x + card.w) - Math.max(Math.min(ax, bx), card.x) > .01
          expect(crossed, `${edge.id} crosses ${card.id}`).toBe(false)
        }
      }
    }
  })

  test('public C4 projections retain the text drawn on cards, frames, routes, title and legend', () => {
    const source = 'C4Deployment\ntitle Runtime\nNode(parent,"Production","Linux") {\nContainer(api,"API","Go")\n}\nPerson(user,"User")\nRel(user,api,"Calls","HTTPS")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const layout = layoutMermaid(parsed.value)
    const quality = measureQuality(layout)
    expect(quality.labelMeasurement.measuredNodes).toBe(2)
    expect(quality.labelMeasurement.unmeasuredNodes).toBe(0)
    expect(quality.labelMeasurement.measuredEdges).toBe(1)
    expect(quality.labelMeasurement.unmeasuredEdges).toBe(0)
    expect(layout.labels?.some(label => label.id === 'boundary-label:parent' && label.text.includes('Production'))).toBe(true)
    expect(layout.labels?.some(label => label.id === 'title' && label.text === 'Runtime')).toBe(true)
    expect(layout.labels?.some(label => label.id === 'legend:heading' && label.text === 'Legend')).toBe(true)
    expect(layout.labels!.filter(label => label.id.startsWith('legend:entry:')).length).toBeGreaterThan(0)
    expect(quality.labelLegibility).toBe(1)
    expect(verifyMermaid(parsed.value).warnings.some(warning => warning.code === 'RENDER_FAILED')).toBe(false)
  })

  test('person and database label bounds use their emitted glyph offsets', () => {
    const source = 'C4Context\nPerson(user,"User")\nContainerDb(store,"Store","SQL")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const layout = layoutMermaid(parsed.value), svg = renderMermaidSVG(source)
    for (const [id, shape] of [['user', 'person'], ['store', 'container']] as const) {
      const start = svg.indexOf(`class="node c4-${shape}"`)
      expect(start).toBeGreaterThan(0)
      const text = scanSvgStartTags(svg.slice(start)).find(tag => tag.name === 'text')!
      const attrs = Object.fromEntries(text.attributes.map(attribute => [attribute.name, attribute.value]))
      const bounds = layout.nodes.find(node => node.id === id)!.labelBounds!
      expect(bounds.x + bounds.w / 2).toBeCloseTo(Number(attrs.x), 8)
      expect(bounds.y + bounds.h / 2).toBeCloseTo(Number(attrs.y), 8)
    }
  })

  test.each(['off-canvas-text', 'missing-relation', 'duplicate-relation', 'endpoint', 'marker', 'node-text', 'group-text', 'edge-text', 'text-display', 'text-transform', 'title-text', 'legend-text', 'legend-heading', 'missing-title', 'missing-legend'] as const)('native and lazy C4 reject %s before lowering once', async mutation => {
    const source = 'C4Deployment\ntitle Runtime\nNode(parent,"Production","Linux") {\nContainer(api,"API","Go")\n}\nPerson(user,"User")\nRel(user,api,"Calls","HTTPS")'
    const native = getFamily('c4')!
    const { default: browser } = await import('../browser-lazy/families/c4.ts')
    for (const [descriptor, lazy] of [[native, false], [browser, true]] as const) {
      let layoutCalls = 0
      let loweringCalls = 0
      const invalid: FamilyDescriptor = {
        ...descriptor,
        layout: context => {
          layoutCalls++
          const result = descriptor.layout!(context)
          const positioned = ('positioned' in result ? result.positioned : result) as PositionedC4Diagram
          const node = positioned.nodes[0]!
          if (mutation === 'off-canvas-text') node.labelBlock = { ...node.labelBlock!, width: positioned.width * 10 }
          if (mutation === 'missing-relation') positioned.edges = []
          if (mutation === 'duplicate-relation') positioned.edges.push({ ...positioned.edges[0]! })
          if (mutation === 'endpoint') positioned.edges[0]!.target = 'user'
          if (mutation === 'marker') positioned.edges[0]!.hasArrowEnd = false
          if (mutation === 'node-text' || mutation === 'group-text' || mutation === 'edge-text') {
            const owner = mutation === 'node-text' ? node : mutation === 'group-text' ? positioned.groups[0]! : positioned.edges[0]!
            const block = owner.labelBlock!
            owner.labelBlock = preparePixelText('Zebra', { display: 'literal', fontSize: block.fontSize, fontWeight: block.fontWeight })
          }
          if (mutation === 'text-display' || mutation === 'text-transform') {
            const block = node.labelBlock!
            node.labelBlock = { ...block, prepared: { ...block.prepared, ...(mutation === 'text-display' ? { display: 'formatted' as const } : { transform: 'uppercase' as const }) } }
          }
          if (mutation === 'title-text') positioned.title!.block = preparePixelText('Zebra', { display: 'literal', fontSize: 18, fontWeight: 600 })
          if (mutation === 'legend-text') positioned.legend!.entries[0]!.block = preparePixelText('Zebra', { display: 'literal', fontSize: 11, fontWeight: 400 })
          if (mutation === 'legend-heading') positioned.legend!.heading = preparePixelText('Zebra', { display: 'literal', fontSize: 13, fontWeight: 600 })
          if (mutation === 'missing-title') delete positioned.title
          if (mutation === 'missing-legend') delete positioned.legend
          return { positioned }
        },
        lowerScene: context => {
          loweringCalls++
          return descriptor.lowerScene!(context)
        },
      }
      if (lazy) await expect(renderLoadedFamilySvg(source, {}, invalid)).rejects.toBeInstanceOf(LayoutCertificationError)
      else {
        const restore = replaceFamilyForTest('c4', invalid)
        try { expect(() => renderMermaidSVG(source)).toThrow(LayoutCertificationError) } finally { restore() }
      }
      expect(layoutCalls).toBe(1)
      expect(loweringCalls).toBe(0)
    }
  })

  test('relationships between facing cards of different heights run straight instead of stepping a few pixels', () => {
    // A container and a shorter database face each other; their evenly spaced
    // ports sit about 3px apart, which drew as a dogleg on each relationship.
    const svg = renderMermaidSVG(`C4Container
  title Orders
  Container(api, "Orders API", "TypeScript", "Accepts orders and serves order status to every client")
  ContainerDb(db, "Store", "Postgres")
  Rel(api, db, "Reads")
  Rel(api, db, "Writes")`)
    const routes = painted(svg).routes
    expect(routes).toHaveLength(2)
    for (const route of routes) {
      expect({ id: route.id, levels: new Set(route.points.map(([, y]) => y)).size }).toEqual({ id: route.id, levels: 1 })
    }
  })

  test('scaled SVG arrowheads, including their painted stroke, remain inside the final viewport', () => {
    for (const source of ['C4Context\nSystem(a,"A")\nRel(a,a,"Self")', PARALLEL]) for (const lineWidth of [12, 8]) {
      const svg = renderMermaidSVG(source, { style: { roles: { edge: { lineWidth } } } })
      const viewBox = scanSvgStartTags(svg).find(tag => tag.name === 'svg')!.attributes.find(attr => attr.name === 'viewBox')!.value.split(' ').map(Number)
      const markers = emittedMarkerBoxes(svg)
      expect(markers.length).toBeGreaterThan(0)
      for (const marker of markers) {
        expect(marker.x).toBeGreaterThanOrEqual(viewBox[0]!)
        expect(marker.y).toBeGreaterThanOrEqual(viewBox[1]!)
        expect(marker.x + marker.width).toBeLessThanOrEqual(viewBox[0]! + viewBox[2]!)
        expect(marker.y + marker.height).toBeLessThanOrEqual(viewBox[1]! + viewBox[3]!)
      }
    }
  })
  test('overlapping scaled self-interaction markers are reported as visibility errors', () => {
    const source = 'C4Dynamic\nContainer(a,"API","HTTP")\n' + Array.from({ length: 4 }, (_, index) => `Rel(a,a,"Retry ${index}","Timer")`).join('\n')
    const options = { style: { roles: { edge: { lineWidth: 12 } } } }, svg = renderMermaidSVG(source, options), boxes = emittedMarkerBoxes(svg)
    expect(boxes).toHaveLength(4)
    expect(boxes.some((box, index) => boxes.slice(0, index).some(other => overlaps(box, other)))).toBe(true)
    const verification = verifyMermaid(source, { renderOptions: options })
    expect(verification.ok).toBe(false)
    for (const target of ['c4-rel-1', 'c4-rel-2', 'c4-rel-3', 'c4-rel-4']) expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'CONTENT_OCCLUDED', target, feature: 'marker' }))
  })
  for (const [name, source, count] of [['ancestor', ANCESTOR, 1], ['parallel ancestor and self', PARALLEL, 4]] as const) test(`${name} retains visible arrowheads and unobscured relationship labels`, () => {
    const output = painted(renderMermaidSVG(source))
    expect(output.routes).toHaveLength(count)
    expect(output.halos).toHaveLength(count)
    for (const [index, halo] of output.halos.entries()) {
      for (const card of output.cards) expect(overlaps(halo, card), `${halo.id} overlaps a painted card`).toBe(false)
      for (const earlier of output.halos.slice(0, index)) expect(overlaps(halo, earlier), `${halo.id} overlaps ${earlier.id}`).toBe(false)
    }
    for (const route of output.routes) for (const start of [false, true]) {
      if (!(start ? route.start : route.end)) continue
      const tip = route.points.at(start ? 0 : -1)!, before = route.points.at(start ? 1 : -2)!
      const length = Math.hypot(tip[0] - before[0], tip[1] - before[1])
      expect(length, `${route.id} must have a real final segment`).toBeGreaterThan(8)
      // The default emitted SVG marker is an 8x5 triangle, anchored at its
      // tip. Check its actual oriented envelope against every painted halo.
      const ux = (tip[0] - before[0]) / length, uy = (tip[1] - before[1]) / length
      const vertices = [tip, [tip[0] - ux * 8 - uy * 2.5, tip[1] - uy * 8 + ux * 2.5], [tip[0] - ux * 8 + uy * 2.5, tip[1] - uy * 8 - ux * 2.5]]
      const xs = vertices.map(point => point[0]!), ys = vertices.map(point => point[1]!)
      const marker = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
      for (const halo of output.halos) expect(overlaps(marker, halo), `${route.id} arrow is hidden by ${halo.id}`).toBe(false)
    }
  })

  test('dense interactions either have disjoint painted label halos or report their exact visibility limitation', () => {
    const output = painted(renderMermaidSVG(DENSE)), verification = verifyMermaid(DENSE)
    expect(output.routes).toHaveLength(21)
    expect(output.halos).toHaveLength(21)
    for (const [index, halo] of output.halos.entries()) for (const earlier of output.halos.slice(0, index)) {
      if (overlaps(halo, earlier)) {
        expect(verification.ok).toBe(false)
        expect(verification.warnings.some(warning => warning.code === 'CONTENT_OCCLUDED' && warning.feature === 'label' && (warning.target === halo.id || warning.target === earlier.id)), `${halo.id} and ${earlier.id} overlap without a visibility warning`).toBe(true)
      }
    }
    expect(renderMermaidSVG(DENSE)).toBe(renderMermaidSVG(DENSE))
  })

  test('a pixel width budget reflows rows without scaling or rewriting the authored model', () => {
    const source = 'C4Context\nSystem(a,"Alpha")\nSystem(b,"Beta")\nSystem(c,"Gamma")\nSystem(d,"Delta")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const wide = layoutMermaid(parsed.value), opts = { mermaidConfig: { c4: { maxWidth: 500 } } }, narrow = layoutMermaid(parsed.value, opts)
    expect(narrow.bounds.w).toBeLessThanOrEqual(500)
    expect(narrow.bounds.w).toBeLessThan(wide.bounds.w)
    expect(narrow.bounds.h).toBeGreaterThanOrEqual(wide.bounds.h)
    expect(narrow.nodes[2]!.y).toBeGreaterThan(wide.nodes[2]!.y)
    expect(narrow.nodes.map(node => node.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(narrow.nodes.map(node => node.label)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
    expect(narrow.nodes.map(node => node.w)).toEqual(wide.nodes.map(node => node.w))
    expect(renderMermaidSVG(source, opts)).toBe(renderMermaidSVG(source, opts))
    const facts = describeMermaidFacts(parsed.value)
    renderMermaidSVG(parsed.value, opts)
    expect(describeMermaidFacts(parsed.value)).toEqual(facts)
  })

  test('an impossible width budget preserves labels and reports overflow instead of clipping', () => {
    const source = 'C4Context\nSystem(a,"Unclipped content")', options = { mermaidConfig: { c4: { maxWidth: 80 } } }
    expect(renderMermaidSVG(source, options)).toContain('Unclipped')
    expect(verifyMermaid(source, { renderOptions: options }).warnings.some(warning => warning.code === 'LAYOUT_LIMIT_EXCEEDED' && warning.constraint === 'c4.maxWidth')).toBe(true)
  })

  test('authored offsets displace clear labels and allocation avoids otherwise hidden markers', () => {
    const source = 'C4Context\nSystem(a,"Alpha")\nSystem(b,"Beta")\nRel(a,b,"Visible text")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const edge = layoutMermaid(parsed.value).edges[0]!, tip = edge.path.at(-1)!
    const shiftedClear = parseRegisteredMermaid(`${source}\nUpdateRelStyle(a,b,$offsetX="5",$offsetY="3")`)
    if (!shiftedClear.ok) throw new Error(JSON.stringify(shiftedClear.error))
    const clearOffset = layoutMermaid(shiftedClear.value).edges[0]!.label!
    expect(clearOffset.x - edge.label!.x).toBeCloseTo(5, 8)
    expect(clearOffset.y - edge.label!.y).toBeCloseTo(3, 8)
    const shifted = `${source}\nUpdateRelStyle(a,b,$offsetX="${tip[0] - edge.label!.x}",$offsetY="${tip[1] - edge.label!.y}")`
    const output = painted(renderMermaidSVG(shifted)), verification = verifyMermaid(shifted)
    expect(output.halos).toHaveLength(1)
    expect(output.halos.some(halo => output.cards.some(card => overlaps(halo, card)))).toBe(false)
    for (const marker of emittedMarkerBoxes(renderMermaidSVG(shifted))) expect(overlaps(marker, output.halos[0]!)).toBe(false)
    expect(verification.ok).toBe(true)
    expect(verification.warnings.some(warning => warning.code === 'CONTENT_OCCLUDED')).toBe(false)
  })

  test('an authored displacement is scored against other interaction shafts before selecting a label slot', () => {
    const source = 'C4Context\nSystem(a,"Alpha")\nSystem(b,"Beta")\nSystem(c,"Gamma")\nSystem(d,"Delta")\nUpdateLayoutConfig($c4ShapeInRow="2")\nRel(a,b,"x")\nRel(c,d,"")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const layout = layoutMermaid(parsed.value), label = layout.edges[0]!.label!, route = layout.edges[1]!.path
    const start = route[0]!, end = route.at(-1)!
    const shifted = `${source}\nUpdateRelStyle(a,b,$offsetX="${(start[0] + end[0]) / 2 - label.x}",$offsetY="${(start[1] + end[1]) / 2 - label.y}")`
    const output = painted(renderMermaidSVG(shifted)), verification = verifyMermaid(shifted)
    expect(output.routes).toHaveLength(2)
    expect(output.halos).toHaveLength(1)
    expect(output.cards.every(card => !overlaps(output.halos[0]!, card))).toBe(true)
    const halo = output.halos[0]!, other = output.routes.find(route => route.id === 'c4-rel-2')!
    for (const [index, point] of other.points.slice(1).entries()) {
      const before = other.points[index]!
      const horizontal = Math.abs(point[1] - before[1]) < .001
      const crosses = horizontal ? point[1] > halo.y && point[1] < halo.y + halo.height && Math.max(point[0], before[0]) > halo.x && Math.min(point[0], before[0]) < halo.x + halo.width
        : point[0] > halo.x && point[0] < halo.x + halo.width && Math.max(point[1], before[1]) > halo.y && Math.min(point[1], before[1]) < halo.y + halo.height
      expect(crosses).toBe(false)
    }
    expect(verification.ok).toBe(true)
    expect(verification.warnings.some(warning => warning.code === 'CONTENT_OCCLUDED')).toBe(false)
  })

  test('nested reflow preserves parent membership and routes while compact uses independent measured extents', () => {
    const source = 'C4Container\nSystem_Boundary(parent,"Application") {\nContainer(c4_rel_1,"Gateway","HTTP")\nContainer(db,"Database","SQL")\nContainer(worker,"Worker","Queue")\n}\nRel(c4_rel_1,db,"Writes")\nRel(db,worker,"Dispatches")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const narrow = layoutMermaid(parsed.value, { mermaidConfig: { c4: { maxWidth: 500 } } }), compact = layoutMermaid(parsed.value, { mermaidConfig: { c4: { maxWidth: 500, compact: true } } })
    expect(narrow.bounds.w).toBeLessThanOrEqual(500)
    expect(compact.bounds.w).toBeLessThanOrEqual(500)
    // Compact spacing permits two cards on the first row here. A preset is
    // not a total-area optimizer: rerouting may trade width for height.
    expect(compact.bounds.h).toBeLessThan(narrow.bounds.h)
    expect(compact.nodes.every((node, index) => node.w < narrow.nodes[index]!.w)).toBe(true)
    expect(compact.nodes[0]!.x - compact.groups[0]!.x).toBeLessThan(narrow.nodes[0]!.x - narrow.groups[0]!.x)
    for (const layout of [narrow, compact]) {
      expect(layout.nodes.map(node => node.parentId)).toEqual(['parent', 'parent', 'parent'])
      expect(layout.edges.map(edge => [edge.id, edge.from, edge.to])).toEqual([['c4-rel-1', 'c4_rel_1', 'db'], ['c4-rel-2', 'db', 'worker']])
      expect(layout.edges.every(edge => edge.path.length >= 2)).toBe(true)
    }
  })
})
