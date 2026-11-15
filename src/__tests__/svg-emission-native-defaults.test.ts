import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { renderMermaidSVG } from '../index.ts'

describe('native connector presentation', () => {
  test('leaves SVG cap/join defaults implicit while emitting later nondefault paint', () => {
    const node = marks.connector({ id: 'guide', role: 'grid',
      geometry: { kind: 'line', x1: 0, y1: 2, x2: 10, y2: 2 }, lineStyle: 'solid',
      paint: { stroke: '#123456', strokeWidth: '2' },
    })
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

})
