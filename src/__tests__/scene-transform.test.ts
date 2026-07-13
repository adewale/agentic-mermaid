import { describe, expect, test } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { nodeProblems } from '../scene/fidelity.ts'
import { nodeWorldBounds } from '../scene/bounds.ts'
import { RoughBackend } from '../scene/rough-backend.ts'

describe('Scene transforms are typed semantic geometry', () => {
  test('fidelity rejects a crisp transform missing from semantic fields', () => {
    const mark = marks.text({
      id: 'label', role: 'label', text: 'release', x: 20, y: 30,
      fontSize: 12, anchor: 'middle', paint: {},
    }, '<text x="20" y="30" text-anchor="middle" font-size="12" transform="rotate(45 20 30)">release</text>')
    const problems: string[] = []
    nodeProblems(mark, 'label', problems)
    expect(problems.join('\n')).toContain('transform')
  })

  test('fidelity accepts an exactly modeled rotation', () => {
    const transform = { kind: 'rotate' as const, angle: 45, cx: 20, cy: 30 }
    const mark = marks.text({
      id: 'label', role: 'label', text: 'release', x: 20, y: 30,
      fontSize: 12, anchor: 'middle', paint: {}, transform,
    }, '<text x="20" y="30" text-anchor="middle" font-size="12" transform="rotate(45 20 30)">release</text>')
    const problems: string[] = []
    nodeProblems(mark, 'label', problems)
    expect(problems).toEqual([])
  })

  test('styled backends apply typed transforms to sketched shapes, connectors, and nested children', () => {
    const transform = { kind: 'rotate' as const, angle: 45, cx: 10, cy: 5 }
    const shape = marks.shape({
      id: 'shape', role: 'node', geometry: { kind: 'rect', x: 0, y: 0, width: 20, height: 10 },
      paint: { fill: 'none', stroke: '#000', strokeWidth: '1' }, transform,
    }, '<rect x="0" y="0" width="20" height="10" fill="none" stroke="#000" transform="rotate(45 10 5)" />')
    const connector = marks.connector({
      id: 'edge', role: 'edge', geometry: { kind: 'line', x1: 0, y1: 5, x2: 20, y2: 5 },
      lineStyle: 'solid', paint: { fill: 'none', stroke: '#000', strokeWidth: '1' }, transform,
    }, '<line x1="0" y1="5" x2="20" y2="5" fill="none" stroke="#000" transform="rotate(45 10 5)" />')
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
    }, '<text x="20" y="30" text-anchor="middle" font-size="12" transform="rotate(45 20 30)">release</text>')
    const rect = marks.shape({
      id: 'backplate', role: 'chrome',
      geometry: { kind: 'rect', x: 10, y: 18, width: 20, height: 18 }, paint: {}, transform,
    }, '<rect x="10" y="18" width="20" height="18" transform="rotate(45 20 30)" />')
    const textBounds = nodeWorldBounds(text)
    const rectBounds = nodeWorldBounds(rect)
    expect(textBounds).toBeDefined()
    expect(rectBounds).toBeDefined()
    expect(rectBounds!.x1 - rectBounds!.x0).toBeGreaterThan(20)
    expect(textBounds!.y1 - textBounds!.y0).toBeGreaterThan(12)
  })
})
