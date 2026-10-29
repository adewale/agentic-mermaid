import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { layoutMermaidWithReceipt } from '../agent/index.ts'
import { scanSvgStartTags } from '../svg-structure.ts'
import type { RenderOptions } from '../types.ts'
import { colorPixelBox, redPixel } from './helpers/raster.ts'

interface Point { x: number; y: number }
interface Tag { name: string; attrs: Record<string, string> }
const tags = (svg: string): Tag[] => scanSvgStartTags(svg).map(tag => ({ name: tag.name, attrs: Object.fromEntries(tag.attributes.map(attr => [attr.name, attr.value])) }))
const numbers = (text: string): number[] => (text.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)

function routePoints(tag: Tag): Point[] {
  if (tag.name === 'line') return [{ x: Number(tag.attrs.x1), y: Number(tag.attrs.y1) }, { x: Number(tag.attrs.x2), y: Number(tag.attrs.y2) }]
  const coords = numbers(tag.attrs.points ?? tag.attrs.d!)
  // These public fixtures emit open polylines or M/L/Q rounded routes. Their
  // first and last pairs are anchors; controls are never endpoint tangents.
  return Array.from({ length: coords.length / 2 }, (_, i) => ({ x: coords[i * 2]!, y: coords[i * 2 + 1]! }))
}

/** Independent SVG placement math. It reads final public markup, never the
 * production clipper, marker bounds or Scene terminal projection. */
function visibleContact(svg: Tag[], route: Tag, end: 'start' | 'end', contact: Point): Point {
  const resource = route.attrs[`marker-${end}`]?.match(/^url\(#(.+)\)$/)?.[1]
  const marker = svg.find(tag => tag.name === 'marker' && tag.attrs.id === resource)!.attrs
  const points = routePoints(route), start = end === 'start'
  const anchor = start ? points[0]! : points.at(-1)!
  const neighbour = start ? points.find(p => p.x !== anchor.x || p.y !== anchor.y)! : [...points].reverse().find(p => p.x !== anchor.x || p.y !== anchor.y)!
  const tangent = start ? { x: neighbour.x - anchor.x, y: neighbour.y - anchor.y } : { x: anchor.x - neighbour.x, y: anchor.y - neighbour.y }
  let angle = marker.orient === 'auto' || marker.orient === 'auto-start-reverse' ? Math.atan2(tangent.y, tangent.x) : Number(marker.orient ?? 0) * Math.PI / 180
  if (start && marker.orient === 'auto-start-reverse') angle += Math.PI
  const view = marker.viewBox ? numbers(marker.viewBox) : undefined
  const viewportScale = view ? Math.min(Number(marker.markerWidth) / view[2]!, Number(marker.markerHeight) / view[3]!) : 1
  if (marker.overflow === undefined || marker.overflow === 'hidden') {
    const w = Number(marker.markerWidth) / viewportScale, h = Number(marker.markerHeight) / viewportScale
    const x = view ? view[0]! - (w - view[2]!) / 2 : 0, y = view ? view[1]! - (h - view[3]!) / 2 : 0
    if (!(contact.x >= x - 1e-6 && contact.x <= x + w + 1e-6 && contact.y >= y - 1e-6 && contact.y <= y + h + 1e-6)) {
      throw new Error('Marker contact clipped by its viewport')
    }
  }
  const unitScale = marker.markerUnits === 'userSpaceOnUse' ? 1 : Number(route.attrs['stroke-width'] ?? 1)
  const dx = (contact.x - Number(marker.refX)) * viewportScale * unitScale,
    dy = (contact.y - Number(marker.refY)) * viewportScale * unitScale
  return { x: anchor.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: anchor.y + dx * Math.sin(angle) + dy * Math.cos(angle) }
}

function surfaceError(point: Point, surface: Tag, side: string): number {
  const a = surface.attrs
  if (surface.name === 'circle') return Math.abs(Math.hypot(point.x - Number(a.cx), point.y - Number(a.cy)) - Number(a.r))
  const x = Number(a.x), y = Number(a.y), right = x + Number(a.width), bottom = y + Number(a.height)
  if (side === 'L' || side === 'R') return Math.hypot(point.x - (side === 'L' ? x : right), Math.max(y - point.y, point.y - bottom, 0))
  return Math.hypot(point.y - (side === 'T' ? y : bottom), Math.max(x - point.x, point.x - right, 0))
}

const source = (from: string, to: string) => `architecture-beta\nservice a(server)[A]\nservice b(database)[B]\na:${from}<-->${to}:b`
function options(width: number, rough: boolean): RenderOptions {
  const paint = { roles: { edge: { strokeColor: '#ff0000', lineWidth: width } } }
  return { embedFontImport: false, seed: 7, style: rough ? ['hand-drawn', paint] : paint }
}

function architectureContacts(svg: string, fromSurface = 'service-card:a', toSurface = 'service-card:b'): Array<{ shaft: number; visible: number }> {
  const all = tags(svg), route = all.find(tag => tag.attrs.class === 'architecture-edge')!
  expect(route).toBeDefined()
  const points = routePoints(route)
  return (['start', 'end'] as const).map(end => {
    const start = end === 'start', point = start ? points[0]! : points.at(-1)!
    const surface = all.find(tag => tag.attrs['data-id'] === (start ? fromSurface : toSurface))!
    expect(surface).toBeDefined()
    const marker = visibleContact(all, route, end, { x: start ? 0 : 8, y: 2.5 })
    const side = route.attrs[start ? 'data-from-side' : 'data-to-side']!
    return { shaft: surfaceError(point, surface, side), visible: surfaceError(marker, surface, side) }
  })
}

describe('family-owned endpoint and visible-marker contact (#258)', () => {
  for (const [from, to] of [['R', 'L'], ['L', 'R'], ['B', 'T'], ['T', 'B']]) {
    for (const width of [1.5, 3]) for (const rough of [false, true]) {
      test(`Architecture ${from}/${to}, ${width}px, ${rough ? 'hand-drawn' : 'default'} retains both contacts`, () => {
        for (const contact of architectureContacts(renderMermaidSVG(source(from!, to!), options(width, rough)))) {
          expect(contact.shaft).toBeLessThan(1e-6)
          expect(contact.visible).toBeLessThan(1e-6)
        }
      })
    }
  }

  test.each([
    { source: 'architecture-beta\ngroup g(cloud)[Group]\nservice a(server)[A] in g\nservice b(database)[B]\na{group}:R<-->L:b', from: 'group-frame:g' },
  ])('Architecture retains the declared group or junction surface: $from', ({ source, from }) => {
    for (const contact of architectureContacts(renderMermaidSVG(source, options(3, false)), from)) {
      expect(contact.shaft).toBeLessThan(1e-6)
      expect(contact.visible).toBeLessThan(1e-6)
    }
  })

  for (const [from, to] of [['R', 'L'], ['L', 'R'], ['B', 'T'], ['T', 'B']]) {
    for (const junctionFirst of [true, false]) for (const customized of [false, true]) {
      test(`Architecture junction ${junctionFirst ? 'start' : 'end'} ${from}/${to}, ${customized ? 'nested, aligned, titled, custom radius' : 'default'}`, () => {
        const radius = customized ? 20 : 8
        const endpoint = junctionFirst ? `j:${from}<-->${to}:b` : `b:${from}<-->${to}:j`
        const source = customized
          ? `---\ntitle: Junction connections\n---\narchitecture-beta\ngroup outer(cloud)[Outer]\ngroup g(cloud)[Group] in outer\njunction j in g\nservice b(database)[B] in g\n${endpoint}\nalign ${from === 'L' || from === 'R' ? 'row' : 'column'} j b`
          : `architecture-beta\njunction j\nservice b(database)[B]\n${endpoint}`
        const opts = { ...options(customized ? 3 : 1.5, customized), architecture: { visual: { junctionOuterRadius: radius } } }
        const svg = renderMermaidSVG(source, opts)
        for (const contact of architectureContacts(svg, junctionFirst ? 'junction-ring:j' : 'service-card:b', junctionFirst ? 'service-card:b' : 'junction-ring:j')) {
          expect(contact.shaft).toBeLessThan(1e-6)
          expect(contact.visible).toBeLessThan(1e-6)
        }
        // A certificate against the same wrong allocation would pass. Bind
        // the public circle bounds to the independently emitted ring instead.
        const ring = tags(svg).find(tag => tag.attrs['data-id'] === 'junction-ring:j')!.attrs
        const layout = layoutMermaidWithReceipt(source, { ...opts, debug: true }).layout
        const junction = layout.nodes.find(node => node.id === 'j')!
        expect(Number(ring.r)).toBe(radius)
        expect(Number(junction.w)).toBe(radius * 2)
        expect(Number(junction.h)).toBe(radius * 2)
        expect(Math.abs(junction.x + radius - Number(ring.cx))).toBeLessThanOrEqual(0.5)
        expect(Math.abs(junction.y + radius - Number(ring.cy))).toBeLessThanOrEqual(0.5)
        expect(layout.edges[0]!.route?.invariant).toBe('side-anchored')
        for (const group of layout.groups) {
          expect(junction.x).toBeGreaterThanOrEqual(group.x)
          expect(junction.y).toBeGreaterThanOrEqual(group.y)
          expect(junction.x + junction.w).toBeLessThanOrEqual(group.x + group.w)
          expect(junction.y + junction.h).toBeLessThanOrEqual(group.y + group.h)
        }
      })
    }
  }

  for (const width of [1.5, 3]) {
    test(`Architecture native-size red ink reaches both card faces at ${width}px`, () => {
      const svg = renderMermaidSVG(source('R', 'L'), options(width, false))
      const route = tags(svg).find(tag => tag.attrs.class === 'architecture-edge')!, points = routePoints(route)
      for (const [end, anchor] of [['start', points[0]!], ['end', points.at(-1)!]] as const) {
        const box = colorPixelBox(svg, redPixel, { left: Math.floor(anchor.x - (end === 'end' ? 30 : 1)), right: Math.ceil(anchor.x + (end === 'start' ? 30 : 1)), top: Math.floor(anchor.y - 14), bottom: Math.ceil(anchor.y + 14) })
        expect(Math.abs((end === 'start' ? box.left : box.right + 1) - anchor.x)).toBeLessThanOrEqual(1)
        expect(box.height).toBeGreaterThan(width * 2)
      }
    })
  }

  test('a shaft reaching the card cannot mask a clipped arrowhead', () => {
    // Only arrowheads are red: measuring the shaft as well would hide the gap.
    const original = renderMermaidSVG(source('R', 'L'), { embedFontImport: false, architecture: { visual: { edgeLineWidth: 3 } } })
      .replace(/<marker\b[\s\S]*?<\/marker>/g, marker => marker.replaceAll('#47474a', '#ff0000'))
    const clipped = original.replace('id="architecture-arrow-end" markerWidth="8"', 'id="architecture-arrow-end" markerWidth="7"')
    expect(clipped).not.toBe(original)
    expect(() => architectureContacts(original)).not.toThrow()
    expect(() => architectureContacts(clipped)).toThrow('Marker contact clipped by its viewport')
    const anchor = routePoints(tags(original).find(tag => tag.attrs.class === 'architecture-edge')!).at(-1)!
    const region = { left: Math.floor(anchor.x - 26), right: Math.ceil(anchor.x + 2), top: Math.floor(anchor.y - 14), bottom: Math.ceil(anchor.y + 14) }
    const gap = (svg: string) => anchor.x - (colorPixelBox(svg, redPixel, region).right + 1)
    expect(Math.abs(gap(original))).toBeLessThanOrEqual(1)
    expect(gap(clipped)).toBeGreaterThanOrEqual(2)
  })

  test('large configured junctions reserve placement space rather than overlap their painted rings', () => {
    const source = 'architecture-beta\njunction a\njunction b'
    const svg = renderMermaidSVG(source, { architecture: { visual: { junctionOuterRadius: 40 } } })
    const rings = tags(svg).filter(tag => tag.attrs.class === 'architecture-junction-ring').map(tag => tag.attrs)
    expect(rings.length).toBe(2)
    const [a, b] = rings
    expect(Number(a!.r)).toBe(40)
    expect(Number(b!.r)).toBe(40)
    expect(Math.hypot(Number(a!.cx) - Number(b!.cx), Number(a!.cy) - Number(b!.cy)) - Number(a!.r) - Number(b!.r)).toBeGreaterThanOrEqual(36)
  })

  for (const graphLayout of [undefined, { backend: 'elk' }, { backend: 'agentic', fallback: 'none' }, { backend: 'agentic', fallback: 'elk' }] as const) {
    for (const [from, to] of [['R', 'L'], ['L', 'R'], ['T', 'B'], ['B', 'T']]) {
      test(`large Architecture ring binds shaft and visible marker contacts to actual paint: ${graphLayout?.backend ?? 'default'}/${graphLayout?.fallback ?? 'none'}/${from}`, () => {
        const source = `architecture-beta\njunction j\nservice b(server)[B]\nj:${from}<-->${to}:b`
        const result = renderMermaidSVGWithReceipt(source, { ...options(3, false), ...(graphLayout ? { graphLayout } : {}), architecture: { visual: { junctionOuterRadius: 40 } } })
        for (const contact of architectureContacts(result.svg, 'junction-ring:j', 'service-card:b')) {
          expect(contact.shaft).toBeLessThan(1e-6)
          expect(contact.visible).toBeLessThan(1e-6)
        }
        // The hidden viewport bounds every tip stroke at the attachment
        // plane, resolving the former un-clipped envelope uncertainty.
        for (const marker of tags(result.svg).filter(tag => tag.name === 'marker')) {
          expect(marker.attrs.overflow).not.toBe('visible')
          expect([0, Number(marker.attrs.markerWidth)]).toContain(Number(marker.attrs.refX))
        }
        expect(result.receipt.layoutCertification?.scope).toBe('native-scene')
        expect(result.receipt.layoutCertification?.status).toBe('passed')
      })
    }
  }

  for (const width of [1.5, 3]) for (const rough of [false, true]) {
    test(`Journey's free axis overhang is not a node-contact failure: ${width}px/${rough}`, () => {
      const all = tags(renderMermaidSVG('journey\nsection Delivery\nBuild: 3: Alice\nReview: 5: Bob', options(width, rough)))
      const axis = all.find(tag => tag.attrs.class === 'journey-baseline')!
      const anchor = routePoints(axis).at(-1)!, visible = visibleContact(all, axis, 'end', { x: 10, y: 4 })
      expect(axis.attrs['data-from']).toBeUndefined()
      expect(axis.attrs['data-to']).toBeUndefined()
      expect(visible.y).toBeCloseTo(anchor.y, 8)
      expect(visible.x - anchor.x).toBeCloseTo(Number(axis.attrs['stroke-width']), 8)
    })
  }
})
