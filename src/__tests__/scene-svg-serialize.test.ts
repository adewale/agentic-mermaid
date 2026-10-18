import { describe, expect, test } from 'bun:test'
import { serializeGeometryShape, serializeConnectorCarrier } from '../scene/svg-serialize.ts'
import { canonicalizeSceneNodeSerialization } from '../scene/serialization.ts'

// Compound marks need explicit child ownership, rather than one SVG carrier.
export function compoundGeometryNeedsSeparateMarksTypecheck(): void {
  // @ts-expect-error compound geometry must be lowered into individual primitive marks
  serializeGeometryShape({ kind: 'compound', children: [] }, { fill: 'none' })
}

describe('typed Scene geometry SVG serialization', () => {
  test('serializes only the closed shape attribute set in stable order', () => {
    expect(serializeGeometryShape(
      { kind: 'rect', x: 1.23456, y: 2, width: 30, height: 12, rx: 3, ry: 4 },
      { fill: 'var(--fill)', stroke: '#123456', strokeWidth: '1.5' },
    )).toBe('<rect x="1.235" y="2" width="30" height="12" rx="3" ry="4" fill="var(--fill)" stroke="#123456" stroke-width="1.5" />')
  })

  test('exact projections retain fractional coordinates used by Scene geometry consumers', () => {
    expect(serializeGeometryShape(
      { kind: 'rect', x: 1 / 3, y: 2 / 3, width: 10.123456, height: 12, rx: 0.456789 },
      { fill: 'none' }, 'exact',
    )).toBe('<rect x="0.3333333333333333" y="0.6666666666666666" width="10.123456" height="12" rx="0.456789" ry="0" fill="none" />')
  })

  test('escapes paints without exposing an arbitrary attribute bag', () => {
    expect(serializeGeometryShape(
      { kind: 'circle', cx: 1, cy: 2, r: 3 },
      { fill: '\"/><script>', stroke: 'none', strokeWidth: '2' },
    )).toContain('fill="&quot;/&gt;&lt;script&gt;"')
  })

  test('projects line, path and dash paints from the same typed shape fields', () => {
    expect(serializeGeometryShape(
      { kind: 'line', x1: 1, y1: 2, x2: 3, y2: 4 },
      { stroke: 'navy', strokeWidth: '2', strokeDasharray: '1 3', strokeLinecap: 'round', opacity: '0.5' },
    )).toBe('<line x1="1" y1="2" x2="3" y2="4" stroke="navy" stroke-width="2" stroke-dasharray="1 3" stroke-linecap="round" opacity="0.5" />')
    expect(serializeGeometryShape({ kind: 'path', d: 'M 0 0 L 2 3 Z" onload="bad' }, { fill: 'none' }))
      .toBe('<path d="M 0 0 L 2 3 Z&quot; onload=&quot;bad" fill="none" />')
  })

  test('connector carriers use typed routes, stroke and bounded source metadata', () => {
    const svg = serializeConnectorCarrier({
      route: { geometry: { kind: 'line', x1: 2, y1: 3, x2: 40, y2: 3 }, ownership: 'layout', closed: false, bendRadius: 0, contours: [], labelAnchors: [] },
      stroke: { color: 'blue', width: 2, dash: { array: [1, 3], offset: 0.5 }, lineCap: 'round', lineJoin: 'bevel', miterLimit: 4, nonScaling: true },
      lineStyle: 'dotted', markers: { mid: [], end: { id: 'arrow', shape: 'arrow' } }, labels: [{ text: 'Read & write' }],
    }, { macro: 'Rel_Back', authoredFrom: 'authored"from', authoredTo: 'target', order: 2, tags: ['one', 'two'], index: '7', href: 'javascript:alert(1)' })
    expect(svg).toContain('x1="2" y1="3" x2="40" y2="3"')
    expect(svg).toContain('stroke="blue" stroke-width="2" stroke-dasharray="1 3" stroke-dashoffset="0.5"')
    expect(svg).toContain('data-c4-macro="Rel_Back" data-authored-from="authored&quot;from" data-authored-to="target" data-order="2" data-index="7"')
    expect(svg).toContain('data-arrow-start="false" data-arrow-end="true" data-marker-end="arrow" data-label="Read &amp; write"')
    expect(svg).toContain('vector-effect="non-scaling-stroke"')
    expect(svg).not.toContain('data-href')
  })

  test('does not replay construction-time SVG byte order', () => {
    const authored = `<svg viewBox='0 0 3 2' height="2" xmlns="http://www.w3.org/2000/svg" width="3">`
    const canonical = canonicalizeSceneNodeSerialization(authored)
    expect(canonical).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2" viewBox="0 0 3 2">')
    expect(canonical).not.toBe(authored)
  })
})
