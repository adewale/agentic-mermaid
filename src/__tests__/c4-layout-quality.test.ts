import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, layoutMermaid, parseRegisteredMermaid, describeMermaidFacts, verifyMermaid } from '../agent/core.ts'
import { scanSvgStartTags } from '../svg-structure.ts'

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

  test('authored offsets remain authoritative and verification rejects the resulting hidden marker', () => {
    const source = 'C4Context\nSystem(a,"Alpha")\nSystem(b,"Beta")\nRel(a,b,"Visible text")'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const edge = layoutMermaid(parsed.value).edges[0]!, tip = edge.path.at(-1)!
    const shifted = `${source}\nUpdateRelStyle(a,b,$offsetX="${tip[0] - edge.label!.x}",$offsetY="${tip[1] - edge.label!.y}")`
    const output = painted(renderMermaidSVG(shifted)), verification = verifyMermaid(shifted)
    expect(output.halos.some(halo => output.cards.some(card => overlaps(halo, card)))).toBe(true)
    expect(verification.ok).toBe(false)
    expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'CONTENT_OCCLUDED', target: 'c4-rel-1', feature: 'marker' }))
    expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'CONTENT_OCCLUDED', target: 'c4-rel-1', feature: 'label' }))
  })

  test('a label that hides a different interaction shaft is diagnosed even without another label or card collision', () => {
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
    expect(verification.ok).toBe(false)
    expect(verification.warnings).toContainEqual(expect.objectContaining({ code: 'CONTENT_OCCLUDED', target: 'c4-rel-1', feature: 'label' }))
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
