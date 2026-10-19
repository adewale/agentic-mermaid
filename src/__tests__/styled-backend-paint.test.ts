import { describe, expect, test } from 'bun:test'

import * as marks from '../scene/marks.ts'
import { RoughBackend } from '../scene/rough-backend.ts'

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
    })

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
    })

    const svg = RoughBackend.drawNode(bar, {
      seed: 11,
      style: { stroke: 'jittered', fill: 'hachure', strokeWidth: 1.5 },
    })

    expect(svg).toContain('stroke="#00aa00"')
    expect(svg).not.toContain('class="xychart-bar"')
  })

})
