import { describe, expect, it } from 'bun:test'
import type { DiagramColors } from '../theme.ts'
import { renderArchitectureSvg } from '../architecture/renderer.ts'
import { DEFAULT_ARCHITECTURE_VISUAL } from '../architecture/config.ts'
import type { PositionedArchitectureDiagram } from '../architecture/types.ts'

const lightColors: DiagramColors = { bg: '#FFFFFF', fg: '#27272A' }

function makeDiagram(overrides: Partial<PositionedArchitectureDiagram> = {}): PositionedArchitectureDiagram {
  return {
    width: 420,
    height: 220,
    groups: [{
      id: 'app',
      label: 'Application <Zone>',
      icon: 'cloud',
      x: 20,
      y: 20,
      width: 220,
      height: 160,
      children: [],
    }],
    services: [
      {
        id: 'api',
        label: 'API & <Gateway>',
        icon: 'server',
        parentId: 'app',
        x: 40,
        y: 70,
        width: 120,
        height: 44,
      },
      {
        id: 'db',
        label: 'Primary "DB"',
        icon: 'database',
        x: 280,
        y: 70,
        width: 120,
        height: 44,
      },
    ],
    junctions: [{
      id: 'bus',
      parentId: 'app',
      x: 120,
      y: 132,
      width: 16,
      height: 16,
    }],
    edges: [{
      source: { id: 'api', side: 'R', boundary: 'item' },
      target: { id: 'db', side: 'L', boundary: 'item' },
      label: 'reads <records> & "writes"',
      hasArrowStart: false,
      hasArrowEnd: true,
      points: [
        { x: 160, y: 92 },
        { x: 220, y: 92 },
        { x: 220, y: 92 },
        { x: 280, y: 92 },
      ],
      labelPosition: { x: 220, y: 92 },
    }],
    ...overrides,
  }
}

describe('renderArchitectureSvg', () => {
  it('escapes labels and data attributes safely', () => {
    const svg = renderArchitectureSvg({ positioned: makeDiagram(), colors: lightColors, options: {} })

    expect(svg).toContain('Application &lt;Zone&gt;')
    expect(svg).toContain('API &amp; &lt;Gateway&gt;')
    expect(svg).toContain('Primary &quot;DB&quot;')
    expect(svg).toContain('data-label="reads &lt;records&gt; &amp; &quot;writes&quot;"')
    expect(svg).not.toContain('API & <Gateway>')
  })

  it('emits architecture-specific markers, classes, and theme tokens', () => {
    const svg = renderArchitectureSvg({ positioned: makeDiagram(), colors: lightColors, options: {} })

    expect(svg).toContain('id="architecture-arrow-end"')
    expect(svg).toContain('class="architecture-service"')
    expect(svg).toContain('class="architecture-edge"')
    expect(svg).toContain('stroke: var(--arch-edge-stroke, var(--_line));')
    expect(svg).toContain('fill="var(--arch-edge-stroke, var(--_arrow))"')
  })

  it('draws structural header fills as paths and omits decorative service rails', () => {
    const svg = renderArchitectureSvg({
      positioned: makeDiagram(),
      colors: lightColors,
      options: {
        architecture: {
          visual: {
            ...DEFAULT_ARCHITECTURE_VISUAL,
            groupCornerRadius: 18,
            serviceCornerRadius: 16,
          },
        },
      },
    })

    expect(svg).toContain('<path class="architecture-group-band"')
    expect(svg).not.toContain('<rect class="architecture-group-band"')
    expect(svg).not.toContain('architecture-service-accent')
    expect(svg).not.toContain('architecture-icon-bg')
    expect(svg).not.toContain('architecture-icon-fill')
  })
})
