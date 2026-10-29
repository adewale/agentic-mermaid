import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { nodeProblems } from '../scene/fidelity.ts'
import { geometryBounds, nodePaintBounds, nodeWorldBounds, transformedBounds, visitTypedPathSegments } from '../scene/bounds.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'

describe('Scene transforms are typed semantic geometry', () => {
  test('matrix bounds observe a mutable caller box in corner order on every call', () => {
    const reads: string[] = []
    const values = { x0: -2, y0: 1, x1: 4, y1: 8 }
    const box = Object.defineProperties({}, Object.fromEntries(Object.keys(values).map(key => [key, {
      get() { reads.push(key); return values[key as keyof typeof values] },
    }]))) as typeof values
    const matrix = { kind: 'matrix' as const, a: 2, b: -1, c: 3, d: 4, e: 10, f: -5 }
    const first = transformedBounds(box, matrix)
    expect(first).toEqual({ x0: 9, y0: -5, x1: 42, y1: 29 })
    expect(reads).toEqual(['x0', 'y0', 'x1', 'y1', 'x0', 'y0', 'x0', 'y1', 'x1', 'y0', 'x1', 'y1'])
    values.x1 = 9
    reads.length = 0
    expect(transformedBounds(box, matrix)).toEqual({ x0: 9, y0: -10, x1: 52, y1: 29 })
    expect(first).toEqual({ x0: 9, y0: -5, x1: 42, y1: 29 })
    expect(reads).toHaveLength(12)
    reads.length = 0
    expect(transformedBounds(box, { ...matrix, a: 1, b: 0, c: 0, d: 1 })).toEqual({ x0: 8, y0: -4, x1: 19, y1: 3 })
    expect(reads).toEqual(['x0', 'y0', 'x1', 'y1', 'x0', 'y0', 'x0', 'y1', 'x1', 'y0', 'x1', 'y1'])
    expect(transformedBounds(values, { ...matrix, a: Number.MAX_VALUE })).toBeUndefined()
  })

  test.each([
    { name: 'translation', box: { x0: 1, y0: 2, x1: 4, y1: 8 }, e: 10, f: -5, expected: { x0: 11, y0: -3, x1: 14, y1: 3 } },
    { name: 'inverted translation', box: { x0: 4, y0: 8, x1: 1, y1: 2 }, e: 10, f: -5, expected: { x0: 11, y0: -3, x1: 14, y1: 3 } },
    { name: 'signed zero', box: { x0: -0, y0: -1, x1: 2, y1: 1 }, e: -0, f: -0, expected: { x0: -0, y0: -1, x1: 2, y1: 1 } },
    { name: 'translation overflow', box: { x0: 1, y0: 2, x1: Number.MAX_VALUE, y1: 8 }, e: Number.MAX_VALUE, f: -5, expected: undefined },
  ])('$name preserves the complete transformed extent', ({ box, e, f, expected }) => {
    expect(transformedBounds(box, { kind: 'matrix', a: 1, b: -0, c: -0, d: 1, e, f })).toEqual(expected)
  })

  test.each([
    ['matrix(,1,1,0,0,0)', { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 }],
    ['matrix(1,0,0,1,0,)', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }],
    ['translate(,5)', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 5 }],
  ])('a group refuses malformed affine parameters: %s', (raw, matrix) => {
    expect(() => marks.group({ id: 'invalid-transform', role: 'group', open: `<g transform="${raw}">`, close: '</g>', transform: { kind: 'matrix', ...matrix }, children: [] }))
      .toThrow('unsupported transform')
  })

  test('fidelity accepts an exactly modeled rotation', () => {
    const transform = { kind: 'rotate' as const, angle: 45, cx: 20, cy: 30 }
    const mark = marks.text({
      id: 'label', role: 'label', text: 'release', x: 20, y: 30,
      fontSize: 12, anchor: 'middle', paint: {}, transform,
    })
    const problems: string[] = []
    nodeProblems(mark, 'label', problems)
    expect(problems).toEqual([])
  })

  test('styled backends apply typed transforms to sketched shapes, connectors, and nested children', () => {
    const transform = { kind: 'rotate' as const, angle: 45, cx: 10, cy: 5 }
    const shape = marks.shape({
      id: 'shape', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 20, height: 10 },
      paint: { fill: 'none', stroke: '#000', strokeWidth: '1' }, transform,
    })
    const connector = marks.connector({
      id: 'edge', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 5, x2: 20, y2: 5 },
      lineStyle: 'solid', paint: { fill: 'none', stroke: '#000', strokeWidth: '1' }, transform,
    })
    const group = marks.group({ id: 'group', role: 'group', open: '<g>', close: '</g>', children: [{ node: shape, indent: 2 }] })
    const context = { seed: 1, style: { name: 'look:probe', stroke: 'jittered' as const } }
    for (const node of [shape, connector, group]) {
      const output = RoughBackend.drawNode(node, context)
      expect(output).toContain('<g transform="rotate(45 10 5)"')
    }
  })

  test('world bounds include rotation for text and shape marks', () => {
    const transform = { kind: 'rotate' as const, angle: 45, cx: 20, cy: 30 }
    const text = marks.text({
      id: 'label', role: 'label', text: 'release', x: 20, y: 30,
      fontSize: 12, anchor: 'middle', paint: {}, transform,
    })
    const rect = marks.shape({
      id: 'backplate', role: 'chrome',
      geometry: { kind: 'rect', x: 10, y: 18, width: 20, height: 18 }, paint: {}, transform,
    })
    const textBounds = nodeWorldBounds(text)
    const rectBounds = nodeWorldBounds(rect)
    expect(textBounds).toBeDefined()
    expect(rectBounds).toBeDefined()
    expect(rectBounds!.x1 - rectBounds!.x0).toBeGreaterThan(20)
    expect(textBounds!.y1 - textBounds!.y0).toBeGreaterThan(12)
  })

  test('paint bounds include stroke without changing historical shape geometry bounds', () => {
    const shape = marks.shape({
      id: 'box', role: 'node', geometry: { kind: 'rect', x: 10, y: 20, width: 30, height: 40 },
      paint: { fill: 'none', stroke: '#000', strokeWidth: '6' },
    })
    expect(nodeWorldBounds(shape)).toEqual({ x0: 10, y0: 20, x1: 40, y1: 60 })
    expect(nodePaintBounds(shape)).toEqual({ x0: 7, y0: 17, x1: 43, y1: 63 })
    expect(nodePaintBounds({ ...shape, paint: { stroke: '#000', strokeWidth: '1em' } })).toBeUndefined()
  })

  test('paint bounds enclose miter joins and diagonal square caps', () => {
    const shape = marks.shape({
      id: 'triangle', role: 'node', geometry: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 1 }] },
      paint: { stroke: '#000', strokeWidth: '4', strokeLinejoin: 'miter', strokeMiterlimit: '8' },
    })
    expect(nodePaintBounds(shape)).toEqual({ x0: -16, y0: -16, x1: 36, y1: 17 })
    const diagonal = marks.shape({
      id: 'line', role: 'grid', geometry: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
      paint: { stroke: '#000', strokeWidth: '4', strokeLinecap: 'square' },
    })
    const bounds = nodePaintBounds(diagonal)!
    expect(bounds.x0).toBeLessThanOrEqual(-Math.SQRT2 * 2)
    expect(bounds.x1).toBeGreaterThanOrEqual(10 + Math.SQRT2 * 2)
  })

  test('nested matrix transforms preserve SVG bytes and enclose transformed child stroke', () => {
    const shape = marks.shape({
      id: 'icon-part', role: 'icon', geometry: { kind: 'rect', x: 0, y: 0, width: 10, height: 5 },
      paint: { stroke: '#000', strokeWidth: '2' },
      transform: { kind: 'matrix', a: -1, b: 0, c: 0, d: 2, e: 10, f: 0 },
    })
    const group = marks.group({
      id: 'icon', role: 'icon', open: '<g transform="matrix(2 0 0 2 100 50)">', close: '</g>',
      transform: { kind: 'matrix', a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }, children: [{ node: shape, indent: 2 }],
    })
    expect(nodeWorldBounds(shape)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 })
    expect(nodePaintBounds(group)).toEqual({ x0: 98, y0: 46, x1: 122, y1: 74 })
    expect(sceneNodeSerialization(group)).toContain('<g transform="matrix(2 0 0 2 100 50)">')
    expect(sceneNodeSerialization(group.children[0]!.node)).toBe(sceneNodeSerialization(shape))
  })

  test('nested downscaling does not shrink a non-scaling stroke or erase conditional artwork', () => {
    const shape = marks.shape({
      id: 'focus', role: 'chrome', geometry: { kind: 'rect', x: 0, y: 0, width: 100, height: 100 },
      paint: { stroke: '#000', strokeWidth: '10', vectorEffect: 'non-scaling-stroke' },
    })
    const group = marks.group({
      id: 'tooltip', role: 'group', visibility: 'conditional',
      transform: { kind: 'matrix', a: 0.1, b: 0, c: 0, d: 0.1, e: 10, f: 20 },
      open: '<g transform="matrix(.1 0 0 .1 10 20)">', close: '</g>', children: [{ node: shape, indent: 2 }],
    })
    expect(group.visibility).toBe('conditional')
    expect(nodePaintBounds(group)).toEqual({ x0: 5, y0: 15, x1: 25, y1: 35 })
    expect(nodePaintBounds(shape, group.transform)).toEqual(nodePaintBounds(group))
  })

  test('connector paint bounds enclose curved ink beyond its routed samples and rotated marker corners', () => {
    const connector = marks.connector({
      id: 'curve', role: 'edge', lineStyle: 'solid',
      geometry: { kind: 'path', d: 'M0 0 Q50 100 100 0', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      paint: { stroke: '#000', strokeWidth: '2', strokeLinejoin: 'round' },
      markers: { end: { id: 'square', shape: 'diamond', units: 'userSpaceOnUse', ref: { x: 0, y: 0 }, bounds: { x0: -10, y0: -10, x1: 10, y1: 10 } } },
    })
    const bounds = nodePaintBounds(connector)!
    expect(bounds.y1).toBeGreaterThanOrEqual(101)
    expect(bounds.x1).toBeGreaterThanOrEqual(100 + Math.hypot(10, 10))
    // Existing route/hit geometry remains the original sampled projection.
    expect(nodeWorldBounds(connector)!.y1).toBe(10)
  })

  test('unmeasured artwork cannot disappear from a compound or group bound', () => {
    const known = { kind: 'rect' as const, x: 0, y: 0, width: 10, height: 10 }
    const unknown = { kind: 'path' as const, d: 'M0 0 L10 10 invalid' }
    expect(geometryBounds({ kind: 'compound', children: [known, unknown] })).toBeUndefined()
    const group = marks.group({ id: 'mixed', role: 'group', open: '<g>', close: '</g>', children: [
      { node: marks.shape({ id: 'box', role: 'node', geometry: known, paint: {} }), indent: 2 },
      { node: marks.documentContent({ id: 'untyped', role: 'chrome' }, '<path d="M20 20 L30 30" />'), indent: 2 },
    ] })
    expect(nodePaintBounds(group)).toBeUndefined()
    const metadata = marks.documentContent({ id: 'description', role: 'chrome', nonPaint: 'accessibility' }, '<desc>Explanation</desc>')
    const measured = marks.group({ id: 'measured', role: 'group', open: '<g>', close: '</g>', children: [group.children[0]!, { node: metadata, indent: 2 }] })
    expect(nodePaintBounds(measured)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 10 })
  })
})

describe('typed SVG path bounds', () => {
  test('a path visitor can retain each segment hull independently', () => {
    const segments: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
    expect(visitTypedPathSegments('M0 0 C10 30 20 -40 30 0 L50 20 Q70 80 90 0', segment => {
      segments.push(segment.bounds)
      return true
    })).toBe(true)
    expect(segments).toEqual([
      { x0: 0, y0: -40, x1: 30, y1: 30 },
      { x0: 30, y0: 0, x1: 50, y1: 20 },
      { x0: 50, y0: 0, x1: 90, y1: 80 },
    ])
    expect(new Set(segments).size).toBe(3)
  })

  test.each([
    ['M1 2 H10 V20 h-5 v-4 L-3 8 Z', { x0: -3, y0: 2, x1: 10, y1: 20 }],
    ['m1 2 9 18 -5 -4 -8 -8 z', { x0: -3, y0: 2, x1: 10, y1: 20 }],
    ['M0 0 C10 30 20 -40 30 0 S50 50 60 0', { x0: 0, y0: -40, x1: 60, y1: 50 }],
    ['M0 0 q10 30 20 0 t20 0', { x0: 0, y0: -30, x1: 40, y1: 30 }],
    ['M0 0 A20 10 90 0 1 0 40', { x0: -10, y0: 0, x1: 10, y1: 40 }],
    ['M0 0 a10 10 0 0120 0', { x0: 0, y0: -10, x1: 20, y1: 10 }],
    ['M0 0 A1 1 0 0 0 20 0', { x0: 0, y0: -10, x1: 20, y1: 10 }],
    ['M.5-.5e1 L1e2 2E1 M-10 30 l5 5', { x0: -10, y0: -5, x1: 100, y1: 35 }],
  ])('encloses %s from its typed command stream', (d, expected) => {
    const actual = geometryBounds({ kind: 'path', d })!
    expect(actual).toBeDefined()
    for (const key of ['x0', 'y0', 'x1', 'y1'] as const) expect(actual[key]).toBeCloseTo(expected[key], 8)
  })

  test.each(['', 'L1 2', 'M0 0 L', 'M0 0 C1 2 3', 'M0 0 A10 10 0 2 0 20 0', 'M0 0 L1e999 2', 'M0 0 U1 2', 'M0 0 Z 20 30'])('does not report partial bounds for malformed path %s', d => {
    expect(geometryBounds({ kind: 'path', d })).toBeUndefined()
  })
})
