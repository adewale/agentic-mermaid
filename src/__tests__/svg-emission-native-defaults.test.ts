import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { snapshotSvgEmissionRecipe, svgValue as v } from '../scene/svg-emission.ts'
import { renderMermaidSVG } from '../index.ts'

describe('typed emission preserves native connector presentation', () => {
  test('leaves SVG cap/join defaults implicit while emitting later nondefault paint', () => {
    const recipe = snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'x1', value: v.geometry('x1') }, { name: 'y1', value: v.geometry('y1') },
      { name: 'x2', value: v.geometry('x2') }, { name: 'y2', value: v.geometry('y2') },
      { name: 'stroke', value: v.paint('stroke') }, { name: 'stroke-width', value: v.paint('strokeWidth') },
      { name: 'stroke-linecap', value: v.paint('strokeLinecap'), omit: 'butt' },
      { name: 'stroke-linejoin', value: v.paint('strokeLinejoin'), omit: 'miter' },
    ] })
    const node = marks.connector({ id: 'guide', role: 'grid',
      geometry: { kind: 'line', x1: 0, y1: 2, x2: 10, y2: 2 }, lineStyle: 'solid',
      paint: { stroke: '#123456', strokeWidth: '2' },
    }, recipe)
    expect(sceneNodeSerialization(node)).toBe('<line x1="0" y1="2" x2="10" y2="2" stroke="#123456" stroke-width="2" data-relationship="grid" data-direction="undirected" />')
    node.stroke.lineCap = 'round'
    node.stroke.lineJoin = 'bevel'
    expect(sceneNodeSerialization(node)).toBe('<line x1="0" y1="2" x2="10" y2="2" stroke="#123456" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" data-relationship="grid" data-direction="undirected" />')
  })

  test('keeps opacity on Sankey strokes before blending', () => {
    const svg = renderMermaidSVG('sankey\nA,B,10\nA,C,5', { embedFontImport: false })
    const ribbons = svg.match(/<path\b[^>]*class="sankey-link"[^>]*>/g) ?? []
    expect(ribbons).toHaveLength(2)
    for (const ribbon of ribbons) {
      expect(ribbon).toContain(' stroke-opacity="0.5"')
      expect(ribbon).not.toContain(' opacity=')
      expect(ribbon).toContain('style="mix-blend-mode:multiply"')
    }
  })

  test('rejects unknown default-omission instructions during recipe capture', () => {
    expect(() => snapshotSvgEmissionRecipe({ kind: 'primitive', attributes: [
      { name: 'stroke-linecap', value: v.paint('strokeLinecap'), omit: 'round' as never },
    ] })).toThrow()
  })
})
