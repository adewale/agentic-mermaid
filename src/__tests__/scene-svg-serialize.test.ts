import { describe, expect, test } from 'bun:test'
import { serializeGeometryShape } from '../scene/svg-serialize.ts'

describe('typed Scene geometry SVG serialization', () => {
  test('serializes only the closed shape attribute set in stable order', () => {
    expect(serializeGeometryShape(
      { kind: 'rect', x: 1.23456, y: 2, width: 30, height: 12, rx: 3, ry: 4 },
      { fill: 'var(--fill)', stroke: '#123456', strokeWidth: '1.5' },
    )).toBe('<rect x="1.235" y="2" width="30" height="12" rx="3" ry="4" fill="var(--fill)" stroke="#123456" stroke-width="1.5" />')
  })

  test('unsupported connector geometry is excluded by the serializer type', () => {
    if (false) {
      // @ts-expect-error line geometry belongs to connector serialization, not shape serialization
      serializeGeometryShape({ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, { fill: 'none', stroke: 'black', strokeWidth: '1' })
    }
    expect(true).toBe(true)
  })

  test('escapes paints without exposing an arbitrary attribute bag', () => {
    expect(serializeGeometryShape(
      { kind: 'circle', cx: 1, cy: 2, r: 3 },
      { fill: '\"/><script>', stroke: 'none', strokeWidth: '2' },
    )).toContain('fill="&quot;/&gt;&lt;script&gt;"')
  })
})
