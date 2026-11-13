import { describe, expect, test } from 'bun:test'
import { SaxesParser } from 'saxes'
import { renderMermaidSVG } from '../index.ts'
import type { RenderOptions } from '../types.ts'
import { readFileSync } from 'node:fs'
import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { projectRoundedConnectorPath } from '../scene/connector-geometry.ts'
import { conformanceSourceFor, FAMILY_CONFORMANCE_PROFILES } from './helpers/family-conformance-profiles.ts'
import { Resvg } from '@resvg/resvg-js'

type Tag = { name: string; attrs: Record<string, string> }
const numbers = (value: string) => (value.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)

/** Independent of the production projector: read the emitted M/L/Q/C endpoint
 * coordinates and walk the straight ray back from the marker attachment. */
function straightRun(tag: Tag, start: boolean): number {
  const pairs = tag.attrs.points
    ? tag.attrs.points.split(/\s+/).map(numbers)
    : [...tag.attrs.d!.matchAll(/[MLQC]([^MLQC]*)/g)].map(match => numbers(match[1]!).slice(-2))
  if (start) pairs.reverse()
  const tip = pairs.at(-1)!, neighbor = pairs.at(-2)!
  const dx = neighbor[0]! - tip[0]!, dy = neighbor[1]! - tip[1]!, length = Math.hypot(dx, dy)
  expect(length).toBeGreaterThan(0)
  let run = 0
  for (let i = pairs.length - 2; i >= 0; i--) {
    const x = pairs[i]![0]! - tip[0]!, y = pairs[i]![1]! - tip[1]!
    if (Math.abs(x * dy - y * dx) / length > 1e-6) break
    const along = (x * dx + y * dy) / length
    if (along < run) break
    run = along
  }
  return run
}

describe('arrowheads retain terminal ink after routing and interpolation', () => {
  const wide: RenderOptions['style'] = { roles: { edge: { lineWidth: 3, bendRadius: 20 } } }
  const cases: { name: string; source: string; options?: RenderOptions }[] = [
    { name: 'Flowchart sharp duplicate', source: readFileSync(new URL('../../eval/layout-compare/fixtures/cyclic-labelled-19.mmd', import.meta.url), 'utf8') },
    { name: 'Flowchart authored curves', source: 'flowchart LR\nA e1@==> B\nA e2@--> C\ne1@{ curve: linear }\ne2@{ curve: natural }' },
    { name: 'Flowchart complete fan', source: 'flowchart TB\nA & B --> C & D' },
    { name: 'Flowchart ancestor minimum span', source: 'flowchart TD\nsubgraph G[Group]\nA[Leaf]\nend\nG ---> A', options: { style: undefined, graphLayout: { backend: 'agentic', fallback: 'none' } } },
    { name: 'Architecture clipped junction', source: FAMILY_CONFORMANCE_PROFILES.architecture.citizenship.source, options: { style: wide } },
    { name: 'Class header bypass', source: FAMILY_CONFORMANCE_PROFILES.class.citizenship.source, options: { style: undefined } },
    { name: 'Event Modeling wide corners', source: conformanceSourceFor('eventmodeling', 'family-risk').source, options: { style: wide } },
    ...([
      ['architecture', 'minimal'], ['block', 'representative'], ['class', 'minimal'],
      ['requirement', 'dense'], ['gantt', 'minimal'], ['c4', 'dense'],
    ] as const).map(([family, stratum]) => ({ name: family, source: conformanceSourceFor(family, stratum).source })),
  ]
  for (const fixture of cases) test(fixture.name, () => {
    const svg = renderMermaidSVG(fixture.source, {
      style: fixture.name === 'Flowchart sharp duplicate' ? undefined : fixture.name === 'c4' ? wide : 'publication-figure',
      gantt: { dependencyArrows: true, criticalPath: true }, embedFontImport: false, ...fixture.options,
    })
    const tags: Tag[] = [], markers = new Map<string, { attrs: Record<string, string>; ink?: Tag }>()
    let current: ReturnType<typeof markers.get>
    const parser = new SaxesParser()
    parser.on('opentag', tag => {
      const t = { name: tag.name, attrs: tag.attributes as Record<string, string> }
      tags.push(t)
      if (tag.name === 'marker') { current = { attrs: t.attrs }; markers.set(t.attrs.id!, current) }
      else if (current && ['polygon', 'polyline', 'path'].includes(tag.name)) current.ink = t
    })
    parser.on('closetag', tag => { if (tag.name === 'marker') current = undefined })
    parser.write(svg).close()
    let checked = 0
    for (const tag of tags) for (const end of ['start', 'end'] as const) {
      const id = tag.attrs[`marker-${end}`]?.match(/^url\(#(.+)\)$/)?.[1]
      if (!id) continue
      const marker = markers.get(id)!, ink = marker.ink
      if (!ink) continue
      const coords = numbers(ink.attrs.points ?? ink.attrs.d ?? '')
      // These witnesses use triangular/open arrowheads; diamonds and circles
      // carry different relationship meanings and are checked elsewhere.
      if (coords.length !== 6) continue
      const xs = coords.filter((_, i) => i % 2 === 0), ref = Number(marker.attrs.refX)
      const reverse = end === 'start' && marker.attrs.orient === 'auto-start-reverse'
      const depth = end === 'end' || reverse ? ref - Math.min(...xs) : Math.max(...xs) - ref
      const units = marker.attrs.markerUnits === 'userSpaceOnUse' ? 1 : Number(tag.attrs['stroke-width'])
      const commands = tag.attrs.d ? [...tag.attrs.d.matchAll(/([MLQC])([^MLQC]*)/g)].map(match => ({ kind: match[1], values: numbers(match[2]!) })) : []
      const segmentIndex = end === 'end' ? commands.length - 1 : 1, segment = commands[segmentIndex]
      if (segment?.kind === 'C') {
        const previous = commands[segmentIndex - 1]!.values.slice(-2), controls = [previous, segment.values.slice(0, 2), segment.values.slice(2, 4), segment.values.slice(4)]
        const first = controls[0]!, last = controls[3]!, chord = [last[0]! - first[0]!, last[1]! - first[1]!]
        if (controls.slice(1, 3).some(point => Math.abs((point[0]! - first[0]!) * chord[1]! - (point[1]! - first[1]!) * chord[0]!) > 1e-7)) {
          // A genuinely curved terminal has no straight-run promise. Read
          // its actual noncollapsed Bezier derivative, then remove only this
          // occurrence's marker to establish that its arrow ink survives.
          const tip = end === 'end' ? last : first, toward = end === 'end' ? controls.slice(0, 3).reverse() : controls.slice(1)
          const control = toward.find(point => point[0] !== tip[0] || point[1] !== tip[1])!
          expect(Math.hypot(tip[0]! - control[0]!, tip[1]! - control[1]!)).toBeGreaterThan(0)
          expect(depth * units).toBeGreaterThan(0)
          const ys = coords.filter((_, index) => index % 2 === 1)
          expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0)
          const occurrence = [...svg.matchAll(/<path\b[^>]*>/g)].find(match => match[0].includes(` data-id="${tag.attrs['data-id']}"`))![0]
          const token = ` marker-${end}="url(#${id})"`
          expect(occurrence.split(token)).toHaveLength(2)
          const without = svg.replace(occurrence, occurrence.replace(token, ''))
          expect(Buffer.compare(new Resvg(svg).render().pixels, new Resvg(without).render().pixels)).not.toBe(0)
          checked++
          continue
        }
      }
      expect(straightRun(tag, end === 'start') - depth * units, `${fixture.name}: ${tag.attrs['data-id'] ?? tag.attrs.class}/${end}`).toBeGreaterThanOrEqual(3.9998)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('resource banks retain width units, viewBox references and start reversal', async () => {
    const { prepareMarkerTerminals } = await import('../scene/marker-terminals.ts')
    const marker = {
      ...tipAnchoredArrow('scaled', { width: 20, height: 12 }, 'end', { fill: 'black', stroke: 'black', strokeWidth: '2', strokeLinejoin: 'round' }),
      viewBox: { x: 10, y: 0, width: 20, height: 12 }, ref: { x: 20, y: 6 },
      geometry: { kind: 'polygon' as const, points: [{ x: 12, y: 2 }, { x: 20, y: 6 }, { x: 12, y: 10 }] },
    }
    const terminal = prepareMarkerTerminals([marker, { ...marker, id: 'fixed', units: 'userSpaceOnUse' }, { ...marker, id: 'reverse', orient: 'auto-start-reverse' }])
    expect(terminal('scaled', 3, 'end')).toBe(31)
    expect(terminal('fixed', 3, 'end')).toBe(13)
    expect(terminal('reverse', 3, 'start')).toBeCloseTo(31, 10)
    expect(terminal(undefined, 3, 'start')).toBe(0)
  })

  test('rounding protects the whole terminal through collinear waypoints without moving anchors', () => {
    const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }]
    const original = structuredClone(points)
    const path = projectRoundedConnectorPath(points, 8, { terminalClearance: { start: 16 } })
    expect(path.geometry.d).toContain('L16,0 Q20,0 20,4')
    expect(path.contours[0]!.start).toEqual(points[0]!)
    expect(path.contours[0]!.end).toEqual(points.at(-1)!)
    expect(points).toEqual(original)
    expect(() => projectRoundedConnectorPath(points, 8, { terminalClearance: { end: NaN } })).toThrow('Terminal clearance')
  })
})
