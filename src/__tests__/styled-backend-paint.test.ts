import { describe, expect, test } from 'bun:test'

import * as marks from '../scene/marks.ts'
import { RoughBackend, createSketchBackend } from '../scene/rough-backend.ts'
import { svgValue as v, type SvgEmissionRecipe } from '../scene/svg-emission.ts'
import type { Geometry } from '../scene/ir.ts'

describe('styled backend paint fallback', () => {
  test('uses semantic stroke paint for class-only connectors', () => {
    const connector = marks.connector({
      id: 'series-line',
      role: 'series',
      geometry: {
        kind: 'path',
        d: 'M 0 0 L 50 50',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 50 },
        ],
      },
      lineStyle: 'solid',
      paint: {
        stroke: '#ff0000',
        strokeWidth: '3',
      },
    }, '<path d="M 0 0 L 50 50" class="series-line" />')

    const svg = RoughBackend.drawNode(connector, {
      seed: 7,
      style: { stroke: 'jittered', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).not.toContain('stroke="var(--_line)"')
    expect(svg).toContain('stroke-opacity="0"')
  })

  test.each(['legacy', 'typed'] as const)('uses semantic fill paint for class-only fill shapes (%s)', mode => {
    const bar = marks.shape({
      id: 'bar',
      role: 'bar',
      geometry: {
        kind: 'rect',
        x: 10,
        y: 10,
        width: 30,
        height: 20,
      },
      paint: {
        fill: '#00aa00',
      },
    }, mode === 'legacy' ? '<rect x="10" y="10" width="30" height="20" class="xychart-bar" />' : { kind: 'primitive', attributes: [
      ...(['x', 'y', 'width', 'height'] as const).map(name => ({ name, value: v.geometry(name) })),
      { name: 'class', value: v.meta('xychart-bar') },
    ] })

    const svg = RoughBackend.drawNode(bar, {
      seed: 11,
      style: { stroke: 'jittered', fill: 'hachure', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#00aa00"')
    expect(svg).not.toContain('class="xychart-bar"')
  })

  test.each(['legacy', 'typed'] as const)('does not synthesize a stroke when crisp SVG explicitly disables it (%s)', mode => {
    const shape = marks.shape({
      id: 'suppressed-stroke',
      role: 'bar',
      geometry: {
        kind: 'rect',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      },
      paint: {
        fill: '#00aa00',
        stroke: '#ff0000',
        strokeWidth: '3',
      },
    }, mode === 'legacy' ? '<rect x="0" y="0" width="20" height="20" fill="#00aa00" stroke="none" />' : { kind: 'primitive', attributes: [
      ...(['x', 'y', 'width', 'height'] as const).map(name => ({ name, value: v.geometry(name) })),
      { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.meta('none') },
    ] })

    const svg = RoughBackend.drawNode(shape, {
      seed: 13,
      style: { stroke: 'jittered', fill: 'none', strokeWidth: 1.5 },
    })

    expect(svg).toBe('<rect x="0" y="0" width="20" height="20" fill="#00aa00" stroke="none" data-id="suppressed-stroke" data-role="bar" />')
  })

  test('typed compound pieces preserve legacy paint, suppression, order and seeds', () => {
    const geometry: Geometry = { kind: 'compound', children: [
      { kind: 'rect', x: 0, y: 0, width: 20, height: 10 },
      { kind: 'line', x1: 0, y1: 5, x2: 20, y2: 5 },
      { kind: 'circle', cx: 30, cy: 5, r: 3 },
      { kind: 'line', x1: 25, y1: 0, x2: 35, y2: 10 },
    ] }
    // A valid CSS paint with whitespace also preserves the legacy lexical
    // attribute value passed into the sketch renderer, including XML references.
    const pieces = [{}, { paint: { stroke: 'none' } }, { paint: { fill: '#008800', stroke: '#aa0000', strokeWidth: '0' } }, { paint: { stroke: 'rgb(0,\n85,170)' } }]
    const recipe: SvgEmissionRecipe = { kind: 'sequence', join: '\n', children: ([
      ['x', 'y', 'width', 'height'], ['x1', 'y1', 'x2', 'y2'], ['cx', 'cy', 'r'], ['x1', 'y1', 'x2', 'y2'],
    ] as const).map((fields, piece) => ({ kind: 'primitive', piece, pieces, attributes: [
      ...fields.map(name => ({ name, value: v.geometry(name) })),
      { name: 'fill', value: v.paint('fill') }, { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
      { name: 'transform', value: v.transform() },
    ] })) }
    const legacy = [
      '<rect x="0" y="0" width="20" height="10" fill="none" stroke="#112233" stroke-width="2" transform="rotate(30 10 5)" />',
      '<line x1="0" y1="5" x2="20" y2="5" fill="none" stroke="none" stroke-width="2" transform="rotate(30 10 5)" />',
      '<circle cx="30" cy="5" r="3" fill="#008800" stroke="#aa0000" stroke-width="0" transform="rotate(30 10 5)" />',
      '<line x1="25" y1="0" x2="35" y2="10" fill="none" stroke="rgb(0,&#10;85,170)" stroke-width="2" transform="rotate(30 10 5)" />',
    ].join('\n')
    const calls: Array<{ geometry: Geometry; seed: number; stroke: string; width: number }> = []
    const backend = createSketchBackend('test:paint-observer', (geom, options) => {
      calls.push({ geometry: geom, seed: options.seed, stroke: options.stroke, width: options.width })
      return null // The actual rough renderer still draws every observed piece.
    })
    const draw = (source: string | SvgEmissionRecipe) => backend.drawNode(marks.shape({
      id: 'mixed', role: 'node', geometry, paint: { fill: 'none', stroke: '#112233', strokeWidth: '2' },
      transform: { kind: 'rotate', angle: 30, cx: 10, cy: 5 },
    }, source), { seed: 7, style: { stroke: 'jittered', fill: 'none', strokeWidth: 1.5 } })
    const previous = draw(legacy)
    const legacyCalls = calls.splice(0)
    expect(draw(recipe)).toBe(previous)
    expect(calls).toEqual(legacyCalls)
    expect(calls.map(call => [call.geometry.kind, call.stroke, call.width])).toEqual([['rect', '#112233', 3], ['line', 'rgb(0,&#10;85,170)', 3]])
    expect(new Set(calls.map(call => call.seed)).size).toBe(2)
    expect(previous).toContain('<circle cx="30" cy="5" r="3" fill="#008800" stroke="#aa0000" stroke-width="0" transform="rotate(30 10 5)" />')
    expect(previous).toContain('transform="rotate(30 10 5)"')
    expect(previous).toContain('data-id="mixed"')
  })

  test('unsupported typed shape emissions fail instead of falling back to SVG', () => {
    const shape = marks.shape({ id: 'unsupported', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 5 }, paint: {} }, {
      kind: 'sequence', children: [{ kind: 'close' }],
    })
    expect(() => RoughBackend.drawNode(shape, { seed: 7 })).toThrow('requires primitive SVG emissions')
  })
})
