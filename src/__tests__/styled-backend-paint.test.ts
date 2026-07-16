import { describe, expect, test } from 'bun:test'

import * as marks from '../scene/marks.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'

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

  test('uses semantic fill paint for class-only fill shapes', () => {
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
    }, '<rect x="10" y="10" width="30" height="20" class="xychart-bar" />')

    const svg = RoughBackend.drawNode(bar, {
      seed: 11,
      style: { stroke: 'jittered', fill: 'hachure', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#00aa00"')
    expect(svg).not.toContain('class="xychart-bar"')
  })

  test('does not synthesize a stroke when crisp SVG explicitly disables it', () => {
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
    }, '<rect x="0" y="0" width="20" height="20" fill="#00aa00" stroke="none" />')

    const svg = RoughBackend.drawNode(shape, {
      seed: 13,
      style: { stroke: 'jittered', fill: 'none', strokeWidth: 1.5 },
    })

    expect(svg).toBe(sceneNodeSerialization(shape))
  })
})
