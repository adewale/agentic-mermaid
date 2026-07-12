// ============================================================================
// Quadrant config section — wire-or-warn (defect class C3).
//
// Upstream QuadrantChartConfig (mermaid.js.org/config/schema-docs/
// config-defs-quadrant-chart-config.html) documents chartWidth/chartHeight,
// per-role font sizes, paddings, border stroke widths, axis positions, and
// the base useWidth/useMaxWidth. Wired keys have real geometry/paint effects;
// every accepted-but-unwired key emits the INEFFECTIVE_CONFIG Tier-3 lint
// (journey's JOURNEY_NOOP_CONFIG_FIELDS pattern) — P4: a documented
// limitation must be a runtime diagnostic, never a silent no-op.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import {
  resolveQuadrantVisualConfig,
  QUADRANT_WIRED_CONFIG_FIELDS,
  QUADRANT_NOOP_CONFIG_FIELDS,
} from '../quadrant/config.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { verifyMermaid } from '../agent/verify.ts'

const BODY = `quadrantChart
  x-axis Urgent --> Not Urgent
  y-axis Not Important --> Important
  quadrant-1 Plan
  quadrant-2 Do
  quadrant-3 Delegate
  quadrant-4 Delete
  Task A: [0.2, 0.8]
  Task B: [0.7, 0.3]`

function withConfig(yaml: string, body: string = BODY): string {
  return `---\nconfig:\n  quadrantChart:\n${yaml.split('\n').map(l => `    ${l}`).join('\n')}\n---\n${body}`
}

function layoutWith(config: Record<string, unknown>, body: string = BODY) {
  const chart = parseQuadrantChart(toMermaidLines(body))
  return layoutQuadrantChart(chart, {}, resolveQuadrantVisualConfig({ quadrantChart: config as never }))
}

// ---------------------------------------------------------------------------
// Wired keys — real effects
// ---------------------------------------------------------------------------

describe('quadrant chartWidth/chartHeight are wired to canvas size', () => {
  it('positioned canvas honors chartWidth/chartHeight exactly on an untitled chart', () => {
    const positioned = layoutWith({ chartWidth: 400, chartHeight: 400 })
    expect(positioned.width).toBe(400)
    expect(positioned.height).toBe(400)
    expect(positioned.plot.size).toBeLessThan(400)
  })

  it('the SVG root reflects the configured size (frontmatter end to end)', () => {
    const svg = renderMermaidSVG(withConfig('chartWidth: 400\nchartHeight: 400'))
    expect(svg).toContain('viewBox="0 0 400 400"')
  })

  it('a titled chart never exceeds the configured box', () => {
    const positioned = layoutWith({ chartWidth: 420, chartHeight: 380 }, `quadrantChart\n  title Sized\n  A: [0.5, 0.5]`)
    expect(positioned.width).toBeLessThanOrEqual(420)
    expect(positioned.height).toBeLessThanOrEqual(380)
    // The plot stays square and the constraining dimension is met.
    expect(Math.max(positioned.width, positioned.height + 0)).toBeGreaterThan(300)
  })

  it('default geometry without config is unchanged (380px plot)', () => {
    const positioned = layoutWith({})
    expect(positioned.plot.size).toBe(380)
  })
})

describe('quadrant point/label/text config keys are wired', () => {
  it('pointRadius drives unstyled point radius; per-point styles still win', () => {
    const positioned = layoutWith({ pointRadius: 10 })
    expect(positioned.points.every(p => p.radius === 10)).toBe(true)
    const styled = parseQuadrantChart(toMermaidLines('quadrantChart\n  A: [0.5, 0.5] radius: 3'))
    const styledPositioned = layoutQuadrantChart(styled, {}, resolveQuadrantVisualConfig({ quadrantChart: { pointRadius: 10 } as never }))
    expect(styledPositioned.points[0]!.radius).toBe(3)
  })

  it('pointLabelFontSize, quadrantLabelFontSize, axis font sizes, titleFontSize reach the SVG', () => {
    const svg = renderMermaidSVG(withConfig(
      'pointLabelFontSize: 21\nquadrantLabelFontSize: 23\nxAxisLabelFontSize: 17\nyAxisLabelFontSize: 9\ntitleFontSize: 31',
      `quadrantChart\n  title Sized\n${BODY.split('\n').slice(1).join('\n')}`,
    ))
    expect(svg).toMatch(/class="quadrant-point-label"[^>]*font-size="21"/)
    expect(svg).toMatch(/class="quadrant-label"[^>]*font-size="23"/)
    expect(svg).toMatch(/class="quadrant-axis-label"[^>]*font-size="17"[^>]*>Urgent</)
    expect(svg).toMatch(/class="quadrant-axis-label"[^>]*font-size="9"[^>]*>Not Important</)
    expect(svg).toMatch(/class="quadrant-title"[^>]*font-size="31"/)
  })

  it('border stroke widths are wired (internal divider + external border)', () => {
    const svg = renderMermaidSVG(withConfig('quadrantInternalBorderStrokeWidth: 4\nquadrantExternalBorderStrokeWidth: 7'))
    expect(svg).toMatch(/\.quadrant-divider \{[^}]*stroke-width: 4/)
    expect(svg).toMatch(/\.quadrant-border \{[^}]*stroke-width: 7/)
  })

  it('useMaxWidth: true renders a responsive root; absent keeps fixed sizing', () => {
    const responsive = renderMermaidSVG(withConfig('useMaxWidth: true'))
    expect(responsive).toContain('width="100%"')
    expect(responsive).toMatch(/max-width:\s*\d/)
    const fixed = renderMermaidSVG(BODY)
    expect(fixed).not.toContain('width="100%"')
  })
})

// ---------------------------------------------------------------------------
// Unwired keys — INEFFECTIVE_CONFIG lint, never silence
// ---------------------------------------------------------------------------

describe('quadrant unwired config keys emit INEFFECTIVE_CONFIG', () => {
  it('every documented-but-unwired key warns by name (frontmatter)', () => {
    const src = withConfig('xAxisPosition: bottom\nyAxisPosition: right\nquadrantTextTopPadding: 9')
    const v = verifyMermaid(src)
    const fields = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields.sort()).toEqual(['quadrantChart.quadrantTextTopPadding', 'quadrantChart.xAxisPosition', 'quadrantChart.yAxisPosition'])
    // Tier-3 lint: never flips verify.ok.
    expect(v.ok).toBe(true)
  })

  it('init-directive config also warns', () => {
    const src = `%%{init: {"quadrantChart": {"xAxisPosition": "bottom"}}}%%\n${BODY}`
    const v = verifyMermaid(src)
    expect(v.warnings.some(w => w.code === 'INEFFECTIVE_CONFIG' && (w as { field: string }).field === 'quadrantChart.xAxisPosition')).toBe(true)
  })

  it('wired keys never warn', () => {
    const src = withConfig('chartWidth: 400\nchartHeight: 400\npointRadius: 8\npointLabelFontSize: 14\ntitleFontSize: 22')
    const v = verifyMermaid(src)
    expect(v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })

  it('the wired and noop key sets partition the documented schema with no overlap', () => {
    const wired = new Set<string>(QUADRANT_WIRED_CONFIG_FIELDS)
    for (const field of QUADRANT_NOOP_CONFIG_FIELDS) {
      expect({ field, alsoWired: wired.has(field) }).toEqual({ field, alsoWired: false })
    }
    // The full upstream QuadrantChartConfig key list (config schema docs).
    const documented = [
      'chartWidth', 'chartHeight', 'titleFontSize', 'titlePadding', 'quadrantPadding',
      'xAxisLabelPadding', 'yAxisLabelPadding', 'xAxisLabelFontSize', 'yAxisLabelFontSize',
      'quadrantLabelFontSize', 'quadrantTextTopPadding', 'pointTextPadding', 'pointLabelFontSize',
      'pointRadius', 'xAxisPosition', 'yAxisPosition',
      'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth',
      'useWidth', 'useMaxWidth',
    ]
    const covered = new Set<string>([...QUADRANT_WIRED_CONFIG_FIELDS, ...QUADRANT_NOOP_CONFIG_FIELDS])
    for (const field of documented) {
      expect({ field, covered: covered.has(field) }).toEqual({ field, covered: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Density-scaled plot sizing (the config half of plan item 4)
// ---------------------------------------------------------------------------

describe('quadrant density-scaled plot sizing', () => {
  const denseSrc = (n: number) =>
    'quadrantChart\n' + Array.from({ length: n }, (_, i) =>
      `  P${i}: [${(0.3 + (i % 5) * 0.02).toFixed(2)}, ${(0.5 + Math.floor(i / 5) * 0.03).toFixed(2)}]`).join('\n')

  it('plot grows deterministically with point count when size is unconfigured', () => {
    const small = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(denseSrc(6))))
    const dense = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(denseSrc(20))))
    expect(small.plot.size).toBe(380)
    expect(dense.plot.size).toBeGreaterThan(380)
    // Monotone in n.
    const denser = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(denseSrc(25))))
    expect(denser.plot.size).toBeGreaterThanOrEqual(dense.plot.size)
  })

  it('explicit chartWidth/chartHeight wins over density scaling', () => {
    const positioned = layoutQuadrantChart(
      parseQuadrantChart(toMermaidLines(denseSrc(20))),
      {},
      resolveQuadrantVisualConfig({ quadrantChart: { chartWidth: 400, chartHeight: 400 } as never }),
    )
    expect(positioned.width).toBe(400)
    expect(positioned.height).toBe(400)
  })
})
